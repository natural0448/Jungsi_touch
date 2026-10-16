/** Existing app-role tables: owner predicates, append-only revisions and replay. */
import { AccessError } from "../application/access.ts";
import type {
  PlatformRepositoryPort,
  ProfileWrite,
  ReportWrite,
  StoredMutation,
  StoredProfile,
  StoredReport,
} from "../application/platform_repository.ts";
import type { ReportAccess } from "../application/ports.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { sqlIntegerText, sqlObjectText, sqlUtcText } from "./sql_values.ts";
import { nativeJsonbText } from "./jsonb_value.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROFILE_OPS = ["score-profile.create", "overall.profile"];
const REPORT_OPS = [
  "overall.analyze",
  "university.analyze",
  "candidates.build",
  "shortlist.update",
];
const TIME = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export const PROFILE_READ_SQL = `SELECT profile_id,owner_id,scores::text,confirmed,${
  TIME("created_at")
}
 FROM jungsi_backend.profiles WHERE profile_id=$1 AND owner_id=$2`;
const REPORT_SELECT = `SELECT r.report_id,r.owner_id,v.profile_id,r.revision::text,v.body::text,${
  TIME("v.created_at")
}
 FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v
 ON (r.report_id,r.revision,r.owner_id)=(v.report_id,v.revision,v.owner_id)`;
export const REPORT_READ_SQL = REPORT_SELECT + " WHERE r.report_id=$1 AND r.owner_id=$2";
export const REPORT_ACCESS_SQL = `SELECT r.owner_id,p.confirmed FROM jungsi_backend.reports r
 JOIN jungsi_backend.profiles p ON (r.profile_id,r.owner_id)=(p.profile_id,p.owner_id)
 WHERE r.report_id=$1 AND r.owner_id=$2`;
export const REQUEST_REPLAY_SQL = `SELECT digest,result::text FROM jungsi_backend.requests
 WHERE owner_id=$1 AND operation=$2 AND request_key=$3`;
export const REQUEST_LOCK_SQL = "SELECT pg_advisory_xact_lock($1::bigint)";
export const REPORT_REVISION_SQL = `SELECT revision::text FROM jungsi_backend.reports
 WHERE report_id=$1 AND owner_id=$2 FOR UPDATE`;
export const PROFILE_INSERT_SQL = `INSERT INTO jungsi_backend.profiles
 (profile_id,owner_id,scores,confirmed,created_at) VALUES($1,$2,$3::jsonb,$4,$5::timestamptz)`;
export const REPORT_INSERT_SQL = `INSERT INTO jungsi_backend.reports
 (report_id,owner_id,profile_id,revision,updated_at) VALUES($1,$2,$3,$4::bigint,$5::timestamptz)`;
export const REPORT_UPDATE_SQL =
  `UPDATE jungsi_backend.reports SET revision=$1::bigint,profile_id=$2,updated_at=$3::timestamptz
 WHERE report_id=$4 AND owner_id=$5`;
export const REVISION_INSERT_SQL = `INSERT INTO jungsi_backend.report_revisions
 (report_id,owner_id,profile_id,revision,body,created_at) VALUES($1,$2,$3,$4::bigint,$5::jsonb,$6::timestamptz)`;
export const REQUEST_INSERT_SQL = `INSERT INTO jungsi_backend.requests
 (owner_id,operation,request_key,digest,result,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`;
export const AUDIT_INSERT_SQL = `INSERT INTO jungsi_backend.audit_events
 (event_id,owner_id,operation,resource_id,revision,occurred_at) VALUES($1,$2,$3,$4,$5::bigint,$6::timestamptz)`;
