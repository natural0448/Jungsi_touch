import { POSITION_NONE_DESC, POSITION_NONE_LABEL } from "@/lib/position-note";
import type { ReferenceBandDto } from "@/lib/dto";
import { BAND } from "@/lib/decision-labels";
import { csatBandText, csatUpper } from "@/lib/provisional-view";
import { csatGainTone, type CsatGainTone } from "@/lib/report-pure";

/*
  수능 가채점 7단계 배지(3페이지 유리한 대학 찾기·4페이지 가능성 보기 공용, 2026-11-23 4페이지로 옮김).
  한 단계면 '적정', 중앙 추정이 없어 범위면 '적정~소신'(색은 좋은 끝 단계). 서버 판정(source g)을 그대로 보인다.
  서버 전용 모듈을 import 하지 않는다(4페이지 펼친 상세는 브라우저 화면도 쓴다).
*/
/** 가채점 '내 환산점수' 칸(4페이지). 가운데 추정 점수가 있으면 그 값 + 범위, 없으면 범위만. 점수가 없으면 null */
export function CsatScore({ band }: { band?: ReferenceBandDto | null }) {
  const s = band?.school_score;
  if (!s) return null;
  const range = s.low === s.high ? s.low : `${s.low}~${s.high}`;
  const title = `가채점 원점수로 추정한 이 대학 방식 환산점수입니다. 표준점수 범위에 따라 ${range} 사이로 계산됩니다`;
  return (
    <span className="score" title={title}>
      <b className="num">{s.central ?? range}</b>
      {s.central !== null && s.low !== s.high && <small>{range}</small>}
    </span>
  );
}

export function CsatBadge({ band }: { band?: ReferenceBandDto | null }) {
  if (!band || !BAND[band.code]) return null;
  if (band.held) return <span className="st check" title={POSITION_NONE_DESC}>{POSITION_NONE_LABEL}</span>;
  const tone = BAND[band.code];
  const upper = csatUpper(band);
  const title = upper
    ? `가채점 점수 범위에 따라 ${BAND[band.code].label}부터 ${BAND[upper].label}까지 나옵니다. 지원 자격은 모집요강에서 확인하세요`
    : `${tone.desc} 지원 자격은 모집요강에서 확인하세요`;
  return <span className={`st ${tone.cls}`} title={title}>{csatBandText(band)}</span>;
}

/** 가채점 환산 유불리 보기 값(서버 dep_r31 school_gain). 보류 모집단위(held)·값 없음이면 null */
export type { CsatGainTone };
export const CSAT_GAIN_WORD: Record<CsatGainTone, string> = { up: "유리", down: "불리", even: "비슷", split: "가채점에 따라 갈림" };
export function csatGainView(band?: ReferenceBandDto | null): { tone: CsatGainTone; text: string; range: string | null } | null {
  const g = band && !band.held ? band.school_gain : null;
  if (!g) return null;
  const main = g.central ?? null;
  const tone = csatGainTone(main, g.low, g.high);
  if (!tone) return null;
  const range = g.low !== g.high ? `${g.low}~${g.high}` : null;
  return { tone, text: main ?? range ?? g.low, range: main !== null ? range : null };
}
/** 4페이지 목록의 '환산 유불리' 칸(가채점). 9월 칸과 같은 모양 */
export function CsatAdvantage({ band }: { band?: ReferenceBandDto | null }) {
  const v = csatGainView(band);
  if (!v) return null;
  const width = Math.min(50, (Math.abs(Number(v.text.split("~")[0])) / 0.6) * 50);
  return (
    <span className="adv" title={v.range ? `가채점 범위에 따라 ${v.range}%p` : undefined}>
      <span className="bar" aria-hidden="true">{(v.tone === "up" || v.tone === "down") && <i className={v.tone} style={{ width: `${width}%` }} />}</span>
      <span className={`v num ${v.tone}`}><b className="advw">{CSAT_GAIN_WORD[v.tone]}</b> {v.text}%p</span>
    </span>
  );
}
