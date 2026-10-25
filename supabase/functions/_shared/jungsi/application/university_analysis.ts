/** Paid owned-report university and full-catalog candidate workflows. No in-place profile edits. */
import { AccessError, authorizeReport } from "./access.ts";
import type { ApiBusinessPort, ApiExecution } from "./api_dispatch.ts";
import { CatalogService, offeringDto } from "./catalog.ts";
import { evaluateOffering, type OfferingAnalysisDataPort } from "./offering_analysis.ts";
import type { PlatformRepositoryPort, StoredProfile, StoredReport } from "./platform_repository.ts";
import type { RequestClockPort } from "./ports.ts";
import { reportDto, type ScoreWorkflowMode } from "./profile_reports.ts";
import { sessionDto, type SessionSnapshot } from "./session_service.ts";
import {
  ScoringResult,
  type UniversityScoringDataPort,
  UniversityScoringService,
} from "./university_scoring.ts";
import {
  PercentileResult,
  type UniversityPercentileDataPort,
  UniversityPercentileService,
} from "./university_percentile.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { personalAssessment, personalResultComponents } from "./paid_result_components.ts";
export const UNIVERSITY_ANALYSIS_OPERATIONS = ["university.analyze", "candidates.build"] as const;
export interface UniversityAnalysisDataPort
  extends UniversityScoringDataPort, UniversityPercentileDataPort, OfferingAnalysisDataPort {}
