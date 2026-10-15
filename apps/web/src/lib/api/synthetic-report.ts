import "server-only";
import { cookies } from "next/headers";
import type { AssessmentDto, ComboPositionDto, OverallAnalysisDto, ProfileDto, ReportDto, ScoresInput, ShortlistEntryDto, SubjectResultDto } from "@/lib/dto";
import { CATALOG, assess, buildCandidates } from "./synthetic-assessment";
import { EXAM, INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES } from "@/lib/exam";

/*
  2페이지 합성 응답 — 성적 프로필과 리포트를 이 브라우저 쿠키에만 둔다.
  누적 위치와 등급은 화면 확인용으로 지어낸 곡선이다. 실제 분포·엔진 계산이 아니다.
  응답 모양은 실제 DTO(lib/dto.ts)와 같다.
*/

const OPT = { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };
const C = { profile: "jt_syn_profile", report: "jt_syn_report" } as const;

type StoredProfile = ProfileDto & { scores: ScoresInput; key: string };
type StoredReport = {
  report_id: string; report_version: number; profile_id: string; updated_at: string; key: string;
  keys?: string[]; // 최근 요청 키(같은 키의 재시도는 다시 쓰지 않는다)
  analyzed?: string[]; // university.analyze 로 분석한 모집행
  candidates_built?: boolean;
  shortlist?: Record<string, ShortlistEntryDto>;
};

const INQ = new Set(INQUIRY_SUBJECTS.flatMap((g) => g.subjects));

/** 서버 엔진처럼 입력을 검사한다. 오류 코드는 실제 계약의 이름을 쓴다 */
export function validateScores(s: ScoresInput): string | null {
  if (s.exam_id !== EXAM.exam_id || s.pack_version !== EXAM.pack_version) return "pack_version_mismatch";
  const std = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!std(s.korean.standard_score, 40, 160) || !std(s.math.standard_score, 40, 160)) return "engine_input_code";
  if (s.korean.choice && !(KOREAN_CHOICES as readonly string[]).includes(s.korean.choice)) return "invalid_choice";
  if (s.math.choice && !(MATH_CHOICES as readonly string[]).includes(s.math.choice)) return "invalid_choice";
  if (s.inquiry.length !== 2) return "invalid_request";
  if (s.inquiry[0].subject === s.inquiry[1].subject) return "duplicate_inquiry";
  for (const q of s.inquiry) {
    if (!INQ.has(q.subject)) return "invalid_subject";
    if (!std(q.standard_score, 20, 80)) return "engine_input_code";
  }
  for (const g of [s.english_grade, s.korean_history_grade]) if (g !== undefined && !std(g, 1, 9)) return "engine_input_code";
  return null;
}

const pct = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
/** 지어낸 누적 곡선: 표준점수가 높을수록 위쪽 비율이 작아진다 */
const curve = (v: number, mid: number, spread: number) => 100 / (1 + Math.exp((v - mid) / spread));
const grade = (top: number) => [4, 11, 23, 40, 60, 77, 89, 96].findIndex((cut) => top <= cut) + 1 || 9;

function subject(area: SubjectResultDto["area"], name: string, choice: string | null, v: number, mid: number, spread: number): SubjectResultDto {
  const top = curve(v, mid, spread);
  return { area, subject: name, choice, standard_score: v, grade: grade(top), top_percent_exclusive: pct(Math.max(0, top - 0.3)), top_percent_inclusive: pct(top), basis: "합성 곡선(화면 확인용)" };
}

