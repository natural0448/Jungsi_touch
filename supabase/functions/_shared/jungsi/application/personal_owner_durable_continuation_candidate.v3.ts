/** REVIEW ONLY: one newly admitted server worker turn and atomic durable continuation.
 * No queue consumer, outbox store, writer, DB/R2 binding or issuer is installed here. */
import { AccessError } from "./access.ts";
import {
  requireReferenceDurableFence,
  requireVoidDrains,
} from "./reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import {
  type PersonalOwnerStorageIdentity,
  type PersonalOwnerStorageScopePorts,
  withVerifiedPersonalOwnerStorageScope,
} from "./personal_owner_storage_scope_candidate.ts";
import {
  type PersonalOwnerCacheClaim,
  type PersonalOwnerCacheDurableWork,
  type PersonalOwnerCacheTurnResult,
  type PersonalOwnerCacheWorkAuthority,
  type PersonalOwnerCacheWorkGrant,
  type PersonalOwnerCacheWorkPorts,
  runPersonalOwnerCacheBoundedTurn,
  type StudentCacheChunkItem,
} from "./personal_owner_cache_bounded_workflow_candidate.ts";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
export type OwnerContinuationLease = Readonly<
  {
    ownerUuid: string;
    profileId: string;
    reportId: string;
    reportRevision: number;
    jobId: string;
    generation: string;
    sourcePinSha256: string;
    expectedVersion: string | null;
    phase: "BUILDING" | "READY_TO_PUBLISH";
    publicationMode: "owner_code" | "verified_self_student_name";
    maxChunk: number;
    receipt: object;
  }
>;
/** Server-owned queue/authorization issuer; no implementation is installed. It verifies the
 * opaque delivery, actual owner/report/profile/revision, current source/head and generation,
 * actual fresh per-turn admission/budget, previous physical termination and durable receipt.
 * It must refuse a client-supplied boolean, ID or digest as authority and recheck revocation. */
export interface OwnerContinuationAuthority {
  open(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    identity: PersonalOwnerStorageIdentity,
    delivery: unknown,
  ): Promise<OwnerContinuationLease>;
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    identity: PersonalOwnerStorageIdentity,
    lease: OwnerContinuationLease,
    grant: PersonalOwnerCacheWorkGrant | null,
    claim: PersonalOwnerCacheClaim | null,
  ): Promise<void>;
  /** Checks actual verified self-student name/policy when exact UUID_name filename is required.
   * No student identity/name means file-only pending, never a guessed member name.
   * Permission failures or unavailable authority must throw, never be collapsed into false. */
  fileReady(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    identity: PersonalOwnerStorageIdentity,
    lease: OwnerContinuationLease,
  ): Promise<boolean>;
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
/** Server-owned atomic backend contract, not implemented by this adapter. The immutable chunk,
 * progress/cursor, coverage and a BLOCKED next-turn outbox row must commit together. The backend
 * arms the outbox only in finishAndArm after physical termination and an atomic current-generation
 * check; stale, aborted, conflicted or UNKNOWN turns never arm it. Claim, publication and outbox
 * must use the same owner/report/profile/source fence and expected previous object/version CAS.
 * Lost outcomes remain UNKNOWN for explicit durable reconciliation; no automatic retry. */
