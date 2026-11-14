/**
 * Server-side selected-offering comparison handler. This module is NOT registered as a route.
 * It must be invoked inside the existing relay/session/report-owner/shared-budget boundary.
 * The cache owner adapter, source batch issuer, response registry and runtime are NOT installed.
 * In particular, this handler must not replace university.analyze's existing report write/replay.
 */
import { AccessError, authorizeReport } from "./access.ts";
import {
  type ReferenceQuiescence,
  requireReferenceDurableFence,
  requireStoppedAndCurrent,
} from "./reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { STUDENT_REFERENCE_OPERATION_ID } from "./api_dispatch.ts";
import type { ReportAccessPort, RequestClockPort } from "./ports.ts";
import { requirePaidSession } from "./session_service.ts";
import { PublicResponseProjection } from "./public_response.ts";
import type { StudentCacheFiveFields } from "./student_score_cache_bounded_workflow_candidate.ts";
import {
  type OwnedStudentCacheInput,
  type OwnedStudentCacheInternalPorts,
  readVerifiedOwnedStudentCacheCandidate,
} from "./owned_student_cache_internal_candidate.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";
import {
  comparePersonalHistoricalReference,
  type HistoricalReferenceInput,
  type PersonalReferenceInput,
  type ReferenceComparisonAuthority,
} from "./personal_historical_reference_comparison.review-only.ts";
import {
  type HistoricalPublicLabels,
  projectPersonalHistoricalReference,
  type PublicComparisonProjection,
  type ReferencePublicProjectionAuthority,
} from "./personal_historical_reference_projection.review-only.ts";
import {
  buildHistoricalTriangleCandidate,
  type TriangleAuthority,
  type TriangleDisplayPolicy,
  type TriangleHistoryPoint,
} from "./historical_triangle_candidate.review-only.v8.ts";
import {
  applyVerifiedPpToRoundedTriangle,
  type BoundDisplayPolicy,
  type RoundedPpAuthority,
  type RoundedPpEffect,
} from "./triangle_pp_rounded_adjustment_candidate.review-only.ts";
import { exact, roundExact } from "../domain/exact.ts";
import { forecastDecimal, forecastNumber } from "./forecast_calculation.ts";

type SyncProof<T> = (scope: T) => boolean;
/** These functions MUST be request-local in-memory checks: no SQL, network or scheduled I/O. */
export interface StudentReferenceLocalProof {
  personal: SyncProof<Parameters<ReferenceComparisonAuthority["verifyPersonal"]>[0]>;
  pair: SyncProof<Parameters<ReferenceComparisonAuthority["verifyPair"]>[0]>;
  projection: SyncProof<Parameters<ReferencePublicProjectionAuthority["verify"]>[0]>;
  triangle: SyncProof<Parameters<TriangleAuthority["verifyHistory"]>[0]>;
  trianglePolicy: SyncProof<
    Parameters<NonNullable<TriangleAuthority["verifyDisplayPolicy"]>>[0] & {
      readonly policy: TriangleDisplayPolicy;
    }
  >;
  /** Proves exact 70% CSAT-component cut, cohort, identical metric/denominator, source and display precision. */
  relative70?: SyncProof<
    Readonly<
      {
        request: ApiExecution;
        boundary: ApiExecutionBoundary;
        item: StudentReferenceBatchItem;
        comparison: PublicComparisonProjection;
        triangle: StudentReferencePublicTriangle;
      }
    >
  >;
  /** Separate authority for exact 50% source, cohort, relation and same model scope. */
  relative50?: SyncProof<
    Readonly<
      {
        request: ApiExecution;
        boundary: ApiExecutionBoundary;
        item: StudentReferenceBatchItem;
        metric: StudentReferenceMetric50;
        comparison: PublicComparisonProjection;
        triangle: StudentReferencePublicTriangle;
      }
    >
  >;
  /** Reason is exposed only if bound by the source authority to this request and offering. */
  pendingReason?: SyncProof<
    Readonly<
      {
        request: ApiExecution;
        boundary: ApiExecutionBoundary;
        offeringId: string;
        reason: PublicPendingReason;
      }
    >
  >;
  adjustmentBase: SyncProof<Parameters<RoundedPpAuthority["verifyBase"]>[0]>;
  adjustmentEffect: SyncProof<Parameters<RoundedPpAuthority["verifyEffect"]>[0]>;
}
export type StudentReferenceMetric50 = Readonly<{
  historical: readonly HistoricalReferenceInput[];
  labels: readonly HistoricalPublicLabels[];
  trianglePoints: readonly TriangleHistoryPoint[];
  displayPolicy: TriangleDisplayPolicy | null;
  boundPolicy: BoundDisplayPolicy;
  effects: readonly RoundedPpEffect[];
}>;
export type StudentReferenceBatchItem = Readonly<{
  offeringId: string;
  /** Independent 50% source; absence never substitutes the 70% source. */
  metric50?: StudentReferenceMetric50;
  personal: PersonalReferenceInput;
  historical: readonly HistoricalReferenceInput[];
  labels: readonly HistoricalPublicLabels[];
  trianglePoints: readonly TriangleHistoryPoint[];
  displayPolicy: TriangleDisplayPolicy | null;
  boundPolicy: BoundDisplayPolicy;
  effects: readonly RoundedPpEffect[];
}>;
export type PublicPendingReason =
  | "reference_evidence_unavailable"
  | "relationship_unconfirmed"
  | "cutoff_unconfirmed"
  | "cohort_unconfirmed"
  | "score_basis_unconfirmed"
  | "student_percent_unavailable"
  | "student_cache_row_missing";
