/** Request-local professional persistence. All values are bound parameters and tenant scoped. */
import { AccessError } from "../application/access.ts";
import type {
  OrganizationStudentRepositoryPort,
  ProfessionalAuditPort,
  ProfessionalAuthority,
  ProfessionalCommand,
  ProfessionalMetadataCipher,
  ProfessionalProfile,
  ProfessionalReport,
  ProfessionalRetentionPort,
  ProfessionalScope,
  ProfessionalStudent,
  StudentReportPort,
  StudentScoreInputPort,
} from "../application/professional_ports.ts";
import { proId, proObject } from "../application/professional_policy.ts";
import type { RequestClockPort, VerifiedUser } from "../application/ports.ts";
import type { ApprovedScoreStage } from "../application/score_input_ports.ts";
import {
  assertScoreInputState,
  consumeScoreInput,
  grantScoreCorrection,
  initialScoreInputState,
  type ScoreInputState,
} from "../domain/score_input_rights.ts";
import { ContractError } from "../domain/exact.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { sqlArrayText, sqlIntegerText, sqlObjectText, sqlUtcText } from "./sql_values.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";

/**
 * 한 모집단위의 마지막 담기 기록(add/remove). 예전 bookmarks 행은 기준선(순번 0의 add)이고,
 * 012 bookmark_events 가 있으면 가장 큰 event_seq 가 그것을 덮는다. 매개변수 $1~$4 = 기관·학생·리포트·모집단위
 */
const LATEST_BOOKMARK_ACTION = `SELECT action FROM (
 SELECT 0::bigint AS seq,'add'::text AS action FROM jungsi_professional.bookmarks
  WHERE org_id=$1 AND student_id=$2 AND report_id=$3 AND offering_id=$4
 UNION ALL
 SELECT event_seq,action FROM jungsi_professional.bookmark_events
  WHERE org_id=$1 AND student_id=$2 AND report_id=$3 AND offering_id=$4
) e ORDER BY seq DESC LIMIT 1`;
const randomEventId = () => crypto.randomUUID().replaceAll("-", "");
const TS = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const STUDENT_SELECT =
  `SELECT s.org_id,s.student_id,s.contract_id,s.academic_year::text,s.version::text,s.archived,
 COALESCE((SELECT array_to_json(a.subject_ids)::text FROM jungsi_professional.assignments a
 WHERE a.org_id=s.org_id AND a.student_id=s.student_id ORDER BY a.version DESC LIMIT 1),'[]'),
 ${TS("s.created_at")},s.sealed_metadata FROM jungsi_professional.students s`;
const REPORT_SELECT =
  `SELECT v.org_id,v.student_id,v.report_id,v.revision::text,v.profile_id,v.exam_id,v.stage,
 v.body::text,v.reasons::text,${TS("v.created_at")} FROM jungsi_professional.report_revisions v`;
