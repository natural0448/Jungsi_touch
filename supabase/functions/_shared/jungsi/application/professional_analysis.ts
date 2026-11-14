/** Institutional orchestration of unchanged approved scoring/percentile engines. */
import { AccessError } from "./access.ts";
import { type CatalogDataPort, CatalogService } from "./catalog.ts";
import { OverallAnalysisService, type OverallDataPort } from "./overall_analysis.ts";
import { evaluateOffering } from "./offering_analysis.ts";
import {
  candidateGroups,
  productionCandidateRows,
  type UniversityAnalysisDataPort,
} from "./university_analysis.ts";
import { buildWildcardCandidateReview } from "./wildcard_candidate_review.ts";
import {
  materializeWildcardReview,
  requestWildcardGrant,
  type WildcardRuntimeGate,
} from "./wildcard_runtime_gate.ts";
import { UniversityScoringService } from "./university_scoring.ts";
import { UniversityPercentileService } from "./university_percentile.ts";
import { SCORE_CONTENT_REJECTION_CODES } from "./score_input_service.ts";
import type { ApprovedScoreStage } from "./score_input_ports.ts";
import type { RequestClockPort } from "./ports.ts";
import {
  ProfessionalPolicy,
  proId,
  proInteger,
  proObject,
  proShape,
} from "./professional_policy.ts";
import type {
  ApprovedAnalysisPort,
  ProfessionalAnalysisBoundary,
  ProfessionalAuthority,
  ProfessionalProfile,
  ProfessionalScope,
  StudentReportPort,
} from "./professional_ports.ts";
import { ContractError } from "../domain/exact.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
export interface ProfessionalAnalysisDataPort
  extends OverallDataPort, CatalogDataPort, UniversityAnalysisDataPort {
  assertCurrentSelection(required?: boolean): Promise<void>;
}
export class ProfessionalApprovedAnalysis implements ApprovedAnalysisPort {
  private dataValue?: Promise<ProfessionalAnalysisDataPort>;
  private readonly maximumOfferings: number;
  private readonly unitsPerOffering: bigint;
  constructor(
    private readonly dataFactory: () => Promise<ProfessionalAnalysisDataPort>,
    private readonly reports: StudentReportPort,
    private readonly policy: ProfessionalPolicy,
    private readonly clock: RequestClockPort,
    limits: {
      readonly maximumOfferings: number;
      readonly unitsPerOffering: bigint;
      readonly reservedCandidateUnits: bigint;
    },
    private readonly wildcardGate: WildcardRuntimeGate | null = null,
  ) {
    this.maximumOfferings = proInteger(limits.maximumOfferings, 1);
    this.unitsPerOffering = limits.unitsPerOffering;
    if (
      typeof this.unitsPerOffering !== "bigint" || this.unitsPerOffering < 1n ||
      BigInt(this.maximumOfferings) * this.unitsPerOffering > limits.reservedCandidateUnits ||
      limits.reservedCandidateUnits > policy.operating.maxRequestCalculationUnits
    ) throw new AccessError("professional_policy_unavailable", 503);
  }
  private data(): Promise<ProfessionalAnalysisDataPort> {
    this.dataValue ??= this.dataFactory();
    return this.dataValue;
  }
  async assertCurrent(): Promise<void> {
    this.policy.assertLive(this.clock.nowUtc());
    if (this.dataValue) await (await this.dataValue).assertCurrentSelection(true);
  }
  async validateScores(
    authority: ProfessionalAuthority,
    stage: ApprovedScoreStage,
    scores: NativeObject,
  ): Promise<string | null> {
    this.policy.assertAuthority(authority, this.clock.nowUtc());
    const data = await this.data(), pack = await data.getExamPack(stage.examId);
    if (
      !pack || pack.examId !== stage.examId || pack.packVersion !== stage.packVersion ||
      pack.academicYear !== authority.contract.academicYear
    ) throw new AccessError("professional_exam_unavailable", 503);
    try {
      pack.analyze(scores);
    } catch (error) {
      if (
        error instanceof ContractError &&
        SCORE_CONTENT_REJECTION_CODES.includes(
          error.code as typeof SCORE_CONTENT_REJECTION_CODES[number],
        )
      ) return error.code;
      throw new AccessError("professional_analysis_unavailable", 503);
    }
    await this.assertCurrent();
    return null;
  }
  async assertOffering(scope: ProfessionalScope, offeringId: string): Promise<void> {
    const catalog = new CatalogService(await this.data(), this.clock),
      release = await catalog.catalog();
    if (!release) throw new AccessError("catalog_release_missing", 503);
    const row = catalog.offering(release, proId(offeringId));
    if (row.academic_year !== scope.authority.contract.academicYear) {
      throw new AccessError("offering_not_found", 404);
    }
    await this.assertCurrent();
  }
  async analyze(
    scope: ProfessionalScope,
    profile: ProfessionalProfile,
    operation: string,
    input: NativeObject,
    boundary?: ProfessionalAnalysisBoundary,
  ) {
    this.policy.assertStudent(scope.authority, scope.student, operation, this.clock.nowUtc());
    this.policy.stage(
      scope.authority,
      profile.examId,
      profile.packVersion,
      profile.stage,
      this.clock.nowUtc(),
      false,
    );
    const data = await this.data();
    if (operation === "pro.overall.analyze") {
      const result = proObject(
        await new OverallAnalysisService(data).analyze({
          user: scope.authority.user,
          evaluatedAtUtc: this.clock.nowUtc(),
          tier: "standard",
          paidUntilUtc: null,
        }, profile.scores),
      );
      await this.assertCurrent();
      return { result, reasons: [] };
    }
    const catalog = new CatalogService(data, this.clock), release = await catalog.catalog();
    if (!release) throw new AccessError("catalog_release_missing", 503);
    let rows = catalog.serviceRows(release).filter((row) =>
      row.academic_year === scope.authority.contract.academicYear
    );
    if (operation === "pro.university.analyze") {
      rows = [catalog.offering(release, proId(input.offering_id))];
    } else if (operation === "pro.candidates") {
      const filters = input.filters === undefined
        ? {}
        : proShape(input.filters, [], ["region", "group", "university_id", "search"]);
      for (const [key, value] of Object.entries(filters)) {
        if (typeof value !== "string" || value.length > this.policy.maxTextCharacters) {
          throw new AccessError("invalid_request", 422);
        }
        rows = rows.filter((row) =>
          key === "search"
            ? [row.university_name, row.department].some((v) =>
              typeof v === "string" &&
              v.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(
                value.normalize("NFKC").toLocaleLowerCase("ko-KR"),
              )
            )
            : row[key] === value
        );
      }
      rows = [...await productionCandidateRows(data, rows)];
    } else throw new AccessError("route_not_found", 404);
    if (
      rows.length > this.maximumOfferings ||
      rows.some((row) => row.academic_year !== scope.authority.contract.academicYear)
    ) throw new AccessError("professional_result_limit_exceeded", 503);
    const saved = (await this.reports.reports(scope, this.policy.maxRosterRows)).find((report) =>
      report.profileId === profile.profileId
    );
    if (!saved) throw new AccessError("professional_initial_report_required", 409);
    const overall = proObject(saved.body.overall),
      scoring = new UniversityScoringService(data),
      percentile = new UniversityPercentileService(data),
      results: NativeObject = {};
    for (const offering of rows) {
      this.policy.assertStudent(scope.authority, scope.student, operation, this.clock.nowUtc());
      const conversion = await scoring.calculate(offering, {
        profile_id: profile.profileId,
        scores: profile.scores,
      });
      const tail = await percentile.calculate(offering, conversion),
        bundle = await data.getAnalysis(proId(offering.offering_id));
      results[proId(offering.offering_id)] = evaluateOffering(
        offering,
        { profile_id: profile.profileId, scores: profile.scores },
        overall,
        bundle,
        conversion,
        tail,
      );
    }
    await this.assertCurrent();
    let result: NativeObject;
    if (operation === "pro.candidates" && this.wildcardGate) {
      if (!scope.student || typeof overall.score_basis !== "string") {
        throw new AccessError("professional_policy_unavailable", 503);
      }
      const analysisContextSha256 = await nativeJsonSha256({
        profile: profile.profileId,
        profile_version: profile.version,
        exam: profile.examId,
        stage: profile.stage,
        filters: input.filters ?? {},
        report: saved.reportId,
        report_revision: saved.revision,
      });
      const grant = await requestWildcardGrant(
        {
          audience: "professional",
          operation: "pro.candidates",
          subjectId: scope.authority.user.subjectId,
          organizationId: scope.authority.contract.orgId,
          studentId: scope.student.studentId,
          reportId: saved.reportId,
          sourceReportRevision: saved.revision,
          profileId: profile.profileId,
          academicYear: scope.authority.contract.academicYear,
          examId: profile.examId,
          scoreBasis: overall.score_basis,
          catalogVersion: release.version,
          analysisContextSha256,
        },
        this.wildcardGate,
        boundary,
      );
      if (!grant) throw new AccessError("professional_policy_unavailable", 503);
      const review = await buildWildcardCandidateReview(
        rows,
        results,
        release.version,
        grant.context,
        grant.evidence,
        grant.signal,
      );
      await grant.assertCurrent();
      this.policy.assertStudent(scope.authority, scope.student, operation, this.clock.nowUtc());
      await this.assertCurrent();
      result = materializeWildcardReview(review);
    } else {
      result = operation === "pro.candidates"
        ? candidateGroups(rows, results, release.version)
        : proObject(results[proId(input.offering_id)]);
    }
    // Counseling reasons copy approved engine results with verified public basis only.
    return {
      result,
      reasons: professionalCounselingReasons(results, scope.authority.contract.academicYear),
      ...(operation === "pro.candidates" ? { assessments: results } : {}),
    };
  }
}

