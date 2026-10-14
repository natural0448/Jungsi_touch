/** Existing forecast tables: current school authority in every payload/write SQL, atomic CAS and replay. */
import { AccessError } from "../application/access.ts";
import type {
  ForecastDraftScope,
  ForecastRepositoryPort,
  ForecastTransactionPort,
} from "../application/forecast_ports.ts";
import {
  MANAGEMENT_OPERATIONS,
  type ManagementDecision,
  type ManagementOperation,
  requireManagementUniversity,
} from "../application/management_access.ts";
import type { ForecastAuthorityState } from "../application/ports.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { nativeJsonbText } from "./jsonb_value.ts";
import {
  FORECAST_AUTHORITY_SQL,
  FORECAST_SCOPE_SQL,
  forecastAuthorityState,
} from "./management_postgres.ts";
import { sqlIntegerText, sqlObjectText, sqlUtcText } from "./sql_values.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  HASH = /^[0-9a-f]{64}$/;
const time = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function gate(subject: string, school: string, role: string): string {
  return `EXISTS(SELECT 1 FROM jungsi_backend.forecast_authorities a
 WHERE a.subject_id=${subject} AND a.university_id=${school} AND
 CASE ${role}::text WHEN 'approve' THEN a.can_approve WHEN 'edit' THEN a.can_edit ELSE (a.can_edit OR a.can_approve) END)`;
}
function editorForSelfApproval(body: string, actor: string, university: string): string {
  return `((${body})->>'status' IS DISTINCT FROM 'approved'
 OR NOT COALESCE(((${body})->'contributors') ? ${actor}::text,false)
 OR ${gate(actor, university, "'edit'")})`;
}
const SCHOOL = "d.body->'context'->>'university_id'";
export const FORECAST_DRAFT_READ_SQL = `SELECT d.draft_id,d.revision::text,d.body::text,${
  time("d.updated_at")
}
 FROM jungsi_backend.forecast_drafts d WHERE d.draft_id=$1
 AND ${SCHOOL} IN(SELECT jsonb_array_elements_text($3::text::jsonb)) AND ${
  gate("$2", SCHOOL, "$4")
}`;
export const FORECAST_DRAFT_LIST_SQL = `SELECT d.draft_id,d.revision::text,d.body::text,${
  time("d.updated_at")
}
 FROM jungsi_backend.forecast_drafts d WHERE ${SCHOOL} IN(SELECT jsonb_array_elements_text($2::text::jsonb))
 AND ($3::text IS NULL OR ${SCHOOL}=$3) AND ${gate("$1", SCHOOL, "'read'")}
 ORDER BY d.draft_id COLLATE "C" LIMIT $4`;
export const FORECAST_DRAFT_SCOPE_LOCK_SQL = FORECAST_SCOPE_SQL + " FOR UPDATE";
export const FORECAST_CURRENT_SCHOOL_SQL = `SELECT ${gate("$1", "$2", "$3")}`;
export const FORECAST_DRAFT_INSERT_SQL =
  `INSERT INTO jungsi_backend.forecast_drafts(draft_id,revision,body,updated_at)
 SELECT $1,$2::bigint,$3::jsonb,$4::timestamptz WHERE ${gate("$5", "$6", "$7")}
 AND ${editorForSelfApproval("$3::jsonb", "$5", "$6")} RETURNING draft_id`;
export const FORECAST_DRAFT_UPDATE_SQL =
  `UPDATE jungsi_backend.forecast_drafts d SET revision=$1::bigint,body=$2::jsonb,updated_at=$3::timestamptz
 WHERE d.draft_id=$4 AND d.revision=$5::bigint AND ${SCHOOL}=$7 AND ${gate("$6", "$7", "$8")} AND ${
    editorForSelfApproval("$2::jsonb", "$6", "$7")
  } RETURNING d.draft_id`;
