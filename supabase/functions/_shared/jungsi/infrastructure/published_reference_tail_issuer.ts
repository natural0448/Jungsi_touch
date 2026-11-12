/** Current-head selected reference tail authority. No local candidate grants production authority. */
import { AccessError } from "../application/access.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";

type Row = { key: string; entry: NativeObject };
type Selected = {
  registrySha256: string;
  selectionSha256: string;
  approvalReferenceSha256: string;
  tails: readonly Row[];
  compatibilities: readonly Row[];
};
type ExamPin = Readonly<{ key: string; sha256: string; version: string }>;
type Provider = {
  referenceSelection(signal: AbortSignal): Promise<Readonly<Selected>>;
  referenceExamPin(examId: string, signal: AbortSignal): Promise<ExamPin | null>;
  getReference?(
    offeringId: string,
  ): Promise<
    Readonly<
      {
        binding: Readonly<NativeObject>;
        academicYear: number;
        examId: string;
        packVersion: string;
        examType: string;
        scoreScaleId: string;
        rule?: Readonly<{ data: Readonly<NativeObject> }>;
      }
    > | null
  >;
  loadReferenceTail(
    key: string,
    signal: AbortSignal,
  ): Promise<{ entry: NativeObject; bytes: Uint8Array } | null>;
  loadReferenceCompatibility(
    key: string,
    signal: AbortSignal,
  ): Promise<{ entry: NativeObject; payload: NativeObject } | null>;
};
export type IssuedTailPin = Readonly<{
  key: string;
  sha256: string;
  version?: string;
  bytes: number;
  maxBytes: number;
  releaseSha256: string;
  selectionSha256: string;
  compatibilitySha256: string;
  binding: Readonly<NativeObject>;
  context: Readonly<NativeObject>;
  evidence: Readonly<NativeObject>;
}>;
type Tracked = {
  pin: IssuedTailPin;
  entry: NativeObject;
  compatibility: NativeObject;
  nativeExact: boolean;
};
const HASH = /^[0-9a-f]{64}$/;
const IDENTITY = [
  "academic_year",
  "exam_id",
  "exam_type",
  "source_pack_version",
  "rule_version",
  "score_scale_id",
] as const;
const RECEIPT_KEYS = [
  "format",
  "version",
  "status",
  "scope",
  "tail_sha256",
  "exam_pack_sha256",
  "model_exam_pack_sha256",
  "academic_year",
  "exam_id",
  "exam_type",
  "source_pack_version",
  "rule_version",
  "score_scale_id",
  "context_sha256",
  "evidence_sha256",
  "source_review_sha256",
  "independent_review_sha256",
] as const;
function fail(): never {
  throw new AccessError("reference_tail_unavailable", 503);
}
function live(signal: AbortSignal): void {
  if (!signal || signal.aborted) fail();
}
function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function hash(v: unknown): v is string {
  return typeof v === "string" && HASH.test(v);
}
function same(a: unknown, b: unknown): boolean {
  return nativeJsonText(a as NativeObject, true) === nativeJsonText(b as NativeObject, true);
}
function string(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 512;
}
function copy<T extends NativeObject>(v: T): T {
  return cloneNativeJson(v) as T;
}

/** Created once inside the admitted request. Callback must validate its existing session,
 * report ownership, current admission and propagate this same signal to actual I/O. */