export type StudentReferenceBatch = Readonly<{
  /** Private identity and source proof. Structural shape or a hash is not authority. */
  receipt: object;
  proof: StudentReferenceLocalProof;
  items: readonly StudentReferenceBatchItem[];
  pendingReasons?: readonly Readonly<{ offeringId: string; reason: PublicPendingReason }>[];
}>;
/**
 * One separately implemented bounded data-source operation, not one request per university.
 * It must establish the actual student/report, 2027 scope, source/Guide/current head, historical
 * CID/relationship/cut/cohort, exam/model/denominator/tie and exact cached input/score before
 * returning. It must create immutable, request-bound, independently verifiable local proofs.
 * assertCurrent rechecks the underlying heads/owner/consent/source freshness and physical budget
 * before and after processing. awaitQuiescence resolves only after ALL started I/O has stopped.
 */
export interface StudentReferenceBatchIssuer {
  load(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    selected: readonly StudentCacheFiveFields[],
  ): Promise<StudentReferenceBatch>;
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    batch: StudentReferenceBatch,
    selected: readonly StudentCacheFiveFields[],
  ): Promise<void>;
  /** Stops physical I/O, then verifies the same source/receipt/head before settling. */
  awaitQuiescence(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    signal: AbortSignal,
  ): Promise<ReferenceQuiescence>;
}
/**
 * Independently recheck the actual private cache head, original payload and source/profile pins
 * against this exact semantic rows digest, request, student and admission. The digest itself is
 * not authorization. This must not infer the student UUID from the login UUID.
 */
