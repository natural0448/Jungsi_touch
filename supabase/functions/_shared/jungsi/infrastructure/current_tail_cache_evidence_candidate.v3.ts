/** REVIEW ONLY: CDF tail evidence composed after owned cache read. Missing issuance closes access. */
import { AccessError } from "../application/access.ts";
import { requireVoidDrains } from "../application/reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type { RequestClockPort } from "../application/ports.ts";
import type { NativeReferenceTailSelection } from "../application/reference_percentile.ts";
import { createUnifiedBatchedReferenceTail } from "./unified_reference_tail_batch_candidate.ts";
import type { ReferenceIssuerBatchInput } from "./selected_reference_issuer_batch_candidate.ts";
import type { CdfBatchInputs } from "./reference_cdf_batch_reader_candidate.ts";
import type {
  ReferenceBatchEvidenceAuthority,
  ReferenceBatchScope,
} from "./student_reference_batch_provider_candidate.ts";
import { SavedTailRequestBudget } from "./saved_reference_tail_source.ts";
import type { PinnedExistingDbReferenceTailSource } from "./native_reference_db_tail.ts";
import type { SupabaseSqlTransport } from "./transaction_sql.ts";
import type {
  BatchMetadataBudget,
  BatchMetadataKey,
} from "./reference_percentile_metadata_batch.review-only.ts";

export type TailSelection = Readonly<
  { key: BatchMetadataKey; selection: NativeReferenceTailSelection | null }
>;
/** Concrete implementation still needed: independently bind each exact cached conversion/profile,
 * academic-year/PK, rule, model and CDF to the selected tail. A cache value is not proof. */