export class PublishedReferenceTailIssuer {
  private readonly pins = new Map<string, Tracked>();
  private readonly receipts = new WeakMap<AbortSignal, Map<string, Promise<NativeObject>>>();
  constructor(
    private readonly data: Provider,
    private readonly assertAccess: (signal: AbortSignal) => Promise<void>,
    private readonly nativeExactExamFallback = false,
  ) {
    if (!data || typeof assertAccess !== "function") fail();
  }
  private async selection(signal: AbortSignal): Promise<Readonly<Selected>> {
    live(signal);
    await this.assertAccess(signal);
    live(signal);
    const s = await this.data.referenceSelection(signal);
    live(signal);
    if (
      !s || ![s.registrySha256, s.selectionSha256, s.approvalReferenceSha256].every(hash) ||
      !Array.isArray(s.tails) || !Array.isArray(s.compatibilities)
    ) fail();
    return s;
  }
  async select(offeringId: string, signal: AbortSignal): Promise<IssuedTailPin | null> {
    if (!string(offeringId)) fail();
    const s = await this.selection(signal);
    const matches: { row: Row; binding?: NativeObject }[] = [];
    for (const row of s.tails) {
      if (!string(row.key) || !object(row.entry)) fail();
      const bindings = row.entry.reference_bindings;
      if (bindings === undefined) {
        const c = row.entry.reference_context;
        if (object(c) && Array.isArray(c.offering_ids) && c.offering_ids.includes(offeringId)) {
          matches.push({ row });
        }
        continue;
      }
      if (!Array.isArray(bindings) || bindings.length > 256) fail();
      for (const binding of bindings) {
        if (!object(binding) || !string(binding.offering_id)) fail();
        if (binding.offering_id === offeringId) matches.push({ row, binding });
      }
    }
    if (matches.length === 0) return null;
    if (matches.length !== 1) fail();
    const row = matches[0].row, entry = row.entry, key = entry.compatibility_key;
    const rawContext = entry.reference_context, evidence = entry.reference_evidence;
    if (!object(rawContext) || !object(evidence)) fail();
    const context = copy(rawContext);
    if (Array.isArray(context.offering_ids)) {
      if (!context.offering_ids.includes(offeringId)) fail();
      delete context.offering_ids;
    }
    // Current selections may omit physical bindings. Use only the explicit year:PK
    // identifier format plus the already selected reference binding; the DB reader
    // independently verifies the same year, physical PK and current release.
    let binding = matches[0].binding;
    if (!binding) {
      const parsed = /^([0-9]{4}):([1-9][0-9]{0,18})$/.exec(offeringId);
      if (!parsed || Number(parsed[1]) !== context.academic_year || !this.data.getReference) {
        return null;
      }
      const ref = await this.data.getReference(offeringId);
      live(signal);
      if (!ref) return null;
      if (
        ref.academicYear !== context.academic_year || ref.examId !== context.exam_id ||
        ref.packVersion !== context.source_pack_version || ref.examType !== context.exam_type ||
        ref.scoreScaleId !== context.score_scale_id ||
        ref.binding.rule_version !== context.rule_version
      ) return null;
      binding = {
        ...copy(ref.binding as NativeObject),
        offering_id: offeringId,
        physical_offering_pk: parsed[2],
      };
    }
    if (
      !hash(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) || Number(entry.bytes) < 1 ||
      Number(entry.bytes) > 8388608 ||
      !hash(entry.source_review_sha256) || !hash(entry.independent_review_sha256) ||
      !string(binding.offering_id) || !string(binding.physical_offering_pk) ||
      binding.academic_year !== context.academic_year ||
      binding.rule_version !== context.rule_version
    ) fail();
    // Existing DB CDFs already embed their exact model pack hash. The DB-only issuer
    // may use that equality as a proof; a version string alone never suffices.
    const nativeExact = key === undefined && entry.model_exam_pack_sha256 === undefined;
    let compatibility: NativeObject;
    if (nativeExact) {
      if (!this.nativeExactExamFallback) return null;
      if (!hash(evidence.source_cdf_sha256) || !string(context.exam_id)) fail();
      const exam = await this.data.referenceExamPin(context.exam_id, signal);
      live(signal);
      if (!exam || !hash(exam.sha256) || exam.version !== context.source_pack_version) return null;
      const proof: NativeObject = {
        format: "jungsi.native-db-exact-exam-pin/v1",
        registry_sha256: s.registrySha256,
        selection_sha256: s.selectionSha256,
        tail_sha256: entry.sha256,
        source_cdf_sha256: evidence.source_cdf_sha256,
        exam_pack_sha256: exam.sha256,
        context_sha256: await nativeJsonSha256(context),
        evidence_sha256: await nativeJsonSha256(evidence),
      };
      compatibility = {
        kind: "native_db_exact_exam_pin",
        sha256: await nativeJsonSha256(proof),
        exam_pack_sha256: exam.sha256,
      };
    } else {
      if (!string(key) || !hash(entry.model_exam_pack_sha256)) fail();
      const matchesCompat = s.compatibilities.filter((v) => v.key === key);
      if (
        matchesCompat.length !== 1 || !object(matchesCompat[0].entry) ||
        !hash(matchesCompat[0].entry.sha256)
      ) fail();
      compatibility = copy(matchesCompat[0].entry);
    }
    const pin: IssuedTailPin = Object.freeze({
      key: row.key,
      sha256: entry.sha256,
      ...(string(entry.version) ? { version: entry.version } : {}),
      bytes: Number(entry.bytes),
      maxBytes: Number(entry.bytes),
      releaseSha256: s.registrySha256,
      selectionSha256: s.selectionSha256,
      compatibilitySha256: String(compatibility.sha256),
      binding: Object.freeze(copy(binding)),
      context: Object.freeze(copy(context)),
      evidence: Object.freeze(copy(evidence)),
    });
    const mapKey = pin.key + "\u0000" + offeringId;
    const tracked = { pin, entry: copy(entry), compatibility, nativeExact };
    const previous = this.pins.get(mapKey);
    if (
      previous &&
      (!same(previous.entry, tracked.entry) ||
        !same(previous.compatibility, tracked.compatibility) ||
        !same(previous.pin.binding, pin.binding))
    ) fail();
    this.pins.set(mapKey, tracked);
    await this.assertCurrent(pin, signal);
    return pin;
  }
  private tracked(pin: IssuedTailPin): Tracked {
    const id = pin?.binding?.offering_id;
    if (!string(id)) fail();
    const value = this.pins.get(pin.key + "\u0000" + id);
    if (!value || !same(value.pin, pin)) fail();
    return value;
  }
  async assertCurrent(pin: IssuedTailPin, signal: AbortSignal): Promise<void> {
    const t = this.tracked(pin), s = await this.selection(signal);
    if (s.registrySha256 !== pin.releaseSha256 || s.selectionSha256 !== pin.selectionSha256) fail();
    const a = s.tails.filter((v) => v.key === pin.key),
      b = s.compatibilities.filter((v) => v.entry.sha256 === pin.compatibilitySha256);
    if (
      a.length !== 1 || !same(a[0].entry, t.entry) ||
      (!t.nativeExact && (b.length !== 1 || !same(b[0].entry, t.compatibility)))
    ) fail();
    live(signal);
  }
  async read(key: string, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array> {
    live(signal);
    const matching = [...this.pins.values()].filter((v) => v.pin.key === key);
    if (
      !matching.length ||
      matching.some((v) =>
        v.nativeExact || v.pin.bytes !== maximumBytes || v.pin.sha256 !== matching[0].pin.sha256
      )
    ) fail();
    await this.assertCurrent(matching[0].pin, signal);
    const got = await this.data.loadReferenceTail(key, signal);
    live(signal);
    if (!got || !same(got.entry, matching[0].entry) || got.bytes.length !== maximumBytes) fail();
    await this.assertCurrent(matching[0].pin, signal);
    return got.bytes;
  }
  private async receipt(t: Tracked, signal: AbortSignal): Promise<NativeObject> {
    let scoped = this.receipts.get(signal);
    if (!scoped) {
      scoped = new Map();
      this.receipts.set(signal, scoped);
    }
    const key = t.compatibility.key;
    if (!string(key)) fail();
    let pending = scoped.get(key);
    if (!pending) {
      pending = (async () => {
        const value = await this.data.loadReferenceCompatibility(key, signal);
        live(signal);
        if (!value || !same(value.entry, t.compatibility)) fail();
        return copy(value.payload);
      })();
      scoped.set(key, pending);
    }
    return await pending;
  }
  /** Original rule ID from the already selected and verified calculator; no new metadata field. */
  async sourceRuleId(pin: IssuedTailPin, signal: AbortSignal): Promise<string | null> {
    await this.assertCurrent(pin, signal);
    if (!this.data.getReference) return null;
    const id = pin.binding.offering_id;
    if (!string(id)) fail();
    const ref = await this.data.getReference(id);
    live(signal);
    if (!ref) return null;
    const rule = ref.rule?.data;
    if (
      !object(rule) || !string(rule.rule_id) || rule.rule_version !== pin.context.rule_version ||
      ref.binding.offering_pk !== id || ref.binding.rule_version !== pin.context.rule_version ||
      ref.academicYear !== pin.context.academic_year || ref.examId !== pin.context.exam_id ||
      ref.packVersion !== pin.context.source_pack_version ||
      ref.examType !== pin.context.exam_type ||
      ref.scoreScaleId !== pin.context.score_scale_id
    ) fail();
    await this.assertCurrent(pin, signal);
    return rule.rule_id;
  }
  /** Exact model source hash from the already selected, tracked reference entry. */
  modelExamPackSha256(pin: IssuedTailPin): string {
    const t = this.tracked(pin),
      value = t.nativeExact ? t.compatibility.exam_pack_sha256 : t.entry.model_exam_pack_sha256;
    if (!hash(value)) fail();
    return value;
  }
  async assertCompatible(
    pin: IssuedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<void> {
    const t = this.tracked(pin);
    await this.assertCurrent(pin, signal);
    if (
      !object(identity) || identity.offering_id !== pin.binding.offering_id ||
      IDENTITY.some((k) => identity[k] !== pin.context[k])
    ) fail();
    const exam = await this.data.referenceExamPin(String(identity.exam_id), signal);
    live(signal);
    if (t.nativeExact) {
      if (
        !this.nativeExactExamFallback || !exam ||
        exam.sha256 !== t.compatibility.exam_pack_sha256 ||
        exam.version !== pin.context.source_pack_version
      ) fail();
      await this.assertCurrent(pin, signal);
      return;
    }
    const receipt = await this.receipt(t, signal);
    live(signal);
    if (
      !exam || !object(receipt) ||
      Object.keys(receipt).sort().join(",") !== [...RECEIPT_KEYS].sort().join(",") ||
      receipt.format !== "jungsi.reference-model-compatibility/v1" ||
      receipt.version !== t.compatibility.version ||
      receipt.status !== "verified_reference" ||
      receipt.scope !== "same_exam_mathematical_reference" ||
      receipt.tail_sha256 !== pin.sha256 || receipt.exam_pack_sha256 !== exam.sha256 ||
      receipt.model_exam_pack_sha256 !== t.entry.model_exam_pack_sha256 ||
      IDENTITY.some((k) => receipt[k] !== identity[k]) ||
      receipt.source_review_sha256 !== t.entry.source_review_sha256 ||
      receipt.independent_review_sha256 !== t.entry.independent_review_sha256 ||
      receipt.context_sha256 !== await nativeJsonSha256(pin.context as NativeObject) ||
      receipt.evidence_sha256 !== await nativeJsonSha256(pin.evidence as NativeObject)
    ) fail();
    await this.assertCurrent(pin, signal);
  }
  async verifiedProvenance(
    pin: IssuedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<Readonly<NativeObject>> {
    await this.assertCompatible(pin, identity, signal);
    live(signal);
    return Object.freeze({
      release_sha256: pin.releaseSha256,
      selection_sha256: pin.selectionSha256,
      tail_sha256: pin.sha256,
      compatibility_sha256: pin.compatibilitySha256,
      academic_year: identity.academic_year,
      exam_id: identity.exam_id,
      source_pack_version: identity.source_pack_version,
      rule_version: identity.rule_version,
      score_scale_id: identity.score_scale_id,
      offering_id: identity.offering_id,
    });
  }
}
