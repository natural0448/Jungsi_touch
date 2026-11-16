import type { CandidatesDto, ReferencePercentileDto, ReferenceUniversityGroupDto } from "./dto";

/**
 * 누적 백분위(추정) — 학생의 대학별 환산점수가 응시자 전체 중 위에서 몇 %쯤인지 추정한 값.
 * 문구는 학생이 이 값으로 무엇을 판단하는지 알려 준다(2026-11-15 대표님 결정, 11-09 문구 대체).
 * 기준 시험(모의평가·가채점·성적표)은 고정 문구로 적지 않는다.
 */
export const REFERENCE_PERCENTILE_TITLE = "누적 백분위(추정)";
export const REFERENCE_PERCENTILE_NOTE =
  "이 대학 방식으로 계산한 내 점수가 응시자 중 상위 몇 %인지 추정한 값입니다. 환산점수와 달리 해마다 난이도가 달라도 같은 기준으로 비교할 수 있어, 지난해 합격자 누적 백분위와 견줘 지원 여부를 판단할 때 씁니다. 범위(예: 상위 12.3~14.8%)로 보이면 이 대학 방식으로 점수를 계산할 수 없는 응시자가 내 위·아래 어디에 있는지에 따라 달라지는 것이고, 실제 위치는 그 사이입니다.";
export const REFERENCE_GROUPS_TITLE = "누적 백분위(추정)로 본 대학";

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

/** 소수 첫째 자리로 내림(floor=true) 또는 올림. 숫자 꼴이 아니면 null */
function cut1(s: string | null | undefined, floor: boolean): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!DECIMAL.test(t)) return null;
  const [int, frac = ""] = t.split(".");
  let n = BigInt(int + (frac[0] ?? "0"));
  if (!floor && /[1-9]/.test(frac.slice(1))) n += BigInt(1);
  const v = n.toString().padStart(2, "0");
  return `${BigInt(v.slice(0, -1)).toString()}.${v.slice(-1)}`;
}

/**
 * 보여 줄 수 있는 참고 누백 값. 한 값이면 "16.7", 범위면 "12.3~14.8"(하한 내림·상한 올림, 대표님 결정 2026-11-16).
 * 범위는 이 대학 방식으로 점수를 낼 수 없는 응시자가 내 위에 있는지 아래에 있는지 몰라서 생긴다.
 * 칸이 없거나 reference_estimated 가 아니거나 숫자가 아니면 null
 */
export function referencePercentText(p: ReferencePercentileDto | null | undefined): string | null {
  if (!p || p.status !== "reference_estimated") return null;
  const low = p.estimated_upper_cumulative_percent_all_examinees, high = p.estimated_upper_cumulative_percent_upper_bound;
  const single = roundPercent1(low);
  if (single === null || typeof high !== "string" || high.trim() === low.trim()) return single;
  const a = cut1(low, true), b = cut1(high, false);
  if (a === null || b === null || Number(b) < Number(a)) return single;
  return a === b ? a : `${a}~${b}`;
}

/** 4페이지 참고 묶음: 서버 순서 그대로(순위 아님), 보여 줄 값이 있는 모집단위만, 빈 대학은 뺀다 */
export function referenceGroups(c: CandidatesDto | null | undefined): ReferenceUniversityGroupDto[] {
  return (c?.reference_university_groups ?? [])
    .map((g) => ({ ...g, offerings: (g.offerings ?? []).filter((it) => it?.offering && referencePercentText(it.reference_percentile)) }))
    .filter((g) => g.offerings.length > 0);
}
