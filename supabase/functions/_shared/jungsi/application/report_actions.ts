/** Paid shortlist and aggregate statistics; never return another student's record. */
import { AccessError, authorizeReport } from "./access.ts";
import type { ApiBusinessPort, ApiExecution } from "./api_dispatch.ts";
import { CatalogService } from "./catalog.ts";
import type { PlatformRepositoryPort, StoredReport } from "./platform_repository.ts";
import { reportDto } from "./profile_reports.ts";
import type { RequestClockPort } from "./ports.ts";
import { sessionDto, type SessionSnapshot } from "./session_service.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { exact, Rational } from "../domain/exact.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { unicodeCompare } from "../domain/text.ts";
export const REPORT_ACTION_OPERATIONS = ["shortlist.update", "statistics.read"] as const;
/** 한 모집군(가·나·다)에 담을 수 있는 수. 정시 원서는 군마다 하나라 후보를 넓게 쌓지 않게 한다(대표님 결정 2026-11-18).
 * 이 한도 전에 이미 더 담긴 것은 그대로 두고, 새로 담는 것만 막는다. 빼기는 언제나 된다. */
export const SHORTLIST_GROUP_LIMIT = 4;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function object(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function invalid(): never {
  throw new AccessError("invalid_repository_result", 503);
}
function identifier(v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) throw new AccessError("invalid_identifier", 422);
  return v;
}
function shape(value: unknown, required: readonly string[] = []): NativeObject {
  if (
    !object(value) || Object.keys(value).length !== required.length ||
    required.some((k) => !Object.hasOwn(value, k))
  ) throw new AccessError("invalid_request", 422);
  return value;
}
function context(value: NativeJson | undefined): NativeObject {
  if (!object(value)) invalid();
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "profile"));
}
function score(value: NativeJson | undefined): Rational {
  try {
    if (typeof value !== "string") return invalid();
    const f = /^([+-]?[0-9]+)\/([+-]?[0-9]+)$/.exec(value);
    return f ? new Rational(BigInt(f[1]), BigInt(f[2])) : exact(value);
  } catch {
    return invalid();
  }
}
function map(value: NativeJson | undefined): NativeObject {
  if (!object(value)) invalid();
  return value;
}
export class ReportActionService implements ApiBusinessPort {
  constructor(
    private readonly repository: PlatformRepositoryPort,
    private readonly catalog: CatalogService,
    private readonly clock: RequestClockPort,
  ) {}
  private fresh(session: SessionSnapshot): bigint {
    if (
      !session?.user || typeof session.user.subjectId !== "string" ||
      typeof session.user.expiresAtUtc !== "bigint"
    ) throw new AccessError("authentication_required", 401);
    const now = this.clock.nowUtc();
    sessionDto(session, now);
    if (session.tier !== "paid") throw new AccessError("paid_required", 403);
    return now;
  }
  async execute(request: ApiExecution): Promise<NativeObject> {
    const { operation: op, session, params, body, query } = request;
    if (!REPORT_ACTION_OPERATIONS.includes(op as typeof REPORT_ACTION_OPERATIONS[number])) {
      throw new AccessError("route_not_found", 404);
    }
    this.fresh(session);
    const rid = identifier(params.report_id);
    await authorizeReport(session.user, rid, {
      find: (id) => this.repository.lookupAccess(session.user.subjectId, id),
    }, op === "statistics.read");
    shape(query);
    let key: string | null = null, digest: string | null = null;
    if (op === "shortlist.update") {
      key = identifier(request.requestKey);
      digest = await nativeJsonSha256([body, params]);
      const replay = await this.repository.replay(session.user.subjectId, op, key, digest);
      if (replay !== null) {
        if (!("body" in replay) || replay.owner_id !== session.user.subjectId) invalid();
        this.fresh(session);
        return reportDto(session, replay);
      }
    }
    const record = await this.repository.getReport(session.user.subjectId, rid);
    if (record === null) throw new AccessError("report_not_found", 404);
    if (record.owner_id !== session.user.subjectId) invalid();
    const oid = identifier(params.offering_id);
    if (op === "statistics.read") {
      shape(body);
      const result = await this.statistics(session, record, oid);
      this.fresh(session);
      return result;
    }
    const input = shape(body, ["selected", "expected_version"]);
    if (typeof input.selected !== "boolean") throw new AccessError("invalid_selection", 422);
    const expected = input.expected_version;
    if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 1) {
      throw new AccessError("invalid_revision", 422);
    }
    if (record.revision !== expected) throw new AccessError("revision_conflict", 409);
    const release = await this.catalog.catalog();
    if (release === null) throw new AccessError("catalog_release_missing", 503);
    const target = this.catalog.offering(release, oid);
    const updated = cloneNativeJson(record.body),
      shortlist = map(updated.shortlist),
      analyses = map(updated.analyses),
      old = shortlist[oid];
    const noOp = object(old) && old.selected === input.selected;
    if (!noOp && input.selected) {
      const others = Object.entries(shortlist).filter(([id, row]) =>
        id !== oid && object(row) && row.selected === true
      ).map(([id]) => id);
      const groups = await this.groupsOf(session.user.subjectId, release, target, others);
      if (others.filter((id) => groups.get(id) === target.group).length >= SHORTLIST_GROUP_LIMIT) {
        throw new AccessError("shortlist_limit_exceeded", 409);
      }
    }
    if (!noOp) {
      const assessment = analyses[oid];
      shortlist[oid] = {
        selected: input.selected,
        changed_at: utcText(this.fresh(session)),
        assessment_status: object(assessment) ? assessment.status ?? "pending" : "pending",
        profile_id: record.profile_id,
        catalog_version: release.version,
      };
    }
    const written = await this.repository.writeReport({
      owner: session.user.subjectId,
      reportId: rid,
      profileId: record.profile_id,
      body: updated,
      expected,
      nowUtc: this.fresh(session),
      operation: "shortlist.update",
      key: key!,
      digest: digest!,
      noOp,
    });
    this.fresh(session);
    return reportDto(session, written);
  }
  /** 이미 담긴 모집단위의 모집군. 운영 카탈로그는 요청한 모집단위만 조회하므로(전국 목록을 들고 있지 않다)
   * 목록에 없는 것은 선택 조회로 읽는다. 지금 카탈로그에서 찾을 수 없는 것은 세지 않는다. */
  private async groupsOf(
    owner: string,
    release: Awaited<ReturnType<CatalogService["catalog"]>> & object,
    target: NativeObject,
    ids: readonly string[],
  ): Promise<Map<string, NativeJson | undefined>> {
    const groups = new Map<string, NativeJson | undefined>();
    const wanted = new Set(ids);
    for (const row of this.catalog.serviceRows(release)) {
      if (typeof row.offering_id === "string" && wanted.has(row.offering_id)) {
        groups.set(row.offering_id, row.group);
      }
    }
    const missing = ids.filter((id) => !groups.has(id) && ID.test(id)),
      year = Number(target.academic_year);
    if (!missing.length || !Number.isSafeInteger(year)) return groups;
    const read = async (part: readonly string[]) => {
      for (const [id, row] of await this.catalog.selectedOfferings(owner, year, part)) {
        groups.set(id, row.group);
      }
    };
    for (let at = 0; at < missing.length; at += 100) {
      const part = missing.slice(at, at + 100);
      try {
        await read(part);
      } catch (e) {
        if (!(e instanceof AccessError)) throw e;
        if (e.code === "operation_scope_not_approved") return groups;
        // 묶음 안에 지금 카탈로그에 없는 것이 섞여 있으면 하나씩 읽어 있는 것만 센다
        for (const id of part) {
          try {
            await read([id]);
          } catch (x) {
            if (!(x instanceof AccessError)) throw x;
          }
        }
      }
    }
    return groups;
  }
  private async statistics(
    session: SessionSnapshot,
    record: StoredReport,
    oid: string,
  ): Promise<NativeObject> {
    const analyses = map(record.body.analyses), own = analyses[oid];
    const base: NativeObject = {
      status: "pending",
      reason_code: "compatible_analysis_missing",
      recommended_count: null,
      selected_count: null,
      recommended_rank: null,
      selected_rank: null,
      updated_at: utcText(this.fresh(session)),
      scope: "service_users_not_actual_university_applicants",
    };
    if (!object(own) || own.status !== "ready") return base;
    const versions = context(own.versions), signature = nativeJsonText(versions, true);
    const current = [...await this.repository.activeReports(session.user.subjectId)];
    current.sort((a, b) => {
      const d = utcInstant(a.updated_at) - utcInstant(b.updated_at);
      return d < 0n ? -1 : d > 0n ? 1 : unicodeCompare(a.report_id, b.report_id);
    });
    const students = new Map<string, StoredReport>();
    for (const report of current) students.set(report.owner_id, report);
    const recommended: { owner: string; score: Rational }[] = [],
      selected: { owner: string; score: Rational }[] = [];
    for (const report of students.values()) {
      const assessment = map(report.body.analyses)[oid];
      if (!object(assessment) || assessment.status !== "ready") continue;
      if (nativeJsonText(context(assessment.versions), true) !== signature) continue;
      const value = score(assessment.converted_score), candidates = report.body.candidates ?? {};
      if (!object(candidates)) invalid();
      const groups = candidates.basic_university_groups ?? [];
      if (!Array.isArray(groups)) invalid();
      let listed = false;
      for (const group of groups) {
        if (!object(group) || !Array.isArray(group.offerings)) invalid();
        for (const item of group.offerings) {
          if (!object(item) || !object(item.offering)) invalid();
          if (item.offering.offering_id === oid) listed = true;
        }
      }
      if (listed) recommended.push({ owner: report.owner_id, score: value });
      const selection = map(report.body.shortlist)[oid];
      if (
        object(selection) && selection.selected === true &&
        selection.profile_id === report.profile_id && selection.assessment_status === "ready"
      ) selected.push({ owner: report.owner_id, score: value });
    }
    function rank(rows: { owner: string; score: Rational }[]): NativeObject | null {
      const own = rows.find((r) => r.owner === record.owner_id);
      if (!own) return null;
      return {
        rank: 1 + rows.filter((r) => r.score.compare(own.score) > 0).length,
        tie_count: rows.filter((r) => r.score.compare(own.score) === 0).length,
        population_count: rows.length,
        tie_policy: "competition",
      };
    }
    return {
      ...base,
      status: "ready",
      reason_code: null,
      recommended_count: recommended.length,
      selected_count: selected.length,
      recommended_rank: rank(recommended),
      selected_rank: rank(selected),
      versions,
    };
  }
}
