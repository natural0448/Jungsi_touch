import "server-only";
import { cookies } from "next/headers";
import type { AssessmentDto, ComboPositionDto, OverallAnalysisDto, ProfileDto, ProvisionalScoresInput, ReportDto, ScoresInput, ShortlistEntryDto, SubjectResultDto } from "@/lib/dto";
import { CATALOG, assess, buildCandidates } from "./synthetic-assessment";
import { PICK_GROUP_LIMIT } from "@/lib/picked-view";
import { absoluteGrade, CSAT_EXAM, EXAM, MOCK_EXAM, INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES, SECOND_LANGUAGE_SUBJECTS } from "@/lib/exam";

/*
  2페이지 합성 응답 — 성적 프로필과 리포트를 이 브라우저 쿠키에만 둔다.
  누적 위치와 등급은 화면 확인용으로 지어낸 곡선이다. 실제 분포·엔진 계산이 아니다.
  응답 모양은 실제 DTO(lib/dto.ts)와 같다.
*/

const OPT = { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };
const C = { profile: "jt_syn_profile", report: "jt_syn_report" } as const;
/** 수능 가채점 단계의 합성 성적·리포트(9월 모의평가와 입력 횟수·현재 리포트를 따로 센다, 운영 정책과 같음) */
const CP = { profile: "jt_syn_profile_p", report: "jt_syn_report_p" } as const;
/** 합성 번호 앞머리로 어느 단계의 쿠키인지 안다 */
const P_PROFILE = "syn-pprofile-", P_REPORT = "syn-preport-";
export type SynStage = "mock" | "provisional";
const jar = (stage: SynStage) => (stage === "provisional" ? CP : C);
const stageOfProfile = (id: string): SynStage => (id.startsWith(P_PROFILE) ? "provisional" : "mock");
const stageOfReport = (id: string): SynStage => (id.startsWith(P_REPORT) ? "provisional" : "mock");
const isRaw = (s: ScoresInput | ProvisionalScoresInput): s is ProvisionalScoresInput => "raw_score" in s.korean;

type StoredProfile = ProfileDto & { scores: ScoresInput | ProvisionalScoresInput; key: string };
type StoredReport = {
  report_id: string; report_version: number; profile_id: string; updated_at: string; key: string;
  keys?: string[]; // 최근 요청 키(같은 키의 재시도는 다시 쓰지 않는다)
  analyzed?: string[]; // university.analyze 로 분석한 모집행
  candidates_built?: boolean;
  shortlist?: Record<string, ShortlistEntryDto>;
};

const INQ = new Set(INQUIRY_SUBJECTS.flatMap((g) => g.subjects));

/** 서버 엔진처럼 입력을 검사한다. 오류 코드는 실제 계약의 이름을 쓴다 */
export function validateScores(s: ScoresInput | ProvisionalScoresInput): string | null {
  if (isRaw(s)) return validateRaw(s);
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
  const sl = s.second_language;
  if (sl && (!(SECOND_LANGUAGE_SUBJECTS as readonly string[]).includes(sl.subject) || !std(sl.grade, 1, 9))) return "invalid_second_language";
  return null;
}

/** 서버 validateRawScoreStructure 와 같은 검사(국어·수학 선택과목 필수) */
function validateRaw(s: ProvisionalScoresInput): string | null {
  if (s.exam_id !== CSAT_EXAM.exam_id || s.pack_version !== CSAT_EXAM.pack_version) return "pack_version_mismatch";
  const raw = (v: number | undefined, max: number) => v !== undefined && Number.isInteger(v) && v >= 0 && v <= max;
  if (!(KOREAN_CHOICES as readonly string[]).includes(s.korean.choice) || !(MATH_CHOICES as readonly string[]).includes(s.math.choice)) return "invalid_choice";
  if (!raw(s.korean.raw_score, 100) || !raw(s.math.raw_score, 100)) return "invalid_score";
  if (s.inquiry.length !== 2) return "invalid_request";
  if (s.inquiry[0].subject === s.inquiry[1].subject) return "duplicate_inquiry";
  for (const q of s.inquiry) {
    if (!INQ.has(q.subject)) return "invalid_subject";
    if (!raw(q.raw_score, 50)) return "invalid_score";
  }
  if (s.english_raw !== undefined && !raw(s.english_raw, 100)) return "invalid_score";
  if (s.korean_history_raw !== undefined && !raw(s.korean_history_raw, 50)) return "invalid_score";
  const sl = s.second_language;
  if (sl && (!(SECOND_LANGUAGE_SUBJECTS as readonly string[]).includes(sl.subject) || !raw(sl.raw_score, 50))) return "invalid_second_language";
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

/** pendingTotal: 화면 확인용 — 전체 누백 자료 연결 전에 저장된 리포트(total_model_missing)를 흉내 낸다.
 *  JUNGSI_SYNTHETIC_TOTAL_PENDING_UNTIL=N 이면 N번째 판까지가 연결 전 리포트(다시 계산하면 N+1 번째 판부터 계산됨) */
export function computeOverall(s: ScoresInput, pendingTotal = false): OverallAnalysisDto {
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
    second_language: s.second_language ? { subject: s.second_language.subject, grade: s.second_language.grade } : null,
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
    // 운영과 같은 모양: 공식 전체 응시자 기준 추정 전체 누백(population_id=official_all_examinees, 1.9.90)
    overall: pendingTotal
      ? { status: "pending", reason_code: "total_model_missing", top_percent: null, inclusive_top_percent: null, exclusive_top_percent: null, tie_share_percent: null, tie_interval_percent: null, tie_policy: null, population_id: null, model_version: null, data_kind: null }
      : {
          status: "estimated",
          reason_code: null,
          top_percent: pct(inc),
          inclusive_top_percent: pct(inc),
          exclusive_top_percent: pct(exc),
          tie_share_percent: pct(tie),
          tie_interval_percent: { lower: pct(exc), upper: pct(inc) },
          tie_policy: "include_equal",
          population_id: "official_all_examinees",
          model_version: "SYNTHETIC-curve-v1",
          data_kind: "estimated_weights",
        },
  };
}

