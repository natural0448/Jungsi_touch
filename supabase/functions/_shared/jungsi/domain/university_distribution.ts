/** Exact university converted-score distributions; whole population and partial populations stay distinct. */
import { ContractError, displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { cloneNativeJson, type NativeObject } from "./json_value.ts";
import { JsonFloat, type NativeJson } from "./native_json.ts";
export const UNIVERSITY_SCORE_METRIC = "university_converted_csat_score";
export const UNIVERSITY_MATCH_FIELDS = [
  "academic_year",
  "exam_id",
  "rule_id",
  "rule_version",
  "score_scope",
  "score_scale_id",
  "bonus_treatment",
  "population_id",
] as const;
function row(v: unknown): NativeObject {
  check(
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat),
    "INVALID_CURVE_SCHEMA",
  );
  return v as NativeObject;
}
function required(r: Readonly<NativeObject>, key: string): NativeJson {
  check(Object.hasOwn(r, key), "INVALID_CURVE_SCHEMA");
  return r[key];
}
function frozen<T extends NativeJson>(v: T): T {
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) v.forEach(frozen);
    else if (!(v instanceof JsonFloat)) Object.values(v).forEach(frozen);
    Object.freeze(v);
  }
  return v;
}
export function universityNumber(value: unknown): Rational {
  return exact(value instanceof JsonFloat ? value.lexeme : value);
}
/** v2 scores are explicit native integer pairs; v1 decimals keep their existing meaning. */
function rationalCurveScore(value: unknown): Rational {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    "INVALID_RATIONAL_SCORE",
  );
  const r = value as NativeObject;
  const integer = (v: unknown): v is number | bigint =>
    typeof v === "bigint" || typeof v === "number" && Number.isSafeInteger(v);
  check(
    Object.keys(r).sort().join(",") === "denominator,numerator" &&
      integer(r.numerator) && integer(r.denominator) && r.denominator > 0,
    "INVALID_RATIONAL_SCORE",
  );
  return new Rational(BigInt(r.numerator), BigInt(r.denominator));
}
function ratio(v: Rational): NativeObject {
  return { numerator: v.numerator, denominator: v.denominator };
}
export interface PublicationInterval {
  readonly lower: Rational;
  readonly upper: Rational;
  readonly includeLower: boolean;
  readonly includeUpper: boolean;
}
export function publicationInterval(score: Rational, precision: unknown): PublicationInterval {
  check(
    precision !== null && typeof precision === "object" && !Array.isArray(precision) &&
      !(precision instanceof JsonFloat),
    "PRECISION_REQUIRED",
  );
  const p = precision as NativeObject, mode = p.mode;
  check(
    ["exact", "half_up", "floor", "ceil", "truncate"].includes(mode as string),
    "ROUNDING_UNCONFIRMED",
  );
  if (mode === "exact") {
    return { lower: score, upper: score, includeLower: true, includeUpper: true };
  }
  const places = p.places;
  check(
    typeof places === "number" && Number.isSafeInteger(places) && places >= 0 && places <= 8,
    "INVALID_PRECISION",
  );
  const step = new Rational(1n, 10n ** BigInt(places));
  check(score.divide(step).denominator === 1n, "PRECISION_MISMATCH");
  const sign = score.compare(exact(0));
  if (mode === "half_up") {
    const half = step.divide(exact(2));
    return {
      lower: score.subtract(half),
      upper: score.add(half),
      includeLower: sign > 0,
      includeUpper: sign < 0,
    };
  }
  if (mode === "floor" || mode === "truncate" && sign > 0) {
    return { lower: score, upper: score.add(step), includeLower: true, includeUpper: false };
  }
  if (mode === "ceil" || mode === "truncate" && sign < 0) {
    return { lower: score.subtract(step), upper: score, includeLower: false, includeUpper: true };
  }
  return { lower: exact(0).subtract(step), upper: step, includeLower: false, includeUpper: false };
}
export class NativeUniversityScoreDistribution {
  readonly data: Readonly<NativeObject>;
  readonly metadata: Readonly<NativeObject>;
  readonly minimum: Rational;
  readonly maximum: Rational;
  readonly total: Rational;
  private readonly bins: readonly { readonly score: Rational; readonly weight: Rational }[];
  constructor(value: unknown) {
    try {
      const d = cloneNativeJson(row(value));
      const rationalScores = d.format === "jungsi.university-score-distribution/v2";
      check(
        d.format === "jungsi.university-score-distribution/v1" || rationalScores,
        "INVALID_CURVE_FORMAT",
      );
      const m = row(required(d, "metadata")), year = required(m, "academic_year");
      if (rationalScores) {
        check(m.score_representation === "rational_integer_pair", "INVALID_SCORE_REPRESENTATION");
      }
      const scoreNumber = rationalScores ? rationalCurveScore : universityNumber;
      check(
        typeof year === "number" && Number.isSafeInteger(year) &&
          [2024, 2025, 2026, 2027].includes(year),
        "INVALID_YEAR",
      );
      check(
        required(m, "score_metric") === UNIVERSITY_SCORE_METRIC &&
          required(m, "score_scope") === "csat_component",
        "SCORE_SCOPE_MISMATCH",
      );
      check(
        ["included", "excluded"].includes(required(m, "bonus_treatment") as string),
        "BONUS_UNCONFIRMED",
      );
      for (
        const key of [
          "curve_id",
          "curve_version",
          "exam_id",
          "rule_id",
          "rule_version",
          "score_scale_id",
          "population_id",
          "population_definition",
          "source_model_id",
          "source_model_version",
        ]
      ) {
        const v = required(m, key);
        check(typeof v === "string" && v.length > 0, "CURVE_METADATA_REQUIRED");
      }
      check(
        ["research", "reviewed", "approved"].includes(required(m, "status") as string),
        "INVALID_STATUS",
      );
      check(
        ["draft", "source_verified", "calculation_verified"].includes(
          required(m, "rule_review_status") as string,
        ),
        "INVALID_RULE_STATUS",
      );
      check(
        m.status !== "approved" || m.rule_review_status === "calculation_verified",
        "RULE_NOT_APPROVED",
      );
      check(
        typeof required(m, "complete") === "boolean" &&
          typeof required(m, "population_verified") === "boolean",
        "INVALID_METADATA",
      );
      check(m.complete === true, "INCOMPLETE_CURVE");
      check(m.status !== "approved" || m.population_verified === true, "POPULATION_UNVERIFIED");
      check(
        ["observed_counts", "estimated_weights"].includes(required(m, "kind") as string),
        "INVALID_KIND",
      );
      check(
        Array.isArray(required(d, "source_refs")) && (d.source_refs as NativeJson[]).length > 0,
        "SOURCE_REQUIRED",
      );
      this.minimum = scoreNumber(required(m, "score_min"));
      this.maximum = scoreNumber(required(m, "score_max"));
      check(this.minimum.compare(this.maximum) <= 0, "INVALID_DOMAIN");
      check(
        Array.isArray(required(d, "frequencies")) && (d.frequencies as NativeJson[]).length > 0,
        "EMPTY_CURVE",
      );
      const bins = new Map<string, { score: Rational; weight: Rational }>();
      for (const raw of d.frequencies as NativeJson[]) {
        const r = row(raw),
          score = scoreNumber(required(r, "converted_score")),
          weight = universityNumber(required(r, "weight"));
        check(!bins.has(score.toString()), "DUPLICATE_SCORE");
        check(weight.compare(exact(0)) > 0, "INVALID_WEIGHT");
        check(
          score.compare(this.minimum) >= 0 && score.compare(this.maximum) <= 0,
          "INVALID_DOMAIN",
        );
        check(m.kind !== "observed_counts" || weight.denominator === 1n, "FRACTIONAL_COUNT");
        bins.set(score.toString(), { score, weight });
      }
      this.bins = Object.freeze(
        [...bins.values()].sort((a, b) => a.score.compare(b.score)).map((v) => Object.freeze(v)),
      );
      check(
        this.bins[0].score.compare(this.minimum) === 0 &&
          this.bins.at(-1)!.score.compare(this.maximum) === 0,
        "DOMAIN_MISMATCH",
      );
      this.total = this.bins.reduce((a, b) => a.add(b.weight), exact(0));
      check(
        this.total.compare(universityNumber(required(m, "expected_total_weight"))) === 0,
        "WEIGHT_MISMATCH",
      );
      this.data = frozen(d);
      this.metadata = m;
      Object.freeze(this);
    } catch (e) {
      if (e instanceof ContractError) throw e;
      throw new ContractError("INVALID_CURVE_SCHEMA");
    }
  }
  tail(threshold: Rational, inclusive: boolean): Rational {
    check(threshold instanceof Rational && typeof inclusive === "boolean", "INVALID_NUMBER");
    return this.bins.reduce((a, b) => {
      const c = b.score.compare(threshold);
      return c > 0 || inclusive && c === 0 ? a.add(b.weight) : a;
    }, exact(0)).divide(this.total);
  }
  lookup(input: unknown, research = false): NativeObject {
    const r = row(input), m = this.metadata;
    check(research === true || m.status === "approved", "CURVE_NOT_APPROVED");
    check(r.score_metric === UNIVERSITY_SCORE_METRIC, "SCORE_METRIC_MISMATCH");
    for (const key of UNIVERSITY_MATCH_FIELDS) {
      check((r[key] ?? null) === required(m, key), "CONTEXT_MISMATCH");
    }
    const score = universityNumber(required(r, "score_value")),
      p = publicationInterval(score, r.publication_precision);
    let { lower, upper, includeLower, includeUpper } = p;
    check(
      (upper.compare(this.minimum) > 0 || upper.compare(this.minimum) === 0 && includeUpper) &&
        (lower.compare(this.maximum) < 0 || lower.compare(this.maximum) === 0 && includeLower),
      "CUTOFF_OUTSIDE_DOMAIN",
    );
    if (lower.compare(this.minimum) < 0) {
      lower = this.minimum;
      includeLower = true;
    }
    if (upper.compare(this.maximum) > 0) {
      upper = this.maximum;
      includeUpper = true;
    }
    const exclusive = this.tail(score, false),
      inclusive = this.tail(score, true),
      lo = this.tail(upper, !includeUpper),
      hi = this.tail(lower, includeLower);
    return {
      at_reported_score: {
        strictly_above_percent: displayExact(exclusive.multiply(exact(100))),
        above_or_equal_percent: displayExact(inclusive.multiply(exact(100))),
        strictly_above_ratio: ratio(exclusive),
        above_or_equal_ratio: ratio(inclusive),
      },
      upper_percentile_range: {
        lower_percent: displayExact(lo.multiply(exact(100))),
        upper_percent: displayExact(hi.multiply(exact(100))),
        lower_ratio: ratio(lo),
        upper_ratio: ratio(hi),
        meaning: "동점자 및 발표 반올림에 따른 범위; 통계적 신뢰구간 아님",
      },
      latent_score_interval: {
        lower: ratio(lower),
        upper: ratio(upper),
        include_lower: includeLower,
        include_upper: includeUpper,
      },
      curve_id: m.curve_id,
      curve_version: m.curve_version,
      source_model_id: m.source_model_id,
      source_model_version: m.source_model_version,
      population_id: m.population_id,
      population_definition: m.population_definition,
      data_kind: m.kind,
      output_status: m.status === "approved" && !research ? "service_ready" : "research_only",
    };
  }
}
