/** Immutable input rights and first paid delivery. Every mutation is app-role/owner scoped. */
import { AccessError } from "../application/access.ts";
import type { ApprovedOperatingPolicy } from "../application/operating_policy.ts";
import type { RequestClockPort } from "../application/ports.ts";
import type {
  ProfileWrite,
  StoredProfile,
  StoredReport,
} from "../application/platform_repository.ts";
import type {
  PaidResultDelivery,
  SavedSnapshotScope,
  ScoreCorrectionCommand,
  ScoreCorrectionReceipt,
  ScoreInputAttempt,
  ScoreInputContext,
  ScoreInputRepositoryPort,
} from "../application/score_input_ports.ts";
import {
  assertScoreInputState,
  consumeScoreInput,
  grantScoreCorrection,
  initialScoreInputState,
  type ScoreInputState,
} from "../domain/score_input_rights.ts";
import { ContractError } from "../domain/exact.ts";
import { utcText } from "../domain/time.ts";
import { sqlArrayText, sqlIntegerText, sqlUtcText } from "./sql_values.ts";
import { SupabasePlatformRepository } from "./platform_postgres.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  HASH = /^[a-f0-9]{64}$/,
  UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATE_COLUMNS =
  "version::text,initial_attempt_id,correction_grant_id,correction_attempt_id,current_profile_id,last_attempt_id,last_outcome,last_rejection_code";
const STATE_BASE =
  `SELECT ${STATE_COLUMNS} FROM jungsi_backend.score_input_states WHERE owner_id=$1 AND input_scope=$2 AND stage=$3`;
const ATTEMPT_BASE =
  `SELECT attempt_id,request_digest,outcome,profile_id,rejection_code,state_version::text,input_scope,stage,exam_id,pack_version,preview_exempt FROM jungsi_backend.score_input_attempts`;
