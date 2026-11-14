/** Chunked tail provider: all storage authority remains with the injected issuer. */
import type { ChunkedReferenceTailSelection } from "../application/reference_percentile.ts";
import { AccessError } from "../application/access.ts";
import { ChunkedReferenceTailProjection } from "../domain/chunked_reference_projection.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import {
  type AuthorizedSavedTailBytesPort,
  type AuthorizedSavedTailPin,
  PinnedSavedReferenceTailSource,
  SavedTailRequestBudget,
  snapshot,
} from "./saved_reference_tail_source.ts";

/** The issuer MUST independently verify the selected index hash, current head,
 * parent binding, and exact child membership/key/length/hash before storage I/O.
 * An arbitrary key supplied by an untrusted caller is never authority. */
export interface AuthorizedChunkedTailBytesPort extends AuthorizedSavedTailBytesPort {
  selectChunked(offeringId: string, signal: AbortSignal): Promise<AuthorizedSavedTailPin | null>;
  readChunk(
    parent: AuthorizedSavedTailPin,
    indexBytes: Uint8Array,
    key: string,
    bytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}
type Cached = {
  readonly signature: string;
  readonly value: Promise<ChunkedReferenceTailProjection>;
};
function unavailable(): never {
  throw new AccessError("reference_tail_unavailable", 503);
}
function freezeDeep<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(v);
  }
  return v;
}
export class PinnedChunkedReferenceTailSource {
  private readonly cached = new WeakMap<AbortSignal, Map<string, Cached>>();
  private readonly scopeSignals = new WeakMap<AbortSignal, AbortSignal>();
  private readonly indexSignatures = new Map<string, string>();
  constructor(
    private readonly source: AuthorizedChunkedTailBytesPort,
    private readonly signal: AbortSignal,
    private readonly maximumCachedObjects: number,
    private readonly maximumCachedBytes: number,
    private readonly canonicalSignal: (signal?: AbortSignal) => AbortSignal,
    private readonly budget: SavedTailRequestBudget,
  ) {
    if (
      !source || !signal || typeof canonicalSignal !== "function" ||
      !(budget instanceof SavedTailRequestBudget) ||
      budget.maximumObjects !== maximumCachedObjects || budget.maximumBytes !== maximumCachedBytes
    ) unavailable();
  }
  async getChunkedReferenceTail(
    offeringId: string,
    candidateSignal?: AbortSignal,
  ): Promise<ChunkedReferenceTailSelection | null> {
    const signal = this.canonicalSignal(candidateSignal);
    if (!signal || signal.aborted || typeof offeringId !== "string" || !offeringId.trim()) {
      unavailable();
    }
    const selected = await this.source.selectChunked(offeringId, signal);
    if (signal.aborted) unavailable();
    if (selected === null) return null;
    const pin = snapshot(selected, offeringId);
    const assertSignal = (requested?: AbortSignal) => {
      if (
        signal.aborted || requested?.aborted ||
        requested && requested !== candidateSignal && requested !== this.signal &&
          requested !== signal
      ) unavailable();
    };
    const current = async (requested?: AbortSignal) => {
      assertSignal(requested);
      await this.source.assertCurrent(pin, signal);
      assertSignal(requested);
    };
    await current();
    const sharedSignature = nativeJsonText({
      sha256: pin.sha256,
      ...(pin.version === undefined ? {} : { version: pin.version }),
      bytes: pin.bytes,
      maxBytes: pin.maxBytes,
      releaseSha256: pin.releaseSha256,
      ...(pin.selectionSha256 === undefined ? {} : { selectionSha256: pin.selectionSha256 }),
      compatibilitySha256: pin.compatibilitySha256,
      context: pin.context,
      evidence: pin.evidence,
    }, true);
    const previous = this.indexSignatures.get(pin.key);
    if (previous && previous !== sharedSignature) unavailable();
    this.indexSignatures.set(pin.key, sharedSignature);
    let scope = this.cached.get(signal);
    if (!scope) {
      scope = new Map();
      this.cached.set(signal, scope);
    }
    const key = JSON.stringify([pin.key, offeringId]),
      signature = nativeJsonText({ sharedSignature, binding: pin.binding }, true);
    let prior = scope.get(key);
    if (prior && prior.signature !== signature) unavailable();
    if (!prior) {
      this.budget.reserve(pin.bytes);
      const value = (async () => {
        const raw = await this.source.read(pin.key, pin.bytes, signal);
        if (signal.aborted) unavailable();
        const guarded: AuthorizedSavedTailBytesPort = {
          select: (id, s) => this.source.select(id, s),
          read: async (k, n, s) => {
            if (s !== signal || s.aborted) unavailable();
            this.budget.reserve(n);
            const b = await this.source.readChunk(pin, raw, k, n, s);
            if (s.aborted) unavailable();
            return b;
          },
          assertCurrent: (p, s) => this.source.assertCurrent(p, s),
          assertCompatible: (p, i, s) => this.source.assertCompatible(p, i, s),
        };
        return await ChunkedReferenceTailProjection.bind(
          raw,
          pin,
          guarded,
          signal,
          this.maximumCachedBytes,
          offeringId,
        );
      })();
      prior = { signature, value };
      scope.set(key, prior);
    }
    const projection = await prior.value;
    await current();
    return Object.freeze({
      projection,
      binding: pin.binding,
      assertCurrent: current,
      assertCompatible: async (identity: Readonly<NativeObject>, requested?: AbortSignal) => {
        await current(requested);
        const stable = freezeDeep(cloneNativeJson(identity as NativeObject));
        await this.source.assertCompatible(pin, stable, signal);
        await current(requested);
      },
      ...(this.source.verifiedProvenance
        ? {
          verifiedProvenance: async (identity: Readonly<NativeObject>, requested?: AbortSignal) => {
            if (!pin.selectionSha256) unavailable();
            await current(requested);
            const stable = freezeDeep(cloneNativeJson(identity as NativeObject));
            if (stable.offering_id !== offeringId) unavailable();
            await this.source.assertCompatible(pin, stable, signal);
            await current(requested);
            const proof = cloneNativeJson(
              await this.source.verifiedProvenance!(pin, stable, signal) as NativeObject,
            );
            const hashes: Record<string, string> = {
              release_sha256: pin.releaseSha256,
              selection_sha256: pin.selectionSha256,
              tail_sha256: pin.sha256,
              compatibility_sha256: pin.compatibilitySha256,
            };
            const fields = [
              "academic_year",
              "exam_id",
              "source_pack_version",
              "rule_version",
              "score_scale_id",
              "offering_id",
            ];
            if (
              Object.keys(proof).sort().join(",") !==
                [...Object.keys(hashes), ...fields].sort().join(",") ||
              Object.entries(hashes).some(([k, v]) => proof[k] !== v) || fields.some((k) =>
                proof[k] !== stable[k]
              )
            ) unavailable();
            await current(requested);
            return freezeDeep(proof);
          },
        }
        : {}),
    });
  }
}
/** Call once per admitted request; pass the existing context.scopeSignal unchanged. */
export function createScopedReferenceTailSources(
  source: AuthorizedChunkedTailBytesPort,
  signal: AbortSignal,
  maximumCachedObjects: number,
  maximumCachedBytes: number,
  canonicalSignal: (signal?: AbortSignal) => AbortSignal,
) {
  const budget = new SavedTailRequestBudget(maximumCachedObjects, maximumCachedBytes);
  const single = new PinnedSavedReferenceTailSource(
    source,
    signal,
    maximumCachedObjects,
    maximumCachedBytes,
    canonicalSignal,
    budget,
  );
  const chunked = new PinnedChunkedReferenceTailSource(
    source,
    signal,
    maximumCachedObjects,
    maximumCachedBytes,
    canonicalSignal,
    budget,
  );
  return Object.freeze({
    getReferenceTail: single.getReferenceTail.bind(single),
    getChunkedReferenceTail: chunked.getChunkedReferenceTail.bind(chunked),
  });
}
