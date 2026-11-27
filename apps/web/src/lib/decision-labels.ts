import type { BandCode, Category } from "./dto";

/*
  지원가능성 이름·풀이(3·4페이지 배지와 2페이지 핵심 지원 학교 표가 같이 쓴다).
  화면 부품(components/offering-parts.tsx)이 이 값을 그대로 다시 내보낸다. 시험(tests/*.mjs)이 tsx 없이 읽을 수 있게 여기 둔다.
*/

/** 학과마다의 지원 판단(assessment.category). 색과 함께 점 모양으로도 구분, 빨강은 '지원 조건 미충족'에만.
 * desc 는 입시 용어에 익숙하지 않은 사용자(수험생·학부모)를 위한 쉬운 풀이 — 기준 점수는 적지 않는다 */
export const CATEGORY: Record<Category, { cls: string; label: string; desc: string }> = {
  challenge: { cls: "reach", label: "도전", desc: "지금 점수보다 다소 높아 결과를 장담하기 어렵지만, 지원해 볼 수 있는 범위입니다." },
  core: { cls: "core", label: "핵심 검토", desc: "올해 적극적으로 검토해 볼 만한 범위입니다." },
  room: { cls: "safe", label: "여유 후보", desc: "내 점수에 비교적 여유가 있는 범위입니다. 그래도 합격이 보장되는 것은 아닙니다." },
  outside: { cls: "out", label: "검토 범위 밖", desc: "올해 기준으로는 지원 검토 범위에 들지 않습니다. 지원 자체가 불가능하다는 뜻은 아닙니다." },
  pending: { cls: "check", label: "판단 보류", desc: "판단에 필요한 자료가 아직 갖춰지지 않아 결론을 내리지 않았습니다." },
  ineligible: { cls: "inel", label: "지원 조건 미충족", desc: "이 전형이 요구하는 지원 조건(과목·자격)을 충족하지 않습니다." },
};

/** 7단계 판정(assessment.band). 순서: 안정 → 하향 → 적정 → 소신 → 상향 → 도전 → 불가. 색은 기존 세 묶음(여유·핵심·도전)을 그대로 쓴다 */
export const BAND: Record<BandCode, { cls: string; label: string; desc: string }> = {
  stable: { cls: "safe", label: "안정", desc: "예상 합격권보다 충분히 앞선 위치입니다. 그래도 합격이 보장되는 것은 아닙니다." },
  downward: { cls: "safe", label: "하향", desc: "예상 합격권보다 조금 앞선 위치입니다." },
  target: { cls: "core", label: "적정", desc: "예상 합격권 안에서 앞쪽 절반에 드는 위치입니다." },
  aspirational: { cls: "core", label: "소신", desc: "예상 합격권 안에서 뒤쪽 절반에 드는 위치입니다." },
  upward: { cls: "reach", label: "상향", desc: "예상 합격권에서 조금 벗어난 위치입니다." },
  challenge: { cls: "reach", label: "도전", desc: "예상 합격권에서 꽤 벗어나 결과를 장담하기 어려운 위치입니다." },
  outside: { cls: "out", label: "불가", desc: "합격선보다 크게 낮은 위치입니다(7단계 중 가장 아래). 지원 자격과는 관계없으며, 지원은 할 수 있습니다." },
};
