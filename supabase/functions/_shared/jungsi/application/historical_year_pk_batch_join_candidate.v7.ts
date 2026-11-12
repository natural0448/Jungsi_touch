/** REVIEW ONLY: bounded Guide relation + current cutoff year/PK join.
 * No source locator, SQL privilege, proof issuer, publication or runtime is installed.
 * An owner-supplied read-only batch and independent live authority are mandatory.
 */
import { AccessError } from "./access.ts";
import { requireVoidDrains } from "./reference_quiescence_fence.review-only.ts";
import { exact } from "../domain/exact.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import {
  buildHistoricalTriangleCandidate,
  type TriangleDisplayPolicy,
  type TriangleHistoryPoint,
  type TriangleResult,
  type TriangleScope,
} from "./historical_triangle_candidate.review-only.v8.ts";

export type HistoricalJoinTarget = Readonly<{ schoolId: string; offeringPk2027: string }>;
/** Native Guide relation columns; metadata labels alone are never authorization. */
export type HistoricalGuideRelation = Readonly<
  {
    releaseId: string;
    relationSha256: string;
    schoolId: string;
    fromSchoolId: string;
    toSchoolId: string;
    fromYear: 2024 | 2025 | 2026;
    fromPk: string;
    toYear: 2025 | 2026 | 2027;
    toPk: string;
  }
>;
/** Represents one current cutoff row linked to its observation and method evidence. */
export type HistoricalCutoffRow = Readonly<
  {
    releaseId: string;
    academicYear: 2024 | 2025 | 2026;
    schoolId: string;
    offeringPk: string;
    canonicalResultId: string;
    methodId: string;
    engineApproved: boolean;
    productionAllowed: boolean;
    point: Readonly<TriangleHistoryPoint>;
  }
>;
export type HistoricalJoinBatch = Readonly<
  {
    relations: readonly HistoricalGuideRelation[];
    cutoffs: readonly HistoricalCutoffRow[];
    receipt: object;
  }
>;
export interface HistoricalYearPkBatchSource {
  /** Exactly one bounded read; no per-offering or per-year source round trip. */
  read(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    targets: readonly HistoricalJoinTarget[],
  ): Promise<HistoricalJoinBatch>;
}
export type JoinPendingReason =
  | "relation_unconfirmed"
  | "relation_ambiguous"
  | "cutoff_unavailable"
  | "cutoff_ambiguous"
  | "source_unverified"
  | "cohort_or_cutoff_unconfirmed"
  | "production_not_approved";
export type CutoffAssessment = Readonly<
  {
    selection: "selected" | "other_cut" | "unresolved";
    display: boolean;
    triangle: boolean;
    reason: JoinPendingReason | null;
  }
>;
/** Trusted and separately installed authority. This is not implemented by the request,
 * hash comparison or default boolean; it must independently verify actual scope, head,
 * Guide edge and its from/to school IDs by explicit current Guide endpoint or validated overlay,
 * canonical CID/source/overlay, cut/cohort, score axis and method/CDF. Name similarity is not evidence.
 * Returned proof functions are request-local and must never perform or schedule I/O. */
export type ReferenceScenarioScope = Readonly<
  {
    request: ApiExecution;
    boundary: ApiExecutionBoundary;
    target: HistoricalJoinTarget;
    rows: readonly HistoricalCutoffRow[];
    receipt: object;
  }
>;
export interface HistoricalYearPkAuthority {
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    source: HistoricalYearPkBatchSource,
    batch: HistoricalJoinBatch | null,
  ): Promise<void>;
  attest(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    source: HistoricalYearPkBatchSource,
    batch: HistoricalJoinBatch,
  ): Promise<
    Readonly<{
      relation(edge: HistoricalGuideRelation, target: HistoricalJoinTarget): boolean;
      cutoff(row: HistoricalCutoffRow, target: HistoricalJoinTarget): CutoffAssessment;
      triangle(scope: Readonly<TriangleScope>): boolean;
      policy?(scope: Readonly<TriangleScope>, policy: Readonly<TriangleDisplayPolicy>): boolean;
    }>
  >;
  /** Wait for physical termination of every started source/authority I/O, including abort. */
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
/** Separate, server-issued reference-only authority. Its live checks must bind the exact
 * request/admission, current source/head, named scenario policy and immutable receipt.
 * Its local proof verifies all three rows and never grants official or production approval. */
