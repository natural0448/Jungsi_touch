import "server-only";
import { cookies } from "next/headers";
import type { OverallAnalysisDto, ProfileDto, ReportDto, ScoresInput, SubjectResultDto } from "@/lib/dto";
import { EXAM, INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES } from "@/lib/exam";

/*
  2페이지 합성 응답 — 성적 프로필과 리포트를 이 브라우저 쿠키에만 둔다.
  누적 위치와 등급은 화면 확인용으로 지어낸 곡선이다. 실제 분포·엔진 계산이 아니다.
  응답 모양은 실제 DTO(lib/dto.ts)와 같다.
*/

const OPT = { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" as const, httpOnly: true };
const C = { profile: "jt_syn_profile", report: "jt_syn_report" } as const;

type StoredProfile = ProfileDto & { scores: ScoresInput; key: string };
type StoredReport = { report_id: string; report_version: number; profile_id: string; updated_at: string; key: string };

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
    overall: {
      status: "estimated",
      reason_code: null,
      top_percent: pct(inc),
      inclusive_top_percent: pct(inc),
      exclusive_top_percent: pct(exc),
      tie_share_percent: pct(tie),
      tie_interval_percent: [pct(exc), pct(inc)],
      tie_policy: "include_equal",
      population_id: "SYNTHETIC-2027-09-KMI2",
      model_version: "SYNTHETIC-curve-v1",
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

export async function saveReport(profileId: string, key: string, reportId?: string, expected?: number): Promise<ReportDto | "profile_not_found" | "revision_conflict" | "report_not_found"> {
  const profile = await read<StoredProfile>(C.profile);
  if (!profile || profile.profile_id !== profileId) return "profile_not_found";
  const prev = await read<StoredReport>(C.report);
  if (prev && prev.key === key) return build(prev, profile);
  let next: StoredReport;
  if (reportId) {
    if (!prev || prev.report_id !== reportId) return "report_not_found";
    if (prev.report_version !== expected) return "revision_conflict";
    next = { ...prev, report_version: prev.report_version + 1, profile_id: profileId, updated_at: new Date().toISOString(), key };
  } else {
    next = { report_id: `syn-report-${Date.now().toString(36)}`, report_version: 1, profile_id: profileId, updated_at: new Date().toISOString(), key };
  }
  (await cookies()).set(C.report, JSON.stringify(next), OPT);
  return build(next, profile);
}

export async function loadReport(reportId: string): Promise<ReportDto | null> {
  const prev = await read<StoredReport>(C.report);
  const profile = await read<StoredProfile>(C.profile);
  if (!prev || !profile || prev.report_id !== reportId || prev.profile_id !== profile.profile_id) return null;
  return build(prev, profile);
}

function build(r: StoredReport, p: StoredProfile): ReportDto {
  return { format: "jungsi.persisted-report/v1", report_id: r.report_id, report_version: r.report_version, profile_id: p.profile_id, updated_at: r.updated_at, overall: computeOverall(p.scores) };
}