export interface OwnedCacheFreshnessAuthority {
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    input: OwnedStudentCacheInput,
    semanticRowsSha256: string,
  ): Promise<void>;
}
export interface ReferenceBatchDeliveryAuthority {
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    projection: PublicResponseProjection,
    contractRef: string,
  ): Promise<void>;
}
export interface OwnedStudentReferenceBatchPorts {
  readonly reports: ReportAccessPort;
  readonly clock: RequestClockPort;
  readonly cache: OwnedStudentCacheInternalPorts;
  readonly cacheFreshness: OwnedCacheFreshnessAuthority;
  readonly source: StudentReferenceBatchIssuer;
  readonly projection: PublicResponseProjection;
  readonly delivery: ReferenceBatchDeliveryAuthority;
  /** Real runtime adapter must validate exact current shared budget admission. */
  readonly assertActiveAdmission: (
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
  ) => Promise<void>;
  /** Stops report/cache/delivery I/O and verifies current owner/profile/schema before settling. */
  readonly awaitQuiescence: (
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    signal: AbortSignal,
  ) => Promise<ReferenceQuiescence>;
}
export type StudentReferencePublicTriangle = Readonly<{
  status: "reference_available" | "pending";
  reason: string | null;
  expectedAcademicYear: 2027;
  cutoffLabel: string | null;
  modelAssumption: "triangular_reference";
  historicalLower: string | null;
  historicalCenter: string | null;
  historicalUpper: string | null;
  referenceCenter: string | null;
  projectedLower: string | null;
  projectedUpper: string | null;
  adjustmentStatus: "applied_reference_only" | "not_applied" | "pending";
  adjustedLower: string | null;
  adjustedUpper: string | null;
  adjustmentPp: string | null;
  futureRangeGuaranteed: false;
  actualApplicantRanking: false;
  admissionProbability: null;
}>;
export type Expected70Reference = Readonly<{
  label: "2027 예상 70% 컷 구간";
  studentExamBasis: "2027학년도 9월 모의평가(2026년 시행)" | null;
  scenarioBasis: "과거 동종 70% 컷의 수능 반영분 상위누백" | null;
  status: "reference_available" | "pending";
  reason: string | null;
  scenario: "가정상 Q10~Q90 시나리오";
  lower: string | null;
  upper: string | null;
  originalLower: string | null;
  originalUpper: string | null;
  adjustedLower: string | null;
  adjustedUpper: string | null;
  adjustmentStatus: "applied_reference_only" | "not_applied" | "pending";
  relativePosition: "above_range" | "within_range" | "below_range" | "boundary" | "pending";
  relativeBasis: "displayed_values_only" | null;
  studentDisplayedPercent: string | null;
  admissionJudgement: false;
  guaranteed: false;
}>;
export type StudentReferencePublicRow = Readonly<{
  offeringId: string;
  student: StudentCacheFiveFields | null;
  comparison: PublicComparisonProjection | null;
  triangle: StudentReferencePublicTriangle | null;
  expected70: Expected70Reference;
  pendingReason: PublicPendingReason | null;
  status: "reference_available" | "pending";
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function selection(request: ApiExecution): readonly string[] {
  if (
    request.operation !== STUDENT_REFERENCE_OPERATION_ID || !request.body ||
    typeof request.body !== "object" || Array.isArray(request.body)
  ) fail();
  const value = Object.getOwnPropertyDescriptor(request.body, "offering_ids");
  if (
    !value || !("value" in value) || !Array.isArray(value.value) ||
    value.value.length < 1 || value.value.length > 100 ||
    value.value.some((x: unknown) =>
      typeof x !== "string" || !ID.test(x) || !x.startsWith("2027:")
    ) ||
    new Set(value.value).size !== value.value.length
  ) fail();
  return Object.freeze([...value.value]);
}
function cacheId(row: StudentCacheFiveFields): string {
  return `2027:${row.학교및학교PK값.모집행PK}`;
}
function stableObject(v: unknown): boolean {
  return !!v && typeof v === "object" && Object.isFrozen(v);
}
function immutableData(v: unknown, seen = new WeakSet<object>()): boolean {
  if (v === null || typeof v !== "object") return typeof v !== "function";
  if (seen.has(v)) return true;
  seen.add(v);
  if (
    !Object.isFrozen(v) ||
    !Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  ) return false;
  for (const k of Reflect.ownKeys(v)) {
    if (typeof k !== "string" || Array.isArray(v) && k === "length") continue;
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !("value" in d) || !immutableData(d.value, seen)) return false;
  }
  return true;
}
function pending70(reason: string): Expected70Reference {
  return Object.freeze({
    label: "2027 예상 70% 컷 구간",
    studentExamBasis: null,
    scenarioBasis: null,
    status: "pending",
    reason,
    scenario: "가정상 Q10~Q90 시나리오",
    lower: null,
    upper: null,
    originalLower: null,
    originalUpper: null,
    adjustedLower: null,
    adjustedUpper: null,
    adjustmentStatus: "pending",
    relativePosition: "pending",
    relativeBasis: null,
    studentDisplayedPercent: null,
    admissionJudgement: false,
    guaranteed: false,
  });
}
function pendingRow(
  offeringId: string,
  student: StudentCacheFiveFields | null,
  reason: PublicPendingReason,
): StudentReferencePublicRow {
  return Object.freeze({
    offeringId,
    student,
    status: "pending",
    comparison: null,
    triangle: null,
    expected70: pending70(reason),
    pendingReason: reason,
  });
}
function stableCacheInput(input: OwnedStudentCacheInput): OwnedStudentCacheInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  const fields = ["studentId", "profileId", "reportId", "reportRevision"] as const;
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== "string" || !fields.includes(k as typeof fields[number]))
  ) fail();
  const out: Record<string, unknown> = {};
  for (const name of fields) {
    const d = Object.getOwnPropertyDescriptor(input, name);
    if (!d || !("value" in d) || !d.enumerable) fail();
    out[name] = d.value;
  }
  if (
    typeof out.studentId !== "string" || typeof out.profileId !== "string" ||
    typeof out.reportId !== "string" || !Number.isSafeInteger(out.reportRevision) ||
    (out.reportRevision as number) < 1
  ) fail();
  return Object.freeze({
    studentId: out.studentId,
    profileId: out.profileId,
    reportId: out.reportId,
    reportRevision: out.reportRevision as number,
  });
}

