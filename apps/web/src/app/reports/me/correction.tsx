import type { CorrectionRow } from "@/lib/correction";
import { lastCorrectionDay, provisionalClosed } from "@/lib/csat-release";
import type { ScoreInputStatusDto } from "@/lib/dto";
import { seoulDate } from "@/lib/format";
import { SUPPORT_HREF } from "@/lib/links";
import { CorrectionForm } from "./correction-form";

export const STAGE_LABEL: Record<string, string> = { mock: "9월 모의평가", provisional: "수능 가채점", final: "수능 실채점" };

/**
 * 2페이지 성적 정정 영역(?correct=1). 내 마지막 요청 상태와, 요청할 수 있으면 양식을 보인다.
 * 승인되면 서버 입력권 상태에 '승인된 정정'이 생겨 기존 입력 양식이 열리므로 여기서는 안내만 한다.
 */
export function CorrectionPanel({ st, latest, can, releaseOn = null, savedScores }: { st: ScoreInputStatusDto; latest: CorrectionRow | null; can: boolean; releaseOn?: string | null; savedScores: string }) {
  const stage = STAGE_LABEL[st.stage] ?? st.stage;
  // 가채점 정정은 수능 성적표 배부일 전날까지(본체 관리자 설정). 날짜가 없으면 입력 기간 끝을 안내한다
  const provisional = st.stage === "provisional";
  const closedByRelease = provisional && provisionalClosed(releaseOn);
  const until = provisional ? (releaseOn ? lastCorrectionDay(releaseOn) : st.closes_at ? seoulDate(st.closes_at) : null) : null;
  return (
    <section className="rp-sec" aria-labelledby="corr-h">
      <h2 id="corr-h">{stage} 성적 정정 요청</h2>
      {latest?.status === "pending" && (
        <p className="rp-note">
          {seoulDate(latest.created_at)}에 보낸 정정 요청을 확인하고 있습니다. 승인되면 이 화면에서 성적을 한 번 더 입력할 수 있습니다.
        </p>
      )}
      {latest?.status === "approved" && (
        <p className="rp-note">
          정정 요청이 승인되었습니다{latest.handled_at ? `(${seoulDate(latest.handled_at)})` : ""}.
          {st.correction_granted <= st.correction_used
            ? " 정정 입력을 이미 사용했습니다."
            : closedByRelease
              ? " 수능 성적표가 배부되어 가채점 정정 입력 기간이 끝났습니다. 실채점 성적은 실채점 단계에서 입력해 주세요."
              : " '내 성적 리포트'로 돌아가 바른 성적을 다시 입력해 주세요."}
          {/* 가채점 정정은 성적표 배부 전까지만(2026-10-28 사용자 결정) */}
          {provisional && !closedByRelease && st.correction_granted > st.correction_used && until && ` 가채점 정정은 성적표 배부 전, ${until}까지 저장해야 합니다.`}
        </p>
      )}
      {latest?.status === "returned" && (
        <p className="rp-err">
          지난 요청이 반려되었습니다{latest.admin_note ? `: ${latest.admin_note}` : "."} 성적표 사진을 확인해 다시 요청해 주세요.
        </p>
      )}
      {can ? (
        <>
          {provisional && releaseOn && until && <p className="rp-note">가채점 정정은 수능 성적표 배부 전, {until}까지 요청하고 다시 입력해야 합니다.</p>}
          <CorrectionForm stageLabel={stage} savedScores={savedScores} />
        </>
      ) : (
        closedByRelease ? (
          <p className="rp-note">수능 성적표가 배부되어 가채점 정정은 더 요청할 수 없습니다. 실채점 성적은 실채점 단계에서 입력해 주세요.</p>
        ) : !latest && (
          <p className="rp-note">
            지금은 정정을 요청할 수 없습니다. 정정은 이 단계의 성적을 한 번 저장한 뒤 한 번만 요청할 수 있습니다. 궁금한 점은 <a href={SUPPORT_HREF}>고객센터</a>로 알려 주세요.
          </p>
        )
      )}
    </section>
  );
}
