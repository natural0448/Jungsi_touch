/** Bounded own-report summaries; stage/current requires an approved input transition. */
import { AccessError } from "../application/access.ts";
import type { ApprovedOperatingPolicy } from "../application/operating_policy.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { SCORE_INPUT_STAGES, type ScoreInputStage } from "../domain/score_input_rights.ts";
import type { OwnReportListPort, OwnReportListRow } from "../application/own_report_list.ts";
import { OWN_REPORT_LIST_MAX_LIMIT } from "../application/own_report_list.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { sqlIntegerText, sqlUtcText } from "./sql_values.ts";
import {
  type ApprovedProfileStage,
  approvedProfileStages,
  SCORE_INPUT_ROLLOUT_VALID_SQL,
  SCORE_INPUT_UNMAPPED_PROFILE_SQL,
} from "./score_input_postgres.ts";
import type { SupabaseSqlTransport } from "./transaction_sql.ts";

const PAGE_SQL = `WITH page AS MATERIALIZED (
 SELECT r.report_id,r.owner_id,r.profile_id,r.revision,r.updated_at,p.owner_id AS profile_owner,
  p.scores->>'exam_id' AS exam_id
 FROM jungsi_backend.reports r
 JOIN jungsi_backend.profiles p ON (r.profile_id,r.owner_id)=(p.profile_id,p.owner_id)
 WHERE r.owner_id=$1 AND p.owner_id=$1
 AND ($2::text IS NULL OR p.scores->>'exam_id'=$2)
 AND r.updated_at<=$3::timestamptz
 AND ($4::timestamptz IS NULL OR (r.updated_at,r.report_id COLLATE "C")<($4::timestamptz,$5::text COLLATE "C"))
 ORDER BY r.updated_at DESC,r.report_id COLLATE "C" DESC LIMIT $6::integer
)`;
/** The old read-only list remains available when the input policy is not activated. */
export const OWN_REPORT_LIST_UNVERIFIED_SQL = `${PAGE_SQL}
 SELECT r.report_id,r.owner_id,r.profile_owner,r.exam_id,r.revision::text,
 to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 NULL::text,NULL::boolean,true,NULL::text,NULL::text,NULL::text,NULL::text
 FROM page r ORDER BY r.updated_at DESC,r.report_id COLLATE "C" DESC`;
export const OWN_REPORT_LIST_SQL = `${PAGE_SQL}
 SELECT r.report_id,r.owner_id,r.profile_owner,r.exam_id,r.revision::text,
 to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 m.stage,
 CASE WHEN m.stage IS NULL OR s.current_profile_id IS NULL THEN NULL
      WHEN r.profile_id<>s.current_profile_id THEN false
      WHEN current_report.report_id IS NULL THEN NULL
      ELSE r.report_id=current_report.report_id END,
 (a.profile_id IS NULL OR l.profile_id IS NULL OR
  (a.input_scope=l.input_scope AND a.stage=l.stage)),m.input_scope,a.exam_id,
 cp.scores->>'exam_id',current_setting('transaction_isolation')
 FROM page r
 LEFT JOIN jungsi_backend.score_input_attempts a ON a.owner_id=r.owner_id
  AND a.profile_id=r.profile_id AND a.outcome='accepted'
 LEFT JOIN jungsi_backend.score_input_legacy_links l ON l.owner_id=r.owner_id
  AND l.profile_id=r.profile_id
 CROSS JOIN LATERAL (SELECT COALESCE(a.input_scope,l.input_scope) AS input_scope,
  COALESCE(a.stage,l.stage) AS stage) m
 LEFT JOIN LATERAL (SELECT s0.current_profile_id FROM jungsi_backend.score_input_states s0
  WHERE s0.owner_id=r.owner_id AND s0.input_scope=m.input_scope AND s0.stage=m.stage
  ORDER BY s0.version DESC LIMIT 1) s ON true
 LEFT JOIN jungsi_backend.profiles cp ON cp.owner_id=r.owner_id
  AND cp.profile_id=s.current_profile_id
 LEFT JOIN LATERAL (SELECT cr.report_id FROM jungsi_backend.reports cr
  JOIN jungsi_backend.report_revisions cv ON (cr.report_id,cr.revision,cr.owner_id)=
   (cv.report_id,cv.revision,cv.owner_id)
  WHERE cr.owner_id=r.owner_id AND cr.profile_id=s.current_profile_id
  ORDER BY cr.updated_at DESC,cr.report_id DESC LIMIT 1) current_report ON true
 ORDER BY r.updated_at DESC,r.report_id COLLATE "C" DESC`;
