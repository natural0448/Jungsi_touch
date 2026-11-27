import type { AssessmentDto, EligibilityConditionsDto, SubjectResultDto } from "./dto";
import { INQUIRY_SUBJECTS } from "./exam";
import { eligibilityTables, type Formal105Condition, type RequiredCondition } from "./eligibility-tables";

/**
 * 지원 자격 조건(대표님 결정 2026-11-15). 서버가 요강 정본에서 확정된 필드만 보낸다.
 * 화면은 조건을 그대로 보여 주고, 목록으로 온 조건만 학생 입력과 맞는지 표시한다.
 * 서버 판정(eligibility_status·category)은 바꾸지 않는다.
 */
export type ConditionMark = "match" | "differ" | null;
export interface ConditionLine {
  label: string;
  text: string;
  mark: ConditionMark;
}

const squash = (s: string) => s.replace(/\s+/g, "");
const inquiryKey = (s: unknown) => typeof s === "string" ? squash(s.normalize("NFKC")) : "";
const DOMAIN_OF = new Map(
  INQUIRY_SUBJECTS.flatMap((g) => g.subjects.map((s) => [inquiryKey(s), g.group.replace("탐구", "")] as const)),
);

function mathMark(choices: string[], subjects: SubjectResultDto[] | undefined): ConditionMark {
  const mine = subjects?.find((s) => s.area === "math")?.choice;
  if (!mine) return null;
  return choices.map(squash).includes(squash(mine)) ? "match" : "differ";
}
function inquiryMark(domains: string[], subjects: SubjectResultDto[] | undefined): ConditionMark {
  const mine = (subjects ?? []).filter((s) => s.area === "inquiry1" || s.area === "inquiry2").map((s) => DOMAIN_OF.get(inquiryKey(s.subject)));
  if (!mine.length || mine.some((d) => !d)) return null;
  return mine.every((d) => domains.includes(d!)) ? "match" : "differ";
}

/** 화면에 보일 조건 줄. 조건이 하나도 없으면 빈 배열 */
export function conditionLines(a: AssessmentDto, subjects?: SubjectResultDto[]): ConditionLine[] {
  const c: EligibilityConditionsDto | null | undefined = a.eligibility_conditions;
  if (!c) return [];
  const out: ConditionLine[] = [];
  if (c.required_areas) {
    out.push({ label: "필수 응시", text: c.required_areas.length ? c.required_areas.join("·") : "별도 지정 없음", mark: null });
  }
  if (c.math_choices?.length) {
    out.push({ label: "수학", text: c.math_choices.join("·") + " 중 응시", mark: mathMark(c.math_choices, subjects) });
  } else if (c.math_note) {
    out.push({ label: "수학", text: c.math_note, mark: null });
  }
  if (c.inquiry_domains?.length || c.inquiry_note) {
    const head = c.inquiry_domains?.length ? c.inquiry_domains.map((d) => d + "탐구").join("·") + " 인정" : "";
    const text = [head, c.inquiry_note ?? ""].filter(Boolean).join(" · ");
    out.push({ label: "탐구", text, mark: c.inquiry_domains?.length ? inquiryMark(c.inquiry_domains, subjects) : null });
  }
  return out;
}

/**
 * 지정 과목 미응시로 지원할 수 없는지(대표님 지시 2026-11-18). 목록으로 온 조건만 보고, 확실한 경우만 미충족으로 본다.
 * - 수학: 지정 선택과목 목록에 내 선택과목이 없다
 * - 탐구: 인정 영역 안에 내가 응시한 탐구 과목이 하나도 없다(일부만 맞는 경우는 반영 과목 수에 따라 달라 단정하지 않는다)
 */
export function conditionUnmet(a: AssessmentDto, subjects?: SubjectResultDto[]): boolean {
  const c = a.eligibility_conditions;
  if (!c || !subjects?.length) return false;
  if (c.math_choices?.length && mathMark(c.math_choices, subjects) === "differ") return true;
  if (c.inquiry_domains?.length) {
    const mine = subjects.filter((s) => s.area === "inquiry1" || s.area === "inquiry2").map((s) => DOMAIN_OF.get(inquiryKey(s.subject)));
    if (mine.length && mine.every((d) => d && !c.inquiry_domains!.includes(d))) return true;
  }
  return false;
}

/** 리포트의 분석 항목 가운데 지정 과목 미응시인 곳을 '지원 조건 미충족'으로 바꿔 돌려준다. 참고 기준 판정은 붙이지 않는다 */
export function withConditionUnmet<R extends { overall?: { subjects?: SubjectResultDto[] } | null; analyses?: Record<string, AssessmentDto> }>(report: R): R {
  const subjects = report.overall?.subjects;
  if (!report.analyses || !subjects?.length) return report;
  let changed = false;
  const analyses: Record<string, AssessmentDto> = {};
  for (const [id, a] of Object.entries(report.analyses)) {
    if (a.status !== "ineligible" && conditionUnmet(a, subjects)) {
      changed = true;
      analyses[id] = { ...a, status: "ineligible", category: "ineligible", eligibility_status: "ineligible", reason_code: "designated_subject_not_taken", reference_band: null };
    } else analyses[id] = a;
  }
  return changed ? { ...report, analyses } : report;
}

export const CONDITION_MARK_TEXT: Record<"match" | "differ", string> = { match: "내 입력과 맞음", differ: "내 입력과 다름" };

