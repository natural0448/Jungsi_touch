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
  type SavedReferenceProjectionPin,
  SavedReferenceTailProjection,
} from "../domain/saved_reference_projection.ts";

export interface AuthorizedSavedTailPin extends SavedReferenceProjectionPin {
  readonly key: string;
  readonly releaseSha256: string;
  readonly compatibilitySha256: string;
  /** Public ID, physical PK and current catalog context are distinct fields. */
  readonly binding: Readonly<NativeObject>;
}
export interface AuthorizedSavedTailBytesPort {
  /** Selection must be independently authorized, never supplied by a client. */
  select(offeringId: string): Promise<AuthorizedSavedTailPin | null>;
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
}
type Cached = { readonly signature: string; readonly value: Promise<SavedReferenceTailProjection> };
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
function snapshot(pin: AuthorizedSavedTailPin, offeringId: string): AuthorizedSavedTailPin {
  if (
    !pin || typeof pin.key !== "string" || pin.key.length < 1 || pin.key.length > 512 ||
    pin.key.startsWith("/") || pin.key.split("/").some((x) => x === ".." || x === ".") ||
    ![pin.sha256, pin.releaseSha256, pin.compatibilitySha256].every((x) => HASH.test(x)) ||
    !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || !Number.isSafeInteger(pin.maxBytes) ||
    pin.maxBytes < pin.bytes || pin.maxBytes > 8388608 ||
    !pin.binding || pin.binding.offering_id !== offeringId
  ) unavailable();
  // Reject getters, cycles, mutable prototypes and non-native JSON using the existing
  // contract copier; retain exact decimal lexemes and never retain caller-owned objects.
  return freezeDeep({
    key: pin.key,
    sha256: pin.sha256,
    bytes: pin.bytes,
    maxBytes: pin.maxBytes,
    releaseSha256: pin.releaseSha256,
    compatibilitySha256: pin.compatibilitySha256,
    binding: cloneNativeJson(pin.binding as NativeObject),
    context: cloneNativeJson(pin.context as NativeObject),
    evidence: cloneNativeJson(pin.evidence as NativeObject),
  });
}

/** Instantiate once per admitted request, never as an isolate/global singleton. */
export class PinnedSavedReferenceTailSource implements ReferenceTailPort {
  private readonly cached = new Map<string, Cached>();
  private cachedBytes = 0;
  constructor(
    private readonly source: AuthorizedSavedTailBytesPort,
    private readonly signal: AbortSignal,
    private readonly maximumCachedObjects: number,
    private readonly maximumCachedBytes: number,
  ) {
    if (
      !source || !signal || !Number.isSafeInteger(maximumCachedObjects) ||
      maximumCachedObjects < 1 || maximumCachedObjects > 64 ||
      !Number.isSafeInteger(maximumCachedBytes) || maximumCachedBytes < 1 ||
      maximumCachedBytes > 40 * 1024 * 1024
    ) unavailable();
  }
  async getReferenceTail(offeringId: string): Promise<ReferenceTailSelection | null> {
    if (this.signal.aborted || typeof offeringId !== "string" || !offeringId.trim()) unavailable();
    const original = await this.source.select(offeringId);
    if (this.signal.aborted) unavailable();
    if (original === null) return null;
    const pin = snapshot(original, offeringId);
    const current = async () => {
      if (this.signal.aborted) unavailable();
      await this.source.assertCurrent(pin, this.signal);
      if (this.signal.aborted) unavailable();
    };
    await current();
    // The same verified object may serve multiple authorized offerings, but
    // its source, context and compatibility evidence must remain identical.
    const signature = nativeJsonText({
      sha256: pin.sha256,
      bytes: pin.bytes,
      maxBytes: pin.maxBytes,
      releaseSha256: pin.releaseSha256,
      compatibilitySha256: pin.compatibilitySha256,
      context: pin.context,
      evidence: pin.evidence,
    }, true);
    let prior = this.cached.get(pin.key);
    if (prior && prior.signature !== signature) unavailable();
    if (!prior) {
      if (
        this.cached.size >= this.maximumCachedObjects ||
        this.cachedBytes + pin.bytes > this.maximumCachedBytes
      ) unavailable();
      this.cachedBytes += pin.bytes;
      const value = (async () => {
        const raw = await this.source.read(pin.key, pin.bytes, this.signal);
        if (this.signal.aborted) unavailable();
        return await SavedReferenceTailProjection.bind(raw, pin);
      })();
      prior = { signature, value };
      this.cached.set(pin.key, prior);
    }
    const projection = await prior.value;
    await current();
    return Object.freeze({
      projection,
      binding: pin.binding,
      assertCurrent: current,
      assertCompatible: async (identity: Readonly<NativeObject>) => {
        await current();
        const stableIdentity = freezeDeep(cloneNativeJson(identity as NativeObject));
        await this.source.assertCompatible(pin, stableIdentity, this.signal);
        await current();
      },
    });
  }
}
