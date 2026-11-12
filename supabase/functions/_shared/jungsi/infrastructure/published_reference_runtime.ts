/** Concrete request-local assembly of separately selected reference releases. */
import { AccessError, authorizeReport } from "../application/access.ts";
import { sessionDto } from "../application/session_service.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import { PublishedReferenceTailIssuer } from "./published_reference_tail_issuer.ts";
import { PublishedReferenceCandidateScope } from "./published_reference_candidate_scope.ts";
import { ExistingReferenceCandidateScope } from "./existing_reference_candidate_scope.ts";
import type { PublishedReferenceScopeSource } from "../application/reference_candidate_access.ts";
import {
  PinnedSavedReferenceTailSource,
  SavedTailRequestBudget,
} from "./saved_reference_tail_source.ts";
import { PinnedExistingDbReferenceTailSource } from "./native_reference_db_tail.ts";
import { ImmutableReferenceReportVerifier } from "./reference_report_evidence_verifier.ts";
import {
  type PublishedReferenceRuntimeSource,
  referenceRuntimeFactory,
} from "./reference_runtime_factory.ts";

function fail(): never {
  throw new AccessError("reference_runtime_unavailable", 503);
}
/** No new configuration, publication, role, limit or data source. Existing head, storage and
 * shared request budget remain authoritative. Unselected reference sources stay disabled. */
export const publishedReferenceRuntimeSource: PublishedReferenceRuntimeSource = {
  async open(context) {
    const { request, boundary, repository, clock } = context;
    if (
      ![
        "university.analyze",
        "candidates.build",
        "report.read",
        "report.export",
        "shortlist.update",
      ].includes(request.operation)
    ) return null;
    const rid = request.params.report_id,
      owner = request.session.user.subjectId,
      signal = boundary.signal;
    if (
      typeof rid !== "string" || !rid || signal.aborted ||
      typeof repository.getReportRevision !== "function"
    ) return null;
    await context.assertActive();
    sessionDto(request.session, clock.nowUtc());
    await authorizeReport(request.session.user, rid, {
      find: (id) => repository.lookupAccess(owner, id),
    }, false);
    const owned = await repository.getReport(owner, rid);
    if (!owned || owned.owner_id !== owner || owned.report_id !== rid) return null;
    await context.assertActive();
    const binding = await context.runtime.binding(), data = await context.runtime.data();
    await context.assertActive();
    const selected = await data.referenceSelection(signal);
    if (!selected.tails.length) return null;
    const readLimits = binding.readLimits,
      repositoryLimits = binding.repositoryLimits,
      storage = binding.storage.limits;
    const maxObjects = Math.min(16, readLimits.maxRequests),
      maxBytes = Math.min(24 * 1024 * 1024, readLimits.maxBytes);
    const maxAssessments = Math.min(256, repositoryLimits.maxBatchIds);
    if (![maxObjects, maxBytes, maxAssessments].every((v) => Number.isSafeInteger(v) && v > 0)) {
      fail();
    }
    const assertAccess = async (scopeSignal: AbortSignal) => {
      if (scopeSignal.aborted) fail();
      await context.assertActive(scopeSignal);
      sessionDto(request.session, clock.nowUtc());
      if (scopeSignal.aborted) fail();
    };
    const issuer = new PublishedReferenceTailIssuer(data, assertAccess);
    const memoryBudget = new SavedTailRequestBudget(maxObjects, maxBytes);
    const saved = new PinnedSavedReferenceTailSource(
      issuer,
      signal,
      maxObjects,
      maxBytes,
      context.scopeSignal,
      memoryBudget,
    );
    const dbReader = context.runtime.referencePercentileDbReader
      ? await context.runtime.referencePercentileDbReader()
      : null;
    // The exact-pack fallback is isolated to the DB adapter; saved Storage tails
    // still require their existing explicit compatibility receipt.
    const nativeIssuer = dbReader
      ? new PublishedReferenceTailIssuer(data, assertAccess, true)
      : null;
    const native = dbReader && nativeIssuer
      ? new PinnedExistingDbReferenceTailSource(
        owner,
        nativeIssuer,
        dbReader,
        signal,
        context.scopeSignal,
        maxObjects,
        maxBytes,
        memoryBudget,
      )
      : null;
    const tail = {
      getReferenceTail: saved.getReferenceTail.bind(saved),
      ...(native ? { getNativeReferenceTail: native.getNativeReferenceTail.bind(native) } : {}),
    };
    let candidateScope: PublishedReferenceScopeSource | null = null;
    if (request.operation === "candidates.build") {
      const lease = (boundary.admission as { lease?: { expiresAtUtc?: unknown } }).lease;
      if (typeof lease?.expiresAtUtc !== "bigint") fail();
      const remaining = lease.expiresAtUtc - clock.nowUtc();
      if (remaining <= 0n) fail();
      const remainingMs = remaining / 1000n;
      const runtimeCap = Math.min(6000, storage.requestTimeoutMs);
      const maxRuntimeMilliseconds = remainingMs > BigInt(runtimeCap)
        ? runtimeCap
        : Number(remainingMs);
      if (!Number.isSafeInteger(maxRuntimeMilliseconds) || maxRuntimeMilliseconds < 1) fail();
      const maxEvidenceBytes = Math.min(65536, readLimits.maxBytes, storage.maxArtifactBytes);
      candidateScope = await PublishedReferenceCandidateScope.open(data, assertAccess, {
        usagePolicySha256: binding.references.usage_policy.sha256,
        maxRows: maxAssessments,
        maxEvidenceBytes,
        maxRuntimeMilliseconds,
      }, signal);
      // The approved descriptor and selected tail list already define the scope.
      // A second scope artifact is optional; do not require recollection or duplicate upload.
      candidateScope ??= new ExistingReferenceCandidateScope(
        data,
        assertAccess,
        selected.registrySha256,
        selected.selectionSha256,
        binding.references.usage_policy.sha256,
        binding.descriptorSha256,
        maxAssessments,
        maxEvidenceBytes,
        maxRuntimeMilliseconds,
      );
    }
    const readRevision = repository.getReportRevision.bind(repository);
    const reportEvidence = new ImmutableReferenceReportVerifier(
      maxAssessments,
      readRevision,
      native ? [issuer, native.proofIssuer] : issuer,
      async (record, scopeSignal) => {
        await context.assertActive(scopeSignal);
        sessionDto(request.session, clock.nowUtc());
        if (record.owner_id !== owner || record.report_id !== rid) fail();
        await authorizeReport(request.session.user, rid, {
          find: (id) => repository.lookupAccess(owner, id),
        }, false);
        const current = await repository.getReport(owner, rid);
        if (
          !current || current.owner_id !== owner || current.report_id !== rid ||
          current.profile_id !== record.profile_id || current.revision !== record.revision ||
          nativeJsonText(current.body, true) !== nativeJsonText(record.body, true)
        ) fail();
        await context.assertActive(scopeSignal);
        sessionDto(request.session, clock.nowUtc());
        if (native) await native.prepareReceipt(scopeSignal);
      },
    );
    await context.assertActive();
    return {
      tail,
      candidateScope,
      reportEvidence,
      ...(native ? { assertSettled: (s: AbortSignal) => native.assertSettled(s) } : {}),
    };
  },
};
/** Explicitly installed by the API entry; no locally fabricated approval is accepted. */
export const publishedReferenceFactory = referenceRuntimeFactory(publishedReferenceRuntimeSource);