/**
 * 담당자가 모집요강으로 '지원 필수'임을 확인한 모집단위(v36 A1 명부, 남은 확인이 없는 92행)만
 * (표는 화면 서버 KV에만 둔다: eligibility-tables.ts, 담당자 v45 지시 2026-11-20)
 * 지정 과목 미응시를 '지원 조건 미충족'으로 본다(대표님 결정 2026-11-19: 요건으로 확인된 행에만 다시 켠다).
 * 확실히 어긋날 때만 미충족이다. 내 입력이 비었거나 과목 분류를 모르면 그대로 둔다.
 */
const inquiryBase = (name: string) => name.replace(/I{1,2}$/, "");
type RequiredScoreState = "met" | "unmet" | "unverified";

function requiredScoreState(r: RequiredCondition | Formal105Condition, subjects: SubjectResultDto[] | undefined): RequiredScoreState {
  if (!subjects?.length) return "unverified";
  const mathChoices = "m" in r ? r.m : undefined;
  const math = mathChoices ? mathMark(mathChoices, subjects) : "match";
  if (math === "differ") return "unmet";

  const minRecognized = r.n ?? 0;
  const minScience = "s" in r ? (r.s ?? 0) : 0;
  const restrictPair = "x" in r && r.x === 1;
  if (minRecognized > 0 && !r.d) return "unverified";
  if (minRecognized > 0 || minScience > 0 || restrictPair) {
    const inq = subjects.filter((x) => x.area === "inquiry1" || x.area === "inquiry2");
    const names = inq.map((s) => inquiryKey(s.subject));
    const domains = names.map((name) => DOMAIN_OF.get(name));
    // SubjectResultDto has no explicit attendance flag. An empty, unknown or
    // duplicated record cannot prove that the prospective student took the required subject(s).
    if (!inq.length || domains.some((domain) => !domain) || new Set(names).size !== inq.length ||
        new Set(inq.map((s) => s.area)).size !== inq.length) return "unverified";

    const recognized = r.d ? domains.filter((domain) => domain && r.d!.includes(domain)).length : 0;
    const science = domains.filter((domain) => domain === "과학").length;
    if (recognized < minRecognized || science < minScience) return "unmet";
    if (restrictPair && names.length === 2 && science === 2 && inquiryBase(names[0]) === inquiryBase(names[1])) return "unmet";
  }
  return math === "match" ? "met" : "unverified";
}

export function requiredUnmet(offeringId: string, subjects: SubjectResultDto[] | undefined): boolean {
  const t = eligibilityTables();
  const required = t.required[offeringId];
  const formal = t.formal105[offeringId];
  return (required !== undefined && requiredScoreState(required, subjects) === "unmet") ||
    (formal !== undefined && requiredScoreState(formal, subjects) === "unmet");
}

/** withConditionUnmet 와 같은 모양으로, 92행 범위의 확인된 지원 필수 조건만 반영한다 */
export function withRequiredUnmet<R extends { overall?: { subjects?: SubjectResultDto[] } | null; analyses?: Record<string, AssessmentDto> }>(report: R): R {
  const subjects = report.overall?.subjects;
  if (!report.analyses || !subjects?.length) return report;
  let changed = false;
  const analyses: Record<string, AssessmentDto> = {};
  for (const [id, a] of Object.entries(report.analyses)) {
    // 모양이 어긋난 분석(객체가 아님)은 손대지 않고 그대로 둔다 — 리포트 읽기 전체가 실패하지 않게(2026-11-22)
    if (a && typeof a === "object" && a.status !== "ineligible" && requiredUnmet(id, subjects)) {
      changed = true;
      analyses[id] = { ...a, status: "ineligible", category: "ineligible", eligibility_status: "ineligible", reason_code: "designated_subject_not_taken", reference_band: null };
    } else analyses[id] = a;
  }
  return changed ? { ...report, analyses } : report;
}

/**
 * 정식 판정 우선 105개 모집단위의 지원자격 안내(담당자 v38, 대표님 결정 2026-11-19).
 * 점수로 확인할 조건(2027 본수능 응시·필수 영역·탐구 과목)은 본수능 실채점 성적이 저장됐을 때만 '충족'으로 본다.
 * 9월 모의평가·가채점이면 '확인 필요'. 학력과 지역인재 증빙은 늘 모집요강에서 확인하도록 안내한다.
 * 확실히 어긋나는 탐구 조건은 requiredUnmet 이 '지원 조건 미충족'으로 바꾼다.
 */
export interface Formal105Notice { score: "met" | "unverified"; text: string; documents: string }
export function formal105Notice(offeringId: string, examType: string | null | undefined, subjects?: SubjectResultDto[]): Formal105Notice | null {
  const tables = eligibilityTables();
  const r = tables.formal105[offeringId];
  if (!r) return null;
  const parts = ["2027 본수능 응시"];
  if (r.d && r.n) parts.push(`${r.d.map((d) => d + "탐구").join("·")} 중 ${r.n}과목`);
  const documents = r.g ? "학력과 지역인재 자격 증빙" : "학력(고교 졸업 또는 동등)";
  const final = examType === "csat_final" || examType === "csat";
  const required = tables.required[offeringId];
  const score = final && requiredScoreState(r, subjects) === "met" &&
    (required === undefined || requiredScoreState(required, subjects) === "met") ? "met" : "unverified";
  return { score, text: parts.join(" · "), documents };
}
