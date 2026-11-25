import { csatC1Score, csatNoJudgmentView, type NoJudgmentView } from "@/lib/csat-conditions";
import { csatComboConflict, csatComboNote } from "@/lib/csat-combo";
import type { ReferenceBandDto } from "@/lib/dto";
import { heldBand } from "@/lib/csat-held";
import { personalCsatPoint, personalCsatScore } from "@/lib/personal-csat-point";
import { AdvantageCell, CategoryLegend, PickButton, ScoreCell, StatusCell, type Cell } from "@/components/offering-parts";
import { ScoreBasis } from "@/components/score-basis";
import { StreamTray } from "@/components/shortlist-tray-stream";
import type { Caller, JungsiSource } from "@/lib/api";
import type { OfferingDto, ReportDto } from "@/lib/dto";
// 펼친 상세·지원 조건·칸 값은 브라우저 화면(전문가용 인쇄)도 쓰므로 서버 전용 모듈 없는 mine-detail.tsx 에 둔다(2026-11-22 ship54 빌드 실패)
export { cellOf, MineConds, MineDetail } from "./mine-detail";
import { csatJudged, pickedIds } from "@/lib/report-pure";
import { cellOf } from "./mine-detail";
import { POSITION_NONE_DESC, POSITION_NONE_LABEL } from "@/lib/position-note";
import { CsatAdvantage, CsatBadge, CsatScore, csatGainView } from "@/components/csat-badge";
import { csatExceptionView } from "@/lib/csat-exceptions";
import { exceptionCls } from "@/lib/csat-exceptions";

/*
  4페이지에서 '내 리포트'가 있어야 그릴 수 있는 칸들.
  2026-11-21 대표님 지적으로 '먼저 온 것부터 그리기'(11-10)를 거뒀다: 목록은 내 분석(지원가능성·판정)까지 모두 준비된 뒤
  한 번에 보이고, 그 전에는 책 넘김 대기 화면이다(catalog-browse.tsx). 그래서 여기 칸들은 기다리지 않고 받은 리포트로 바로 그린다.
  '분석 대기'·'확인 못 함'·'불러오는 중' 같은 중간 상태는 그리지 않는다.
*/


const SCORE_EMPTY = "검색과 모집 정보는 지금 볼 수 있고, 성적을 넣으면 모집단위마다 내 분석이 붙습니다.";

/** 내 성적 기준 줄 */
export function MineBasis({ report, single = false }: { report: ReportDto | null; single?: boolean }) {
  return <ScoreBasis single={single} overall={report?.overall ?? null} emptyText={SCORE_EMPTY} />;
}

export function MineLegend({ report }: { report: ReportDto | null }) {
  // 가채점도 9월과 같은 범례(2026-11-23)
  return report ? <CategoryLegend csat={csatJudged(report)} /> : null;
}

/** 수능 가채점 리포트에서 판정이 없는 모집단위(9월과 같은 '판정 근거 부족', 2026-11-23) */
const PROV = <span className="st check" title={POSITION_NONE_DESC}>{POSITION_NONE_LABEL}</span>;
const DASH = <span className="need" aria-label="해당 없음">─</span>;
/** 판정 없음 사유(담당자 D1 11-23): 지원 조건 미충족 / 비교 기준 확인 필요 */
const noJudgmentBadge = (v: NoJudgmentView | null) => (v ? <span className={`st ${v.cls}`} title={v.desc}>{v.label}</span> : PROV);

// '이 범위 다시 확인' 띠·버튼은 두지 않는다(2026-11-21 대표님 지적: 자료판이 바뀔 때마다 모든 고객에게 떴다).
// 첫 분석·옛 자료판 재확인은 화면을 그리기 전에 서버가 조용히 끝낸다(report-ops settleAnalyses)

/** 분석을 끝내 만들지 못한 모집단위(자료 미연결 등)의 확정 표시 */
const NO_DATA = <span className="need" title="이 모집단위는 아직 분석 자료에 연결되지 않아 내 성적으로 계산하지 않았습니다">자료 없음</span>;

