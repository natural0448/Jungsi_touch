/** Owner-scoped, insert-only Postgres store for the 3P score map (migration 011 score_maps). */
import {
  type MyScore,
  myScore,
  SCORE_MAP_ID,
  SCORE_MAP_OWNER,
  SCORE_MAP_PIN,
  scoreMapInvalid,
  type ScoreMapProfile,
  type ScoreMapStore,
} from "../application/score_map.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import type { NativeSqlTransaction } from "./transaction_sql.ts";
import { sqlObjectText } from "./sql_values.ts";

export const SCORE_MAP_PROFILE_SQL = `SELECT profile_id,scores::text FROM jungsi_backend.profiles
 WHERE owner_id=$1 AND confirmed ORDER BY created_at DESC,profile_id DESC LIMIT 1`;
export const SCORE_MAP_READ_SQL =
  `SELECT offering_id,status,converted_score,official_max_score,reason_code
 FROM jungsi_backend.score_maps WHERE owner_id=$1 AND profile_id=$2 AND data_pin=$3
 AND offering_id IN (SELECT jsonb_array_elements_text($4::jsonb))`;
export const SCORE_MAP_INSERT_SQL = `INSERT INTO jungsi_backend.score_maps
 (owner_id,profile_id,data_pin,offering_id,status,converted_score,official_max_score,reason_code,computed_at)
 SELECT $1,$2,$3,x.offering_id,x.status,x.converted_score,x.official_max_score,x.reason_code,$5::timestamptz
 FROM jsonb_to_recordset($4::jsonb) AS x(offering_id text,status text,converted_score text,
 official_max_score text,reason_code text) ON CONFLICT DO NOTHING`;

interface SqlTransport {
  read<T>(subject: string, work: (tx: NativeSqlTransaction) => Promise<T>): Promise<T>;
  write<T>(subject: string, work: (tx: NativeSqlTransaction) => Promise<T>): Promise<T>;
}
export class SupabaseScoreMapStore implements ScoreMapStore {
  constructor(
    private readonly sql: () => SqlTransport,
    private readonly maxRecordBytes: () => Promise<number>,
  ) {}
  async latestProfile(owner: string): Promise<ScoreMapProfile | null> {
    if (!SCORE_MAP_OWNER.test(owner)) scoreMapInvalid();
    const max = await this.maxRecordBytes();
    return await this.sql().read(owner, async (tx) => {
      const rows = await tx.query(SCORE_MAP_PROFILE_SQL, [owner]);
      if (!Array.isArray(rows) || rows.length > 1) scoreMapInvalid();
      const row = rows[0];
      if (!row) return null;
      if (
        !Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" ||
        !SCORE_MAP_ID.test(row[0])
      ) {
        scoreMapInvalid();
      }
      return { profile_id: row[0], scores: sqlObjectText(row[1], max) };
    });
  }
  async read(
    owner: string,
    profileId: string,
    pin: string,
    offeringIds: readonly string[],
  ): Promise<ReadonlyMap<string, MyScore>> {
    if (!SCORE_MAP_OWNER.test(owner) || !SCORE_MAP_ID.test(profileId) || !SCORE_MAP_PIN.test(pin)) {
      scoreMapInvalid();
    }
    if (offeringIds.length > 100 || offeringIds.some((id) => !SCORE_MAP_ID.test(id))) {
      scoreMapInvalid();
    }
    const out = new Map<string, MyScore>();
    if (!offeringIds.length) return out;
    return await this.sql().read(owner, async (tx) => {
      const rows = await tx.query(SCORE_MAP_READ_SQL, [
        owner,
        profileId,
        pin,
        nativeJsonText([...offeringIds]),
      ]);
      if (!Array.isArray(rows) || rows.length > offeringIds.length) scoreMapInvalid();
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 5) scoreMapInvalid();
        const id = row[0];
        if (typeof id !== "string" || !offeringIds.includes(id) || out.has(id)) scoreMapInvalid();
        out.set(
          id,
          myScore({
            status: row[1],
            converted_score: row[2],
            official_max_score: row[3],
            reason_code: row[4],
          }),
        );
      }
      return out;
    });
  }
  async insert(
    owner: string,
    profileId: string,
    pin: string,
    rows: readonly (MyScore & { readonly offering_id: string })[],
    nowUtc: string,
  ): Promise<void> {
    if (!SCORE_MAP_OWNER.test(owner) || !SCORE_MAP_ID.test(profileId) || !SCORE_MAP_PIN.test(pin)) {
      scoreMapInvalid();
    }
    if (!rows.length) return;
    if (rows.length > 100 || rows.some((r) => !SCORE_MAP_ID.test(r.offering_id))) scoreMapInvalid();
    const payload = rows.map((r) => ({ offering_id: r.offering_id, ...myScore(r) }));
    await this.sql().write(owner, async (tx) => {
      await tx.query(SCORE_MAP_INSERT_SQL, [
        owner,
        profileId,
        pin,
        nativeJsonText(payload),
        utcInstantText(nowUtc),
      ]);
    });
  }
}
function utcInstantText(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value)) scoreMapInvalid();
  return value;
}
