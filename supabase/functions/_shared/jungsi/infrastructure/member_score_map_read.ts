/** Read-only candidate for the existing member score map; no score calculation or writes. */
import { AccessError } from "../application/access.ts";
import {
  type MyScore,
  myScore,
  SCORE_MAP_ID,
  SCORE_MAP_OWNER,
  SCORE_MAP_PIN,
} from "../application/score_map.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import type { SupabaseSqlTransport } from "./transaction_sql.ts";

const READ_SAVED_SCORES_SQL = `SELECT m.offering_id,m.status,m.converted_score,
 m.official_max_score,m.reason_code
 FROM jungsi_backend.score_maps m
 WHERE m.owner_id=$1 AND m.profile_id=$2 AND m.data_pin=$3
 AND m.offering_id IN (SELECT jsonb_array_elements_text($4::jsonb))
 AND EXISTS (SELECT 1 FROM jungsi_backend.profiles p
   WHERE p.owner_id=$1 AND p.profile_id=$2 AND p.confirmed)`;

/** Internal marker: only a recognized connection/availability SQLSTATE may degrade the score. */
export class SavedScoreTransientUnavailable extends AccessError {
  constructor() { super("storage_unavailable", 503); }
}
function transientConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object" || error instanceof AccessError) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" &&
    (/^08[0-9A-Z]{3}$/.test(code) ||
      ["57P01", "57P02", "57P03", "53300", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"]
        .includes(code));
}

/**
 * Internal request capability, supplied by the caller after the existing shared
 * budget authorizes this exact read. profileId and pin must come from the
 * verified server-side request context, never directly from a browser claim.
 */
export interface SavedScoreReadScope {
  readonly owner: string;
  readonly profileId: string;
  readonly dataPin: string;
  readonly signal: AbortSignal;
  assertActive(): void;
}

export async function readSavedScoreMap(
  sql: SupabaseSqlTransport,
  scope: SavedScoreReadScope,
  offeringIds: readonly string[],
): Promise<ReadonlyMap<string, MyScore>> {
  scope.assertActive();
  if (
    scope.signal.aborted || !SCORE_MAP_OWNER.test(scope.owner) ||
    !SCORE_MAP_ID.test(scope.profileId) || !SCORE_MAP_PIN.test(scope.dataPin) ||
    offeringIds.length > 100 || new Set(offeringIds).size !== offeringIds.length ||
    offeringIds.some((id) => !SCORE_MAP_ID.test(id))
  ) throw new AccessError("storage_result_invalid", 503);
  if (offeringIds.length === 0) return new Map();
  const requested = new Set(offeringIds);
  return await sql.read(scope.owner, async (tx) => {
    scope.assertActive();
    let rows: unknown[][];
    try {
      rows = await tx.query(READ_SAVED_SCORES_SQL, [
        scope.owner,
        scope.profileId,
        scope.dataPin,
        nativeJsonText([...offeringIds]),
      ], scope.signal);
    } catch (error) {
      scope.assertActive();
      if (!scope.signal.aborted && transientConnectionError(error)) {
        throw new SavedScoreTransientUnavailable();
      }
      throw error;
    }
    scope.assertActive();
    if (!Array.isArray(rows) || rows.length > offeringIds.length) {
      throw new AccessError("storage_result_invalid", 503);
    }
    const result = new Map<string, MyScore>();
    for (const row of rows) {
      if (
        !Array.isArray(row) || row.length !== 5 || typeof row[0] !== "string" ||
        !requested.has(row[0]) || result.has(row[0])
      ) throw new AccessError("storage_result_invalid", 503);
      result.set(row[0], myScore({
        status: row[1],
        converted_score: row[2],
        official_max_score: row[3],
        reason_code: row[4],
      }));
    }
    return result;
  }, scope.signal);
}
