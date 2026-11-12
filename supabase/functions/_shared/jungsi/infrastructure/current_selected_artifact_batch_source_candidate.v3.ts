/** REVIEW ONLY. A single *current selected* reference-conversion artifact may serve many
 * requested rows. Historical archives and caller-supplied hashes are never runtime authority. */
import { AccessError } from "../application/access.ts";
import { requireReferenceDurableFence } from "../application/reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import { NativeDataProvider } from "./native_data_provider.ts";
import { createUnifiedBatchedReferenceTail } from "./unified_reference_tail_batch_candidate.ts";
import type {
  UnifiedGuideKey,
  UnifiedGuideRuleRead,
} from "./current_guide_unified_batch_candidate.ts";
import type { SelectedSchoolReferenceBatchSource } from "./selected_reference_issuer_batch_candidate.ts";
type Selection = Parameters<SelectedSchoolReferenceBatchSource["load"]>[3];
type Rows = Awaited<ReturnType<SelectedSchoolReferenceBatchSource["load"]>>;
/** No implementation is installed. It must independently bind the exact NativeDataProvider
 * to current registry/selection/head, owner/report/active admission, 2027 exam+pack and the
 * same controls/budget. It must verify actual artifact review, all Guide endpoints, rule/CDF,
 * original scorer/source/score axis and reference-only authorization; names or hashes alone
 * do not establish equivalence. It must also enforce all physical work stops on cancellation. */
export interface CurrentReferenceArtifactAuthority {
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    provider: NativeDataProvider,
    artifactKey: string,
    keys: readonly UnifiedGuideKey[],
    selection: Selection,
  ): Promise<void>;
  assertBound(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    provider: NativeDataProvider,
    artifactKey: string,
    keys: readonly UnifiedGuideKey[],
    selection: Selection,
    guide: readonly UnifiedGuideRuleRead[],
    rows: Rows,
  ): Promise<void>;
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
function fail(): never {
  throw new AccessError("reference_tail_unavailable", 503);
}
export class CurrentSelectedArtifactBatchSource implements SelectedSchoolReferenceBatchSource {
  private loaded:
    | Readonly<
      {
        request: ApiExecution;
        boundary: ApiExecutionBoundary;
        selection: Selection;
        keys: readonly UnifiedGuideKey[];
        rows: Rows;
      }
    >
    | null = null;
  private started = false;
  constructor(
    private readonly provider: NativeDataProvider,
    private readonly artifactKey: string,
    private readonly authority: CurrentReferenceArtifactAuthority,
  ) {
    if (
      !(provider instanceof NativeDataProvider) || typeof artifactKey !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(artifactKey) || !authority ||
      typeof authority.assertCurrent !== "function" ||
      typeof authority.assertBound !== "function" ||
      typeof authority.awaitQuiescence !== "function"
    ) fail();
  }
  async load(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    keys: readonly UnifiedGuideKey[],
    selection: Selection,
  ): Promise<Rows> {
    requireReferenceDurableFence();
    if (
      this.started || !request || !boundary?.admission || !boundary.signal ||
      boundary.signal.aborted ||
      !Array.isArray(keys) || keys.length < 1 || keys.length > 64 || !selection
    ) fail();
    this.started = true;
    const signal = boundary.signal,
      admission = boundary.admission,
      session = request.session,
      user = session.user;
    const same = () => {
      if (
        signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
        request.session !== session || session.user !== user
      ) fail();
    };
    const ids = Object.freeze(keys.map((k) => {
      if (
        k.academicYear !== 2027 || typeof k.offeringPk !== "string" ||
        !/^[1-9][0-9]{0,18}$/.test(k.offeringPk)
      ) fail();
      return "2027:" + k.offeringPk;
    }));
    if (new Set(ids).size !== ids.length) fail();
    await this.authority.assertCurrent(
      request,
      boundary,
      this.provider,
      this.artifactKey,
      keys,
      selection,
    );
    same();
    const current = await this.provider.referenceSelection(signal);
    same();
    if (
      current.registrySha256 !== selection.registrySha256 ||
      current.selectionSha256 !== selection.selectionSha256 ||
      current.approvalReferenceSha256 !== selection.approvalReferenceSha256
    ) fail();
    const rows = await this.provider.getReferenceBatchFromSelectedArtifact(
      this.artifactKey,
      ids,
      signal,
    );
    same();
    await this.authority.assertCurrent(
      request,
      boundary,
      this.provider,
      this.artifactKey,
      keys,
      selection,
    );
    same();
    this.loaded = Object.freeze({ request, boundary, selection, keys, rows });
    return rows;
  }
  async assertBound(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    selection: Selection,
    guide: readonly UnifiedGuideRuleRead[],
    rows: Rows,
  ): Promise<void> {
    const s = this.loaded;
    if (
      !s || s.request !== request || s.boundary !== boundary || s.selection !== selection ||
      s.rows !== rows ||
      boundary.signal.aborted || !Array.isArray(guide) || guide.length !== rows.length
    ) fail();
    await this.authority.assertCurrent(
      request,
      boundary,
      this.provider,
      this.artifactKey,
      s.keys,
      selection,
    );
    await this.authority.assertBound(
      request,
      boundary,
      this.provider,
      this.artifactKey,
      s.keys,
      selection,
      guide,
      rows,
    );
    await this.authority.assertCurrent(
      request,
      boundary,
      this.provider,
      this.artifactKey,
      s.keys,
      selection,
    );
    if (boundary.signal.aborted) fail();
  }
  async awaitQuiescence(signal: AbortSignal): Promise<void> {
    await this.authority.awaitQuiescence(signal);
  }
}

/** Concrete composition into the existing 6075+6/CDF factory; no issuer is invented. */
export async function createCurrentSelectedArtifactReferenceTail(
  input: Omit<
    import("./selected_reference_issuer_batch_candidate.ts").ReferenceIssuerBatchInput,
    "source"
  >,
  artifactKey: string,
  authority: CurrentReferenceArtifactAuthority,
  cdf: import("./reference_cdf_batch_reader_candidate.ts").CdfBatchInputs,
  tailBudget: import("./saved_reference_tail_source.ts").SavedTailRequestBudget,
) {
  if (!input || !(input.base instanceof NativeDataProvider) || !tailBudget) fail();
  const source = new CurrentSelectedArtifactBatchSource(input.base, artifactKey, authority);
  return await createUnifiedBatchedReferenceTail(
    { ...input, source },
    cdf,
    tailBudget.maximumObjects,
    tailBudget.maximumBytes,
    tailBudget,
  );
}
