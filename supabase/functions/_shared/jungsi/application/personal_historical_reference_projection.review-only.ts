/** REVIEW ONLY. Allowlist projection candidate, not a registered public response schema or route. */
import { AccessError } from "./access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { STUDENT_REFERENCE_OPERATION_ID } from "./api_dispatch.ts";
import { exact } from "../domain/exact.ts";
import type { PersonalHistoricalReferenceComparison } from "./personal_historical_reference_comparison.review-only.ts";

export type HistoricalPublicLabels = Readonly<{
  academicYear: 2024 | 2025 | 2026;
  /** Private references are used only by the authority; never returned. */
  observationId: string;
  evidenceSha256: string;
  relationEvidenceSha256: string;
  cutoffLabel: string | null;
  cohortLabel: string | null;
  /** Optional only after exact source, cutoff and CSAT-component proof. */
  reviewNote?: "자료 검토 중·수능 반영분 참고" | null;
}>;
export type PublicComparisonProjection = Readonly<{
  format: "jungsi.personal-historical-reference-projection-candidate/v1";
  status: "reference_available" | "pending";
  metric: "estimated_upper_cumulative_percent_all_examinees";
  unit: "%";
  scope: "cross_year_mathematical_reference_only";
  actualApplicantRanking: false;
  admissionPrediction: false;
  productionAllowed: false;
  personal: Readonly<{
    academicYear: 2027;
    examType: "september_mock" | null;
    schoolId: string | null;
    offeringPk: string | null;
    estimatedUpperPercent: string | null;
  }>;
  historical: readonly Readonly<{
    academicYear: 2024 | 2025 | 2026;
    status: "reference_available" | "pending";
    reason: "reference_or_label_unverified" | null;
    examType: "csat" | "september_mock" | "june_mock" | null;
    schoolId: string | null;
    offeringPk: string | null;
    cutoffLabel: string | null;
    cohortLabel: string | null;
    reviewNote: "자료 검토 중·수능 반영분 참고" | null;
    estimatedUpperPercent: string | null;
  }>[];
}>;
/**
 * No implementation is installed. The authority must independently bind the same active
 * request, session, admission and owner access to the trusted comparison and source observations,
 * verify every supplied label against its exact observation and evidence, verify that the
 * allowlisted school/offering identifiers and fields are permitted by the applicable response
 * schema, and confirm source/head freshness before and after projection. A supplied hash,
 * structurally valid DTO or caller-provided label is never itself proof. Its I/O must stop before
 * its promise resolves and it must honour the same request signal and physical budget.
 */
export interface ReferencePublicProjectionAuthority {
  verify(
    scope: Readonly<{
      request: ApiExecution;
      boundary: ApiExecutionBoundary;
      comparison: PersonalHistoricalReferenceComparison;
      labels: readonly HistoricalPublicLabels[];
    }>,
  ): Promise<boolean>;
}
const HASH = /^[a-f0-9]{64}$/;
const OBSERVATION = /^(?:observation|admission):[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PERCENT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function label(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" || !value.trim() || value.length > 256 ||
    Array.from(value).some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)
  ) fail();
  return value;
}
function percent(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 128 || !PERCENT.test(value)) fail();
  try {
    if (exact(value).compare(exact(0)) < 0 || exact(value).compare(exact(100)) > 0) fail();
  } catch {
    fail();
  }
  return value;
}
/**
 * A rejected/missing field label produces a pending historical row; values are not reconstructed
 * from old uploads. Explicit construction prevents internal profile IDs, exam IDs, pack/rule
 * versions, model IDs, hashes, relation proofs and source heads from entering the returned DTO.
 */
