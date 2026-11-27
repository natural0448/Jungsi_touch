import { ConnectionNotice } from "@/components/connection-notice";
import { RunAnalysis } from "@/components/run-analysis";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";
import type { ReportDto } from "@/lib/dto";
import { logSettleError, pickedIds, settleAnalyses } from "@/lib/report-ops";
import { readPicks } from "@/lib/shortlist";
import { PickedTable } from "./report-view";

/* 2페이지에서 옮김(2026-11-23 리포트 탭): 9월 모의평가 리포트의 담은 학교 표 */
/**
 * 담은 학교 표. 이름은 offering.read 로 받는다. 받지 못하면 이 자리에만 연결 안내를 보인다(위 리포트는 그대로).
 * 3·4페이지와 같은 판정을 보이려고(대표님 요청 2026-11-21) 그리기 전에 settleAnalyses 를 거친다 — 분석이 없는 곳은 계산하고,
 * 옛 자료판으로 계산된 분석(stale_analysis_ids)은 같은 성적으로 다시 확인한다. 서버는 옛 분석에는 참고 기준 7단계(reference_band)를
 * 붙이지 않으므로, 이것을 거치지 않으면 3·4페이지에서 '안정'인 학과가 여기서는 '판정 근거 부족'으로 남았다.
 * 이미 지금 자료판으로 분석된 곳은 다시 계산하지 않는다(같은 요청 키 → 서버가 중복 실행하지 않음). 실패해도 받은 리포트로 그린다
 */
export async function Picked({ src, caller, report, pending = false }: { src: JungsiSource; caller: Caller; report: ReportDto; pending?: boolean }) {
  const ids = [...pickedIds(report)];
  let current = report;
  if (!pending) {
    try {
      current = await settleAnalyses(src, caller, report, ids);
    } catch (e) {
      logSettleError("report-picked", e);
    }
  }
  let items;
  let failed: ConnectionError | AccessDenied | null = null;
  try {
    items = await readPicks(src, caller, current);
  } catch (e) {
    if (!(e instanceof ConnectionError || e instanceof AccessDenied)) throw e;
    failed = e;
  }
  if (failed instanceof ConnectionError) return <ConnectionNotice e={failed} />;
  if (failed || !items) return <p className="rp-note">담은 학교를 열 권한을 확인하지 못했습니다. 다시 로그인해 주세요.{failed ? ` (문의 번호 ${failed.code})` : ""}</p>;
  if (pending) return <PickedTable items={items} pending />;
  // 자동 계산이 끝내 닿지 않은 곳(연결 실패·한도)만 버튼으로 남긴다
  const unanalyzed = ids.filter((id) => !current.analyses?.[id]);
  return (
    <>
      {unanalyzed.length > 0 && (
        <RunAnalysis
          ids={unanalyzed}
          title={`담은 학교 ${unanalyzed.length}곳을 지금 성적으로 분석할 수 있습니다`}
          desc="누르면 이 리포트의 성적으로 그 학교만 분석합니다. 성적을 다시 저장하지 않으며 입력 횟수는 줄지 않습니다."
          label="지금 성적으로 분석"
          busy="분석하는 중…"
        />
      )}
      <PickedTable items={items} overall={current.overall?.overall} report={current} />
    </>
  );
}