/** Same rollout and full-alias legacy guard as score-input status, once per page. */
export const OWN_REPORT_SCOPE_GUARD_SQL = `WITH scopes AS MATERIALIZED (
 SELECT x.input_scope,x.stage,x.rollout_id,x.policy_version,x.approval_sha256,x.exam_ids,x.stage_mappings
 FROM jsonb_to_recordset($2::jsonb) AS x(input_scope text,stage text,rollout_id text,
  policy_version text,approval_sha256 text,exam_ids jsonb,stage_mappings jsonb)
)
 SELECT g.input_scope,g.stage,
 ${SCORE_INPUT_ROLLOUT_VALID_SQL},
 NOT ${SCORE_INPUT_UNMAPPED_PROFILE_SQL}
 FROM (SELECT $1::text AS owner_id,s.*,true AS has_state,$3::timestamptz AS evaluated_at,
  $4::timestamptz AS policy_expires_at,$5::text AS policy_semantics_sha256 FROM scopes s) g`;

function invalid(): never {
  throw new AccessError("storage_result_invalid", 503);
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An overlarge policy is unknown, not a reason to truncate the checked alias set.
const MAX_GUARD_EXAMS = 256, MAX_GUARD_BYTES = 65536;
type Guard = {
  input_scope: string;
  stage: ScoreInputStage;
  rollout_id: string;
  policy_version: string;
  approval_sha256: string;
  exam_ids: readonly string[];
  stage_mappings: readonly ApprovedProfileStage[];
};
type Candidate = {
  readonly row: OwnReportListRow;
  readonly candidateCurrent: boolean | null;
  readonly scope: string | null;
  readonly attemptExam: string | null;
  readonly currentExam: string | null;
};
const scopeKey = (scope: string, stage: string) => `${scope}\0${stage}`;
export class SupabaseOwnReportList implements OwnReportListPort {
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly policy: ApprovedOperatingPolicy | null,
    private readonly clock: RequestClockPort,
  ) {}
  async read(
    input: Parameters<OwnReportListPort["read"]>[0],
  ): Promise<readonly OwnReportListRow[]> {
    if (
      !input || !UUID.test(input.owner) || input.examId !== null && !ID.test(input.examId) ||
      typeof input.asOfUtc !== "bigint" || !Number.isSafeInteger(input.take) || input.take < 1 ||
      input.take > OWN_REPORT_LIST_MAX_LIMIT + 1 ||
      input.after !== null &&
        (typeof input.after.updatedAtUtc !== "bigint" || !ID.test(input.after.reportId))
    ) invalid();
    const policy = this.policy;
    if (policy) policy.assertLive(this.clock.nowUtc());
    return await this.sql.read(input.owner, async (tx) => {
      const rows = await tx.query(policy ? OWN_REPORT_LIST_SQL : OWN_REPORT_LIST_UNVERIFIED_SQL, [
        input.owner,
        input.examId,
        utcText(input.asOfUtc),
        input.after ? utcText(input.after.updatedAtUtc) : null,
        input.after?.reportId ?? null,
        input.take,
      ]);
      if (!Array.isArray(rows) || rows.length > input.take) invalid();
      const candidates: Candidate[] = rows.map((row) => {
        if (
          !Array.isArray(row) || row.length !== 13 || row[1] !== input.owner ||
          row[2] !== input.owner ||
          typeof row[0] !== "string" || !ID.test(row[0]) ||
          row[3] !== null && (typeof row[3] !== "string" || !ID.test(row[3])) ||
          row[6] !== null && (typeof row[6] !== "string" ||
              !SCORE_INPUT_STAGES.includes(row[6] as ScoreInputStage)) ||
          row[7] !== null && typeof row[7] !== "boolean" ||
          row[6] === null && row[7] !== null || row[8] !== true ||
          row[9] !== null && (typeof row[9] !== "string" || !ID.test(row[9])) ||
          row[10] !== null && (typeof row[10] !== "string" || !ID.test(row[10])) ||
          row[11] !== null && (typeof row[11] !== "string" || !ID.test(row[11])) ||
          (row[6] === null) !== (row[9] === null) ||
          row[6] === null && (row[10] !== null || row[11] !== null) ||
          policy && row[12] !== "repeatable read" && row[12] !== "serializable" ||
          !policy && row[12] !== null
        ) invalid();
        const revision = BigInt(sqlIntegerText(row[4]));
        if (revision < 1n || revision > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
        return {
          row: {
            reportId: row[0],
            reportOwner: input.owner,
            profileOwner: input.owner,
            examId: row[3],
            stage: row[6] as ScoreInputStage | null,
            isCurrent: null,
            revision: Number(revision),
            updatedAtUtc: utcInstant(sqlUtcText(row[5])),
          },
          candidateCurrent: row[7] as boolean | null,
          scope: row[9] as string | null,
          attemptExam: row[10] as string | null,
          currentExam: row[11] as string | null,
        };
      });
      if (!policy) return candidates.map((c) => c.row);
      const guards = new Map<string, Guard>();
      const candidateKeys = new Map<Candidate, string>();
      for (const c of candidates) {
        const { examId, stage } = c.row;
        if (
          examId === null || stage === null || c.scope === null || c.candidateCurrent === null ||
          c.currentExam !== examId || c.attemptExam !== null && c.attemptExam !== examId
        ) continue;
        try {
          const selected = policy.stage(examId, stage, this.clock.nowUtc(), false);
          if (selected.scopeId !== c.scope) continue;
          if (
            c.attemptExam !== null &&
            policy.stage(c.attemptExam, stage, this.clock.nowUtc(), false).scopeId !== c.scope
          ) {
            continue;
          }
          const key = scopeKey(c.scope, stage), exams = policy.scopeExams(c.scope, stage);
          if (
            !exams.length || exams.length > MAX_GUARD_EXAMS ||
            exams.some((exam) => !ID.test(exam)) || new Set(exams).size !== exams.length ||
            !exams.includes(examId) || c.attemptExam !== null && !exams.includes(c.attemptExam)
          ) continue;
          guards.set(key, {
            input_scope: c.scope,
            stage,
            rollout_id: selected.rolloutId,
            policy_version: selected.policyVersion,
            approval_sha256: selected.approvalSha256,
            exam_ids: exams,
            stage_mappings: approvedProfileStages(policy, exams, this.clock.nowUtc()),
          });
          candidateKeys.set(c, key);
        } catch (error) {
          if (
            !(error instanceof AccessError) ||
            !["score_stage_unavailable", "score_input_transition_pending"].includes(error.code)
          ) throw error;
        }
      }
      const encoded = JSON.stringify([...guards.values()]);
      if (!guards.size || new TextEncoder().encode(encoded).byteLength > MAX_GUARD_BYTES) {
        policy.assertLive(this.clock.nowUtc());
        return candidates.map((c) => c.row);
      }
      const now = this.clock.nowUtc();
      policy.assertLive(now);
      const semantics = await policy.renewalSemanticsSha256();
      const guardRows = await tx.query(OWN_REPORT_SCOPE_GUARD_SQL, [
        input.owner,
        encoded,
        utcText(now),
        utcText(policy.expiresAtUtc),
        semantics,
      ]);
      if (!Array.isArray(guardRows) || guardRows.length !== guards.size) invalid();
      const verified = new Map<string, boolean>();
      for (const guard of guardRows) {
        if (
          !Array.isArray(guard) || guard.length !== 4 || typeof guard[0] !== "string" ||
          typeof guard[1] !== "string" || typeof guard[2] !== "boolean" ||
          typeof guard[3] !== "boolean"
        ) invalid();
        const key = scopeKey(guard[0], guard[1]);
        if (!guards.has(key) || verified.has(key)) invalid();
        verified.set(key, guard[2] && guard[3]);
      }
      policy.assertLive(this.clock.nowUtc());
      return candidates.map((c) => {
        const key = candidateKeys.get(c);
        return key && verified.get(key) === true
          ? { ...c.row, isCurrent: c.candidateCurrent }
          : c.row;
      });
    });
  }
}
