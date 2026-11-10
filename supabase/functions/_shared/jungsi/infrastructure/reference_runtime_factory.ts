/** Server composition of separately published reference data and existing report services. */
import type { ReferenceTailPort } from "../application/reference_percentile.ts";
import {
  type PublishedReferenceScopeSource,
  referenceCandidateAccess,
} from "../application/reference_candidate_access.ts";
import {
  type ReferenceReportEvidenceVerifier,
  resolveReferenceReportProjection,
} from "../application/reference_report_projection.ts";
import type { RuntimeReferenceFactory } from "./runtime_reference_ports.ts";

/** Implemented by the data owner. open() must select an explicitly published reference-tail
 * release from the actual current head, use the request-local read budget and propagate abort.
 * An unpublished local manifest and factory configuration alone never constitute approval. */
export interface PublishedReferenceRuntimeSource {
  open(input: Parameters<RuntimeReferenceFactory["create"]>[0]): Promise<
    {
      readonly tail: ReferenceTailPort;
      readonly candidateScope: PublishedReferenceScopeSource | null;
      readonly reportEvidence: ReferenceReportEvidenceVerifier;
      /** Previously verified, request-bound proof only; never performs I/O. */
      readonly assertSettled?: (signal: AbortSignal) => void;
    } | null
  >;
}
export function referenceRuntimeFactory(
  source: PublishedReferenceRuntimeSource,
): RuntimeReferenceFactory {
  return {
    async create(context) {
      await context.assertActive();
      const selected = await source.open(context);
      await context.assertActive();
      if (selected === null) return null;
      const candidateScope =
        context.request.operation === "candidates.build" && selected.candidateScope
          ? referenceCandidateAccess({
            request: context.request,
            boundary: context.boundary,
            repository: context.repository,
            catalog: context.catalog,
            clock: context.clock,
            source: selected.candidateScope,
            assertActive: context.assertActive,
          })
          : null;
      return {
        tail: selected.tail,
        candidateScope,
        projectionAuthority: {
          async resolve(request, result, admission, signal) {
            if (
              request !== context.request || admission !== context.boundary.admission ||
              signal !== context.boundary.signal
            ) return null;
            return await resolveReferenceReportProjection({
              request,
              result,
              signal,
              repository: context.repository,
              workflow: context.workflow,
              clock: context.clock,
              verifier: selected.reportEvidence,
              assertActive: context.assertActive,
              assertReceipt: () => {
                context.assertReceipt();
                selected.assertSettled?.(context.boundary.signal);
              },
            });
          },
        },
      };
    },
  };
}
