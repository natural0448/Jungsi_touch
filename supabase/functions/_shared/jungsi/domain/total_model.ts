/** Approved same-exam four-score distribution, using the retained exact kernel. */
import { ContractError, displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { JsonFloat, parseNativeJson } from "./native_json.ts";
import { ExactFrequencyDistribution } from "./percentile.ts";
import {
  type NativeExamAnalysis,
  NativeExamPack,
  OVERALL_METRIC_ID,
  OVERALL_POPULATION_ID,
} from "./exam_pack.ts";
import { utcInstant } from "./time.ts";

type Row = Record<string, unknown>;
function row(value: unknown): Row {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    "invalid_schema",
  );
  return value as Row;
}
function keys(r: Row, expected: string[]): void {
  check(
    Object.keys(r).length === expected.length && expected.every((k) => Object.hasOwn(r, k)),
    "invalid_schema",
  );
}
function text(value: unknown): string {
  check(typeof value === "string" && value.trim(), "invalid_text");
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
export class NativeExamTotalModel {
  readonly examId: string;
  readonly packVersion: string;
  readonly distributionId: string;
  readonly metadata: Readonly<Row>;
  readonly expectedTotal: Rational;
  private readonly curve: ExactFrequencyDistribution;
  constructor(value: unknown) {
    const envelope = row(value);
    keys(envelope, ["format", "exam_id", "pack_version", "basis", "distribution"]);
    check(envelope.format === "jungsi.exam-total-model/v1", "invalid_format");
    check(envelope.basis === "exam_population", "model_basis_mismatch");
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
          /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(metadata.source_date),
        "invalid_source_date",
      );
      utcInstant(metadata.source_date + "T00:00:00Z");
    } catch {
      throw new ContractError("invalid_source_date");
    }
    check(integer(metadata.academic_year) >= 1, "invalid_integer");
    check(metadata.metric_id === OVERALL_METRIC_ID, "metric_mismatch");
    check(metadata.population_id === OVERALL_POPULATION_ID, "population_mismatch");
    check(
      ["observed_counts", "estimated_weights"].includes(metadata.kind as string),
      "invalid_kind",
    );
    check(
      ["synthetic", "reference", "approved"].includes(metadata.status as string),
      "invalid_status",
    );
    check(
      typeof metadata.complete === "boolean" && typeof metadata.population_verified === "boolean",
      "invalid_metadata",
    );
    check(metadata.complete, "incomplete_distribution");
    check(
      metadata.status !== "approved" || metadata.population_verified === true,
      "unverified_population",
    );
    const minimum = integer(metadata.score_min), maximum = integer(metadata.score_max);
    check(minimum <= maximum, "invalid_score_domain");
    this.expectedTotal = weight(metadata.expected_total_weight);
    check(this.expectedTotal.numerator > 0n, "empty_population");
    const observed = metadata.kind === "observed_counts";
    if (observed) check(this.expectedTotal.denominator === 1n, "fractional_count");
    check(Array.isArray(distribution.rows), "invalid_schema");
    const rows = distribution.rows.map((item) => {
      const r = row(item);
      keys(r, ["total_score", "weight"]);
      const point = integer(r.total_score);
      check(point >= minimum && point <= maximum, "score_outside_domain");
      return { score: point, weight: weight(r.weight) };
    });
    this.curve = new ExactFrequencyDistribution(rows, this.expectedTotal, observed);
    this.metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }
  static fromJson(text: string): NativeExamTotalModel {
    return new NativeExamTotalModel(parseNativeJson(text));
  }
  calculate(pack: NativeExamPack, analysis: NativeExamAnalysis): Row {
    check(pack.examId === this.examId, "model_exam_mismatch");
    check(pack.packVersion === this.packVersion, "model_pack_mismatch");
    const population = pack.populationBounds();
    check(
      this.expectedTotal.compare(exact(population.lower)) >= 0 &&
        this.expectedTotal.compare(exact(population.upper)) <= 0 &&
        (population.count === null || this.expectedTotal.compare(exact(population.count)) === 0),
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
      status: this.metadata.kind === "estimated_weights" ? "estimated" : "observed",
      top_percent: result.topPercent,
      inclusive_top_percent: inclusive,
      exclusive_top_percent: exclusive,
      tie_share_percent: result.tieSharePercent,
      tie_policy: "include_equal",
      population_id: OVERALL_POPULATION_ID,
      tie_interval_percent: { lower: exclusive, upper: inclusive },
      reason_code: null,
      model_version: this.distributionId,
      data_kind: this.metadata.kind,
    };
  }
}