export interface CurrentTailCacheAuthority {
  issue(
    scope: ReferenceBatchScope,
    selections: readonly TailSelection[],
    tail: PinnedExistingDbReferenceTailSource,
  ): Promise<
    Readonly<{
      allowedOfferingIds: readonly string[];
      receipt: object;
    }>
  >;
  assertCurrent(
    scope: ReferenceBatchScope,
    selections: readonly TailSelection[],
    receipt: object,
    tail: PinnedExistingDbReferenceTailSource,
  ): Promise<void>;
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
type IssuerConfig = Omit<
  ReferenceIssuerBatchInput,
  "request" | "boundary" | "keys" | "sql" | "clock" | "budget" | "base" | "assertAccess"
>;
type CdfConfig = Omit<CdfBatchInputs, "request" | "boundary" | "owner" | "keys" | "sql" | "budget">;
export type BoundTailInputs = Readonly<{
  /** Server factory only; must not start or schedule I/O. */
  resolve(
    scope: ReferenceBatchScope,
    keys: readonly BatchMetadataKey[],
  ): Readonly<{ issuer: IssuerConfig; cdf: CdfConfig }>;
  authority: CurrentTailCacheAuthority;
  tailBudget: SavedTailRequestBudget;
}>;
type Issued = Awaited<ReturnType<ReferenceBatchEvidenceAuthority["issue"]>>;
type State = Readonly<
  {
    scope: ReferenceBatchScope;
    issued: Issued;
    innerIssued: Issued;
    selected: readonly TailSelection[];
    receipt: object;
    tail: PinnedExistingDbReferenceTailSource;
  }
>;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
/** Request instance: uses actual runtime sql, NativeDataProvider and controls, never client values. */
export class CurrentTailBoundEvidence implements ReferenceBatchEvidenceAuthority {
  private state: State | null = null;
  private started = false;
  constructor(
    private readonly inner: ReferenceBatchEvidenceAuthority,
    private readonly inputs: BoundTailInputs,
    private readonly sql: SupabaseSqlTransport,
    private readonly clock: RequestClockPort,
    private readonly base: ReferenceIssuerBatchInput["base"],
    private readonly budget: BatchMetadataBudget,
    private readonly assertAccess: (
      request: ApiExecution,
      boundary: ApiExecutionBoundary,
    ) => Promise<void>,
  ) {
    if (
      !inner || !inputs || typeof inputs.resolve !== "function" || !inputs.authority ||
      typeof inputs.authority.issue !== "function" ||
      typeof inputs.authority.assertCurrent !== "function" ||
      typeof inputs.authority.awaitQuiescence !== "function" ||
      !(inputs.tailBudget instanceof SavedTailRequestBudget) ||
      !sql || !clock || !base || !budget || typeof assertAccess !== "function"
    ) fail();
  }
  assertContext(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    rows: ReferenceBatchScope["rows"],
  ): Promise<void> {
    return this.inner.assertContext(request, boundary, rows);
  }
  assertMetadataHead(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    head: Parameters<ReferenceBatchEvidenceAuthority["assertMetadataHead"]>[2],
  ): Promise<void> {
    return this.inner.assertMetadataHead(request, boundary, head);
  }
  async issue(scope: ReferenceBatchScope): Promise<Issued> {
    if (this.started || !scope || !scope.boundary?.admission || scope.boundary.signal.aborted) {
      fail();
    }
    this.started = true;
    const request = scope.request, boundary = scope.boundary, signal = boundary.signal;
    await this.assertAccess(request, boundary);
    // Existing per-request 64-object maximum is retained. Remaining keys are per-row pending.
    const keys = Object.freeze(
      scope.keys.slice(0, Math.min(64, this.inputs.tailBudget.maximumObjects))
        .map((k) => Object.freeze({ schoolId: k.schoolId, offeringPk: k.offeringPk })),
    );
    if (!keys.length) fail();
    const spec = this.inputs.resolve(scope, keys);
    if (
      !spec || typeof (spec as { then?: unknown }).then === "function" || !spec.issuer || !spec.cdf
    ) fail();
    const issuer: ReferenceIssuerBatchInput = Object.freeze({
      ...spec.issuer,
      request,
      boundary,
      keys: Object.freeze(
        keys.map((k) => Object.freeze({ academicYear: 2027 as const, offeringPk: k.offeringPk })),
      ),
      sql: this.sql,
      clock: this.clock,
      budget: this.budget,
      base: this.base,
      assertAccess: async (s: AbortSignal) => {
        if (s !== signal || s.aborted) fail();
        await this.assertAccess(request, boundary);
      },
    });
    const cdf: CdfBatchInputs = Object.freeze({
      ...spec.cdf,
      request,
      boundary,
      owner: request.session.user.subjectId,
      keys,
      sql: this.sql,
      budget: this.budget,
    });
    const bundle = await createUnifiedBatchedReferenceTail(
      issuer,
      cdf,
      this.inputs.tailBudget.maximumObjects,
      this.inputs.tailBudget.maximumBytes,
      this.inputs.tailBudget,
    );
    await this.assertAccess(request, boundary);
    const selected: TailSelection[] = [];
    for (const key of keys) {
      const selection = await bundle.tail.getNativeReferenceTail("2027:" + key.offeringPk, signal);
      if (signal.aborted) fail();
      selected.push(Object.freeze({ key, selection }));
    }
    const frozen = Object.freeze(selected);
    const permit = await this.inputs.authority.issue(scope, frozen, bundle.tail);
    if (
      !permit || !Object.isFrozen(permit) || !Array.isArray(permit.allowedOfferingIds) ||
      !Object.isFrozen(permit.allowedOfferingIds) || !permit.receipt ||
      typeof permit.receipt !== "object" ||
      !Object.isFrozen(permit.receipt)
    ) fail();
    const allowed = new Set(permit.allowedOfferingIds);
    if (
      allowed.size !== permit.allowedOfferingIds.length ||
      [...allowed].some((id) =>
        !frozen.some((s) => "2027:" + s.key.offeringPk === id && s.selection !== null)
      )
    ) fail();
    await this.inputs.authority.assertCurrent(scope, frozen, permit.receipt, bundle.tail);
    await this.assertAccess(request, boundary);
    const innerIssued = await this.inner.issue(scope);
    if (
      !innerIssued || !Array.isArray(innerIssued.items) || !Object.isFrozen(innerIssued.items) ||
      !innerIssued.proof || !Object.isFrozen(innerIssued.proof) || !innerIssued.receipt ||
      typeof innerIssued.receipt !== "object" || !Object.isFrozen(innerIssued.receipt)
    ) fail();
    const issued: Issued = Object.freeze({
      ...innerIssued,
      items: Object.freeze(innerIssued.items.filter((item) => allowed.has(item.offeringId))),
    });
    this.state = Object.freeze({
      scope,
      issued,
      innerIssued,
      selected: frozen,
      receipt: permit.receipt,
      tail: bundle.tail,
    });
    await this.assertIssued(scope, issued);
    return issued;
  }
  async assertIssued(scope: ReferenceBatchScope, issued: Issued): Promise<void> {
    const state = this.state;
    if (
      !state || state.scope !== scope || state.issued !== issued || scope.boundary.signal.aborted
    ) fail();
    await this.assertAccess(scope.request, scope.boundary);
    await this.inputs.authority.assertCurrent(scope, state.selected, state.receipt, state.tail);
    for (const item of state.selected) {
      if (item.selection) await item.selection.assertCurrent(scope.boundary.signal);
    }
    await this.inner.assertIssued(scope, state.innerIssued);
    await this.assertAccess(scope.request, scope.boundary);
  }
  async awaitQuiescence(signal: AbortSignal): Promise<void> {
    await requireVoidDrains([
      () => this.inner.awaitQuiescence(signal),
      () => this.inputs.authority.awaitQuiescence(signal),
    ]);
  }
}