export interface AtomicOwnerContinuationStore {
  /** Preserve the exact job/receipt durably when a verified filename is unavailable; no writer starts. */
  holdFilePending(
    lease: OwnerContinuationLease,
    signal: AbortSignal,
  ): Promise<"held" | "already_held">;
  claimForLease(
    grant: PersonalOwnerCacheWorkGrant,
    lease: OwnerContinuationLease,
    signal: AbortSignal,
  ): Promise<PersonalOwnerCacheClaim>;
  reusable: PersonalOwnerCacheDurableWork["reusable"];
  appendChunkAndBlockedOutbox(
    grant: PersonalOwnerCacheWorkGrant,
    claim: PersonalOwnerCacheClaim,
    lease: OwnerContinuationLease,
    items: readonly StudentCacheChunkItem[],
    next: string | null,
    signal: AbortSignal,
  ): Promise<"committed" | "already_committed" | "conflict">;
  /** Must resolve the approved logical filename under server-owned identity proof; incomplete,
   * name-pending, stale or unknown generations never update the current pointer. */
  publishCompleteIfCurrent: PersonalOwnerCacheDurableWork["publishCompleteIfCurrent"];
  finishAndArmOutbox(
    grant: PersonalOwnerCacheWorkGrant,
    claim: PersonalOwnerCacheClaim,
    lease: OwnerContinuationLease,
    disposition: "safe" | "unknown",
    arm: "arm" | "hold",
    signal: AbortSignal,
  ): Promise<void>;
}
export type OwnerContinuationResult =
  | PersonalOwnerCacheTurnResult
  | Readonly<{ state: "file_pending"; completedRows: null; totalRows: null }>;
/** One call = one authenticated, separately budgeted worker turn. It never loops over pages,
 * invokes a queue directly, creates a new budget, or retries unknown writes. */