/*
  합성 수능 가채점 분석(화면 확인용 지어낸 변환). 서버 provisional_estimate 와 같은 모양이다.
  원점수 4점 미만(국어·수학) / 2점 미만(탐구)은 '추정 없음' 행으로 둔다(서버 provisional_conversion_unavailable 흉내).
  예상 표준점수 합 축(합성 200~560) 밖이면 provisional_total_outside_axis.
*/
export function computeProvisional(s: ProvisionalScoresInput): OverallAnalysisDto {
  const conv = (raw: number, max: number, base: number, span: number) => {
    if (raw < (max === 100 ? 4 : 2)) return null;
    const c = Math.round(base + (raw / max) * span);
    return { low: c - 2, central: c, high: c + 2 };
  };
  const pctl = (c: number, mid: number, spread: number) => {
    const top = curve(c, mid, spread);
    return { low: Math.max(0, Math.floor(100 - top - 2)), high: Math.min(100, Math.ceil(100 - top + 2)) };
  };
  const row = (area: SubjectResultDto["area"], name: string, choice: string | null, raw: number, max: number, base: number, span: number, mid: number, spread: number): SubjectResultDto => {
    const st = conv(raw, max, base, span);
    const g = st ? grade(curve(st.central, mid, spread)) : null;
    const pr = st ? pctl(st.central, mid, spread) : null;
    // 서버 dep_r26 percentile_at_central 흉내: 가운데 표준점수의 백분위(정수, 범위 안). 추정 없는 행은 null
    const pac = st && pr ? Math.min(pr.high, Math.max(pr.low, Math.round(100 - curve(st.central, mid, spread)))) : null;
    return {
      area, subject: name, choice, standard_score: null as unknown as number, grade: null, top_percent_exclusive: null, top_percent_inclusive: null, basis: "provisional_raw_conversion",
      raw_score: raw, standard_score_range: st, percentile_range: pr, percentile_at_central: pac, grade_range: g ? { low: Math.max(1, g - 1), high: g } : null,
    };
  };
  const subjects = [
    row("korean", s.korean.choice, s.korean.choice, s.korean.raw_score, 100, 50, 90, 105, 9),
    row("math", s.math.choice, s.math.choice, s.math.raw_score, 100, 50, 95, 108, 10),
    row("inquiry1", s.inquiry[0].subject, null, s.inquiry[0].raw_score, 50, 30, 42, 52, 5),
    row("inquiry2", s.inquiry[1].subject, null, s.inquiry[1].raw_score, 50, 30, 42, 52, 5),
  ];
  const total = { low: 0, central: 0, high: 0 };
  let missing = false;
  for (const r of subjects) {
    if (!r.standard_score_range) { missing = true; continue; }
    total.low += r.standard_score_range.low; total.central += r.standard_score_range.central; total.high += r.standard_score_range.high;
  }
  const outside = !missing && (total.low < 200 || total.high > 560);
  const best = curve(total.high, 307, 22), worst = curve(total.low, 307, 22) + 0.4;
  const base = { top_percent: null, inclusive_top_percent: null, exclusive_top_percent: null, tie_share_percent: null, tie_interval_percent: null, tie_policy: "include_equal", population_id: "provisional_common_total_bounds", model_version: CSAT_EXAM.pack_version, data_kind: null };
  return {
    format: "jungsi.overall-analysis/v1",
    exam: { exam_id: s.exam_id, academic_year: 2027, exam_type: "csat_provisional" },
    pack_version: s.pack_version,
    score_basis: "provisional_estimate",
    input_kind: "provisional_raw",
    total_standard_score: null as unknown as number,
    total_standard_range: total,
    subjects,
    absolute_grades: {
      ...(s.english_raw !== undefined ? { 영어: absoluteGrade("english", s.english_raw) ?? undefined } : {}),
      ...(s.korean_history_raw !== undefined ? { 한국사: absoluteGrade("history", s.korean_history_raw) ?? undefined } : {}),
    },
    second_language: s.second_language ? ({ subject: s.second_language.subject, raw_score: s.second_language.raw_score, grade: absoluteGrade("second", s.second_language.raw_score) } as unknown as OverallAnalysisDto["second_language"]) : null,
    overall: missing
      ? { ...base, status: "pending", reason_code: "provisional_conversion_unavailable", top_percent_range: null, exclusive_top_percent_range: null }
      : outside
        ? { ...base, status: "pending", reason_code: "provisional_total_outside_axis", top_percent_range: null, exclusive_top_percent_range: null, total_standard_score_range: total }
        : { ...base, status: "estimated_range", reason_code: null, top_percent_range: { best: pct(Math.max(0, best)), worst: pct(Math.min(100, worst)) }, exclusive_top_percent_range: { best: pct(Math.max(0, best - 0.05)), worst: pct(Math.min(100, worst - 0.05)) }, total_standard_score_range: total },
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

export async function saveProfile(scores: ScoresInput | ProvisionalScoresInput, confirmed: boolean, key: string): Promise<ProfileDto> {
  const stage: SynStage = isRaw(scores) ? "provisional" : "mock";
  const prev = await read<StoredProfile>(jar(stage).profile);
  if (prev && prev.key === key) return strip(prev); // 같은 요청 키는 처음 결과를 돌려준다(멱등)
  const n = (prev?.profile_version ?? 0) + 1;
  const p: StoredProfile = { profile_id: `${stage === "provisional" ? P_PROFILE : "syn-profile-"}${n}`, profile_version: n, confirmed, created_at: new Date().toISOString(), scores, key };
  (await cookies()).set(jar(stage).profile, JSON.stringify(p), OPT);
  return strip(p);
}

function strip(p: StoredProfile): ProfileDto {
  return { profile_id: p.profile_id, profile_version: p.profile_version, confirmed: p.confirmed, created_at: p.created_at };
}

type Fail = "profile_not_found" | "revision_conflict" | "report_not_found" | "invalid_offering_ids" | "offering_not_found" | "score_confirmation_required" | "shortlist_limit_exceeded";

export async function saveReport(profileId: string, key: string, reportId?: string, expected?: number): Promise<ReportDto | Fail> {
  const J = jar(stageOfProfile(profileId));
  const profile = await read<StoredProfile>(J.profile);
  if (!profile || profile.profile_id !== profileId) return "profile_not_found";
  const prev = await read<StoredReport>(J.report);
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
    next = { report_id: `${J === CP ? P_REPORT : "syn-report-"}${Date.now().toString(36)}`, report_version: 1, profile_id: profileId, updated_at: now, key, keys: [key], analyzed: [], candidates_built: false, shortlist: {} };
  }
  (await cookies()).set(J.report, JSON.stringify(next), OPT);
  return build(next, profile, true);
}

const remember = (r: StoredReport, key: string) => [...(r.keys ?? [r.key]), key].slice(-12);

/** 리포트를 고치는 쓰기 공통: 소유·revision·멱등을 실제 서버처럼 확인한다 */
async function mutate(reportId: string, expected: number, key: string, change: (r: StoredReport, p: StoredProfile) => StoredReport | Fail): Promise<ReportDto | Fail> {
  const J = jar(stageOfReport(reportId));
  const prev = await read<StoredReport>(J.report);
  const profile = await read<StoredProfile>(J.profile);
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
    (await cookies()).set(J.report, JSON.stringify(saved), OPT);
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
    // 서버와 같은 한도: 같은 모집군에 5개까지(2026-11-21, 전에는 4개. 이미 더 담긴 것은 그대로, 빼기는 언제나)
    if (selected) {
      const group = CATALOG.find((o) => o.offering_id === offeringId)?.group;
      const same = Object.entries(r.shortlist ?? {}).filter(([id, e]) => id !== offeringId && e.selected && CATALOG.find((o) => o.offering_id === id)?.group === group).length;
      if (same >= PICK_GROUP_LIMIT) return "shortlist_limit_exceeded";
    }
    // 담는 곳은 화면에서 분석을 본 모집행이다. 합성은 그 분석을 렌더링 중에 저장하지 못하므로 여기서 함께 남긴다
    const a = analysesFor(p.scores, [offeringId])[offeringId];
    const analyzed = Array.from(new Set([...(r.analyzed ?? []), offeringId]));
    return { ...r, analyzed, shortlist: { ...(r.shortlist ?? {}), [offeringId]: { selected, changed_at: new Date().toISOString(), assessment_status: a?.status ?? "pending", profile_id: p.profile_id, catalog_version: "SYNTHETIC-catalog-v1" } } };
  });
}

