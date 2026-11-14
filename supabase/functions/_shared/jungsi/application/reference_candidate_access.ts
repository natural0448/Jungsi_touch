/** Binds an independently published reference selection to the existing owned report. */
import { AccessError, authorizeReport } from "./access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { CatalogService } from "./catalog.ts";
import type { PlatformRepositoryPort } from "./platform_repository.ts";
import type { RequestClockPort } from "./ports.ts";
import type {
  ReferenceCandidateRequest,
  ReferenceCandidateRequirements,
  ReferenceCandidateScopePort,
} from "./reference_candidate_scope.ts";
import { requirePaidSession } from "./session_service.ts";
import { JsonFloat } from "../domain/native_json.ts";
import type { NativeObject } from "../domain/json_value.ts";

/** The issuer must bind these pins and limits to the separately approved current selection,
 * prove source/model/score-axis compatibility, and physically stop all started I/O on cancel.
 * A local candidate, matching hash or the existence of this interface is never approval. */
export interface PublishedReferenceScopeSource {
  readonly sourceSha256: string;
  readonly selectionSha256: string;
  readonly budgetPolicySha256: string;
  readonly consumerReceiptSha256: string;
  readonly maximumRows: number;
  readonly maximumEvidenceBytes: number;
  readonly maximumRuntimeMilliseconds: number;
  assertCurrent(request: Readonly<ReferenceCandidateRequest>, signal: AbortSignal): Promise<void>;
  offeringIds(
    request: Readonly<ReferenceCandidateRequest>,
    signal: AbortSignal,
    maximumBytes: number,
  ): Promise<readonly string[]>;
  cancelAndWait(): Promise<void>;
}
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function object(value: unknown): value is NativeObject {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof JsonFloat);
}
function signalLive(signal: AbortSignal): void {
  if (!signal || signal.aborted) fail();
}

/** Runs only inside the existing budget callback; does not create a separate lease or storage. */
export function referenceCandidateAccess(input: {
  readonly request: ApiExecution;
  readonly boundary: ApiExecutionBoundary;
  readonly repository: Pick<PlatformRepositoryPort, "getReport" | "lookupAccess">;
  readonly catalog: CatalogService;
  readonly clock: RequestClockPort;
  readonly source: PublishedReferenceScopeSource;
  readonly assertActive: (signal?: AbortSignal) => Promise<void>;
}): ReferenceCandidateScopePort {
  const { request, boundary, repository, catalog, clock, source, assertActive } = input;
  if (
    request.operation !== "candidates.build" || !boundary.admission || boundary.signal.aborted ||
    !source || typeof source.assertCurrent !== "function" ||
    typeof source.offeringIds !== "function" ||
    typeof source.cancelAndWait !== "function" || typeof assertActive !== "function"
  ) fail();
  const pins = Object.freeze({
    sourceSha256: source.sourceSha256,
    selectionSha256: source.selectionSha256,
    budgetPolicySha256: source.budgetPolicySha256,
    consumerReceiptSha256: source.consumerReceiptSha256,
    maximumRows: source.maximumRows,
    maximumEvidenceBytes: source.maximumEvidenceBytes,
    maximumRuntimeMilliseconds: source.maximumRuntimeMilliseconds,
  });
  const current = source.assertCurrent.bind(source),
    read = source.offeringIds.bind(source),
    cancel = source.cancelAndWait.bind(source);
  let verifiedScope: Readonly<ReferenceCandidateRequest> | null = null;
  const verify = async (
    scope: Readonly<ReferenceCandidateRequest>,
    admission: unknown,
    requirements: ReferenceCandidateRequirements,
    signal: AbortSignal,
  ) => {
    verifiedScope = null;
    signalLive(signal);
    if (
      admission !== boundary.admission || request.params.report_id !== scope.reportId ||
      request.session.user.subjectId !== scope.subjectId ||
      Object.entries(pins).some(([key, value]) =>
        requirements[key as keyof typeof pins] !== value
      ) ||
      requirements.requirePhysicalCancellationAndSettlement !== true
    ) fail();
    await assertActive(signal);
    requirePaidSession(request.session, clock.nowUtc());
    signalLive(signal);
    await authorizeReport(request.session.user, scope.reportId, {
      find: (id) => repository.lookupAccess(scope.subjectId, id),
    }, true);
    signalLive(signal);
    // Serialize these reads so a fast failure never leaves the other request in flight.
    const record = await repository.getReport(scope.subjectId, scope.reportId);
    signalLive(signal);
    const release = await catalog.catalog();
    signalLive(signal);
    const overall = record?.body?.overall;
    if (
      !record || record.owner_id !== scope.subjectId || record.report_id !== scope.reportId ||
      record.profile_id !== scope.profileId || record.revision !== scope.reportRevision ||
      !object(overall) || !object(overall.exam) ||
      overall.exam.academic_year !== scope.academicYear ||
      overall.exam.exam_id !== scope.examId || overall.score_basis !== scope.scoreBasis ||
      !release || release.status !== "approved" || release.version !== scope.catalogVersion
    ) fail();
    await current(scope, signal);
    signalLive(signal);
    await assertActive(signal);
    requirePaidSession(request.session, clock.nowUtc());
    signalLive(signal);
    verifiedScope = scope;
  };
  return Object.freeze({
    ...pins,
    verifyAdmission: verify,
    readOfferingIds: async (
      scope: Readonly<ReferenceCandidateRequest>,
      signal: AbortSignal,
      maximumBytes: number,
    ) => {
      signalLive(signal);
      if (scope !== verifiedScope || maximumBytes !== pins.maximumEvidenceBytes) fail();
      await assertActive(signal);
      await current(scope, signal);
      signalLive(signal);
      const ids = await read(scope, signal, maximumBytes);
      signalLive(signal);
      await current(scope, signal);
      signalLive(signal);
      await assertActive(signal);
      signalLive(signal);
      return ids;
    },
    cancelAndWait: async () => await cancel(),
  });
}
