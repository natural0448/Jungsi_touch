import type { OverallAnalysisDto, SubjectResultDto } from "./dto";
import { INQUIRY_SUBJECTS } from "./exam";

/*
  수능 가채점 예외 17개 모집단위의 4페이지 표시(담당자 출시 자료 2026-11-23 p3/exception_display_17.private.v1.json,
  표시 투영 project_display_state.ts, 성균관대 최저 판정 evaluate_skku094_minimum.v2.ts).
  - 17곳은 가채점 일반 7단계·자동 후보에서 빠진다(서버 판정 묶음 v5p234_v52 에도 없다).
  - 화면에는 허용된 이름·안내만 보낸다. 원본 사유(official_scope_reason)·곡선 지문은 서버 쪽에만 둔다.
  - 수능 반영분·우수 3영역 7행은 7단계 없이 점수만(csat-conditions csatC1Score, 담당자 C1 11-23). 보류 6행은 근거별 이름(J1 ⑥).
  - 성균관대 4곳은 과목별 가채점 등급 범위 안의 모든 경우가 같은 답일 때만 최저충족·최저미충족, 아니면 '최저 확인 대기'.
*/

export type ExceptionMode =
  | "csat_component_only"
  | "student_selected_three_score_reference"
  | "csat_minimum_only"
  | "existing_held_no_curve"
  | "conditional_admission_formula_unverified";

export const CSAT_EXCEPTIONS: Readonly<Record<string, ExceptionMode>> = {
  "2027:1000002877": "existing_held_no_curve",
  "2027:1000003567": "csat_component_only",
  "2027:1000003818": "csat_minimum_only",
  "2027:1000003829": "csat_minimum_only",
  "2027:1000003841": "csat_minimum_only",
  "2027:1000003842": "csat_minimum_only",
  "2027:1000006932": "existing_held_no_curve",
  "2027:1000007388": "student_selected_three_score_reference",
  "2027:1000008661": "conditional_admission_formula_unverified",
  "2027:1000010568": "csat_component_only",
  "2027:1000010569": "csat_component_only",
  "2027:1000010768": "existing_held_no_curve",
  "2027:1000010769": "existing_held_no_curve",
  "2027:1000010770": "existing_held_no_curve",
  "2027:1000010868": "csat_component_only",
  "2027:1000010922": "csat_component_only",
  "2027:1000010923": "csat_component_only",
};

export type ExceptionView =
  | { kind: "minimum"; label: "최저충족" | "최저미충족"; desc: string }
  | { kind: "expected"; label: "최저충족 예상" | "최저미충족 예상"; desc: string }
  | { kind: "pending"; label: string; desc: string };

/**
 * 담당자 11-23 회신 J1 ⑥: 보류 6행의 화면 이름(근거별). 원본 사유 문장은 서버에만 둔다.
 * 울산대 3행은 2027 이 전형 모집 인원 0명 → '이번 전형 모집 없음'
 */
const HELD_LABEL: Readonly<Record<string, { label: string; desc: string }>> = {
  "2027:1000002877": { label: "환산 방식 확인", desc: "모집요강에 가산점을 반영하는 순서가 명시되어 있지 않아 대학에 확인이 필요합니다." },
  "2027:1000006932": { label: "지원 조건 확인", desc: "이 전형은 지원 자격이 따로 정해져 있어 모집요강에서 지원 조건을 확인해 주세요." },
  "2027:1000008661": { label: "이월 선발 조건 확인", desc: "이 전형은 다른 전형에서 이월된 인원으로 선발하는 조건부 모집입니다. 모집요강에서 확인해 주세요." },
  "2027:1000010768": { label: "이번 전형 모집 없음", desc: "2027 이 전형의 수능 위주 모집 인원이 0명입니다." },
  "2027:1000010769": { label: "이번 전형 모집 없음", desc: "2027 이 전형의 수능 위주 모집 인원이 0명입니다." },
  "2027:1000010770": { label: "이번 전형 모집 없음", desc: "2027 이 전형의 수능 위주 모집 인원이 0명입니다." },
};

