/** Paid score entry/correction, fixed sample and immutable original-pass delivery. */
import { AccessError } from "./access.ts";
import type { ApiBusinessPort, ApiExecution } from "./api_dispatch.ts";
import { ApprovedOperatingPolicy } from "./operating_policy.ts";
import { type OverallDataPort, validateScoreStructure } from "./overall_analysis.ts";
import type { StoredProfile, StoredReport } from "./platform_repository.ts";
import type { RequestClockPort } from "./ports.ts";
import type {
  PaidResultOriginWrite,
  SavedSnapshotScope,
  ScoreInputRepositoryPort,
  ScoreInputWorkflowPort,
} from "./score_input_ports.ts";
import {
  isVerifiedAdminSnapshot,
  requirePaidSession,
  sessionDto,
  type SessionSnapshot,
} from "./session_service.ts";
import { personalResultComponents, resultObject } from "./paid_result_components.ts";
import { scoreInputBalance } from "../domain/score_input_rights.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { utcText } from "../domain/time.ts";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SCORE_CONTENT_REJECTION_CODES = [
  "unobserved_standard_score",
  "invalid_score",
  "invalid_integer",
  "invalid_grade",
  "invalid_reported_grade",
  "invalid_reported_percentile",
  "reported_grade_conflict",
  "reported_percentile_conflict",
] as const;
function id(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) throw new AccessError("invalid_identifier", 422);
  return v;
}
function shape(
  v: unknown,
  required: readonly string[] = [],
  optional: readonly string[] = [],
): NativeObject {
  if (
    !resultObject(v) || required.some((k) => !Object.hasOwn(v, k)) ||
    Object.keys(v).some((k) => ![...required, ...optional].includes(k))
  ) throw new AccessError("invalid_request", 422);
  return v;
}
const SAMPLE: NativeObject = {
  format: "jungsi.sample-report/v1",
  synthetic: true,
  sample_id: "SYNTHETIC-virtual386-v1",
  label: "가상 학생 고정 견본",
  report: {
    format: "jungsi.sample-analysis/v1",
    source_kind: "synthetic",
    total_standard_score: 386,
    subjects: [{ area: "korean", standard_score: 120 }, { area: "math", standard_score: 130 }, {
      area: "inquiry1",
      standard_score: 68,
    }, { area: "inquiry2", standard_score: 68 }],
    overall: { status: "pending", reason_code: "sample_no_population", top_percent: null },
    input_editable: false,
    persisted: false,
  },
};
export class ScoreInputService implements ApiBusinessPort, ScoreInputWorkflowPort {
  constructor(
    private readonly repository: ScoreInputRepositoryPort,
    private readonly policy: ApprovedOperatingPolicy,
    private readonly data: OverallDataPort,
    private readonly clock: RequestClockPort,
  ) {}
  private fresh(session: SessionSnapshot, paid = false): bigint {
    const now = this.clock.nowUtc();
    sessionDto(session, now);
    this.policy.assertLive(now);
    if (paid) requirePaidSession(session, now);
    return now;
  }
  async saveProfile(
    input: Parameters<ScoreInputWorkflowPort["saveProfile"]>[0],
  ): Promise<{ profile: StoredProfile; analysis: NativeObject | null }> {
    const { session, key, digest, confirmed } = input;
    this.fresh(session, true);
    const scores = validateScoreStructure(input.scores) as NativeObject;
    const prior = await this.repository.replay(
      session.user.subjectId,
      "score-profile.create",
      id(key),
      digest,
    );
    if (prior) {
      this.fresh(session, true);
      if (prior.outcome === "rejected") throw new AccessError(prior.rejectionCode!, 422);
      if (!prior.profile) throw new AccessError("invalid_repository_result", 503);
      return { profile: prior.profile, analysis: null };
    }
    const context = this.policy.context(
      session,
      scores.exam_id,
      input.stage,
      this.fresh(session, true),
    );
    if (scores.pack_version !== context.stage.packVersion) {
      throw new AccessError("pack_version_mismatch", 409);
    }
    // A count is never inferred from missing state; the repository verifies rollout/legacy mappings.
    const before = await this.repository.state(context);
    if (!context.previewExempt && scoreInputBalance(before).effectiveSaveRemaining === 0) {
      throw new AccessError("score_input_exhausted", 409);
    }
    let pack;
    try {
      pack = await this.data.getExamPack(context.stage.examId);
    } catch {
      throw new AccessError("exam_data_unavailable", 503);
    }
    if (!pack) throw new AccessError("exam_not_available", 503);
    if (pack.examId !== context.stage.examId || pack.packVersion !== context.stage.packVersion) {
      throw new AccessError("exam_binding_invalid", 503);
    }
    let analysis: NativeObject;
    try {
      analysis = await input.analyze(scores);
    } catch (e) {
      if (
        e instanceof AccessError && e.http === 422 &&
        SCORE_CONTENT_REJECTION_CODES.includes(
          e.code as typeof SCORE_CONTENT_REJECTION_CODES[number],
        )
      ) {
        const finalContext = this.policy.context(
          session,
          scores.exam_id,
          input.stage,
          this.fresh(session, true),
        );
        const outcome = await this.repository.commitRejection(finalContext, {
          operation: "score-profile.create",
          key,
          digest,
          code: e.code,
          nowUtc: this.fresh(session, true),
        });
        if (outcome.outcome !== "rejected") throw new AccessError("invalid_repository_result", 503);
        throw new AccessError(outcome.rejectionCode!, 422);
      }
      throw e;
    }
    const finalContext = this.policy.context(
      session,
      scores.exam_id,
      input.stage,
      this.fresh(session, true),
    );
    const committed = await this.repository.commitProfile(finalContext, {
      owner: session.user.subjectId,
      scores: cloneNativeJson(scores),
      confirmed,
      nowUtc: this.fresh(session, true),
      key,
      digest,
    });
    if (committed.outcome !== "accepted" || !committed.profile) {
      throw new AccessError("invalid_repository_result", 503);
    }
    return { profile: committed.profile, analysis };
  }
  async assertProfile(session: SessionSnapshot, profile: StoredProfile): Promise<void> {
    this.fresh(session, true);
    if (profile.owner_id !== session.user.subjectId) {
      throw new AccessError("profile_not_found", 404);
    }
    const context = await this.repository.profileContext(
      session.user.subjectId,
      profile.profile_id,
    );
    if (!context) throw new AccessError("score_input_transition_pending", 503);
    const current = this.policy.context(
      session,
      profile.scores.exam_id,
      context.stage.stage,
      this.fresh(session, true),
      false,
    );
    if (current.stage.scopeId !== context.stage.scopeId) {
      throw new AccessError("score_input_transition_pending", 503);
    }
    const state = await this.repository.state(current);
    if (state.currentProfileId !== profile.profile_id) {
      throw new AccessError("score_profile_superseded", 409);
    }
  }
  async reusableOverall(
    session: SessionSnapshot,
    profile: StoredProfile,
  ): Promise<StoredReport | null> {
    await this.assertProfile(session, profile);
    const report = await this.repository.currentReport(session.user.subjectId, profile.profile_id);
    const context = await this.analysisContext(profile.profile_id);
    return report && resultObject(report.body.operation_contexts) &&
        report.body.operation_contexts.overall === context
      ? report
      : null;
  }
  analysisContext(profileId: string): Promise<string> {
    return this.policy.analysisContext(profileId);
  }
  origin(
    session: SessionSnapshot,
    operation: PaidResultOriginWrite["operation"],
    componentKeys: readonly string[],
  ): PaidResultOriginWrite {
    this.fresh(session, true);
    const pass = session.paidPassId ?? null;
    if (session.paidUntilUtc !== null) {
      if (typeof pass !== "string" || !/^\d+$/.test(pass) || BigInt(pass) <= 0n) {
        throw new AccessError("entitlement_identity_unavailable", 503);
      }
      return Object.freeze({
        passId: pass,
        accessBasis: "customer_pass",
        operation,
        componentKeys: Object.freeze([...componentKeys]),
      });
    }
    if (!isVerifiedAdminSnapshot(session)) throw new AccessError("paid_required", 403);
    return Object.freeze({
      passId: null,
      accessBasis: "verified_admin",
      operation,
      componentKeys: Object.freeze([...componentKeys]),
    });
  }
  snapshotScope(owner: string, reportId: string, revision: number): Promise<SavedSnapshotScope> {
    return this.repository.snapshotScope(owner, reportId, revision);
  }
  async deliver(
    session: SessionSnapshot,
    operation: string,
    result: NativeObject,
    requestId: string,
    requestedOfferingIds?: readonly string[],
  ): Promise<void> {
    if (
      !["overall.analyze", "university.analyze", "candidates.build", "report.read", "report.export"]
        .includes(operation)
    ) return;
    const report = operation === "report.export" ? result.report : result;
    if (
      !resultObject(report) || typeof report.report_id !== "string" ||
      typeof report.report_version !== "number" || !Number.isSafeInteger(report.report_version)
    ) return;
    if (
      operation === "university.analyze" &&
      (!Array.isArray(requestedOfferingIds) || !requestedOfferingIds.length ||
        requestedOfferingIds.some((x) => typeof x !== "string" || !ID.test(x)))
    ) throw new AccessError("paid_delivery_scope_unavailable", 503);
    const requested = new Set(requestedOfferingIds ?? []);
    const allComponents = personalResultComponents(report);
    const components = allComponents.filter((key) =>
      operation === "overall.analyze"
        ? key === "overall"
        : operation === "university.analyze"
        ? key.startsWith("analysis:") && requested.has(key.slice(9))
        : operation === "candidates.build"
        ? key === "candidates"
        : true
    );
    if (!components.length) return;
    sessionDto(session, this.clock.nowUtc());
    await this.repository.recordDelivered({
      owner: session.user.subjectId,
      operation: operation as import("./score_input_ports.ts").PaidResultDelivery["operation"],
      accessPassId:
        ["overall.analyze", "university.analyze", "candidates.build"].includes(operation)
          ? this.origin(session, operation as PaidResultOriginWrite["operation"], components).passId
          : null,
      reportId: report.report_id,
      revision: report.report_version,
      componentKeys: components,
      requestId,
      nowUtc: this.clock.nowUtc(),
      tokenExpiresAtUtc: session.user.expiresAtUtc,
    });
  }
  async execute(request: ApiExecution): Promise<NativeObject> {
    const { session, body, query } = request;
    const op = String(request.operation);
    this.fresh(session);
    if (op === "report.sample.read") {
      shape(body);
      shape(query);
      return cloneNativeJson(SAMPLE);
    }
    if (op === "score-input.status.read") {
      shape(body);
      shape(query, ["exam_id"], ["stage"]);
      const context = this.policy.context(
        session,
        query.exam_id,
        query.stage,
        this.fresh(session),
        false,
      );
      const state = await this.repository.state(context), balance = scoreInputBalance(state);
      const report = state.currentProfileId
        ? await this.repository.currentReport(session.user.subjectId, state.currentProfileId)
        : null;
      const now = this.fresh(session), stage = context.stage;
      const window = stage.opensAtUtc !== null && now < stage.opensAtUtc
        ? "not_open"
        : stage.closesAtUtc !== null && now >= stage.closesAtUtc
        ? "closed"
        : "open";
      return {
        format: "jungsi.score-input-status/v1",
        exam_id: stage.examId,
        pack_version: stage.packVersion,
        academic_year: stage.academicYear,
        stage: stage.stage,
        stage_state: window,
        opens_at: stage.opensAtUtc === null ? null : utcText(stage.opensAtUtc),
        closes_at: stage.closesAtUtc === null ? null : utcText(stage.closesAtUtc),
        paid_input_allowed: session.tier === "paid",
        input_limit_mode: context.previewExempt ? "preview_exempt" : "stage_rights",
        initial_used: balance.initialUsed,
        initial_remaining: balance.initialRemaining,
        correction_granted: balance.correctionGranted,
        correction_used: balance.correctionUsed,
        correction_request_remaining: balance.correctionRequestRemaining,
        effective_save_remaining: context.previewExempt ? null : balance.effectiveSaveRemaining,
        entry_version: state.version,
        current_profile_id: state.currentProfileId,
        current_report_id: report?.report_id ?? null,
        last_attempt_outcome: state.lastOutcome,
        last_rejection_code: state.lastRejectionCode,
        legacy_transition_status: "ready",
        current_pass_first_paid_result_at: session.paidPassId
          ? await this.repository.firstPaidResult(session.user.subjectId, session.paidPassId)
          : null,
      };
    }
    if (op === "score-input.correction.grant") {
      if (!isVerifiedAdminSnapshot(session)) throw new AccessError("management_mfa_required", 403);
      shape(query);
      const input = shape(body, [
        "subject_id",
        "exam_id",
        "stage",
        "ticket_ref",
        "expected_version",
        "reason_code",
      ]);
      if (
        typeof input.subject_id !== "string" || !UUID.test(input.subject_id) ||
        typeof input.expected_version !== "number" ||
        !Number.isSafeInteger(input.expected_version) || input.expected_version < 1 ||
        input.reason_code !== "score_correction"
      ) throw new AccessError("invalid_request", 422);
      const stage = this.policy.stage(input.exam_id, input.stage, this.fresh(session), true);
      const digest = await nativeJsonSha256([body, request.params]);
      const receipt = await this.repository.grantCorrection({
        actor: session.user.subjectId,
        owner: input.subject_id.toLowerCase(),
        stage,
        ticketRef: id(input.ticket_ref),
        expectedVersion: input.expected_version,
        reasonCode: "score_correction",
        key: id(request.requestKey),
        digest,
        nowUtc: this.fresh(session),
      });
      const balance = scoreInputBalance(receipt.state);
      return {
        format: "jungsi.score-input-correction/v1",
        command_id: receipt.commandId,
        ticket_ref: receipt.ticketRef,
        exam_id: stage.examId,
        stage: stage.stage,
        entry_version: receipt.state.version,
        granted: true,
        correction_request_remaining: balance.correctionRequestRemaining,
        effective_save_remaining: balance.effectiveSaveRemaining,
        previous_entry_id: receipt.state.lastAttemptId,
      };
    }
    throw new AccessError("route_not_found", 404);
  }
}