/*
  Student-specific counseling reasons (pro_reason) composed from approved engine results only.
  No new conversion, percentile or decision calculation happens here: values are copied from the
  offering assessment the engine already produced, and the public basis is the verified official
  prior-year publication the decision evidence itself carries. Missing parts emit no reason.
*/
const DECIDED = ["challenge", "core", "room", "outside"];
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_BASIS = 3;

const obj = (v: unknown): NativeObject | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as NativeObject : null;
/** decimal_or_integer: exact decimal strings and safe integers stay as they are */
function exact(v: unknown): string | null {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return typeof v === "string" && DECIMAL.test(v) ? v : null;
}

/** Verified official prior publications behind the decision (https only, de-duplicated). */
function publicBasis(evidence: NativeObject): NativeObject[] {
  const rows = Array.isArray(evidence.historical_metrics) ? evidence.historical_metrics : [];
  const seen = new Set<string>(), out: NativeObject[] = [];
  for (const raw of rows) {
    const r = obj(raw);
    if (!r || typeof r.source_url !== "string" || !r.source_url.startsWith("https://")) continue;
    if (seen.has(r.source_url)) continue;
    seen.add(r.source_url);
    const year = typeof r.academic_year === "number" && Number.isSafeInteger(r.academic_year)
      ? r.academic_year
      : null;
    const metric = typeof r.metric_name === "string" ? r.metric_name : "";
    out.push({
      title: [year === null ? null : `${year}학년도`, metric || null, "대학 발표"].filter(Boolean)
        .join(" "),
      url: r.source_url,
      source_year: year,
    });
    if (out.length >= MAX_BASIS) break;
  }
  return out;
}