const DESC: Record<ExceptionMode, string> = {
  csat_component_only: "이 전형은 수능 외 평가가 함께 반영되어 7단계 판정을 내지 않습니다. 수능 반영분 점수만 보입니다.",
  student_selected_three_score_reference: "이 전형은 성적이 좋은 3영역을 골라 반영하는 방식이라 가채점 7단계 판정을 내지 않습니다. 이 방식의 점수는 준비 중입니다.",
  csat_minimum_only: "이 전형은 수능 최저 기준 충족 여부만 봅니다. 가채점 7단계 판정을 내지 않습니다.",
  existing_held_no_curve: "이 전형은 반영 방법 확인이 끝나지 않아 가채점 판정을 보류했습니다.",
  conditional_admission_formula_unverified: "이 전형은 반영 방법 확인이 끝나지 않아 가채점 판정을 보류했습니다.",
};

type Attendance = "attended" | "not_attended" | "unknown";
type GradeArea = { attendance?: Attendance; grade?: number | null };
type InquiryArea = GradeArea & { subjectId?: string | null; kind?: "social" | "science" | "vocational" | null };
export type MinimumInput = {
  examId: string;
  korean?: GradeArea;
  math?: GradeArea;
  english?: GradeArea;
  koreanHistory?: GradeArea;
  inquiry1?: InquiryArea;
  inquiry2?: InquiryArea;
  secondForeignLanguageOrClassicalChinese?: GradeArea;
};
export type MinimumLabel = "최저충족" | "최저미충족" | null;

/* ─── 아래 두 함수는 담당자 evaluate_skku094_minimum.v2.ts 를 그대로 옮긴 것(바꾸지 않는다) ─── */
const SKKU = new Set(["2027:1000003818", "2027:1000003829", "2027:1000003841", "2027:1000003842"]);
function validGrade(grade: number | null | undefined): grade is number {
  return typeof grade === "number" && Number.isInteger(grade) && grade >= 1 && grade <= 9;
}
function bestGradeSumTwice(coreTwice: readonly number[], inquiryTwice: number, q1: number, q2: number, replacement?: number): number {
  const inquiry = replacement === undefined ? inquiryTwice : Math.min(inquiryTwice, replacement + q1, replacement + q2);
  return [...coreTwice, inquiry].sort((a, b) => a - b).slice(0, 3).reduce((total, grade) => total + grade, 0);
}
export function skkuMinimumLabel(offeringId: string, input: MinimumInput): MinimumLabel {
  if (!SKKU.has(offeringId) || input.examId !== "2027-csat-provisional") return null;
  const { korean, math, english, koreanHistory, inquiry1, inquiry2 } = input;
  const optional = input.secondForeignLanguageOrClassicalChinese;
  const required = [korean, math, english, koreanHistory, inquiry1, inquiry2];
  if ([...required, optional].some((area) => area?.attendance === "not_attended" && area.grade != null)) return null;
  if (required.some((area) => area?.attendance === "not_attended")) return "최저미충족";
  if ([inquiry1, inquiry2].some((area) => area?.kind === "vocational" && (area.attendance === "attended" || validGrade(area.grade)))) return "최저미충족";
  const k = korean?.grade, m = math?.grade, e = english?.grade;
  const q1 = inquiry1?.grade, q2 = inquiry2?.grade;
  if (!validGrade(k) || !validGrade(m) || !validGrade(e) || !validGrade(q1) || !validGrade(q2)) return null;
  if (!validGrade(koreanHistory?.grade) && koreanHistory?.attendance !== "attended") return null;
  if (!inquiry1?.subjectId || !inquiry2?.subjectId || inquiry1.subjectId === inquiry2.subjectId || !inquiry1.kind || !inquiry2.kind) return null;
  let inquiryTwice = q1 + q2;
  if (inquiry1.kind === "science") inquiryTwice = Math.min(inquiryTwice, 2 * q1);
  if (inquiry2.kind === "science") inquiryTwice = Math.min(inquiryTwice, 2 * q2);
  const coreTwice = [2 * k, 2 * m, 2 * e];
  const replacement = validGrade(optional?.grade) ? optional.grade : undefined;
  if (bestGradeSumTwice(coreTwice, inquiryTwice, q1, q2, replacement) <= 12) return "최저충족";
  if (optional?.attendance !== "not_attended" && replacement === undefined && bestGradeSumTwice(coreTwice, inquiryTwice, q1, q2, 1) <= 12) return null;
  return "최저미충족";
}
/* ─── 옮긴 부분 끝 ─── */