export async function runVerifiedOwnerContinuationTurn(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  input: Readonly<{ reportId: string; profileId: string; reportRevision: number }>,
  delivery: unknown,
  ownerScope: PersonalOwnerStorageScopePorts,
  continuation: OwnerContinuationAuthority,
  workAuthority: PersonalOwnerCacheWorkAuthority,
  base: Omit<PersonalOwnerCacheWorkPorts, "work">,
  store: AtomicOwnerContinuationStore,
): Promise<OwnerContinuationResult> {
  requireReferenceDurableFence();
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    !ownerScope ||
    !continuation || typeof continuation.open !== "function" ||
    typeof continuation.assertCurrent !== "function" ||
    typeof continuation.fileReady !== "function" ||
    typeof continuation.awaitQuiescence !== "function" ||
    !workAuthority || !base?.scope || !base.calculator || !store ||
    typeof store.holdFilePending !== "function" ||
    typeof store.claimForLease !== "function" ||
    typeof store.reusable !== "function" ||
    typeof store.appendChunkAndBlockedOutbox !== "function" ||
    typeof store.publishCompleteIfCurrent !== "function" ||
    typeof store.finishAndArmOutbox !== "function"
  ) fail();
  const signal = boundary.signal, admission = boundary.admission, session = request.session;
  const same = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session !== session
    ) fail();
  };
  try {
    return await withVerifiedPersonalOwnerStorageScope(
      request,
      boundary,
      input,
      ownerScope,
      async (identity) => {
        const lease = await continuation.open(request, boundary, identity, delivery);
        same();
        if (
          !lease || !Object.isFrozen(lease) || lease.ownerUuid !== identity.ownerUuid ||
          lease.profileId !== identity.profileId ||
          lease.reportId !== identity.reportId ||
          lease.reportRevision !== identity.reportRevision ||
          !ID.test(lease.jobId) || !ID.test(lease.generation) ||
          !HASH.test(lease.sourcePinSha256) ||
          !(lease.expectedVersion === null || ID.test(lease.expectedVersion)) ||
          !["BUILDING", "READY_TO_PUBLISH"].includes(lease.phase) ||
          !["owner_code", "verified_self_student_name"].includes(lease.publicationMode) ||
          !Number.isSafeInteger(lease.maxChunk) ||
          lease.maxChunk < 1 || lease.maxChunk > 64 || !lease.receipt ||
          typeof lease.receipt !== "object" ||
          !Object.isFrozen(lease.receipt)
        ) fail();
        const current = async (
          grant: PersonalOwnerCacheWorkGrant | null,
          claim: PersonalOwnerCacheClaim | null,
        ) => {
          same();
          await continuation.assertCurrent(request, boundary, identity, lease, grant, claim);
          same();
        };
        await current(null, null);
        // Existing workflow constructs an owner-code filename. Named mode remains pending until
        // a separately reviewed workflow binds its actual verified filename through final CAS.
        if (
          lease.phase === "READY_TO_PUBLISH" &&
          (lease.publicationMode === "verified_self_student_name" ||
            await continuation.fileReady(request, boundary, identity, lease) !== true)
        ) {
          await current(null, null);
          const held = await store.holdFilePending(lease, signal);
          if (held !== "held" && held !== "already_held") fail();
          await current(null, null);
          return Object.freeze({
            state: "file_pending" as const,
            completedRows: null,
            totalRows: null,
          });
        }
        let pendingConfirmation: "append" | "publish" | null = null;
        let confirmedProgress = false, confirmedPublication = false, physicalStopped = false;
        const guard: PersonalOwnerCacheWorkAuthority = {
          issue: async (r, b, i) => {
            if (r !== request || b !== boundary || i !== identity) fail();
            const grant = await workAuthority.issue(r, b, i);
            await current(grant, null);
            if (
              grant.kind !== "personal_owner" || grant.ownerUuid !== lease.ownerUuid ||
              grant.profileId !== lease.profileId ||
              grant.reportId !== lease.reportId || grant.reportRevision !== lease.reportRevision ||
              grant.pins.sourceSha256 !== lease.sourcePinSha256 || grant.maxChunk > lease.maxChunk
            ) fail();
            return grant;
          },
          assertCurrent: async (r, b, g, c, p) => {
            await current(g, c);
            await workAuthority.assertCurrent(r, b, g, c, p);
            await current(g, c);
            if (pendingConfirmation === "append") confirmedProgress = true;
            else if (pendingConfirmation === "publish") confirmedPublication = true;
            pendingConfirmation = null;
          },
          fingerprints: (g, c, keys, s) => workAuthority.fingerprints(g, c, keys, s),
          awaitQuiescence: async (g, c, s) => {
            await Promise.all([
              workAuthority.awaitQuiescence(g, c, s),
              continuation.awaitQuiescence(s),
              ownerScope.awaitQuiescence(s),
            ]);
            physicalStopped = true;
          },
        };
        const work: PersonalOwnerCacheDurableWork = {
          claim: async (g, s) => {
            await current(g, null);
            const c = await store.claimForLease(g, lease, s);
            if (
              c.jobId !== lease.jobId || c.phase !== lease.phase ||
              c.expectedVersion !== lease.expectedVersion
            ) fail();
            await current(g, c);
            return c;
          },
          reusable: (g, c, f, s) => store.reusable(g, c, f, s),
          appendChunkIfClaimed: async (g, c, items, next, s) => {
            await current(g, c);
            const result = await store.appendChunkAndBlockedOutbox(g, c, lease, items, next, s);
            if (result === "committed" || result === "already_committed") {
              pendingConfirmation = "append";
            }
            return result;
          },
          publishCompleteIfCurrent: async (g, c, name, s) => {
            await current(g, c);
            if (lease.publicationMode !== "owner_code") fail();
            const result = await store.publishCompleteIfCurrent(g, c, name, s);
            if (result === "committed" || result === "already_committed") {
              pendingConfirmation = "publish";
            }
            return result;
          },
          finishTurn: (g, c, disposition, s) => {
            const safe = disposition === "safe" && !s.aborted && physicalStopped &&
              (confirmedProgress || confirmedPublication) && pendingConfirmation === null;
            return store.finishAndArmOutbox(
              g,
              c,
              lease,
              safe ? "safe" : "unknown",
              safe && confirmedProgress ? "arm" : "hold",
              s,
            );
          },
        };
        return await runPersonalOwnerCacheBoundedTurn(
          request,
          boundary,
          identity,
          guard,
          Object.freeze({ scope: base.scope, calculator: base.calculator, work }),
        );
      },
    );
  } finally {
    await requireVoidDrains([() => continuation.awaitQuiescence(signal)]);
  }
}
