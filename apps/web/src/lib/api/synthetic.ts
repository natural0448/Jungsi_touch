import "server-only";
import { cookies } from "next/headers";
import type { CatalogSearchDto, OfferingDto } from "@/lib/dto";
import { AccessDenied, type JungsiSource, type Result } from "./source";
import * as fc from "./synthetic-forecast";
import { CATALOG, statistics } from "./synthetic-assessment";
import { HISTORY, syntheticRecruitment } from "./synthetic-history";
import { analyzeIds, assessFor, buildCands, loadReport, saveProfile, saveReport, setPick, validateScores } from "./synthetic-report";

/*
  HTTP 핸들러 연결 전 화면 제작용 합성 응답(프레젠테이션 작업 인계: '명시적인 합성 응답').
  응답 모양은 develop 의 API_DTO 계약과 같다. 실제 계산·로그인·자료 연결이 아니다.
  보기 상태(일반·유료·성적 없음)와 성적·리포트는 이 브라우저 쿠키에만 남는다. 권한이 아니다.
*/

export const SYN_COOKIE = { state: "jt_syn_state" } as const;
export type SyntheticState = "paid" | "noscore" | "standard" | "operator" | "guest";
export const SYN_STATES: { v: SyntheticState; label: string }[] = [
  { v: "paid", label: "유료 회원" },
  { v: "noscore", label: "유료 · 성적 없음" },
  { v: "standard", label: "일반 회원" },
  { v: "operator", label: "운영자(일반 회원 + 관리 권한)" },
  { v: "guest", label: "비회원" },
];

export async function readSyntheticState(): Promise<SyntheticState> {
  const v = (await cookies()).get(SYN_COOKIE.state)?.value;
  return SYN_STATES.some((s) => s.v === v) ? (v as SyntheticState) : "paid";
}

const norm = (v?: string) => v?.replace(/\s/g, "") || undefined;

async function requireMember() {
  const s = await readSyntheticState();
  if (s === "guest") throw new AccessDenied(401, "authentication_required");
  return s;
}

async function requirePaid() {
  const s = await requireMember();
  if (s === "standard" || s === "operator") throw new AccessDenied(403, "paid_required");
  return s;
}

/** 서버의 실패 코드 → HTTP 상태(계약의 오류 표) */
function fail<T>(code: string): Result<T> {
  const status = ["revision_conflict", "score_confirmation_required", "idempotency_conflict", "cursor_version_mismatch"].includes(code)
    ? 409
    : code.endsWith("_not_found")
      ? 404
      : 422;
  return { ok: false, code, status };
}

/** catalog_search 공통: 조건은 같은 모집행에 AND, 커서는 조건과 위치를 함께 묶는다 */
function page<T extends OfferingDto>(rows: T[], key: string, cursor: string | undefined, limit: number): CatalogSearchDto<T> {
  const [ck, co] = (cursor ?? "").split("@");
  const start = ck === key && Number(co) > 0 ? Number(co) : 0;
  const end = start + Math.max(1, Math.min(100, limit));
  return {
    status: "ready",
    reason_code: null,
    items: rows.slice(start, end),
    matching_offering_count: new Set(rows.map((r) => r.offering_id)).size,
    matching_school_count: new Set(rows.map((r) => r.university_id)).size,
    catalog_version: "SYNTHETIC-catalog-v1",
    as_of: "2026-09-10",
    next_cursor: end < rows.length ? `${key}@${end}` : null,
  };
}

function match<T extends OfferingDto>(rows: T[], q: { academic_year?: number; university_q?: string; department_q?: string; region?: string; group?: string }) {
  const u = norm(q.university_q);
  const d = norm(q.department_q);
  return rows.filter(
    (h) =>
      (!q.academic_year || h.academic_year === q.academic_year) &&
      (!u || h.university_name.replace(/\s/g, "").includes(u)) &&
      (!d || h.department.replace(/\s/g, "").includes(d)) &&
      (!q.region || h.region === q.region) &&
      (!q.group || h.group === q.group),
  );
}

