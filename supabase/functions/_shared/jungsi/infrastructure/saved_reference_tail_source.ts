/** Request-local adapter for already saved reference tails.
 *
 * The injected source is a server-only authority, not a browser DTO. Its
 * select/read/current/compatibility methods must be bound to the existing
 * authenticated request, approved head, actual admission and read budget.
 * This adapter neither grants authority nor creates a production forecast.
 */
import type {
  ReferenceTailPort,
  ReferenceTailSelection,
} from "../application/reference_percentile.ts";
import { AccessError } from "../application/access.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import {
  type AuthorizedSavedTailBytesPort,
  type AuthorizedSavedTailPin,
  SavedReferenceTailProjection,
} from "../domain/saved_reference_projection.ts";

export type {
  AuthorizedSavedTailBytesPort,
  AuthorizedSavedTailPin,
} from "../domain/saved_reference_projection.ts";
type Cached = {
  readonly signature: string;
  readonly signal: AbortSignal;
  readonly value: Promise<SavedReferenceTailProjection>;
  complete: boolean;
};
const HASH = /^[a-f0-9]{64}$/;

function unavailable(): never {
  throw new AccessError("reference_tail_unavailable", 503);
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
export function snapshot(pin: AuthorizedSavedTailPin, offeringId: string): AuthorizedSavedTailPin {
  if (
    !pin || typeof pin.key !== "string" || pin.key.length < 1 || pin.key.length > 512 ||
    pin.key.startsWith("/") || pin.key.split("/").some((x) => x === ".." || x === ".") ||
    (pin.version !== undefined && (typeof pin.version !== "string" || !pin.version)) ||
    ![pin.sha256, pin.releaseSha256, pin.compatibilitySha256].every((x) => HASH.test(x)) ||
    (pin.selectionSha256 !== undefined && !HASH.test(pin.selectionSha256)) ||
    !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || !Number.isSafeInteger(pin.maxBytes) ||
    pin.maxBytes < pin.bytes || pin.maxBytes > 8388608 ||
    !pin.binding || pin.binding.offering_id !== offeringId
  ) unavailable();
  // Reject getters, cycles, mutable prototypes and non-native JSON using the existing
  // contract copier; retain exact decimal lexemes and never retain caller-owned objects.
  return freezeDeep({
    key: pin.key,
    sha256: pin.sha256,
    ...(pin.version === undefined ? {} : { version: pin.version }),
    bytes: pin.bytes,
    maxBytes: pin.maxBytes,
    releaseSha256: pin.releaseSha256,
    ...(pin.selectionSha256 === undefined ? {} : { selectionSha256: pin.selectionSha256 }),
    compatibilitySha256: pin.compatibilitySha256,
    binding: cloneNativeJson(pin.binding as NativeObject),
    context: cloneNativeJson(pin.context as NativeObject),
    evidence: cloneNativeJson(pin.evidence as NativeObject),
  });
}

/** Request-local shared object/byte bound. Source authority independently enforces physical request budgets. */
export class SavedTailRequestBudget {
  private objects = 0;
  private bytes = 0;
  constructor(readonly maximumObjects: number, readonly maximumBytes: number) {
    if (
      !Number.isSafeInteger(maximumObjects) || maximumObjects < 1 || maximumObjects > 64 ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 40 * 1024 * 1024
    ) unavailable();
  }
  reserve(bytes: number): void {
    if (
      !Number.isSafeInteger(bytes) || bytes < 1 || this.objects + 1 > this.maximumObjects ||
      this.bytes + bytes > this.maximumBytes
    ) unavailable();
    this.objects++;
    this.bytes += bytes;
  }
}

/** Instantiate once per admitted request, never as an isolate/global singleton. */
export class PinnedSavedReferenceTailSource implements ReferenceTailPort {
  private readonly cached = new Map<string, Cached[]>();
  private readonly scopeSignals = new WeakMap<AbortSignal, AbortSignal>();
  private readonly budget: SavedTailRequestBudget;
  private cachedBytes = 0;
  private cachedObjects = 0;
  private scopeSignal(scope?: AbortSignal): AbortSignal {
    if (this.canonicalSignal) return this.canonicalSignal(scope);
    if (!scope || scope === this.signal) return this.signal;
    let combined = this.scopeSignals.get(scope);
    if (!combined) {
      combined = AbortSignal.any([this.signal, scope]);
      this.scopeSignals.set(scope, combined);
    }
    return combined;
  }
  constructor(
    private readonly source: AuthorizedSavedTailBytesPort,
    private readonly signal: AbortSignal,
    private readonly maximumCachedObjects: number,
    private readonly maximumCachedBytes: number,
    /** Optional request-local canonical resolver shared with head and other providers. */
    private readonly canonicalSignal?: (scopeSignal?: AbortSignal) => AbortSignal,
    sharedBudget?: SavedTailRequestBudget,
  ) {
    if (
      !source || !signal || !Number.isSafeInteger(maximumCachedObjects) ||
      maximumCachedObjects < 1 || maximumCachedObjects > 64 ||
      !Number.isSafeInteger(maximumCachedBytes) || maximumCachedBytes < 1 ||
      maximumCachedBytes > 40 * 1024 * 1024
    ) unavailable();
    this.budget = sharedBudget ??
      new SavedTailRequestBudget(maximumCachedObjects, maximumCachedBytes);
    if (
      !(this.budget instanceof SavedTailRequestBudget) ||
      this.budget.maximumObjects !== maximumCachedObjects ||
      this.budget.maximumBytes !== maximumCachedBytes
    ) unavailable();
  }
  async getReferenceTail(
    offeringId: string,
    scopeSignal?: AbortSignal,
  ): Promise<ReferenceTailSelection | null> {
    const signal = this.scopeSignal(scopeSignal);
    if (signal.aborted || typeof offeringId !== "string" || !offeringId.trim()) unavailable();
    const original = await this.source.select(offeringId, signal);
    if (signal.aborted) unavailable();
    if (original === null) return null;
    const pin = snapshot(original, offeringId);
    const current = async (extraSignal?: AbortSignal) => {
      const active = !extraSignal || extraSignal === signal || extraSignal === scopeSignal
        ? signal
        : this.scopeSignal(extraSignal);
      if (active.aborted) unavailable();
      await this.source.assertCurrent(pin, active);
      if (active.aborted) unavailable();
    };
    await current();
    // The same verified object may serve multiple authorized offerings, but
    // its source, context and compatibility evidence must remain identical.
    const signature = nativeJsonText({
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
    const entries = this.cached.get(pin.key) ?? [];
    if (entries.some((entry) => entry.signature !== signature)) unavailable();
    let prior = entries.find((entry) => entry.complete || entry.signal === signal);
    if (!prior) {
      if (
        this.cachedObjects >= this.maximumCachedObjects ||
        this.cachedBytes + pin.bytes > this.maximumCachedBytes
      ) unavailable();
      this.budget.reserve(pin.bytes);
      this.cachedObjects++;
      this.cachedBytes += pin.bytes;
      let created!: Cached;
      const value = (async () => {
        const raw = await this.source.read(pin.key, pin.bytes, signal);
        if (signal.aborted) unavailable();
        const projection = await SavedReferenceTailProjection.bind(raw, pin);
        if (signal.aborted) unavailable();
        created.complete = true;
        return projection;
      })();
      prior = created = { signature, signal, value, complete: false };
      entries.push(prior);
      this.cached.set(pin.key, entries);
    }
    const projection = await prior.value;
    await current();
    return Object.freeze({
      projection,
      binding: pin.binding,
      assertCurrent: current,
      assertCompatible: async (identity: Readonly<NativeObject>, extraSignal?: AbortSignal) => {
        const active = !extraSignal || extraSignal === signal || extraSignal === scopeSignal
          ? signal
          : this.scopeSignal(extraSignal);
        await current(active);
        const stableIdentity = freezeDeep(cloneNativeJson(identity as NativeObject));
        await this.source.assertCompatible(pin, stableIdentity, active);
        await current(active);
      },
      ...(this.source.verifiedProvenance
        ? {
          verifiedProvenance: async (identity: Readonly<NativeObject>, requested?: AbortSignal) => {
            if (!pin.selectionSha256) unavailable();
            await current(requested);
            const stableIdentity = freezeDeep(cloneNativeJson(identity as NativeObject));
            if (stableIdentity.offering_id !== offeringId) unavailable();
            await this.source.assertCompatible(pin, stableIdentity, signal);
            await current(requested);
            const proof = cloneNativeJson(
              await this.source.verifiedProvenance!(pin, stableIdentity, signal) as NativeObject,
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
              Object.entries(hashes).some(([k, v]) => proof[k] !== v) ||
              fields.some((k) => proof[k] !== stableIdentity[k])
            ) unavailable();
            await current(requested);
            return freezeDeep(proof);
          },
        }
        : {}),
    });
  }
}
