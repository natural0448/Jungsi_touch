import "server-only";
import { cookies } from "next/headers";
import type { CatalogSearchDto, OfferingDto } from "@/lib/dto";
import { AccessDenied, type JungsiSource, type Result } from "./source";
import * as fc from "./synthetic-forecast";
import { CATALOG, statistics } from "./synthetic-assessment";
import { HISTORY, syntheticRecruitment } from "./synthetic-history";
import { analyzeIds, assessFor, buildCands, inputUsed, listOwn, sameProfileKey, loadReport, saveProfile, saveReport, setPick, validateScores } from "./synthetic-report";
import { syntheticSnapshotHead, syntheticSnapshotPart } from "./synthetic-snapshot";
import { CSAT_EXAM, MOCK_EXAM, csatOpen, csatOpensAt } from "@/lib/exam";

/*
  HTTP 핸들러 연결 전 화면 제작용 합성 응답(프레젠테이션 작업 인계: '명시적인 합성 응답').
  응답 모양은 develop 의 API_DTO 계약과 같다. 실제 계산·로그인·자료 연결이 아니다.
  보기 상태(일반·유료·성적 없음)와 성적·리포트는 이 브라우저 쿠키에만 남는다. 권한이 아니다.
*/

export const SYN_COOKIE = { state: "jt_syn_state", stage: "jt_syn_stage" } as const;
export type SyntheticState = "paid" | "noscore" | "standard" | "operator" | "guest";
export const SYN_STATES: { v: SyntheticState; label: string }[] = [
  { v: "paid", label: "유료 회원" },
  { v: "noscore", label: "유료 · 성적 없음" },
  { v: "standard", label: "일반 회원" },
  { v: "operator", label: "운영자(일반 회원 + 관리 권한)" },
  { v: "guest", label: "비회원" },
];

