/** Persisted profile/overall/report workflows. All data and writes use application ports. */
import { AccessError, authorizeReport } from "./access.ts";
import type { ApiBusinessPort, ApiExecution } from "./api_dispatch.ts";
import { OverallAnalysisService, type OverallDataPort } from "./overall_analysis.ts";
import type {
  PlatformRepositoryPort,
  StoredMutation,
  StoredProfile,
  StoredReport,
} from "./platform_repository.ts";
import type { RequestClockPort } from "./ports.ts";
import { sessionDto, type SessionSnapshot } from "./session_service.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { utcText } from "../domain/time.ts";
export const PROFILE_REPORT_OPERATIONS = [
  "score-profile.create",
  "overall.analyze",
  "report.read",
  "report.export",
] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function object(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function shape(
  v: unknown,
  required: readonly string[] = [],
  optional: readonly string[] = [],
): NativeObject {
  if (
    !object(v) || required.some((k) => !Object.hasOwn(v, k)) ||
    Object.keys(v).some((k) => ![...required, ...optional].includes(k))
  ) throw new AccessError("invalid_request", 422);
  return v;
}
function identifier(v: unknown): string {
  if (typeof v !== "string" || !IDENTIFIER.test(v)) {
    throw new AccessError("invalid_identifier", 422);
  }
  return v;
}
function revision(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
    throw new AccessError("invalid_revision", 422);
  }
  return v;
}
function invalid(): never {
  throw new AccessError("invalid_repository_result", 503);
}
function own(result: StoredMutation, owner: string) {
  if (!result || result.owner_id !== owner) invalid();
}
export function profileDto(profile: StoredProfile): NativeObject {
  if (typeof profile.confirmed !== "boolean") invalid();
  return {
    profile_id: profile.profile_id,
    profile_version: profile.profile_id,
    confirmed: profile.confirmed,
    created_at: profile.created_at,
  };
}
export function reportDto(session: SessionSnapshot, record: StoredReport): NativeObject {
  own(record, session.user.subjectId);
  if (!object(record.body) || !object(record.body.overall)) invalid();
  const result: NativeObject = {
    format: "jungsi.persisted-report/v1",
    report_id: record.report_id,
    report_version: record.revision,
    profile_id: record.profile_id,
    updated_at: record.updated_at,
    overall: cloneNativeJson(record.body.overall),
  };
  if (session.tier === "paid") {
    for (const key of ["analyses", "candidates", "shortlist", "analysis_status"]) {
      if (!Object.hasOwn(record.body, key)) invalid();
      result[key] = cloneNativeJson(record.body[key]);
    }
  }
  return result;
}
export class ProfileReportService implements ApiBusinessPort {
  private readonly overall: OverallAnalysisService;
  constructor(
    private readonly repository: PlatformRepositoryPort,
    data: OverallDataPort,
    private readonly clock: RequestClockPort,
  ) {
    this.overall = new OverallAnalysisService(data);
  }
  private fresh(session: SessionSnapshot): bigint {
    if (
      !session?.user || typeof session.user.subjectId !== "string" ||
      !session.user.subjectId.trim() || typeof session.user.expiresAtUtc !== "bigint"
    ) throw new AccessError("authentication_required", 401);
    const now = this.clock.nowUtc();
    sessionDto(session, now);
    return now;
  }
  private async access(
    session: SessionSnapshot,
    reportId: unknown,
    confirmed = false,
  ): Promise<void> {
    const rid = identifier(reportId);
    await authorizeReport(session.user, rid, {
      find: (id) => this.repository.lookupAccess(session.user.subjectId, id),
    }, confirmed);
  }
  private async report(session: SessionSnapshot, rid: unknown): Promise<StoredReport> {
    const result = await this.repository.getReport(session.user.subjectId, identifier(rid));
    if (result === null) throw new AccessError("report_not_found", 404);
    own(result, session.user.subjectId);
    return result;
  }
  async execute(request: ApiExecution): Promise<NativeObject> {
    const { operation: op, session, params, query, body } = request;
    if (!PROFILE_REPORT_OPERATIONS.includes(op as typeof PROFILE_REPORT_OPERATIONS[number])) {
      throw new AccessError("route_not_found", 404);
    }
    this.fresh(session);
    if (op === "report.export" && session.tier !== "paid") {
      throw new AccessError("paid_required", 403);
    }
    if (op === "report.read" || op === "report.export") {
      await this.access(session, params.report_id, op === "report.export");
    }
    if (op === "report.read" || op === "report.export") {
      shape(body);
      shape(query);
      const record = await this.report(session, params.report_id);
      const now = this.fresh(session), result = reportDto(session, record);
      return op === "report.read" ? result : {
        format: "jungsi.counseling-snapshot/v1",
        status: "ready",
        snapshot_version: record.revision,
        generated_at: utcText(now),
        report: result,
      };
    }
    shape(query);
    const key = identifier(request.requestKey), digest = await nativeJsonSha256([body, params]);
    const replay = await this.repository.replay(session.user.subjectId, op, key, digest);
    if (replay !== null) {
      own(replay, session.user.subjectId);
      this.fresh(session);
      if (op === "score-profile.create") {
        if (!("scores" in replay)) invalid();
        return profileDto(replay);
      }
      if (!("body" in replay)) invalid();
      return reportDto(session, replay);
    }
    if (op === "score-profile.create") {
      const input = shape(body, ["scores", "confirmed"]);
      if (typeof input.confirmed !== "boolean") throw new AccessError("invalid_confirmation", 422);
      await this.overall.analyze(session, input.scores);
      if (!object(input.scores)) throw new AccessError("invalid_request", 422);
      const result = await this.repository.createProfile({
        owner: session.user.subjectId,
        scores: cloneNativeJson(input.scores),
        confirmed: input.confirmed,
        nowUtc: this.fresh(session),
        key,
        digest,
      });
      own(result, session.user.subjectId);
      this.fresh(session);
      return profileDto(result);
    }
    if (!object(body)) throw new AccessError("invalid_request", 422);
    let profile: StoredProfile,
      rid: string | null = null,
      expected: number | null = null,
      result: NativeObject;
    if (!Object.hasOwn(body, "profile_id")) {
      result = await this.overall.analyze(session, body) as NativeObject;
      profile = await this.repository.createProfile({
        owner: session.user.subjectId,
        scores: cloneNativeJson(body),
        confirmed: false,
        nowUtc: this.fresh(session),
        key,
        digest,
        operation: "overall.profile",
      });
      own(profile, session.user.subjectId);
    } else {
      const input = shape(body, ["profile_id"], ["report_id", "expected_version"]);
      const stored = await this.repository.getProfile(
        session.user.subjectId,
        identifier(input.profile_id),
      );
      if (stored === null) throw new AccessError("profile_not_found", 404);
      own(stored, session.user.subjectId);
      profile = stored;
      if (input.report_id !== null && input.report_id !== undefined) {
        rid = identifier(input.report_id);
        await this.access(session, rid);
        expected = revision(input.expected_version);
      } else if (Object.hasOwn(input, "expected_version")) {
        throw new AccessError("invalid_request", 422);
      }
      result = await this.overall.analyze(session, profile.scores) as NativeObject;
    }
    const previous = rid === null ? null : await this.report(session, rid);
    let shortlist: NativeObject = {};
    if (previous) {
      if (!object(previous.body.shortlist)) invalid();
      shortlist = cloneNativeJson(previous.body.shortlist);
    }
    for (const row of Object.values(shortlist)) {
      if (!object(row)) invalid();
      row.assessment_status = "needs_revalidation";
    }
    const snapshot: NativeObject = {
      overall: result,
      analyses: {},
      candidates: null,
      shortlist,
      catalog_version: null,
      analysis_status: { status: "pending", reason_code: "offering_analysis_not_requested" },
    };
    const written = await this.repository.writeReport({
      owner: session.user.subjectId,
      reportId: rid,
      profileId: profile.profile_id,
      body: snapshot,
      expected,
      nowUtc: this.fresh(session),
      operation: "overall.analyze",
      key,
      digest,
    });
    this.fresh(session);
    return reportDto(session, written);
  }
}
