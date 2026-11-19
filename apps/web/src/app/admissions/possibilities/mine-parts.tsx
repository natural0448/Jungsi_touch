import { ConnectionNotice } from "@/components/connection-notice";
import { AdvantageCell, CategoryLegend, PickButton, ScoreCell, StatusCell, type Cell } from "@/components/offering-parts";
import { RunAnalysis } from "@/components/run-analysis";
import { ScoreBasis } from "@/components/score-basis";
import { StreamTray } from "@/components/shortlist-tray-stream";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";
import type { OfferingDto } from "@/lib/dto";
import { mineReport, pickedIds, type MineResult } from "@/lib/report-ops";
import { Detail } from "./parts";

/*
  3페이지에서 '내 리포트'가 있어야 그릴 수 있는 칸들(2026-11-10 부담당자 요청: 먼저 온 것부터 그리기).
  검색 목록은 searchOfferings 만 오면 그리고, 이 칸들은 각자 Suspense 경계 안에서 내 리포트(score-input-status → report)를 기다린다.
  모두 같은 약속(MineResult) 하나를 기다리므로 리포트는 한 번만 받는다.
*/

type P = Promise<MineResult>;

/** 이 모집단위의 칸 값. 리포트가 없으면(성적 전) 'need', 받지 못했으면 null(칸은 따로 '확인 못 함') */
export function cellOf(m: MineResult, id: string): Cell {
  const r = mineReport(m);
  if (!m.ok) return null;
  return r ? r.analyses?.[id] ?? null : "need";
}

const SCORE_EMPTY = "검색과 모집 정보는 지금 볼 수 있고, 성적을 넣으면 모집단위마다 내 분석이 붙습니다.";

/** 내 성적 기준 줄 */
export async function MineBasis({ p }: { p: P }) {
  const m = await p;
  const report = mineReport(m);
  if (!m.ok && "error" in m) return <MineFailed e={m.error} />;
  return <ScoreBasis overall={report?.overall ?? null} emptyText={SCORE_EMPTY} />;
}

export function BasisWait() {
  return (
    <section className="basis" aria-label="내 성적 기준" aria-busy="true">
      <span className="lab">내 성적 기준</span>
      <span className="it"><span className="wait">불러오는 중…</span></span>
    </section>
  );
}

/** 리포트를 받지 못했을 때. 검색 목록은 그대로 두고 이 자리에만 안내한다 */
function MineFailed({ e }: { e: ConnectionError | AccessDenied }) {
  // 검색 목록은 이미 받았으므로 서버는 살아 있다. 일시적인 리포트 읽기 실패는 스스로 다시 연다(1분에 2번까지)
  if (e instanceof ConnectionError) return <ConnectionNotice e={e} reopenUnavailable />;
  return (
    <section className="basis none" aria-label="내 성적 기준">
      <p>
        <b>내 성적 리포트를 열지 못했습니다.</b> {e.status === 401 ? "다시 로그인해 주세요." : "이용권 회원만 내 분석을 볼 수 있습니다."} (문의 번호 {e.code})
      </p>
    </section>
  );
}

export async function MineLegend({ p }: { p: P }) {
  return mineReport(await p) ? <CategoryLegend /> : null;
}

