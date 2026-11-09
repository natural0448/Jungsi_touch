/** Server-side authorities for saved reference tails, derived only from the approved runtime chain.
 *
 * The approved API binding pins registry/selection/usage policy; the approved head must still match
 * on every check (SupabaseRuntimeControls.current() with its request-local reuse). Reference values
 * stay reference-only: no eligibility, ranking, admission judgment or production percentile.
 */
import { AccessError } from "../application/access.ts";
import type {
  ReferenceCandidateRequest,
  ReferenceCandidateRequirements,
  ReferenceCandidateScopePort,
} from "../application/reference_candidate_scope.ts";
import type { ReferenceProjectionAuthority } from "../application/public_response.ts";
import type { ApiExecution } from "../application/api_dispatch.ts";
import type { NativeDataProvider } from "./native_data_provider.ts";
import type { ApprovedRuntimeBinding } from "./runtime_settings.ts";

export const REFERENCE_CANDIDATE_MAXIMUM_ROWS = 256;
export const REFERENCE_CANDIDATE_MAXIMUM_EVIDENCE_BYTES = 65536;
export const REFERENCE_CANDIDATE_MAXIMUM_RUNTIME_MS = 8000;

export interface ReferenceRuntimeContext {
  binding(): Promise<ApprovedRuntimeBinding>;
  data(): Promise<NativeDataProvider>;
  assertCurrent(): Promise<void>;
}
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const HEX = /^[a-f0-9]{64}$/;

/** Builds the 4-page reference scope once the request's approved binding is loaded. */
export async function referenceCandidateScopePort(
  context: ReferenceRuntimeContext,
): Promise<ReferenceCandidateScopePort | null> {
  const data = await context.data();
  // Providers without the saved-tail capability keep the previous candidate behavior.
  if (typeof data.referenceTailPins !== "function" || !(await data.referenceTailPins())) {
    return null;
  }
  const binding = await context.binding();
  const pins = {
    sourceSha256: binding.references.registry.sha256,
    selectionSha256: binding.references.selection.sha256,
    budgetPolicySha256: binding.references.usage_policy.sha256,
    consumerReceiptSha256: binding.descriptorSha256,
  };
  if (!Object.values(pins).every((v) => typeof v === "string" && HEX.test(v))) unavailable();
  const check = async (signal: AbortSignal) => {
    if (signal.aborted) unavailable();
    await data.assertCurrentSelection(true);
    await context.assertCurrent();
    if (signal.aborted) unavailable();
  };
  return Object.freeze({
    ...pins,
    maximumRows: REFERENCE_CANDIDATE_MAXIMUM_ROWS,
    maximumEvidenceBytes: REFERENCE_CANDIDATE_MAXIMUM_EVIDENCE_BYTES,
    maximumRuntimeMilliseconds: REFERENCE_CANDIDATE_MAXIMUM_RUNTIME_MS,
    verifyAdmission: async (
      request: Readonly<ReferenceCandidateRequest>,
      admission: unknown,
      requirements: ReferenceCandidateRequirements,
      signal: AbortSignal,
    ) => {
      if (
        admission === null || admission === undefined ||
        requirements.sourceSha256 !== pins.sourceSha256 ||
        requirements.selectionSha256 !== pins.selectionSha256 ||
        requirements.budgetPolicySha256 !== pins.budgetPolicySha256 ||
        requirements.consumerReceiptSha256 !== pins.consumerReceiptSha256 ||
        requirements.requirePhysicalCancellationAndSettlement !== true ||
        !Number.isSafeInteger(request.academicYear) || typeof request.examId !== "string"
      ) unavailable();
      await check(signal);
    },
    readOfferingIds: async (
      request: Readonly<ReferenceCandidateRequest>,
      signal: AbortSignal,
    ) => {
      await check(signal);
      const ids = data.referenceTailOfferings(request.academicYear, request.examId);
      if (ids.length > REFERENCE_CANDIDATE_MAXIMUM_ROWS) unavailable();
      return ids;
    },
    // Tail and storage reads use the same request signal and per-read timeouts; nothing is queued
    // beyond this request, so there is no separate I/O left to stop here.
    cancelAndWait: async () => {},
  });
}

/** Re-delivery of saved reference fields: only values still served by the current approval. */
export function referenceProjectionAuthorityPort(context: ReferenceRuntimeContext) {
  return Object.freeze({
    resolve: async (
      _request: ApiExecution,
      result: unknown,
      admission: unknown,
      signal: AbortSignal,
    ): Promise<ReferenceProjectionAuthority | null> => {
      if (admission === null || admission === undefined || signal.aborted) return null;
      const data = await context.data();
      if (typeof data.referenceTailPins !== "function" || !(await data.referenceTailPins())) {
        return null;
      }
      await data.assertCurrentSelection(true);
      const approved = new WeakSet<object>();
      const views: Record<string, unknown>[] = [];
      const report = record(result) && record(result.report) ? result.report : result;
      if (record(report)) {
        views.push(report);
        if (record(report.read_only_snapshot)) views.push(report.read_only_snapshot);
      }
      const estimated = (p: unknown) =>
        record(p) && p.status === "reference_estimated" && p.production_allowed === false &&
        p.actual_admission_full_total_approved === false &&
        p.calculation_review_scope === "same_exam_mathematical_reference";
      for (const view of views) {
        if (record(view.analyses)) {
          for (const [id, value] of Object.entries(view.analyses)) {
            if (
              record(value) && estimated(value.reference_percentile) && data.hasReferenceTail(id)
            ) {
              approved.add(value);
            }
          }
        }
        const candidates = view.candidates;
        if (record(candidates) && Array.isArray(candidates.reference_university_groups)) {
          const all = candidates.reference_university_groups.every((group) =>
            record(group) && Array.isArray(group.offerings) &&
            group.offerings.every((row) =>
              record(row) && record(row.offering) && typeof row.offering.offering_id === "string" &&
              data.hasReferenceTail(row.offering.offering_id) && estimated(row.reference_percentile)
            )
          );
          if (all) approved.add(candidates);
        }
      }
      return Object.freeze({
        assertCurrent: async (s: AbortSignal) => {
          if (s.aborted) unavailable();
          await data.assertCurrentSelection(true);
          await context.assertCurrent();
          if (s.aborted) unavailable();
        },
        authorizes: (input: { readonly value: unknown }) =>
          record(input.value) && approved.has(input.value),
      });
    },
  });
}
