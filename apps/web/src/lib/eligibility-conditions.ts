import type { AssessmentDto, EligibilityConditionsDto, SubjectResultDto } from "./dto";
import { INQUIRY_SUBJECTS } from "./exam";

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

const DOMAIN_OF: Record<string, string> = Object.fromEntries(
  INQUIRY_SUBJECTS.flatMap((g) => g.subjects.map((s) => [s, g.group.replace("탐구", "")])),
);
const squash = (s: string) => s.replace(/\s+/g, "");

function mathMark(choices: string[], subjects: SubjectResultDto[] | undefined): ConditionMark {
  const mine = subjects?.find((s) => s.area === "math")?.choice;
  if (!mine) return null;
  return choices.map(squash).includes(squash(mine)) ? "match" : "differ";
}
function inquiryMark(domains: string[], subjects: SubjectResultDto[] | undefined): ConditionMark {
  const mine = (subjects ?? []).filter((s) => s.area === "inquiry1" || s.area === "inquiry2").map((s) => DOMAIN_OF[s.subject]);
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

export const CONDITION_MARK_TEXT: Record<"match" | "differ", string> = { match: "내 입력과 맞음", differ: "내 입력과 다름" };