function invalid(): never {
  throw new AccessError("storage_result_invalid", 503);
}
function one(rows: unknown[][], size: number): unknown[] | null {
  if (
    !Array.isArray(rows) || rows.length > 1 ||
    rows.some((r) => !Array.isArray(r) || r.length !== size)
  ) invalid();
  return rows[0] ?? null;
}
function text(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) invalid();
  return v;
}
function nullable(v: unknown): string | null {
  return v === null ? null : text(v);
}
function number(v: unknown): number {
  const n = sqlIntegerText(v);
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) invalid();
  return n;
}
function identity(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) {
    throw new AccessError("storage_identity_invalid", 503);
  }
  return v;
}
function classify(e: unknown): never {
  if (e instanceof ContractError) {
    throw new AccessError(
      e.code,
      ["score_input_exhausted", "score_input_version_conflict", "score_correction_unavailable"]
          .includes(e.code)
        ? 409
        : 503,
    );
  }
  throw e;
}
function stateRow(r: unknown[]): ScoreInputState {
  const s: ScoreInputState = {
    version: number(r[0]),
    initialAttemptId: nullable(r[1]),
    correctionGrantId: nullable(r[2]),
    correctionAttemptId: nullable(r[3]),
    currentProfileId: nullable(r[4]),
    lastAttemptId: nullable(r[5]),
    lastOutcome: r[6] as ScoreInputState["lastOutcome"],
    lastRejectionCode: r[7] as string | null,
  };
  try {
    assertScoreInputState(s);
  } catch (e) {
    classify(e);
  }
  return Object.freeze(s);
}
async function lock(tx: NativeSqlTransaction, ...parts: string[]): Promise<void> {
  const data = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\0"))),
  );
  await tx.query("SELECT pg_advisory_xact_lock($1::bigint)", [
    String(new DataView(data.buffer).getBigInt64(0, false)),
  ]);
}
function params(c: ScoreInputContext): readonly string[] {
  return [identity(c.owner), text(c.stage.scopeId), text(c.stage.stage)];
}
/** Instances are request-local. The acceptance transaction encloses projection, usage settle and final serialization. */
const committedScoreRejections = new WeakSet<AccessError>();
/** Private post-COMMIT marker: a semantic rejection already settled atomically must not be re-cleaned. */
export function isCommittedScoreRejection(error: unknown): boolean {
  return error instanceof AccessError && committedScoreRejections.has(error);
}
export class SupabaseScoreInputRepository implements ScoreInputRepositoryPort {
  private active: NativeSqlTransaction | null = null;
  private rejectedCode: string | null = null;
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly platform: SupabasePlatformRepository,
    private readonly policy: ApprovedOperatingPolicy,
    private readonly clock: RequestClockPort,
  ) {}
  private id(prefix: string): string {
    return prefix + crypto.randomUUID().replaceAll("-", "");
  }
  private read<T>(owner: string, work: (tx: NativeSqlTransaction) => Promise<T>): Promise<T> {
    identity(owner);
    return this.active ? work(this.active) : this.sql.read(owner, work);
  }
  /** A known pre-commit 5xx rolls back profile and input-rights state together.
   * A connection failure during COMMIT is indeterminate: recover using the same idempotency key/status. */
  async accept<T>(
    owner: string,
    work: () => Promise<T>,
    verify: () => Promise<void> = () => Promise.resolve(),
  ): Promise<T> {
    if (this.active) throw new AccessError("score_input_acceptance_unavailable", 503);
    let contentError: AccessError | null = null;
    const value = await this.sql.requestWrite(owner, async (tx) => {
      this.active = tx;
      this.rejectedCode = null;
      try {
        const value = await work();
        await verify();
        return { value };
      } catch (e) {
        if (e instanceof AccessError && e.http === 422 && this.rejectedCode === e.code) {
          await verify();
          contentError = e;
          return null;
        }
        throw e;
      } finally {
        this.active = null;
        this.rejectedCode = null;
      }
    });
    if (contentError) {
      committedScoreRejections.add(contentError);
      throw contentError;
    }
    if (!value) invalid();
    return value.value;
  }
  private async guard(
    tx: NativeSqlTransaction,
    c: ScoreInputContext,
    hasState: boolean,
  ): Promise<void> {
    const ids = this.policy.scopeExams(c.stage.scopeId, c.stage.stage);
    if (!ids.length) throw new AccessError("score_input_transition_pending", 503);
    const row = one(
      await tx.query(
        `SELECT EXISTS(SELECT 1 FROM jungsi_backend.score_policy_rollouts
   WHERE rollout_id=$1 AND policy_version=$2 AND approval_sha256=$3 AND status='validated'),
   EXISTS(SELECT 1 FROM jungsi_backend.profiles p WHERE p.owner_id=$4 AND p.scores->>'exam_id' IN (SELECT jsonb_array_elements_text($5::jsonb))
    AND (NOT $6::boolean OR NOT EXISTS(SELECT 1 FROM jungsi_backend.score_input_attempts a
     WHERE a.owner_id=p.owner_id AND a.profile_id=p.profile_id AND a.input_scope=$7 AND a.stage=$8)
     AND NOT EXISTS(SELECT 1 FROM jungsi_backend.score_input_legacy_links l
      WHERE l.owner_id=p.owner_id AND l.profile_id=p.profile_id AND l.input_scope=$7 AND l.stage=$8 AND l.rollout_id=$1)))`,
        [
          c.stage.rolloutId,
          c.stage.policyVersion,
          c.stage.approvalSha256,
          c.owner,
          JSON.stringify(ids),
          hasState,
          c.stage.scopeId,
          c.stage.stage,
        ],
      ),
      2,
    );
    if (!row || row[0] !== true || row[1] !== false) {
      throw new AccessError("score_input_transition_pending", 503);
    }
  }
  private async stateIn(
    tx: NativeSqlTransaction,
    c: ScoreInputContext,
    version?: number,
  ): Promise<ScoreInputState> {
    const row = one(
      await tx.query(
        STATE_BASE +
          (version === undefined ? " ORDER BY version DESC LIMIT 1" : " AND version=$4::bigint"),
        [...params(c), ...(version === undefined ? [] : [String(version)])],
      ),
      8,
    );
    if (version !== undefined) {
      if (!row) invalid();
      return stateRow(row);
    }
    await this.guard(tx, c, row !== null);
    return row ? stateRow(row) : initialScoreInputState();
  }
  state(c: ScoreInputContext): Promise<ScoreInputState> {
    return this.read(c.owner, (tx) => this.stateIn(tx, c));
  }
  private async profileIn(
    tx: NativeSqlTransaction,
    owner: string,
    pid: string,
  ): Promise<StoredProfile | null> {
    return await this.platform.getProfileInTransaction(tx, owner, pid);
  }
  private async replayIn(
    tx: NativeSqlTransaction,
    owner: string,
    op: string,
    key: string,
    digest: string,
  ): Promise<ScoreInputAttempt | null> {
    if (
      !HASH.test(digest) || !ID.test(key) ||
      !["score-profile.create", "overall.profile"].includes(op)
    ) throw new AccessError("storage_parameters_invalid", 503);
    const row = one(
      await tx.query(ATTEMPT_BASE + " WHERE owner_id=$1 AND operation=$2 AND request_key=$3", [
        identity(owner),
        op,
        key,
      ]),
      11,
    );
    if (!row) return null;
    if (row[1] !== digest) throw new AccessError("idempotency_conflict", 409);
    const configured = this.policy.stage(row[8], row[7], this.clock.nowUtc(), false);
    if (configured.scopeId !== row[6] || typeof row[10] !== "boolean") invalid();
    const context: ScoreInputContext = {
      owner,
      stage: { ...configured, packVersion: text(row[9]) },
      previewExempt: row[10],
    };
    const state = await this.stateIn(tx, context, number(row[5]));
    if (!["accepted", "rejected"].includes(String(row[2]))) invalid();
    const profile = row[3] === null ? null : await this.profileIn(tx, owner, text(row[3]));
    if (
      row[2] === "accepted" && (!profile || row[4] !== null) ||
      row[2] === "rejected" && (profile !== null || typeof row[4] !== "string")
    ) invalid();
    return {
      attemptId: text(row[0]),
      owner,
      operation: op as ScoreInputAttempt["operation"],
      key,
      digest,
      state,
      outcome: row[2] as ScoreInputAttempt["outcome"],
      profile,
      context,
      rejectionCode: row[4] as string | null,
    };
  }
  replay(
    owner: string,
    op: string,
    key: string,
    digest: string,
  ): Promise<ScoreInputAttempt | null> {
    return this.read(owner, (tx) => this.replayIn(tx, owner, op, key, digest));
  }
  private async appendState(
    tx: NativeSqlTransaction,
    c: ScoreInputContext,
    s: ScoreInputState,
    now: bigint,
  ): Promise<void> {
    try {
      assertScoreInputState(s);
    } catch (e) {
      classify(e);
    }
    await tx.query(
      `INSERT INTO jungsi_backend.score_input_states
   (owner_id,input_scope,stage,version,initial_attempt_id,correction_grant_id,correction_attempt_id,current_profile_id,last_attempt_id,last_outcome,last_rejection_code,policy_version,rollout_id,approval_sha256,preview_exempt,created_at)
   VALUES($1,$2,$3,$4::bigint,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz)`,
      [
        ...params(c),
        String(s.version),
        s.initialAttemptId,
        s.correctionGrantId,
        s.correctionAttemptId,
        s.currentProfileId,
        s.lastAttemptId,
        s.lastOutcome,
        s.lastRejectionCode,
        c.stage.policyVersion,
        c.stage.rolloutId,
        c.stage.approvalSha256,
        c.previewExempt,
        utcText(now),
      ],
    );
  }
  private async attempt(
    c: ScoreInputContext,
    input: {
      operation: "score-profile.create" | "overall.profile";
      key: string;
      digest: string;
      nowUtc: bigint;
    },
    profile: ProfileWrite | null,
    code: string | null,
  ): Promise<ScoreInputAttempt> {
    const tx = this.active;
    if (!tx) throw new AccessError("score_input_acceptance_unavailable", 503);
    await lock(tx, c.owner, input.operation, input.key);
    const prior = await this.replayIn(tx, c.owner, input.operation, input.key, input.digest);
    if (prior) return prior;
    await lock(tx, c.owner, c.stage.scopeId, c.stage.stage);
    const before = await this.stateIn(tx, c);
    const attemptId = this.id("entry-");
    let saved: StoredProfile | null = null;
    // Rights exhaustion is checked before writing any profile. The state lock serializes distinct keys.
    try {
      consumeScoreInput(
        before,
        attemptId,
        profile ? "pending-profile" : null,
        c.previewExempt,
        code,
      );
    } catch (e) {
      classify(e);
    }
    if (profile) saved = await this.platform.createProfileInTransaction(tx, profile);
    let state: ScoreInputState;
    try {
      state = consumeScoreInput(
        before,
        attemptId,
        saved?.profile_id ?? null,
        c.previewExempt,
        code,
      );
    } catch (e) {
      classify(e);
    }
    await this.appendState(tx, c, state, input.nowUtc);
    const outcome = saved ? "accepted" : "rejected";
    await tx.query(
      `INSERT INTO jungsi_backend.score_input_attempts
   (attempt_id,owner_id,input_scope,stage,state_version,exam_id,pack_version,operation,request_key,request_digest,outcome,profile_id,rejection_code,origin_kind,preview_exempt,policy_version,occurred_at)
   VALUES($1,$2,$3,$4,$5::bigint,$6,$7,$8,$9,$10,$11,$12,$13,'new',$14,$15,$16::timestamptz)`,
      [
        attemptId,
        ...params(c),
        String(state.version),
        c.stage.examId,
        c.stage.packVersion,
        input.operation,
        input.key,
        input.digest,
        outcome,
        saved?.profile_id ?? null,
        code,
        c.previewExempt,
        c.stage.policyVersion,
        utcText(input.nowUtc),
      ],
    );
    if (outcome === "rejected") this.rejectedCode = code;
    return {
      attemptId,
      owner: c.owner,
      operation: input.operation,
      key: input.key,
      digest: input.digest,
      state,
      outcome,
      profile: saved,
      context: c,
      rejectionCode: code,
    };
  }
  commitProfile(c: ScoreInputContext, p: ProfileWrite): Promise<ScoreInputAttempt> {
    if (p.owner !== c.owner) invalid();
    return this.attempt(c, { ...p, operation: p.operation ?? "score-profile.create" }, p, null);
  }
  commitRejection(
    c: ScoreInputContext,
    input: Parameters<ScoreInputRepositoryPort["commitRejection"]>[1],
  ): Promise<ScoreInputAttempt> {
    return this.attempt(c, input, null, input.code);
  }
  async profileContext(owner: string, pid: string): Promise<ScoreInputContext | null> {
    return await this.read(owner, async (tx) => {
      const row = one(
        await tx.query(
          `SELECT a.exam_id,a.stage,a.input_scope FROM jungsi_backend.score_input_attempts a
    WHERE a.owner_id=$1 AND a.profile_id=$2 AND a.outcome='accepted'`,
          [owner, text(pid)],
        ),
        3,
      );
      if (!row) return null;
      const stage = this.policy.stage(row[0], row[1], this.clock.nowUtc(), false);
      if (stage.scopeId !== row[2]) invalid();
      return { owner, stage, previewExempt: false };
    });
  }
  async currentReport(owner: string, pid: string): Promise<StoredReport | null> {
    return await this.read(
      owner,
      (tx) => this.platform.latestReportInTransaction(tx, owner, text(pid)),
    );
  }
  async profileConsumed(owner: string, pid: string): Promise<boolean> {
    return (await this.profileContext(owner, pid)) !== null;
  }
  async grantCorrection(command: ScoreCorrectionCommand): Promise<ScoreCorrectionReceipt> {
    const c: ScoreInputContext = {
      owner: identity(command.owner),
      stage: command.stage,
      previewExempt: false,
    };
    identity(command.actor);
    text(command.key);
    text(command.ticketRef);
    if (!HASH.test(command.digest)) invalid();
    return await this.sql.write(command.actor, async (tx) => {
      await lock(tx, command.actor, "score-input.correction.grant", command.key);
      const previous = one(
        await tx.query(
          `SELECT command_id,ticket_ref,request_digest,owner_id,input_scope,stage,granted_version::text
    FROM jungsi_backend.score_input_corrections WHERE actor_id=$1 AND request_key=$2`,
          [command.actor, command.key],
        ),
        7,
      );
      if (previous) {
        if (
          previous[2] !== command.digest || previous[3] !== c.owner ||
          previous[4] !== c.stage.scopeId || previous[5] !== c.stage.stage
        ) throw new AccessError("idempotency_conflict", 409);
        return {
          commandId: text(previous[0]),
          ticketRef: text(previous[1]),
          state: await this.stateIn(tx, c, number(previous[6])),
        };
      }
      await lock(tx, "score-correction-ticket", command.ticketRef);
      await lock(tx, c.owner, c.stage.scopeId, c.stage.stage);
      if (
        one(
          await tx.query(
            "SELECT command_id FROM jungsi_backend.score_input_corrections WHERE ticket_ref=$1",
            [command.ticketRef],
          ),
          1,
        )
      ) throw new AccessError("score_correction_unavailable", 409);
      const before = await this.stateIn(tx, c), commandId = this.id("correction-");
      let state: ScoreInputState;
      try {
        state = grantScoreCorrection(before, commandId, command.expectedVersion);
      } catch (e) {
        classify(e);
      }
      if (before.lastAttemptId === null) invalid();
      await this.appendState(tx, c, state, command.nowUtc);
      await tx.query(
        `INSERT INTO jungsi_backend.score_input_corrections
    (command_id,actor_id,owner_id,input_scope,stage,ticket_ref,expected_version,granted_version,reason_code,request_key,request_digest,previous_attempt_id,policy_version,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::bigint,$8::bigint,$9,$10,$11,$12,$13,$14::timestamptz)`,
        [
          commandId,
          command.actor,
          ...params(c),
          command.ticketRef,
          String(command.expectedVersion),
          String(state.version),
          command.reasonCode,
          command.key,
          command.digest,
          before.lastAttemptId,
          c.stage.policyVersion,
          utcText(command.nowUtc),
        ],
      );
      return { commandId, ticketRef: command.ticketRef, state };
    });
  }
  async snapshotScope(owner: string, rid: string, revision: number): Promise<SavedSnapshotScope> {
    return await this.read(owner, async (tx) => {
      const rows = await tx.query(
        `SELECT DISTINCT component_key FROM jungsi_backend.score_result_origins WHERE owner_id=$1 AND report_id=$2 AND revision<=$3::bigint`,
        [owner, text(rid), String(revision)],
      );
      if (
        !Array.isArray(rows) ||
        rows.some((r) => !Array.isArray(r) || r.length !== 1 || typeof r[0] !== "string")
      ) invalid();
      const keys = rows.map((r) => r[0] as string);
      const legacy = one(
        await tx.query(
          `SELECT l.saved_snapshot_basis,
       (SELECT COALESCE(jsonb_agg(key),'[]'::jsonb)::text FROM jsonb_object_keys(v.body->'analyses') AS a(key)),
       COALESCE(jsonb_typeof(v.body->'candidates')='object',false)
       FROM jungsi_backend.report_revisions v
       JOIN jungsi_backend.score_input_legacy_links l ON l.profile_id=v.profile_id AND l.owner_id=v.owner_id
       JOIN jungsi_backend.score_policy_rollouts r ON r.rollout_id=l.rollout_id AND r.status='validated'
       WHERE v.owner_id=$1 AND v.report_id=$2 AND v.revision=$3::bigint`,
          [owner, rid, String(revision)],
        ),
        3,
      );
      const legacyVerified = legacy !== null &&
        ["verified_admin", "verified_customer_pass"].includes(String(legacy[0]));
      const ids = keys.filter((k) => k.startsWith("analysis:")).map((k) => k.slice(9));
      if (legacyVerified) {
        for (const id of sqlArrayText(legacy![1])) ids.push(text(id));
        if (typeof legacy![2] !== "boolean") invalid();
      }
      return {
        overall: keys.includes("overall") || legacyVerified,
        analysisIds: [...new Set(ids)],
        candidates: keys.includes("candidates") || legacyVerified && legacy![2] === true,
        legacyVerified,
      };
    });
  }
  async firstPaidResult(owner: string, passId: string): Promise<string | null> {
    return await this.read(owner, async (tx) => {
      if (!/^[1-9][0-9]*$/.test(passId)) invalid();
      const row = one(
        await tx.query(
          `SELECT to_char(u.first_result_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
   FROM jungsi_backend.paid_result_first_use u JOIN public.jeongsi_passes p ON p.id=u.pass_id AND p.user_id::text=u.owner_id
   WHERE u.owner_id=$1 AND u.pass_id=$2::bigint`,
          [owner, passId],
        ),
        1,
      );
      return row ? sqlUtcText(row[0]) : null;
    });
  }
  async recordDelivered(input: PaidResultDelivery): Promise<void> {
    identity(input.owner);
    text(input.reportId);
    if (
      !/^[a-f0-9]{32}$/.test(input.requestId) || !Number.isSafeInteger(input.revision) ||
      input.revision < 1 || input.tokenExpiresAtUtc <= input.nowUtc
    ) throw new AccessError("authentication_required", 401);
    const paid = ["overall.analyze", "university.analyze", "candidates.build"].includes(
      input.operation,
    );
    if (!paid && !["report.read", "report.export"].includes(input.operation)) invalid();
    if (paid && input.accessPassId === null) return; // Verified administrator result, with no financial pass.
    if (input.accessPassId !== null && !/^[1-9][0-9]*$/.test(input.accessPassId)) invalid();
    if (!input.componentKeys.length) return;
    await this.sql.write(input.owner, async (tx) => {
      const row = one(
        await tx.query(
          `WITH origins AS MATERIALIZED (
       SELECT DISTINCT ON(component_key) origin_id,pass_id,source_operation,component_key
       FROM jungsi_backend.score_result_origins WHERE owner_id=$1 AND report_id=$2 AND revision<=$3::bigint
       AND component_key IN(SELECT jsonb_array_elements_text($4::jsonb))
       AND EXISTS(SELECT 1 FROM jungsi_backend.report_revisions v WHERE v.report_id=$2 AND v.owner_id=$1 AND v.revision=$3::bigint)
       ORDER BY component_key,revision DESC
      ), targets AS MATERIALIZED (
       SELECT CASE WHEN $6::boolean THEN $5::bigint ELSE o.pass_id END AS pass_id,o.origin_id,o.source_operation,o.component_key FROM origins o
      ), wanted AS MATERIALIZED (SELECT DISTINCT pass_id FROM targets WHERE pass_id IS NOT NULL),
      eligible AS MATERIALIZED (
       SELECT DISTINCT ON(t.pass_id) t.pass_id,t.origin_id,t.source_operation FROM targets t
       JOIN public.jeongsi_passes p ON p.id=t.pass_id AND p.user_id::text=$1
       WHERE NOT $6::boolean OR (p.revoked_at IS NULL AND p.starts_at<=$10::timestamptz AND p.ends_at>$10::timestamptz)
       ORDER BY t.pass_id,t.component_key
      ), inserted AS (
       INSERT INTO jungsi_backend.paid_result_first_use
        (pass_id,owner_id,origin_id,source_operation,access_operation,usage_basis,delivery_request_id)
       SELECT e.pass_id,$1,e.origin_id,e.source_operation,$7,$8,$9 FROM eligible e
       ON CONFLICT(pass_id) DO NOTHING RETURNING pass_id,owner_id
      ), recorded AS (
       SELECT i.pass_id FROM inserted i WHERE i.owner_id=$1
       UNION SELECT u.pass_id FROM jungsi_backend.paid_result_first_use u JOIN wanted w ON u.pass_id=w.pass_id WHERE u.owner_id=$1
      ) SELECT (SELECT count(*) FROM origins)::text,(SELECT count(*) FROM wanted)::text,
       (SELECT count(*) FROM eligible)::text,(SELECT count(*) FROM recorded)::text`,
          [
            input.owner,
            input.reportId,
            String(input.revision),
            JSON.stringify(input.componentKeys),
            input.accessPassId,
            paid,
            input.operation,
            paid ? "current_paid_operation" : "pending_original_delivery",
            input.requestId,
            utcText(input.nowUtc),
          ],
        ),
        4,
      );
      if (!row) invalid();
      const counts = row.map((v) => sqlIntegerText(v));
      if (counts.some((v) => typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) invalid();
      if (paid && counts[0] === 0 || counts[1] !== counts[2] || counts[1] !== counts[3]) {
        throw new AccessError("paid_delivery_provenance_unavailable", 503);
      }
    });
  }
}
