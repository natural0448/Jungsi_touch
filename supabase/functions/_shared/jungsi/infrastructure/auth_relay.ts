/** Injectable local boundary; no deployed function or actual account configuration. */
import {
  AccessError,
  authorizeCurrent,
  authorizeReport,
  authorizeUser,
} from "../application/access.ts";
import type {
  EntitlementPort,
  ReportAccessPort,
  UserSessionPort,
  VerifiedUser,
} from "../application/ports.ts";
function relayBytes(value: unknown): ArrayBuffer | null {
  if (
    typeof value !== "string" || value.length < 32 || value.length > 512 ||
    !/^[!-~]+$/.test(value) || value.includes(",")
  ) return null;
  return new TextEncoder().encode(value).buffer;
}
export class RelayBoundary {
  constructor(private readonly expected: string | null) {}
  async verify(headers: Headers): Promise<void> {
    const expected = relayBytes(this.expected);
    if (!expected) throw new AccessError("security_policy_unavailable", 503);
    const actual = relayBytes(headers.get("X-Jungsi-Relay-Token"));
    if (!actual || actual.byteLength !== expected.byteLength) {
      throw new AccessError("relay_authentication_failed", 403);
    }
    // Native HMAC verification avoids a JavaScript string equality test for the secret.
    const options = { name: "HMAC", hash: "SHA-256" };
    const expectedKey = await crypto.subtle.importKey("raw", expected, options, false, ["verify"]);
    const actualKey = await crypto.subtle.importKey("raw", actual, options, false, ["sign"]);
    const message = new TextEncoder().encode("jungsi.relay-token/v1");
    const signature = await crypto.subtle.sign("HMAC", actualKey, message);
    if (!await crypto.subtle.verify("HMAC", expectedKey, signature, message)) {
      throw new AccessError("relay_authentication_failed", 403);
    }
  }
}
export interface BoundaryPorts {
  sessions: UserSessionPort;
  entitlements: EntitlementPort;
  reports: ReportAccessPort;
}
export async function authorizeRelayed(
  headers: Headers,
  relay: RelayBoundary,
  ports: BoundaryPorts,
  nowUtc: bigint,
  policy: { paid: boolean; reportId?: string; reportOwner?: boolean; confirmed?: boolean },
): Promise<VerifiedUser> {
  await relay.verify(headers);
  const header = headers.get("Authorization") ?? "";
  const m = /^Bearer ([^\s,]+)$/.exec(header);
  if (!m || m[1].length > 16384 || /^sb_(?:publishable|secret)_/.test(m[1])) {
    throw new AccessError("authentication_required", 401);
  }
  const user = await authorizeUser(m[1], ports.sessions, nowUtc);
  await authorizeCurrent(user, ports.entitlements, nowUtc, policy.paid);
  if (policy.reportOwner || policy.reportId !== undefined) {
    await authorizeReport(user, policy.reportId ?? "", ports.reports, policy.confirmed ?? false);
  }
  return user;
}

const SAFE_CODES = new Set([
  "management_mfa_required",
  "management_account_inactive",
  "management_account_state_unverified",
  "forecast_forbidden",
  "forecast_not_found",
  "invalid_request",
  "route_not_found",
  "method_not_allowed",
  "entitlement_schema_unverified",
  "entitlement_runtime_role_unverified",
  "entitlement_rls_unverified",
  "entitlement_identity_or_time_invalid",
  "entitlement_result_invalid",
  "authentication_required",
  "auth_unavailable",
  "entitlement_unavailable",
  "paid_required",
  "report_not_found",
  "report_required",
  "score_confirmation_required",
  "invalid_repository_result",
  "backend_dependency_unavailable",
  "relay_authentication_failed",
  "security_policy_unavailable",
]);
export function safeFailure(error: unknown, requestId: string): Response {
  const known = error instanceof AccessError && SAFE_CODES.has(error.code) &&
    [400, 401, 403, 404, 405, 409, 503].includes(error.http);
  const code = known ? error.code : "backend_dependency_unavailable",
    http = known ? error.http : 503;
  return Response.json({ status: "error", error: { code }, request_id: requestId }, {
    status: http,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
    },
  });
}
