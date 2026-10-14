/** Synthetic-candidate composition only. No Deno.serve, fetch, DB writer, or default switch. */
import { AccessError } from "../application/access.ts";
import type {
  ForecastAuthorityPort,
  ManagementResourcePort,
  PublicPassPort,
  RequestClockPort,
  UserSessionPort,
} from "../application/ports.ts";
import {
  readSessionSnapshot,
  sessionDto,
  type SessionSnapshot,
} from "../application/session_service.ts";
import {
  authorizeManagement,
  type ManagementDecision,
  type ManagementOperation,
  requireManagementUniversity,
} from "../application/management_access.ts";
import { RelayBoundary, safeFailure } from "./auth_relay.ts";
export interface SessionReadPorts {
  readonly sessions: UserSessionPort;
  readonly passes: PublicPassPort;
  readonly clock: RequestClockPort;
  readonly relay: RelayBoundary;
}
function token(headers: Headers): string {
  const match = /^Bearer ([^\s,]+)$/.exec(headers.get("Authorization") ?? "");
  if (!match || match[1].length > 16384 || /^sb_(?:publishable|secret)_/.test(match[1])) {
    throw new AccessError("authentication_required", 401);
  }
  return match[1];
}
async function context(request: Request, ports: SessionReadPorts): Promise<SessionSnapshot> {
  await ports.relay.verify(request.headers);
  const now = ports.clock.nowUtc();
  return await readSessionSnapshot(token(request.headers), ports.sessions, ports.passes, now);
}
export function createSyntheticSessionReadHandler(
  ports: SessionReadPorts,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID().replace(/-/g, "");
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/api/v1/me") throw new AccessError("route_not_found", 404);
      if (request.method !== "GET") throw new AccessError("method_not_allowed", 405);
      const selected = await context(request, ports);
      if (
        url.search ||
        request.headers.get("Content-Length") && request.headers.get("Content-Length") !== "0"
      ) throw new AccessError("invalid_request", 400);
      return Response.json(sessionDto(selected, ports.clock.nowUtc()), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Request-ID": requestId,
        },
      });
    } catch (error) {
      return safeFailure(error, requestId);
    }
  };
}
export interface ManagementGuardPorts extends SessionReadPorts {
  readonly authorities: ForecastAuthorityPort;
  readonly resources: ManagementResourcePort;
}
export interface ManagementRoute {
  readonly operation: ManagementOperation;
  readonly resourceKind: "offering" | "draft" | null;
  readonly resourceId: string | null;
}
export function managementRoute(request: Request): ManagementRoute {
  const path = new URL(request.url).pathname, method = request.method;
  if (method === "GET" && path === "/api/v1/forecast-capabilities") {
    return { operation: "forecast.capabilities", resourceKind: null, resourceId: null };
  }
  if (method === "GET" && path === "/api/v1/forecast-drafts") {
    return { operation: "forecast.list", resourceKind: null, resourceId: null };
  }
  const offering = /^\/api\/v1\/offerings\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/forecast-drafts$/
    .exec(path);
  if (method === "POST" && offering) {
    return { operation: "forecast.create", resourceKind: "offering", resourceId: offering[1] };
  }
  const draft =
    /^\/api\/v1\/forecast-drafts\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(?:\/(adjustments|validations|approvals|publications))?$/
      .exec(path);
  if (draft && method === "GET" && !draft[2]) {
    return { operation: "forecast.read", resourceKind: "draft", resourceId: draft[1] };
  }
  if (draft && method === "POST" && draft[2]) {
    const actions: Record<string, ManagementOperation> = {
      adjustments: "forecast.adjust",
      validations: "forecast.validate",
      approvals: "forecast.approve",
      publications: "forecast.publish",
    };
    return { operation: actions[draft[2]], resourceKind: "draft", resourceId: draft[1] };
  }
  throw new AccessError("route_not_found", 404);
}
/** Returns internal authorization only. It does not execute any of the eight business handlers. */
export function createSyntheticManagementGuard(
  ports: ManagementGuardPorts,
): (request: Request) => Promise<ManagementDecision> {
  return async (request) => {
    const route = managementRoute(request);
    const selected = await context(request, ports);
    const decision = await authorizeManagement(
      selected.user,
      ports.authorities,
      selected.evaluatedAtUtc,
      route.operation,
    );
    if (route.resourceKind && route.resourceId) {
      let resource;
      try {
        resource = await ports.resources.readScope(
          route.resourceKind,
          route.resourceId,
          selected.user.subjectId,
        );
      } catch {
        throw new AccessError("backend_dependency_unavailable", 503);
      }
      if (!resource) throw new AccessError("forecast_not_found", 404);
      if (
        resource.kind !== route.resourceKind || resource.id !== route.resourceId ||
        typeof resource.universityId !== "string"
      ) throw new AccessError("invalid_repository_result", 503);
      requireManagementUniversity(decision, resource.universityId);
    }
    const query = new URL(request.url).searchParams;
    if (route.operation === "forecast.list") {
      if ([...query.keys()].some((k) => k !== "university_id") || [...query.keys()].length > 1) {
        throw new AccessError("invalid_request", 400);
      }
    } else if ([...query.keys()].length) throw new AccessError("invalid_request", 400);
    const complete = ports.clock.nowUtc();
    if (typeof complete !== "bigint" || complete < selected.evaluatedAtUtc) {
      throw new AccessError("backend_dependency_unavailable", 503);
    }
    if (selected.user.expiresAtUtc <= complete) {
      throw new AccessError("authentication_required", 401);
    }
    if (route.operation === "forecast.list" && query.has("university_id")) {
      const school = query.get("university_id") ?? "";
      if (!school.trim() || school.trim() !== school || school.length > 128) {
        throw new AccessError("invalid_request", 400);
      }
      return Object.freeze({
        ...decision,
        universityIds: Object.freeze(decision.universityIds.filter((x) => x === school)),
      });
    }
    return decision;
  };
}
