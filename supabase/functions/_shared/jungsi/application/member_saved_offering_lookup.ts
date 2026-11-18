/**
 * Review candidate: combine an already-authorized catalog page with saved
 * member assessments through the existing report.read runtime candidate.
 * This module adds no HTTP route; the caller maintains ownership, the shared
 * request budget, and cancellation for the underlying saved-results port.
 */
import { AccessError } from "./access.ts";
import { offeringDto } from "./catalog.ts";
import { MemberJsonResults } from "./member_json_results.ts";
import type { RequestClockPort } from "./ports.ts";
import { requirePaidSession, type SessionSnapshot } from "./session_service.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export interface SavedReportIdentity {
  readonly reportId: string;
  readonly revision: number;
  readonly profileId: string;
  readonly examId: string;
  readonly packVersion: string;
}

/**
 * Rows must be from an approved catalog page, with offering_id already mapped
 * by the catalog provider. This function never guesses an original PK from a
 * public offering ID, computes scores, writes results, or reads a shortlist.
 */
export async function readSavedOfferingGroups(
  session: SessionSnapshot,
  year: number,
  rows: readonly NativeObject[],
  results: MemberJsonResults,
  clock: RequestClockPort,
  signal: AbortSignal,
  expected: SavedReportIdentity,
) {
  requirePaidSession(session, clock.nowUtc());
  if (
    !Number.isSafeInteger(year) || year < 1 || year > 9999 || rows.length > 100 ||
    !expected || !Number.isSafeInteger(expected.revision) || expected.revision < 1 ||
    ![expected.reportId, expected.profileId, expected.examId, expected.packVersion].every((v) =>
      typeof v === "string" && ID.test(v)
    )
  ) {
    throw new AccessError("invalid_request", 422);
  }
  if (signal.aborted) throw new AccessError("request_cancelled", 499);
  const ids: string[] = [];
  for (const row of rows) {
    if (
      typeof row.offering_id !== "string" || !ID.test(row.offering_id) ||
      typeof row.university_id !== "string" || !ID.test(row.university_id) ||
      row.academic_year !== year || ids.includes(row.offering_id)
    ) throw new AccessError("storage_result_invalid", 503);
    ids.push(row.offering_id);
  }
  if (ids.length === 0) return { context: null, groups: [], scope: "partial" as const };
  const saved = await results.read(
    session.user.subjectId,
    year,
    ids,
    expected.reportId,
    expected.revision,
    signal,
  );
  if (signal.aborted) throw new AccessError("request_cancelled", 499);
  requirePaidSession(session, clock.nowUtc());
  if (
    !saved.context || saved.context.report_id !== expected.reportId ||
    saved.context.report_version !== expected.revision ||
    saved.context.profile_id !== expected.profileId || saved.context.exam_id !== expected.examId ||
    saved.context.pack_version !== expected.packVersion || saved.context.academic_year !== year ||
    saved.context.source !== "selected_report"
  ) throw new AccessError("storage_result_invalid", 503);
  const groups = new Map<string, { university_id: string; items: NativeObject[] }>();
  for (const row of rows) {
    const universityId = row.university_id as string;
    const offeringId = row.offering_id as string;
    let group = groups.get(universityId);
    if (!group) {
      group = { university_id: universityId, items: [] };
      groups.set(universityId, group);
    }
    const assessment = saved.assessments.get(offeringId);
    group.items.push({
      offering: offeringDto(row),
      assessment: assessment ? cloneNativeJson(assessment) : null,
      assessment_status: assessment?.status ?? "missing",
      assessment_reason_code: assessment ? null : saved.reason,
    });
  }
  return { context: saved.context, groups: [...groups.values()], scope: "partial" as const };
}
