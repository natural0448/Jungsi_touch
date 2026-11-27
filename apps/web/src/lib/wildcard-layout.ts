import type { CandidateItemDto, WildcardGroup, WildcardSelectionDto } from "./dto";

/*
  4페이지 와일드카드('비장의 한 수')를 몇 장, 어떤 순서로 보일지.
  - 서버 선택(wildcard_selection)이 있으면: 서버가 정한 순서 그대로, 최대 4장. 앞 3장을 펼치고 4번째는 '더보기'.
  - 없으면(운영 연결 전·옛 응답): 옛 방식. 환산 유불리 큰 순서로 앞 3장, 나머지는 전부 '더 펼치기'.
  화면은 서버 순서를 다시 정렬하지 않는다(3·4페이지·리포트·전문가용이 같은 결과를 쓰게 하기 위함).
*/

export const FEATURED = 3;
export const MAX_SELECTED = 4;

/** 계열 이름. 옛 방식은 간호·보건·교육 3개, 서버 선택은 6개 */
export const WILDCARD_GROUP_LABEL: Record<WildcardGroup, string> = {
  nursing: "간호",
  health: "보건",
  education: "교육",
  contract: "계약학과",
  maritime: "해양",
  railway: "철도",
};
const LEGACY_GROUPS: WildcardGroup[] = ["nursing", "health", "education"];
const ALL_GROUPS = Object.keys(WILDCARD_GROUP_LABEL) as WildcardGroup[];

/** 서버 선택이 순서를 다 정하지 못했을 때(partial·pending)의 이유 */
export const WILDCARD_REASON: Record<string, string> = {
  wildcard_evidence_unavailable: "순서를 정할 근거 자료를 확인하고 있습니다.",
  wildcard_assessment_pending: "와일드카드 후보의 판단 자료를 확인하고 있습니다.",
  wildcard_comparison_unverified: "후보끼리 같은 기준으로 비교되는지 확인하고 있어 순서를 아직 확정하지 않았습니다.",
};
export const wildcardReasonText = (code: string | null | undefined) =>
  code ? WILDCARD_REASON[code] ?? "와일드카드 자료를 확인하고 있습니다." : "";

/** W5 수능 외 조건(offering.non_csat_conditions) 카드 안내. 모르는 코드는 숨긴다 */
export const NON_CSAT_CONDITION: Record<string, string> = {
  seafarer_health_exam: "선원건강진단 기준이 있습니다",
  railway_driver_aptitude: "철도운전 신체·적성검사가 있습니다",
  csat_minimum: "수능 최저기준이 있습니다",
};
export const nonCsatConditionTexts = (codes: string[] | null | undefined): string[] =>
  Array.from(new Set((Array.isArray(codes) ? codes : []).filter((c) => typeof c === "string" && c in NON_CSAT_CONDITION))).map((c) => NON_CSAT_CONDITION[c]);

export interface WildcardLayout {
  /** selected: 서버 선택, legacy: 옛 방식 */
  mode: "selected" | "legacy";
  featured: CandidateItemDto[];
  rest: CandidateItemDto[];
  /** 서버 선택 상태. 옛 방식이면 null */
  status: WildcardSelectionDto["status"] | null;
  /** partial·pending 일 때만 */
  reasonCode: string | null;
  /** 순서 근거를 아직 확인 중인 카드 */
  pendingIds: Set<string>;
  /** 안내 문구에 쓸 계열 이름들 */
  groupLabels: string[];
}

const delta = (w: CandidateItemDto) => (w.assessment.advantage ? Number(w.assessment.advantage.delta_pp) : -Infinity);

export function wildcardLayout(picks: CandidateItemDto[], selection: WildcardSelectionDto | null | undefined): WildcardLayout {
  if (selection) {
    const cards = picks.slice(0, MAX_SELECTED);
    return {
      mode: "selected",
      featured: cards.slice(0, FEATURED),
      rest: cards.slice(FEATURED),
      status: selection.status,
      reasonCode: selection.status === "ready" ? null : selection.reason_code,
      pendingIds: new Set(selection.card_stability.filter((s) => s.status === "pending").map((s) => s.offering_id)),
      groupLabels: ALL_GROUPS.map((g) => WILDCARD_GROUP_LABEL[g]),
    };
  }
  const sorted = [...picks].sort((a, b) => delta(b) - delta(a));
  return {
    mode: "legacy",
    featured: sorted.slice(0, FEATURED),
    rest: sorted.slice(FEATURED),
    status: null,
    reasonCode: null,
    pendingIds: new Set(),
    groupLabels: LEGACY_GROUPS.map((g) => WILDCARD_GROUP_LABEL[g]),
  };
}
