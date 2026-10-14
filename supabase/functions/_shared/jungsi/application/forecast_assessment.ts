/** Adopt an approved forecast without erasing independent successful conversion or tails. */
import { AccessError } from "./access.ts";
import {
  forecastDigest,
  forecastNumber,
  forecastObject,
  forecastRequire,
  forecastTruthy,
  validateForecastRanges,
} from "./forecast_calculation.ts";
import { forecastResultDto, publicForecastContext } from "./forecast_dto.ts";
import { blockedOffering, scoreEligibility } from "./offering_analysis.ts";
import type { StoredProfile } from "./platform_repository.ts";
import type { ScoringResult } from "./university_scoring.ts";
import type { PercentileResult } from "./university_percentile.ts";
import { exact, Rational } from "../domain/exact.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { type NativeJson } from "../domain/native_json.ts";
import { UNIVERSITY_MATCH_FIELDS } from "../domain/university_distribution.ts";
function array(v: unknown): NativeJson[] {
  forecastRequire(Array.isArray(v), "forecast_release_invalid", 409);
  return v;
}
function comparisonValue(
  calculated: Readonly<NativeObject>,
  conversion: ScoringResult,
  percentile: PercentileResult,
): Rational {
  const b = forecastObject(calculated.comparison_basis, "forecast_comparison_basis_missing", 409);
  forecastRequire(
    b.population_id === percentile.state.population_id &&
      b.score_scale_id === conversion.state.context.score_scale_id,
    "forecast_comparison_basis_mismatch",
    409,
  );
  if (b.metric === "converted_score") {
    forecastRequire(b.tie_policy === null, "forecast_tie_policy_mismatch", 409);
    forecastRequire(
      b.unit === "점" && b.direction === "higher_is_better",
      "forecast_comparison_basis_mismatch",
      409,
    );
    return conversion.state.score!;
  }
  if (b.metric === "university_top_percent") {
    forecastRequire(b.tie_policy === "include_equal", "forecast_tie_policy_mismatch", 409);
    forecastRequire(
      b.unit === "%" && b.direction === "lower_is_better",
      "forecast_comparison_basis_mismatch",
      409,
    );
    return percentile.state.inclusive!.multiply(exact(100));
  }
  throw new AccessError("forecast_comparison_metric_unsupported", 409);
}
export async function evaluateForecastRelease(
  offering: Readonly<NativeObject>,
  profile: StoredProfile,
  conversion: ScoringResult,
  percentile: PercentileResult,
  release: Readonly<NativeObject>,
  historicalMetrics: readonly NativeJson[] = [],
): Promise<NativeObject> {
  const c = conversion.state,
    p = percentile.state,
    result = blockedOffering(offering.offering_id, "forecast_release_missing");
  result.conversion = conversion.dto();
  result.percentile = percentile.dto();
  result.recommendation_reasons = conversion.ready ? cloneNativeJson([...c.explanations]) : [];
  result.converted_score = c.converted_score;
  result.converted_percentile = percentile.dto().top_percent;
  result.years = [2024, 2025, 2026, 2027].map((y) => ({
    academic_year: y,
    offering_id: y === offering.academic_year ? offering.offering_id : null,
    score_basis: y === offering.academic_year ? c.score_basis : "year_equated_estimate",
    converted_score: y === offering.academic_year ? c.converted_score : null,
    status: y === offering.academic_year && conversion.ready ? "ready" : "pending",
    reason_code: y === offering.academic_year && conversion.ready ? null : "year_bridge_required",
  }));
  const versions = forecastObject(result.versions);
  if (conversion.ready) {
    Object.assign(versions, {
      rule: c.rule_version,
      conversion: c.release_version,
      profile: profile.profile_id,
      pack: c.pack_version,
    });
  }
  try {
    const { release_hash: claimed, ...pinned } = cloneNativeJson(release);
    forecastRequire(
      claimed === await forecastDigest(pinned) && forecastTruthy(release.approval_hash) &&
        forecastTruthy(release.validation_hash),
      "forecast_release_invalid",
      409,
    );
    const context = forecastObject(release.context), calculated = forecastObject(release.result);
    forecastRequire(
      context.offering_id === offering.offering_id &&
        nativeJsonText(calculated.context, true) === nativeJsonText(context, true),
      "forecast_context_mismatch",
      409,
    );
    const dto = forecastResultDto(calculated),
      acceptance = forecastObject(dto.acceptance_range),
      forecast = forecastObject(dto.forecast_70),
      basis = array(calculated.basis_summary).map((r) => forecastObject(r)),
      issues = array(calculated.issue_summaries).map((r) => forecastObject(r)),
      adjustments = array(release.adjustments).map((r) => forecastObject(r));
    result.decision_evidence = {
      version: release.release_id,
      forecast_release_version: release.release_id,
      historical_metrics: cloneNativeJson([...historicalMetrics]),
      forecast_70: forecast,
      expected_acceptance_range: acceptance,
      basis_summary: basis.map((r) =>
        String(r.target) + ": 승인 비교자료 및 정책 적용"
      ).join(" / ") || null,
      issue_summaries: issues.map((i) => ({
        issue_id: i.issue_id,
        title: Object.hasOwn(i, "title") ? i.title : i.issue_id,
        summary: i.explanation,
        numeric_effect_applied: false,
      })),
      recommendation_reasons: basis.map((r) => ({
        code: "approved_" + String(r.target),
        text: "승인된 비교자료와 정책에 따라 기준을 산출했습니다.",
        evidence_refs: r.source_refs,
      })),
      adjustment_summary: {
        applied: adjustments.length > 0,
        reason: adjustments.map((a) => String(a.reason)).join(" / ") || null,
        version: adjustments.length ? release.release_id : null,
      },
    };
    Object.assign(result.decision_evidence, {
      context: publicForecastContext(context),
      policy_version: release.policy_version,
      input_version: release.input_version,
    });
    forecastRequire(conversion.ready, c.reason_code ?? "conversion_release_missing", 409);
    forecastRequire(percentile.ready, p.reason_code ?? "percentile_release_missing", 409);
    const actual = { ...p.context, ...c.context };
    forecastRequire(
      UNIVERSITY_MATCH_FIELDS.every((k) => Object.hasOwn(context, k) && context[k] === actual[k]) &&
        context.curve_version === p.curve_version,
      "forecast_context_mismatch",
      409,
    );
    forecastRequire(
      acceptance.status === "ready",
      acceptance.reason_code as string || "acceptance_evidence_missing",
      409,
    );
    const eligible = scoreEligibility(profile.scores, release.eligibility_policy);
    result.eligibility_status = eligible;
    if (eligible === "ineligible") {
      Object.assign(result, {
        status: "ineligible",
        category: "ineligible",
        reason_code: "eligibility_not_met",
      });
      return result;
    }
    forecastRequire(eligible === "eligible", "eligibility_confirmation_required", 409);
    const value = comparisonValue(calculated, conversion, percentile),
      rows = array(forecastObject(calculated.exact_values).category_ranges).map((r) =>
        forecastObject(r)
      );
    validateForecastRanges(rows);
    const matches = rows.filter((r) =>
      forecastNumber(r.lower).compare(value) <= 0 && value.compare(forecastNumber(r.upper)) < 0
    );
    forecastRequire(matches.length === 1, "decision_range_unconfirmed", 409);
    const baseResult = forecastObject(release.base_result),
      baseRows = array(forecastObject(baseResult.exact_values).category_ranges).map((r) =>
        forecastObject(r)
      );
    validateForecastRanges(baseRows);
    forecastRequire(
      nativeJsonText(baseResult.comparison_basis, true) ===
        nativeJsonText(calculated.comparison_basis, true),
      "forecast_comparison_basis_mismatch",
      409,
    );
    const base = baseRows.filter((r) =>
      forecastNumber(r.lower).compare(value) <= 0 && value.compare(forecastNumber(r.upper)) < 0
    );
    forecastRequire(base.length === 1, "decision_range_unconfirmed", 409);
    const adjusted = adjustments.length > 0, category = matches[0].category;
    Object.assign(result, {
      status: "ready",
      category,
      reason_code: null,
      decision_components: {
        base_category: base[0].category,
        adjusted_category: adjusted ? category : null,
        adopted_category: category,
        base_policy_version: release.policy_version,
        adjustment_version: adjusted ? release.release_id : null,
      },
    });
    const labels: Record<string, string> = {
      challenge: "도전",
      core: "핵심 검토",
      room: "여유 후보",
      outside: "추천 범위 밖",
    };
    (result.recommendation_reasons as NativeJson[]).push({
      code: "adopted_support_range",
      text: "이 모집행의 승인된 지원 검토 구간에서 " + labels[category as string] +
        "에 해당합니다.",
      evidence_refs: [release.release_id, release.policy_version],
    });
    Object.assign(versions, {
      forecast: release.release_id,
      decision: release.policy_version,
      curve: p.curve_version,
      population: p.population_id,
      eligibility: forecastObject(release.eligibility_policy).version,
      target_exam: p.exam_id,
      tie_policy: "include_equal",
    });
  } catch (e) {
    result.reason_code = e instanceof AccessError ? e.code : "forecast_release_invalid";
  }
  return result;
}
