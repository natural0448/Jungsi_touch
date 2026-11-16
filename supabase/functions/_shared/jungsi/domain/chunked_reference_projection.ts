/** Review-only two-stage saved-tail reader. Authorization and shared request budget remain caller-owned. */
import { displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { JsonFloat, parseNativeJson } from "./native_json.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "./json_value.ts";
import type {
  AuthorizedSavedTailBytesPort,
  AuthorizedSavedTailPin,
} from "./saved_reference_projection.ts";

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
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 8388608;
const MAX_U64 = 9223372036854775807n;
function obj(value: unknown, keys: readonly string[]): NativeObject {
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
  check(
    typeof v === "string" && v.length <= 19 && /^(0|[1-9][0-9]*)$/.test(v),
    "reference_tail_invalid",
  );
  const n = BigInt(v);
  check(n <= MAX_U64, "reference_tail_invalid");
  return n;
}
function nativeUint(v: unknown): bigint {
  check(
    (typeof v === "number" && Number.isSafeInteger(v)) || typeof v === "bigint",
    "reference_tail_invalid",
  );
  const n = BigInt(v as number | bigint);
  check(n >= 0n && n <= MAX_U64, "reference_tail_invalid");
  return n;
}
async function hash(raw: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(raw)))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value as Record<string, unknown>)) freezeDeep(v);
    Object.freeze(value);
  }
  return value;
}
type ChunkMeta = {
  ordinal: number;
  key: string;
  sha256: string;
  bytes: number;
  count: number;
  lo: bigint;
  hi: bigint;
  weight: bigint;
  above: bigint;
};
type Chunk = { scores: bigint[]; suffix: bigint[] };
/** Open after the existing server selection and authorized, budgeted index read. */
export class ChunkedReferenceTailProjection {
  private readonly cached = new Map<number, Promise<Chunk>>();
  private cachedBytes = 0;
  private constructor(
    private readonly pin: AuthorizedSavedTailPin,
    private readonly port: AuthorizedSavedTailBytesPort,
    private readonly signal: AbortSignal,
    private readonly context: Readonly<NativeObject>,
    private readonly contextHash: string,
    private readonly version: string,
    private readonly denominator: bigint,
    private readonly eligible: bigint,
    private readonly whole: Rational,
    private readonly methodId: string,
    private readonly chunks: readonly ChunkMeta[],
    private readonly maximumCachedBytes: number,
  ) {
    this.cachedBytes = pin.bytes;
  }
  static async bind(
    raw: Uint8Array,
    selected: AuthorizedSavedTailPin,
    port: AuthorizedSavedTailBytesPort,
    signal: AbortSignal,
    maximumCachedBytes: number,
    offeringId: string,
  ): Promise<ChunkedReferenceTailProjection> {
    check(
      !!selected && !!port && !!signal && !signal.aborted &&
        typeof selected.key === "string" && selected.key.length > 0 && selected.key.length <= 512 &&
        !selected.key.startsWith("/") &&
        !selected.key.split("/").some((v) => v === "." || v === "..") &&
        [
          selected.sha256,
          selected.releaseSha256,
          selected.selectionSha256,
          selected.compatibilitySha256,
        ].every((v) => typeof v === "string" && HASH.test(v)) &&
        Number.isSafeInteger(selected.bytes) && selected.bytes > 0 &&
        Number.isSafeInteger(selected.maxBytes) && selected.maxBytes >= selected.bytes &&
        selected.maxBytes <= MAX_BYTES && raw.length === selected.bytes &&
        Number.isSafeInteger(maximumCachedBytes) && maximumCachedBytes > 0 &&
        maximumCachedBytes <= 40 * 1024 * 1024 && maximumCachedBytes >= selected.bytes &&
        typeof offeringId === "string" && offeringId.length > 0 &&
        !!selected.binding && selected.binding.offering_id === offeringId,
      "reference_tail_invalid",
    );
    const pin = freezeDeep({
      key: selected.key,
      sha256: selected.sha256,
      ...(selected.version === undefined ? {} : { version: selected.version }),
      bytes: selected.bytes,
      maxBytes: selected.maxBytes,
      releaseSha256: selected.releaseSha256,
      selectionSha256: selected.selectionSha256,
      compatibilitySha256: selected.compatibilitySha256,
      context: cloneNativeJson(selected.context as NativeObject),
      evidence: cloneNativeJson(selected.evidence as NativeObject),
      binding: cloneNativeJson(selected.binding as NativeObject),
    });
    await port.assertCurrent(pin, signal);
    check(!signal.aborted && await hash(raw) === pin.sha256, "reference_tail_pin_invalid");
    const p = obj(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(raw)), [
      "format",
      "version",
      "context",
      "evidence",
      "projection",
      "context_sha256",
      "score_denominator",
      "chunks",
    ]);
    check(
      p.format === "jungsi.saved-reference-tail-index/v1" && typeof p.version === "string" &&
        (pin.version === undefined || p.version === pin.version),
      "reference_tail_invalid",
    );
    const c = obj(p.context, CONTEXT), e = obj(p.evidence, EVIDENCE);
    obj(pin.context, CONTEXT);
    obj(pin.evidence, EVIDENCE);
    check(
      nativeJsonText(c, true) === nativeJsonText(pin.context, true) &&
        nativeJsonText(e, true) === nativeJsonText(pin.evidence, true) &&
        EVIDENCE.every((k) => typeof e[k] === "string" && HASH.test(e[k] as string)) &&
        typeof c.profile_sha256 === "string" && HASH.test(c.profile_sha256) &&
        typeof p.context_sha256 === "string" && HASH.test(p.context_sha256) &&
        await hash(new TextEncoder().encode(nativeJsonText(c, true))) === p.context_sha256,
      "reference_tail_context_mismatch",
    );
    check(
      typeof c.academic_year === "number" && Number.isSafeInteger(c.academic_year) &&
        [2024, 2025, 2026, 2027].includes(c.academic_year) &&
        ["csat", "june_mock", "september_mock"].includes(String(c.exam_type)) &&
        (c.academic_year !== 2027 || c.exam_type === "september_mock") &&
        c.weight_encoding === "original_unit_weight_integer" &&
        typeof c.source_scenario_field_present === "boolean" &&
        (c.source_scenario_field_present
          ? c.source_scenario_value === c.resolved_model_scenario
          : c.source_scenario_value === null),
      "reference_tail_context_mismatch",
    );
    const a = obj(p.projection, [
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
        a.weight_decimal_scale === 0 && typeof a.whole_mass_decimal === "string" &&
        a.whole_mass_decimal.length <= 19 &&
        /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(a.whole_mass_decimal),
      "reference_tail_invalid",
    );
    const eligible = uint(a.eligible_weight_units);
    const whole = new Rational(uint(a.whole_mass_numerator), uint(a.whole_mass_denominator));
    check(
      eligible > 0n && whole.compare(exact(0)) > 0 &&
        whole.compare(exact(a.whole_mass_decimal)) === 0 &&
        new Rational(eligible).compare(whole) <= 0,
      "reference_tail_invalid",
    );
    const denominator = nativeUint(p.score_denominator);
    check(
      denominator > 0n && Array.isArray(p.chunks) && p.chunks.length > 0 && p.chunks.length <= 32,
      "reference_tail_invalid",
    );
    const names = new Set<string>();
    let count = 0;
    const chunks: ChunkMeta[] = p.chunks.map((v, i) => {
      const x = obj(v, [
        "ordinal",
        "key",
        "sha256",
        "bytes",
        "row_count",
        "min_score_numerator",
        "max_score_numerator",
        "weight_units",
        "strict_above_units",
      ]);
      check(
        x.ordinal === i && typeof x.key === "string" && x.key.length > 0 && x.key.length <= 512 &&
          !x.key.startsWith("/") && !x.key.split("/").some((z) => z === "." || z === "..") &&
          x.key !== pin.key && !names.has(x.key) && typeof x.sha256 === "string" &&
          HASH.test(x.sha256) &&
          typeof x.bytes === "number" && Number.isSafeInteger(x.bytes) && x.bytes > 0 &&
          x.bytes <= MAX_BYTES &&
          typeof x.row_count === "number" && Number.isSafeInteger(x.row_count) &&
          x.row_count > 0 && x.row_count <= 100000,
        "reference_tail_invalid",
      );
      names.add(x.key);
      count += x.row_count;
      const lo = nativeUint(x.min_score_numerator), hi = nativeUint(x.max_score_numerator);
      const weight = uint(x.weight_units), above = uint(x.strict_above_units);
      check(lo <= hi && weight > 0n, "reference_tail_invalid");
      return {
        ordinal: i,
        key: x.key,
        sha256: x.sha256,
        bytes: x.bytes,
        count: x.row_count,
        lo,
        hi,
        weight,
        above,
      };
    });
    check(count <= 125000, "reference_tail_invalid");
    let above = 0n;
    for (let i = chunks.length - 1; i >= 0; i--) {
      check(
        chunks[i].above === above && (i === 0 || chunks[i - 1].hi < chunks[i].lo),
        "reference_tail_incomplete",
      );
      above += chunks[i].weight;
    }
    check(above === eligible, "reference_tail_incomplete");
    await port.assertCurrent(pin, signal);
    check(!signal.aborted, "reference_tail_unavailable");
    return new ChunkedReferenceTailProjection(
      pin,
      port,
      signal,
      freezeDeep(cloneNativeJson(c)),
      p.context_sha256 as string,
      p.version as string,
      denominator,
      eligible,
      whole,
      a.derived_method_id as string,
      Object.freeze(chunks),
      maximumCachedBytes,
    );
  }
  private async load(m: ChunkMeta): Promise<Chunk> {
    let pending = this.cached.get(m.ordinal);
    if (!pending) {
      check(this.cachedBytes + m.bytes <= this.maximumCachedBytes, "reference_tail_unavailable");
      this.cachedBytes += m.bytes;
      pending = (async () => {
        await this.port.assertCurrent(this.pin, this.signal);
        check(!this.signal.aborted, "reference_tail_unavailable");
        const raw = await this.port.read(m.key, m.bytes, this.signal);
        check(
          !this.signal.aborted && raw instanceof Uint8Array && raw.length === m.bytes &&
            await hash(raw) === m.sha256,
          "reference_tail_pin_invalid",
        );
        const p = obj(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(raw)), [
          "format",
          "version",
          "ordinal",
          "context_sha256",
          "score_denominator",
          "frequencies",
        ]);
        check(
          p.format === "jungsi.saved-reference-tail-chunk/v1" && p.version === this.version &&
            p.ordinal === m.ordinal && p.context_sha256 === this.contextHash &&
            nativeUint(p.score_denominator) === this.denominator && Array.isArray(p.frequencies) &&
            p.frequencies.length === m.count && p.frequencies.length <= 100000,
          "reference_tail_invalid",
        );
        const pairs = p.frequencies,
          scores = new Array<bigint>(pairs.length),
          suffix = new Array<bigint>(pairs.length);
        let running = m.above, next: bigint | null = null;
        for (let i = pairs.length - 1; i >= 0; i--) {
          const pair = pairs[i];
          check(Array.isArray(pair) && pair.length === 2, "reference_tail_invalid");
          const n = nativeUint(pair[0]), tie = uint(pair[1]);
          check(
            (next === null || n < next) && tie > 0n && tie <= this.eligible,
            "reference_tail_invalid",
          );
          running += tie;
          check(running <= this.eligible, "reference_tail_invalid");
          scores[i] = n;
          suffix[i] = running;
          next = n;
        }
        check(
          scores[0] === m.lo && scores[scores.length - 1] === m.hi &&
            running === m.above + m.weight,
          "reference_tail_incomplete",
        );
        await this.port.assertCurrent(this.pin, this.signal);
        check(!this.signal.aborted, "reference_tail_unavailable");
        return { scores, suffix };
      })();
      this.cached.set(m.ordinal, pending);
    }
    return await pending;
  }
  async query(score: Rational, identity: Readonly<NativeObject>): Promise<NativeObject | null> {
    check(
      score instanceof Rational && !this.signal.aborted &&
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
    await this.port.assertCurrent(this.pin, this.signal);
    await this.port.assertCompatible(
      this.pin,
      freezeDeep(cloneNativeJson(identity as NativeObject)),
      this.signal,
    );
    check(!this.signal.aborted, "reference_tail_unavailable");
    const scaled = score.numerator * this.denominator, div = score.denominator;
    if (scaled < this.chunks[0].lo * div || scaled > this.chunks[this.chunks.length - 1].hi * div) {
      await this.port.assertCurrent(this.pin, this.signal);
      check(!this.signal.aborted, "reference_tail_unavailable");
      return null;
    }
    let lo = 0, hi = this.chunks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.chunks[mid].hi * div < scaled) lo = mid + 1;
      else hi = mid;
    }
    const chunk = await this.load(this.chunks[lo]);
    let start = 0, end = chunk.scores.length;
    while (start < end) {
      const mid = (start + end) >>> 1;
      if (chunk.scores[mid] * div < scaled) start = mid + 1;
      else end = mid;
    }
    check(start < chunk.scores.length, "reference_tail_incomplete");
    const percent = new Rational(chunk.suffix[start]).multiply(exact(100)).divide(this.whole);
    // 대표님 결정(2026-11-16): 점수를 낼 수 없는 질량을 모두 위로 둔 상한
    const upper = new Rational(chunk.suffix[start]).add(
      this.whole.subtract(new Rational(this.eligible)),
    )
      .multiply(exact(100)).divide(this.whole);
    await this.port.assertCurrent(this.pin, this.signal);
    check(!this.signal.aborted, "reference_tail_unavailable");
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
