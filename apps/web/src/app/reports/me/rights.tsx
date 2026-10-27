import type { ScoreInputStatusDto } from "@/lib/dto";
import { seoulDate, seoulDateTime } from "@/lib/format";
import { SUPPORT_HREF } from "@/lib/links";

/*
  2페이지 입력권 표시(기획 1.9.95, 담당자 연결계약 v3 §10).
  숫자는 score-input-status 응답 그대로 쓰고 추정하지 않는다. 가상 학생 견본은 2026-10-27 사용자 결정으로 뺐다.
*/

/** 입력 가능 여부: 열린 단계이고(서버 판단) 남은 저장 횟수가 있거나 미리보기 예외일 때 */
export function canInput(st: ScoreInputStatusDto | null): boolean {
  if (!st || !st.paid_input_allowed || st.stage_state !== "open") return false;
  return st.input_limit_mode === "preview_exempt" || (st.effective_save_remaining ?? 0) > 0;
}

/** 이 시험 단계의 입력권 상태 한 줄 */
export function InputStatus({ st }: { st: ScoreInputStatusDto }) {
  const window =
    st.stage_state === "not_open"
      ? `입력은 ${st.opens_at ? seoulDateTime(st.opens_at) : "공식 개방"}부터 열립니다.`
      : st.stage_state === "closed"
        ? `이 단계의 입력 기간이 ${st.closes_at ? seoulDate(st.closes_at) : ""} 끝났습니다.`
        : null;
  return (
    <div className="rp-rights">
      <b>{st.academic_year}학년도 성적 입력</b>
      {st.input_limit_mode === "preview_exempt" ? (
        <span>미리보기 계정 — 입력 횟수를 세지 않습니다</span>
      ) : (
        <span>
          최초 입력 남음 <b className="num">{st.initial_remaining}</b>회 · 정정 요청 가능 <b className="num">{st.correction_request_remaining}</b>회
          {st.correction_granted > st.correction_used && <> · 승인된 정정 남음 <b className="num">{st.correction_granted - st.correction_used}</b>회</>}
        </span>
      )}
      {window && <span className="warn">{window}</span>}
    </div>
  );
}

/** 입력할 수 없는 유료 회원 안내(이미 1회 사용 등). 정정은 이 화면의 정정 요청(성적표 사진, 2026-10-28) */
export function NoInput({ st, correctHref }: { st: ScoreInputStatusDto | null; correctHref?: string | null }) {
  return (
    <section className="rp-empty">
      {st === null ? (
        <p>지금은 성적 입력 상태를 확인할 수 없어 저장을 열지 않았습니다. 잠시 뒤 다시 열어 주세요. 입력 횟수는 쓰이지 않았습니다.</p>
      ) : st.stage_state !== "open" ? (
        <p>이 시험 단계는 지금 성적을 입력할 수 있는 기간이 아닙니다.</p>
      ) : (
        <p>
          이 시험 단계의 성적 입력을 이미 사용했습니다. 저장한 리포트는 계속 볼 수 있습니다.{" "}
          {correctHref ? (
            <>성적표와 다르게 저장했다면 성적표 사진과 함께 <a href={correctHref}>정정을 요청</a>해 주세요(이 단계에서 한 번).</>
          ) : (
            <>궁금한 점은 <a href={SUPPORT_HREF}>고객센터</a>로 알려 주세요.</>
          )}
        </p>
      )}
    </section>
  );
}
