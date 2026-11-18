/** Attach existing scores to a paid user's current catalog page. */
import { AccessError } from "./access.ts";
import type { MyScore } from "./score_map.ts";
import { SCORE_MAP_ID } from "./score_map.ts";
import type { SessionSnapshot } from "./session_service.ts";
import { requirePaidSession } from "./session_service.ts";
import type { RequestClockPort } from "./ports.ts";
import { resultObject } from "./paid_result_components.ts";
import type { NativeObject } from "../domain/json_value.ts";

/** The implementation must bind owner, approved current profile, data pin,
 * active request budget, and physical SQL cancellation before reading. */
export interface SavedPageScoresPort {
  read(
    session: SessionSnapshot,
    year: number,
    offeringIds: readonly string[],
    signal: AbortSignal,
  ): Promise<
    { readonly state: "ready"; readonly scores: ReadonlyMap<string, MyScore> } | {
      readonly state: "no_profile" | "unavailable";
    }
  >;
}

export async function attachSavedPageScores(
  result: NativeObject,
  session: SessionSnapshot,
  clock: RequestClockPort,
  signal: AbortSignal,
  scores: SavedPageScoresPort,
): Promise<NativeObject> {
  requirePaidSession(session, clock.nowUtc());
  if (signal.aborted) throw new AccessError("storage_unavailable", 503);
  if (!Array.isArray(result.items)) return result;
  const rows: NativeObject[] = [];
  if (result.items.length > 100) throw new AccessError("storage_result_invalid", 503);
  for (const row of result.items) {
    if (!resultObject(row)) throw new AccessError("storage_result_invalid", 503);
    rows.push(row);
  }
  if (rows.length === 0) return { ...result, items: [], my_score_state: "complete" };
  const ids: string[] = [], years = new Set<number>();
  for (const row of rows) {
    if (
      typeof row.offering_id !== "string" || !SCORE_MAP_ID.test(row.offering_id) ||
      typeof row.academic_year !== "number" || !Number.isSafeInteger(row.academic_year) ||
      ids.includes(row.offering_id)
    ) throw new AccessError("storage_result_invalid", 503);
    ids.push(row.offering_id);
    years.add(row.academic_year);
  }
  if (years.size !== 1) throw new AccessError("storage_result_invalid", 503);
  const saved = await scores.read(session, [...years][0], ids, signal);
  if (signal.aborted) throw new AccessError("storage_unavailable", 503);
  requirePaidSession(session, clock.nowUtc());
  if (saved.state !== "ready") {
    return {
      ...result,
      items: rows.map((row) => ({ ...row, my_score: null })),
      my_score_state: saved.state,
    };
  }
  if ([...saved.scores.keys()].some((id) => !ids.includes(id))) {
    throw new AccessError("storage_result_invalid", 503);
  }
  const items = rows.map((row) => {
    const score = saved.scores.get(row.offering_id as string);
    return { ...row, my_score: score ? { ...score } : null };
  });
  return {
    ...result,
    items,
    my_score_state: items.every((row) => row.my_score !== null) ? "complete" : "partial",
  };
}
