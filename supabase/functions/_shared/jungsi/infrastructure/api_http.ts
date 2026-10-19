/** All 25 HTTP routes (legacy 22 plus policy 3). Concrete business/provider/budget wiring is supplied separately. */
import { AccessError, authorizeReport } from "../application/access.ts";
import {
  API_OPERATION_IDS,
  type ApiBusinessPort,
  type ApiExecution,
  type ApiRoutePolicy,
} from "../application/api_dispatch.ts";
import {
  authorizeManagement,
  MANAGEMENT_OPERATIONS,
  type ManagementDecision,
  type ManagementOperation,
  requireManagementUniversity,
} from "../application/management_access.ts";
import type {
  ForecastAuthorityPort,
  ManagementResourcePort,
  PublicPassPort,
  ReportAccess,
  RequestClockPort,
  UserSessionPort,
} from "../application/ports.ts";
import { publicJsonText, PublicResponseProjection } from "../application/public_response.ts";
import { BUDGET_OPERATIONS, type RequestBudgetPort } from "../application/request_budget.ts";
import {
  isVerifiedAdminSnapshot,
  readSessionSnapshot,
  sessionDto,
  type SessionSnapshot,
} from "../application/session_service.ts";
import { type NativeJson, parseNativeJson } from "../domain/native_json.ts";
import { RelayBoundary, safeFailure } from "./auth_relay.ts";
export const API_REQUEST_STAGES = [
  "route",
  "relay",
  "user_session",
  "member_access",
  "owner_access",
  "management_access",
  "request_body",
  "business",
  "business_session",
  "response_projection",
  "budget",
  "final_session",
  "final_projection",
  "response_serialization",
  "response_current",
  "response_delivery",
  "response_acceptance",
] as const;
export type ApiRequestStage = typeof API_REQUEST_STAGES[number];
export interface ApiHttpPorts {
  readonly relay: RelayBoundary;
  readonly sessions: UserSessionPort;
  readonly passes: PublicPassPort;
  readonly clock: RequestClockPort;
  readonly reports: {
    lookupAccess(owner: string, reportId: string): Promise<ReportAccess | null>;
  };
  readonly authorities: ForecastAuthorityPort;
  readonly resources: ManagementResourcePort;
  readonly projection: PublicResponseProjection;
  readonly budget: RequestBudgetPort;
  readonly business: ApiBusinessPort;
  readonly completion?: {
    accept<T>(request: ApiExecution, work: () => Promise<T>): Promise<T>;
    deliver(request: ApiExecution, result: unknown, requestId: string): Promise<void>;
    current(): Promise<void>;
  };
  /** Constant phase names only. Observation failures cannot change request behavior. */
  readonly onStage?: (stage: ApiRequestStage) => void;
}
interface Route {
  policy: ApiRoutePolicy;
  pattern: RegExp;
  keys: string[];
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function configuration(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function routes(policies: readonly ApiRoutePolicy[]): Route[] {
  if (
    !Array.isArray(policies) || policies.length !== API_OPERATION_IDS.length ||
    new Set(policies.map((p) => p?.id)).size !== API_OPERATION_IDS.length
  ) configuration();
  const result = policies.map((policy: ApiRoutePolicy) => {
    if (
      !policy || !API_OPERATION_IDS.includes(policy.id) ||
      !["GET", "POST", "PUT"].includes(policy.method) ||
      typeof policy.path !== "string" ||
      !/^\/api\/v1\/[A-Za-z0-9_{}./:-]+$/.test(policy.path) ||
      typeof policy.report_owner !== "boolean" ||
      typeof policy.confirmed_score_profile !== "boolean" ||
      !Array.isArray(policy.member_tiers) || !policy.member_tiers.length ||
      policy.member_tiers.some((t) => !["standard", "paid"].includes(t)) ||
      new Set(policy.member_tiers).size !== policy.member_tiers.length
    ) configuration();
    const keys: string[] = [];
    const segments = policy.path.split("/").map((part) => {
      const match = /^\{([a-z_]+)\}$/.exec(part);
      if (match) {
        if (
          !["offering_id", "report_id", "draft_id"].includes(match[1]) ||
          keys.includes(match[1])
        ) configuration();
        keys.push(match[1]);
        return "([^/]+)";
      }
      if (part.includes("{") || part.includes("}")) configuration();
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    if (
      policy.confirmed_score_profile && !policy.report_owner ||
      policy.report_owner && !keys.includes("report_id")
    ) configuration();
    return {
      policy: { ...policy, member_tiers: [...policy.member_tiers] },
      keys,
      pattern: new RegExp("^" + segments.join("/") + "$"),
    };
  });
  if (
    new Set(result.map((r) => r.policy.method + " " + r.policy.path)).size !==
      result.length
  ) {
    configuration();
  }
  return result.sort((a, b) =>
    a.keys.length - b.keys.length || b.policy.path.length - a.policy.path.length
  );
}
function bearer(headers: Headers): string {
  const match = /^Bearer ([^\s,]+)$/.exec(headers.get("Authorization") ?? "");
  if (
    !match || match[1].length > 16384 ||
    /^sb_(?:publishable|secret)_/.test(match[1])
  ) {
    throw new AccessError("authentication_required", 401);
  }
  return match[1];
}
async function body(request: Request): Promise<NativeJson> {
  if (!["POST", "PUT"].includes(request.method)) return {};
  const declared = request.headers.get("Content-Length");
  if (
    declared !== null &&
    (declared.length > 20 || !/^\d+$/.test(declared) ||
      BigInt(declared) > 200000n)
  ) {
    throw new AccessError("request_too_large", 413);
  }
  const chunks: Uint8Array[] = [];
  let count = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        count += part.value.byteLength;
        if (count > 200000) {
          await reader.cancel();
          throw new AccessError("request_too_large", 413);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return parseNativeJson(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new AccessError("invalid_json", 422);
  }
}
function query(url: URL): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) {
      throw new AccessError("duplicate_query_field", 422);
    }
    result[key] = value;
  }
  return result;
}
async function management(
  policy: ApiRoutePolicy,
  session: SessionSnapshot,
  params: Record<string, string>,
  ports: ApiHttpPorts,
): Promise<ManagementDecision | null> {
  if (!MANAGEMENT_OPERATIONS.includes(policy.id as ManagementOperation)) {
    return null;
  }
  const decision = await authorizeManagement(
    session.user,
    ports.authorities,
    session.evaluatedAtUtc,
    policy.id as ManagementOperation,
  );
  const kind = policy.id === "forecast.create" ? "offering" : params.draft_id ? "draft" : null;
  if (kind) {
    const id = params[kind === "offering" ? "offering_id" : "draft_id"];
    if (!IDENTIFIER.test(id)) throw new AccessError("forecast_not_found", 404);
    let resource;
    try {
      resource = await ports.resources.readScope(
        kind,
        id,
        session.user.subjectId,
      );
    } catch {
      throw new AccessError("backend_dependency_unavailable", 503);
    }
    if (!resource) throw new AccessError("forecast_not_found", 404);
    if (
      resource.kind !== kind || resource.id !== id ||
      typeof resource.universityId !== "string"
    ) {
      throw new AccessError("invalid_repository_result", 503);
    }
    requireManagementUniversity(decision, resource.universityId);
  }
  return decision;
}
export function createApiHandler(
  policies: readonly ApiRoutePolicy[],
  ports: ApiHttpPorts,
): (request: Request) => Promise<Response> {
  const registered = routes(policies);
  if (
    !ports?.budget || typeof ports.budget.run !== "function" ||
    !ports.business ||
    typeof ports.business.execute !== "function"
  ) configuration();
  return async (request) => {
    const requestId = crypto.randomUUID().replaceAll("-", "");
    const stage = (value: ApiRequestStage) => {
      try {
        const pending: unknown = ports.onStage?.(value);
        if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(pending).catch(() => {});
        }
      } catch { /* Observability is not authorization. */ }
    };
    try {
      stage("route");
      const url = new URL(request.url),
        matches = registered.filter((r) => r.pattern.test(url.pathname));
      const route = matches.find((r) => r.policy.method === request.method);
      if (!route) {
        throw new AccessError(
          matches.length ? "method_not_allowed" : "route_not_found",
          matches.length ? 405 : 404,
        );
      }
      const policy = route.policy,
        match = route.pattern.exec(url.pathname)!,
        params = Object.fromEntries(
          route.keys.map((key, i) => [key, match[i + 1]]),
        );
      stage("relay");
      await ports.relay.verify(request.headers);
      stage("user_session");
      const session = await readSessionSnapshot(
        bearer(request.headers),
        ports.sessions,
        ports.passes,
        ports.clock.nowUtc(),
      );
      stage("member_access");
      if (!policy.member_tiers.includes(session.tier)) {
        throw new AccessError("paid_required", 403);
      }
      if (policy.report_owner) {
        stage("owner_access");
        await authorizeReport(session.user, params.report_id ?? "", {
          find: (id) =>
            IDENTIFIER.test(id)
              ? ports.reports.lookupAccess(session.user.subjectId, id)
              : Promise.resolve(null),
        }, policy.confirmed_score_profile);
      }
      stage("management_access");
      if (policy.id === "score-input.correction.grant" && !isVerifiedAdminSnapshot(session)) {
        throw new AccessError("management_mfa_required", 403);
      }
      const decision = await management(policy, session, params, ports);
      // Authorization is complete before consuming any untrusted body or query.
      stage("request_body");
      const selectedQuery = query(url);
      if (policy.method !== "GET" && Object.keys(selectedQuery).length > 0) {
        throw new AccessError("invalid_request", 422);
      }
      const payload = await body(request);
      for (const id of Object.values(params)) {
        if (!IDENTIFIER.test(id)) {
          throw new AccessError("invalid_identifier", 422);
        }
      }
      const selected = {
        operation: policy.id,
        session,
        management: decision,
        body: payload,
        query: selectedQuery,
        params,
        requestKey: request.headers.get("Idempotency-Key"),
      };
      const work = async () => {
        stage("business");
        const result = policy.id === "session.read"
          ? sessionDto(session, ports.clock.nowUtc())
          : await ports.business.execute(selected);
        if (
          policy.id === "session.read" &&
          (Object.keys(selectedQuery).length ||
            request.headers.get("Content-Length") &&
              request.headers.get("Content-Length") !== "0")
        ) throw new AccessError("invalid_request", 422);
        stage("business_session");
        sessionDto(session, ports.clock.nowUtc());
        stage("response_projection");
        return ports.projection.project(policy.id, session.tier, result);
      };
      const complete = async () => {
        stage("budget");
        const result = BUDGET_OPERATIONS.includes(
            policy.id as typeof BUDGET_OPERATIONS[number],
          )
          ? await ports.budget.run(selected, work)
          : await work();
        // Budget settlement or a future cache hit must still pass the final boundary.
        stage("final_session");
        sessionDto(session, ports.clock.nowUtc());
        stage("final_projection");
        const approved = ports.projection.project(policy.id, session.tier, result);
        stage("response_serialization");
        const response = new Response(publicJsonText(approved), {
          status: ["score-profile.create", "overall.analyze"].includes(policy.id) ? 201 : 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Request-ID": requestId,
          },
        });
        stage("response_current");
        await ports.completion?.current();
        sessionDto(session, ports.clock.nowUtc());
        stage("response_delivery");
        await ports.completion?.deliver(selected, approved, requestId);
        return response;
      };
      stage("response_acceptance");
      return ports.completion
        ? await ports.completion.accept(selected, complete)
        : await complete();
    } catch (error) {
      return safeFailure(error, requestId);
    }
  };
}
