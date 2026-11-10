import { mergeReferenceGroups, referenceGroupsContain } from "./reference_group_merge.ts";
import { referenceAttendance } from "./reference_attendance.ts";
/** Paid owned-report university and full-catalog candidate workflows. No in-place profile edits. */
import { AccessError, authorizeReport } from "./access.ts";
import { referenceCandidateGroups } from "./reference_candidates.ts";
import {
  acquireReferenceCandidateScope,
  type ReferenceCandidateScope,
  type ReferenceCandidateScopePort,
} from "./reference_candidate_scope.ts";
import { ReferencePercentileService, type ReferenceTailPort } from "./reference_percentile.ts";
import type { ApiBusinessPort, ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { buildWildcardCandidateReview } from "./wildcard_candidate_review.ts";
import {
  materializeWildcardReview,
  requestWildcardGrant,
  type WildcardRuntimeGate,
} from "./wildcard_runtime_gate.ts";
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
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { personalAssessment, personalResultComponents } from "./paid_result_components.ts";
import {
  captureUnchangedLegacyAssessments,
  captureUnchangedLegacyCandidates,
} from "./legacy_reference_transition.ts";
export const UNIVERSITY_ANALYSIS_OPERATIONS = ["university.analyze", "candidates.build"] as const;
export interface UniversityAnalysisDataPort
  extends
    UniversityScoringDataPort,
    UniversityPercentileDataPort,
    OfferingAnalysisDataPort,
    ReferenceTailPort {
  /**
   * Optional: whether a production conversion release is selected for the offering. Candidate
   * generation only ranks production results; reference-only offerings always stay pending and
   * would otherwise turn a candidates request into a full-catalog reference calculation.
   */
  hasProductionConversion?(offeringId: string): Promise<boolean>;
}
/** Candidate universe: rows that can produce a production (non-pending) conversion result. */
export async function productionCandidateRows(
  data: Pick<UniversityAnalysisDataPort, "hasProductionConversion">,
  rows: readonly NativeObject[],
): Promise<readonly NativeObject[]> {
  if (!data.hasProductionConversion) return rows;
  const kept: NativeObject[] = [];
  for (const row of rows) {
    if (await data.hasProductionConversion(String(row.offering_id))) kept.push(row);
  }
  return kept;
}
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
    private readonly wildcardGate: WildcardRuntimeGate | null = null,
    private readonly referenceCandidateScope:
      | ReferenceCandidateScopePort
      | (() => Promise<ReferenceCandidateScopePort | null>)
      | null = null,
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
  async execute(request: ApiExecution, boundary?: ApiExecutionBoundary): Promise<NativeObject> {
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
        op === "university.analyze"
          ? ["offering_ids", "attendance_confirmation"]
          : ["attendance_confirmation"],
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
    const attendance = referenceAttendance(input.attendance_confirmation, profile);
    const attendancePreserved = new Set<string>();
    const oldRequirements = record.body.reference_attendance_requirements;
    const attendanceRequired: NativeObject =
      object(oldRequirements) && oldRequirements.profile_id === profile.profile_id &&
        oldRequirements.exam_id === profile.scores.exam_id &&
        oldRequirements.pack_version === profile.scores.pack_version &&
        object(oldRequirements.offerings)
        ? cloneNativeJson(oldRequirements.offerings)
        : {};
    const originKeys: string[] = [];
    let referenceGrant: ReferenceCandidateScope | null = null;
    let activeReferenceScope: ReferenceCandidateScopePort | null = null;
    if (!release) {
      updated.analysis_status = { status: "pending", reason_code: "catalog_release_missing" };
    } else {
      let rows: readonly NativeObject[];
      let productionRows: readonly NativeObject[] = [];
      let referenceRows: readonly NativeObject[] = [];
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
        const catalogRows = this.catalog.serviceRows(release).filter((r) =>
          r.academic_year === (overall.exam as NativeObject).academic_year
        );
        productionRows = await productionCandidateRows(this.data, catalogRows);
        rows = productionRows;
        const scopePort = typeof this.referenceCandidateScope === "function"
          ? await this.referenceCandidateScope()
          : this.referenceCandidateScope;
        activeReferenceScope = scopePort;
        if (scopePort) {
          if (
            (!this.data.getReferenceTail && !this.data.getChunkedReferenceTail &&
              !this.data.getNativeReferenceTail) ||
            typeof overall.exam.academic_year !== "number" ||
            typeof overall.exam.exam_id !== "string" || typeof overall.score_basis !== "string"
          ) {
            fail("security_policy_unavailable", 503);
          }
          // The reference bundle is best effort: an unavailable scope never fails 4-page.
          referenceGrant = await acquireReferenceCandidateScope(
            {
              subjectId: session.user.subjectId,
              reportId: record.report_id,
              reportRevision: record.revision,
              profileId: profile.profile_id,
              academicYear: overall.exam.academic_year,
              examId: overall.exam.exam_id,
              scoreBasis: overall.score_basis,
              catalogVersion: release.version,
            },
            scopePort,
            boundary,
          ).catch(() => null);
          const byId = new Map(catalogRows.map((r) => [r.offering_id as string, r]));
          if (
            !referenceGrant || byId.size !== catalogRows.length ||
            referenceGrant.offeringIds.some((id) => !byId.has(id))
          ) {
            referenceGrant = null;
          } else {
            referenceRows = referenceGrant.offeringIds.map((id) => byId.get(id)!);
            const included = new Set(productionRows.map((r) => r.offering_id as string));
            // Official candidates first; reference-only rows after them.
            rows = [
              ...productionRows,
              ...referenceRows.filter((r) => !included.has(r.offering_id as string)),
            ];
          }
        }
      }
      let batch: ReadonlyMap<string, NativeObject | AccessError | null> = new Map(),
        batchError: AccessError | null = null;
      if (this.forecasts) {
        try {
          batch = await this.forecasts.validatedReleases(
            (op === "candidates.build" ? productionRows : rows).map((r) => r.offering_id as string),
            session.user.subjectId,
          );
        } catch (e) {
          batchError = e instanceof AccessError
            ? e
            : new AccessError("forecast_release_invalid", 503);
        }
      }
      // The approved saved-tail selection is part of the reusable analysis context.
      const referenceTailPins = this.data.referenceTailPins
        ? await this.data.referenceTailPins()
        : null;
      const context = workflow
        ? await nativeJsonSha256({
          base: await workflow.analysisContext(profile.profile_id),
          catalog_version: release.version,
          forecasts: [...batch.entries()].map((
            [id, value],
          ) => [id, value instanceof AccessError ? { error: value.code } : value]),
          forecast_error: batchError?.code ?? null,
          ...(referenceTailPins ? { reference_tails: referenceTailPins } : {}),
        })
        : null;
      let wildcardGrant = null;
      if (op === "candidates.build" && this.wildcardGate) {
        const overall = updated.overall;
        if (
          !object(overall) || !object(overall.exam) ||
          typeof overall.exam.academic_year !== "number" ||
          typeof overall.exam.exam_id !== "string" ||
          typeof overall.score_basis !== "string"
        ) fail("security_policy_unavailable", 503);
        wildcardGrant = await requestWildcardGrant(
          {
            audience: "personal",
            operation: "candidates.build",
            subjectId: session.user.subjectId,
            organizationId: null,
            studentId: null,
            reportId: record.report_id,
            sourceReportRevision: record.revision,
            profileId: profile.profile_id,
            academicYear: overall.exam.academic_year,
            examId: overall.exam.exam_id,
            scoreBasis: overall.score_basis,
            catalogVersion: release.version,
            analysisContextSha256: context,
          },
          this.wildcardGate,
          boundary,
        );
        this.fresh(session);
      }
      const candidateContext = context !== null && wildcardGrant
        ? await nativeJsonSha256({
          base: context,
          wildcard: wildcardGrant.cachePins,
          request_scope: wildcardGrant.context.operationContextSha256,
          overall: await nativeJsonSha256(updated.overall),
          // Preserve the exact allowed universe, independent of input ordering.
          rows: await nativeJsonSha256([...rows].sort((a, b) => {
            const x = String(a.offering_id), y = String(b.offering_id);
            return x < y ? -1 : x > y ? 1 : 0;
          })),
        })
        : context;
      if (!object(updated.operation_contexts)) updated.operation_contexts = {};
      const contexts = updated.operation_contexts as NativeObject;
      // Saved-tail selection is pinned in the context above. A reference candidate scope is
      // request-bound, so its 4-page result is always rebuilt.
      // A fresh self-attestation belongs to this request and must not reuse an older pending snapshot.
      const cached = !Object.hasOwn(input, "attendance_confirmation") &&
        !this.data.getReferenceTail && !this.data.getChunkedReferenceTail &&
        !this.data.getNativeReferenceTail && !referenceGrant && context !== null &&
        batchError === null &&
        (op === "candidates.build"
          ? contexts.candidates === candidateContext && object(updated.candidates)
          : object(updated.analyses) &&
            rows.every((r) =>
              contexts["analysis:" + r.offering_id] === context &&
              object((updated.analyses as NativeObject)[r.offering_id as string])
            ));
      if (cached) {
        if (wildcardGrant) {
          await wildcardGrant.assertCurrent();
          this.fresh(session);
        }
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
        if (wildcardGrant) await wildcardGrant.assertCurrent();
        this.fresh(session);
        return reportDto(session, result);
      }
      const results: NativeObject = {};
      const freshReferenceEvidence: NativeObject = {};
      let referenceStopped = false;
      let referencePrefetched = false;
      const referencePercentile = new ReferencePercentileService(this.data);
      const runScoring = (phaseRows: readonly NativeObject[], referencePhase: boolean) =>
        this.scoring.batch(async () => {
          // Load the selected saved tails (and their reference rules) concurrently once;
          // the per-offering loop below then reuses the same request-local projections.
          if (op !== "candidates.build" && this.data.prefetchReferenceTails) {
            await this.data.prefetchReferenceTails(
              phaseRows.map((r) => r.offering_id as string),
              boundary?.signal,
            );
          }
          for (const offering of phaseRows) {
            this.fresh(session);
            if (
              op === "candidates.build" && referenceGrant && !productionRows.includes(offering) &&
              !referencePrefetched
            ) {
              referencePrefetched = true;
              if (!referenceGrant.signal.aborted && this.data.prefetchReferenceTails) {
                await this.data.prefetchReferenceTails(
                  referenceRows.filter((r) => !productionRows.includes(r)).map((r) =>
                    r.offering_id as string
                  ),
                  referenceGrant.signal,
                );
              }
            }
            // Out of reference time or revoked: stop starting reference-only rows and keep
            // the official result. Official rows are always processed first.
            if (
              referenceGrant?.signal.aborted && op === "candidates.build" &&
              !productionRows.includes(offering)
            ) {
              referenceStopped = true;
              break;
            }
            const conversion = await this.scoring.calculate(offering, profile, attendance),
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
              assessment.reason_code = e instanceof AccessError
                ? e.code
                : "analysis_release_invalid";
            }
            if (
              this.forecasts && (op !== "candidates.build" || productionRows.includes(offering))
            ) {
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
            if (
              (this.data.getReferenceTail || this.data.getChunkedReferenceTail ||
                this.data.getNativeReferenceTail) &&
              conversion.state.context.reference_status === "reference_calculated"
            ) {
              assessment.reference_percentile = await referencePercentile.calculate(
                offering,
                conversion,
                profile,
                referenceGrant?.signal ?? boundary?.signal,
                attendance,
              );
            }
            const oid = offering.offering_id as string;
            const privateEvidence = referencePercentile.evidenceFor(oid);
            if (privateEvidence) freshReferenceEvidence[oid] = privateEvidence;
            delete attendanceRequired[oid];
            if (conversion.state.reason_code === "reference_attendance_confirmation_required") {
              if (!Array.isArray(conversion.state.context.required_attendance)) {
                fail("security_policy_unavailable", 503);
              }
              attendanceRequired[oid] = cloneNativeJson(
                conversion.state.context.required_attendance,
              );
              const old = object(record.body.analyses) ? record.body.analyses[oid] : null;
              if (object(old)) {
                results[oid] = cloneNativeJson(old);
                attendancePreserved.add(oid);
              } else {
                assessment.reference_percentile = {
                  status: "pending",
                  reason_code: "reference_attendance_confirmation_required",
                  estimated_upper_cumulative_percent_all_examinees: null,
                  calculation_review_scope: "same_exam_mathematical_reference",
                  production_allowed: false,
                  actual_admission_full_total_approved: false,
                };
                results[oid] = assessment;
              }
            } else results[oid] = assessment;
            if (context !== null && !attendancePreserved.has(oid)) {
              contexts["analysis:" + oid] = context;
            }
            if (op === "university.analyze" && personalAssessment(assessment)) {
              originKeys.push("analysis:" + oid);
            }
          }
        }, referencePhase ? referenceGrant?.signal : undefined);
      if (op === "candidates.build") {
        await runScoring(productionRows, false);
        const referenceOnlyRows = referenceRows.filter((r) => !productionRows.includes(r));
        if (referenceGrant && referenceOnlyRows.length && !referenceGrant.signal.aborted) {
          try {
            await referenceGrant.run(runScoring(referenceOnlyRows, true));
          } catch (error) {
            if (boundary?.signal.aborted) throw error;
            referenceStopped = true;
          }
        }
      } else await runScoring(rows, false);
      let discardReferenceResults = false;
      if (referenceGrant) {
        // Deliver the reference bundle only when complete, in time and still approved.
        let usable = !referenceStopped && !referenceGrant.signal.aborted;
        if (usable) {
          try {
            await referenceGrant.assertCurrent();
          } catch {
            usable = false;
          }
        }
        if (!usable || referenceGrant.signal.aborted) {
          discardReferenceResults = true;
          referenceGrant = null;
        }
      }
      if (discardReferenceResults) {
        const previousAnalyses = object(record.body.analyses) ? record.body.analyses : {};
        const previousContexts = object(record.body.operation_contexts)
          ? record.body.operation_contexts
          : {};
        for (const row of referenceRows) {
          const id = row.offering_id as string;
          delete freshReferenceEvidence[id];
          if (!productionRows.includes(row)) {
            delete results[id];
            const key = "analysis:" + id;
            if (Object.hasOwn(previousContexts, key)) contexts[key] = previousContexts[key];
            else delete contexts[key];
          } else if (object(results[id])) {
            const result = results[id] as NativeObject, previous = previousAnalyses[id];
            if (object(previous) && Object.hasOwn(previous, "reference_percentile")) {
              result.reference_percentile = cloneNativeJson(previous.reference_percentile);
            } else delete result.reference_percentile;
          }
        }
        rows = productionRows;
      }
      // A missing optional scope must not erase a previously saved reference for the
      // identical conversion. The saved reference still needs independent read-side proof.
      const retainedPriorReference = new Set<string>();
      if (
        op === "candidates.build" && !referenceGrant &&
        object(record.body.analyses)
      ) {
        for (const [id, current] of Object.entries(results)) {
          const previous = record.body.analyses[id];
          if (
            !object(previous) || !object(current) ||
            previous.offering_id !== id ||
            current.offering_id !== id || !object(previous.conversion) ||
            !object(current.conversion) ||
            !object(previous.reference_percentile) ||
            previous.reference_percentile.status !== "reference_estimated" ||
            object(current.reference_percentile) &&
              current.reference_percentile.status === "reference_estimated"
          ) continue;
          if (
            nativeJsonText(previous.conversion, true) !==
              nativeJsonText(current.conversion, true)
          ) continue;
          current.reference_percentile = cloneNativeJson(
            previous.reference_percentile,
          );
          retainedPriorReference.add(id);
          delete freshReferenceEvidence[id];
          delete contexts["analysis:" + id];
        }
      }
      if (!object(updated.analyses) || !object(updated.shortlist)) fail();
      Object.assign(updated.analyses, results);
      // Private, immutable-revision writer material. A matching hash is not an issuance
      // authority; delivery separately verifies every source and compatibility pin.
      let proof = updated._reference_evidence;
      if (
        Object.hasOwn(updated, "_reference_evidence") && (!object(proof) ||
          proof.format !== "jungsi.reference-result-provenance/v1" ||
          proof.owner_id !== session.user.subjectId ||
          proof.report_id !== record.report_id || proof.profile_id !== record.profile_id ||
          !object(proof.assessments))
      ) {
        fail("security_policy_unavailable", 503);
      }
      if (
        !object(proof) || proof.format !== "jungsi.reference-result-provenance/v1" ||
        proof.owner_id !== session.user.subjectId || proof.report_id !== record.report_id ||
        proof.profile_id !== record.profile_id || !object(proof.assessments)
      ) {
        proof = {
          format: "jungsi.reference-result-provenance/v1",
          owner_id: session.user.subjectId,
          report_id: record.report_id,
          profile_id: record.profile_id,
          assessments: {},
        };
      }
      const proofAssessments = proof.assessments as NativeObject;
      if (
        !Object.hasOwn(record.body, "_reference_evidence") &&
        Object.keys(freshReferenceEvidence).length
      ) {
        proof.legacy_assessments = await captureUnchangedLegacyAssessments(record, updated);
        const previousCandidates = await captureUnchangedLegacyCandidates(record, updated);
        if (previousCandidates) proof.legacy_candidates = previousCandidates;
      }
      const legacyAssessments = object(proof.legacy_assessments) ? proof.legacy_assessments : {};
      if (!Number.isSafeInteger(expected + 1)) fail("security_policy_unavailable", 503);
      for (const oid of Object.keys(results)) {
        const previous = object(record.body.analyses) ? record.body.analyses[oid] : null;
        const current = results[oid];
        const preserveOld = discardReferenceResults && referenceRows.some((row) =>
          row.offering_id === oid
        ) &&
          object(previous) && object(current) && Object.hasOwn(previous, "reference_percentile") &&
          nativeJsonText(previous.reference_percentile, true) ===
            nativeJsonText(current.reference_percentile, true);
        if (
          preserveOld || attendancePreserved.has(oid) || retainedPriorReference.has(oid)
        ) continue;
        delete legacyAssessments[oid];
        delete proofAssessments[oid];
        const item = freshReferenceEvidence[oid];
        if (object(item)) proofAssessments[oid] = { ...item, issued_revision: expected + 1 };
      }
      if (op === "candidates.build") delete proof.candidates;
      if (
        Object.keys(proofAssessments).length || proof.candidates !== undefined ||
        Object.hasOwn(record.body, "_reference_evidence")
      ) updated._reference_evidence = proof;
      else delete updated._reference_evidence;
      updated.catalog_version = release.version;
      const ready = Object.values(results).some((r) => object(r) && r.status === "ready");
      updated.analysis_status = {
        status: ready ? "ready" : "pending",
        reason_code: ready ? null : "offering_analysis_pending",
      };
      if (op === "candidates.build") {
        if (wildcardGrant) {
          const review = await buildWildcardCandidateReview(
            productionRows,
            results,
            release.version,
            wildcardGrant.context,
            wildcardGrant.evidence,
            wildcardGrant.signal,
          );
          await wildcardGrant.assertCurrent();
          this.fresh(session);
          updated.candidates = materializeWildcardReview(review);
          const complete = review.preview.wildcard_selection.status === "ready" &&
            review.preview.wildcard_selection.card_stability.every((item) =>
              item.status === "verified"
            );
          if (candidateContext !== null && complete) contexts.candidates = candidateContext;
          else delete contexts.candidates;
        } else {
          updated.candidates = candidateGroups(rows, results, release.version);
          if (context !== null) contexts.candidates = context;
        }
        if (referenceGrant && object(updated.candidates)) {
          updated.candidates.reference_university_groups =
            referenceCandidateGroups(referenceRows, results).university_groups;
        }
        // If no new reference scope was issued, carry the exact old group only when
        // every saved reference and conversion still matches. Read-side authority continues
        // to verify the original receipt and the current selected source before disclosure.
        if (
          !referenceGrant && object(record.body.candidates) &&
          object(updated.candidates) &&
          Array.isArray(record.body.candidates.reference_university_groups) &&
          object(record.body.analyses)
        ) {
          const oldGroups = record.body.candidates.reference_university_groups;
          let unchanged = referenceGroupsContain(oldGroups, oldGroups);
          for (const group of oldGroups) {
            if (!object(group) || !Array.isArray(group.offerings)) {
              unchanged = false;
              break;
            }
            for (const row of group.offerings) {
              if (
                !object(row) || !object(row.offering) ||
                typeof row.offering.offering_id !== "string"
              ) {
                unchanged = false;
                break;
              }
              const id = row.offering.offering_id;
              const previous = record.body.analyses[id],
                current = updated.analyses[id];
              if (
                !object(previous) || !object(current) ||
                !object(previous.conversion) ||
                !object(current.conversion) ||
                !object(previous.reference_percentile) ||
                !object(current.reference_percentile) ||
                !object(row.reference_percentile) ||
                nativeJsonText(previous.conversion, true) !==
                  nativeJsonText(current.conversion, true) ||
                nativeJsonText(previous.reference_percentile, true) !==
                  nativeJsonText(current.reference_percentile, true) ||
                nativeJsonText(row.reference_percentile, true) !==
                  nativeJsonText(previous.reference_percentile, true)
              ) {
                unchanged = false;
                break;
              }
            }
            if (!unchanged) break;
          }
          if (unchanged) {
            updated.candidates.reference_university_groups = cloneNativeJson(
              oldGroups,
            );
            const oldProof = record.body._reference_evidence;
            if (
              object(oldProof) && oldProof.candidates !== undefined &&
              object(updated._reference_evidence)
            ) {
              updated._reference_evidence.candidates = cloneNativeJson(
                oldProof.candidates,
              );
            }
          }
        }
        // Retain the existing reference bundle when a newly requested reference row is
        // awaiting attendance; independently recomputed ordinary candidate groups remain current.
        if (
          attendancePreserved.size && object(record.body.candidates) &&
          object(updated.candidates) &&
          Array.isArray(record.body.candidates.reference_university_groups)
        ) {
          const oldGroups = record.body.candidates.reference_university_groups;
          const newGroups = Array.isArray(updated.candidates.reference_university_groups)
            ? updated.candidates.reference_university_groups
            : [];
          const merged = mergeReferenceGroups(oldGroups, newGroups);
          if (!merged) fail("security_policy_unavailable", 503);
          updated.candidates.reference_university_groups = merged;
          const oldProof = record.body._reference_evidence;
          if (
            object(oldProof) && oldProof.candidates !== undefined &&
            object(updated._reference_evidence) &&
            nativeJsonText(oldGroups, true) === nativeJsonText(merged, true)
          ) {
            updated._reference_evidence.candidates = cloneNativeJson(oldProof.candidates);
          }
        }
        if (
          referenceGrant && object(updated.candidates) &&
          Array.isArray(updated.candidates.reference_university_groups)
        ) {
          const groups = updated.candidates.reference_university_groups,
            scopeForProof = activeReferenceScope,
            ids: string[] = [];
          for (const group of groups) {
            if (!object(group) || !Array.isArray(group.offerings)) {
              fail("security_policy_unavailable", 503);
            }
            for (const entry of group.offerings) {
              if (
                !object(entry) || !object(entry.offering) ||
                typeof entry.offering.offering_id !== "string"
              ) fail("security_policy_unavailable", 503);
              ids.push(entry.offering.offering_id);
            }
          }
          if (
            ids.length && new Set(ids).size === ids.length && scopeForProof && ids.every((id) => {
              const entry = proofAssessments[id];
              return object(entry) && object(entry.provenance) &&
                entry.provenance.selection_sha256 === scopeForProof.selectionSha256;
            })
          ) {
            const proof: NativeObject = object(updated._reference_evidence)
              ? updated._reference_evidence
              : {
                format: "jungsi.reference-result-provenance/v1",
                owner_id: session.user.subjectId,
                report_id: record.report_id,
                profile_id: record.profile_id,
                assessments: proofAssessments,
              };
            delete proof.legacy_candidates;
            proof.candidates = {
              issued_revision: expected + 1,
              value_sha256: await nativeJsonSha256(groups),
              selection_sha256: scopeForProof.selectionSha256,
              offering_ids: ids,
            };
            updated._reference_evidence = proof;
          }
        }
        if (
          object(updated._reference_evidence) &&
          updated._reference_evidence.legacy_candidates !== undefined &&
          (!object(record.body.candidates) || !object(updated.candidates) ||
            !Array.isArray(record.body.candidates.reference_university_groups) ||
            !Array.isArray(updated.candidates.reference_university_groups) ||
            !referenceGroupsContain(
              record.body.candidates.reference_university_groups,
              updated.candidates.reference_university_groups,
            ))
        ) {
          delete updated._reference_evidence.legacy_candidates;
        }
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
    if (boundary?.signal.aborted) fail("security_policy_unavailable", 503);
    // Status only: answers are request-local and never added to the stored profile.
    if (Object.keys(attendanceRequired).length) {
      updated.reference_attendance_requirements = {
        status: "confirmation_required",
        profile_id: profile.profile_id,
        exam_id: profile.scores.exam_id,
        pack_version: profile.scores.pack_version,
        offerings: attendanceRequired,
        confirmation_kind: "self_reported",
      };
    } else if (Object.hasOwn(updated, "reference_attendance_requirements")) {
      delete updated.reference_attendance_requirements;
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
    if (boundary?.signal.aborted) fail("security_policy_unavailable", 503);
    if (
      written.owner_id !== session.user.subjectId || written.report_id !== record.report_id ||
      written.profile_id !== record.profile_id
    ) fail();
    this.fresh(session);
    return reportDto(session, written);
  }
}