export async function projectPersonalHistoricalReference(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  comparison: PersonalHistoricalReferenceComparison,
  suppliedLabels: readonly HistoricalPublicLabels[],
  authority: ReferencePublicProjectionAuthority,
): Promise<PublicComparisonProjection> {
  if (
    !request ||
    !["university.analyze", "candidates.build", STUDENT_REFERENCE_OPERATION_ID].includes(
      request.operation,
    ) ||
    !boundary || !boundary.admission || !boundary.signal || boundary.signal.aborted ||
    !comparison || !Object.isFrozen(comparison) || !Array.isArray(comparison.years) ||
    !Object.isFrozen(comparison.years) || comparison.years.length !== 3 ||
    !Array.isArray(suppliedLabels) || suppliedLabels.length > 3 || !authority ||
    typeof authority.verify !== "function"
  ) fail();
  const signal = boundary.signal, admission = boundary.admission, session = request.session;
  const subject = session.user.subjectId,
    operation = request.operation,
    requestKey = request.requestKey;
  const check = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session !== session || request.session.user.subjectId !== subject ||
      request.operation !== operation || request.requestKey !== requestKey
    ) fail();
  };
  if (
    comparison.metric !== "estimated_upper_cumulative_percent_all_examinees" ||
    comparison.unit !== "%" ||
    comparison.comparisonScope !== "cross_year_mathematical_reference_only" ||
    comparison.actualApplicantRanking !== false || comparison.admissionPrediction !== false ||
    comparison.productionAllowed !== false ||
    !["reference_available", "pending"].includes(comparison.status)
  ) fail();
  const seen = new Set<number>();
  const labels = Object.freeze(suppliedLabels.map((item) => {
    if (
      !item || ![2024, 2025, 2026].includes(item.academicYear) || seen.has(item.academicYear) ||
      typeof item.observationId !== "string" || !OBSERVATION.test(item.observationId) ||
      typeof item.evidenceSha256 !== "string" || !HASH.test(item.evidenceSha256) ||
      typeof item.relationEvidenceSha256 !== "string" || !HASH.test(item.relationEvidenceSha256)
    ) fail();
    seen.add(item.academicYear);
    if (
      item.reviewNote !== undefined && item.reviewNote !== null &&
      item.reviewNote !== "자료 검토 중·수능 반영분 참고"
    ) fail();
    return Object.freeze({
      academicYear: item.academicYear,
      observationId: item.observationId,
      evidenceSha256: item.evidenceSha256,
      relationEvidenceSha256: item.relationEvidenceSha256,
      cutoffLabel: label(item.cutoffLabel),
      cohortLabel: label(item.cohortLabel),
      reviewNote: item.reviewNote ?? null,
    });
  }));
  const scope = Object.freeze({ request, boundary, comparison, labels });
  if (await authority.verify(scope) !== true) fail();
  check();
  const identity = comparison.personalIdentity;
  if (
    identity && (!Object.isFrozen(identity) || identity.academicYear !== 2027 ||
      identity.examType !== "september_mock" || !ID.test(identity.schoolId) ||
      !ID.test(identity.offeringPk))
  ) fail();
  const personalPercent = percent(comparison.personalPercent);
  if (personalPercent !== null && !identity) fail();
  const personal = Object.freeze({
    academicYear: 2027 as const,
    examType: identity?.examType === "september_mock" ? "september_mock" as const : null,
    schoolId: identity?.schoolId ?? null,
    offeringPk: identity?.offeringPk ?? null,
    estimatedUpperPercent: personalPercent,
  });
  const labelByYear = new Map(labels.map((item) => [item.academicYear, item]));
  const years = new Set<number>();
  const historical = Object.freeze(comparison.years.map((row) => {
    if (
      !row || !Object.isFrozen(row) || ![2024, 2025, 2026].includes(row.academicYear) ||
      years.has(row.academicYear) ||
      !["reference_available", "pending"].includes(row.status)
    ) fail();
    years.add(row.academicYear);
    const meta = labelByYear.get(row.academicYear), old = row.historicalIdentity;
    if (
      row.status === "reference_available" && old && (!Object.isFrozen(old) ||
        old.academicYear !== row.academicYear || !ID.test(old.schoolId) ||
        !ID.test(old.offeringPk) ||
        !["csat", "september_mock", "june_mock"].includes(old.examType))
    ) fail();
    const value = percent(row.historicalPercent);
    const ready = comparison.status === "reference_available" &&
      row.status === "reference_available" && old !== null && value !== null &&
      meta?.cutoffLabel != null && meta.cohortLabel != null &&
      meta.observationId === row.observationId &&
      meta.relationEvidenceSha256 === row.relationEvidenceSha256 &&
      personalPercent !== null;
    return Object.freeze({
      academicYear: row.academicYear,
      status: ready ? "reference_available" as const : "pending" as const,
      reason: ready ? null : "reference_or_label_unverified" as const,
      examType: ready ? old.examType : null,
      schoolId: ready ? old.schoolId : null,
      offeringPk: ready ? old.offeringPk : null,
      cutoffLabel: ready ? meta.cutoffLabel : null,
      cohortLabel: ready ? meta.cohortLabel : null,
      reviewNote: ready ? meta.reviewNote : null,
      estimatedUpperPercent: ready ? value : null,
    });
  }));
  if (await authority.verify(scope) !== true) fail();
  check();
  return Object.freeze({
    format: "jungsi.personal-historical-reference-projection-candidate/v1",
    status: historical.some((row) => row.status === "reference_available")
      ? "reference_available"
      : "pending",
    metric: "estimated_upper_cumulative_percent_all_examinees",
    unit: "%",
    scope: "cross_year_mathematical_reference_only",
    actualApplicantRanking: false,
    admissionPrediction: false,
    productionAllowed: false,
    personal,
    historical,
  });
}
