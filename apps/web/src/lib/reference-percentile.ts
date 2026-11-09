import type { CandidatesDto, ReferencePercentileDto, ReferenceUniversityGroupDto } from "./dto";

/**
 * 참고 누백(추정) — 9월 모의평가 응시자 전체 중 학생의 대학별 환산점수가 위에서 몇 %쯤인지 추정한 참고값.
 * 합격 가능성·지원 판정·여유/핵심/도전이 아니다(부담당자 확정 문구 2026-11-09).
 */
export const REFERENCE_PERCENTILE_TITLE = "참고 누백(추정)";
export const REFERENCE_PERCENTILE_NOTE = "9월 모의평가 기준 대학별 환산점수의 추정 위치입니다. 합격 가능성이나 실제 지원자 중 순위가 아닙니다.";
export const REFERENCE_GROUPS_TITLE = "참고 누백으로 본 대학 (순위·판정 아님)";

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * 정확한 소수 문자열을 소수 첫째 자리로 반올림(둘째 자리에서 5 이상 올림). 부동소수 오차 없이 문자열로 센다.
 * 숫자 꼴이 아니면 null — 화면에 내보내지 않는다.
 */
export function roundPercent1(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!DECIMAL.test(t)) return null;
  const [int, frac = ""] = t.split(".");
  let n = BigInt(int + (frac[0] ?? "0"));
  if ((frac[1] ?? "0") >= "5") n += BigInt(1);
  const v = n.toString().padStart(2, "0");
  return `${BigInt(v.slice(0, -1)).toString()}.${v.slice(-1)}`;
}

/** 보여 줄 수 있는 참고 누백 값(예: "16.7"). 칸이 없거나 reference_estimated 가 아니거나 숫자가 아니면 null */
export function referencePercentText(p: ReferencePercentileDto | null | undefined): string | null {
  if (!p || p.status !== "reference_estimated") return null;
  return roundPercent1(p.estimated_upper_cumulative_percent_all_examinees);
}

/** 4페이지 참고 묶음: 서버 순서 그대로(순위 아님), 보여 줄 값이 있는 모집단위만, 빈 대학은 뺀다 */
export function referenceGroups(c: CandidatesDto | null | undefined): ReferenceUniversityGroupDto[] {
  return (c?.reference_university_groups ?? [])
    .map((g) => ({ ...g, offerings: (g.offerings ?? []).filter((it) => it?.offering && referencePercentText(it.reference_percentile)) }))
    .filter((g) => g.offerings.length > 0);
}