/** Baseline reference only: the adopted classification may include a counselor adjustment. */
function classificationBasis(
  offeringId: string,
  assessment: NativeObject,
  academicYear: number,
): NativeObject | null {
  if (assessment.status !== "ready" || !DECIDED.includes(String(assessment.category))) return null;
  const evidence = obj(assessment.decision_evidence);
  const range = evidence && obj(evidence.expected_acceptance_range);
  const score = exact(assessment.converted_score);
  if (!evidence || !range || score === null) return null;
  const lower = exact(range.lower), upper = exact(range.upper);
  const unit = typeof range.unit === "string" && range.unit ? range.unit : null;
  const policy = typeof range.policy_version === "string" && IDENTIFIER.test(range.policy_version)
    ? range.policy_version
    : null;
  const definition = typeof range.definition === "string" && range.definition.trim()
    ? range.definition
    : null;
  const percentile = obj(assessment.percentile);
  const population = percentile?.status === "ready" && percentile.reason_code === null &&
      percentile.academic_year === academicYear && typeof percentile.population_id === "string" &&
      IDENTIFIER.test(percentile.population_id)
    ? percentile.population_id
    : null;
  const basis = publicBasis(evidence);
  if (
    lower === null || upper === null || unit === null || policy === null || definition === null ||
    !basis.length
  ) {
    return null;
  }
  return {
    code: "classification_basis",
    status: "ready",
    academic_year: academicYear,
    offering_id: offeringId,
    comparison_context: {
      academic_year: academicYear,
      reference_year: null,
      metric: "converted_score",
      score_scale: "university_converted_score",
      population_id: population,
      policy_version: policy,
      range_definition: definition,
      range_role: "baseline_reference",
    },
    values: [
      { name: "converted_score", value: score, unit },
      { name: "acceptance_lower", value: lower, unit },
      { name: "acceptance_upper", value: upper, unit },
    ],
    public_basis: basis,
    missing_reason: null,
  };
}

/** Reasons for every analyzed offering, in offering-id order. Unsupported codes stay absent. */
export function professionalCounselingReasons(
  results: NativeObject,
  academicYear: number,
): NativeObject[] {
  const out: NativeObject[] = [];
  for (const offeringId of Object.keys(results).sort()) {
    const assessment = obj(results[offeringId]);
    if (!assessment || !IDENTIFIER.test(offeringId)) continue;
    const reason = classificationBasis(offeringId, assessment, academicYear);
    if (reason) out.push(reason);
  }
  return out;
}