/** '내 성적으로 분석'·'이 범위 다시 확인' */
export async function MineRunBoxes({ p, items, automatic = true }: { p: P; items: OfferingDto[]; automatic?: boolean }) {
  const report = mineReport(await p);
  if (!report) return null;
  const missing = items.filter((o) => !report.analyses?.[o.offering_id]).map((o) => o.offering_id);
  // 곡선·환산 자료가 바뀐 뒤 옛 분석이 그대로 보이지 않게, 서버가 옛 분석이라고 알려 준 곳이 이 범위에 있으면 자동으로 다시 확인한다
  const stale = new Set(report.stale_analysis_ids ?? []);
  const hasStale = items.slice(0, 100).some((o) => stale.has(o.offering_id));
  return (
    <>
      {missing.length > 0 && (
        <RunAnalysis
          ids={missing}
          title={`이 목록의 ${missing.length}개 모집단위는 아직 내 성적으로 분석하지 않았습니다`}
          desc={automatic ? "화면을 열면 지금 보이는 모집단위를 자동으로 분석합니다. 자동으로 시작되지 않으면 버튼을 누르세요. 한 번 분석한 곳은 다시 열어도 그대로 보입니다. 성적을 다시 저장하지 않으며 입력 횟수는 줄지 않습니다." : "버튼을 누르면 지금 보이는 모집단위를 분석합니다. 성적을 다시 저장하지 않으며 입력 횟수는 줄지 않습니다."}
          label="내 성적으로 분석"
          busy="분석하는 중…"
          auto={automatic}
          autoScope={`${report.report_id}:${report.profile_id}`}
        />
      )}
      {items.some((o) => report.analyses?.[o.offering_id]) && (
        <RunAnalysis
          ids={items.slice(0, 100).map((o) => o.offering_id)}
          refresh={{ id: crypto.randomUUID(), reportId: report.report_id, profileId: report.profile_id, reportVersion: report.report_version }}
          title="지금 보이는 모집단위를 다시 확인합니다"
          desc="저장한 성적을 그대로 사용해 이 범위를 최신 자료로 다시 확인합니다. 결과가 바뀔 수 있으며 성적 입력 횟수는 줄지 않습니다."
          label="이 범위 다시 확인"
          busy="다시 확인하는 중…"
          auto={automatic && hasStale}
        />
      )}
    </>
  );
}

/** 한 줄의 내 환산점수·지원가능성·환산 유불리·담기 칸 */
export async function MineCells({ p, id }: { p: P; id: string }) {
  const m = await p;
  const report = mineReport(m);
  if (!m.ok) {
    const t = <span className="need">확인 못 함</span>;
    return <><span className="c-score r">{t}</span><span className="c-st">{t}</span><span className="c-adv r">{t}</span><span className="c-pick" /></>;
  }
  const a = cellOf(m, id);
  return (
    <>
      <span className="c-score r"><ScoreCell a={a} /></span>
      <span className="c-st"><StatusCell a={a} /></span>
      <span className="c-adv r"><AdvantageCell a={a} overall={report?.overall?.overall} /></span>
      <span className="c-pick">{report && <PickButton id={id} on={pickedIds(report).has(id)} />}</span>
    </>
  );
}

export function CellsWait() {
  const t = <span className="need wait">불러오는 중</span>;
  return <><span className="c-score r">{t}</span><span className="c-st">{t}</span><span className="c-adv r">{t}</span><span className="c-pick" /></>;
}

/** 펼친 카드의 환산·누백·판단 카드 */
export async function MineDetail({ p, o }: { p: P; o: OfferingDto }) {
  const m = await p;
  const report = mineReport(m);
  if (!m.ok) return <p className="wait">내 분석을 불러오지 못했습니다. 화면 위쪽 안내를 확인해 주세요.</p>;
  return <Detail o={o} a={cellOf(m, o.offering_id)} extras={null} picked={pickedIds(report).has(o.offering_id)} subjects={report?.overall?.subjects} overall={report?.overall?.overall} examType={report?.overall?.exam?.exam_type ?? null} />;
}

export function DetailWait() {
  return <p className="wait" aria-busy="true">내 분석을 불러오는 중…</p>;
}

/** 핵심 지원 학교 띠. 개수와 이 목록에 있는 이름은 바로, 목록에 없는 곳의 이름만 뒤이어(shortlist-tray-stream.tsx) */
export async function MineTray({ p, items, src, caller }: { p: P; items: OfferingDto[]; src: JungsiSource; caller: Caller }) {
  const report = mineReport(await p);
  if (!report) return null;
  return <StreamTray report={report} known={items} src={src} caller={caller} other="PAGE-04" />;
}
