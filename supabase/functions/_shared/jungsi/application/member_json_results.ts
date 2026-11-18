/** Read saved assessments only. A miss never requests an engine or writes a result. */
import { AccessError } from "./access.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { resultObject } from "./paid_result_components.ts";

export interface MemberAssessmentContext {
  readonly owner: string;
  readonly year: number;
  readonly report_id: string;
  readonly report_revision: number;
  readonly profile_id: string;
  readonly exam_id: string;
  readonly pack_version: string;
  readonly source: "selected_report" | "current_profile";
}
export interface MemberSavedResultsPort {
  /** One owner/year/profile-bound query, projecting only the requested analyses. */
  read(
    owner: string,
    year: number,
    ids: readonly string[],
    reportId: string | null,
    revision?: number,
    signal?: AbortSignal,
  ): Promise<
    {
      readonly context: MemberAssessmentContext;
      readonly analyses: NativeObject;
    } | null
  >;
}
export class MemberJsonResults {
  constructor(private readonly saved: MemberSavedResultsPort, private readonly maxIds: number) {}
  async read(
    owner: string,
    year: number,
    ids: readonly string[],
    reportId: string | null,
    revision?: number,
    signal?: AbortSignal,
  ) {
    if (
      !Number.isSafeInteger(this.maxIds) || this.maxIds < 1 || ids.length > this.maxIds ||
      new Set(ids).size !== ids.length
    ) throw new AccessError("storage_result_invalid", 503);
    const value = await this.saved.read(owner, year, ids, reportId, revision, signal);
    if (value === null) {
      if (reportId !== null) throw new AccessError("report_not_found", 404);
      return {
        context: null,
        assessments: new Map<string, NativeObject>(),
        reason: "current_saved_assessment_missing",
      };
    }
    const c = value.context;
    if (
      !c || c.owner !== owner || c.year !== year ||
      reportId !== null && c.report_id !== reportId ||
      revision !== undefined && c.report_revision !== revision ||
      !Number.isSafeInteger(c.report_revision) || c.report_revision < 1 ||
      ![c.report_id, c.profile_id, c.exam_id, c.pack_version].every((x) =>
        typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)
      ) ||
      c.source !== (reportId === null ? "current_profile" : "selected_report") ||
      !resultObject(value.analyses) || Object.keys(value.analyses).some((id) => !ids.includes(id))
    ) {
      throw new AccessError("storage_result_invalid", 503);
    }
    const assessments = new Map<string, NativeObject>();
    for (const [id, assessment] of Object.entries(value.analyses)) {
      if (!resultObject(assessment)) throw new AccessError("storage_result_invalid", 503);
      if (
        !["ready", "pending", "ineligible"].includes(assessment.status as string) ||
        assessment.offering_id !== undefined && assessment.offering_id !== id ||
        resultObject(assessment.versions) && (
            assessment.versions.profile !== null && assessment.versions.profile !== undefined &&
              assessment.versions.profile !== c.profile_id ||
            assessment.versions.pack !== null && assessment.versions.pack !== undefined &&
              assessment.versions.pack !== c.pack_version
          )
      ) {
        throw new AccessError("storage_result_invalid", 503);
      }
      assessments.set(id, cloneNativeJson(assessment));
    }
    return {
      context: {
        report_id: c.report_id,
        report_version: c.report_revision,
        profile_id: c.profile_id,
        exam_id: c.exam_id,
        pack_version: c.pack_version,
        academic_year: c.year,
        source: c.source,
      },
      assessments,
      reason: "saved_assessment_missing",
    };
  }
}
