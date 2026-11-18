/** Query saved exact tails. No profile loading, score/CDF rebuild, fitting or materialization. */
import { displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { JsonFloat } from "./native_json.ts";
import { nativeJsonText, type NativeObject } from "./json_value.ts";
export interface SavedReferenceProjectionPin {
  readonly sha256: string;
  readonly version?: string;
  readonly bytes: number;
  readonly maxBytes: number;
  /** Independently verified binder output identity, provided by the server selection. */
  readonly context: Readonly<NativeObject>;
  readonly evidence: Readonly<NativeObject>;
}
export interface AuthorizedSavedTailPin extends SavedReferenceProjectionPin {
  readonly key: string;
  readonly releaseSha256: string;
  readonly selectionSha256?: string;
  readonly compatibilitySha256: string;
  /** Public ID, physical PK and current catalog context are distinct fields. */
  readonly binding: Readonly<NativeObject>;
}
export interface AuthorizedSavedTailBytesPort {
  /** Selection must be independently authorized, never supplied by a client. */
  select(offeringId: string, signal: AbortSignal): Promise<AuthorizedSavedTailPin | null>;
  /** Must enforce the existing private storage byte/read/time budget and stop on abort. */
  read(key: string, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  /** Recheck current selected release, head, expiry, user and request admission. */
  assertCurrent(pin: AuthorizedSavedTailPin, signal: AbortSignal): Promise<void>;
  /** Verify exact source/model/exam/score-axis equivalence, not only pack version. */
  assertCompatible(
    pin: AuthorizedSavedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<void>;
  /** Independent current issuer only; absent means no saved-result disclosure proof. */
  verifiedProvenance?(
    pin: AuthorizedSavedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<Readonly<NativeObject>>;
}
const CONTEXT = [
  "academic_year",
  "exam_id",
  "exam_type",
  "source_pack_version",
  "model_version",
  "profile_sha256",
  "rule_version",
  "score_scale_id",
  "reference_curve_id",
  "weight_encoding",
  "source_scenario_field_present",
  "source_scenario_value",
  "resolved_model_scenario",
];
const EVIDENCE = [
  "source_csv_sha256",
  "source_cdf_sha256",
  "definition_sha256",
  "shared_proof_sha256",
  "binder_sha256",
  "independent_sha256",
];
function object(value: unknown, keys: readonly string[]): NativeObject {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    "reference_tail_invalid",
  );
  const o = value as NativeObject;
  check(
    Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k)),
    "reference_tail_invalid",
  );
  return o;
}
function uint(v: unknown): bigint {
  check(typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v), "reference_tail_invalid");
  return BigInt(v);
}
/** 점수 분자만 부호를 허용한다(강원대 한국사 감점 등 음수 환산점수, 11-17). 분모·가중치는 uint 그대로. */
function sint(v: unknown): bigint {
  check(typeof v === "string" && /^(0|-?[1-9][0-9]*)$/.test(v), "reference_tail_invalid");
  return BigInt(v);
}
// Scores keep their exact numerator/denominator; a Rational is built only for compared rows.
type Tail = { num: bigint; den: bigint; strict: bigint; tie: bigint; inclusive: bigint };
const scoreOf = (t: Tail): Rational => new Rational(t.num, t.den);
/** Exact a/b < c/d for positive denominators without gcd normalization. */
const before = (a: Tail, b: Tail): boolean =>
  a.den === b.den ? a.num < b.num : a.num * b.den < b.num * a.den;