function invalid(): never {
  throw new AccessError("storage_result_invalid", 503);
}
function identifier(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) throw new AccessError("invalid_identifier", 422);
  return v;
}
function ownerId(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) {
    throw new AccessError("storage_identity_invalid", 503);
  }
  return v;
}
function one(rows: unknown[][], length: number): unknown[] | null {
  if (
    !Array.isArray(rows) || rows.length > 1 ||
    rows.some((r) => !Array.isArray(r) || r.length !== length)
  ) invalid();
  return rows[0] ?? null;
}
function object(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function exactKeys(v: NativeObject, keys: string[]) {
  if (Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) invalid();
}
function storedTime(value: unknown): string {
  if (typeof value !== "string" || !value.endsWith("Z")) invalid();
  try {
    return utcText(utcInstant(value));
  } catch {
    return invalid();
  }
}
function positiveRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) invalid();
  return v;
}
function profile(value: unknown, owner: string): StoredProfile {
  if (!object(value)) invalid();
  exactKeys(value, ["profile_id", "owner_id", "scores", "confirmed", "created_at"]);
  if (value.owner_id !== owner || typeof value.confirmed !== "boolean" || !object(value.scores)) {
    invalid();
  }
  return {
    profile_id: identifier(value.profile_id),
    owner_id: ownerId(value.owner_id),
    scores: value.scores,
    confirmed: value.confirmed,
    created_at: storedTime(value.created_at),
  };
}
function report(value: unknown, owner?: string): StoredReport {
  if (!object(value)) invalid();
  exactKeys(value, ["report_id", "owner_id", "profile_id", "revision", "body", "updated_at"]);
  if (owner !== undefined && value.owner_id !== owner || !object(value.body)) invalid();
  return {
    report_id: identifier(value.report_id),
    owner_id: ownerId(value.owner_id),
    profile_id: identifier(value.profile_id),
    revision: positiveRevision(value.revision),
    body: value.body,
    updated_at: storedTime(value.updated_at),
  };
}
function reportRow(row: unknown[], owner: string | undefined, maxBytes: number): StoredReport {
  return report({
    report_id: row[0],
    owner_id: row[1],
    profile_id: row[2],
    revision: sqlIntegerText(row[3]),
    body: sqlObjectText(row[4], maxBytes),
    updated_at: sqlUtcText(row[5]),
  }, owner);
}
function operation(op: string, key: string, digest: string) {
  if (
    ![...PROFILE_OPS, ...REPORT_OPS].includes(op) || typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest)
  ) {
    throw new AccessError("storage_parameters_invalid", 503);
  }
  identifier(key);
}
async function lock(tx: NativeSqlTransaction, owner: string, op: string, key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner + "\0" + op + "\0" + key)),
  );
  const signed = new DataView(bytes.buffer).getBigInt64(0, false);
  await tx.query(REQUEST_LOCK_SQL, [String(signed)]);
}
function encoded(v: unknown, maxBytes: number): string {
  return nativeJsonbText(v, maxBytes);
}
export class SupabasePlatformRepository implements PlatformRepositoryPort {
  private readonly maxRecordBytes: number;
  constructor(
    private readonly sql: SupabaseSqlTransport,
    limits: { readonly maxRecordBytes: number },
    private readonly uuid: () => string = () => crypto.randomUUID().replaceAll("-", ""),
  ) {
    if (!limits || !Number.isSafeInteger(limits.maxRecordBytes) || limits.maxRecordBytes < 1) {
      throw new AccessError("storage_configuration_invalid", 503);
    }
    this.maxRecordBytes = limits.maxRecordBytes;
  }
  private newId(prefix = ""): string {
    const value = this.uuid();
    if (!/^[a-f0-9]{32}$/.test(value)) invalid();
    return prefix + value;
  }
  private async replayIn(
    tx: NativeSqlTransaction,
    owner: string,
    op: string,
    key: string,
    digest: string,
  ): Promise<StoredMutation | null> {
    const row = one(await tx.query(REQUEST_REPLAY_SQL, [owner, op, key]), 2);
    if (!row) return null;
    if (typeof row[0] !== "string" || !/^[a-f0-9]{64}$/.test(row[0])) invalid();
    if (row[0] !== digest) throw new AccessError("idempotency_conflict", 409);
    const value = sqlObjectText(row[1], this.maxRecordBytes);
    return PROFILE_OPS.includes(op) ? profile(value, owner) : report(value, owner);
  }
  async replay(
    owner: string,
    op: string,
    key: string,
    digest: string,
  ): Promise<StoredMutation | null> {
    operation(op, key, digest);
    ownerId(owner);
    return await this.sql.read(owner, (tx) => this.replayIn(tx, owner, op, key, digest));
  }
  private async remember(
    tx: NativeSqlTransaction,
    owner: string,
    op: string,
    key: string,
    digest: string,
    result: StoredMutation,
    now: string,
  ) {
    await tx.query(REQUEST_INSERT_SQL, [
      owner,
      op,
      key,
      digest,
      encoded(result, this.maxRecordBytes),
      now,
    ]);
    await tx.query(AUDIT_INSERT_SQL, [
      this.newId(),
      owner,
      op,
      "report_id" in result ? result.report_id : result.profile_id,
      "revision" in result ? String(result.revision) : "1",
      now,
    ]);
  }
  async createProfile(input: ProfileWrite): Promise<StoredProfile> {
    operation(input.operation ?? "score-profile.create", input.key, input.digest);
    ownerId(input.owner);
    if (typeof input.confirmed !== "boolean" || !object(input.scores)) {
      throw new AccessError("storage_parameters_invalid", 503);
    }
    encoded(input.scores, this.maxRecordBytes);
    utcText(input.nowUtc);
    return await this.sql.write(input.owner, (tx) => this.createProfileInTransaction(tx, input));
  }
  /** Infrastructure composition can enlist the profile in the rights/response acceptance transaction. */
  async createProfileInTransaction(
    tx: NativeSqlTransaction,
    input: ProfileWrite,
  ): Promise<StoredProfile> {
    const { owner, key, digest, scores, confirmed } = input,
      op = input.operation ?? "score-profile.create";
    operation(op, key, digest);
    ownerId(owner);
    if (!PROFILE_OPS.includes(op) || typeof confirmed !== "boolean" || !object(scores)) {
      throw new AccessError("storage_parameters_invalid", 503);
    }
    const now = utcText(input.nowUtc), scoreText = encoded(scores, this.maxRecordBytes);
    await lock(tx, owner, op, key);
    const replay = await this.replayIn(tx, owner, op, key, digest);
    if (replay) {
      if (!("scores" in replay)) invalid();
      return replay;
    }
    const result: StoredProfile = {
      profile_id: this.newId("profile-"),
      owner_id: owner,
      scores: sqlObjectText(scoreText, this.maxRecordBytes),
      confirmed,
      created_at: now,
    };
    await tx.query(PROFILE_INSERT_SQL, [result.profile_id, owner, scoreText, confirmed, now]);
    await this.remember(tx, owner, op, key, digest, result, now);
    return result;
  }
  async getProfile(owner: string, pid: string): Promise<StoredProfile | null> {
    ownerId(owner);
    identifier(pid);
    return await this.sql.read(owner, (tx) => this.getProfileInTransaction(tx, owner, pid));
  }
  async getProfileInTransaction(
    tx: NativeSqlTransaction,
    owner: string,
    pid: string,
  ): Promise<StoredProfile | null> {
    ownerId(owner);
    identifier(pid);
    const row = one(await tx.query(PROFILE_READ_SQL, [pid, owner]), 5);
    return row
      ? profile({
        profile_id: row[0],
        owner_id: row[1],
        scores: sqlObjectText(row[2], this.maxRecordBytes),
        confirmed: row[3],
        created_at: sqlUtcText(row[4]),
      }, owner)
      : null;
  }
  async getReport(owner: string, rid: string): Promise<StoredReport | null> {
    ownerId(owner);
    identifier(rid);
    return await this.sql.read(owner, (tx) => this.getReportInTransaction(tx, owner, rid));
  }
  async getReportInTransaction(
    tx: NativeSqlTransaction,
    owner: string,
    rid: string,
  ): Promise<StoredReport | null> {
    ownerId(owner);
    identifier(rid);
    const row = one(await tx.query(REPORT_READ_SQL, [rid, owner]), 6);
    return row ? reportRow(row, owner, this.maxRecordBytes) : null;
  }
  async latestReportInTransaction(
    tx: NativeSqlTransaction,
    owner: string,
    pid: string,
  ): Promise<StoredReport | null> {
    ownerId(owner);
    identifier(pid);
    const row = one(
      await tx.query(
        REPORT_SELECT +
          " WHERE r.owner_id=$1 AND r.profile_id=$2 ORDER BY r.updated_at DESC,r.report_id DESC LIMIT 1",
        [owner, pid],
      ),
      6,
    );
    return row ? reportRow(row, owner, this.maxRecordBytes) : null;
  }
  async lookupAccess(owner: string, rid: string): Promise<ReportAccess | null> {
    ownerId(owner);
    identifier(rid);
    return await this.sql.read(owner, async (tx) => {
      const row = one(await tx.query(REPORT_ACCESS_SQL, [rid, owner]), 2);
      if (!row) return null;
      if (row[0] !== owner || typeof row[1] !== "boolean") invalid();
      return { ownerId: owner, confirmed: row[1] };
    });
  }
  async writeReport(input: ReportWrite): Promise<StoredReport> {
    const { owner, profileId, key, digest, operation: op } = input;
    ownerId(owner);
    operation(op, key, digest);
    identifier(profileId);
    if (
      !REPORT_OPS.includes(op) || !object(input.body) ||
      input.noOp !== undefined && typeof input.noOp !== "boolean"
    ) throw new AccessError("storage_parameters_invalid", 503);
    if (input.reportId !== null) {
      identifier(input.reportId);
      positiveRevision(input.expected);
    } else if (input.expected !== null || input.noOp === true) {
      throw new AccessError("storage_parameters_invalid", 503);
    }
    const now = utcText(input.nowUtc), bodyText = encoded(input.body, this.maxRecordBytes);
    return await this.sql.write(owner, async (tx) => {
      await lock(tx, owner, op, key);
      const replay = await this.replayIn(tx, owner, op, key, digest);
      if (replay) {
        if (!("body" in replay)) invalid();
        return replay;
      }
      if (
        one(
          await tx.query(
            "SELECT profile_id FROM jungsi_backend.profiles WHERE profile_id=$1 AND owner_id=$2",
            [profileId, owner],
          ),
          1,
        ) === null
      ) {
        throw new AccessError("profile_not_found", 404);
      }
      let rid = input.reportId, version = 1;
      if (rid === null) {
        rid = this.newId("report-");
        await tx.query(REPORT_INSERT_SQL, [rid, owner, profileId, "1", now]);
      } else {
        const row = one(await tx.query(REPORT_REVISION_SQL, [rid, owner]), 1);
        if (!row) throw new AccessError("report_not_found", 404);
        const current = positiveRevision(sqlIntegerText(row[0]));
        if (current !== input.expected) throw new AccessError("revision_conflict", 409);
        if (input.noOp === true) {
          const state = one(await tx.query(REPORT_READ_SQL, [rid, owner]), 6);
          if (!state) invalid();
          const result = reportRow(state, owner, this.maxRecordBytes);
          if (result.profile_id !== profileId || result.revision !== current) invalid();
          await this.remember(tx, owner, op, key, digest, result, now);
          return result;
        }
        version = positiveRevision(current + 1);
        await tx.query(REPORT_UPDATE_SQL, [String(version), profileId, now, rid, owner]);
      }
      const result: StoredReport = {
        report_id: rid,
        owner_id: owner,
        profile_id: profileId,
        revision: version,
        body: sqlObjectText(bodyText, this.maxRecordBytes),
        updated_at: now,
      };
      await tx.query(REVISION_INSERT_SQL, [rid, owner, profileId, String(version), bodyText, now]);
      if (input.paidOrigin) {
        const origin = input.paidOrigin;
        if (
          origin.operation !== op ||
          !["overall.analyze", "university.analyze", "candidates.build"].includes(op) ||
          !Array.isArray(origin.componentKeys) ||
          new Set(origin.componentKeys).size !== origin.componentKeys.length ||
          origin.componentKeys.some((c) =>
            typeof c !== "string" ||
            !(op === "overall.analyze"
              ? c === "overall"
              : op === "candidates.build"
              ? c === "candidates"
              : /^analysis:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(c))
          )
        ) {
          throw new AccessError("storage_parameters_invalid", 503);
        }
        if (origin.accessBasis === "customer_pass") {
          if (
            typeof origin.passId !== "string" || !/^[1-9][0-9]*$/.test(origin.passId) ||
            one(
                await tx.query(
                  "SELECT id::text FROM public.jeongsi_passes WHERE id=$1::bigint AND user_id::text=$2",
                  [origin.passId, owner],
                ),
                1,
              ) === null
          ) invalid();
        } else if (origin.accessBasis !== "verified_admin" || origin.passId !== null) invalid();
        if (origin.componentKeys.length) {
          const rows = origin.componentKeys.map((component) => ({
            origin_id: this.newId("origin-"),
            component_key: component,
          }));
          await tx.query(
            `INSERT INTO jungsi_backend.score_result_origins
           (origin_id,owner_id,report_id,revision,component_key,source_operation,pass_id,access_basis,created_at)
           SELECT x.origin_id,$2,$3,$4::bigint,x.component_key,$5,$6::bigint,$7,$8::timestamptz
           FROM jsonb_to_recordset($1::jsonb) AS x(origin_id text,component_key text)`,
            [
              JSON.stringify(rows),
              owner,
              rid,
              String(version),
              op,
              origin.passId,
              origin.accessBasis,
              now,
            ],
          );
        }
      }
      await this.remember(tx, owner, op, key, digest, result, now);
      return result;
    });
  }
  async activeReports(verifiedRequestor: string): Promise<readonly StoredReport[]> {
    ownerId(verifiedRequestor);
    return await this.sql.read(verifiedRequestor, async (tx) => {
      const rows = await tx.query(REPORT_SELECT);
      if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r) || r.length !== 6)) invalid();
      return rows.map((row) => reportRow(row, undefined, this.maxRecordBytes));
    });
  }
}
