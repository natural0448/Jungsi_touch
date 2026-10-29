/** Approved private stage/preview policy. No client header, default infinity or actual limits. */
import { AccessError } from "./access.ts";
import { isVerifiedAdminSnapshot, sessionDto, type SessionSnapshot } from "./session_service.ts";
import type { ApprovedScoreStage, ScoreInputContext } from "./score_input_ports.ts";
import { SCORE_INPUT_STAGES, type ScoreInputStage } from "../domain/score_input_rights.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { utcInstant } from "../domain/time.ts";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(): never {
  throw new AccessError("score_input_policy_unavailable", 503);
}
function object(v: unknown): NativeObject {
  if (v === null || typeof v !== "object" || Array.isArray(v) || v instanceof JsonFloat) fail();
  return v as NativeObject;
}
function identifier(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) fail();
  return v;
}
function positive(v: unknown): bigint {
  if (typeof v !== "bigint" && !(typeof v === "number" && Number.isSafeInteger(v))) fail();
  const n = BigInt(v as number | bigint);
  if (n < 1n) fail();
  return n;
}
function instant(v: unknown): bigint {
  try {
    if (typeof v !== "string") fail();
    return utcInstant(v);
  } catch {
    return fail();
  }
}
export interface OperatingPolicyBinding {
  readonly policyVersion: string;
  readonly approvalSha256: string;
  readonly expiresAtUtc: bigint;
  readonly exams: ReadonlyMap<
    string,
    { readonly packVersion: string; readonly academicYear: number }
  >;
  readonly registrySha256: string;
  readonly selectionSha256: string;
  readonly renewalContext?: NativeObject;
}
export interface StageBudgetProof {
  readonly owner: string;
  readonly operation: string;
  readonly approvalSha256: string;
  readonly session: SessionSnapshot;
  readonly deadlineUtc: bigint;
  readonly expiresAtUtc: bigint;
}
const budgetProofs = new WeakSet<object>();
export function verifyStageBudgetProof(
  proof: StageBudgetProof | undefined,
  request: { readonly operation: string; readonly session: SessionSnapshot },
  approval: string,
  now: bigint,
): boolean {
  if (!proof) return false;
  if (
    !budgetProofs.has(proof) || proof.owner !== request.session.user.subjectId ||
    proof.session !== request.session || proof.operation !== request.operation ||
    proof.approvalSha256 !== approval || typeof now !== "bigint" || now >= proof.expiresAtUtc ||
    now >= proof.deadlineUtc
  ) fail();
  return true;
}
export class ApprovedOperatingPolicy {
  readonly version: string;
  readonly expiresAtUtc: bigint;
  readonly maxRequestCalculationUnits: bigint;
  readonly maxRequestRuntimeMilliseconds: bigint;
  readonly calculationVersion: string;
  readonly rolloutId: string;
  private readonly stages: ReadonlyMap<string, ApprovedScoreStage>;
  private readonly previewEnabled: boolean;
  private readonly previewExpiresAtUtc: bigint;
  private readonly allowSubjects: ReadonlySet<string>;
  private readonly renewalSemantics: NativeObject | null;
  private renewalSemanticsHash: Promise<string> | undefined;
  constructor(raw: NativeJson | undefined, private readonly binding: OperatingPolicyBinding) {
    if (raw === undefined) fail();
    const r = object(cloneNativeJson(raw));
    if (
      r.format !== "jungsi.score-input-policy/v1" || r.status !== "approved" ||
      r.purpose !== "paid_score_input" || r.approval_reference_sha256 !== binding.approvalSha256 ||
      !HASH.test(binding.approvalSha256) ||
      r.personal_daily_analysis_limit !== "replaced_by_stage_rights" ||
      r.initial_saves !== 1 || r.correction_grants !== 1 || !Array.isArray(r.stages)
    ) fail();
    this.version = identifier(r.version);
    this.rolloutId = identifier(r.rollout_id);
    this.calculationVersion = identifier(r.calculation_version);
    this.expiresAtUtc = instant(r.expires_at);
    if (this.expiresAtUtc > binding.expiresAtUtc) fail();
    const physical = object(r.physical);
    this.maxRequestCalculationUnits = positive(physical.max_request_calculation_units);
    this.maxRequestRuntimeMilliseconds = positive(physical.max_request_runtime_milliseconds);
    const preview = object(r.preview);
    if (typeof preview.enabled !== "boolean" || !Array.isArray(preview.allow_subjects)) fail();
    this.previewEnabled = preview.enabled;
    this.previewExpiresAtUtc = instant(preview.expires_at);
    if (this.previewExpiresAtUtc > this.expiresAtUtc) fail();
    const subjects = new Set<string>();
    for (const value of preview.allow_subjects) {
      if (typeof value !== "string" || !UUID.test(value) || subjects.has(value.toLowerCase())) {
        fail();
      }
      subjects.add(value.toLowerCase());
    }
    this.allowSubjects = subjects;
    const stages = new Map<string, ApprovedScoreStage>();
    const scopes = new Map<string, string>();
    for (const value of r.stages) {
      const s = object(value),
        examId = identifier(s.exam_id),
        scopeId = identifier(s.input_scope_id),
        packVersion = identifier(s.pack_version),
        stage = s.stage as ScoreInputStage,
        exam = binding.exams.get(examId);
      if (
        !SCORE_INPUT_STAGES.includes(stage) || !exam || exam.packVersion !== packVersion ||
        typeof s.academic_year !== "number" || s.academic_year !== exam.academicYear
      ) fail();
      const window = object(s.window);
      let opensAtUtc: bigint | null = null, closesAtUtc: bigint | null = null;
      if (stage === "mock") { if (window.mode !== "policy_lifetime") fail(); }
      else {
        if (
          window.mode !== "official" || window.approved !== true ||
          typeof window.source_ref !== "string" ||
          !/^https:\/\//.test(window.source_ref)
        ) fail();
        opensAtUtc = instant(window.opens_at);
        closesAtUtc = window.closes_at === null ? null : instant(window.closes_at);
        if (
          stage === "provisional" && closesAtUtc === null ||
          closesAtUtc !== null && closesAtUtc <= opensAtUtc
        ) fail();
      }
      const key = examId + "\0" + stage;
      if (stages.has(key)) fail();
      const scopeKey = scopeId + "\0" + stage;
      const signature = [s.academic_year, opensAtUtc, closesAtUtc].map(String).join(":");
      if (scopes.has(scopeKey) && scopes.get(scopeKey) !== signature) fail();
      scopes.set(scopeKey, signature);
      stages.set(
        key,
        Object.freeze({
          examId,
          scopeId,
          packVersion,
          academicYear: exam.academicYear,
          stage,
          opensAtUtc,
          closesAtUtc,
          policyVersion: this.version,
          rolloutId: this.rolloutId,
          approvalSha256: binding.approvalSha256,
        }),
      );
    }
    if (!stages.size) fail();
    this.stages = stages;
    const unchanged = cloneNativeJson(r);
    delete unchanged.expires_at;
    delete unchanged.approval_reference_sha256;
    delete object(unchanged.preview).expires_at;
    const exams: NativeObject = Object.create(null);
    for (const [examId, exam] of binding.exams) {
      exams[examId] = { pack_version: exam.packVersion, academic_year: exam.academicYear };
    }
    this.renewalSemantics = binding.renewalContext === undefined ? null : {
      format: "jungsi.score-input-renewal-context/v2",
      policy: unchanged,
      preview_expiry_offset_microseconds: this.previewExpiresAtUtc - this.expiresAtUtc,
      binding_policy_version: binding.policyVersion,
      registry_sha256: binding.registrySha256,
      selection_sha256: binding.selectionSha256,
      exams,
      usage_context: cloneNativeJson(binding.renewalContext),
    };
  }
  /** Bind a renewal to the unchanged policy and counter/catalog identity. */
  renewalSemanticsSha256(): Promise<string | null> {
    if (this.renewalSemantics === null) return Promise.resolve(null);
    return this.renewalSemanticsHash ??= nativeJsonSha256(this.renewalSemantics);
  }
  assertLive(now: bigint): void {
    if (typeof now !== "bigint" || now >= this.expiresAtUtc) fail();
  }
  stage(examId: unknown, stageValue: unknown, now: bigint, requireOpen = true): ApprovedScoreStage {
    this.assertLive(now);
    if (typeof examId !== "string" || !ID.test(examId)) {
      throw new AccessError("invalid_identifier", 422);
    }
    const value = stageValue === undefined ? "mock" : stageValue;
    if (typeof value !== "string" || !SCORE_INPUT_STAGES.includes(value as ScoreInputStage)) {
      throw new AccessError("invalid_score_stage", 422);
    }
    const selected = this.stages.get(examId + "\0" + value);
    if (!selected) throw new AccessError("score_stage_unavailable", 503);
    if (
      requireOpen && (selected.opensAtUtc !== null && now < selected.opensAtUtc ||
        selected.closesAtUtc !== null && now >= selected.closesAtUtc)
    ) {
      throw new AccessError("score_stage_closed", 409);
    }
    return selected;
  }
  previewExempt(session: SessionSnapshot, now: bigint): boolean {
    this.assertLive(now);
    sessionDto(session, now);
    return this.previewEnabled && now < this.previewExpiresAtUtc &&
      (isVerifiedAdminSnapshot(session) || session.user.accountStatus === "active" &&
          this.allowSubjects.has(session.user.subjectId.toLowerCase()));
  }
  context(
    session: SessionSnapshot,
    examId: unknown,
    stage: unknown,
    now: bigint,
    requireOpen = true,
  ): ScoreInputContext {
    return Object.freeze({
      owner: session.user.subjectId,
      stage: this.stage(examId, stage, now, requireOpen),
      previewExempt: this.previewExempt(session, now),
    });
  }
  dailyLimitsReplaced(session: SessionSnapshot, now: bigint): boolean {
    this.assertLive(now);
    sessionDto(session, now);
    return session.tier === "paid" || this.previewExempt(session, now);
  }
  budgetProof(
    session: SessionSnapshot,
    operation: string,
    units: bigint,
    now: bigint,
  ): StageBudgetProof {
    this.assertLive(now);
    sessionDto(session, now);
    if (
      !["score-profile.create", "overall.analyze", "university.analyze", "candidates.build"]
        .includes(operation) ||
      !this.dailyLimitsReplaced(session, now) || typeof units !== "bigint" || units < 0n ||
      units > this.maxRequestCalculationUnits
    ) fail();
    const proof = Object.freeze({
      owner: session.user.subjectId,
      operation,
      approvalSha256: this.binding.approvalSha256,
      session,
      deadlineUtc: now + this.maxRequestRuntimeMilliseconds * 1000n,
      expiresAtUtc: this.expiresAtUtc,
    });
    budgetProofs.add(proof);
    return proof;
  }
  scopeExams(scopeId: string, stage: string): readonly string[] {
    return Object.freeze(
      [...this.stages.values()].filter((s) => s.scopeId === scopeId && s.stage === stage).map((s) =>
        s.examId
      ),
    );
  }
  async analysisContext(profileId: string): Promise<string> {
    return await nativeJsonSha256({
      profile_id: profileId,
      registry: this.binding.registrySha256,
      selection: this.binding.selectionSha256,
      calculation_version: this.calculationVersion,
    });
  }
}