/** 합성 응답의 성적 입력 단계 미리보기(2026-11-12 수능 가채점·실채점 화면). 기본은 지금 운영과 같은 9월 모의평가 */
export type SyntheticStage = "mock" | "provisional" | "final_locked" | "final";
export const SYN_STAGES: { v: SyntheticStage; label: string }[] = [
  { v: "mock", label: "9월 모의평가" },
  { v: "provisional", label: "수능 가채점" },
  { v: "final_locked", label: "실채점 배부 전" },
  { v: "final", label: "수능 실채점" },
];
export async function readSyntheticStage(): Promise<SyntheticStage> {
  const v = (await cookies()).get(SYN_COOKIE.stage)?.value;
  return SYN_STAGES.some((s) => s.v === v) ? (v as SyntheticStage) : "mock";
}

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
    // 정시터치 2027 시즌 마지막 이용일(2027-01-08 0시 종료, 2026-10-29 사용자 결정): 2027-01-07 23:59:59 서울 = 14:59:59 UTC
    return { format: "jungsi.session/v1", member_tier: "paid", entitlement_expires_at: "2027-01-07T14:59:59Z" };
  },

  async searchHistory(_caller, q) {
    await requireMember();
    const key = ["h", q.academic_year, norm(q.university_q), norm(q.department_q), q.region, q.group].join("|");
    return page(match(HISTORY, q), key, q.cursor, q.limit ?? 50);
  },

  async readSnapshotHead() {
    await requireMember();
    return syntheticSnapshotHead();
  },

  async readSnapshotPart(_caller, snapshotId, partId) {
    await requireMember();
    return syntheticSnapshotPart(snapshotId, partId);
  },

  async listOwnReports(_caller, q) {
    await requireMember();
    return { format: "jungsi.own-report-list/v1", items: await listOwn(q.exam_id), next_cursor: null, has_more: false };
  },

  async readScoreInputStatus(_caller, examId, stage) {
    const s = await requireMember();
    const paid = s === "paid" || s === "noscore";
    // 수능 가채점 시험(전환 뒤 지금 시험): 9월 모의평가와 입력 횟수·현재 리포트를 따로 센다(운영 정책과 같음).
    // 입력 창은 운영 설정과 같이 2026-12-10T15:00Z 전까지(끝 시각 제외)
    if (examId === CSAT_EXAM.exam_id) {
      const used = await inputUsed("provisional");
      const spent = used.profileId ? 1 : 0;
      return {
        format: "jungsi.score-input-status/v1",
        exam_id: examId,
        pack_version: CSAT_EXAM.pack_version,
        academic_year: 2027,
        stage: "provisional",
        stage_state: "open",
        opens_at: csatOpensAt().toISOString().replace(".000Z", "Z"),
        closes_at: "2026-12-10T15:00:00Z",
        paid_input_allowed: paid,
        input_limit_mode: "stage_rights",
        initial_used: spent,
        initial_remaining: 1 - spent,
        correction_granted: 0,
        correction_used: 0,
        correction_request_remaining: 1,
        effective_save_remaining: paid ? 1 - spent : 0,
        entry_version: spent,
        current_profile_id: used.profileId,
        current_report_id: used.reportId,
        last_attempt_outcome: spent ? "accepted" : null,
        last_rejection_code: null,
        legacy_transition_status: "ready",
      };
    }
    const used = await inputUsed();
    const syn = await readSyntheticStage();
    const locked = !stage && syn === "final_locked";
    // 입력 횟수와 현재 리포트는 단계마다 따로다(운영 정책과 같음). 합성 저장 성적은 모두 9월 모의평가 단계로 본다
    const sameStage = syn === "mock";
    const spent = used.profileId && sameStage ? 1 : 0;
    // 전환 뒤 9월 모의평가 단계는 닫힌다(운영 window.mode=closed). 저장된 9월 리포트는 읽기만 한다
    const mockClosed = sameStage && csatOpen();
    return {
      format: "jungsi.score-input-status/v1",
      exam_id: examId,
      pack_version: MOCK_EXAM.pack_version,
      academic_year: 2027,
      stage: stage ?? (syn === "final_locked" ? "final" : syn),
      stage_state: locked ? "not_open" : mockClosed ? "closed" : "open",
      // 합성 실채점 개방 시각 = 2026-12-14(월) 0시(성적표 배부 12-11 금 + 3일, 2026-11-13 최종관리자 결정). 실제 시각은 서버 설정이 정한다
      opens_at: locked ? "2026-12-13T15:00:00Z" : null,
      closes_at: mockClosed ? csatOpensAt().toISOString().replace(".000Z", "Z") : null,
      paid_input_allowed: paid,
      input_limit_mode: "stage_rights",
      initial_used: spent,
      initial_remaining: 1 - spent,
      correction_granted: 0,
      correction_used: 0,
      correction_request_remaining: 1,
      effective_save_remaining: paid ? 1 - spent : 0,
      entry_version: spent,
      current_profile_id: sameStage ? used.profileId : null,
      current_report_id: sameStage ? used.reportId : null,
      last_attempt_outcome: spent ? "accepted" : null,
      last_rejection_code: null,
      legacy_transition_status: "ready",
    };
  },

  async grantScoreCorrection() {
    // 합성 모드에는 고객센터 정정 대상이 없다 — 연결 대기로 보인다
    return { ok: false, code: "correction_not_available_in_synthetic", status: 503 };
  },

  async readReportSample() {
    await requireMember();
    return {
      format: "jungsi.sample-report/v1",
      synthetic: true,
      sample_id: "SYNTHETIC-virtual386-v1",
      label: "가상 학생 고정 견본",
      report: {
        format: "jungsi.sample-analysis/v1",
        source_kind: "synthetic",
        total_standard_score: 386,
        subjects: [{ area: "korean", standard_score: 120 }, { area: "math", standard_score: 130 }, { area: "inquiry1", standard_score: 68 }, { area: "inquiry2", standard_score: 68 }],
        overall: { status: "pending", reason_code: "sample_no_population", top_percent: null },
        input_editable: false,
        persisted: false,
      },
    };
  },

  async readRecruitment(_caller, offeringId) {
    await requireMember();
    return syntheticRecruitment(offeringId);
  },

  async createScoreProfile(_caller, scores, confirmed, key, stage) {
    const s = await requireMember();
    // 결합 20 정책: 성적 입력은 유료 회원만, 시험 단계마다 1회(같은 요청 키 재시도는 처음 결과)
    if (s === "standard" || s === "operator") return { ok: false, code: "paid_required", status: 403 };
    const st = stage === "provisional" || "raw_score" in scores.korean ? "provisional" : "mock";
    // 전환 뒤 9월 모의평가 새 입력은 서버처럼 409 로 거절한다(입력 횟수를 쓰지 않는다)
    if (st === "mock" && csatOpen()) return { ok: false, code: "score_stage_closed", status: 409 };
    const used = await inputUsed(st);
    if (used.profileId && !(await sameProfileKey(key, st))) return { ok: false, code: "score_input_exhausted", status: 409 };
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
