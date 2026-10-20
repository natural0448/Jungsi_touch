/** Explicit whole-population estimate. The complete-response v1 contract stays separate. */
import { ContractError, displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { JsonFloat, parseNativeJson } from "./native_json.ts";
import { ExactFrequencyDistribution } from "./percentile.ts";
import { type NativeExamAnalysis, NativeExamPack, OVERALL_METRIC_ID } from "./exam_pack.ts";
import { utcInstant } from "./time.ts";

export const ALL_EXAMINEES_POPULATION_ID = "official_all_examinees";
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    "invalid_schema",
  );
  return value as Row;
}
function keys(value: Row, expected: string[]): void {
  check(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
    "invalid_schema",
  );
}
function text(value: unknown): string {
  check(typeof value === "string" && value.length > 0 && value.trim() === value, "invalid_text");
  return value;
}
function integer(value: unknown): number {
  check(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "invalid_integer");
  return value;
}
function weight(value: unknown): Rational {
  try {
    const result = exact(value instanceof JsonFloat ? value.lexeme : value);
    check(result.numerator >= 0n, "negative_weight");
    return result;
  } catch (e) {
    if (e instanceof ContractError && e.code === "negative_weight") throw e;
    throw new ContractError("invalid_weight");
  }
}
const POLICY_LITERALS: Readonly<Row> = Object.freeze({
  format: "jungsi.official-all-examinees-population-policy/v1",
  population_id: ALL_EXAMINEES_POPULATION_ID,
  denominator_basis: "same_exam_pack.participants.total",
  official_total_verified: true,
  joint_scores_observed: false,
  missing_scores: "model_imputation",
  estimate_basis: "estimated_not_observed",
  complete_semantics: "all_modeled_weights_accounted_not_observed_joint",
  observed_missing_value: null,
  internal_missing_sentinel: -1,
  total_point_curve: "conditional_band_grade_imputation",
  imputation_kind: "model_assumption_not_actual_score",
  missing_domain_subject_choice: "official_marginal_weighted_sampling_without_duplicate",
  inquiry_one_subject_extra_score: "modeled_counterfactual_second_subject",
  rank_bounds: "official_supported_score_domain_bounds_no_zero_substitution",
  official_n_is_not_complete_subject_intersection: true,
});
const POLICY_HASHES = [
  "official_population_decision_sha256",
  "source_model_config_sha256",
  "source_curve_sha256",
  "scenario_profiles_sha256",
  "independent_validation_sha256",
];
const HASH = /^[a-f0-9]{64}$/;
export class NativeAllExamineesTotalModel {
  readonly examId: string;
  readonly packVersion: string;
  readonly distributionId: string;
  readonly metadata: Readonly<Row>;
  readonly populationPolicy: Readonly<Row>;
  readonly expectedTotal: Rational;
  private readonly curve: ExactFrequencyDistribution;
  constructor(value: unknown) {
    const envelope = row(value);
    keys(envelope, [
      "format",
      "exam_id",
      "pack_version",
      "basis",
      "population_policy",
      "distribution",
    ]);
    check(envelope.format === "jungsi.exam-total-model/v2", "invalid_format");
    check(envelope.basis === "official_all_examinees_estimate", "model_basis_mismatch");
    this.examId = text(envelope.exam_id);
    this.packVersion = text(envelope.pack_version);
    const distribution = row(envelope.distribution);
    keys(distribution, ["format", "metadata", "rows"]);
    check(distribution.format === "total_score_frequency/v1", "invalid_format");
    const metadata = row(distribution.metadata);
    keys(metadata, [
      "distribution_id",
      "academic_year",
      "source_name",
      "source_date",
      "metric_id",
      "population_id",
      "kind",
      "status",
      "population_verified",
      "complete",
      "score_min",
      "score_max",
      "expected_total_weight",
    ]);
    this.distributionId = text(metadata.distribution_id);
    text(metadata.source_name);
    try {
      check(
        typeof metadata.source_date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(metadata.source_date),
        "invalid_source_date",
      );
      utcInstant(metadata.source_date + "T00:00:00Z");
    } catch {
      throw new ContractError("invalid_source_date");
    }
    check(integer(metadata.academic_year) > 0, "invalid_integer");
    check(metadata.metric_id === OVERALL_METRIC_ID, "metric_mismatch");
    check(metadata.population_id === ALL_EXAMINEES_POPULATION_ID, "population_mismatch");
    check(metadata.kind === "estimated_weights", "invalid_kind");
    check(
      ["synthetic", "reference", "approved"].includes(metadata.status as string),
      "invalid_status",
    );
    check(metadata.population_verified === false, "unobserved_joint_required");
    check(metadata.complete === true, "incomplete_distribution");
    const minimum = integer(metadata.score_min), maximum = integer(metadata.score_max);
    check(minimum <= maximum, "invalid_score_domain");
    this.expectedTotal = weight(metadata.expected_total_weight);
    check(
      this.expectedTotal.numerator > 0n && this.expectedTotal.denominator === 1n,
      "invalid_official_total",
    );
    const policy = row(envelope.population_policy);
    keys(policy, [
      ...Object.keys(POLICY_LITERALS),
      ...POLICY_HASHES,
      "official_total",
      "complete_response_profiles",
      "model_imputed_profiles",
      "scenario_id",
      "within_band_correlation",
      "scenario_selection_sha256",
    ]);
    check(
      Object.entries(POLICY_LITERALS).every(([k, v]) => policy[k] === v),
      "population_policy_mismatch",
    );
    const total = integer(policy.official_total),
      complete = integer(policy.complete_response_profiles),
      imputed = integer(policy.model_imputed_profiles);
    check(
      total > 0 && BigInt(total) === this.expectedTotal.numerator && complete <= total &&
        imputed <= total && BigInt(complete) + BigInt(imputed) === BigInt(total),
      "model_population_mismatch",
    );
    check(
      ["base", "lower_correlation", "higher_correlation"].includes(policy.scenario_id as string),
      "invalid_scenario",
    );
    const correlation = weight(policy.within_band_correlation);
    check(correlation.compare(exact(1)) <= 0, "invalid_correlation");
    check(
      POLICY_HASHES.every((k) => typeof policy[k] === "string" && HASH.test(policy[k] as string)),
      "invalid_policy_hash",
    );
    check(
      metadata.status === "approved"
        ? typeof policy.scenario_selection_sha256 === "string" &&
          HASH.test(policy.scenario_selection_sha256)
        : policy.scenario_selection_sha256 === null,
      "scenario_selection_required",
    );
    check(Array.isArray(distribution.rows), "invalid_schema");
    const rows = distribution.rows.map((item) => {
      const r = row(item);
      keys(r, ["total_score", "weight"]);
      const point = integer(r.total_score);
      check(point >= minimum && point <= maximum, "score_outside_domain");
      return { score: point, weight: weight(r.weight) };
    });
    this.curve = new ExactFrequencyDistribution(rows, this.expectedTotal, false);
    this.metadata = Object.freeze({
      ...metadata,
      expected_total_weight: this.expectedTotal.toString(),
    });
    this.populationPolicy = Object.freeze({
      ...policy,
      within_band_correlation: correlation.toString(),
    });
    Object.freeze(this);
  }
  static fromJson(text: string): NativeAllExamineesTotalModel {
    return new NativeAllExamineesTotalModel(parseNativeJson(text));
  }
  calculate(pack: NativeExamPack, analysis: NativeExamAnalysis): Row {
    check(pack.examId === this.examId, "model_exam_mismatch");
    check(pack.packVersion === this.packVersion, "model_pack_mismatch");
    check(
      this.expectedTotal.compare(exact(pack.officialParticipantTotal())) === 0,
      "model_population_mismatch",
    );
    check(this.metadata.academic_year === pack.academicYear, "academic_year_mismatch");
    check(this.metadata.status === "approved", "model_not_ready");
    check(
      analysis.totalStandardScore >= (this.metadata.score_min as number) &&
        analysis.totalStandardScore <= (this.metadata.score_max as number),
      "score_outside_domain",
    );
    const result = this.curve.calculate(analysis.totalStandardScore, "include_equal", 6);
    const inclusive = displayExact(result.inclusive.multiply(exact(100)), 6),
      exclusive = displayExact(result.exclusive.multiply(exact(100)), 6);
    return {
      status: "estimated",
      top_percent: result.topPercent,
      inclusive_top_percent: inclusive,
      exclusive_top_percent: exclusive,
      tie_share_percent: result.tieSharePercent,
      tie_policy: "include_equal",
      population_id: ALL_EXAMINEES_POPULATION_ID,
      tie_interval_percent: { lower: exclusive, upper: inclusive },
      reason_code: null,
      model_version: this.distributionId,
      data_kind: "estimated_weights",
    };
  }
}