/** Concrete forecast implementation verifies a complete, bound batch before evaluation. */
export interface PublishedForecastPort {
  validatedReleases(
    offeringIds: readonly string[],
    verifiedSubjectId: string,
  ): Promise<ReadonlyMap<string, NativeObject | AccessError | null>>;
  evaluateRelease(
    offering: Readonly<NativeObject>,
    profile: StoredProfile,
    conversion: ScoringResult,
    percentile: PercentileResult,
    release: Readonly<NativeObject>,
    historicalMetrics: readonly NativeJson[],
  ): NativeObject | Promise<NativeObject>;
}
function fail(code = "invalid_repository_result", http = 503): never {
  throw new AccessError(code, http);
}
function object(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function shape(
  v: unknown,
  required: readonly string[] = [],
  optional: readonly string[] = [],
): NativeObject {
  if (
    !object(v) || required.some((k) => !Object.hasOwn(v, k)) ||
    Object.keys(v).some((k) => ![...required, ...optional].includes(k))
  ) fail("invalid_request", 422);
  return v;
}
function identifier(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) {
    fail("invalid_identifier", 422);
  }
  return v;
}
function revision(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) fail("invalid_revision", 422);
  return v;
}
export function candidateGroups(
  rows: readonly NativeObject[],
  analyses: Readonly<NativeObject>,
  version: string,
): NativeObject {
  const groups = new Map<string, NativeObject>(),
    wildcards: NativeJson[] = [],
    pending: NativeJson[] = [],
    outside: NativeJson[] = [],
    ineligible: NativeJson[] = [];
  for (const row of rows) {
    const a = analyses[row.offering_id as string];
    if (!object(a)) fail();
    const state = {
      offering_id: row.offering_id,
      category: a.category,
      reason_code: a.reason_code,
    };
    if (a.status === "ineligible") {
      ineligible.push(state);
      continue;
    }
    if (a.status === "ready" && a.category === "outside") {
      outside.push(state);
      continue;
    }
    if (a.status !== "ready" || !["challenge", "core", "room"].includes(a.category as string)) {
      pending.push(state);
      continue;
    }
    const item = { offering: offeringDto(row), assessment: cloneNativeJson(a) },
      uid = row.university_id as string;
    if (!groups.has(uid)) {
      groups.set(uid, {
        university_id: row.university_id,
        university_name: row.university_name,
        offerings: [],
      });
    }
    (groups.get(uid)!.offerings as NativeJson[]).push(item);
    if (["nursing", "health", "education"].includes(row.wildcard_group as string)) {
      wildcards.push(item);
    }
  }
  const ready = groups.size > 0 || pending.length === 0;
  return {
    status: ready ? "ready" : "pending",
    reason_code: ready ? null : "approved_candidates_missing",
    basic_university_groups: [...groups.values()],
    wildcards,
    pending_offerings: pending,
    outside_offerings: outside,
    ineligible_offerings: ineligible,
    catalog_version: version,
  };
}
export class UniversityAnalysisService implements ApiBusinessPort {
  private readonly scoring: UniversityScoringService;
  private readonly percentile: UniversityPercentileService;
  constructor(
    private readonly repository: PlatformRepositoryPort,
    private readonly catalog: CatalogService,
    private readonly data: UniversityAnalysisDataPort,
    private readonly clock: RequestClockPort,
    private readonly forecasts: PublishedForecastPort | null,
    private readonly policyMode: ScoreWorkflowMode = { mode: "rights", workflow: null },
  ) {
    this.scoring = new UniversityScoringService(data);
    this.percentile = new UniversityPercentileService(data);
  }
  private fresh(session: SessionSnapshot): bigint {
    if (
      !session?.user || typeof session.user.subjectId !== "string" ||
      !session.user.subjectId.trim() ||
      typeof session.user.expiresAtUtc !== "bigint" || typeof session.evaluatedAtUtc !== "bigint"
    ) {
      fail("authentication_required", 401);
    }
    const now = this.clock.nowUtc();
    sessionDto(session, now);
    return now;
  }
  private async report(session: SessionSnapshot, id: string): Promise<StoredReport> {
    const report = await this.repository.getReport(session.user.subjectId, id);
    if (!report) fail("report_not_found", 404);
    if (
      report.owner_id !== session.user.subjectId || !object(report.body) ||
      !object(report.body.overall)
    ) fail();
    return report;
  }
  async execute(request: ApiExecution): Promise<NativeObject> {
    const { operation: op, session, params, body, query } = request;
    if (
      !UNIVERSITY_ANALYSIS_OPERATIONS.includes(op as typeof UNIVERSITY_ANALYSIS_OPERATIONS[number])
    ) fail("route_not_found", 404);
    this.fresh(session);
    if (session.tier !== "paid") fail("paid_required", 403);
    const workflow = this.policyMode.mode === "rights" ? this.policyMode.workflow : null;
    if (this.policyMode.mode === "rights" && !workflow) fail("score_input_policy_unavailable", 503);
    const rid = identifier(params.report_id);
    await authorizeReport(session.user, rid, {
      find: (id) => this.repository.lookupAccess(session.user.subjectId, id),
    }, true);
    shape(query);
    const key = identifier(request.requestKey),
      digest = await nativeJsonSha256([body, params]),
      replay = await this.repository.replay(session.user.subjectId, op, key, digest);
    if (replay !== null) {
      if (!("body" in replay) || replay.owner_id !== session.user.subjectId) fail();
      this.fresh(session);
      return reportDto(session, replay);
    }
    const record = await this.report(session, rid),
      input = shape(
        body,
        ["expected_version"],
        op === "university.analyze" ? ["offering_ids"] : [],
      ),
      expected = revision(input.expected_version);
    if (record.revision !== expected) fail("revision_conflict", 409);
    const release = await this.catalog.catalog(),
      updated = cloneNativeJson(record.body),
      profile = await this.repository.getProfile(session.user.subjectId, record.profile_id);
    if (
      !profile || profile.owner_id !== session.user.subjectId ||
      profile.profile_id !== record.profile_id || profile.confirmed !== true
    ) fail();
    if (workflow) await workflow.assertProfile(session, profile);
    const originKeys: string[] = [];
    if (!release) {
      updated.analysis_status = { status: "pending", reason_code: "catalog_release_missing" };
    } else {
      let rows: readonly NativeObject[];
      if (op === "university.analyze") {
        const ids = input.offering_ids;
        if (
          !Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
          new Set(ids.map(String)).size !== ids.length
        ) fail("invalid_offering_ids", 422);
        rows = ids.map((id) => this.catalog.offering(release, id));
      } else {
        const overall = updated.overall;
        if (!object(overall) || !object(overall.exam)) fail();
        rows = this.catalog.serviceRows(release).filter((r) =>
          r.academic_year === (overall.exam as NativeObject).academic_year
        );
      }
      let batch: ReadonlyMap<string, NativeObject | AccessError | null> = new Map(),
        batchError: AccessError | null = null;
      if (this.forecasts) {
        try {
          batch = await this.forecasts.validatedReleases(
            rows.map((r) => r.offering_id as string),
            session.user.subjectId,
          );
        } catch (e) {
          batchError = e instanceof AccessError
            ? e
            : new AccessError("forecast_release_invalid", 503);
        }
      }
      const context = workflow
        ? await nativeJsonSha256({
          base: await workflow.analysisContext(profile.profile_id),
          catalog_version: release.version,
          forecasts: [...batch.entries()].map((
            [id, value],
          ) => [id, value instanceof AccessError ? { error: value.code } : value]),
          forecast_error: batchError?.code ?? null,
        })
        : null;
      if (!object(updated.operation_contexts)) updated.operation_contexts = {};
      const contexts = updated.operation_contexts as NativeObject;
      const cached = context !== null && batchError === null &&
        (op === "candidates.build"
          ? contexts.candidates === context && object(updated.candidates)
          : object(updated.analyses) &&
            rows.every((r) =>
              contexts["analysis:" + r.offering_id] === context &&
              object((updated.analyses as NativeObject)[r.offering_id as string])
            ));
      if (cached) {
        const result = await this.repository.writeReport({
          owner: session.user.subjectId,
          reportId: record.report_id,
          profileId: record.profile_id,
          body: record.body,
          expected,
          nowUtc: this.fresh(session),
          operation: op as "university.analyze" | "candidates.build",
          key,
          digest,
          noOp: true,
        });
        this.fresh(session);
        return reportDto(session, result);
      }
      const results: NativeObject = {};
      await this.scoring.batch(async () => {
        for (const offering of rows) {
          this.fresh(session);
          const conversion = await this.scoring.calculate(offering, profile),
            percentile = await this.percentile.calculate(offering, conversion);
          let assessment: NativeObject;
          try {
            const bundle = await this.data.getAnalysis(offering.offering_id as string);
            assessment = evaluateOffering(
              offering,
              profile,
              updated.overall as NativeObject,
              bundle,
              conversion,
              percentile,
            );
          } catch (e) {
            assessment = evaluateOffering(
              offering,
              profile,
              updated.overall as NativeObject,
              null,
              conversion,
              percentile,
            );
            assessment.reason_code = e instanceof AccessError ? e.code : "analysis_release_invalid";
          }
          if (this.forecasts) {
            try {
              if (batchError) throw batchError;
              if (!batch.has(offering.offering_id as string)) fail("forecast_release_invalid");
              const published = batch.get(offering.offering_id as string)!;
              if (published instanceof AccessError) throw published;
              if (published !== null) {
                const evidence = assessment.decision_evidence,
                  historical = object(evidence) && Array.isArray(evidence.historical_metrics)
                    ? evidence.historical_metrics
                    : [];
                const newer = await this.forecasts.evaluateRelease(
                  offering,
                  profile,
                  conversion,
                  percentile,
                  published,
                  historical,
                );
                newer.years = assessment.years;
                newer.advantage = percentile.state.population_scope === "whole_complete"
                  ? assessment.advantage ?? null
                  : null;
                if (newer.advantage !== null) {
                  const old = Array.isArray(assessment.recommendation_reasons)
                    ? assessment.recommendation_reasons
                    : [];
                  if (!Array.isArray(newer.recommendation_reasons)) fail();
                  newer.recommendation_reasons.push(
                    ...old.filter((r) =>
                      object(r) &&
                      [
                        "converted_score_position_gain",
                        "converted_score_position_loss",
                        "converted_score_position_equal",
                      ].includes(r.code as string)
                    ),
                  );
                }
                assessment = newer;
              }
            } catch (e) {
              Object.assign(assessment, {
                status: "pending",
                category: "pending",
                reason_code: e instanceof AccessError ? e.code : "forecast_release_invalid",
              });
            }
          }
          const oid = offering.offering_id as string;
          results[oid] = assessment;
          if (context !== null) contexts["analysis:" + oid] = context;
          if (op === "university.analyze" && personalAssessment(assessment)) {
            originKeys.push("analysis:" + oid);
          }
        }
      });
      if (!object(updated.analyses) || !object(updated.shortlist)) fail();
      Object.assign(updated.analyses, results);
      updated.catalog_version = release.version;
      const ready = Object.values(results).some((r) => object(r) && r.status === "ready");
      updated.analysis_status = {
        status: ready ? "ready" : "pending",
        reason_code: ready ? null : "offering_analysis_pending",
      };
      if (op === "candidates.build") {
        updated.candidates = candidateGroups(rows, results, release.version);
        if (context !== null) contexts.candidates = context;
        if (personalResultComponents({ candidates: updated.candidates }).includes("candidates")) {
          originKeys.push("candidates");
        }
      }
      for (const [oid, value] of Object.entries(updated.shortlist)) {
        if (!object(value)) fail();
        const assessment = updated.analyses[oid];
        value.assessment_status = object(assessment) ? assessment.status : "pending";
      }
    }
    const written = await this.repository.writeReport({
      owner: session.user.subjectId,
      reportId: record.report_id,
      profileId: record.profile_id,
      body: updated,
      expected,
      nowUtc: this.fresh(session),
      operation: op as "university.analyze" | "candidates.build",
      ...(workflow && originKeys.length
        ? {
          paidOrigin: workflow.origin(
            session,
            op as "university.analyze" | "candidates.build",
            originKeys,
          ),
        }
        : {}),
      key,
      digest,
    });
    if (
      written.owner_id !== session.user.subjectId || written.report_id !== record.report_id ||
      written.profile_id !== record.profile_id
    ) fail();
    this.fresh(session);
    return reportDto(session, written);
  }
}
