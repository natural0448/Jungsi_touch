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
import { RequestLimitError } from "../application/request_budget.ts";
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
    const expectedKey = await crypto.subtle.importKey(
      "raw",
      expected,
      options,
      false,
      ["verify"],
    );
    const actualKey = await crypto.subtle.importKey(
      "raw",
      actual,
      options,
      false,
      ["sign"],
    );
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
  policy: {
    paid: boolean;
    reportId?: string;
    reportOwner?: boolean;
    confirmed?: boolean;
  },
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
    await authorizeReport(
      user,
      policy.reportId ?? "",
      ports.reports,
      policy.confirmed ?? false,
    );
  }
  return user;
}

const SAFE_CODES = new Set([
  "acceptance_evidence_missing",
  "comparable_history_missing",
  "decision_range_unconfirmed",
  "eligibility_confirmation_required",
  "forecast_adjustment_base_pending",
  "forecast_adjustment_evidence_missing",
  "forecast_adjustment_evidence_unapproved",
  "forecast_adjustment_forbidden",
  "forecast_adjustment_invalid",
  "forecast_adjustment_unit_mismatch",
  "forecast_already_published",
  "forecast_approval_policy_missing",
  "forecast_approval_reason_missing",
  "forecast_approval_required",
  "forecast_approval_stale",
  "forecast_base_version_conflict",
  "forecast_bounds_missing",
  "forecast_category_direction_mismatch",
  "forecast_category_duplicate",
  "forecast_category_invalid",
  "forecast_category_ranges_missing",
  "forecast_comparison_basis_mismatch",
  "forecast_comparison_basis_missing",
  "forecast_comparison_metric_unsupported",
  "forecast_comparison_mismatch",
  "forecast_context_invalid",
  "forecast_context_mismatch",
  "forecast_continuity_policy_missing",
  "forecast_core_range_mismatch",
  "forecast_direction_missing",
  "forecast_display_value_mismatch",
  "forecast_exact_values_missing",
  "forecast_history_discontinuous",
  "forecast_history_invalid",
  "forecast_history_unapproved",
  "forecast_history_year_invalid",
  "forecast_independent_approver_required",
  "forecast_input_unapproved",
  "forecast_issue_invalid",
  "forecast_method_unsupported",
  "forecast_metric_mismatch",
  "forecast_metric_missing",
  "forecast_nonterminating_exact_value",
  "forecast_not_configured",
  "forecast_number_invalid",
  "forecast_numeric_issue_policy_unsupported",
  "forecast_offering_mismatch",
  "forecast_outputs_pending",
  "forecast_outside_policy_bounds",
  "forecast_policy_context_mismatch",
  "forecast_policy_invalid",
  "forecast_policy_unapproved",
  "forecast_precision_policy_missing",
  "forecast_public_context_invalid",
  "forecast_public_context_missing",
  "forecast_range_invalid",
  "forecast_ranges_overlap",
  "forecast_release_invalid",
  "forecast_release_missing",
  "forecast_target_year_mismatch",
  "forecast_tie_policy_mismatch",
  "forecast_trend_limit_exceeded",
  "forecast_trend_unapproved",
  "forecast_validation_required",
  "forecast_validation_stale",
  "forecast_weights_invalid",
  "forecast_weights_missing",
  "forecast_weights_year_mismatch",
  "history_bridge_unapproved",
  "invalid_json",
  "request_too_large",
  "duplicate_query_field",
  "invalid_identifier",
  "invalid_revision",
  "invalid_confirmation",
  "invalid_selection",
  "invalid_offering_ids",
  "invalid_query",
  "invalid_year",
  "invalid_limit",
  "invalid_cursor",
  "invalid_scores",
  "invalid_reported_percentile",
  "invalid_reported_grade",
  "invalid_subject",
  "invalid_inquiry",
  "invalid_standard_score",
  "invalid_integer",
  "invalid_text",
  "two_inquiry_required",
  "duplicate_inquiry",
  "inquiry_domain_mismatch",
  "reported_grade_conflict",
  "reported_percentile_conflict",
  "invalid_grade",
  "invalid_choice",
  "unobserved_standard_score",
  "profile_not_found",
  "offering_not_found",
  "idempotency_conflict",
  "revision_conflict",
  "cursor_version_mismatch",
  "pack_version_mismatch",
  "exam_data_unavailable",
  "exam_not_available",
  "exam_binding_invalid",
  "public_source_invalid",
  "recruitment_changes_invalid",
  "recruitment_count_invalid",
  "catalog_release_missing",
  "catalog_unavailable",
  "catalog_release_invalid",
  "catalog_release_not_approved",
  "catalog_identity_conflict",
  "catalog_scope_unverified",
  "catalog_field_invalid",
  "published_metric_invalid",
  "storage_unavailable",
  "storage_result_invalid",
  "rate_limit_exceeded",
  "analysis_quota_exceeded",
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
    [400, 401, 403, 404, 405, 409, 413, 422, 429, 503].includes(error.http) &&
    (error.http !== 429 || error instanceof RequestLimitError);
  const code = known ? error.code : "backend_dependency_unavailable",
    http = known ? error.http : 503;
  return Response.json({
    status: "error",
    error: { code },
    request_id: requestId,
  }, {
    status: http,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
      ...(known && error instanceof RequestLimitError
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {}),
    },
  });
}
