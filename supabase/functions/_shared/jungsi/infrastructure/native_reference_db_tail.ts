/** Adapter between an already selected reference authority and the existing current DB CDF.
 * It does not publish data, create mappings, or make compatibility decisions. */
import { AccessError } from "../application/access.ts";
import type {
  NativeReferenceTailSelection,
  ReferenceTailPort,
} from "../application/reference_percentile.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { NativeReferenceCdfProjection } from "../domain/native_reference_cdf_projection.ts";
import type { IssuedTailPin } from "./published_reference_tail_issuer.ts";
import type { ExistingReferenceDbPin } from "./reference_percentile_postgres.ts";
import { SavedTailRequestBudget } from "./saved_reference_tail_source.ts";

type Authority = {
  select(id: string, signal: AbortSignal): Promise<IssuedTailPin | null>;
  assertCurrent(pin: IssuedTailPin, signal: AbortSignal): Promise<void>;
  assertCompatible(
    pin: IssuedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<void>;
  verifiedProvenance(
    pin: IssuedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<Readonly<NativeObject>>;
  modelExamPackSha256(pin: IssuedTailPin): string;
  sourceRuleId(pin: IssuedTailPin, signal: AbortSignal): Promise<string | null>;
};
type Reader = {
  select(
    owner: string,
    year: number,
    pk: string,
    signal: AbortSignal,
  ): Promise<ExistingReferenceDbPin | null>;
  source(owner: string, pin: ExistingReferenceDbPin, signal: AbortSignal): Promise<Uint8Array>;
  assertCurrent(owner: string, pin: ExistingReferenceDbPin, signal: AbortSignal): Promise<void>;
  currentReceipt(
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Readonly<{ assertCurrent(): void }>;
};
const HASH = /^[0-9a-f]{64}$/;
function fail(): never {
  throw new AccessError("reference_tail_unavailable", 503);
}
function text(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 512;
}
function live(s: AbortSignal): void {
  if (!s || s.aborted) fail();
}
export class PinnedExistingDbReferenceTailSource implements ReferenceTailPort {
  private readonly scopes = new WeakMap<
    AbortSignal,
    Map<string, Promise<NativeReferenceTailSelection | null>>
  >();
  private readonly budget: SavedTailRequestBudget;
  private lastDb?: ExistingReferenceDbPin;
  private readonly proofPins = new WeakMap<IssuedTailPin, ExistingReferenceDbPin>();
  private readonly receipts = new WeakMap<AbortSignal, Readonly<{ assertCurrent(): void }>>();
  constructor(
    private readonly owner: string,
    private readonly authority: Authority,
    private readonly reader: Reader,
    private readonly requestSignal: AbortSignal,
    private readonly resolve: (s?: AbortSignal) => AbortSignal,
    private readonly maxObjects: number,
    private readonly maxBytes: number,
    sharedBudget?: SavedTailRequestBudget,
  ) {
    if (
      !text(owner) || !authority || !reader || !requestSignal || typeof resolve !== "function" ||
      !Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 64 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 40 * 1024 * 1024
    ) fail();
    this.budget = sharedBudget ?? new SavedTailRequestBudget(maxObjects, maxBytes);
    if (this.budget.maximumObjects !== maxObjects || this.budget.maximumBytes !== maxBytes) fail();
  }
  async getNativeReferenceTail(
    id: string,
    requested?: AbortSignal,
  ): Promise<NativeReferenceTailSelection | null> {
    if (!text(id) || this.requestSignal.aborted || requested?.aborted) fail();
    const signal = this.resolve(requested);
    live(signal);
    let entries = this.scopes.get(signal);
    if (!entries) {
      entries = new Map();
      this.scopes.set(signal, entries);
    }
    let work = entries.get(id);
    if (!work) {
      work = this.open(id, signal);
      entries.set(id, work);
    }
    const result = await work;
    live(signal);
    return result;
  }
  private async open(
    id: string,
    signal: AbortSignal,
  ): Promise<NativeReferenceTailSelection | null> {
    live(signal);
    const selected = await this.authority.select(id, signal);
    live(signal);
    if (!selected) return null;
    const binding = cloneNativeJson(selected.binding as NativeObject), context = selected.context;
    const year = context.academic_year,
      pk = binding.physical_offering_pk,
      model = this.authority.modelExamPackSha256(selected);
    // Resolve the original rule from the selected verified calculator; evidence format is unchanged.
    const sourceRuleId = await this.authority.sourceRuleId(selected, signal);
    live(signal);
    if (sourceRuleId === null) fail();
    if (
      binding.offering_id !== id || !Number.isSafeInteger(year) || typeof year !== "number" ||
      year < 2024 || year > 2027 ||
      binding.academic_year !== year || !text(pk) || !HASH.test(model) ||
      ![
        context.exam_id,
        context.exam_type,
        context.source_pack_version,
        context.rule_version,
        context.score_scale_id,
        sourceRuleId,
      ].every(text)
    ) fail();
    const db = await this.reader.select(this.owner, year, pk, signal);
    live(signal);
    if (!db) return null;
    // A selected DB tail with a different CDF digest is an integrity failure, not a missing selection.
    if (db.cdfSha256 !== selected.evidence.source_cdf_sha256) fail();
    if (db.academicYear !== year || db.physicalOfferingPk !== pk) fail();
    this.budget.reserve(db.sourceBytes);
    this.trackDb(db);
    const current = async (s?: AbortSignal) => {
      if (s?.aborted || this.resolve(s) !== signal) fail();
      live(signal);
      await this.authority.assertCurrent(selected, signal);
      await this.reader.assertCurrent(this.owner, db, signal);
      await this.authority.assertCurrent(selected, signal);
      live(signal);
      this.receipts.set(signal, this.reader.currentReceipt(db, signal));
    };
    await current(signal);
    const raw = await this.reader.source(this.owner, db, signal);
    live(signal);
    const projection = await NativeReferenceCdfProjection.bind(
      raw,
      {
        sourceSha256: db.cdfSha256,
        sourceBytes: db.sourceBytes,
        methodId: db.methodId,
        year,
        examId: String(context.exam_id),
        examType: String(context.exam_type),
        sourcePackVersion: String(context.source_pack_version),
        modelPackSha256: model,
        ruleVersion: String(context.rule_version),
        sourceRuleId: String(sourceRuleId),
        scoreScaleId: String(context.score_scale_id),
        offeringId: id,
        maximumSupportRows: 125000,
      },
      db.method,
      signal,
    );
    await current(signal);
    return Object.freeze({
      projection,
      binding: Object.freeze(binding),
      assertCurrent: current,
      assertCompatible: async (identity: Readonly<NativeObject>, s?: AbortSignal) => {
        await current(s);
        await this.authority.assertCompatible(selected, identity, signal);
        await current(s);
      },
      verifiedProvenance: async (identity: Readonly<NativeObject>, s?: AbortSignal) => {
        await current(s);
        const result = cloneNativeJson(
          await this.authority.verifiedProvenance(selected, identity, signal) as NativeObject,
        );
        await current(s);
        result.release_sha256 = db.releaseId.slice("reference-percentile:".length);
        result.tail_sha256 = db.cdfSha256;
        return Object.freeze(result);
      },
    });
  }
  private trackDb(db: ExistingReferenceDbPin): void {
    if (
      this.lastDb &&
      (this.lastDb.releaseId !== db.releaseId || this.lastDb.readbackSha256 !== db.readbackSha256 ||
        this.lastDb.datasetSha256 !== db.datasetSha256)
    ) fail();
    this.lastDb = db;
  }
  /** Immutable report read verifies the source under the SAME current DB head before disclosure. */
  readonly proofIssuer = {
    select: async (id: string, signal: AbortSignal): Promise<IssuedTailPin | null> => {
      live(signal);
      const pin = await this.authority.select(id, signal);
      if (!pin) return null;
      const year = pin.context.academic_year, pk = pin.binding.physical_offering_pk;
      if (typeof year !== "number" || !Number.isSafeInteger(year) || !text(pk)) fail();
      const db = await this.reader.select(this.owner, year, pk, signal);
      live(signal);
      if (!db || db.cdfSha256 !== pin.evidence.source_cdf_sha256) return null;
      this.trackDb(db);
      await this.reader.assertCurrent(this.owner, db, signal);
      this.receipts.set(signal, this.reader.currentReceipt(db, signal));
      this.proofPins.set(pin, db);
      return pin;
    },
    verifiedProvenance: async (
      pin: IssuedTailPin,
      identity: Readonly<NativeObject>,
      signal: AbortSignal,
    ): Promise<Readonly<NativeObject>> => {
      const db = this.proofPins.get(pin);
      if (!db) fail();
      await this.reader.assertCurrent(this.owner, db, signal);
      const proof = cloneNativeJson(
        await this.authority.verifiedProvenance(pin, identity, signal) as NativeObject,
      );
      await this.reader.assertCurrent(this.owner, db, signal);
      this.receipts.set(signal, this.reader.currentReceipt(db, signal));
      proof.release_sha256 = db.releaseId.slice("reference-percentile:".length);
      proof.tail_sha256 = db.cdfSha256;
      return Object.freeze(proof);
    },
  };
  /** Called before settlement with the exact request signal; later checks perform no I/O. */
  async prepareReceipt(signal: AbortSignal): Promise<void> {
    if (!this.lastDb) return;
    live(signal);
    await this.reader.assertCurrent(this.owner, this.lastDb, signal);
    this.receipts.set(signal, this.reader.currentReceipt(this.lastDb, signal));
  }
  assertSettled(signal: AbortSignal): void {
    if (!this.lastDb) return;
    if (signal !== this.requestSignal || signal.aborted) fail();
    const receipt = this.receipts.get(signal);
    if (!receipt) fail();
    receipt.assertCurrent();
  }
}