export function computeOverall(s: ScoresInput): OverallAnalysisDto {
  const total = s.korean.standard_score + s.math.standard_score + s.inquiry[0].standard_score + s.inquiry[1].standard_score;
  const inc = curve(total, 307, 22);
  const tie = 0.04;
  const exc = Math.max(0, inc - tie);
  return {
    format: "jungsi.overall-analysis/v1",
    exam: { exam_id: s.exam_id, academic_year: 2027, exam_type: "9월 모의평가" },
    pack_version: s.pack_version,
    score_basis: "국어·수학·탐구 2과목 표준점수 합",
    total_standard_score: total,
    subjects: [
      subject("korean", "국어", s.korean.choice ?? null, s.korean.standard_score, 105, 9),
      subject("math", "수학", s.math.choice ?? null, s.math.standard_score, 108, 10),
      subject("inquiry1", s.inquiry[0].subject, null, s.inquiry[0].standard_score, 52, 5),
      subject("inquiry2", s.inquiry[1].subject, null, s.inquiry[1].standard_score, 52, 5),
    ],
    absolute_grades: {
      ...(s.english_grade !== undefined ? { 영어: s.english_grade } : {}),
      ...(s.korean_history_grade !== undefined ? { 한국사: s.korean_history_grade } : {}),
    },
    // 반영 조합별 위치(제안 필드 미리보기, 최종 관리자 확정 7조합).
    // 탐구 1과목 = 두 과목 중 상위, 2과목 = 평균. 합성 곡선으로 모양만 보여 준다(실연결은 서버 값만).
    combinations: ((): ComboPositionDto[] => {
      const combo = (combo_id: string, label: string, total: number, mid: number, spread: number): ComboPositionDto => {
        const top = curve(total, mid, spread);
        return {
          combo_id, label, total_standard_score: Math.round(total * 10) / 10,
          status: "estimated", reason_code: null,
          inclusive_top_percent: pct(top), exclusive_top_percent: pct(Math.max(0, top - 0.05)),
          data_kind: "estimated_weights",
        };
      };
      const k = s.korean.standard_score, m = s.math.standard_score;
      const hi = Math.max(s.inquiry[0].standard_score, s.inquiry[1].standard_score);
      const avg = (s.inquiry[0].standard_score + s.inquiry[1].standard_score) / 2;
      return [
        combo("korean_math", "국어+수학", k + m, 212, 16),
        combo("korean_math_inq1", "국어+수학+탐구(1과목)", k + m + hi, 266, 19),
        combo("korean_math_inq_avg", "국어+수학+탐구(2과목 평균)", k + m + avg, 264, 19),
        combo("korean_inq1", "국어+탐구(1과목)", k + hi, 159, 11),
        combo("korean_inq_avg", "국어+탐구(2과목 평균)", k + avg, 157, 11),
        combo("math_inq1", "수학+탐구(1과목)", m + hi, 162, 12),
        combo("math_inq_avg", "수학+탐구(2과목 평균)", m + avg, 160, 12),
      ];
    })(),
    overall: {
      status: "estimated",
      reason_code: null,
      top_percent: pct(inc),
      inclusive_top_percent: pct(inc),
      exclusive_top_percent: pct(exc),
      tie_share_percent: pct(tie),
      tie_interval_percent: { lower: pct(exc), upper: pct(inc) },
      tie_policy: "include_equal",
      population_id: "SYNTHETIC-2027-09-KMI2",
      model_version: "SYNTHETIC-curve-v1",
      data_kind: "estimated_weights",
    },
  };
}