export const FORECAST_REVISION_INSERT_SQL =
  `INSERT INTO jungsi_backend.forecast_revisions(draft_id,revision,body,created_at)
 SELECT $1,$2::bigint,$3::jsonb,$4::timestamptz WHERE ${gate("$5", "$6", "$7")}
 AND ${editorForSelfApproval("$3::jsonb", "$5", "$6")}
 AND EXISTS(SELECT 1 FROM jungsi_backend.forecast_drafts d WHERE d.draft_id=$1 AND d.revision=$2::bigint AND ${SCHOOL}=$6)
 RETURNING revision::text`;
export const FORECAST_REQUEST_SCOPE_SQL =
  `SELECT request_hash,jsonb_typeof(result),jsonb_typeof(result->'context'),
 jsonb_typeof(result->'context'->'university_id'),result->'context'->>'university_id'
 FROM jungsi_backend.forecast_requests WHERE subject_id=$1 AND operation=$2 AND request_key=$3`;
export const FORECAST_REQUEST_READ_SQL =
  `SELECT r.result::text FROM jungsi_backend.forecast_requests r
 WHERE r.subject_id=$1 AND r.operation=$2 AND r.request_key=$3 AND r.result->'context'->>'university_id'=$4
 AND ${gate("$1", "$4", "$5")}`;
export const FORECAST_REQUEST_INSERT_SQL =
  `INSERT INTO jungsi_backend.forecast_requests(subject_id,operation,request_key,request_hash,result,created_at)
 SELECT $1,$2,$3,$4,$5::jsonb,$6::timestamptz WHERE ${
    gate("$1", "$7", "$8")
  } RETURNING request_hash`;
function approvalPolicyProvenance(release: string, parent: string): string {
  const r = `(${release})`, p = `(${parent})`;
  const contributor =
    `EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${p}->'contributors')='array' THEN ${p}->'contributors' ELSE '[]'::jsonb END) contributor(actor)
 WHERE contributor.actor=${p}->'approval'->>'actor')`;
  return `jsonb_typeof(${p}->'approval'->'require_independent_approver')='boolean'
 AND ${p}->'approval'->'require_independent_approver'=${r}->'require_independent_approver'
 AND ${p}->>'policy_hash'=${r}->>'policy_hash'
 AND ${p}->'approval'->>'policy_hash'=${r}->>'policy_hash'
 AND jsonb_typeof(${p}->'approval'->'actor')='string' AND ${p}->'approval'->>'actor'<>''
 AND jsonb_typeof(${p}->'contributors')='array'
 AND ((${p}->'approval'->'require_independent_approver'='false'::jsonb AND (NOT ${contributor}
 OR (${p}->'approval'->'authority_verification'->>'university_id'=${p}->'context'->>'university_id'
 AND ${p}->'approval'->'authority_verification'->'checked_capabilities'='["editor","approver"]'::jsonb
 AND jsonb_typeof(${p}->'approval'->'authority_verification'->'at')='string'
 AND ${p}->'approval'->'authority_verification'->>'at'=${p}->'approval'->>'at')))
 OR (${p}->'approval'->'require_independent_approver'='true'::jsonb AND NOT ${contributor})) `;
}
/** Boolean provenance is additionally matched to the verified immutable policy in application. */
export const FORECAST_APPROVAL_POLICY_PROVENANCE_SQL = approvalPolicyProvenance("f.body", "v.body");
const PROVENANCE = `EXISTS(SELECT 1 FROM jungsi_backend.forecast_revisions v
 WHERE v.draft_id=f.body->>'draft_id' AND v.revision::text=f.body->>'draft_revision'
 AND v.body->>'status'='approved' AND v.body->'approval'->>'approval_hash'=f.body->>'approval_hash'
 AND v.body->'validation'->>'receipt_hash'=f.body->>'validation_hash' AND v.body->'validation'->>'status'='passed'
 AND v.body->'approval'->>'validation_hash'=v.body->'validation'->>'receipt_hash'
 AND v.body->'approval'->>'result_hash'=v.body->'validation'->>'result_hash'
 AND ${FORECAST_APPROVAL_POLICY_PROVENANCE_SQL}
 AND v.body->'context'=f.body->'context' AND v.body->'result'=f.body->'result' AND v.body->'base_result'=f.body->'base_result')`;
