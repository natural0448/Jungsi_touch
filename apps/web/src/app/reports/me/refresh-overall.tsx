"use client";

import { useActionState } from "react";
import { refreshOverall, type RefreshState } from "./actions";

/**
 * 저장된 리포트의 전체 위치를 지금 연결된 자료로 다시 계산한다(성적은 다시 저장하지 않는다).
 * report.read 는 저장 스냅샷이라 자료가 연결돼도 예전 '자료 연결 대기'가 그대로 남는다 —
 * 명시적으로 한 번 누를 때만 overall.analyze 를 부른다(페이지 진입마다 자동 요청하지 않음).
 * 요청 키(idem)는 이 화면을 그릴 때 새로 만든 값이라, 두 번 눌러도 한 번만 계산된다.
 */
export function RefreshOverall({ idem }: { idem: string }) {
  const [state, action, pending] = useActionState<RefreshState, FormData>(refreshOverall, null);
  return (
    <form action={action} className="rp-refresh">
      <input type="hidden" name="idem" value={idem} />
      <div>
        <b>전체 위치를 다시 계산할 수 있습니다</b>
        <p>저장해 둔 성적 그대로 계산합니다. 성적을 다시 저장하지 않으며 입력권·정정권은 줄지 않습니다. 리포트는 새 판으로 쌓이고 이전 판도 남습니다.</p>
        {state?.error && <p className="err" role="alert">{state.error}</p>}
      </div>
      <button className="btn p" type="submit" disabled={pending}>{pending ? "계산하는 중…" : "전체 위치 다시 계산"}</button>
    </form>
  );
}