export const syntheticSource: JungsiSource = {
  kind: "synthetic",

  async getSession() {
    const s = await readSyntheticState();
    if (s === "guest") return null;
    if (s === "standard" || s === "operator") return { format: "jungsi.session/v1", member_tier: "standard", entitlement_expires_at: null };
    // 2027-02-28 23:59:59 서울 = 14:59:59 UTC
    return { format: "jungsi.session/v1", member_tier: "paid", entitlement_expires_at: "2027-02-28T14:59:59Z" };
  },

  async searchHistory(_caller, q) {
    await requireMember();
    const key = ["h", q.academic_year, norm(q.university_q), norm(q.department_q), q.region, q.group].join("|");
    return page(match(HISTORY, q), key, q.cursor, q.limit ?? 50);
  },

  async readRecruitment(_caller, offeringId) {
    await requireMember();
    return syntheticRecruitment(offeringId);
  },

  async createScoreProfile(_caller, scores, confirmed, key) {
    await requireMember();
    const bad = validateScores(scores);
    if (bad) return { ok: false, code: bad, status: bad === "pack_version_mismatch" ? 409 : 422 };
    return { ok: true, value: await saveProfile(scores, confirmed, key) };
  },

  async analyzeOverall(_caller, body, key) {
    await requireMember();
    const r = await saveReport(body.profile_id, key, body.report_id, body.expected_version);
    return typeof r === "string" ? fail(r) : { ok: true, value: r };
  },

  async readReport(_caller, reportId) {
    const s = await requireMember();
    if (s === "noscore") return null; // '성적 없음' 보기: 이 기기에 리포트가 없는 상태
    return loadReport(reportId, s === "paid");
  },

  async exportReport(_caller, reportId) {
    const s = await requirePaid();
    if (s === "noscore") return null;
    const report = await loadReport(reportId, true);
    if (!report) return null;
    return { format: "jungsi.counseling-snapshot/v1", status: "ready", snapshot_version: report.report_version, generated_at: report.updated_at, report };
  },

  async searchOfferings(_caller, q) {
    await requirePaid();
    const key = ["o", q.academic_year, norm(q.university_q), norm(q.department_q), q.region, q.group].join("|");
    return page(match(CATALOG, q), key, q.cursor, q.limit ?? 50);
  },

  async readOffering(_caller, offeringId) {
    await requirePaid();
    const o = CATALOG.find((x) => x.offering_id === offeringId);
    return o ? { status: "ready", reason_code: null, offering: o, catalog_version: "SYNTHETIC-catalog-v1" } : null;
  },

  async analyzeUniversities(_caller, reportId, expected, ids, key) {
    await requirePaid();
    const r = await analyzeIds(reportId, expected, ids, key);
    return typeof r === "string" ? fail(r) : { ok: true, value: r };
  },

  async buildCandidates(_caller, reportId, expected, key) {
    await requirePaid();
    const r = await buildCands(reportId, expected, key);
    return typeof r === "string" ? fail(r) : { ok: true, value: r };
  },

  async updateShortlist(_caller, reportId, offeringId, selected, expected, key) {
    await requirePaid();
    const r = await setPick(reportId, offeringId, selected, expected, key);
    return typeof r === "string" ? fail(r) : { ok: true, value: r };
  },

  async readStatistics(_caller, reportId, offeringId) {
    await requirePaid();
    const report = await loadReport(reportId, true);
    if (!report) return null;
    // 화면을 그리는 중 채운 분석은 합성 쿠키에 남지 않으므로 성적으로 다시 계산한다
    const a = report.analyses?.[offeringId] ?? (await assessFor(reportId, offeringId)) ?? undefined;
    const listed = a?.status === "ready" && ["challenge", "core", "room"].includes(a.category);
    const picked = report.shortlist?.[offeringId]?.selected === true;
    return statistics(offeringId, a, listed, picked);
  },

  async readForecastCapabilities() {
    const s = await requireMember();
    return fc.capabilities(s === "operator");
  },
  async listForecastDrafts(_caller, universityId) {
    await requireOperator();
    return { format: "jungsi.forecast-list/v1", items: await fc.list(universityId) };
  },
  async readForecastDraft(_caller, id) {
    await requireOperator();
    return fc.read(id);
  },
  async createForecastDraft(_caller, offeringId, body, key) {
    await requireOperator();
    return done(await fc.create(offeringId, body, key));
  },
  async adjustForecastDraft(_caller, id, body, key) {
    await requireOperator();
    return done(await fc.adjust(id, body, key));
  },
  async validateForecastDraft(_caller, id, body, key) {
    await requireOperator();
    return done(await fc.validate(id, body, key));
  },
  async approveForecastDraft(_caller, id, body, key) {
    await requireOperator();
    return done(await fc.approve(id, body, key));
  },
  async publishForecastDraft(_caller, id, body, key) {
    await requireOperator();
    return done(await fc.publish(id, body, key));
  },
  async readPublishedForecast(_caller, offeringId) {
    await requirePaid();
    return fc.published(offeringId);
  },
};

/** 관리 작업: 회원 등급이 아니라 관리 권한으로 막는다(서버의 ForecastAuthorityRepository 흉내) */
async function requireOperator() {
  const s = await requireMember();
  if (s !== "operator") throw new AccessDenied(403, "forecast_permission_denied");
}

function done<T extends object>(r: T | { code: string; status: number }): Result<T> {
  return "code" in r && "status" in r && typeof (r as { status: unknown }).status === "number" && !("format" in r)
    ? { ok: false, code: (r as { code: string }).code, status: (r as { status: number }).status }
    : { ok: true, value: r as T };
}