export const FORECAST_PUBLISHED_MANY_SQL =
  `WITH selected AS(SELECT jsonb_array_elements_text($1::text::jsonb) AS offering_id)
 SELECT DISTINCT ON(f.offering_id COLLATE "C") f.offering_id,f.release_id,f.body::text,${
    time("f.published_at")
  },${PROVENANCE}
 FROM jungsi_backend.forecast_releases f JOIN selected s ON s.offering_id=f.offering_id
 ORDER BY f.offering_id COLLATE "C",f.published_at DESC,f.release_id COLLATE "C" DESC`;
export const FORECAST_PUBLISH_INSERT_SQL =
  `INSERT INTO jungsi_backend.forecast_releases(release_id,offering_id,body,published_at)
 SELECT $1,$2,$3::jsonb,$4::timestamptz WHERE ${gate("$5", "$6", "'approve'")}
 AND EXISTS(SELECT 1 FROM jungsi_backend.forecast_revisions v WHERE v.draft_id=$7 AND v.revision=$8::bigint
 AND v.body->>'status'='approved' AND v.body->'context'->>'university_id'=$6
 AND v.body->'approval'->>'approval_hash'=$9 AND v.body->'validation'->>'receipt_hash'=$10
 AND ${approvalPolicyProvenance("$3::jsonb", "v.body")})
 RETURNING release_id`;
