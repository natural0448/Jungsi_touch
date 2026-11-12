/**
 * Request-scoped candidate composition: one existing 2027 metadata batch and at most one
 * selected P1 snapshot part for owned, already-read student-cache rows. No issuer, source
 * locator, production setting, route registration or evidence authority is installed here.
 */
import { AccessError } from "../application/access.ts";
import {
  type ReferenceQuiescence,
  requireReferenceDurableFence,
} from "../application/reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import { STUDENT_REFERENCE_OPERATION_ID } from "../application/api_dispatch.ts";
import type { StudentCacheFiveFields } from "../application/student_score_cache_bounded_workflow_candidate.ts";
import type {
  StudentReferenceBatch,
  StudentReferenceBatchIssuer,
  StudentReferenceBatchItem,
  StudentReferenceLocalProof,
} from "../application/owned_student_reference_batch_handler_candidate.ts";
import type {
  HistorySnapshotPort,
  SnapshotPart,
  SnapshotPublication,
} from "../application/history_snapshot.ts";
import type { NativeObject } from "../domain/json_value.ts";
import {
  type BatchExamContext,
  type BatchExpectedHead,
  type BatchMetadataAuthority,
  type BatchMetadataBounds,
  type BatchMetadataBudget,
  type BatchMetadataKey,
  type BatchMetadataResult,
  read2027ReferenceMetadataBatch,
  type ReadonlyBatchSql,
} from "./reference_percentile_metadata_batch.review-only.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function freezeTree<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeTree(child, seen);
    Object.freeze(value);
  }
  return value;
}
export type ReferenceBatchScope = Readonly<{
  request: ApiExecution;
  boundary: ApiExecutionBoundary;
  rows: readonly StudentCacheFiveFields[];
  keys: readonly BatchMetadataKey[];
  metadata: readonly BatchMetadataResult[];
  publication: SnapshotPublication;
  part: SnapshotPart | null;
  body: NativeObject | null;
}>;
/**
 * Independently installed server authority, never a request-provided boolean/hash. Its implementation
 * must establish ownership, current admission, verified cache lineage/exam/model/profile, same SQL
 * budget, publication and selected exact part. The source must independently bind each item to its
 * verified metadata, original source observation, explicit relationship and matching cut/cohort.
 * Both methods must honor the original signal and drain physical I/O before they settle.
 */
