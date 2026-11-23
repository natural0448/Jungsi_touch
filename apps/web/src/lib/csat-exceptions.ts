import type { OverallAnalysisDto, SubjectResultDto } from "./dto";
import { INQUIRY_SUBJECTS } from "./exam";

/*
  수능 가채점 예외 17개 모집단위의 4페이지 표시(담당자 출시 자료 2026-11-23 p3/exception_display_17.private.v1.json,
  표시 투영 project_display_state.ts, 성균관대 최저 판정 evaluate_skku094_minimum.v2.ts).
  - 17곳은 가채점 일반 7단계·자동 후보에서 빠진다(서버 판정 묶음 v5p234_v52 에도 없다).
  - 화면에는 허용된 이름·안내만 보낸다. 원본 사유(official_scope_reason)·곡선 지문은 서버 쪽에만 둔다.
  - 수능 성분·우수 3영역 점수는 서버가 점수를 줄 때까지 '판정 준비 중'(project_display_state 의 pending).
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
  | { kind: "pending"; label: "판정 준비 중" | "최저 확인 대기"; desc: string };

const DESC: Record<ExceptionMode, string> = {
  csat_component_only: "이 전형은 수능 외 평가가 함께 반영되어 가채점 7단계 판정을 내지 않습니다. 수능 성분 점수는 준비 중입니다.",
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

/** 예외 17곳이면 화면 표시, 아니면 null */
export function csatExceptionView(offeringId: string, a: OverallAnalysisDto | null | undefined): ExceptionView | null {
  const mode = CSAT_EXCEPTIONS[offeringId];
  if (!mode) return null;
  if (mode === "csat_minimum_only") {
    const r = skkuMinimumFromAnalysis(offeringId, a);
    return r
      ? { kind: "minimum", label: r, desc: r === "최저충족" ? "가채점 등급으로 이 전형의 수능 최저 기준을 충족합니다. 7단계 판정은 내지 않습니다." : "가채점 등급으로는 이 전형의 수능 최저 기준에 미치지 못합니다. 7단계 판정은 내지 않습니다." }
      : { kind: "pending", label: "최저 확인 대기", desc: "가채점 등급 범위에 따라 수능 최저 충족 여부가 갈리거나 입력이 부족해 아직 정하지 않았습니다. 성적표가 나오면 확정됩니다." };
  }
  return { kind: "pending", label: "판정 준비 중", desc: DESC[mode] };
}

/** 배지 색: 최저충족=안정 색, 최저미충족=조건 미충족 색, 대기=확인 색 */
export const exceptionCls = (v: ExceptionView): string => (v.kind === "minimum" ? (v.label === "최저충족" ? "safe" : "inel") : "check");
