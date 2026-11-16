/** Stream the already stored native CDF without re-uploading or materializing its frequency array.
 * Owner/report, current DB head and model/exam compatibility remain issuer responsibilities. */
import { displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { JsonFloat, parseNativeJson } from "./native_json.ts";
import type { NativeObject } from "./json_value.ts";
const HASH = /^[0-9a-f]{64}$/,
  METHOD = /^estimated-whole-cohort-percentile:[0-9a-f]{64}$/,
  MAX = 9223372036854775807n;
const FIELD = "frequencies_numerator_integer_weight", MAX_SOURCE = 8388608, MAX_SUPPORT = 125000;
const IDS = [
  "academic_year",
  "exam_id",
  "exam_type",
  "source_pack_version",
  "rule_version",
  "score_scale_id",
  "offering_id",
] as const;
export interface NativeCdfPin {
  readonly sourceSha256: string;
  readonly sourceBytes: number;
  readonly methodId: string;
  readonly year: number;
  readonly examId: string;
  readonly examType: string;
  readonly sourcePackVersion: string;
  readonly modelPackSha256: string;
  readonly ruleVersion: string;
  readonly sourceRuleId?: string;
  readonly scoreScaleId: string;
  readonly offeringId: string;
  readonly maximumSupportRows: number;
}
function obj(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function uint(v: unknown): bigint {
  check(typeof v === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v), "reference_tail_invalid");
  const n = BigInt(v);
  check(n <= MAX, "reference_tail_invalid");
  return n;
}
function nativeUint(v: unknown): bigint {
  check(
    (typeof v === "number" && Number.isSafeInteger(v)) || typeof v === "bigint",
    "reference_tail_invalid",
  );
  const n = BigInt(v as number | bigint);
  check(n >= 0n && n <= MAX, "reference_tail_invalid");
  return n;
}
function live(s: AbortSignal): void {
  check(!!s && !s.aborted, "reference_tail_unavailable");
}
async function sha(raw: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(raw)))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
function space(c: string): boolean {
  return c === " " || c === "\n" || c === "\r" || c === "\t";
}
function skip(s: string, i: number): number {
  while (i < s.length && space(s[i])) i++;
  return i;
}
function numberEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
  check(j > i && j - i <= 19 && !(j - i > 1 && s[i] === "0"), "reference_tail_invalid");
  return j;
}
function quotedEnd(s: string, i: number): number {
  check(s[i] === '"', "reference_tail_invalid");
  i++;
  for (; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === '"') return i + 1;
  }
  check(false, "reference_tail_invalid");
}
/** Locate the exact top-level key, ignoring escaped strings and nested lookalikes. */
function startFrequency(s: string): number {
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      const end = quotedEnd(s, i), next = skip(s, end);
      if (depth === 1 && s[next] === ":" && JSON.parse(s.slice(i, end)) === FIELD) {
        check(start < 0, "reference_tail_invalid");
        start = skip(s, next + 1);
      }
      i = end - 1;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    check(depth >= 0, "reference_tail_invalid");
  }
  check(depth === 0 && start >= 0 && s[start] === "[", "reference_tail_invalid");
  return start;
}
type Anchor = { offset: number; score: bigint; before: bigint };
type Summary = {
  end: number;
  count: number;
  first: bigint;
  last: bigint;
  total: bigint;
  inclusive: bigint;
};
/** Iterates one row at a time and yields to cancellation; it never allocates a 100k-row array. */
async function scan(
  s: string,
  start: number,
  limit: number,
  signal: AbortSignal,
  target?: Rational,
  denominator = 1n,
  anchors?: Anchor[],
): Promise<Summary> {
  live(signal);
  check(s[start] === "[", "reference_tail_invalid");
  let i = skip(s, start + 1), count = 0, first = 0n, last = -1n, total = 0n, inclusive = 0n;
  if (s[i] === "]") check(false, "reference_tail_invalid");
  while (i < s.length) {
    const offset = i;
    check(s[i] === "[", "reference_tail_invalid");
    i = skip(s, i + 1);
    const nEnd = numberEnd(s, i), n = uint(s.slice(i, nEnd));
    i = skip(s, nEnd);
    check(s[i] === ",", "reference_tail_invalid");
    i = skip(s, i + 1);
    check(s[i] === '"', "reference_tail_invalid");
    const wEnd = numberEnd(s, i + 1);
    check(s[wEnd] === '"', "reference_tail_invalid");
    const w = uint(s.slice(i + 1, wEnd));
    i = skip(s, wEnd + 1);
    check(s[i] === "]" && w > 0n && n > last, "reference_tail_invalid");
    i = skip(s, i + 1);
    if (!count) first = n;
    last = n;
    if (anchors && (count % 2048) === 0) anchors.push({ offset, score: n, before: total });
    total += w;
    count++;
    check(count <= limit && total <= MAX, "reference_tail_invalid");
    if (target && n * target.denominator >= target.numerator * denominator) inclusive += w;
    if ((count & 4095) === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      live(signal);
    }
    if (s[i] === "]") return { end: i + 1, count, first, last, total, inclusive };
    check(s[i] === ",", "reference_tail_invalid");
    i = skip(s, i + 1);
  }
  check(false, "reference_tail_invalid");
}
/** Binary-search a sparse in-memory index, then inspect at most one 2,048-row block. */
function inclusiveAt(
  s: string,
  anchors: readonly Anchor[],
  eligible: bigint,
  target: Rational,
  denominator: bigint,
): bigint {
  let lo = 0, hi = anchors.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (anchors[mid].score * target.denominator <= target.numerator * denominator) lo = mid + 1;
    else hi = mid;
  }
  const anchor = anchors[Math.max(0, lo - 1)];
  let i = anchor.offset, before = anchor.before;
  for (let count = 0; count <= 2048; count++) {
    check(s[i] === "[", "reference_tail_invalid");
    i = skip(s, i + 1);
    const nEnd = numberEnd(s, i), n = uint(s.slice(i, nEnd));
    i = skip(s, nEnd);
    check(s[i] === ",", "reference_tail_invalid");
    i = skip(s, i + 1);
    check(s[i] === '"', "reference_tail_invalid");
    const wEnd = numberEnd(s, i + 1);
    check(s[wEnd] === '"', "reference_tail_invalid");
    const w = uint(s.slice(i + 1, wEnd));
    i = skip(s, wEnd + 1);
    check(s[i] === "]" && w > 0n, "reference_tail_invalid");
    i = skip(s, i + 1);
    if (n * target.denominator >= target.numerator * denominator) return eligible - before;
    before += w;
    check(s[i] === ",", "reference_tail_invalid");
    i = skip(s, i + 1);
  }
  check(false, "reference_tail_invalid");
}
export class NativeReferenceCdfProjection {
  private readonly results = new Map<string, readonly [string, string]>();
  private constructor(
    private readonly text: string,
    private readonly start: number,
    private readonly pin: Readonly<NativeCdfPin>,
    private readonly denominator: bigint,
    private readonly scale: number,
    private readonly whole: Rational,
    private readonly min: bigint,
    private readonly max: bigint,
    private readonly eligible: bigint,
    private readonly anchors: readonly Anchor[],
    readonly methodId: string,
    private readonly curveId: string,
  ) {}
  /** raw and method must already come from the current selected DB head and trusted server issuer. */
  static async bind(
    raw: Uint8Array,
    pin: Readonly<NativeCdfPin>,
    method: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<NativeReferenceCdfProjection> {
    live(signal);
    check(
      raw instanceof Uint8Array && HASH.test(pin.sourceSha256) && raw.length === pin.sourceBytes &&
        raw.length > 0 && raw.length <= MAX_SOURCE &&
        METHOD.test(pin.methodId) && Number.isSafeInteger(pin.maximumSupportRows) &&
        pin.maximumSupportRows > 0 && pin.maximumSupportRows <= MAX_SUPPORT &&
        Number.isSafeInteger(pin.year) && pin.year >= 2024 && pin.year <= 2027 &&
        HASH.test(pin.modelPackSha256),
      "reference_tail_invalid",
    );
    check(await sha(raw) === pin.sourceSha256, "reference_tail_pin_invalid");
    live(signal);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      check(false, "reference_tail_invalid");
    }
    const start = startFrequency(text),
      anchors: Anchor[] = [],
      values = await scan(text, start, pin.maximumSupportRows, signal, undefined, 1n, anchors);
    let doc: unknown;
    try {
      doc = parseNativeJson(text.slice(0, start) + "[]" + text.slice(values.end));
    } catch {
      check(false, "reference_tail_invalid");
    }
    check(
      obj(doc) && obj(doc.model_references) && obj(doc.model_references.pack) && obj(method) &&
        obj(method.native_score_and_source_definition_metadata) && obj(method.binding) &&
        obj(method.binding.projection_arguments),
      "reference_tail_invalid",
    );
    const meta = method.native_score_and_source_definition_metadata,
      args = method.binding.projection_arguments;
    // The selected evidence may pin the original source rule separately from the calculator version.
    // Older selections keep the stricter equality with ruleVersion.
    const sourceRuleId = pin.sourceRuleId ?? pin.ruleVersion;
    check(
      typeof sourceRuleId === "string" && sourceRuleId.length > 0 && sourceRuleId.length <= 512,
      "reference_tail_invalid",
    );
    check(
      method.method_id === pin.methodId &&
        method.metric === "estimated_upper_cumulative_percent_all_examinees" &&
        meta.academic_year === pin.year && doc.academic_year === pin.year &&
        doc.exam_id === pin.examId && doc.exam_type === pin.examType &&
        doc.source_rule_id === sourceRuleId && meta.source_rule_id === sourceRuleId &&
        doc.model_references.pack.sha256 === pin.modelPackSha256 &&
        doc.engine_approved === false && doc.production_allowed === false &&
        meta.engine_approved === false &&
        (pin.year !== 2027 ||
          (doc.exam_type === "september_mock" &&
            doc.data_kind === "fixed_mock_model_reference_not_actual_admission" &&
            doc.actual_2027_csat_available === false)) &&
        typeof meta.reference_curve_id === "string" &&
        args.expected_curve_id === meta.reference_curve_id &&
        doc.support_bin_count === values.count &&
        doc.eligible_weight_units === args.eligible_weight_units &&
        doc.weight_decimal_scale === args.weight_decimal_scale &&
        doc.whole_model_weight === args.whole_model_weight_decimal &&
        doc.score_denominator === meta.score_denominator,
      "reference_tail_context_mismatch",
    );
    const den = nativeUint(doc.score_denominator), eligible = uint(doc.eligible_weight_units);
    check(
      den > 0n && eligible === values.total && typeof doc.weight_decimal_scale === "number" &&
        Number.isSafeInteger(doc.weight_decimal_scale) &&
        doc.weight_decimal_scale >= 0 && doc.weight_decimal_scale <= 1000 &&
        typeof doc.whole_model_weight === "string",
      "reference_tail_invalid",
    );
    const whole = exact(doc.whole_model_weight), scale = doc.weight_decimal_scale;
    check(
      whole.compare(exact(0)) > 0 &&
        whole.compare(new Rational(uint(doc.whole_model_weight_units), 10n ** BigInt(scale))) ===
          0 &&
        new Rational(eligible, 10n ** BigInt(scale)).compare(whole) <= 0,
      "reference_tail_invalid",
    );
    return new NativeReferenceCdfProjection(
      text,
      start,
      Object.freeze({ ...pin }),
      den,
      scale,
      whole,
      values.first,
      values.last,
      eligible,
      Object.freeze(anchors),
      pin.methodId,
      meta.reference_curve_id,
    );
  }
  query(
    score: Rational,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<NativeObject | null> {
    try {
      live(signal);
      check(
        score instanceof Rational && obj(identity) && IDS.every((k) =>
          identity[k] === ({
            academic_year: this.pin.year,
            exam_id: this.pin.examId,
            exam_type: this.pin.examType,
            source_pack_version: this.pin.sourcePackVersion,
            rule_version: this.pin.ruleVersion,
            score_scale_id: this.pin.scoreScaleId,
            offering_id: this.pin.offeringId,
          })[k]
        ),
        "reference_tail_context_mismatch",
      );
      if (
        score.numerator * this.denominator < this.min * score.denominator ||
        score.numerator * this.denominator > this.max * score.denominator
      ) return Promise.resolve(null);
      const key = score.toString();
      let pair = this.results.get(key);
      if (pair === undefined) {
        const inclusive = inclusiveAt(
          this.text,
          this.anchors,
          this.eligible,
          score,
          this.denominator,
        );
        const mass = new Rational(inclusive, 10n ** BigInt(this.scale));
        // 대표님 결정(2026-11-16): 점수를 낼 수 없는 질량을 모두 위로 둔 상한도 함께 계산
        const unscored = this.whole.subtract(
          new Rational(this.eligible, 10n ** BigInt(this.scale)),
        );
        pair = [
          displayExact(mass.multiply(exact(100)).divide(this.whole), 12),
          displayExact(mass.add(unscored).multiply(exact(100)).divide(this.whole), 12),
        ] as const;
        if (this.results.size < 64) this.results.set(key, pair);
      }
      live(signal);
      return Promise.resolve({
        status: "reference_estimated",
        metric: "estimated_upper_cumulative_percent_all_examinees",
        estimated_upper_cumulative_percent_all_examinees: pair[0],
        estimated_upper_cumulative_percent_upper_bound: pair[1],
        derived_method_id: this.methodId,
        denominator_kind: "same_year_original_model_whole_exact_mass",
        reference_curve_id: this.curveId,
        exam_id: this.pin.examId,
        exam_type: this.pin.examType,
        calculation_review_scope: "same_exam_mathematical_reference",
        production_allowed: false,
        actual_admission_full_total_approved: false,
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