/** paid=false 면 유료 필드(analyses·candidates·shortlist)를 뺀다(일반 회원 응답) */
export async function loadReport(reportId: string, paid = true): Promise<ReportDto | null> {
  const J = jar(stageOfReport(reportId));
  const prev = await read<StoredReport>(J.report);
  const profile = await read<StoredProfile>(J.profile);
  if (!prev || !profile || prev.report_id !== reportId || prev.profile_id !== profile.profile_id) return null;
  return build(prev, profile, paid);
}

/** 합성 집계용: 리포트 성적으로 모집행 하나를 바로 분석한다(실제 API 는 서버에 저장된 분석을 쓴다) */
export async function assessFor(reportId: string, offeringId: string): Promise<AssessmentDto | null> {
  const J = jar(stageOfReport(reportId));
  const prev = await read<StoredReport>(J.report);
  const profile = await read<StoredProfile>(J.profile);
  if (!prev || !profile || prev.report_id !== reportId || isRaw(profile.scores)) return null;
  return analysesFor(profile.scores, [offeringId])[offeringId] ?? null;
}

function analysesFor(scores: ScoresInput | ProvisionalScoresInput, ids: string[]): Record<string, AssessmentDto> {
  // 가채점 원점수 성적은 대학 환산·판정을 하지 않는다(서버 provisional_stage_unavailable)
  if (isRaw(scores)) return {};
  const overall = computeOverall(scores);
  return Object.fromEntries(CATALOG.filter((o) => ids.includes(o.offering_id)).map((o) => [o.offering_id, assess(o, scores, overall)]));
}

