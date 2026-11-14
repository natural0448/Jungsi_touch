/** REVIEW ONLY. Request-scoped composition of the existing reference batch evidence with
 * verified historical year/PK join. No operational authority, binding or I/O is installed.
 */
import { AccessError } from "../application/access.ts";
import { requireVoidDrains } from "../application/reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type {
  StudentReferenceBatchItem,
  StudentReferenceLocalProof,
} from "../application/owned_student_reference_batch_handler_candidate.ts";
import {
  type HistoricalCutoffRow,
  type HistoricalJoinResult,
  type HistoricalYearPkAuthority,
  type HistoricalYearPkBatchSource,
  joinHistoricalYearPkBatchCandidate,
  type ReferenceScenarioIssuer,
} from "../application/historical_year_pk_batch_join_candidate.v7.ts";
import type { TriangleHistoryPoint } from "../application/historical_triangle_candidate.review-only.v8.ts";
import type {
  ReferenceBatchEvidenceAuthority,
  ReferenceBatchScope,
} from "./student_reference_batch_provider_candidate.ts";
import type { BatchMetadataBudget } from "./reference_percentile_metadata_batch.review-only.ts";

export type BoundHistoricalRuntimeInputs = Readonly<{
  source: HistoricalYearPkBatchSource;
  authority: HistoricalYearPkAuthority;
  scenarioIssuer?: ReferenceScenarioIssuer;
  budget: BatchMetadataBudget;
  /** Independent 50% cutoff/cohort authority; it must not reuse a 70% classification. */
  cut50?: Readonly<
    { authority: HistoricalYearPkAuthority; scenarioIssuer?: ReferenceScenarioIssuer }
  >;
}>;
type Issued = Awaited<ReturnType<ReferenceBatchEvidenceAuthority["issue"]>>;
type State = Readonly<
  {
    scope: ReferenceBatchScope;
    issued: Issued;
    innerIssued: Issued;
    joined: readonly HistoricalJoinResult[];
    joined50: readonly HistoricalJoinResult[];
  }
>;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function data(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && "value" in d ? d.value : undefined;
}
const POINT_KEYS = [
  "academicYear",
  "observationId",
  "sourceSha256",
  "relationSha256",
  "methodSha256",
  "metric",
  "examId",
  "examType",
  "packVersion",
  "ruleVersion",
  "scoreScaleId",
  "metricDefinition",
  "cohortDefinition",
  "value",
  "unit",
  "denominator",
  "tiePolicy",
] as const;
function samePoint(left: TriangleHistoryPoint, right: TriangleHistoryPoint): boolean {
  return !!left && !!right && POINT_KEYS.every((k) => data(left, k) === data(right, k));
}
function hasPoint(row: HistoricalJoinResult, point: TriangleHistoryPoint): boolean {
  return row.privateVerifiedRows.some((r) => samePoint(r.point, point));
}
function matchedObservation(
  row: HistoricalCutoffRow,
  input: StudentReferenceBatchItem["historical"][number],
): boolean {
  const i = input?.identity, o = input?.observation;
  return !!i && !!o && i.academicYear === row.academicYear && i.schoolId === row.schoolId &&
    i.offeringPk === row.offeringPk && data(o, "observation_id") === row.canonicalResultId &&
    data(o, "value") === row.point.value;
}
/** One instance for one request. Independent inner authority must still prove every source,
 * input, object identity, current head, owner, admission and official/reference distinction. */
