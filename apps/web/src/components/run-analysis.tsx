"use client";

import { useActionState, type FormEvent } from "react";
import { analyzeNow, buildNow, refreshAnalysesNow, refreshCandidatesNow, type RunResult } from "@/app/analysis-actions";
import type { RefreshIntent } from "@/lib/report-ops";

const INITIAL: RunResult = { error: null };

/**
 * 분석·후보 만들기를 회원이 한 번 누를 때만 보낸다(화면을 열 때 자동으로 계산하지 않는다).
 * ids 가 있으면 그 모집행 분석(university.analyze), 없으면 유리한 학교 후보 만들기(candidates.build).
 * refresh는 현재 성적·표시 범위에 결속한 별도 재확인이다. 새 submit만 새 intent를 만들고 전송 재시도는 그 값을 유지한다.
 * 보내는 중에는 다시 누르지 못하고, 서버가 거절하면 이유를 버튼 옆에 보인다.
 */
export function RunAnalysis({ ids, title, desc, label, busy, refresh }: { ids?: string[]; title: string; desc: string; label: string; busy: string; refresh?: RefreshIntent }) {
  const submit = refresh ? (ids ? refreshAnalysesNow : refreshCandidatesNow) : (ids ? analyzeNow : buildNow);
  const [state, action, pending] = useActionState(submit, INITIAL);
  function explicitIntent(e: FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem("refresh_intent");
    if (!pending && input instanceof HTMLInputElement) input.value = crypto.randomUUID();
  }
  return (
    <form action={action} className="run-box" onSubmit={refresh ? explicitIntent : undefined}>
      {ids && <input type="hidden" name="ids" value={ids.join(",")} />}
      {refresh && <>
        <input type="hidden" name="refresh_intent" defaultValue={refresh.id} />
        <input type="hidden" name="report_id" value={refresh.reportId} />
        <input type="hidden" name="profile_id" value={refresh.profileId} />
        <input type="hidden" name="report_version" value={refresh.reportVersion} />
      </>}
      <div>
        <b>{title}</b>
        <p>{desc}</p>
        {state.error && !pending && <p className="err" role="alert">{state.error}</p>}
      </div>
      <button className="btn p" type="submit" disabled={pending}>{pending ? busy : label}</button>
    </form>
  );
}