async function read<T>(name: string): Promise<T | null> {
  try {
    const raw = (await cookies()).get(name)?.value;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function saveProfile(scores: ScoresInput, confirmed: boolean, key: string): Promise<ProfileDto> {
  const prev = await read<StoredProfile>(C.profile);
  if (prev && prev.key === key) return strip(prev); // 같은 요청 키는 처음 결과를 돌려준다(멱등)
  const n = (prev?.profile_version ?? 0) + 1;
  const p: StoredProfile = { profile_id: `syn-profile-${n}`, profile_version: n, confirmed, created_at: new Date().toISOString(), scores, key };
  (await cookies()).set(C.profile, JSON.stringify(p), OPT);
  return strip(p);
}

function strip(p: StoredProfile): ProfileDto {
  return { profile_id: p.profile_id, profile_version: p.profile_version, confirmed: p.confirmed, created_at: p.created_at };
}

type Fail = "profile_not_found" | "revision_conflict" | "report_not_found" | "invalid_offering_ids" | "offering_not_found" | "score_confirmation_required";

export async function saveReport(profileId: string, key: string, reportId?: string, expected?: number): Promise<ReportDto | Fail> {
  const profile = await read<StoredProfile>(C.profile);
  if (!profile || profile.profile_id !== profileId) return "profile_not_found";
  const prev = await read<StoredReport>(C.report);
  if (prev && (prev.keys ?? [prev.key]).includes(key)) return build(prev, profile, true);
  let next: StoredReport;
  const now = new Date().toISOString();
  if (reportId) {
    if (!prev || prev.report_id !== reportId) return "report_not_found";
    if (prev.report_version !== expected) return "revision_conflict";
    // 성적이 바뀌면 분석·후보는 비우고, 담은 학교는 남기되 다시 확인 필요로 둔다
    const shortlist = Object.fromEntries(Object.entries(prev.shortlist ?? {}).map(([k, v]) => [k, { ...v, assessment_status: "needs_revalidation" }]));
    next = { ...prev, report_version: prev.report_version + 1, profile_id: profileId, updated_at: now, key, keys: remember(prev, key), analyzed: [], candidates_built: false, shortlist };
  } else {
    next = { report_id: `syn-report-${Date.now().toString(36)}`, report_version: 1, profile_id: profileId, updated_at: now, key, keys: [key], analyzed: [], candidates_built: false, shortlist: {} };
  }
  (await cookies()).set(C.report, JSON.stringify(next), OPT);
  return build(next, profile, true);
}

const remember = (r: StoredReport, key: string) => [...(r.keys ?? [r.key]), key].slice(-12);

/** 리포트를 고치는 쓰기 공통: 소유·revision·멱등을 실제 서버처럼 확인한다 */
async function mutate(reportId: string, expected: number, key: string, change: (r: StoredReport, p: StoredProfile) => StoredReport | Fail): Promise<ReportDto | Fail> {
  const prev = await read<StoredReport>(C.report);
  const profile = await read<StoredProfile>(C.profile);
  if (!prev || !profile || prev.report_id !== reportId) return "report_not_found";
  if ((prev.keys ?? [prev.key]).includes(key)) return build(prev, profile, true);
  if (prev.report_version !== expected) return "revision_conflict";
  if (!profile.confirmed) return "score_confirmation_required";
  const next = change(prev, profile);
  if (typeof next === "string") return next;
  const saved = { ...next, report_version: prev.report_version + 1, updated_at: new Date().toISOString(), key, keys: remember(prev, key) };
  // 실제 API 는 서버에 저장한다. 합성은 쿠키에 두는데, 화면을 그리는 중(3·4페이지가 분석을 채울 때)에는
  // 쿠키를 쓸 수 없어 이번 응답에만 반영한다. 결정적 계산이라 다음 화면에서 같은 값이 다시 나온다
  try {
    (await cookies()).set(C.report, JSON.stringify(saved), OPT);
  } catch {}
  return build(saved, profile, true);
}

export function analyzeIds(reportId: string, expected: number, ids: string[], key: string) {
  return mutate(reportId, expected, key, (r) => {
    if (ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length) return "invalid_offering_ids";
    if (ids.some((id) => !CATALOG.some((o) => o.offering_id === id))) return "offering_not_found";
    return { ...r, analyzed: Array.from(new Set([...(r.analyzed ?? []), ...ids])) };
  });
}

export function buildCands(reportId: string, expected: number, key: string) {
  return mutate(reportId, expected, key, (r) => ({ ...r, analyzed: CATALOG.map((o) => o.offering_id), candidates_built: true }));
}

export function setPick(reportId: string, offeringId: string, selected: boolean, expected: number, key: string) {
  return mutate(reportId, expected, key, (r, p) => {
    if (!CATALOG.some((o) => o.offering_id === offeringId)) return "offering_not_found";
    const old = r.shortlist?.[offeringId];
    if (old && old.selected === selected) return r; // 같은 상태 쓰기
    // 담는 곳은 화면에서 분석을 본 모집행이다. 합성은 그 분석을 렌더링 중에 저장하지 못하므로 여기서 함께 남긴다
    const a = analysesFor(p.scores, [offeringId])[offeringId];
    const analyzed = Array.from(new Set([...(r.analyzed ?? []), offeringId]));
    return { ...r, analyzed, shortlist: { ...(r.shortlist ?? {}), [offeringId]: { selected, changed_at: new Date().toISOString(), assessment_status: a?.status ?? "pending", profile_id: p.profile_id, catalog_version: "SYNTHETIC-catalog-v1" } } };
  });
}

/** paid=false 면 유료 필드(analyses·candidates·shortlist)를 뺀다(일반 회원 응답) */
export async function loadReport(reportId: string, paid = true): Promise<ReportDto | null> {
  const prev = await read<StoredReport>(C.report);
  const profile = await read<StoredProfile>(C.profile);
  if (!prev || !profile || prev.report_id !== reportId || prev.profile_id !== profile.profile_id) return null;
  return build(prev, profile, paid);
}

/** 합성 집계용: 리포트 성적으로 모집행 하나를 바로 분석한다(실제 API 는 서버에 저장된 분석을 쓴다) */
export async function assessFor(reportId: string, offeringId: string): Promise<AssessmentDto | null> {
  const prev = await read<StoredReport>(C.report);
  const profile = await read<StoredProfile>(C.profile);
  if (!prev || !profile || prev.report_id !== reportId) return null;
  return analysesFor(profile.scores, [offeringId])[offeringId] ?? null;
}

function analysesFor(scores: ScoresInput, ids: string[]): Record<string, AssessmentDto> {
  const overall = computeOverall(scores);
  return Object.fromEntries(CATALOG.filter((o) => ids.includes(o.offering_id)).map((o) => [o.offering_id, assess(o, scores, overall)]));
}

function build(r: StoredReport, p: StoredProfile, paid: boolean): ReportDto {
  const report: ReportDto = { format: "jungsi.persisted-report/v1", report_id: r.report_id, report_version: r.report_version, profile_id: p.profile_id, updated_at: r.updated_at, overall: computeOverall(p.scores) };
  if (!paid) return report;
  const analyses = analysesFor(p.scores, r.analyzed ?? []);
  const shortlist = Object.fromEntries(
    // 새 성적으로 다시 분석하면 그 상태로, 아직이면 저장된 상태(다시 확인 필요 등) 그대로
    Object.entries(r.shortlist ?? {}).map(([k, v]) => [k, analyses[k] ? { ...v, assessment_status: analyses[k].status } : v]),
  );
  const ready = Object.values(analyses).some((a) => a.status === "ready");
  return {
    ...report,
    analyses,
    candidates: r.candidates_built ? buildCandidates(analyses) : null,
    shortlist,
    analysis_status: (r.analyzed ?? []).length === 0 ? { status: "pending", reason_code: "offering_analysis_not_requested" } : { status: ready ? "ready" : "pending", reason_code: ready ? null : "offering_analysis_pending" },
  };
}