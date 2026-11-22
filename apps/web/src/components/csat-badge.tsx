import type { ReferenceBandDto } from "@/lib/dto";
import { BAND } from "@/lib/decision-labels";
import { csatBandText, csatUpper } from "@/lib/provisional-view";

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
  const tone = BAND[band.code];
  const upper = csatUpper(band);
  const title = upper
    ? `가채점 점수 범위에 따라 ${BAND[band.code].label}부터 ${BAND[upper].label}까지 나옵니다. 지원 자격은 모집요강에서 확인하세요`
    : `${tone.desc} 지원 자격은 모집요강에서 확인하세요`;
  return <span className={`st ${tone.cls}`} title={title}>{csatBandText(band)}</span>;
}