function build(r: StoredReport, p: StoredProfile, paid: boolean): ReportDto {
  const raw = isRaw(p.scores);
  const overall = isRaw(p.scores) ? computeProvisional(p.scores) : computeOverall(p.scores, r.report_version <= Number(process.env.JUNGSI_SYNTHETIC_TOTAL_PENDING_UNTIL ?? 0));
  const report: ReportDto = { format: "jungsi.persisted-report/v1", report_id: r.report_id, report_version: r.report_version, profile_id: p.profile_id, updated_at: r.updated_at, overall };
  if (!paid) return report;
  if (raw) return { ...report, analyses: {}, candidates: null, shortlist: r.shortlist ?? {}, analysis_status: { status: "pending", reason_code: "provisional_stage_unavailable" } };
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
/** 합성 report.list-own: 이 브라우저의 합성 리포트(하나)만 본인 목록으로 돌려준다 */
export async function listOwn(examId?: string): Promise<{ report_id: string; exam_id: string | null; report_version: number; updated_at: string; stage: string; is_current: boolean }[]> {
  const out = [];
  for (const stage of ["provisional", "mock"] as const) {
    const r = await read<StoredReport>(jar(stage).report);
    const p = await read<StoredProfile>(jar(stage).profile);
    if (!r || !p) continue;
    // 합성 쿠키는 단계로 시험을 안다(예전에 저장한 합성 성적의 exam_id 는 그때 환경값이라 다를 수 있다)
    const exam = stage === "provisional" ? CSAT_EXAM.exam_id : MOCK_EXAM.exam_id;
    if (examId && examId !== exam) continue;
    out.push({ report_id: r.report_id, exam_id: exam, report_version: r.report_version, updated_at: r.updated_at, stage, is_current: r.profile_id === p.profile_id });
  }
  return out;
}

/** 합성 score-input.status: 저장한 성적이 있으면 이 단계의 최초 입력 1회를 쓴 상태로 보인다 */
export async function inputUsed(stage: SynStage = "mock"): Promise<{ profileId: string | null; reportId: string | null }> {
  const p = await read<StoredProfile>(jar(stage).profile);
  const r = await read<StoredReport>(jar(stage).report);
  return { profileId: p?.profile_id ?? null, reportId: r && p && r.profile_id === p.profile_id ? r.report_id : null };
}

/** 합성: 이 요청 키가 이미 저장한 프로필의 키인지(멱등 재시도) */
export async function sameProfileKey(key: string, stage: SynStage = "mock"): Promise<boolean> {
  return (await read<StoredProfile>(jar(stage).profile))?.key === key;
}
