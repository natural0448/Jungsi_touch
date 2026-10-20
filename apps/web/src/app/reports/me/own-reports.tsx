"use client";

import { useActionState } from "react";
import { seoulDateTime } from "@/lib/format";
import { pickReport, type PickState } from "./actions";

/**
 * 내 리포트 목록(report.list-own). 다른 기기에서 저장한 리포트를 이 브라우저에서 열 때 쓴다.
 * 고르면 서버가 본인 리포트인지 다시 확인한 뒤 HttpOnly 쿠키에 담는다 — 성적 저장·분석은 하지 않는다
 */
export function OwnReports({ items, currentId, hasMore }: { items: { report_id: string; report_version: number; updated_at: string }[]; currentId: string | null; hasMore: boolean }) {
  const [state, action, pending] = useActionState<PickState, FormData>(pickReport, null);
  return (
    <section className="rp-own" aria-labelledby="own-h">
      <h2 id="own-h">내 리포트</h2>
      <p className="rp-foot">이 계정으로 저장한 리포트입니다. 다른 기기에서 저장했어도 여기서 골라 열 수 있습니다. 여는 것만으로 입력 횟수는 쓰이지 않습니다.</p>
      <ul>
        {items.map((it) => (
          <li key={it.report_id}>
            <span>
              리포트 {it.report_version}번째 판 · <span className="num">{seoulDateTime(it.updated_at)}</span> 저장
            </span>
            {it.report_id === currentId ? (
              <span className="cur">지금 보는 리포트</span>
            ) : (
              <form action={action}>
                <input type="hidden" name="report_id" value={it.report_id} />
                <button className="btn" type="submit" disabled={pending}>이 리포트 열기</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {hasMore && <p className="rp-foot">최근 리포트 {items.length}개만 보여 드립니다.</p>}
      {state?.error && <p className="err" role="alert">{state.error}</p>}
    </section>
  );
}
