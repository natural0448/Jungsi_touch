import { POSITION_NONE_DESC, POSITION_NONE_LABEL } from "@/lib/position-note";
import type { ReferenceBandDto } from "@/lib/dto";
import { BAND } from "@/lib/decision-labels";
import { csatBandText, csatUpper } from "@/lib/provisional-view";
import { csatGainTone, type CsatGainTone } from "@/lib/report-pure";
import { csatComboNote } from "@/lib/csat-combo";
import { CSAT_SCOPE_BASIS_NOTE, CSAT_SCOPE_TAG, csatScopeBasis } from "@/lib/csat-scope-basis";

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

/** 학생부 등 함께 반영 전형의 수능 반영분 기준 판정 안내(서버 band.score_scope, 2026-11-25) */
export const CSAT_SCOPE_NOTE = "이 전형은 학생부 등도 함께 반영합니다. 이 판정은 수능 반영분만으로 본 것이며, 학생부 등 다른 영역은 포함하지 않았습니다.";
/** id: 모집단위 번호(수능 기준 판정의 근거 종류 꼬리표, 담당자 R23-4). 없으면 기본 꼬리표 */
export function CsatBadge({ band, id }: { band?: ReferenceBandDto | null; id?: string }) {
  if (!band || !BAND[band.code]) return null;
  if (band.held) return <span className="st check" title={POSITION_NONE_DESC}>{POSITION_NONE_LABEL}</span>;
  const tone = BAND[band.code];
  const upper = csatUpper(band);
  const basis = band.score_scope === "csat_component" ? csatScopeBasis(id) : null;
  const scope = basis ? `${CSAT_SCOPE_NOTE} ${CSAT_SCOPE_BASIS_NOTE[basis]} ` : "";
  // 2026-11-25: 유불리와 합친 한 줄 해석('하향인데 불리' 같은 조합이 모순으로 읽히지 않게)
  const combo = csatComboNote(band.code, band.upper_code, csatGainView(band)?.tone);
  const title = scope + (upper
    ? `가채점 점수 범위에 따라 ${BAND[band.code].label}부터 ${BAND[upper].label}까지 나옵니다. 지원 자격은 모집요강에서 확인하세요`
    : `${tone.desc} 지원 자격은 모집요강에서 확인하세요`) + (combo ? ` ${combo}` : "");
  return <span className={`st ${tone.cls}`} title={title}>{csatBandText(band)}{basis && <small className="scope"> · {CSAT_SCOPE_TAG[basis]}</small>}</span>;
}

/** 가채점 환산 유불리 보기 값(서버 dep_r31 school_gain). 보류 모집단위(held)·값 없음이면 null */
export type { CsatGainTone };
export const CSAT_GAIN_WORD: Record<CsatGainTone, string> = { up: "유리", down: "불리", even: "비슷", split: "가채점에 따라 갈림" };
export function csatGainView(band?: ReferenceBandDto | null): { tone: CsatGainTone; text: string; range: string | null; locked?: boolean } | null {
  // 무료 공개 응답(2026-11-26): 숫자 없이 방향만(gain_tone). 숫자는 실채점 이용권
  if (band && !band.held && !band.school_gain && band.gain_tone) return { tone: band.gain_tone, text: "", range: null, locked: true };
  const g = band && !band.held ? band.school_gain : null;
  if (!g) return null;
  const main = g.central ?? null;
  const tone = csatGainTone(main, g.low, g.high);
  if (!tone) return null;
  const range = g.low !== g.high ? `${g.low}~${g.high}` : null;
  // 갈림이면 가운데 값 대신 0 을 사이에 둔 범위 자체를 보인다(가운데 값만 보이면 한쪽으로 읽힌다)
  if (tone === "split" && range) return { tone, text: range, range: null };
  return { tone, text: main ?? range ?? g.low, range: main !== null ? range : null };
}
/** 4페이지 목록의 '환산 유불리' 칸(가채점). 9월 칸과 같은 모양 */
export function CsatAdvantage({ band }: { band?: ReferenceBandDto | null }) {
  const v = csatGainView(band);
  if (!v) return null;
  const width = v.locked ? 0 : Math.min(50, (Math.abs(Number(v.text.split("~")[0])) / 0.6) * 50);
  return (
    <span className="adv" title={[csatComboNote(band?.code, band?.upper_code, v.tone), v.range ? `가채점 범위에 따라 ${v.range}%p` : null].filter(Boolean).join(" ") || undefined}>
      {/* 갈림이면 0 을 가운데 둔 막대가 뜻이 없어 틀째 숨긴다(자리는 남겨 줄 맞춤 유지, 11-24 대표님 지적) */}
      <span className="bar" aria-hidden="true" style={v.tone === "split" ? { visibility: "hidden" } : undefined}>{(v.tone === "up" || v.tone === "down") && <i className={v.tone} style={{ width: `${width}%` }} />}</span>
      <span className={`v num ${v.tone}`}><b className="advw">{CSAT_GAIN_WORD[v.tone]}</b>{v.locked ? null : <> {v.text}%p</>}</span>
    </span>
  );
}