export interface ReferenceScenarioIssuer {
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    batch: HistoricalJoinBatch,
  ): Promise<void>;
  attest(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    batch: HistoricalJoinBatch,
  ): Promise<Readonly<{ verify(scope: ReferenceScenarioScope): boolean }>>;
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
export type HistoricalJoinYear = Readonly<
  {
    year: 2024 | 2025 | 2026;
    status: "reference" | "pending";
    label: "참고·기준 확인 중" | null;
    value: string | null;
    reason: JoinPendingReason | null;
  }
>;
export type HistoricalJoinResult = Readonly<
  {
    target: HistoricalJoinTarget;
    years: readonly HistoricalJoinYear[];
    triangle: TriangleResult | null;
    trianglePending: JoinPendingReason | null;
    triangleAuthorityMode: "production" | "server_reference_scenario" | null;
    /** Server only: never project source rows, receipt or exact IDs to a public DTO. */
    privateVerifiedRows: readonly HistoricalCutoffRow[];
    privateSourceBatch: HistoricalJoinBatch;
  }
>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HASH = /^[a-f0-9]{64}$/;
const YEARS = [2024, 2025, 2026] as const;
const REASONS: readonly JoinPendingReason[] = [
  "relation_unconfirmed",
  "relation_ambiguous",
  "cutoff_unavailable",
  "cutoff_ambiguous",
  "source_unverified",
  "cohort_or_cutoff_unconfirmed",
  "production_not_approved",
];
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function token(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
function immutableData(value: unknown): boolean {
  if (
    !value || typeof value !== "object" || Array.isArray(value) || !Object.isFrozen(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const d = Object.getOwnPropertyDescriptor(value, key);
    return !!d && "value" in d && d.enumerable;
  });
}
function validPercent(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 64 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v)) {
    return false;
  }
  try {
    return exact(v).compare(exact(0)) >= 0 && exact(v).compare(exact(100)) <= 0;
  } catch {
    return false;
  }
}
function pending(year: 2024 | 2025 | 2026, reason: JoinPendingReason): HistoricalJoinYear {
  return Object.freeze({ year, status: "pending", label: null, value: null, reason });
}
/** Preserves the full 2027 target list; a 73-shape subset is not a filter. */
export async function joinHistoricalYearPkBatchCandidate(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  inputs: readonly HistoricalJoinTarget[],
  source: HistoricalYearPkBatchSource,
  authority: HistoricalYearPkAuthority,
  scenarioIssuer?: ReferenceScenarioIssuer,
): Promise<readonly HistoricalJoinResult[]> {
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100 || !source ||
    typeof source.read !== "function" || !authority ||
    typeof authority.assertCurrent !== "function" ||
    typeof authority.attest !== "function" || typeof authority.awaitQuiescence !== "function"
  ) fail();
  if (
    scenarioIssuer && (typeof scenarioIssuer.assertCurrent !== "function" ||
      typeof scenarioIssuer.attest !== "function" ||
      typeof scenarioIssuer.awaitQuiescence !== "function")
  ) fail();
  const signal = boundary.signal, admission = boundary.admission, session = request.session;
  const subject = session?.user?.subjectId, operation = request.operation;
  if (!token(subject)) fail();
  const targets = Object.freeze(inputs.map((x) => {
    if (!x || !token(x.schoolId) || !token(x.offeringPk2027)) fail();
    return Object.freeze({ schoolId: x.schoolId, offeringPk2027: x.offeringPk2027 });
  }));
  if (
    new Set(targets.map((x) => JSON.stringify([x.schoolId, x.offeringPk2027]))).size !==
      targets.length
  ) fail();
  const same = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session !== session || request.session?.user?.subjectId !== subject ||
      request.operation !== operation
    ) fail();
  };
  try {
    await authority.assertCurrent(request, boundary, source, null);
    same();
    const batch = await source.read(request, boundary, targets);
    same();
    if (
      !batch || !immutableData(batch) || !batch.receipt || typeof batch.receipt !== "object" ||
      !Object.isFrozen(batch.receipt) ||
      !Array.isArray(batch.relations) || !Object.isFrozen(batch.relations) ||
      batch.relations.length > 3000 ||
      !Array.isArray(batch.cutoffs) || !Object.isFrozen(batch.cutoffs) ||
      batch.cutoffs.length > 3000
    ) fail();
    for (const e of batch.relations) {
      if (
        !immutableData(e) || !token(e.releaseId) || !HASH.test(e.relationSha256) ||
        !token(e.schoolId) || !token(e.fromSchoolId) || !token(e.toSchoolId) ||
        !token(e.fromPk) || !token(e.toPk) ||
        !YEARS.includes(e.fromYear) || ![2025, 2026, 2027].includes(e.toYear) ||
        e.toYear <= e.fromYear
      ) fail();
    }
    for (const c of batch.cutoffs) {
      if (
        !immutableData(c) || !immutableData(c.point) || !token(c.releaseId) ||
        !YEARS.includes(c.academicYear) || !token(c.schoolId) || !token(c.offeringPk) ||
        !token(c.canonicalResultId) || !token(c.methodId) ||
        typeof c.engineApproved !== "boolean" ||
        typeof c.productionAllowed !== "boolean" || c.point.academicYear !== c.academicYear ||
        c.point.observationId !== c.canonicalResultId || !validPercent(c.point.value)
      ) fail();
    }
    const proof = await authority.attest(request, boundary, source, batch);
    same();
    if (
      !proof || !Object.isFrozen(proof) || typeof proof.relation !== "function" ||
      typeof proof.cutoff !== "function" || typeof proof.triangle !== "function"
    ) fail();
    let scenarioProof: Readonly<{ verify(scope: ReferenceScenarioScope): boolean }> | null = null;
    let scenarioUsed = false;
    if (scenarioIssuer) {
      await scenarioIssuer.assertCurrent(request, boundary, batch);
      same();
      scenarioProof = await scenarioIssuer.attest(request, boundary, batch);
      same();
      if (
        !scenarioProof || !Object.isFrozen(scenarioProof) ||
        typeof scenarioProof.verify !== "function"
      ) fail();
    }
    const results: HistoricalJoinResult[] = [];
    for (const target of targets) {
      type Endpoint = Readonly<{ schoolId: string; pk: string }>;
      const endpointKey = (schoolId: string, pk: string) => JSON.stringify([schoolId, pk]);
      const root: Endpoint = Object.freeze({
        schoolId: target.schoolId,
        pk: target.offeringPk2027,
      });
      const reachable = new Map<number, Map<string, Endpoint>>([[
        2027,
        new Map([[endpointKey(root.schoolId, root.pk), root]]),
      ]]);
      // An unverified edge can affect only its from-year and earlier ancestors.
      const unverifiedYears = new Set<number>();
      for (let year = 2027; year > 2024; year--) {
        const endpoints = reachable.get(year);
        if (!endpoints) continue;
        for (const edge of batch.relations) {
          if (edge.toYear !== year || !endpoints.has(endpointKey(edge.toSchoolId, edge.toPk))) {
            continue;
          }
          if (proof.relation(edge, target) !== true) {
            for (const y of YEARS) if (y <= edge.fromYear) unverifiedYears.add(y);
            continue;
          }
          const parents = reachable.get(edge.fromYear) ?? new Map<string, Endpoint>();
          parents.set(
            endpointKey(edge.fromSchoolId, edge.fromPk),
            Object.freeze({ schoolId: edge.fromSchoolId, pk: edge.fromPk }),
          );
          reachable.set(edge.fromYear, parents);
        }
      }
      const years: HistoricalJoinYear[] = [], points: TriangleHistoryPoint[] = [];
      const selectedRows: HistoricalCutoffRow[] = [], verifiedRows: HistoricalCutoffRow[] = [];
      let firstReason: JoinPendingReason | null = null, needsScenario = false;
      for (const year of YEARS) {
        const endpoints = reachable.get(year);
        let reason: JoinPendingReason | null = unverifiedYears.has(year) || !endpoints?.size
          ? "relation_unconfirmed"
          : endpoints.size !== 1
          ? "relation_ambiguous"
          : null;
        const endpoint = endpoints?.size === 1 ? [...endpoints.values()][0] : null;
        const rows = endpoint === null
          ? []
          : batch.cutoffs.filter((c) =>
            c.schoolId === endpoint.schoolId &&
            c.academicYear === year && c.offeringPk === endpoint.pk
          );
        if (reason) {
          years.push(pending(year, reason));
          firstReason ??= reason;
          continue;
        }
        const assessed = rows.map((row) => {
          const decision = proof.cutoff(row, target);
          if (
            !immutableData(decision) ||
            !["selected", "other_cut", "unresolved"].includes(decision.selection) ||
            typeof decision.display !== "boolean" || typeof decision.triangle !== "boolean" ||
            !(decision.reason === null || REASONS.includes(decision.reason)) ||
            decision.triangle && !decision.display || decision.selection !== "selected" &&
              (decision.display || decision.triangle)
          ) fail();
          return { row, decision };
        });
        if (assessed.some((x) => x.decision.selection === "unresolved")) {
          reason = "cohort_or_cutoff_unconfirmed";
        }
        const matches = assessed.filter((x) => x.decision.selection === "selected");
        if (!reason && matches.length === 0) reason = "cutoff_unavailable";
        if (!reason && matches.length !== 1) reason = "cutoff_ambiguous";
        if (reason) {
          years.push(pending(year, reason));
          firstReason ??= reason;
          continue;
        }
        const { row, decision } = matches[0];
        if (!decision.display) {
          reason = decision.reason ?? "source_unverified";
          years.push(pending(year, reason));
          firstReason ??= reason;
          continue;
        }
        years.push(
          Object.freeze({
            year,
            status: "reference",
            label: "참고·기준 확인 중",
            value: row.point.value,
            reason: null,
          }),
        );
        verifiedRows.push(row);
        if (!decision.triangle) firstReason ??= decision.reason ?? "cohort_or_cutoff_unconfirmed";
        else {
          points.push(row.point);
          selectedRows.push(row);
          if (!row.engineApproved || !row.productionAllowed) needsScenario = true;
        }
      }
      let triangle: TriangleResult | null = null;
      let triangleAuthorityMode: HistoricalJoinResult["triangleAuthorityMode"] = null;
      if (points.length === 3 && firstReason === null && needsScenario) {
        const scope: ReferenceScenarioScope = Object.freeze({
          request,
          boundary,
          target,
          rows: Object.freeze(selectedRows),
          receipt: batch.receipt,
        });
        if (!scenarioProof || scenarioProof.verify(scope) !== true) {
          firstReason = "production_not_approved";
        } else {
          scenarioUsed = true;
          triangleAuthorityMode = "server_reference_scenario";
        }
      }
      if (points.length === 3 && firstReason === null) {
        triangleAuthorityMode ??= "production";
        triangle = await buildHistoricalTriangleCandidate(
          request,
          boundary,
          "2027:" + target.offeringPk2027,
          Object.freeze(points),
          {
            // Keep synchronous authority failures as rejected promises.
            // deno-lint-ignore require-await
            verifyHistory: async (scope) => proof.triangle(scope) === true,
            ...(proof.policy
              ? {
                // Keep synchronous authority failures as rejected promises.
                // deno-lint-ignore require-await
                verifyDisplayPolicy: async (scope, policy) => proof.policy!(scope, policy) === true,
              }
              : {}),
          },
          null,
          batch.receipt,
        );
        same();
      }
      results.push(
        Object.freeze({
          target,
          years: Object.freeze(years),
          triangle,
          trianglePending: triangle === null ? firstReason ?? "cohort_or_cutoff_unconfirmed" : null,
          triangleAuthorityMode,
          privateVerifiedRows: Object.freeze(verifiedRows),
          privateSourceBatch: batch,
        }),
      );
    }
    await authority.assertCurrent(request, boundary, source, batch);
    same();
    if (scenarioUsed && scenarioIssuer) {
      await scenarioIssuer.assertCurrent(request, boundary, batch);
      same();
    }
    return Object.freeze(results);
  } finally {
    await requireVoidDrains([
      () => authority.awaitQuiescence(signal),
      ...(scenarioIssuer ? [() => scenarioIssuer.awaitQuiescence(signal)] : []),
    ]);
  }
}
