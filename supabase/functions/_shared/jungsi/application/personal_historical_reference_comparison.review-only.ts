/**
 * REVIEW ONLY: request-scoped comparison of existing mathematical references.
 * No API/DTO registry, production approval, score computation, reference source,
 * database access, release, or runtime wiring is installed by this module.
 * A trusted independent authority must verify the actual source evidence and relations.
 */
import { AccessError } from "./access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { STUDENT_REFERENCE_OPERATION_ID } from "./api_dispatch.ts";
import { exact } from "../domain/exact.ts";

export type ReferenceExamType = "csat" | "september_mock" | "june_mock";
export interface ReferenceYearIdentity {
  readonly academicYear: number;
  readonly schoolId: string;
  readonly offeringPk: string;
  readonly examId: string;
  readonly examType: ReferenceExamType;
  readonly packVersion: string;
  readonly ruleVersion: string;
  readonly scoreScaleId: string;
  readonly cohortId: string;
  readonly modelId: string;
  readonly modelSha256: string;
  readonly sourceHeadSha256: string;
  readonly denominatorKind: "same_year_original_model_whole_exact_mass";
  readonly tiePolicy: "include_equal";
}
export interface PersonalReferenceInput {
  readonly profileId: string;
  readonly identity: ReferenceYearIdentity;
  /** Existing ReferencePercentileService result, not a caller-generated percentage. */
  readonly result: Readonly<Record<string, unknown>> | null;
}
export interface HistoricalReferenceInput {
  readonly identity: ReferenceYearIdentity;
  /** Existing historical_cutoff_references entry, not a newly computed observation. */
  readonly observation: Readonly<Record<string, unknown>> | null;
  readonly relation:
    | Readonly<{
      fromYear: number;
      fromOfferingPk: string;
      toYear: number;
      toOfferingPk: string;
      kind: "continuation" | "merge" | "split" | "other_verified" | "unknown";
      cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "unknown";
      observationUse: "individual_result" | "shared_reference" | "unknown";
      originVerification: "single_original_verified" | "unknown";
      evidenceSha256: string;
    }>
    | null;
}
type Identity = Readonly<ReferenceYearIdentity>;
type PersonalScope = Readonly<{
  request: ApiExecution;
  boundary: ApiExecutionBoundary;
  profileId: string;
  identity: Identity;
  percent: string;
}>;
type PairScope = Readonly<{
  personal: PersonalScope;
  historical: Identity;
  observationId: string;
  historicalPercent: string;
  relation: NonNullable<HistoricalReferenceInput["relation"]>;
}>;
/**
 * A separately installed trusted authority must independently verify identity, confirmed profile,
 * original reference result/evidence, each historical observation and its approved source,
 * whole-scope one-to-one relationship, individual-use qualification, model/denominator/tie
 * compatibility, original cutoff/cohort/score axis, and every head under this exact request and
 * active admission. It must not trust these supplied strings as proof. It must finish all of its
 * I/O before its promise settles, respect boundary.signal, and be safe to call before and after.
 * There is deliberately no operational implementation in this module.
 */
