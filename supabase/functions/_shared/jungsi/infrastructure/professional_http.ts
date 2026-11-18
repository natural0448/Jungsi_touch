/** Separate institutional ingress; the personal API route table is unchanged. */
import { AccessError, authorizeUser } from "../application/access.ts";
import type { RequestClockPort, UserSessionPort, VerifiedUser } from "../application/ports.ts";
import type {
  ProfessionalContract,
  ProfessionalResponse,
} from "../application/professional_ports.ts";
import { proFresh, proId, proObject } from "../application/professional_policy.ts";
import { ProfessionalProjection } from "../application/professional_projection.ts";
import {
  type ProfessionalDeliveryBoundary,
  ProfessionalService,
} from "../application/professional_service.ts";
import { RequestLimitError } from "../application/request_budget.ts";
import {
  publicJsonText,
  type WildcardProjectionAuthority,
} from "../application/public_response.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import { RelayBoundary, safeFailure } from "./auth_relay.ts";

export interface ProfessionalHttpPorts {
  readonly contract: ProfessionalContract;
  readonly relay: RelayBoundary;
  readonly sessions: UserSessionPort;
  readonly clock: RequestClockPort;
  readonly projection: ProfessionalProjection;
  /** Absent until an independent same-request immutable-revision verifier is approved. */
  readonly wildcardProjectionAuthority?: {
    resolve(
      operation: string,
      user: VerifiedUser,
      response: ProfessionalResponse,
      boundary: ProfessionalDeliveryBoundary,
      signal: AbortSignal,
    ): Promise<WildcardProjectionAuthority | null>;
  };
  readonly service: (operation: string, user: VerifiedUser) => Promise<ProfessionalService>;
  /** Verified BFF CSRF result is required in addition to relay and exact bearer verification. */
  readonly mutationGuard: (request: Request) => Promise<void>;
  readonly maximumRequestMilliseconds: number;
  readonly ingressStartedAtUtc?: bigint;
}
function hasPrivateWildcardProfessional(operation: string, value: unknown): boolean {
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  const candidate = (x: unknown) => object(x) && Object.hasOwn(x, "_wildcard_selection_view");
  const report = (x: unknown) =>
    object(x) && (candidate(x.candidates) ||
      object(x.read_only_snapshot) && candidate(x.read_only_snapshot.candidates));
  if (!object(value)) return false;
  if (operation === "pro.candidates") return candidate(value.candidates);
  if (operation === "pro.overall.analyze") return report(value.report);
  if (operation === "pro.report.read") return report(value.published_result);
  if (operation === "pro.report.export") {
    return object(value.snapshot) && report(value.snapshot.report);
  }
  if (operation === "pro.report.list") {
    return Array.isArray(value.items) &&
      value.items.some((item) => object(item) && report(item.published_result));
  }
  return false;
}
const SAFE = new Set([
  "professional_access_denied",
  "professional_student_not_found",
  "professional_report_not_found",
  "professional_bookmark_not_found",
  "professional_profile_not_found",
  "professional_contract_inactive",
  "professional_contract_capacity_changed",
  "professional_contract_capacity_exhausted",
  "student_seat_limit_reached",
  "professional_version_conflict",
  "professional_cursor_changed",
  "professional_cursor_expired",
  "professional_cursor_invalid",
  "professional_request_timeout",
  "professional_exam_unavailable",
  "professional_analysis_unavailable",
  "professional_storage_unavailable",
  "professional_policy_unavailable",
  "professional_contract_unavailable",
  "professional_response_invalid",
  "professional_result_invalid",
  "professional_result_limit_exceeded",
  "professional_crypto_unavailable",
  "professional_protected_value_invalid",
  "professional_authority_unavailable",
  "professional_authority_changed",
  "professional_retention_unavailable",
  "professional_initial_report_required",
  "professional_student_archived",
  "professional_csrf_failed",
]);
function headers(): Headers {
  return new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}
