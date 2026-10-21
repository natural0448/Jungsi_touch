/** Institutional orchestration of unchanged approved scoring/percentile engines. */
import { AccessError } from "./access.ts";
import { type CatalogDataPort, CatalogService } from "./catalog.ts";
import { OverallAnalysisService, type OverallDataPort } from "./overall_analysis.ts";
import { evaluateOffering } from "./offering_analysis.ts";
import { candidateGroups, type UniversityAnalysisDataPort } from "./university_analysis.ts";
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
  ProfessionalAuthority,
  ProfessionalProfile,
  ProfessionalScope,
  StudentReportPort,
} from "./professional_ports.ts";
import { ContractError } from "../domain/exact.ts";
import { type NativeObject } from "../domain/json_value.ts";
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
    const result = operation === "pro.candidates"
      ? candidateGroups(rows, results, release.version)
      : proObject(results[proId(input.offering_id)]);
    // Counseling signals are emitted only by a separately verified, complete evidence contract.
    return {
      result,
      reasons: [],
      ...(operation === "pro.candidates" ? { assessments: results } : {}),
    };
  }
}
