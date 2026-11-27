/**
 * 4페이지 상세 '왜 이 단계인가요?' (2026-11-26 대표님 결정)
 * - 수능은 끝났으니 '몇 점 부족'은 쓰지 않는다. 위·아래 경계에 얼마나 가까운지를 말로 보인다(무료로 열 수 있는 줄).
 * - 정확한 점수(내 환산점수·경계 점수·차이)는 따로 한 줄로 둔다(나중에 유료로만 보낼 줄).
 * share_pct: 같은 단계로 판정되는 점수대의 맨 아래 0 ~ 맨 위 100(서버 positionOf, 전문가용과 같은 값).
 * 가채점 점수 범위에 따른 단계 변화는 화면의 기존 한 줄('가채점 점수 범위 안에서는 ○부터 ○까지')이 따로 보인다.
 */
export type BoundaryPosition = { score: string; better_gap: string | null; worse_gap: string | null; share_pct: number | null };
export type BoundaryNote = { lead: string; exact: string | null };

/** 경계에 '가깝다'고 말하는 기준: 단계 점수대의 위·아래 20% 안 */
export const NEAR_PCT = 20;

const sum = (a: string, b: string) => (Math.round((Number(a) + Number(b)) * 100) / 100).toFixed(2);
const sub = (a: string, b: string) => (Math.round((Number(a) - Number(b)) * 100) / 100).toFixed(2);
const DEC = /^-?\d+(?:\.\d+)?$/;

export function boundaryNote(args: {
  label: string;
  better: string | null;
  worse: string | null;
  pos: BoundaryPosition | null | undefined;
  final: boolean;
}): BoundaryNote | null {
  const { label, better, worse, pos, final } = args;
  const share = pos && typeof pos.share_pct === "number" && Number.isFinite(pos.share_pct) ? pos.share_pct : null;
  const parts: string[] = [];
  if (share !== null && better && worse) {
    if (share >= 100 - NEAR_PCT) parts.push(`${label} 안에서도 위쪽으로, ${better} 경계에 가깝습니다.`);
    else if (share <= NEAR_PCT) parts.push(`${label} 안에서도 아래쪽으로, ${worse} 경계에 가깝습니다.`);
    else parts.push(`${label} 구간의 가운데쯤으로, 위·아래 경계와 거리가 있습니다.`);
  } else if (!better && worse) {
    parts.push(`가장 좋은 단계입니다.`);
  } else if (better && !worse) {
    parts.push(`가장 낮은 단계입니다.`);
  }
  if (!parts.length) return null;
  let exact: string | null = null;
  if (pos && DEC.test(pos.score)) {
    const bits = [`내 환산점수${final ? "" : "(가운데 추정)"} ${pos.score}점`];
    if (better && pos.better_gap && DEC.test(pos.better_gap)) bits.push(`${better} 경계 ${sum(pos.score, pos.better_gap)}점과 ${pos.better_gap}점 차이`);
    if (worse && pos.worse_gap && DEC.test(pos.worse_gap)) bits.push(`${worse} 경계 ${sub(pos.score, pos.worse_gap)}점보다 ${pos.worse_gap}점 위`);
    exact = bits.join(" · ");
  }
  return { lead: parts.join(" "), exact };
}
