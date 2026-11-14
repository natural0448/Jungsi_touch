/** Review-only transition: caller must load and verify the owned current report revision. */
import { AccessError } from "../application/access.ts";
import type { ReferenceProjectionAuthority } from "../application/public_response.ts";
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import type { StoredReport } from "../application/platform_repository.ts";
import {
  combineLegacyAndProven,
  verifiedLegacyAssessments,
  verifiedLegacyCandidates,
} from "./legacy_reference_carryover.ts";

function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
type Receipt = Readonly<{ assertCurrent(): void }>;

/** Never interpret a failed new-proof verification as evidence absence. */
export async function resolveReferenceTransition(input: {
  readonly signal: AbortSignal;
  /** Must authenticate, check ownership, and read the matching current report ID/profile/revision. */
  readonly readOwnedCurrent: () => Promise<Readonly<{ body: Readonly<NativeObject> }> | null>;
  /** Owner-scoped immutable revision reads must use the existing reservation and cancellation. */
  readonly readRevision?: (
    record: StoredReport,
    revision: number,
    signal: AbortSignal,
  ) => Promise<StoredReport | null>;
  readonly resolveLegacy: () => Promise<ReferenceProjectionAuthority | null>;
  readonly resolveProven: () => Promise<ReferenceProjectionAuthority | null>;
  /** Capture a head receipt during the active reservation using the actual physical read start. */
  readonly captureReceipt: (signal: AbortSignal) => Promise<Receipt>;
  /** Synchronous existing request/lease/session check; must not perform I/O. */
  readonly assertSettledRequest: (signal: AbortSignal) => void;
}): Promise<ReferenceProjectionAuthority | null> {
  const { signal } = input;
  if (!signal || signal.aborted) unavailable();
  const record = await input.readOwnedCurrent();
  if (signal.aborted) unavailable();
  if (!record) return null;
  const original = nativeJsonText(record.body as NativeObject, true);
  const stored = typeof (record as Partial<StoredReport>).revision === "number"
    ? record as StoredReport
    : null;
  // Compare even an apparently legacy current record with its immutable revision.
  // Otherwise deleting its first evidence object could be mistaken for legacy.
  let currentImmutable: StoredReport | null = null;
  if (stored && input.readRevision) {
    const immutable = await input.readRevision(stored, stored.revision, signal);
    if (
      !immutable || immutable.owner_id !== stored.owner_id ||
      immutable.report_id !== stored.report_id ||
      immutable.profile_id !== stored.profile_id || immutable.revision !== stored.revision ||
      nativeJsonText(immutable.body as NativeObject, true) !== original || signal.aborted
    ) return null;
    currentImmutable = immutable;
  }
  let legacy: ReferenceProjectionAuthority | null = null;
  const wrapLegacy = (): ReferenceProjectionAuthority | null => {
    const selectedLegacy = legacy;
    if (!selectedLegacy) return null;
    let receipt: Receipt | null = null;
    return Object.freeze({
      async assertCurrent(current: AbortSignal) {
        if (current !== signal || signal.aborted) unavailable();
        await selectedLegacy.assertCurrent(signal);
        if (signal.aborted) unavailable();
        const currentRecord = await input.readOwnedCurrent();
        if (
          !currentRecord || nativeJsonText(currentRecord.body as NativeObject, true) !== original ||
          signal.aborted
        ) unavailable();
        receipt = await input.captureReceipt(signal);
        if (signal.aborted) unavailable();
        receipt.assertCurrent();
      },
      assertSettled(current: AbortSignal) {
        if (current !== signal || signal.aborted || !receipt) unavailable();
        input.assertSettledRequest(signal);
        receipt.assertCurrent();
      },
      authorizes: selectedLegacy.authorizes.bind(selectedLegacy),
    });
  };
  if (!Object.hasOwn(record.body, "_reference_evidence")) {
    // A missing field after a previous evidence-bearing revision is deletion, never legacy.
    if (stored && input.readRevision && stored.revision > 1) {
      const previous = await input.readRevision(stored, stored.revision - 1, signal);
      if (
        !previous || previous.owner_id !== stored.owner_id ||
        previous.report_id !== stored.report_id ||
        previous.profile_id !== stored.profile_id || previous.revision !== stored.revision - 1 ||
        Object.hasOwn(previous.body, "_reference_evidence")
      ) return null;
    }
    legacy = await input.resolveLegacy();
    return wrapLegacy();
  }
  // Any malformed or null evidence remains on the new-verifier path.
  const proven = await input.resolveProven();
  if (!stored || !input.readRevision) return proven;
  // Share in-flight immutable reads among assessment and candidate checks.
  const cache = new Map<number, Promise<StoredReport | null>>();
  if (currentImmutable) cache.set(stored.revision, Promise.resolve(currentImmutable));
  const read = (revision: number, s: AbortSignal) => {
    let value = cache.get(revision);
    if (!value) {
      value = input.readRevision!(stored, revision, s);
      cache.set(revision, value);
    }
    return value;
  };
  const allowed = await verifiedLegacyAssessments(stored, signal, read);
  const allowedCandidates = await verifiedLegacyCandidates(stored, signal, read);
  if (!allowed.size && allowedCandidates === null) return proven;
  legacy = await input.resolveLegacy();
  const wrapped = wrapLegacy();
  if (!wrapped) return proven;
  return combineLegacyAndProven(wrapped, proven, allowed, allowedCandidates);
}
