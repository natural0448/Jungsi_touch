import type { CsatGainTone } from "./report-pure";

/*
  지원가능성(합격선과의 거리)과 환산 유불리(이 대학 계산 방식의 득실)를 한 문장으로 합친 해석(2026-11-25 대표님 지적:
  '하향인데 불리'가 목록에 나란히 있으면 사용자가 모순으로 읽는다). 두 값이 엇갈리면 '~지만, 그래도'로 잇는다.
*/
type Band = "stable" | "downward" | "target" | "aspirational" | "upward" | "challenge" | "outside";
const POS: Record<Band, string> = {
  stable: "예상 합격권보다 충분히 앞에 있습니다",
  downward: "예상 합격권보다 앞에 있습니다",
  target: "예상 합격권 안 앞쪽에 있습니다",
  aspirational: "예상 합격권 안 뒤쪽에 있습니다",
  upward: "예상 합격권보다 조금 뒤에 있습니다",
  challenge: "예상 합격권보다 뒤에 있어 결과를 장담하기 어렵습니다",
  outside: "예상 합격선에 못 미칩니다",
};
const LABEL: Record<Band, string> = { stable: "안정", downward: "하향", target: "적정", aspirational: "소신", upward: "상향", challenge: "도전", outside: "불가" };
const GOOD = new Set<Band>(["stable", "downward", "target", "aspirational"]);
const isBand = (v: unknown): v is Band => typeof v === "string" && v in POS;

/** 단계(code, 범위면 upper)와 유불리 방향으로 한 문장. 둘 중 하나라도 없으면 null */
export function csatComboNote(code: unknown, upper: unknown, tone: CsatGainTone | null | undefined): string | null {
  if (!isBand(code) || !tone) return null;
  const range = isBand(upper) && upper !== code;
  const pos = range ? `가채점 범위에 따라 ${LABEL[code]}~${LABEL[upper as Band]}입니다` : POS[code];
  const good = GOOD.has(code) && (!range || GOOD.has(upper as Band));
  const bad = !GOOD.has(code) && (!range || !GOOD.has(upper as Band));
  switch (tone) {
    case "down": return good ? `이 대학 계산 방식은 내게 불리하지만, 그래도 ${pos}.` : `이 대학 계산 방식이 내게 불리하고, ${pos}.`;
    case "up": return bad ? `이 대학 계산 방식은 내게 유리하지만, 그래도 ${pos}.` : `이 대학 계산 방식이 내게 유리하고, ${pos}.`;
    case "even": return `이 대학 계산 방식으로도 내 순위는 비슷하고, ${pos}.`;
    case "split": return `이 대학 계산 방식의 득실은 가채점 결과에 따라 갈리고, ${pos}.`;
  }
  return null;
}
/** 두 칸이 무엇을 재는지(목록 머리 안내) */
export const CSAT_COMBO_HELP = "지원가능성은 이 대학 방식 점수가 예상 합격선에서 얼마나 떨어져 있는지, 환산 유불리는 이 대학 계산 방식이 내게 득인지 손해인지(국·수·탐 표준점수 합으로 줄 세울 때와 비교)입니다. 그래서 '하향인데 불리'처럼 함께 나올 수 있습니다.";