export interface ProfessionalRetentionAuthority {
  readonly maximumRows: number;
  readonly officialDeadlineReference: string;
  readonly purgeAtUtc: bigint;
  readonly noticeDaysBefore: 14 | 3;
  readonly authorizedMemberIds: readonly string[];
}
function fail(): never {
  throw new AccessError("professional_storage_unavailable", 503);
}
function number(value: unknown): number {
  const n = sqlIntegerText(value);
  if (typeof n !== "number" || n < 0 || !Number.isSafeInteger(n)) fail();
  return n;
}
function text(value: unknown): string {
  if (typeof value !== "string") fail();
  return value;
}
function one(rows: unknown[][], width: number): unknown[] | null {
  if (
    !Array.isArray(rows) || rows.length > 1 ||
    rows.some((r) => !Array.isArray(r) || r.length !== width)
  ) fail();
  return rows[0] ?? null;
}
function stateRow(r: unknown[]): ScoreInputState {
  const s = {
    version: number(r[0]),
    initialAttemptId: r[1],
    correctionGrantId: r[2],
    correctionAttemptId: r[3],
    currentProfileId: r[4],
    lastAttemptId: r[5],
    lastOutcome: r[6],
    lastRejectionCode: r[7],
  } as ScoreInputState;
  try {
    assertScoreInputState(s);
  } catch {
    fail();
  }
  return Object.freeze(s);
}
function classify(error: unknown): never {
  if (error instanceof AccessError) throw error;
  if (
    error instanceof ContractError &&
    ["score_input_exhausted", "score_input_version_conflict", "score_correction_unavailable"]
      .includes(error.code)
  ) throw new AccessError(error.code, 409);
  throw new AccessError("professional_storage_unavailable", 503);
}
export class SupabaseProfessionalStore
  implements
    OrganizationStudentRepositoryPort,
    StudentScoreInputPort,
    StudentReportPort,
    ProfessionalAuditPort,
    ProfessionalRetentionPort {
  private tx: NativeSqlTransaction | null = null;
  private actor: string | null = null;
  private authority: ProfessionalAuthority | null = null;
  private readonly sql: SupabaseSqlTransport;
  constructor(
    sql: SupabaseSqlTransport,
    private readonly cipher: ProfessionalMetadataCipher,
    private readonly clock: RequestClockPort,
    private readonly maximumRecordBytes: number,
    private readonly retentionSource?: (
      authority: ProfessionalAuthority,
    ) => Promise<ProfessionalRetentionAuthority>,
    private readonly replayCipher: ProfessionalMetadataCipher = cipher,
  ) {
    // Composition supplies the same request-local fork to this store and shared budget settlement.
    this.sql = sql;
    if (
      !Number.isSafeInteger(maximumRecordBytes) || maximumRecordBytes < 1 ||
      maximumRecordBytes > 8388608
    ) fail();
  }
  private id(prefix: string): string {
    return prefix + crypto.randomUUID().replaceAll("-", "");
  }
  isTransactionActive(): boolean {
    return this.tx !== null;
  }
  async transaction<T>(user: VerifiedUser, work: () => Promise<T>): Promise<T> {
    if (this.tx) fail();
    try {
      return await this.sql.requestWrite(user.subjectId, async (tx) => {
        this.tx = tx;
        this.actor = user.subjectId;
        try {
          const version = one(
            await tx.query(
              "SELECT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='007_professional_platform')",
            ),
            1,
          );
          if (!version || version[0] !== true) fail();
          return await work();
        } finally {
          this.tx = null;
          this.actor = null;
          this.authority = null;
        }
      });
    } catch (error) {
      return classify(error);
    }
  }
  /** Only the approved authority adapter receives this server-side query closure. */
  async authorityQuery(
    subject: string,
    statement: string,
    parameters: readonly unknown[],
  ): Promise<unknown[][]> {
    if (this.tx) {
      if (this.actor !== subject) fail();
      return await this.tx.query(statement, parameters);
    }
    return await this.sql.read(subject, (tx) => tx.query(statement, parameters));
  }
  async bindScope(authority: ProfessionalAuthority): Promise<void> {
    if (
      !this.tx || this.actor !== authority.user.subjectId ||
      this.authority && this.authority.contract.orgId !== authority.contract.orgId
    ) fail();
    await this.tx.query("SELECT set_config('jungsi.pro.org_id',$1,true)", [
      authority.contract.orgId,
    ]);
    this.authority = authority;
  }
  private query(
    authority: ProfessionalAuthority,
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<unknown[][]> {
    if (!this.tx || this.actor !== authority.user.subjectId || this.authority !== authority) fail();
    return this.tx.query(statement, parameters);
  }
  private async lock(authority: ProfessionalAuthority, ...parts: string[]): Promise<void> {
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\0"))),
    );
    await this.query(authority, "SELECT pg_advisory_xact_lock($1::bigint)", [
      String(new DataView(bytes.buffer).getBigInt64(0, false)),
    ]);
  }
  private async readStudent(r: unknown[]): Promise<ProfessionalStudent> {
    if (r.length !== 9 || typeof r[5] !== "boolean") fail();
    const orgId = proId(r[0]), studentId = proId(r[1]);
    const ids = sqlArrayText(r[6], this.maximumRecordBytes).map(proId);
    if (new Set(ids).size !== ids.length) fail();
    const a = this.authority;
    if (
      !a || a.contract.orgId !== orgId ||
      a.mode === "member" && a.membership?.role !== "org_admin" &&
        !ids.includes(a.user.subjectId) ||
      a.mode === "support" && a.supportStudentId !== studentId
    ) throw new AccessError("professional_student_not_found", 404);
    return Object.freeze({
      orgId,
      studentId,
      contractId: proId(r[2]),
      academicYear: number(r[3]),
      version: number(r[4]),
      archived: r[5],
      assignedSubjectIds: ids,
      createdAtUtc: utcInstant(sqlUtcText(r[7])),
      metadata: await this.cipher.open(orgId, studentId, text(r[8])),
    });
  }
  async students(
    authority: ProfessionalAuthority,
    maximum: number,
  ): Promise<readonly ProfessionalStudent[]> {
    if (!Number.isSafeInteger(maximum) || maximum < 1) fail();
    const r = await this.query(
      authority,
      STUDENT_SELECT + ` WHERE s.org_id=$1 AND s.contract_id=$2 AND ($4::boolean OR $5=ANY(COALESCE(
 (SELECT a.subject_ids FROM jungsi_professional.assignments a WHERE a.org_id=s.org_id AND a.student_id=s.student_id ORDER BY a.version DESC LIMIT 1),ARRAY[]::text[])))
 ORDER BY s.student_id COLLATE "C" LIMIT $3::bigint`,
      [
        authority.contract.orgId,
        authority.contract.contractId,
        String(maximum + 1),
        authority.membership?.role === "org_admin",
        authority.user.subjectId,
      ],
    );
    if (r.length > maximum) throw new AccessError("professional_roster_limit_exceeded", 503);
    return await Promise.all(r.map((row) => this.readStudent(row)));
  }
  async student(
    authority: ProfessionalAuthority,
    studentId: string,
  ): Promise<ProfessionalStudent | null> {
    const r = one(
      await this.query(
        authority,
        STUDENT_SELECT +
          " WHERE s.org_id=$1 AND s.student_id=$2 AND s.contract_id=$3 FOR SHARE OF s",
        [authority.contract.orgId, proId(studentId), authority.contract.contractId],
      ),
      9,
    );
    return r ? await this.readStudent(r) : null;
  }
  async seatUsage(authority: ProfessionalAuthority): Promise<number> {
    const r = one(
      await this.query(
        authority,
        "SELECT count(*)::text FROM jungsi_professional.seat_allocations WHERE org_id=$1 AND contract_id=$2",
        [authority.contract.orgId, authority.contract.contractId],
      ),
      1,
    );
    if (!r) fail();
    return number(r[0]);
  }
  private scoped(scope: ProfessionalScope): ProfessionalStudent {
    if (
      !scope.student || scope.student.orgId !== scope.authority.contract.orgId ||
      scope.student.contractId !== scope.authority.contract.contractId
    ) throw new AccessError("professional_student_not_found", 404);
    return scope.student;
  }
  async create(
    a: ProfessionalAuthority,
    metadata: NativeObject,
    expectedContractVersion: number,
    command: ProfessionalCommand,
  ): Promise<ProfessionalStudent> {
    await this.lock(a, "pro.seat", a.contract.orgId, a.contract.contractId);
    if (expectedContractVersion !== a.contract.version) {
      throw new AccessError("professional_version_conflict", 409);
    }
    const allocation = await this.seatUsage(a) + 1;
    if (allocation > a.contract.studentCapacity) {
      throw new AccessError("student_seat_limit_reached", 409);
    }
    const sid = this.id("student-"),
      sealed = await this.cipher.seal(a.contract.orgId, sid, metadata);
    await this.query(
      a,
      `INSERT INTO jungsi_professional.students(org_id,student_id,contract_id,academic_year,version,sealed_metadata,created_by)
 VALUES($1,$2,$3,$4::integer,1,$5,$6)`,
      [
        a.contract.orgId,
        sid,
        a.contract.contractId,
        String(a.contract.academicYear),
        sealed,
        a.user.subjectId,
      ],
    );
    await this.query(
      a,
      `INSERT INTO jungsi_professional.seat_allocations(org_id,contract_id,student_id,contract_version,allocation_no,capacity_snapshot,actor_id,request_key,digest)
 VALUES($1,$2,$3,$4::bigint,$5::bigint,$6::bigint,$7,$8,$9)`,
      [
        a.contract.orgId,
        a.contract.contractId,
        sid,
        String(a.contract.version),
        String(allocation),
        String(a.contract.studentCapacity),
        a.user.subjectId,
        command.key,
        command.digest,
      ],
    );
    await this.query(
      a,
      `INSERT INTO jungsi_professional.assignments(org_id,student_id,version,subject_ids,actor_id)
 VALUES($1,$2,1,ARRAY[$3]::text[],$3)`,
      [a.contract.orgId, sid, a.user.subjectId],
    );
    const result = await this.student(a, sid);
    if (!result) fail();
    return result;
  }
  private async change(
    scope: ProfessionalScope,
    expectedVersion: number,
    sealed: string | null,
    archived: boolean,
  ): Promise<ProfessionalStudent> {
    const s = this.scoped(scope), a = scope.authority;
    const changed = await this.query(
      a,
      `UPDATE jungsi_professional.students SET version=version+1,
 sealed_metadata=COALESCE($4,sealed_metadata),archived=$5 WHERE org_id=$1 AND student_id=$2 AND version=$3::bigint RETURNING version::text`,
      [s.orgId, s.studentId, String(expectedVersion), sealed, archived],
    );
    if (!one(changed, 1)) throw new AccessError("professional_version_conflict", 409);
    const result = await this.student(a, s.studentId);
    if (!result) fail();
    return result;
  }
  update(
    scope: ProfessionalScope,
    metadata: NativeObject,
    expectedVersion: number,
  ): Promise<ProfessionalStudent> {
    const s = this.scoped(scope);
    return this.cipher.seal(s.orgId, s.studentId, metadata).then((sealed) =>
      this.change(scope, expectedVersion, sealed, s.archived)
    );
  }
  archive(scope: ProfessionalScope, expectedVersion: number): Promise<ProfessionalStudent> {
    return this.change(scope, expectedVersion, null, true);
  }
  async assign(
    scope: ProfessionalScope,
    subjects: readonly string[],
    expectedVersion: number,
  ): Promise<ProfessionalStudent> {
    const a = scope.authority, s = this.scoped(scope);
    if (subjects.length > 64 || new Set(subjects).size !== subjects.length) {
      throw new AccessError("invalid_request", 422);
    }
    subjects.forEach(proId);
    const changed = await this.change(scope, expectedVersion, null, s.archived);
    await this.query(
      a,
      `INSERT INTO jungsi_professional.assignments(org_id,student_id,version,subject_ids,actor_id)
 VALUES($1,$2,$3::bigint,ARRAY(SELECT jsonb_array_elements_text($4::jsonb)),$5)`,
      [
        s.orgId,
        s.studentId,
        String(changed.version),
        nativeJsonText([...subjects]),
        a.user.subjectId,
      ],
    );
    const result = await this.student(a, s.studentId);
    if (!result) fail();
    return result;
  }
  private resource(scope: ProfessionalScope): string {
    return scope.student
      ? "student:" + scope.student.studentId
      : "org:" + scope.authority.contract.orgId;
  }
  async replay(scope: ProfessionalScope, c: ProfessionalCommand) {
    const a = scope.authority, resource = this.resource(scope);
    await this.lock(
      a,
      "pro.request",
      a.contract.orgId,
      a.user.subjectId,
      c.operation,
      resource,
      c.key,
    );
    const r = one(
      await this.query(
        a,
        `SELECT digest,sealed_result FROM jungsi_professional.operation_requests
 WHERE org_id=$1 AND actor_id=$2 AND operation=$3 AND resource_key=$4 AND request_key=$5`,
        [a.contract.orgId, a.user.subjectId, c.operation, resource, c.key],
      ),
      2,
    );
    if (!r) return null;
    if (r[0] !== c.digest) throw new AccessError("idempotency_conflict", 409);
    const purpose = "receipt:" +
      await nativeJsonSha256([a.user.subjectId, c.operation, resource, c.key]);
    return {
      digest: text(r[0]),
      result: await this.replayCipher.open(a.contract.orgId, purpose, text(r[1])),
    };
  }
  async remember(
    scope: ProfessionalScope,
    c: ProfessionalCommand,
    result: NativeObject,
  ): Promise<void> {
    const a = scope.authority,
      resource = this.resource(scope),
      purpose = "receipt:" +
        await nativeJsonSha256([a.user.subjectId, c.operation, resource, c.key]);
    const sealed = await this.replayCipher.seal(a.contract.orgId, purpose, result);
    await this.query(
      a,
      `INSERT INTO jungsi_professional.operation_requests(org_id,actor_id,operation,resource_key,request_key,digest,sealed_result)
 VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [a.contract.orgId, a.user.subjectId, c.operation, resource, c.key, c.digest, sealed],
    );
  }
  private async inputState(
    scope: ProfessionalScope,
    stage: ApprovedScoreStage,
  ): Promise<ScoreInputState> {
    const s = this.scoped(scope), a = scope.authority;
    const r = one(
      await this.query(
        a,
        `SELECT version::text,initial_attempt_id,correction_grant_id,correction_attempt_id,current_profile_id,last_attempt_id,last_outcome,last_rejection_code
 FROM jungsi_professional.input_states WHERE org_id=$1 AND student_id=$2 AND input_scope=$3 AND stage=$4 ORDER BY version DESC LIMIT 1`,
        [s.orgId, s.studentId, stage.scopeId, stage.stage],
      ),
      8,
    );
    if (r) return stateRow(r);
    const old = one(
      await this.query(
        a,
        "SELECT EXISTS(SELECT 1 FROM jungsi_professional.profiles WHERE org_id=$1 AND student_id=$2 AND input_scope=$3 AND stage=$4)",
        [s.orgId, s.studentId, stage.scopeId, stage.stage],
      ),
      1,
    );
    if (!old || old[0] !== false) throw new AccessError("score_input_transition_pending", 503);
    return initialScoreInputState();
  }
  state(scope: ProfessionalScope, stage: ApprovedScoreStage): Promise<ScoreInputState> {
    return this.inputState(scope, stage);
  }
  private async writeState(
    scope: ProfessionalScope,
    stage: ApprovedScoreStage,
    state: ScoreInputState,
  ): Promise<void> {
    const s = this.scoped(scope);
    await this.query(
      scope.authority,
      `INSERT INTO jungsi_professional.input_states(org_id,student_id,input_scope,stage,version,initial_attempt_id,correction_grant_id,correction_attempt_id,current_profile_id,last_attempt_id,last_outcome,last_rejection_code,policy_version,approval_sha256)
 VALUES($1,$2,$3,$4,$5::bigint,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        s.orgId,
        s.studentId,
        stage.scopeId,
        stage.stage,
        String(state.version),
        state.initialAttemptId,
        state.correctionGrantId,
        state.correctionAttemptId,
        state.currentProfileId,
        state.lastAttemptId,
        state.lastOutcome,
        state.lastRejectionCode,
        stage.policyVersion,
        stage.approvalSha256,
      ],
    );
  }
  async save(
    scope: ProfessionalScope,
    stage: ApprovedScoreStage,
    expectedVersion: number,
    scores: NativeObject,
    c: ProfessionalCommand,
    rejectionCode: string | null,
  ) {
    const s = this.scoped(scope), a = scope.authority;
    await this.lock(a, "pro.input", s.orgId, s.studentId, stage.scopeId, stage.stage);
    const old = await this.inputState(scope, stage);
    if (old.version !== expectedVersion) throw new AccessError("score_input_version_conflict", 409);
    const attemptId = this.id("attempt-"),
      profileId = rejectionCode === null ? this.id("profile-") : null;
    let state: ScoreInputState;
    try {
      state = consumeScoreInput(old, attemptId, profileId, false, rejectionCode);
    } catch (error) {
      return classify(error);
    }
    if (profileId !== null) {
      await this.query(
        a,
        `INSERT INTO jungsi_professional.profiles(org_id,student_id,profile_id,input_scope,stage,state_version,version,exam_id,pack_version,scores,scores_sha256,confirmed,actor_id)
 VALUES($1,$2,$3,$4,$5,$6::bigint,1,$7,$8,$9::jsonb,$10,true,$11)`,
        [
          s.orgId,
          s.studentId,
          profileId,
          stage.scopeId,
          stage.stage,
          String(state.version),
          stage.examId,
          stage.packVersion,
          nativeJsonText(scores),
          await nativeJsonSha256(scores),
          a.user.subjectId,
        ],
      );
    }
    await this.writeState(scope, stage, state);
    await this.query(
      a,
      `INSERT INTO jungsi_professional.input_attempts(org_id,student_id,attempt_id,input_scope,stage,state_version,exam_id,pack_version,actor_id,operation,request_key,request_digest,outcome,profile_id,rejection_code,policy_version)
 VALUES($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,'pro.score.create',$10,$11,$12,$13,$14,$15)`,
      [
        s.orgId,
        s.studentId,
        attemptId,
        stage.scopeId,
        stage.stage,
        String(state.version),
        stage.examId,
        stage.packVersion,
        a.user.subjectId,
        c.key,
        c.digest,
        rejectionCode === null ? "accepted" : "rejected",
        profileId,
        rejectionCode,
        stage.policyVersion,
      ],
    );
    return { state, profile: profileId === null ? null : await this.profile(scope, profileId) };
  }
  async correction(
    scope: ProfessionalScope,
    stage: ApprovedScoreStage,
    expectedVersion: number,
    ticketRef: string,
    c: ProfessionalCommand,
  ): Promise<ScoreInputState> {
    const s = this.scoped(scope), a = scope.authority;
    await this.lock(a, "pro.input", s.orgId, s.studentId, stage.scopeId, stage.stage);
    const old = await this.inputState(scope, stage), commandId = this.id("correction-");
    let state: ScoreInputState;
    try {
      state = grantScoreCorrection(old, commandId, expectedVersion);
    } catch (error) {
      return classify(error);
    }
    await this.query(
      a,
      `INSERT INTO jungsi_professional.corrections(org_id,student_id,command_id,input_scope,stage,support_actor_id,ticket_ref,expected_version,granted_version,previous_attempt_id,request_key,digest,policy_version)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::bigint,$9::bigint,$10,$11,$12,$13)`,
      [
        s.orgId,
        s.studentId,
        commandId,
        stage.scopeId,
        stage.stage,
        a.user.subjectId,
        ticketRef,
        String(expectedVersion),
        String(state.version),
        old.lastAttemptId,
        c.key,
        c.digest,
        stage.policyVersion,
      ],
    );
    await this.writeState(scope, stage, state);
    return state;
  }
  async profile(scope: ProfessionalScope, profileId: string): Promise<ProfessionalProfile | null> {
    const s = this.scoped(scope),
      r = one(
        await this.query(
          scope.authority,
          `SELECT org_id,student_id,profile_id,version::text,exam_id,pack_version,stage,confirmed,scores::text,${
            TS("created_at")
          }
 FROM jungsi_professional.profiles WHERE org_id=$1 AND student_id=$2 AND profile_id=$3`,
          [s.orgId, s.studentId, proId(profileId)],
        ),
        10,
      );
    if (!r) return null;
    if (typeof r[7] !== "boolean" || !["mock", "provisional", "final"].includes(String(r[6]))) {
      fail();
    }
    return {
      orgId: proId(r[0]),
      studentId: proId(r[1]),
      profileId: proId(r[2]),
      version: number(r[3]),
      examId: proId(r[4]),
      packVersion: proId(r[5]),
      stage: r[6] as ProfessionalProfile["stage"],
      confirmed: r[7],
      scores: sqlObjectText(r[8], this.maximumRecordBytes),
      createdAtUtc: utcInstant(sqlUtcText(r[9])),
    };
  }
  private reportRow(r: unknown[]): ProfessionalReport {
    if (r.length !== 10 || !["mock", "provisional", "final"].includes(String(r[6]))) fail();
    const reasons = sqlArrayText(r[8], this.maximumRecordBytes).map(proObject);
    return {
      orgId: proId(r[0]),
      studentId: proId(r[1]),
      reportId: proId(r[2]),
      revision: number(r[3]),
      profileId: proId(r[4]),
      examId: proId(r[5]),
      stage: r[6] as ProfessionalReport["stage"],
      body: sqlObjectText(r[7], this.maximumRecordBytes),
      reasons,
      createdAtUtc: utcInstant(sqlUtcText(r[9])),
    };
  }
  async reports(scope: ProfessionalScope, maximum: number): Promise<readonly ProfessionalReport[]> {
    const s = this.scoped(scope);
    if (!Number.isSafeInteger(maximum) || maximum < 1) fail();
    const rows = await this.query(
      scope.authority,
      REPORT_SELECT +
        ' WHERE v.org_id=$1 AND v.student_id=$2 ORDER BY v.report_id COLLATE "C",v.revision DESC LIMIT $3::bigint',
      [s.orgId, s.studentId, String(maximum + 1)],
    );
    if (rows.length > maximum) throw new AccessError("professional_report_limit_exceeded", 503);
    return rows.map((r) => this.reportRow(r));
  }
  async report(
    scope: ProfessionalScope,
    reportId: string,
    revision?: number,
  ): Promise<ProfessionalReport | null> {
    const s = this.scoped(scope);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
      throw new AccessError("invalid_request", 422);
    }
    const rows = await this.query(
      scope.authority,
      REPORT_SELECT +
        " WHERE v.org_id=$1 AND v.student_id=$2 AND v.report_id=$3 AND ($4::bigint IS NULL OR v.revision=$4::bigint) ORDER BY v.revision DESC LIMIT 1",
      [s.orgId, s.studentId, proId(reportId), revision === undefined ? null : String(revision)],
    );
    const r = one(rows, 10);
    return r ? this.reportRow(r) : null;
  }
  async publish(
    scope: ProfessionalScope,
    profile: ProfessionalProfile,
    operation: string,
    result: NativeObject,
    reasons: readonly NativeObject[],
    assessments?: NativeObject,
  ): Promise<ProfessionalReport> {
    const s = this.scoped(scope), a = scope.authority;
    if (profile.orgId !== s.orgId || profile.studentId !== s.studentId) {
      throw new AccessError("professional_report_not_found", 404);
    }
    await this.lock(a, "pro.report", s.orgId, s.studentId, profile.profileId);
    const existing = one(
      await this.query(
        a,
        "SELECT report_id,revision::text FROM jungsi_professional.reports WHERE org_id=$1 AND student_id=$2 AND profile_id=$3",
        [s.orgId, s.studentId, profile.profileId],
      ),
      2,
    );
    const reportId = existing ? proId(existing[0]) : this.id("report-"),
      revision = existing ? number(existing[1]) + 1 : 1;
    if (!Number.isSafeInteger(revision)) fail();
    const previous = existing ? await this.report(scope, reportId, revision - 1) : null;
    let body: NativeObject;
    if (previous) body = cloneNativeJson(previous.body);
    else {
      if (operation !== "pro.overall.analyze") {
        throw new AccessError("professional_initial_report_required", 409);
      }
      body = {
        overall: cloneNativeJson(result),
        analyses: {},
        candidates: null,
        shortlist: {},
        catalog_version: null,
        analysis_status: { status: "pending", reason_code: "offering_analysis_not_requested" },
      };
    }
    if (operation === "pro.overall.analyze") body.overall = cloneNativeJson(result);
    else if (operation === "pro.university.analyze") {
      const offeringId = proId(result.offering_id), analyses = proObject(body.analyses);
      analyses[offeringId] = cloneNativeJson(result);
      body.analyses = analyses;
    } else if (operation === "pro.candidates") {
      body.candidates = cloneNativeJson(result);
      body.catalog_version = result.catalog_version;
      if (!assessments) fail();
      Object.assign(proObject(body.analyses), cloneNativeJson(assessments));
    } else throw new AccessError("invalid_request", 422);
    if (operation !== "pro.overall.analyze") {
      const ready = Object.values(proObject(body.analyses)).some((value) =>
        proObject(value).status === "ready"
      );
      body.analysis_status = {
        status: ready ? "ready" : "pending",
        reason_code: ready ? null : "offering_analysis_pending",
      };
    }
    const now = utcText(this.clock.nowUtc());
    if (!existing) {
      await this.query(
        a,
        "INSERT INTO jungsi_professional.reports(org_id,student_id,report_id,profile_id,revision,updated_at) VALUES($1,$2,$3,$4,1,$5::timestamptz)",
        [s.orgId, s.studentId, reportId, profile.profileId, now],
      );
    } else {
      const updated = one(
        await this.query(
          a,
          "UPDATE jungsi_professional.reports SET revision=$4::bigint,updated_at=$5::timestamptz WHERE org_id=$1 AND student_id=$2 AND report_id=$3 AND revision=$6::bigint RETURNING revision::text",
          [s.orgId, s.studentId, reportId, String(revision), now, String(revision - 1)],
        ),
        1,
      );
      if (!updated) throw new AccessError("professional_version_conflict", 409);
    }
    await this.query(
      a,
      `INSERT INTO jungsi_professional.report_revisions(org_id,student_id,report_id,revision,profile_id,exam_id,stage,body,reasons,body_sha256,actor_id,created_at)
 VALUES($1,$2,$3,$4::bigint,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::timestamptz)`,
      [
        s.orgId,
        s.studentId,
        reportId,
        String(revision),
        profile.profileId,
        profile.examId,
        profile.stage,
        nativeJsonText(body),
        nativeJsonText([...reasons]),
        await nativeJsonSha256(body),
        a.user.subjectId,
        now,
      ],
    );
    const written = await this.report(scope, reportId, revision);
    if (!written) fail();
    return written;
  }
  async bookmarks(
    scope: ProfessionalScope,
    reportId: string,
    maximum: number,
  ): Promise<NativeObject> {
    const s = this.scoped(scope), report = await this.report(scope, reportId);
    if (!report) throw new AccessError("professional_report_not_found", 404);
    if (!Number.isSafeInteger(maximum) || maximum < 1) fail();
    // 지금 담긴 상태 = 모집단위마다 가장 큰 event_seq 기록이 add 인 것(012 bookmark_events).
    // 예전 bookmarks 행은 순번 0의 add 기준선으로 함께 본다(장부를 고치거나 지우지 않음)
    const rows = await this.query(
      scope.authority,
      `SELECT offering_id,${TS("created_at")} FROM (
 SELECT DISTINCT ON (offering_id) offering_id,created_at,action FROM (
  SELECT offering_id,created_at,'add'::text AS action,0::bigint AS seq FROM jungsi_professional.bookmarks
   WHERE org_id=$1 AND student_id=$2 AND report_id=$3
  UNION ALL
  SELECT offering_id,created_at,action,event_seq FROM jungsi_professional.bookmark_events
   WHERE org_id=$1 AND student_id=$2 AND report_id=$3
 ) e ORDER BY offering_id,seq DESC
) latest WHERE action='add' ORDER BY offering_id COLLATE "C" LIMIT $4::bigint`,
      [s.orgId, s.studentId, reportId, String(maximum + 1)],
    );
    if (rows.length > maximum || rows.some((r) => r.length !== 2)) {
      throw new AccessError("professional_bookmark_limit_exceeded", 503);
    }
    const output: NativeObject = {};
    for (const r of rows) {
      output[proId(r[0])] = {
        selected: true,
        changed_at: sqlUtcText(r[1]),
        assessment_status: "needs_revalidation",
        profile_id: report.profileId,
        catalog_version: typeof report.body.catalog_version === "string"
          ? report.body.catalog_version
          : null,
      };
    }
    return output;
  }
  async addBookmark(
    scope: ProfessionalScope,
    report: ProfessionalReport,
    offeringId: string,
    maximum: number,
  ): Promise<NativeObject> {
    const s = this.scoped(scope), a = scope.authority;
    if (report.orgId !== s.orgId || report.studentId !== s.studentId) {
      throw new AccessError("professional_report_not_found", 404);
    }
    // 같은 기관·학생·리포트의 담기/빼기는 한 줄로 세운다(012 준비안 조건)
    await this.lock(a, "pro-bookmark", s.orgId, s.studentId, report.reportId);
    await this.query(
      a,
      `INSERT INTO jungsi_professional.bookmarks(org_id,student_id,report_id,offering_id,actor_id)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id,student_id,report_id,offering_id) DO NOTHING`,
      [s.orgId, s.studentId, report.reportId, proId(offeringId), a.user.subjectId],
    );
    // 뺀 뒤 다시 담으면 add 기록을 쌓는다(마지막 기록이 remove 일 때만)
    await this.query(
      a,
      `INSERT INTO jungsi_professional.bookmark_events(org_id,student_id,report_id,offering_id,event_id,action,actor_id)
 SELECT $1,$2,$3,$4,$6,'add',$5 WHERE (${LATEST_BOOKMARK_ACTION})='remove'`,
      [s.orgId, s.studentId, report.reportId, proId(offeringId), a.user.subjectId, randomEventId()],
    );
    return await this.bookmarks(scope, report.reportId, maximum);
  }
  async removeBookmark(
    scope: ProfessionalScope,
    report: ProfessionalReport,
    offeringId: string,
    eventId: string,
    maximum: number,
  ): Promise<NativeObject> {
    const s = this.scoped(scope), a = scope.authority;
    if (report.orgId !== s.orgId || report.studentId !== s.studentId) {
      throw new AccessError("professional_report_not_found", 404);
    }
    // 같은 기관·학생·리포트의 담기/빼기는 한 줄로 세운다(012 준비안 조건)
    await this.lock(a, "pro-bookmark", s.orgId, s.studentId, report.reportId);
    // 지금 담겨 있을 때만 remove 기록을 쌓는다. 담겨 있지 않으면 아무것도 쓰지 않고 404
    const written = await this.query(
      a,
      `INSERT INTO jungsi_professional.bookmark_events(org_id,student_id,report_id,offering_id,event_id,action,actor_id)
 SELECT $1,$2,$3,$4,$6,'remove',$5 WHERE (${LATEST_BOOKMARK_ACTION})='add' RETURNING event_id`,
      [s.orgId, s.studentId, report.reportId, proId(offeringId), a.user.subjectId, proId(eventId)],
    );
    if (written.length !== 1) throw new AccessError("professional_bookmark_not_found", 404);
    return await this.bookmarks(scope, report.reportId, maximum);
  }
  async record(
    scope: ProfessionalScope,
    event: {
      requestId: string;
      operation: string;
      result: "success" | "rejected";
      ticketRef: string | null;
    },
  ): Promise<void> {
    const a = scope.authority;
    if (!/^[a-f0-9]{32}$/.test(event.requestId)) fail();
    await this.query(
      a,
      `INSERT INTO jungsi_professional.audit_events(org_id,event_id,student_id,actor_id,operation,request_id,result,ticket_ref)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        a.contract.orgId,
        this.id("audit-"),
        scope.student?.studentId ?? null,
        a.user.subjectId,
        proId(event.operation),
        event.requestId,
        event.result,
        event.ticketRef,
      ],
    );
  }
  private async retention(a: ProfessionalAuthority): Promise<ProfessionalRetentionAuthority> {
    if (a.mode !== "retention" || !this.retentionSource) {
      throw new AccessError("professional_retention_unavailable", 503);
    }
    const r = await this.retentionSource(a);
    if (
      !r || !Number.isSafeInteger(r.maximumRows) || r.maximumRows < 1 || r.maximumRows > 200000 ||
      typeof r.purgeAtUtc !== "bigint" || !/^https:\/\//.test(r.officialDeadlineReference) ||
      ![14, 3].includes(r.noticeDaysBefore) ||
      !Array.isArray(r.authorizedMemberIds) ||
      new Set(r.authorizedMemberIds).size !== r.authorizedMemberIds.length
    ) throw new AccessError("professional_retention_unavailable", 503);
    r.authorizedMemberIds.forEach(proId);
    return r;
  }
  async preview(a: ProfessionalAuthority, input: NativeObject): Promise<NativeObject> {
    const approved = await this.retention(a);
    if (
      input.contract_id !== a.contract.contractId ||
      input.academic_year !== a.contract.academicYear ||
      input.official_deadline_reference !== approved.officialDeadlineReference ||
      typeof input.cutoff_at_utc !== "string"
    ) throw new AccessError("invalid_request", 422);
    const cutoff = utcInstant(input.cutoff_at_utc);
    if (cutoff > approved.purgeAtUtc) throw new AccessError("invalid_request", 422);
    const params = [
      a.contract.orgId,
      a.contract.contractId,
      String(a.contract.academicYear),
      utcText(cutoff),
      String(approved.maximumRows + 1),
    ];
    const students = await this.query(
      a,
      'SELECT student_id,version::text,md5(sealed_metadata) FROM jungsi_professional.students WHERE org_id=$1 AND contract_id=$2 AND academic_year=$3::integer AND created_at<=$4::timestamptz ORDER BY student_id COLLATE "C" LIMIT $5::bigint',
      params,
    );
    const profiles = await this.query(
      a,
      `SELECT p.student_id,p.profile_id,p.scores_sha256 FROM jungsi_professional.profiles p JOIN jungsi_professional.students s ON s.org_id=p.org_id AND s.student_id=p.student_id
 WHERE s.org_id=$1 AND s.contract_id=$2 AND s.academic_year=$3::integer AND s.created_at<=$4::timestamptz ORDER BY p.student_id COLLATE "C",p.profile_id COLLATE "C" LIMIT $5::bigint`,
      params,
    );
    const reports = await this.query(
      a,
      `SELECT v.student_id,v.report_id,v.revision::text,v.body_sha256 FROM jungsi_professional.report_revisions v JOIN jungsi_professional.students s ON s.org_id=v.org_id AND s.student_id=v.student_id
 WHERE s.org_id=$1 AND s.contract_id=$2 AND s.academic_year=$3::integer AND s.created_at<=$4::timestamptz ORDER BY v.student_id COLLATE "C",v.report_id COLLATE "C",v.revision LIMIT $5::bigint`,
      params,
    );
    if ([students, profiles, reports].some((rows) => rows.length > approved.maximumRows)) {
      throw new AccessError("professional_result_limit_exceeded", 503);
    }
    const fingerprints = {
      students: students.map((r) => ({
        student_id: proId(r[0]),
        version: number(r[1]),
        preservation_ciphertext_md5: text(r[2]),
      })),
      profiles: profiles.map((r) => ({
        student_id: proId(r[0]),
        profile_id: proId(r[1]),
        sha256: text(r[2]),
      })),
      revisions: reports.map((r) => ({
        student_id: proId(r[0]),
        report_id: proId(r[1]),
        revision: number(r[2]),
        sha256: text(r[3]),
      })),
    };
    const base: NativeObject = {
      org_id: a.contract.orgId,
      contract_id: a.contract.contractId,
      academic_year: a.contract.academicYear,
      official_deadline_reference: approved.officialDeadlineReference,
      cutoff_at_utc: utcText(cutoff),
      counts: {
        students: students.length,
        profiles: profiles.length,
        report_revisions: reports.length,
      },
      expected_previous_fingerprints: fingerprints,
      approval_required: true,
    };
    const manifestSha = await nativeJsonSha256(base),
      result = { ...base, manifest_sha256: manifestSha };
    await this.query(
      a,
      `INSERT INTO jungsi_professional.retention_previews(org_id,preview_id,contract_id,academic_year,official_deadline_reference,cutoff_at,manifest,manifest_sha256,actor_id)
 VALUES($1,$2,$3,$4::integer,$5,$6::timestamptz,$7::jsonb,$8,$9)`,
      [
        a.contract.orgId,
        this.id("preview-"),
        a.contract.contractId,
        String(a.contract.academicYear),
        approved.officialDeadlineReference,
        utcText(cutoff),
        nativeJsonText(result),
        manifestSha,
        a.user.subjectId,
      ],
    );
    return result;
  }
  async noticeTargets(a: ProfessionalAuthority): Promise<NativeObject> {
    const r = await this.retention(a),
      counts = one(
        await this.query(
          a,
          "SELECT count(*)::text FROM jungsi_professional.students WHERE org_id=$1 AND contract_id=$2 AND academic_year=$3::integer",
          [a.contract.orgId, a.contract.contractId, String(a.contract.academicYear)],
        ),
        1,
      );
    if (!counts) fail();
    return {
      org_id: a.contract.orgId,
      contract_id: a.contract.contractId,
      due_at_utc: utcText(r.purgeAtUtc - BigInt(r.noticeDaysBefore) * 86400000000n),
      notice_days_before: r.noticeDaysBefore,
      authorized_member_ids: [...r.authorizedMemberIds],
      counts: { students: number(counts[0]) },
    };
  }
}