const SOCIAL = new Set(INQUIRY_SUBJECTS[0].subjects);
const SCIENCE = new Set(INQUIRY_SUBJECTS[1].subjects);
const kindOf = (s?: SubjectResultDto): "social" | "science" | null => (!s ? null : SOCIAL.has(s.subject) ? "social" : SCIENCE.has(s.subject) ? "science" : null);

/** 가채점 등급 범위(정수). 없으면 null */
function gradeSpan(s?: SubjectResultDto): number[] | null {
  const r = s?.grade_range;
  if (!r || !validGrade(r.low) || !validGrade(r.high)) return null;
  const lo = Math.min(r.low, r.high), hi = Math.max(r.low, r.high);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** 가채점 리포트로 성균관대 최저 판정. 등급 범위 안의 모든 경우가 같은 답이어야 그 답, 하나라도 다르거나 비면 null */
export function skkuMinimumFromAnalysis(offeringId: string, a: OverallAnalysisDto | null | undefined): MinimumLabel {
  if (!a || !SKKU.has(offeringId)) return null;
  const by = new Map(a.subjects.map((s) => [s.area, s]));
  const k = gradeSpan(by.get("korean")), m = gradeSpan(by.get("math")), q1 = gradeSpan(by.get("inquiry1")), q2 = gradeSpan(by.get("inquiry2"));
  const e = a.absolute_grades?.영어, h = a.absolute_grades?.한국사;
  if (!k || !m || !q1 || !q2 || !validGrade(e) || !validGrade(h)) return null;
  const s1 = by.get("inquiry1")!, s2 = by.get("inquiry2")!;
  const sl = a.second_language ?? null;
  const optional: GradeArea = sl && validGrade(sl.grade) ? { attendance: "attended", grade: sl.grade } : { attendance: "not_attended", grade: null };
  let out: MinimumLabel | undefined;
  for (const gk of k) for (const gm of m) for (const g1 of q1) for (const g2 of q2) {
    const r = skkuMinimumLabel(offeringId, {
      examId: a.exam.exam_id,
      korean: { attendance: "attended", grade: gk },
      math: { attendance: "attended", grade: gm },
      english: { attendance: "attended", grade: e },
      koreanHistory: { attendance: "attended", grade: h },
      inquiry1: { attendance: "attended", grade: g1, subjectId: s1.subject, kind: kindOf(s1) },
      inquiry2: { attendance: "attended", grade: g2, subjectId: s2.subject, kind: kindOf(s2) },
      secondForeignLanguageOrClassicalChinese: optional,
    });
    if (r === null) return null;
    if (out === undefined) out = r;
    else if (out !== r) return null;
  }
  return out ?? null;
}

/* ─── 2026-11-26 담당자 provisional_grade_display.ts projectSkkuExpectedMinimum·formatExpectedMinimum 옮김 ───
   등급 범위가 최저 기준(좋은 3영역 합 6 이내)을 가로지를 때만, 같은 리포트의 과목별 대표 등급(서버 계산)으로
   '최저충족 예상'·'최저미충족 예상'을 보인다. 확정 판정(위 skkuMinimumLabel)이 나오면 그것을 쓴다.
   예상은 표시만 한다(자동 추천·정렬·필터에 쓰지 않는다). 담당자 원본의 규칙 ID·Guide Q 확인은
   화면에 그 값이 없어 모집단위 4곳 목록으로 대신한다. */
export type ExpectedMinimum = {
  label: "최저충족 예상" | "최저미충족 예상";
  representative_grade_sum: number;
  best_grade_sum: number;
  worst_grade_sum: number;
  maximum_grade_sum: 6;
  optional_substitution_can_change_label: boolean;
};
function bestThreeSumTwice(grades: readonly number[], inquiry: number): number {
  return [...grades, inquiry].sort((x, y) => x - y).slice(0, 3).reduce((t, g) => t + g, 0);
}
/** 담당자 projectSkkuExpectedMinimum 의 계산 부분(범위 best·worst 는 등급합×2) */
export function projectSkkuExpectedMinimum(offeringId: string, best: number, worst: number, input: MinimumInput): ExpectedMinimum | null {
  if (!SKKU.has(offeringId) || input.examId !== "2027-csat-provisional") return null;
  if (!Number.isInteger(best) || !Number.isInteger(worst) || best < 6 || best > 12 || worst <= 12 || worst > 54) return null;
  const { korean, math, english, koreanHistory, inquiry1, inquiry2 } = input;
  const optional = input.secondForeignLanguageOrClassicalChinese;
  if ([korean, math, english, koreanHistory, inquiry1, inquiry2].some((area) => area?.attendance === "not_attended") ||
    (optional?.attendance === "not_attended" && optional.grade != null)) return null;
  if (koreanHistory?.attendance !== "attended" && !validGrade(koreanHistory?.grade)) return null;
  if (!inquiry1?.subjectId || !inquiry2?.subjectId || inquiry1.subjectId === inquiry2.subjectId ||
    (inquiry1.kind !== "social" && inquiry1.kind !== "science") || (inquiry2.kind !== "social" && inquiry2.kind !== "science")) return null;
  const k = korean?.grade, m = math?.grade, e = english?.grade, q1 = inquiry1.grade, q2 = inquiry2.grade;
  if (!validGrade(k) || !validGrade(m) || !validGrade(e) || !validGrade(q1) || !validGrade(q2)) return null;
  const core = [2 * k, 2 * m, 2 * e];
  let inquiry = q1 + q2;
  if (inquiry1.kind === "science") inquiry = Math.min(inquiry, 2 * q1);
  if (inquiry2.kind === "science") inquiry = Math.min(inquiry, 2 * q2);
  const replacement = optional?.grade;
  if (validGrade(replacement)) inquiry = Math.min(inquiry, replacement + q1, replacement + q2);
  else if (replacement != null) return null;
  const sum = bestThreeSumTwice(core, inquiry);
  const bestWithOptional = optional?.attendance !== "not_attended" && !validGrade(replacement)
    ? bestThreeSumTwice(core, Math.min(inquiry, 1 + q1, 1 + q2))
    : sum;
  if (sum < best || sum > worst) return null;
  return {
    label: sum <= 12 ? "최저충족 예상" : "최저미충족 예상",
    representative_grade_sum: sum / 2,
    best_grade_sum: best / 2,
    worst_grade_sum: worst / 2,
    maximum_grade_sum: 6,
    optional_substitution_can_change_label: bestWithOptional <= 12 && sum > 12,
  };
}
export function formatExpectedMinimum(v: ExpectedMinimum): string {
  const possible = v.label === "최저충족 예상" ? "등급에 따라 미충족 가능" : "등급에 따라 충족 가능";
  const optional = v.optional_substitution_can_change_label ? " · 제2외국어·한문 미입력 기준, 대체 등급에 따라 달라질 수 있음" : "";
  return `${v.label} (가채점 대표값 기준) · 대표 등급합 ${v.representative_grade_sum} · 가능 등급합 ${v.best_grade_sum}~${v.worst_grade_sum} · 기준 ${v.maximum_grade_sum} 이내 · ${possible}${optional}`;
}
/** 등급 범위 안 모든 조합의 좋은 3영역 합×2 최솟값·최댓값(skkuMinimumLabel 과 같은 계산). 입력이 모자라면 null */
function skkuSumRangeTwice(k: number[], m: number[], q1: number[], q2: number[], e: number, kind1: string | null, kind2: string | null, replacement?: number): { best: number; worst: number } | null {
  if (!kind1 || !kind2) return null;
  let best = Infinity, worst = -Infinity;
  for (const gk of k) for (const gm of m) for (const g1 of q1) for (const g2 of q2) {
    let inq = g1 + g2;
    if (kind1 === "science") inq = Math.min(inq, 2 * g1);
    if (kind2 === "science") inq = Math.min(inq, 2 * g2);
    const v = bestGradeSumTwice([2 * gk, 2 * gm, 2 * e], inq, g1, g2, replacement);
    best = Math.min(best, v); worst = Math.max(worst, v);
  }
  return Number.isFinite(best) ? { best, worst } : null;
}
/** 가채점 리포트로 성균관대 최저 '예상'. 확정이 안 될 때만 쓰고, 대표 등급이 하나라도 없으면 null */
export function skkuExpectedFromAnalysis(offeringId: string, a: OverallAnalysisDto | null | undefined): ExpectedMinimum | null {
  if (!a || !SKKU.has(offeringId)) return null;
  const by = new Map(a.subjects.map((s) => [s.area, s]));
  const sk = by.get("korean"), sm = by.get("math"), s1 = by.get("inquiry1"), s2 = by.get("inquiry2");
  const k = gradeSpan(sk), m = gradeSpan(sm), q1 = gradeSpan(s1), q2 = gradeSpan(s2);
  const e = a.absolute_grades?.영어, h = a.absolute_grades?.한국사;
  if (!k || !m || !q1 || !q2 || !validGrade(e) || !validGrade(h) || !sk || !sm || !s1 || !s2) return null;
  const rk = sk.representative_grade, rm = sm.representative_grade, r1 = s1.representative_grade, r2 = s2.representative_grade;
  if (!validGrade(rk) || !validGrade(rm) || !validGrade(r1) || !validGrade(r2)) return null;
  const sl = a.second_language ?? null;
  const optional: GradeArea = sl && validGrade(sl.grade) ? { attendance: "attended", grade: sl.grade } : { attendance: "not_attended", grade: null };
  const replacement = validGrade(optional.grade) ? optional.grade : undefined;
  const range = skkuSumRangeTwice(k, m, q1, q2, e, kindOf(s1), kindOf(s2), replacement);
  if (!range) return null;
  return projectSkkuExpectedMinimum(offeringId, range.best, range.worst, {
    examId: a.exam.exam_id,
    korean: { attendance: "attended", grade: rk },
    math: { attendance: "attended", grade: rm },
    english: { attendance: "attended", grade: e },
    koreanHistory: { attendance: "attended", grade: h },
    inquiry1: { attendance: "attended", grade: r1, subjectId: s1.subject, kind: kindOf(s1) },
    inquiry2: { attendance: "attended", grade: r2, subjectId: s2.subject, kind: kindOf(s2) },
    secondForeignLanguageOrClassicalChinese: optional,
  });
}

/** 예외 17곳이면 화면 표시, 아니면 null */
export function csatExceptionView(offeringId: string, a: OverallAnalysisDto | null | undefined): ExceptionView | null {
  const mode = CSAT_EXCEPTIONS[offeringId];
  if (!mode) return null;
  if (mode === "csat_minimum_only") {
    const r = skkuMinimumFromAnalysis(offeringId, a);
    if (!r) {
      const x = skkuExpectedFromAnalysis(offeringId, a);
      if (x) return { kind: "expected", label: x.label, desc: formatExpectedMinimum(x) + ". 7단계 판정은 내지 않으며, 성적표가 나오면 확정됩니다." };
    }
    return r
      ? { kind: "minimum", label: r, desc: r === "최저충족" ? "가채점 등급으로 이 전형의 수능 최저 기준을 충족합니다. 7단계 판정은 내지 않습니다." : "가채점 등급으로는 이 전형의 수능 최저 기준에 미치지 못합니다. 7단계 판정은 내지 않습니다." }
      : { kind: "pending", label: "최저 확인 대기", desc: "가채점 등급 범위에 따라 수능 최저 충족 여부가 갈리거나 입력이 부족해 아직 정하지 않았습니다. 성적표가 나오면 확정됩니다." };
  }
  const held = HELD_LABEL[offeringId];
  if (held) return { kind: "pending", ...held };
  // 수능 반영분·우수 3영역 7행: 점수는 csat-conditions csatC1Score 로 따로 보인다(7단계는 내지 않는다)
  if (mode === "csat_component_only") return { kind: "pending", label: "수능 반영분 점수", desc: DESC[mode] };
  if (mode === "student_selected_three_score_reference") return { kind: "pending", label: "우수 3영역 점수", desc: DESC[mode] };
  return { kind: "pending", label: "비교 기준 확인 필요", desc: DESC[mode] };
}

/** 배지 색: 최저충족=안정 색, 최저미충족=조건 미충족 색, 대기=확인 색 */
// 예상(가채점 대표값)은 확정이 아니어서 확인 색을 쓴다
export const exceptionCls = (v: ExceptionView): string => (v.kind === "minimum" ? (v.label === "최저충족" ? "safe" : "inel") : "check");