/**
 * Callable inside the admitted business phase only. This is a separate DTO, not an existing
 * report replacement. Registration requires a separately approved route/policy/budget and exact
 * response schema. The caller must not expose this result under an unmodified existing schema.
 */
export async function handleOwnedStudentReferenceBatch(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  input: OwnedStudentCacheInput,
  contractRef: string,
  ports: OwnedStudentReferenceBatchPorts,
): Promise<unknown> {
  requireReferenceDurableFence();
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    typeof contractRef !== "string" || !ID.test(contractRef) || !ports?.reports || !ports.clock ||
    !ports.cache || !ports.cacheFreshness ||
    typeof ports.cacheFreshness.assertCurrent !== "function" ||
    !ports.source || typeof ports.source.load !== "function" ||
    typeof ports.source.assertCurrent !== "function" ||
    typeof ports.source.awaitQuiescence !== "function" || !ports.projection || !ports.delivery ||
    typeof ports.delivery.assertCurrent !== "function" ||
    typeof ports.assertActiveAdmission !== "function" ||
    typeof ports.awaitQuiescence !== "function" || !ports.projection.hasExactRegistryBytes() ||
    !ports.projection.supportsOperation(request.operation, contractRef)
  ) fail();
  const ids = selection(request), signal = boundary.signal, admission = boundary.admission;
  const session = request.session, user = session.user, subject = user.subjectId;
  const reportId = request.params.report_id, requestKey = request.requestKey;
  const stableInput = stableCacheInput(input);
  if (
    typeof reportId !== "string" || !ID.test(reportId) || stableInput.reportId !== reportId ||
    stableInput.reportRevision === null
  ) fail();
  const expected = Object.getOwnPropertyDescriptor(request.body as object, "expected_version");
  if (
    !expected || !("value" in expected) ||
    !(typeof expected.value === "number" && Number.isSafeInteger(expected.value) &&
        expected.value === stableInput.reportRevision ||
      typeof expected.value === "bigint" && expected.value === BigInt(stableInput.reportRevision))
  ) fail();
  const requestSha256 = await nativeJsonSha256([request.body, request.params, request.query]);
  const same = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.operation !== STUDENT_REFERENCE_OPERATION_ID || request.session !== session ||
      session.user !== user || user.subjectId !== subject ||
      request.params.report_id !== reportId ||
      request.requestKey !== requestKey
    ) fail();
  };
  const active = async () => {
    same();
    requirePaidSession(session, ports.clock.nowUtc());
    await ports.assertActiveAdmission(request, boundary);
    if (await nativeJsonSha256([request.body, request.params, request.query]) !== requestSha256) {
      fail();
    }
    same();
    requirePaidSession(session, ports.clock.nowUtc());
  };
  let batch: StudentReferenceBatch | null = null;
  try {
    await active();
    await authorizeReport(user, reportId, ports.reports, true);
    await active();
    await ports.delivery.assertCurrent(request, boundary, ports.projection, contractRef);
    await active();
    const cache = await readVerifiedOwnedStudentCacheCandidate(
      request,
      boundary,
      stableInput,
      ports.cache,
    );
    await active();
    if (!cache || cache.state !== "ready") {
      const pending = Object.freeze({
        format: "jungsi.student-reference-batch/v1",
        status: "pending",
        rows: Object.freeze([]),
      });
      await ports.delivery.assertCurrent(request, boundary, ports.projection, contractRef);
      await active();
      return ports.projection.project(request.operation, session.tier, pending);
    }
    const cacheRowsSha256 = await nativeJsonSha256(cache.rows);
    await ports.cacheFreshness.assertCurrent(request, boundary, stableInput, cacheRowsSha256);
    await active();
    const byId = new Map<string, StudentCacheFiveFields>();
    for (const row of cache.rows) {
      const id = cacheId(row);
      if (byId.has(id)) fail();
      byId.set(id, row);
    }
    const selected = Object.freeze(ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }));
    if (selected.length === 0) {
      const rows = Object.freeze(
        ids.map((id) => pendingRow(id, null, "student_cache_row_missing")),
      );
      await ports.cacheFreshness.assertCurrent(request, boundary, stableInput, cacheRowsSha256);
      await ports.delivery.assertCurrent(request, boundary, ports.projection, contractRef);
      await active();
      return ports.projection.project(
        request.operation,
        session.tier,
        Object.freeze({ format: "jungsi.student-reference-batch/v1", status: "ready", rows }),
      );
    }
    batch = await ports.source.load(request, boundary, selected);
    if (
      !stableObject(batch) || !stableObject(batch.receipt) || !stableObject(batch.proof) ||
      !Array.isArray(batch.items) || !Object.isFrozen(batch.items) ||
      batch.items.length > selected.length
    ) fail();
    await ports.source.assertCurrent(request, boundary, batch, selected);
    await ports.cacheFreshness.assertCurrent(request, boundary, stableInput, cacheRowsSha256);
    await active();
    const proof = batch.proof;
    const methods = [
      proof.personal,
      proof.pair,
      proof.projection,
      proof.triangle,
      proof.trianglePolicy,
      proof.adjustmentBase,
      proof.adjustmentEffect,
    ];
    if (methods.some((f) => typeof f !== "function")) fail();
    const local = <T>(fn: (x: T) => boolean, scope: T): Promise<boolean> => {
      same();
      // Promise, truthy objects, or missing proof never grant access. No I/O is allowed here.
      return Promise.resolve(fn(scope) === true);
    };
    const comparisonAuthority: ReferenceComparisonAuthority = {
      verifyPersonal: (scope) => local(proof.personal, scope),
      verifyPair: (scope) => local(proof.pair, scope),
    };
    const projectionAuthority: ReferencePublicProjectionAuthority = {
      verify: (scope) => local(proof.projection, scope),
    };
    const triangleAuthority: TriangleAuthority = {
      verifyHistory: (scope) => local(proof.triangle, scope),
      verifyDisplayPolicy: (scope, policy) =>
        local(proof.trianglePolicy, Object.freeze({ ...scope, policy })),
    };
    const ppAuthority: RoundedPpAuthority = {
      verifyBase: (scope) => local(proof.adjustmentBase, scope),
      verifyEffect: (scope) => local(proof.adjustmentEffect, scope),
    };
    const byItem = new Map<string, StudentReferenceBatchItem>();
    for (const item of batch.items) {
      if (
        !immutableData(item) || !ids.includes(item.offeringId) || byItem.has(item.offeringId) ||
        !Array.isArray(item.historical) || !Object.isFrozen(item.historical) ||
        item.historical.length > 48 ||
        !Array.isArray(item.labels) || !Object.isFrozen(item.labels) || item.labels.length > 3 ||
        !Array.isArray(item.trianglePoints) || !Object.isFrozen(item.trianglePoints) ||
        item.trianglePoints.length > 3 ||
        !Array.isArray(item.effects) || !Object.isFrozen(item.effects) || item.effects.length > 1
      ) fail();
      byItem.set(item.offeringId, item);
    }
    const pendingById = new Map<string, PublicPendingReason>();
    const safeReasons: readonly PublicPendingReason[] = [
      "reference_evidence_unavailable",
      "relationship_unconfirmed",
      "cutoff_unconfirmed",
      "cohort_unconfirmed",
      "score_basis_unconfirmed",
      "student_percent_unavailable",
      "student_cache_row_missing",
    ];
    if (batch.pendingReasons !== undefined) {
      if (
        !Array.isArray(batch.pendingReasons) || !Object.isFrozen(batch.pendingReasons) ||
        batch.pendingReasons.length > selected.length
      ) fail();
      for (const row of batch.pendingReasons) {
        if (
          !immutableData(row) || !ids.includes(row.offeringId) || pendingById.has(row.offeringId) ||
          !safeReasons.includes(row.reason) || byItem.has(row.offeringId)
        ) fail();
        if (
          typeof proof.pendingReason === "function" &&
          await local(
            proof.pendingReason,
            Object.freeze({ request, boundary, offeringId: row.offeringId, reason: row.reason }),
          )
        ) {
          pendingById.set(row.offeringId, row.reason);
        }
      }
    }
    const out: StudentReferencePublicRow[] = [];
    for (const id of ids) {
      const student = byId.get(id), item = byItem.get(id);
      if (!student) {
        out.push(pendingRow(id, null, "student_cache_row_missing"));
        continue;
      }
      if (!item) {
        out.push(pendingRow(id, student, pendingById.get(id) ?? "reference_evidence_unavailable"));
        continue;
      }
      if (student.추정상위누적백분위 === null) {
        out.push(pendingRow(id, student, "student_percent_unavailable"));
        continue;
      }
      const p = item.personal;
      if (
        !p || !p.identity || p.identity.academicYear !== 2027 ||
        p.identity.schoolId !== student.학교및학교PK값.학교PK ||
        p.identity.offeringPk !== student.학교및학교PK값.모집행PK
      ) fail();
      // The source issuer independently authenticates this result; this equality prevents the
      // comparison from silently using a different cached student's percentage.
      const rawPercent = p.result?.estimated_upper_cumulative_percent_all_examinees;
      try {
        if (exact(rawPercent).compare(exact(student.추정상위누적백분위)) !== 0) fail();
      } catch {
        fail();
      }
      const compared = await comparePersonalHistoricalReference(
        request,
        boundary,
        p,
        item.historical,
        comparisonAuthority,
      );
      const projected = await projectPersonalHistoricalReference(
        request,
        boundary,
        compared,
        item.labels,
        projectionAuthority,
      );
      const available = new Map(
        compared.years.filter((y) => y.status === "reference_available").map((
          y,
        ) => [y.academicYear, y]),
      );
      // Only independently matched years enter the candidate; missing/mismatched evidence is
      // pending for that offering, not a reason to fail the other selected rows.
      const verifiedPoints = item.trianglePoints.filter((point) => {
        const y = available.get(point.academicYear);
        return !!y && y.observationId === point.observationId &&
          y.relationEvidenceSha256 === point.relationSha256 &&
          y.historicalPercent !== null &&
          exact(y.historicalPercent).compare(exact(point.value)) === 0 &&
          projected.historical.some((h) =>
            h.academicYear === point.academicYear && h.status === "reference_available"
          );
      });
      const triangle = await buildHistoricalTriangleCandidate(
        request,
        boundary,
        id,
        verifiedPoints,
        triangleAuthority,
        item.displayPolicy,
        batch.receipt,
      );
      const adjusted = await applyVerifiedPpToRoundedTriangle(
        request,
        boundary,
        id,
        triangle,
        item.effects,
        item.boundPolicy,
        batch.receipt,
        ppAuthority,
      );
      const readyYears = projected.historical.filter((h) => h.status === "reference_available");
      // Triangle authority independently verifies each point's canonical metricDefinition and
      // cohortDefinition against source evidence; raw source labels are preserved separately.
      let publicTriangle: StudentReferencePublicTriangle = Object.freeze({
        status: "pending",
        reason: triangle.reason ?? triangle.interval.reason ?? "reference_evidence_unavailable",
        expectedAcademicYear: 2027,
        cutoffLabel: null,
        modelAssumption: "triangular_reference",
        historicalLower: null,
        historicalCenter: null,
        historicalUpper: null,
        referenceCenter: null,
        projectedLower: null,
        projectedUpper: null,
        adjustmentStatus: "not_applied",
        adjustedLower: null,
        adjustedUpper: null,
        adjustmentPp: null,
        futureRangeGuaranteed: false,
        actualApplicantRanking: false,
        admissionProbability: null,
      });
      if (
        triangle.status === "reference_available" && readyYears.length === 3 &&
        triangle.triangleReferenceExact !== null && triangle.interval.lowerDisplay !== null &&
        triangle.interval.upperDisplay !== null
      ) {
        const policy = item.boundPolicy;
        if (
          (item.displayPolicy === null &&
            (policy.source !== "user_default" || policy.displayPlaces !== 2 ||
              policy.roundingMode !== "half_up")) ||
          (item.displayPolicy !== null &&
            (policy.source !== "approved_policy" ||
              policy.policyId !== item.displayPolicy.policyId ||
              policy.policySha256 !== item.displayPolicy.policySha256 ||
              policy.displayPlaces !== item.displayPolicy.displayPlaces ||
              policy.roundingMode !== item.displayPolicy.roundingMode))
        ) fail();
        const center = forecastDecimal(
          roundExact(
            forecastNumber(triangle.triangleReferenceExact),
            policy.displayPlaces,
            policy.roundingMode,
          ),
        );
        publicTriangle = Object.freeze({
          status: "reference_available",
          reason: null,
          expectedAcademicYear: 2027,
          cutoffLabel: readyYears[0].cutoffLabel,
          modelAssumption: "triangular_reference",
          historicalLower: triangle.lower,
          historicalCenter: triangle.center,
          historicalUpper: triangle.upper,
          referenceCenter: center,
          projectedLower: triangle.interval.lowerDisplay,
          projectedUpper: triangle.interval.upperDisplay,
          adjustmentStatus: adjusted.status,
          adjustedLower: adjusted.adjusted?.lower ?? null,
          adjustedUpper: adjusted.adjusted?.upper ?? null,
          adjustmentPp: adjusted.deltaPp,
          futureRangeGuaranteed: false,
          actualApplicantRanking: false,
          admissionProbability: null,
        });
      }
      let expected70 = pending70(
        publicTriangle.reason ?? "cutoff_scope_or_display_authority_unavailable",
      );
      // Upper cumulative percent is better when smaller. Only compare displayed values, and
      // never infer a 70% cut or compatible denominator from text or pending labels alone.
      if (
        publicTriangle.status === "reference_available" &&
        projected.personal.examType === "september_mock" &&
        publicTriangle.projectedLower !== null && publicTriangle.projectedUpper !== null &&
        typeof proof.relative70 === "function" &&
        await local(
          proof.relative70,
          Object.freeze({
            request,
            boundary,
            item,
            comparison: projected,
            triangle: publicTriangle,
          }),
        )
      ) {
        const originalLower = publicTriangle.projectedLower,
          originalUpper = publicTriangle.projectedUpper;
        const adjustedLower = publicTriangle.adjustedLower,
          adjustedUpper = publicTriangle.adjustedUpper;
        const applied = publicTriangle.adjustmentStatus === "applied_reference_only" &&
          adjustedLower !== null && adjustedUpper !== null && publicTriangle.adjustmentPp !== null;
        const unadjusted = publicTriangle.adjustmentStatus === "not_applied" &&
          adjustedLower === null && adjustedUpper === null && publicTriangle.adjustmentPp === null;
        const displayed = forecastDecimal(
          roundExact(
            forecastNumber(rawPercent),
            item.boundPolicy.displayPlaces,
            item.boundPolicy.roundingMode,
          ),
        );
        const selectedLower = applied ? adjustedLower : unadjusted ? originalLower : null;
        const selectedUpper = applied ? adjustedUpper : unadjusted ? originalUpper : null;
        let relativePosition: Expected70Reference["relativePosition"] = "pending";
        if (selectedLower !== null && selectedUpper !== null) {
          const value = exact(displayed),
            lower = exact(selectedLower),
            upper = exact(selectedUpper);
          if (lower.compare(upper) > 0) fail();
          const lo = value.compare(lower), hi = value.compare(upper);
          relativePosition = lo === 0 || hi === 0
            ? "boundary"
            : lo < 0
            ? "above_range"
            : hi > 0
            ? "below_range"
            : "within_range";
        }
        expected70 = Object.freeze({
          label: "2027 예상 70% 컷 구간",
          studentExamBasis: "2027학년도 9월 모의평가(2026년 시행)",
          scenarioBasis: "과거 동종 70% 컷의 수능 반영분 상위누백",
          status: selectedLower !== null ? "reference_available" : "pending",
          reason: selectedLower !== null ? null : "adjustment_unconfirmed",
          scenario: "가정상 Q10~Q90 시나리오",
          lower: selectedLower,
          upper: selectedUpper,
          originalLower,
          originalUpper,
          adjustedLower: applied ? adjustedLower : null,
          adjustedUpper: applied ? adjustedUpper : null,
          adjustmentStatus: applied
            ? "applied_reference_only"
            : unadjusted
            ? "not_applied"
            : "pending",
          relativePosition,
          relativeBasis: selectedLower !== null ? "displayed_values_only" : null,
          studentDisplayedPercent: displayed,
          admissionJudgement: false,
          guaranteed: false,
        });
      }
      out.push(
        Object.freeze({
          offeringId: id,
          student,
          status: projected.status,
          comparison: projected,
          triangle: publicTriangle,
          expected70,
          pendingReason: projected.status === "pending" ? "reference_evidence_unavailable" : null,
        }),
      );
      same();
    }
    await ports.source.assertCurrent(request, boundary, batch, selected);
    await ports.cacheFreshness.assertCurrent(request, boundary, stableInput, cacheRowsSha256);
    await authorizeReport(user, reportId, ports.reports, true);
    await ports.delivery.assertCurrent(request, boundary, ports.projection, contractRef);
    await active();
    return ports.projection.project(
      request.operation,
      session.tier,
      Object.freeze({
        format: "jungsi.student-reference-batch/v1",
        status: "ready",
        rows: Object.freeze(out),
      }),
    );
  } finally {
    await requireStoppedAndCurrent(
      () => ports.source.awaitQuiescence(request, boundary, signal),
      () => ports.awaitQuiescence(request, boundary, signal),
    );
    same();
    requirePaidSession(session, ports.clock.nowUtc());
  }
}