export interface ReferenceComparisonAuthority {
  verifyPersonal(scope: PersonalScope): Promise<boolean>;
  verifyPair(scope: PairScope): Promise<boolean>;
}
export type ReferenceComparisonRow = Readonly<{
  academicYear: 2024 | 2025 | 2026;
  status: "reference_available" | "pending";
  reason: string | null;
  historicalPercent: string | null;
  historicalIdentity: Identity | null;
  /** Server-only binding; never expose to a public response. */
  observationId: string | null;
  relationEvidenceSha256: string | null;
}>;
/** Internal service DTO candidate only; never a public API contract or an admission decision. */
export type PersonalHistoricalReferenceComparison = Readonly<{
  status: "reference_available" | "pending";
  metric: "estimated_upper_cumulative_percent_all_examinees";
  unit: "%";
  comparisonScope: "cross_year_mathematical_reference_only";
  actualApplicantRanking: false;
  admissionPrediction: false;
  productionAllowed: false;
  personalPercent: string | null;
  personalIdentity: Identity | null;
  years: readonly ReferenceComparisonRow[];
}>;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PERCENT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function field(raw: unknown, name: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const d = Object.getOwnPropertyDescriptor(raw, name);
  return d && "value" in d ? d.value : undefined;
}
function token(v: unknown): v is string {
  return typeof v === "string" && TOKEN.test(v);
}
function percent(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 128 || !PERCENT.test(v)) return null;
  try {
    return exact(v).compare(exact(0)) >= 0 && exact(v).compare(exact(100)) <= 0 ? v : null;
  } catch {
    return null;
  }
}
function identity(raw: unknown, expected: number): Identity | null {
  const academicYear = field(raw, "academicYear");
  const schoolId = field(raw, "schoolId"), offeringPk = field(raw, "offeringPk");
  const examId = field(raw, "examId"), examType = field(raw, "examType");
  const packVersion = field(raw, "packVersion"), ruleVersion = field(raw, "ruleVersion");
  const scoreScaleId = field(raw, "scoreScaleId"), cohortId = field(raw, "cohortId");
  const modelId = field(raw, "modelId"), modelSha256 = field(raw, "modelSha256");
  const sourceHeadSha256 = field(raw, "sourceHeadSha256");
  if (
    academicYear !== expected || !token(schoolId) || !token(offeringPk) || !token(examId) ||
    !["csat", "september_mock", "june_mock"].includes(String(examType)) ||
    expected === 2027 && examType !== "september_mock" ||
    !token(packVersion) || !token(ruleVersion) || !token(scoreScaleId) || !token(cohortId) ||
    !token(modelId) || typeof modelSha256 !== "string" || !HASH.test(modelSha256) ||
    typeof sourceHeadSha256 !== "string" || !HASH.test(sourceHeadSha256) ||
    field(raw, "denominatorKind") !== "same_year_original_model_whole_exact_mass" ||
    field(raw, "tiePolicy") !== "include_equal"
  ) return null;
  return Object.freeze({
    academicYear,
    schoolId,
    offeringPk,
    examId,
    examType: examType as ReferenceExamType,
    packVersion,
    ruleVersion,
    scoreScaleId,
    cohortId,
    modelId,
    modelSha256,
    sourceHeadSha256,
    denominatorKind: "same_year_original_model_whole_exact_mass",
    tiePolicy: "include_equal",
  });
}
function relation(raw: unknown, old: Identity, current: Identity): PairScope["relation"] | null {
  const kind = field(raw, "kind"), evidenceSha256 = field(raw, "evidenceSha256");
  if (
    field(raw, "fromYear") !== old.academicYear ||
    field(raw, "fromOfferingPk") !== old.offeringPk ||
    field(raw, "toYear") !== 2027 || field(raw, "toOfferingPk") !== current.offeringPk ||
    !["continuation", "merge", "split", "other_verified"].includes(String(kind)) ||
    field(raw, "cardinality") !== "one_to_one" ||
    field(raw, "observationUse") !== "individual_result" ||
    field(raw, "originVerification") !== "single_original_verified" ||
    typeof evidenceSha256 !== "string" || !HASH.test(evidenceSha256)
  ) return null;
  return Object.freeze({
    fromYear: old.academicYear,
    fromOfferingPk: old.offeringPk,
    toYear: 2027,
    toOfferingPk: current.offeringPk,
    kind: kind as NonNullable<HistoricalReferenceInput["relation"]>["kind"],
    cardinality: "one_to_one",
    observationUse: "individual_result",
    originVerification: "single_original_verified",
    evidenceSha256,
  });
}
function personalValue(raw: unknown): string | null {
  if (
    field(raw, "status") !== "reference_estimated" ||
    field(raw, "metric") !== "estimated_upper_cumulative_percent_all_examinees" ||
    field(raw, "denominator_kind") !== "same_year_original_model_whole_exact_mass" ||
    field(raw, "calculation_review_scope") !== "same_exam_mathematical_reference" ||
    field(raw, "production_allowed") !== false ||
    field(raw, "actual_admission_full_total_approved") !== false
  ) return null;
  return percent(field(raw, "estimated_upper_cumulative_percent_all_examinees"));
}
function historicalValue(
  raw: unknown,
  id: Identity,
): { observationId: string; percent: string } | null {
  const observationId = field(raw, "observation_id"), value = percent(field(raw, "value"));
  if (
    field(raw, "format") !== "jungsi.historical-cutoff-reference/v1" ||
    typeof observationId !== "string" ||
    !/^(?:observation|admission):[a-f0-9]{64}$/.test(observationId) ||
    field(raw, "academic_year") !== id.academicYear || field(raw, "school_id") !== id.schoolId ||
    field(raw, "offering_pk") !== id.offeringPk || field(raw, "unit") !== "%" ||
    field(raw, "status") !== "model_estimated" ||
    field(raw, "scope") !== "historical_admission_cutoff" ||
    field(raw, "display_role") !== "independent_observation" ||
    field(raw, "reference_status") !== "CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE" ||
    field(raw, "engine_approved") !== false || field(raw, "production_allowed") !== false ||
    value === null
  ) return null;
  return { observationId, percent: value };
}
function pending(year: 2024 | 2025 | 2026, reason: string): ReferenceComparisonRow {
  return Object.freeze({
    academicYear: year,
    status: "pending",
    reason,
    historicalPercent: null,
    historicalIdentity: null,
    observationId: null,
    relationEvidenceSha256: null,
  });
}
/** Only pairs already produced by the existing services; no scores, CDFs or historical values are invented. */
export async function comparePersonalHistoricalReference(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  input: PersonalReferenceInput,
  historical: readonly HistoricalReferenceInput[],
  authority: ReferenceComparisonAuthority,
): Promise<PersonalHistoricalReferenceComparison> {
  if (
    !request ||
    !["university.analyze", "candidates.build", STUDENT_REFERENCE_OPERATION_ID].includes(
      request.operation,
    ) ||
    !boundary || !boundary.admission || !boundary.signal || boundary.signal.aborted ||
    !authority || typeof authority.verifyPersonal !== "function" ||
    typeof authority.verifyPair !== "function" || !Array.isArray(historical) ||
    historical.length > 48
  ) unavailable();
  const signal = boundary.signal, admission = boundary.admission;
  const subject = request.session.user.subjectId, operation = request.operation;
  if (!token(subject)) unavailable();
  const check = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.operation !== operation || request.session.user.subjectId !== subject
    ) unavailable();
  };
  const current = identity(field(input, "identity"), 2027), profileId = field(input, "profileId");
  const value = personalValue(field(input, "result"));
  const candidates = ([2024, 2025, 2026] as const).map((year) => ({
    year,
    rows: historical.filter((entry) => field(field(entry, "identity"), "academicYear") === year),
  }));
  const base = {
    metric: "estimated_upper_cumulative_percent_all_examinees" as const,
    unit: "%" as const,
    comparisonScope: "cross_year_mathematical_reference_only" as const,
    actualApplicantRanking: false as const,
    admissionPrediction: false as const,
    productionAllowed: false as const,
  };
  if (!current || !token(profileId) || value === null) {
    return Object.freeze({
      ...base,
      status: "pending" as const,
      personalPercent: null,
      personalIdentity: null,
      years: Object.freeze(
        candidates.map(({ year }) => pending(year, "personal_reference_unavailable")),
      ),
    });
  }
  const personal: PersonalScope = Object.freeze({
    request,
    boundary,
    profileId,
    identity: current,
    percent: value,
  });
  if (await authority.verifyPersonal(personal) !== true) {
    check();
    return Object.freeze({
      ...base,
      status: "pending" as const,
      personalPercent: null,
      personalIdentity: null,
      years: Object.freeze(
        candidates.map(({ year }) => pending(year, "personal_reference_unverified")),
      ),
    });
  }
  check();
  const years: ReferenceComparisonRow[] = [];
  const verifiedPairs: { index: number; scope: PairScope }[] = [];
  for (const { year, rows } of candidates) {
    if (rows.length !== 1) {
      years.push(
        pending(
          year,
          rows.length ? "historical_relation_ambiguous" : "historical_reference_missing",
        ),
      );
      continue;
    }
    const old = identity(field(rows[0], "identity"), year);
    const observed = old && historicalValue(field(rows[0], "observation"), old);
    const link = old && relation(field(rows[0], "relation"), old, current);
    if (!old || !observed || !link) {
      years.push(pending(year, "historical_reference_unverified"));
      continue;
    }
    const scope: PairScope = Object.freeze({
      personal,
      historical: old,
      observationId: observed.observationId,
      historicalPercent: observed.percent,
      relation: link,
    });
    const first = await authority.verifyPair(scope);
    check();
    const currentStillValid = await authority.verifyPersonal(personal);
    check();
    const second = first === true && currentStillValid === true
      ? await authority.verifyPair(scope)
      : false;
    check();
    if (first !== true || currentStillValid !== true || second !== true) {
      years.push(pending(year, "historical_reference_unverified"));
      continue;
    }
    verifiedPairs.push({ index: years.length, scope });
    years.push(
      Object.freeze({
        academicYear: year,
        status: "reference_available",
        reason: null,
        historicalPercent: observed.percent,
        historicalIdentity: old,
        observationId: observed.observationId,
        relationEvidenceSha256: link.evidenceSha256,
      }),
    );
  }
  // The authority must bind all checks to a stable source snapshot and active admission.
  for (const item of verifiedPairs) {
    const approved = await authority.verifyPair(item.scope);
    check();
    if (approved !== true) {
      years[item.index] = pending(
        years[item.index].academicYear,
        "historical_reference_unverified",
      );
    }
  }
  if (await authority.verifyPersonal(personal) !== true) {
    check();
    return Object.freeze({
      ...base,
      status: "pending" as const,
      personalPercent: null,
      personalIdentity: null,
      years: Object.freeze(
        candidates.map(({ year }) => pending(year, "personal_reference_unverified")),
      ),
    });
  }
  check();
  return Object.freeze({
    ...base,
    status: years.some((item) => item.status === "reference_available")
      ? "reference_available"
      : "pending",
    personalPercent: value,
    personalIdentity: current,
    years: Object.freeze(years),
  });
}
