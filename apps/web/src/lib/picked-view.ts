import type { AssessmentDto, OverallResultDto } from "./dto";
import { BAND, CATEGORY } from "./decision-labels";
import { positionNoteOf } from "./position-note";

/*
  2페이지 '핵심 지원 학교' 표(대표님 요청 2026-11-21).
  - 담기 한도: 같은 모집군 5개 · 전체 15개(전에는 4·12). 막는 것은 서버(report_actions SHORTLIST_GROUP_LIMIT)이고 화면은 셈만 보인다.
    정시 원서는 군마다 하나라 전체 한도는 군 수(가·나·다 3) × 군별 한도와 같다.
  - 가·나·다군으로 나눠 보인다. 모집군을 모르는 곳(지금 목록에서 빠진 모집단위)은 맨 뒤에 따로 둔다.
  - 판단 근거는 3·4페이지 지원가능성 배지(offering-parts CategoryBadge)와 같은 순서로 고른 문장이다:
    참고 기준 7단계 → 합격선 대비 위치 → 판정 근거 부족 → 판정 준비 중 → 정식 판정 → 그 밖의 이유.
*/
export const PICK_GROUP_LIMIT = 5;
export const PICK_GROUPS = ["가", "나", "다"] as const;
export const PICK_TOTAL_LIMIT = PICK_GROUP_LIMIT * PICK_GROUPS.length;

export interface GroupedPicks<T> {
  groups: { group: (typeof PICK_GROUPS)[number]; items: T[] }[];
  /** 모집군을 모르는 곳(목록에서 빠졌거나 군이 가·나·다가 아님) */
  other: T[];
}

/** 담은 곳을 가·나·다군으로 나눈다. 군 안의 순서는 받은 순서 그대로다. 비어 있는 군도 늘 세 칸을 돌려준다 */
export function groupPicked<T extends { offering: { group: string } | null }>(items: T[]): GroupedPicks<T> {
  const groupOf = (s: T) => PICK_GROUPS.find((g) => (s.offering?.group ?? "").trim().startsWith(g)) ?? null;
  const groups = PICK_GROUPS.map((group) => ({ group, items: items.filter((s) => groupOf(s) === group) }));
  return { groups, other: items.filter((s) => groupOf(s) === null) };
}

/** 모집군별 담은 수(3·4페이지 담기 띠). 모집군을 모르는 곳은 전체에만 센다 */
export function groupCounts<T extends { offering: { group: string } | null }>(items: T[]): { group: string; n: number }[] {
  return groupPicked(items).groups.map((g) => ({ group: g.group, n: g.items.length }));
}

/** 참고 기준 판정을 보일지(offering-parts referenceBandOf 와 같다). 정식 판정이 난 곳(ready)·자격 미충족에는 보이지 않는다 */
const refBand = (a: AssessmentDto) => (a.status !== "ready" && a.status !== "ineligible" && a.reference_band && BAND[a.reference_band.code] ? a.reference_band : null);

/**
 * 판단 근거 한 문장. 내부 기준 수치(판단 구간·예상선)는 적지 않는다(최종 관리자 지시 2026-10-07).
 * reason: 이유 코드 → 화면 문장(offering-parts reasonText). 참고 환산 코드는 판정 이유가 아니므로 넘기기 전에 바꾼다(decisionReasonCode)
 */
export function decisionBasisText(a: AssessmentDto, overall: OverallResultDto | null | undefined, reason: (code: string | null | undefined) => string): string {
  const ref = refBand(a);
  if (ref) {
    const ranged = ref.upper_code && ref.upper_code !== ref.code ? " 내 위치가 범위로 나와 점수를 낸 응시자 기준 추정값으로 판정했습니다." : "";
    return `이 대학 방식으로 본 내 위치(누적 백분위)를 올해 합격권과 견주면 '${BAND[ref.code].label}'입니다. ${BAND[ref.code].desc}${ranged}`;
  }
  const pn = positionNoteOf(a, overall);
  if (pn?.kind === "line") {
    const via = pn.basis === "overall" ? " (이 대학 기준 내 위치가 없어 국·수·탐 표준점수 합 전체 위치로 견줌)" : "";
    return `${pn.margin.text}입니다${via}. 지난해 합격선 하나와 견준 위치 비교이며 합격 가능성 판정은 아닙니다.`;
  }
  if (pn?.kind === "none") return "지난해 합격선을 내 위치와 같은 기준으로 옮긴 자료가 없어 판정을 만들지 않았습니다. 대학 발표 입시결과와 함께 보고 판단하세요.";
  if (a.status === "pending" && a.eligibility_status === "needs_confirmation") return "이 모집단위의 판정 자료가 아직 준비되지 않았습니다. 지원 자격은 모집요강에서 확인하세요.";
  if (a.status === "ready") {
    const d = a.band && BAND[a.band.code] ? BAND[a.band.code] : CATEGORY[a.category];
    if (d) return `지난 입시결과와 견주면 '${d.label}'입니다. ${d.desc}`;
  }
  return reason(a.reason_code) || "입력한 성적으로 이 모집단위의 판정을 만들지 않았습니다.";
}
