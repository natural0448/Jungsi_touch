/** Closed forecast projections. Workflow hashes, exact values and policies remain private. */
import { forecastObject, forecastRequire, forecastTruthy } from "./forecast_calculation.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { type NativeJson } from "../domain/native_json.ts";
export const FORECAST_PUBLIC_CONTEXT_FIELDS = [
  "offering_id",
  "academic_year",
  "exam_id",
  "source_pack_version",
  "catalog_version",
  "rule_id",
  "rule_version",
  "curve_version",
  "analysis_version",
  "score_scale_id",
  "score_scope",
  "bonus_treatment",
  "population_id",
  "comparison_metric",
  "unit",
  "direction",
  "tie_policy",
] as const;
function fields(raw: unknown, names: readonly string[]): NativeObject {
  const value = forecastObject(raw, "forecast_release_invalid", 503);
  return Object.fromEntries(names.map((k) => [k, cloneNativeJson(value[k] ?? null)]));
}
function array(v: unknown): NativeJson[] {
  forecastRequire(Array.isArray(v), "forecast_release_invalid", 503);
  return v;
}
export function publicForecastContext(raw: unknown): NativeObject {
  const c = forecastObject(raw, "forecast_public_context_missing", 409);
  forecastRequire(
    FORECAST_PUBLIC_CONTEXT_FIELDS.every((k) => Object.hasOwn(c, k)) &&
      FORECAST_PUBLIC_CONTEXT_FIELDS.filter((k) => k !== "tie_policy").every((k) => c[k] !== null),
    "forecast_public_context_missing",
    409,
  );
  forecastRequire(
    FORECAST_PUBLIC_CONTEXT_FIELDS.filter((k) => k !== "tie_policy").every((k) =>
      typeof c[k] === "string" || typeof c[k] === "bigint" ||
      typeof c[k] === "number" && Number.isSafeInteger(c[k])
    ) &&
      (typeof c.academic_year === "bigint" ||
        typeof c.academic_year === "number" && Number.isSafeInteger(c.academic_year)),
    "forecast_public_context_invalid",
    409,
  );
  forecastRequire(
    c.comparison_metric === "converted_score" && c.unit === "점" &&
        c.direction === "higher_is_better" && c.tie_policy === null ||
      c.comparison_metric === "university_top_percent" && c.unit === "%" &&
        c.direction === "lower_is_better" && c.tie_policy === "include_equal",
    "forecast_comparison_basis_mismatch",
    409,
  );
  return fields(c, FORECAST_PUBLIC_CONTEXT_FIELDS);
}
export function forecastResultDto(raw: unknown): NativeObject {
  const r = forecastObject(raw, "forecast_release_invalid", 503);
  return {
    forecast_70: fields(r.forecast_70, [
      "status",
      "reason_code",
      "value",
      "unit",
      "definition",
      "version",
    ]),
    acceptance_range: fields(r.acceptance_range, [
      "status",
      "reason_code",
      "lower",
      "upper",
      "unit",
      "definition",
      "policy_version",
    ]),
    category_ranges: array(r.category_ranges).map((v) => fields(v, ["category", "lower", "upper"])),
  };
}
function adjustmentDto(raw: unknown): NativeObject {
  const r = forecastObject(raw, "forecast_release_invalid", 503),
    item = fields(r, ["target", "reason", "evidence_refs", "actor", "at", "base_result_hash"]),
    replacement = forecastObject(r.replacement, "forecast_release_invalid", 503);
  item.replacement = r.target === "category_ranges"
    ? { ranges: array(replacement.ranges).map((v) => fields(v, ["category", "lower", "upper"])) }
    : fields(
      replacement,
      r.target === "forecast_70" ? ["value", "unit"] : ["lower", "upper", "unit"],
    );
  return item;
}
export function forecastDraftDto(raw: unknown): NativeObject {
  const r = forecastObject(raw, "forecast_release_invalid", 503),
    c = forecastObject(r.context, "forecast_release_invalid", 503),
    validation = r.validation,
    approval = r.approval;
  return {
    format: "jungsi.forecast-draft/v1",
    draft_id: r.draft_id,
    offering_id: c.offering_id,
    revision: r.revision,
    status: r.status,
    base_result_hash: r.base_result_hash,
    policy_version: r.policy_version,
    context: fields(c, [
      "offering_id",
      "offering_lineage_id",
      "academic_year",
      "university_id",
      "campus",
      "department",
      "track",
      "group",
      "exam_id",
      "source_pack_version",
      "catalog_version",
      "analysis_version",
      "rule_id",
      "rule_version",
      "curve_version",
      "population_id",
      "score_scope",
      "score_scale_id",
      "bonus_treatment",
      "unit",
    ]),
    result: forecastResultDto(r.result),
    base_result: forecastResultDto(r.base_result),
    created_at: r.created_at,
    updated_at: r.updated_at,
    adjustments: array(r.adjustments).map(adjustmentDto),
    validation: forecastTruthy(validation)
      ? fields(validation, [
        "status",
        "reason_code",
        "checks",
        "validated_revision",
        "result_hash",
        "receipt_hash",
        "at",
      ])
      : null,
    approval: forecastTruthy(approval)
      ? fields(approval, [
        "approved_revision",
        "result_hash",
        "validation_hash",
        "approval_hash",
        "reason",
        "at",
      ])
      : null,
    audit_events: array(r.events).map((v) => fields(v, ["action", "actor", "at"])),
  };
}
export function pendingPublicForecast(offeringId: string, reason: string): NativeObject {
  return {
    format: "jungsi.forecast-public/v1",
    status: "pending",
    reason_code: reason,
    offering_id: offeringId,
    release_version: null,
    context: null,
    policy_version: null,
    input_version: null,
    forecast_70: null,
    expected_acceptance_range: null,
    category_ranges: [],
    basis_summary: null,
    issue_summaries: [],
    recommendation_reasons: [],
    adjustment_summary: { applied: false, reason: null, version: null },
  };
}
export function publishedForecastDto(raw: unknown): NativeObject {
  const r = forecastObject(raw, "forecast_release_invalid", 503),
    privateResult = forecastObject(r.result, "forecast_release_invalid", 503),
    result = forecastResultDto(privateResult),
    c = forecastObject(r.context, "forecast_release_invalid", 503),
    basis = array(privateResult.basis_summary).map((v) =>
      forecastObject(v, "forecast_release_invalid", 503)
    ),
    issues = array(privateResult.issue_summaries).map((v) =>
      forecastObject(v, "forecast_release_invalid", 503)
    ),
    adjustments = array(r.adjustments).map((v) =>
      forecastObject(v, "forecast_release_invalid", 503)
    );
  return {
    format: "jungsi.forecast-public/v1",
    status: "published",
    reason_code: null,
    offering_id: c.offering_id,
    release_version: r.release_id,
    context: publicForecastContext(c),
    policy_version: r.policy_version,
    input_version: r.input_version,
    forecast_70: result.forecast_70,
    expected_acceptance_range: result.acceptance_range,
    category_ranges: result.category_ranges,
    basis_summary:
      basis.map((v) => String(v.target) + ": 승인된 비교자료 및 정책 적용").join(" / ") || null,
    issue_summaries: issues.map((i) => ({
      issue_id: i.issue_id,
      title: Object.hasOwn(i, "title") ? i.title : i.issue_id,
      summary: i.explanation,
      numeric_effect_applied: false,
    })),
    recommendation_reasons: basis.map((v) => ({
      code: "approved_" + String(v.target),
      text: "승인된 " + String(v.target) + " 비교자료와 정책에 따라 기준을 산출했습니다.",
      evidence_refs: v.source_refs,
    })),
    adjustment_summary: {
      applied: adjustments.length > 0,
      reason: adjustments.map((a) => String(a.reason)).join(" / ") || null,
      version: adjustments.length ? r.release_id : null,
    },
  };
}