export class SavedReferenceTailProjection {
  private constructor(
    private readonly context: Readonly<NativeObject>,
    private readonly rows: readonly Tail[],
    private readonly weightScale: number,
    private readonly whole: Rational,
    readonly methodId: string,
  ) {}
  static async bind(
    raw: Uint8Array,
    pin: SavedReferenceProjectionPin,
  ): Promise<SavedReferenceTailProjection> {
    check(
      Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && Number.isSafeInteger(pin.maxBytes) &&
        pin.maxBytes > 0 &&
        pin.maxBytes <= 8388608 && raw.length === pin.bytes && raw.length <= pin.maxBytes &&
        /^[a-f0-9]{64}$/.test(pin.sha256),
      "reference_tail_pin_invalid",
    );
    const bytes = Uint8Array.from(raw);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
    check(sha === pin.sha256, "reference_tail_pin_invalid");
    // SHA-pinned approved bytes. Every exact quantity is a decimal string (checked by uint()),
    // and the only numeric fields are checked as safe integers, so the platform parser keeps
    // exactness while avoiding the slower native-number parser on multi-MB tails (Edge CPU).
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      check(false, "reference_tail_invalid");
    }
    const p = object(decoded, [
      "format",
      "version",
      "context",
      "evidence",
      "projection",
      "rows",
    ]);
    check(
      p.format === "jungsi.saved-reference-tail-projection/v1" && typeof p.version === "string" &&
        (pin.version === undefined || p.version === pin.version),
      "reference_tail_invalid",
    );
    const c = object(p.context, CONTEXT), e = object(p.evidence, EVIDENCE);
    object(pin.context, CONTEXT);
    object(pin.evidence, EVIDENCE);
    check(
      nativeJsonText(c, true) === nativeJsonText(pin.context, true) &&
        nativeJsonText(e, true) === nativeJsonText(pin.evidence, true) &&
        EVIDENCE.every((k) => typeof e[k] === "string" && /^[a-f0-9]{64}$/.test(e[k] as string)) &&
        typeof c.profile_sha256 === "string" && /^[a-f0-9]{64}$/.test(c.profile_sha256),
      "reference_tail_context_mismatch",
    );
    check(
      typeof c.academic_year === "number" && Number.isSafeInteger(c.academic_year) &&
        [2024, 2025, 2026, 2027].includes(c.academic_year) &&
        ["csat", "june_mock", "september_mock"].includes(String(c.exam_type)) &&
        (c.academic_year !== 2027 || c.exam_type === "september_mock") &&
        typeof c.source_scenario_field_present === "boolean" &&
        (c.source_scenario_field_present
          ? c.source_scenario_value === c.resolved_model_scenario
          : c.source_scenario_value === null),
      "reference_tail_context_mismatch",
    );
    const a = object(p.projection, [
      "derived_method_id",
      "weight_decimal_scale",
      "eligible_weight_units",
      "whole_mass_decimal",
      "whole_mass_numerator",
      "whole_mass_denominator",
      "production_allowed",
      "actual_admission_full_total_approved",
    ]);
    check(
      a.production_allowed === false && a.actual_admission_full_total_approved === false &&
        typeof a.derived_method_id === "string" &&
        /^estimated-whole-cohort-percentile:[a-f0-9]{64}$/.test(a.derived_method_id) &&
        typeof a.whole_mass_decimal === "string" &&
        /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(a.whole_mass_decimal) &&
        typeof a.weight_decimal_scale === "number" &&
        Number.isSafeInteger(a.weight_decimal_scale) &&
        a.weight_decimal_scale >= 0 && a.weight_decimal_scale <= 1000,
      "reference_tail_invalid",
    );
    const whole = new Rational(uint(a.whole_mass_numerator), uint(a.whole_mass_denominator)),
      eligible = uint(a.eligible_weight_units);
    const scale = 10n ** BigInt(a.weight_decimal_scale);
    check(
      whole.compare(exact(0)) > 0 && whole.compare(exact(a.whole_mass_decimal)) === 0 &&
        eligible > 0n &&
        new Rational(eligible, scale).compare(whole) <= 0,
      "reference_tail_invalid",
    );
    check(
      Array.isArray(p.rows) && p.rows.length > 0 && p.rows.length <= 100000,
      "reference_tail_invalid",
    );
    const rows: Tail[] = p.rows.map((v) => {
      const r = object(v, [
        "score_numerator",
        "score_denominator",
        "strict_weight_units",
        "tie_weight_units",
        "inclusive_weight_units",
      ]);
      const num = sint(r.score_numerator),
        den = uint(r.score_denominator),
        strict = uint(r.strict_weight_units),
        tie = uint(r.tie_weight_units),
        inclusive = uint(r.inclusive_weight_units);
      check(
        den > 0n && tie > 0n && strict + tie === inclusive && inclusive <= eligible,
        "reference_tail_invalid",
      );
      return { num, den, strict, tie, inclusive };
    });
    check(
      rows[0].inclusive === eligible && rows[rows.length - 1].strict === 0n,
      "reference_tail_incomplete",
    );
    for (let i = 1; i < rows.length; i++) {
      check(
        before(rows[i - 1], rows[i]) && rows[i - 1].strict === rows[i].inclusive,
        "reference_tail_incomplete",
      );
    }
    return new SavedReferenceTailProjection(
      Object.freeze({ ...c }),
      Object.freeze(rows),
      a.weight_decimal_scale,
      whole,
      a.derived_method_id,
    );
  }
  query(score: Rational, identity: Readonly<NativeObject>): NativeObject | null {
    check(
      score instanceof Rational &&
        [
          "academic_year",
          "exam_id",
          "exam_type",
          "source_pack_version",
          "rule_version",
          "score_scale_id",
        ]
          .every((k) => identity[k] === this.context[k]),
      "reference_tail_context_mismatch",
    );
    // The existing evidence does not authorize extrapolation outside saved support.
    if (
      score.compare(scoreOf(this.rows[0])) < 0 ||
      score.compare(scoreOf(this.rows[this.rows.length - 1])) > 0
    ) return null;
    let lo = 0, hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (scoreOf(this.rows[mid]).compare(score) < 0) lo = mid + 1;
      else hi = mid;
    }
    const tail = this.rows[lo],
      mass = new Rational(tail.inclusive, 10n ** BigInt(this.weightScale));
    const percent = mass.multiply(exact(100)).divide(this.whole);
    // 대표님 결정(2026-11-16): 점수를 낼 수 없는 질량(전체-점수 정의)을 모두 위로 둔 상한도 함께 준다.
    const unscored = this.whole.subtract(
      new Rational(this.rows[0].inclusive, 10n ** BigInt(this.weightScale)),
    );
    const upper = mass.add(unscored).multiply(exact(100)).divide(this.whole);
    return {
      status: "reference_estimated",
      metric: "estimated_upper_cumulative_percent_all_examinees",
      estimated_upper_cumulative_percent_all_examinees: displayExact(percent, 12),
      estimated_upper_cumulative_percent_upper_bound: displayExact(upper, 12),
      derived_method_id: this.methodId,
      denominator_kind: "same_year_original_model_whole_exact_mass",
      reference_curve_id: this.context.reference_curve_id,
      exam_id: this.context.exam_id,
      exam_type: this.context.exam_type,
      calculation_review_scope: "same_exam_mathematical_reference",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    };
  }
}
