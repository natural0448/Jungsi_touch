/** Candidate: reuse saved assessments and the existing boundary-group rules. */
import { AccessError } from "./access.ts";
import { readSavedOfferingGroups, type SavedReportIdentity } from "./member_saved_offering_lookup.ts";
import { MemberJsonResults } from "./member_json_results.ts";
import type { RequestClockPort } from "./ports.ts";
import type { SessionSnapshot } from "./session_service.ts";
import { candidateGroups } from "./university_analysis.ts";
import type { NativeObject } from "../domain/json_value.ts";

/**
 * The caller supplies one already-authorized catalog page. Missing assessments
 * remain pending; saved scores alone do not produce candidate classifications.
 * The response is explicitly partial until a complete catalog scope is proven.
 */
export async function readSavedCandidateGroups(
  session: SessionSnapshot,
  year: number,
  rows: readonly NativeObject[],
  catalogVersion: string,
  results: MemberJsonResults,
  clock: RequestClockPort,
  signal: AbortSignal,
  expected: SavedReportIdentity,
  requestedIds: readonly string[],
): Promise<NativeObject> {
  if (typeof catalogVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(catalogVersion)) {
    throw new AccessError("storage_result_invalid", 503);
  }
  if (requestedIds.length > 100 || new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some((id) => typeof id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) {
    throw new AccessError("storage_result_invalid", 503);
  }
  const saved = await readSavedOfferingGroups(session, year, rows, results, clock, signal, expected);
  const assessments: NativeObject = {};
  const offerings: NativeObject[] = [];
  const originalRows = new Map(rows.map((row) => [row.offering_id, row]));
  for (const group of saved.groups) {
    for (const item of group.items) {
      const offering = item.offering as NativeObject;
      const id = offering.offering_id as string;
      const original = originalRows.get(id);
      if (!original) throw new AccessError("storage_result_invalid", 503);
      offerings.push(original);
      assessments[id] = item.assessment ?? {
        status: "pending",
        category: null,
        reason_code: "saved_assessment_missing",
      };
    }
  }
  offerings.sort((a, b) => {
    const left = String(a.university_id), right = String(b.university_id);
    if (left !== right) return left < right ? -1 : 1;
    const l = String(a.offering_id), r = String(b.offering_id);
    return l === r ? 0 : l < r ? -1 : 1;
  });
  const candidates = candidateGroups(offerings, assessments, catalogVersion);
  if (!Array.isArray(candidates.pending_offerings)) throw new AccessError("storage_result_invalid", 503);
  const present = new Set(offerings.map((row) => row.offering_id));
  const missing = requestedIds.filter((id) => !present.has(id)).map((id) => ({
    offering_id: id,
    category: null,
    reason_code: "approved_candidates_missing",
  }));
  return {
    ...candidates,
    pending_offerings: [...candidates.pending_offerings, ...missing],
    status: "pending",
    reason_code: "approved_candidates_missing",
  };
}