/** 지원가능성과 유불리가 엇갈려 보이는 줄만 목록에서 바로 해석 한 줄(2026-11-25 대표님 결정, 휴대폰은 마우스 올리기가 없어서) */
function comboLine(band: ReferenceBandDto | null | undefined) {
  const tone = csatGainView(band)?.tone;
  if (!band || !csatComboConflict(band.code, band.upper_code, tone)) return null;
  const note = csatComboNote(band.code, band.upper_code, tone);
  return note ? <span className="c-combo">{note}</span> : null;
}

/** 한 줄의 내 환산점수·지원가능성·환산 유불리·담기 칸 */
export function MineCells({ report, id, single = false }: { report: ReportDto | null; id: string; single?: boolean }) {
  const a = cellOf(report, id);
  if (report && csatJudged(report)) {
    // 서버 dep_r29(2026-11-23): 이 모집단위의 학교별 가채점 판정이 붙었으면 7단계 배지, 없으면 '가채점 판정 준비 중'
    const raw = heldBand(id, report.provisional_bands?.[id]);
    const band = single ? personalCsatPoint(raw) : raw;
    // 예외 17곳(담당자 출시 자료 11-23): 7단계 대신 허용된 이름만(최저충족·최저미충족·최저 확인 대기·판정 준비 중)
    const ex = band ? null : csatExceptionView(id, report.overall);
    const c1Base = band ? null : csatC1Score(id, report.overall);
    const c1 = single ? personalCsatScore(c1Base) : c1Base;
    if (ex) return <><span className="c-score r">{c1 ? <span className="score" title={c1.label}><b className="num">{c1.central ?? `${c1.low}~${c1.high}`}</b>{c1.central !== null && c1.low !== c1.high && <small>{c1.low}~{c1.high}</small>}</span> : DASH}</span><span className="c-st"><span className={`st ${exceptionCls(ex)}`} title={ex.desc}>{ex.label}</span></span><span className="c-adv r">{DASH}</span><span className="c-pick"><PickButton id={id} on={pickedIds(report).has(id)} /></span></>;
    return <><span className="c-score r">{band?.school_score ? <CsatScore band={band} /> : c1 ? <span className="score" title={c1.label}><b className="num">{c1.central ?? `${c1.low}~${c1.high}`}</b>{c1.central !== null && c1.low !== c1.high && <small>{c1.low}~{c1.high}</small>}</span> : DASH}</span><span className="c-st">{band ? <CsatBadge band={band} id={id} /> : noJudgmentBadge(csatNoJudgmentView(id, report.overall, report.provisional_min?.[id]))}</span><span className="c-adv r">{csatGainView(band) ? <CsatAdvantage band={band} /> : DASH}</span><span className="c-pick"><PickButton id={id} on={pickedIds(report).has(id)} /></span>{comboLine(band)}</>;
  }
  if (a === null) {
    return <><span className="c-score r">{NO_DATA}</span><span className="c-st">{NO_DATA}</span><span className="c-adv r">{NO_DATA}</span><span className="c-pick">{report && <PickButton id={id} on={pickedIds(report).has(id)} />}</span></>;
  }
  return (
    <>
      <span className="c-score r"><ScoreCell a={a} /></span>
      <span className="c-st"><StatusCell a={a} overall={report?.overall?.overall} /></span>
      <span className="c-adv r"><AdvantageCell a={a} overall={report?.overall?.overall} /></span>
      <span className="c-pick">{report && <PickButton id={id} on={pickedIds(report).has(id)} />}</span>
    </>
  );
}



/** 핵심 지원 학교 띠. 개수와 이 목록에 있는 이름은 바로, 목록에 없는 곳의 이름만 뒤이어(shortlist-tray-stream.tsx) */
export function MineTray({ report, items, src, caller, links }: { report: ReportDto | null; items: OfferingDto[]; src: JungsiSource; caller: Caller; links?: { other: string; report: string; reportLabel?: string } }) {
  if (!report) return null;
  return <StreamTray report={report} known={items} src={src} caller={caller} other="PAGE-04" links={links} />;
}