const LOCK_SQL = "SELECT pg_advisory_xact_lock($1::bigint)";
function fail(code = "forecast_release_invalid", http = 503): never {
  throw new AccessError(code, http);
}
function id(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) fail("invalid_identifier", 422);
  return v;
}
function subject(v: string): string {
  if (typeof v !== "string" || !UUID.test(v)) fail("storage_identity_invalid");
  return v;
}
function school(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 128 || v.trim() !== v) fail();
  return v;
}
function revision(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) fail();
  return v;
}
function one(rows: unknown[][], length: number): unknown[] | null {
  if (
    !Array.isArray(rows) || rows.length > 1 ||
    rows.some((r) => !Array.isArray(r) || r.length !== length)
  ) fail();
  return rows[0] ?? null;
}
function role(operation: ManagementOperation): "read" | "edit" | "approve" {
  return operation === "forecast.approve" || operation === "forecast.publish"
    ? "approve"
    : operation === "forecast.list" || operation === "forecast.read" ||
        operation === "forecast.capabilities"
    ? "read"
    : "edit";
}
function decision(d: ManagementDecision, actor: string, operation?: ManagementOperation): void {
  if (
    !d || d.subjectId !== actor || !MANAGEMENT_OPERATIONS.includes(d.operation) ||
    operation !== undefined && d.operation !== operation ||
    !Array.isArray(d.universityIds) ||
    d.universityIds.some((x) => typeof x !== "string" || x.length < 1 || x.length > 128) ||
    new Set(d.universityIds).size !== d.universityIds.length
  ) fail();
}
async function scope(
  tx: NativeSqlTransaction,
  draftId: string,
  lock = false,
): Promise<ForecastDraftScope | null> {
  const r = one(
    await tx.query(lock ? FORECAST_DRAFT_SCOPE_LOCK_SQL : FORECAST_SCOPE_SQL, [id(draftId)]),
    7,
  );
  if (!r) return null;
  if (
    r[0] !== draftId || r[1] !== "object" || r[2] !== "object" || r[3] !== "string" ||
    r[5] !== "string" || r[6] !== draftId
  ) fail();
  return { draftId, universityId: school(r[4]) };
}
function draftRow(r: unknown[], max: number): NativeObject {
  const body = sqlObjectText(r[2], max),
    context = body.context,
    version = revision(sqlIntegerText(r[1]));
  if (
    context === null || typeof context !== "object" || Array.isArray(context) ||
    context instanceof JsonFloat
  ) fail();
  if (
    body.draft_id !== r[0] || revision(body.revision) !== version ||
    typeof body.updated_at !== "string" ||
    utcInstant(body.updated_at) !== utcInstant(sqlUtcText(r[3]))
  ) fail();
  id(body.draft_id);
  school(context.university_id);
  return body;
}
async function active(
  tx: NativeSqlTransaction,
  actor: string,
  university: string,
  permission: string,
): Promise<boolean> {
  const r = one(await tx.query(FORECAST_CURRENT_SCHOOL_SQL, [actor, university, permission]), 1);
  if (!r || typeof r[0] !== "boolean") fail();
  return r[0];
}
export interface ForecastSqlLimits {
  readonly maxRecordBytes: number;
  readonly maxListRows: number;
  readonly maxBatchIds: number;
}
export class SupabaseForecastRepository implements ForecastRepositoryPort {
  private readonly limits: ForecastSqlLimits;
  constructor(private readonly sql: SupabaseSqlTransport, limits: ForecastSqlLimits) {
    if (
      !limits ||
      [limits.maxRecordBytes, limits.maxListRows, limits.maxBatchIds].some((v) =>
        !Number.isSafeInteger(v) || v < 1 || v >= Number.MAX_SAFE_INTEGER
      )
    ) fail("storage_configuration_invalid");
    this.limits = Object.freeze({ ...limits });
  }
  async readCurrent(subjectId: string, nowUtc: bigint): Promise<ForecastAuthorityState> {
    subject(subjectId);
    return await this.sql.read(
      subjectId,
      async (tx) =>
        forecastAuthorityState(
          await tx.query(FORECAST_AUTHORITY_SQL, [subjectId]),
          subjectId,
          nowUtc,
        ),
    );
  }
  async draftScope(subjectId: string, draftId: string): Promise<ForecastDraftScope | null> {
    return await this.sql.read(subject(subjectId), (tx) => scope(tx, draftId));
  }
  private async readIn(
    tx: NativeSqlTransaction,
    actor: string,
    draftId: string,
    d: ManagementDecision,
  ): Promise<NativeObject | null> {
    decision(d, actor);
    const r = one(
      await tx.query(FORECAST_DRAFT_READ_SQL, [
        id(draftId),
        actor,
        nativeJsonbText([...d.universityIds], this.limits.maxRecordBytes),
        role(d.operation),
      ]),
      4,
    );
    if (!r) return null;
    const body = draftRow(r, this.limits.maxRecordBytes);
    requireManagementUniversity(d, school((body.context as NativeObject).university_id));
    return body;
  }
  async get(
    subjectId: string,
    draftId: string,
    d: ManagementDecision,
  ): Promise<NativeObject | null> {
    return await this.sql.read(subject(subjectId), (tx) => this.readIn(tx, subjectId, draftId, d));
  }
  async list(
    subjectId: string,
    d: ManagementDecision,
    university: string | null,
  ): Promise<readonly NativeObject[]> {
    subject(subjectId);
    decision(d, subjectId);
    return await this.sql.read(subjectId, async (tx) => {
      const rows = await tx.query(FORECAST_DRAFT_LIST_SQL, [
        subjectId,
        nativeJsonbText([...d.universityIds], this.limits.maxRecordBytes),
        university,
        this.limits.maxListRows + 1,
      ]);
      if (
        !Array.isArray(rows) || rows.length > this.limits.maxListRows ||
        rows.some((r) => !Array.isArray(r) || r.length !== 4)
      ) fail();
      return rows.map((r) => {
        const body = draftRow(r, this.limits.maxRecordBytes);
        requireManagementUniversity(d, school((body.context as NativeObject).university_id));
        return body;
      });
    });
  }
  async published(subjectId: string, offeringId: string): Promise<NativeObject | null> {
    const rows = await this.publishedMany(subjectId, [offeringId]), row = rows.get(offeringId)!;
    if (row instanceof AccessError) throw row;
    return row;
  }
  async publishedMany(
    subjectId: string,
    offeringIds: readonly string[],
  ): Promise<ReadonlyMap<string, NativeObject | AccessError | null>> {
    subject(subjectId);
    if (
      !Array.isArray(offeringIds) ||
      offeringIds.some((x) => typeof x !== "string" || x.trim() === "" || !ID.test(x))
    ) fail();
    const selected = [...new Set(offeringIds)];
    if (selected.length > this.limits.maxBatchIds) fail();
    if (!selected.length) return new Map();
    return await this.sql.read(subjectId, async (tx) => {
      const rows = await tx.query(FORECAST_PUBLISHED_MANY_SQL, [
        nativeJsonbText(selected, this.limits.maxRecordBytes),
      ]);
      if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r) || r.length !== 5)) fail();
      const result = new Map<string, NativeObject | AccessError | null>(
          selected.map((x) => [x, null]),
        ),
        found = new Set<string>();
      for (const r of rows) {
        if (typeof r[0] !== "string" || !result.has(r[0]) || found.has(r[0])) fail();
        found.add(r[0]);
        try {
          if (r[4] !== true) fail();
          const body = sqlObjectText(r[2], this.limits.maxRecordBytes);
          if (
            body.release_id !== r[1] || (body.context as NativeObject)?.offering_id !== r[0] ||
            typeof body.published_at !== "string" ||
            utcInstant(body.published_at) !== utcInstant(sqlUtcText(r[3]))
          ) fail();
          result.set(r[0], body);
        } catch (e) {
          result.set(
            r[0],
            e instanceof AccessError ? e : new AccessError("forecast_release_invalid", 503),
          );
        }
      }
      return result;
    });
  }
  async transact(
    actor: string,
    operation: ManagementOperation,
    key: string,
    requestHash: string,
    nowUtc: bigint,
    authorize: (store: ForecastTransactionPort) => Promise<ManagementDecision>,
    mutate: (store: ForecastTransactionPort, decision: ManagementDecision) => Promise<NativeObject>,
  ): Promise<NativeObject> {
    subject(actor);
    id(key);
    if (
      !MANAGEMENT_OPERATIONS.includes(operation) || !HASH.test(requestHash) ||
      typeof nowUtc !== "bigint"
    ) fail("storage_parameters_invalid");
    const now = utcText(nowUtc), permission = role(operation);
    if (permission === "read") fail("storage_parameters_invalid");
    return await this.sql.write(actor, async (tx) => {
      const bytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(actor + "\0" + operation + "\0" + key),
        ),
      );
      await tx.query(LOCK_SQL, [String(new DataView(bytes.buffer).getBigInt64(0, false))]);
      const store: ForecastTransactionPort = {
        readCurrent: async (subjectId, at) => {
          if (subjectId !== actor) fail();
          return forecastAuthorityState(await tx.query(FORECAST_AUTHORITY_SQL, [actor]), actor, at);
        },
        draftScope: (draftId) => scope(tx, draftId, true),
        get: (draftId, d) => {
          decision(d, actor, operation);
          return this.readIn(tx, actor, draftId, d);
        },
        put: async (record, expected, d) => {
          decision(d, actor, operation);
          const university = school((record.context as NativeObject)?.university_id);
          requireManagementUniversity(d, university);
          const draftId = id(record.draft_id), version = revision(record.revision);
          const selfApproval = record.status === "approved" && Array.isArray(record.contributors) &&
            record.contributors.includes(actor);
          if (
            version !== (expected === null ? 1 : revision(expected) + 1) ||
            typeof record.updated_at !== "string"
          ) fail();
          const body = nativeJsonbText(record, this.limits.maxRecordBytes),
            at = utcText(utcInstant(record.updated_at));
          const inserted = expected === null
            ? await tx.query(FORECAST_DRAFT_INSERT_SQL, [
              draftId,
              String(version),
              body,
              at,
              actor,
              university,
              permission,
            ])
            : await tx.query(FORECAST_DRAFT_UPDATE_SQL, [
              String(version),
              body,
              at,
              draftId,
              String(expected),
              actor,
              university,
              permission,
            ]);
          const row = one(inserted, 1);
          if (!row) {
            if (
              !await active(tx, actor, university, permission) ||
              selfApproval && !await active(tx, actor, university, "edit")
            ) fail("forecast_forbidden", 403);
            fail("revision_conflict", 409);
          }
          if (row[0] !== draftId) fail();
          const history = one(
            await tx.query(FORECAST_REVISION_INSERT_SQL, [
              draftId,
              String(version),
              body,
              at,
              actor,
              university,
              permission,
            ]),
            1,
          );
          if (!history) {
            if (
              !await active(tx, actor, university, permission) ||
              selfApproval && !await active(tx, actor, university, "edit")
            ) fail("forecast_forbidden", 403);
            fail();
          }
          if (sqlIntegerText(history[0]) !== version) fail();
        },
        publish: async (release, d) => {
          decision(d, actor, operation);
          if (operation !== "forecast.publish") fail("forecast_forbidden", 403);
          const university = school((release.context as NativeObject)?.university_id);
          requireManagementUniversity(d, university);
          const rid = id(release.release_id),
            oid = id((release.context as NativeObject).offering_id),
            did = id(release.draft_id),
            version = revision(release.draft_revision);
          if (
            typeof release.published_at !== "string" || typeof release.approval_hash !== "string" ||
            typeof release.validation_hash !== "string"
          ) fail();
          const row = one(
            await tx.query(FORECAST_PUBLISH_INSERT_SQL, [
              rid,
              oid,
              nativeJsonbText(release, this.limits.maxRecordBytes),
              utcText(utcInstant(release.published_at)),
              actor,
              university,
              did,
              String(version),
              release.approval_hash,
              release.validation_hash,
            ]),
            1,
          );
          if (!row) {
            if (!await active(tx, actor, university, "approve")) fail("forecast_forbidden", 403);
            fail("forecast_approval_stale", 409);
          }
          if (row[0] !== rid) fail();
        },
      };
      let d = await authorize(store);
      decision(d, actor, operation);
      const saved = one(await tx.query(FORECAST_REQUEST_SCOPE_SQL, [actor, operation, key]), 5);
      if (saved) {
        if (
          typeof saved[0] !== "string" || !HASH.test(saved[0]) || saved[1] !== "object" ||
          saved[2] !== "object" || saved[3] !== "string"
        ) fail();
        const university = school(saved[4]);
        requireManagementUniversity(d, university);
        if (saved[0] !== requestHash) fail("idempotency_conflict", 409);
        const row = one(
          await tx.query(FORECAST_REQUEST_READ_SQL, [
            actor,
            operation,
            key,
            university,
            permission,
          ]),
          1,
        );
        if (!row) fail("forecast_not_found", 404);
        const result = sqlObjectText(row[0], this.limits.maxRecordBytes);
        d = await authorize(store);
        decision(d, actor, operation);
        requireManagementUniversity(d, university);
        return result;
      }
      const result = await mutate(store, d);
      d = await authorize(store);
      decision(d, actor, operation);
      const university = school((result.context as NativeObject)?.university_id);
      requireManagementUniversity(d, university);
      const row = one(
        await tx.query(FORECAST_REQUEST_INSERT_SQL, [
          actor,
          operation,
          key,
          requestHash,
          nativeJsonbText(result, this.limits.maxRecordBytes),
          now,
          university,
          permission,
        ]),
        1,
      );
      if (!row) fail("forecast_forbidden", 403);
      if (row[0] !== requestHash) fail();
      return result;
    });
  }
}