export interface ReferenceBatchEvidenceAuthority {
  assertContext(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    rows: readonly StudentCacheFiveFields[],
  ): Promise<void>;
  issue(scope: ReferenceBatchScope): Promise<
    Readonly<{
      items: readonly StudentReferenceBatchItem[];
      proof: StudentReferenceLocalProof;
      receipt: object;
    }>
  >;
  assertIssued(
    scope: ReferenceBatchScope,
    issued: Readonly<{
      items: readonly StudentReferenceBatchItem[];
      proof: StudentReferenceLocalProof;
      receipt: object;
    }>,
  ): Promise<void>;
  /** Fresh bounded shared-head check, not one check per row. */
  assertMetadataHead(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    head: BatchExpectedHead,
  ): Promise<void>;
  /** Stops every transport, authority and snapshot operation, including already-aborted work. */
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
export interface StudentReferenceProviderInputs {
  readonly exam: BatchExamContext;
  readonly head: BatchExpectedHead;
  readonly bounds: BatchMetadataBounds;
  readonly sql: ReadonlyBatchSql;
  readonly budget: BatchMetadataBudget;
  readonly metadataAuthority: BatchMetadataAuthority;
  readonly snapshot: HistorySnapshotPort;
  readonly authority: ReferenceBatchEvidenceAuthority;
  /** Request-local trusted index selection; cannot construct a part or perform I/O. A missing
   * mapping returns null; one source instance supports at most one part per request. */
  readonly selectPart: (
    publication: SnapshotPublication,
    keys: readonly BatchMetadataKey[],
  ) => SnapshotPart | null;
}
type State = {
  request: ApiExecution;
  boundary: ApiExecutionBoundary;
  signal: AbortSignal;
  admission: unknown;
  selected: readonly StudentCacheFiveFields[];
  scope: ReferenceBatchScope;
  issued: Readonly<{
    items: readonly StudentReferenceBatchItem[];
    proof: StudentReferenceLocalProof;
    receipt: object;
  }>;
  batch: StudentReferenceBatch;
};
/**
 * Each instance serves one admitted request and one bounded batch. Cache ownership remains
 * enforced by the existing owned handler, and this provider additionally rechecks it through
 * the independent evidence authority. `issue` is a required implementation, not an approval.
 */
export class BoundedStudentReferenceBatchProvider implements StudentReferenceBatchIssuer {
  private state: State | null = null;
  private started = false;
  private sealed = false;
  private active = 0;
  private flight: Promise<unknown> | null = null;
  constructor(private readonly inputs: StudentReferenceProviderInputs) {
    if (
      !inputs || !inputs.sql || !inputs.budget || !inputs.metadataAuthority || !inputs.snapshot ||
      !inputs.authority || typeof inputs.selectPart !== "function" ||
      typeof inputs.authority.assertContext !== "function" ||
      typeof inputs.authority.issue !== "function" ||
      typeof inputs.authority.assertIssued !== "function" ||
      typeof inputs.authority.assertMetadataHead !== "function" ||
      typeof inputs.authority.awaitQuiescence !== "function"
    ) fail();
  }
  private same(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    signal: AbortSignal,
    admission: unknown,
  ): void {
    if (
      !request || request.operation !== STUDENT_REFERENCE_OPERATION_ID || !boundary || !admission ||
      !signal || signal.aborted || boundary.signal !== signal || boundary.admission !== admission
    ) fail();
  }
  private async tracked<T>(work: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
    }
  }
  load(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    selected: readonly StudentCacheFiveFields[],
  ): Promise<StudentReferenceBatch> {
    if (this.sealed) fail();
    requireReferenceDurableFence();
    if (
      this.started || !Array.isArray(selected) || !Object.isFrozen(selected) ||
      selected.length < 1 || selected.length > 100
    ) fail();
    this.started = true;
    const signal = boundary.signal, admission = boundary.admission;
    const run = this.tracked(async () => {
      this.same(request, boundary, signal, admission);
      const keys = Object.freeze(selected.map((row) => {
        const k = row?.학교및학교PK값;
        if (
          !Object.isFrozen(row) || !k || !Object.isFrozen(k) || !ID.test(k.학교PK) ||
          !ID.test(k.모집행PK)
        ) fail();
        return Object.freeze({ schoolId: k.학교PK, offeringPk: k.모집행PK });
      }));
      if (new Set(keys.map((k) => k.offeringPk)).size !== keys.length) fail();
      await this.inputs.authority.assertContext(request, boundary, selected);
      this.same(request, boundary, signal, admission);
      // This is the existing read-only, role-checked 100-key SQL query with its original budget.
      const metadata = await read2027ReferenceMetadataBatch(
        request,
        boundary,
        request.session.user.subjectId,
        keys,
        this.inputs.exam,
        this.inputs.head,
        this.inputs.bounds,
        this.inputs.sql,
        this.inputs.budget,
        this.inputs.metadataAuthority,
      );
      this.same(request, boundary, signal, admission);
      const publication = await this.inputs.snapshot.current();
      this.same(request, boundary, signal, admission);
      const selectedPart = this.inputs.selectPart(publication, keys);
      if (
        selectedPart !== null && selectedPart !== publication.full &&
        !publication.parts.includes(selectedPart)
      ) fail();
      const body = selectedPart === null
        ? null
        : freezeTree(await this.inputs.snapshot.read(publication, selectedPart));
      this.same(request, boundary, signal, admission);
      await this.inputs.snapshot.assertCurrent(publication);
      await this.inputs.authority.assertMetadataHead(request, boundary, this.inputs.head);
      this.same(request, boundary, signal, admission);
      const scope = Object.freeze({
        request,
        boundary,
        rows: selected,
        keys,
        metadata,
        publication,
        part: selectedPart,
        body,
      });
      const issued = await this.inputs.authority.issue(scope);
      if (
        !issued || !Object.isFrozen(issued) || !Object.isFrozen(issued.items) ||
        !Array.isArray(issued.items) || issued.items.length > selected.length ||
        !issued.proof || !Object.isFrozen(issued.proof) || !issued.receipt ||
        !Object.isFrozen(issued.receipt)
      ) fail();
      if (body === null && issued.items.length !== 0) fail();
      await this.inputs.authority.assertIssued(scope, issued);
      this.same(request, boundary, signal, admission);
      const byId = new Map(metadata.map((m) => [`2027:${m.key.offeringPk}`, m]));
      const seen = new Set<string>();
      for (const item of issued.items) {
        const m = byId.get(item.offeringId), p = item.personal?.identity;
        if (
          !Object.isFrozen(item) || !m || m.status !== "metadata_available" || !m.pin ||
          seen.has(item.offeringId) || !p || p.academicYear !== 2027 ||
          p.examType !== "september_mock" ||
          p.schoolId !== m.key.schoolId || p.offeringPk !== m.key.offeringPk ||
          p.examId !== m.pin.requestedExam.examId ||
          p.packVersion !== m.pin.requestedExam.packVersion
        ) fail();
        seen.add(item.offeringId);
      }
      // Missing metadata, part, observation or source proof is a per-row generic pending. This is
      // intentionally not a claim that every absent item was reviewed or has a particular cause.
      const pendingReasons = Object.freeze(
        keys.filter((k) => !seen.has(`2027:${k.offeringPk}`))
          .map((k) =>
            Object.freeze({
              offeringId: `2027:${k.offeringPk}`,
              reason: "reference_evidence_unavailable" as const,
            })
          ),
      );
      const batch: StudentReferenceBatch = Object.freeze({
        receipt: issued.receipt,
        proof: issued.proof,
        items: issued.items,
        pendingReasons,
      });
      this.state = { request, boundary, signal, admission, selected, scope, issued, batch };
      return batch;
    });
    this.flight = run;
    return run;
  }
  async assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    batch: StudentReferenceBatch,
    selected: readonly StudentCacheFiveFields[],
  ): Promise<void> {
    if (this.sealed) return fail();
    return await this.tracked(async () => {
      const s = this.state;
      if (
        !s || s.request !== request || s.boundary !== boundary || s.batch !== batch ||
        s.selected !== selected
      ) fail();
      this.same(request, boundary, s.signal, s.admission);
      await this.inputs.authority.assertContext(request, boundary, selected);
      await this.inputs.snapshot.assertCurrent(s.scope.publication);
      await this.inputs.authority.assertMetadataHead(request, boundary, this.inputs.head);
      await this.inputs.authority.assertIssued(s.scope, s.issued);
      this.same(request, boundary, s.signal, s.admission);
    });
  }
  async awaitQuiescence(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    signal: AbortSignal,
  ): Promise<ReferenceQuiescence> {
    // Seal synchronously before observing started/active or awaiting any drain.
    this.sealed = true;
    if (!this.started) return Object.freeze({ physical: "stopped", current: !signal.aborted });
    // The injected authority must not resolve until all physical transports are stopped.
    try {
      await this.flight;
    } catch { /* original failure remains with the caller */ }
    await this.inputs.authority.awaitQuiescence(signal);
    const s = this.state;
    return Object.freeze({
      physical: this.active === 0 ? "stopped" : "unknown",
      current: !!s && s.request === request && s.boundary === boundary &&
        signal === s.signal && !signal.aborted && boundary.admission === s.admission,
    });
  }
}