function response(text: string, status: number, extra?: Record<string, string>): Response {
  const h = headers();
  for (const [key, value] of Object.entries(extra ?? {})) h.set(key, value);
  return new Response(text, { status, headers: h });
}
function failure(error: unknown, requestId: string): Response {
  if (error instanceof RequestLimitError) {
    return response(
      JSON.stringify({ status: "error", error: { code: error.code }, request_id: requestId }),
      429,
      { "Retry-After": String(error.retryAfterSeconds) },
    );
  }
  if (error instanceof AccessError && SAFE.has(error.code)) {
    return response(
      JSON.stringify({ status: "error", error: { code: error.code }, request_id: requestId }),
      error.http,
    );
  }
  const safe = safeFailure(error, requestId);
  safe.headers.set("Cache-Control", "private, no-store");
  safe.headers.set("X-Content-Type-Options", "nosniff");
  return safe;
}
async function body(request: Request, maximum: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!request.body) return {};
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")
  ) throw new AccessError("invalid_request", 422);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || BigInt(declared) > BigInt(maximum))) {
    throw new AccessError("invalid_request", 422);
  }
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const item = await reader.read();
      signal.throwIfAborted();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) throw new AccessError("invalid_request", 422);
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return proObject(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError("invalid_request", 422);
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function current(previous: VerifiedUser, next: VerifiedUser, now: bigint): void {
  proFresh(next, now);
  if (
    previous.subjectId !== next.subjectId || previous.accountRole !== next.accountRole ||
    previous.assuranceLevel !== next.assuranceLevel
  ) throw new AccessError("professional_access_denied", 403);
}
export function professionalMutationGuard(
  approvedOrigin: string,
): (request: Request) => Promise<void> {
  let origin: string;
  try {
    const u = new URL(approvedOrigin);
    if (u.protocol !== "https:" || u.origin !== approvedOrigin || u.username || u.password) {
      throw new Error();
    }
    origin = u.origin;
  } catch {
    throw new AccessError("professional_policy_unavailable", 503);
  }
  return (request) => {
    if (
      request.headers.get("origin") !== origin ||
      request.headers.get("X-Jungsi-CSRF-Verified") !== "1"
    ) throw new AccessError("professional_csrf_failed", 403);
    return Promise.resolve();
  };
}
export function createProfessionalHandler(
  ports: ProfessionalHttpPorts,
): (request: Request) => Promise<Response> {
  if (
    !Number.isSafeInteger(ports.maximumRequestMilliseconds) ||
    ports.maximumRequestMilliseconds < 1 || ports.maximumRequestMilliseconds > 2147483647
  ) throw new AccessError("professional_policy_unavailable", 503);
  const routes = ports.contract.routes.map((route) => {
    const keys: string[] = [],
      parts = route.path.split("/").map((part) => {
        const m = /^\{([a-z_]+)\}$/.exec(part);
        if (m) {
          keys.push(m[1]);
          return "([^/]+)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      });
    return { route, keys, pattern: new RegExp("^" + parts.join("/") + "$") };
  });
  if (routes.length !== 22 || new Set(routes.map((r) => r.route.id)).size !== 22) {
    throw new AccessError("professional_contract_unavailable", 503);
  }
  return async (request) => {
    const requestId = crypto.randomUUID().replaceAll("-", "");
    const startedAtUtc = ports.ingressStartedAtUtc ?? ports.clock.nowUtc(),
      controller = new AbortController();
    const combinedSignal = AbortSignal.any([controller.signal, request.signal]);
    const remaining = Math.max(
      1,
      ports.maximumRequestMilliseconds - Number((ports.clock.nowUtc() - startedAtUtc) / 1000n),
    );
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<Response>((_, reject) => {
      timer = setTimeout(() => {
        const error = new AccessError("professional_request_timeout", 503);
        controller.abort(error);
        reject(error);
      }, remaining);
    });
    const run = async () => {
      try {
        const url = new URL(request.url);
        let path = url.pathname;
        for (const prefix of ["/functions/v1/jungsi-pro-api", "/jungsi-pro-api"]) {
          if (path.startsWith(prefix + "/")) {
            path = path.slice(prefix.length);
            break;
          }
        }
        const found = routes.find((r) => r.route.method === request.method && r.pattern.test(path));
        if (!found) throw new AccessError("route_not_found", 404);
        await ports.relay.verify(request.headers);
        const bearer = /^Bearer ([^\s,]+)$/.exec(request.headers.get("Authorization") ?? "");
        if (!bearer || bearer[1].length > 16384 || /^sb_(?:publishable|secret)_/.test(bearer[1])) {
          throw new AccessError("authentication_required", 401);
        }
        const user = await authorizeUser(bearer[1], ports.sessions, ports.clock.nowUtc());
        proFresh(user, ports.clock.nowUtc());
        combinedSignal.throwIfAborted();
        if (found.route.request.BFF_CSRF_required) await ports.mutationGuard(request);
        const match = found.pattern.exec(path)!,
          params: Record<string, string> = {},
          query: Record<string, string> = {};
        for (let i = 0; i < found.keys.length; i++) {
          try {
            params[found.keys[i]] = proId(decodeURIComponent(match[i + 1]));
          } catch {
            throw new AccessError("invalid_identifier", 422);
          }
        }
        for (const [key, value] of url.searchParams) {
          if (
            Object.hasOwn(query, key) || !found.route.request.query_fields.includes(key) ||
            value.length > 32768
          ) throw new AccessError("invalid_request", 422);
          query[key] = value;
        }
        const key = request.headers.get("Idempotency-Key");
        if (found.route.request.Idempotency_Key_required !== (key !== null)) {
          throw new AccessError("invalid_request", 422);
        }
        if (key !== null) proId(key);
        const service = await ports.service(found.route.id, user);
        combinedSignal.throwIfAborted();
        if (
          service.policy.operating.maxRequestRuntimeMilliseconds >
            BigInt(ports.maximumRequestMilliseconds)
        ) throw new AccessError("professional_policy_unavailable", 503);
        const input = await body(request, service.policy.maxBodyBytes, combinedSignal);
        if (request.method === "GET" && Object.keys(input).length) {
          throw new AccessError("invalid_request", 422);
        }
        const delivery = await service.execute({
          operation: found.route.id,
          user,
          params,
          query,
          body: input,
          key,
          requestId,
          startedAtUtc,
        }, async (outcome, boundary) => {
          combinedSignal.throwIfAborted();
          const now = ports.clock.nowUtc();
          current(user, await authorizeUser(bearer[1], ports.sessions, now), now);
          let text: string, status: number;
          let authority: WildcardProjectionAuthority | null = null;
          if (
            outcome.response && ports.wildcardProjectionAuthority && boundary &&
            hasPrivateWildcardProfessional(found.route.id, outcome.response.data)
          ) {
            try {
              authority = await ports.wildcardProjectionAuthority.resolve(
                found.route.id,
                user,
                outcome.response,
                boundary,
                combinedSignal,
              );
              if (authority) await authority.assertCurrent(combinedSignal);
            } catch {
              authority = null;
            }
            combinedSignal.throwIfAborted();
          }
          if (outcome.error) {
            text = JSON.stringify({
              status: "error",
              error: { code: outcome.error.code },
              request_id: requestId,
            });
            status = outcome.error.http;
          } else if (outcome.response) {
            text = publicJsonText(
              ports.projection.project(
                found.route.id,
                outcome.response,
                requestId,
                authority ?? undefined,
              ),
            );
            status = found.route.method === "POST" &&
                ["pro.student.create", "pro.score.create"].includes(found.route.id)
              ? 201
              : 200;
          } else throw new AccessError("professional_response_invalid", 503);
          return {
            value: { initial: response(text, status), text, status, authority, outcome },
            bytes: BigInt(new TextEncoder().encode(text).byteLength),
          };
        }, combinedSignal);
        if (!delivery.authority) return delivery.initial;
        combinedSignal.throwIfAborted();
        const now = ports.clock.nowUtc();
        current(user, await authorizeUser(bearer[1], ports.sessions, now), now);
        // Final authentication is asynchronous; check the selection authority afterwards.
        combinedSignal.throwIfAborted();
        await delivery.authority.assertCurrent(combinedSignal);
        combinedSignal.throwIfAborted();
        proFresh(user, ports.clock.nowUtc());
        if (!delivery.outcome.response) throw new AccessError("professional_response_invalid", 503);
        const finalText = publicJsonText(ports.projection.project(
          found.route.id,
          delivery.outcome.response,
          requestId,
          delivery.authority,
        ));
        if (finalText !== delivery.text) {
          throw new AccessError("professional_response_invalid", 503);
        }
        return response(finalText, delivery.status);
      } catch (error) {
        return failure(error, requestId);
      }
    };
    try {
      return await Promise.race([run(), timeout]);
    } catch (error) {
      return failure(error, requestId);
    } finally {
      clearTimeout(timer!);
    }
  };
}