export class JoinedHistoricalBatchEvidence implements ReferenceBatchEvidenceAuthority {
  private state: State | null = null;
  private started = false;
  constructor(
    private readonly inner: ReferenceBatchEvidenceAuthority,
    private readonly historical: BoundHistoricalRuntimeInputs,
    actualBudget: BatchMetadataBudget,
  ) {
    if (
      !inner || !historical?.source || !historical.authority ||
      historical.budget !== actualBudget ||
      typeof inner.issue !== "function" || typeof inner.assertIssued !== "function" ||
      typeof inner.assertContext !== "function" || typeof inner.assertMetadataHead !== "function" ||
      typeof inner.awaitQuiescence !== "function"
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
    if (
      this.started || this.state || !scope || !scope.boundary?.admission ||
      scope.boundary.signal.aborted
    ) fail();
    this.started = true;
    const { request, boundary } = scope;
    await this.inner.assertContext(request, boundary, scope.rows);
    const targets = Object.freeze(
      scope.keys.map((k) => Object.freeze({ schoolId: k.schoolId, offeringPk2027: k.offeringPk })),
    );
    const joined = await joinHistoricalYearPkBatchCandidate(
      request,
      boundary,
      targets,
      this.historical.source,
      this.historical.authority,
      this.historical.scenarioIssuer,
    );
    if (boundary.signal.aborted || joined.length !== targets.length) fail();
    let joined50: readonly HistoricalJoinResult[] = Object.freeze([]);
    if (this.historical.cut50) {
      const original = this.historical.source,
        auth = this.historical.cut50.authority,
        batch = joined[0]?.privateSourceBatch;
      if (!batch || joined.some((j) => j.privateSourceBatch !== batch) || !auth) fail();
      // Same already verified batch: do not repeat physical source reads for the second metric.
      const cached: HistoricalYearPkBatchSource = {
        read: (r, b, requested) =>
          guardedPromise(() => {
            if (
              r !== request || b !== boundary || requested.length !== targets.length ||
              requested.some((x, i) =>
                x.schoolId !== targets[i].schoolId || x.offeringPk2027 !== targets[i].offeringPk2027
              )
            ) fail();
            return batch;
          }),
      };
      const wrap: HistoricalYearPkAuthority = {
        assertCurrent: (r, b, _s, v) => auth.assertCurrent(r, b, original, v),
        attest: (r, b, _s, v) => auth.attest(r, b, original, v),
        awaitQuiescence: (signal) => auth.awaitQuiescence(signal),
      };
      joined50 = await joinHistoricalYearPkBatchCandidate(
        request,
        boundary,
        targets,
        cached,
        wrap,
        this.historical.cut50.scenarioIssuer,
      );
      if (joined50.length !== targets.length || boundary.signal.aborted) fail();
    }
    const innerIssued = await this.inner.issue(scope);
    if (
      !innerIssued || !Object.isFrozen(innerIssued) || !Object.isFrozen(innerIssued.proof) ||
      !Array.isArray(innerIssued.items) || !Object.isFrozen(innerIssued.items) ||
      !innerIssued.receipt || typeof innerIssued.receipt !== "object" ||
      !Object.isFrozen(innerIssued.receipt)
    ) fail();
    const eligible = new Map(joined.map((j) => ["2027:" + j.target.offeringPk2027, j]));
    const eligible50 = new Map(joined50.map((j) => ["2027:" + j.target.offeringPk2027, j]));
    const admitted: StudentReferenceBatchItem[] = [];
    for (const item of innerIssued.items) {
      const j = eligible.get(item.offeringId);
      const index = scope.keys.findIndex((k) =>
        "2027:" + k.offeringPk === item.offeringId && k.schoolId === j?.target.schoolId
      );
      if (
        !j || index < 0 || !Object.isFrozen(item) || !Array.isArray(item.historical) ||
        !Array.isArray(item.trianglePoints) || !item.personal?.identity ||
        item.personal.identity.schoolId !== j.target.schoolId ||
        item.personal.identity.offeringPk !== j.target.offeringPk2027
      ) continue;
      const score = scope.rows[index]?.추정상위누적백분위;
      if (
        score === null || score === undefined ||
        data(item.personal.result, "estimated_upper_cumulative_percent_all_examinees") !== score
      ) continue;
      const historical = item.historical.filter((
        h: StudentReferenceBatchItem["historical"][number],
      ) => h.observation === null || j.privateVerifiedRows.some((r) => matchedObservation(r, h)));
      let points = item.trianglePoints.filter((point: TriangleHistoryPoint) => hasPoint(j, point));
      if (points.length === 3 && j.triangle?.status !== "reference_available") points = [];
      // Keep the original identity when unchanged so independently issued proofs can match it.
      // A reduced copy can only lose evidence; the original proof must still accept every use.
      let metric50 = item.metric50;
      if (metric50) {
        const j50 = eligible50.get(item.offeringId);
        if (
          !j50 || !Array.isArray(metric50.historical) || !Array.isArray(metric50.trianglePoints)
        ) metric50 = undefined;
        else {
          const h50 = metric50.historical.filter((
            h: StudentReferenceBatchItem["historical"][number],
          ) =>
            h.observation === null || j50.privateVerifiedRows.some((r) => matchedObservation(r, h))
          );
          let p50 = metric50.trianglePoints.filter((point: TriangleHistoryPoint) =>
            hasPoint(j50, point)
          );
          if (p50.length === 3 && j50.triangle?.status !== "reference_available") p50 = [];
          if (
            h50.length !== metric50.historical.length ||
            p50.length !== metric50.trianglePoints.length
          ) {
            metric50 = Object.freeze({
              ...metric50,
              historical: Object.freeze(h50),
              trianglePoints: Object.freeze(p50),
            });
          }
        }
      }
      const projected = historical.length === item.historical.length &&
          points.length === item.trianglePoints.length && metric50 === item.metric50
        ? item
        : Object.freeze({
          ...item,
          historical: Object.freeze(historical),
          trianglePoints: Object.freeze(points),
          metric50,
        });
      admitted.push(projected);
    }
    const permitted = new Map(admitted.map((item) => [item.offeringId, item]));
    const original = innerIssued.proof;
    const proof: StudentReferenceLocalProof = Object.freeze({
      ...original,
      triangle: (s: Parameters<StudentReferenceLocalProof["triangle"]>[0]) => {
        const item = permitted.get(s.offeringId),
          candidates = [eligible.get(s.offeringId), eligible50.get(s.offeringId)];
        return !!item && s.points.length === 3 && candidates.some((j) =>
          !!j && j.triangle?.status === "reference_available" &&
          j.triangleAuthorityMode !== null && s.points.every((p: TriangleHistoryPoint) =>
            hasPoint(j, p)
          )
        ) && original.triangle(s) === true;
      },
      relative50: (s: Parameters<NonNullable<StudentReferenceLocalProof["relative50"]>>[0]) => {
        const item = permitted.get(s.item.offeringId), j = eligible50.get(s.item.offeringId);
        return item === s.item && item?.metric50 === s.metric && !!j &&
          s.comparison.historical.every((h) =>
            h.status !== "reference_available" ||
            j.privateVerifiedRows.some((r) =>
              r.academicYear === h.academicYear && r.point.value === h.estimatedUpperPercent
            )
          ) &&
          (s.triangle.status !== "reference_available" ||
            j.triangle?.status === "reference_available" && j.triangleAuthorityMode !== null) &&
          typeof original.relative50 === "function" && original.relative50(s) === true;
      },
      relative70: (s: Parameters<NonNullable<StudentReferenceLocalProof["relative70"]>>[0]) => {
        const item = permitted.get(s.item.offeringId), j = eligible.get(s.item.offeringId);
        return item === s.item && !!j && j.triangle?.status === "reference_available" &&
          j.triangleAuthorityMode !== null && typeof original.relative70 === "function" &&
          original.relative70(s) === true;
      },
    });
    const issued: Issued = Object.freeze({
      items: Object.freeze(admitted),
      proof,
      receipt: innerIssued.receipt,
    });
    this.state = Object.freeze({ scope, issued, innerIssued, joined, joined50 });
    await this.assertIssued(scope, issued);
    return issued;
  }
  async assertIssued(scope: ReferenceBatchScope, issued: Issued): Promise<void> {
    const state = this.state;
    if (
      !state || state.scope !== scope || state.issued !== issued || scope.boundary.signal.aborted
    ) fail();
    await this.inner.assertContext(scope.request, scope.boundary, scope.rows);
    await this.inner.assertIssued(scope, state.innerIssued);
    const batch = state.joined[0]?.privateSourceBatch;
    if (!batch || state.joined.some((j) => j.privateSourceBatch !== batch)) fail();
    await this.historical.authority.assertCurrent(
      scope.request,
      scope.boundary,
      this.historical.source,
      batch,
    );
    if (state.joined.some((j) => j.triangleAuthorityMode === "server_reference_scenario")) {
      if (!this.historical.scenarioIssuer) fail();
      await this.historical.scenarioIssuer.assertCurrent(scope.request, scope.boundary, batch);
    }
    if (state.joined50.length) {
      const m = this.historical.cut50;
      if (!m) fail();
      await m.authority.assertCurrent(scope.request, scope.boundary, this.historical.source, batch);
      if (state.joined50.some((j) => j.triangleAuthorityMode === "server_reference_scenario")) {
        if (!m.scenarioIssuer) fail();
        await m.scenarioIssuer.assertCurrent(scope.request, scope.boundary, batch);
      }
    }
    if (scope.boundary.signal.aborted) fail();
  }
  async awaitQuiescence(signal: AbortSignal): Promise<void> {
    await requireVoidDrains([
      () => this.inner.awaitQuiescence(signal),
      () => this.historical.authority.awaitQuiescence(signal),
      ...(this.historical.scenarioIssuer
        ? [() => this.historical.scenarioIssuer!.awaitQuiescence(signal)]
        : []),
      ...(this.historical.cut50
        ? [
          () => this.historical.cut50!.authority.awaitQuiescence(signal),
          ...(this.historical.cut50.scenarioIssuer
            ? [() => this.historical.cut50!.scenarioIssuer!.awaitQuiescence(signal)]
            : []),
        ]
        : []),
    ]);
  }
}

/** Execute synchronous guards immediately while retaining Promise rejection semantics. */
function guardedPromise<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      resolve(work());
    } catch (error) {
      reject(error);
    }
  });
}
