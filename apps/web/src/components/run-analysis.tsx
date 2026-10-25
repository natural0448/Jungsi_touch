"use client";

import { useActionState } from "react";
import { analyzeNow, buildNow, type RunResult } from "@/app/analysis-actions";

const INITIAL: RunResult = { error: null };

/**
 * 분석·후보 만들기를 회원이 한 번 누를 때만 보낸다(화면을 열 때 자동으로 계산하지 않는다).
 * ids 가 있으면 그 모집행 분석(university.analyze), 없으면 유리한 학교 후보 만들기(candidates.build).
 * 보내는 중에는 다시 누르지 못하고, 서버가 거절하면 이유를 버튼 옆에 보인다.
 */
export function RunAnalysis({ ids, title, desc, label, busy }: { ids?: string[]; title: string; desc: string; label: string; busy: string }) {
  const [state, action, pending] = useActionState(ids ? analyzeNow : buildNow, INITIAL);
  return (
    <form action={action} className="run-box">
      {ids && <input type="hidden" name="ids" value={ids.join(",")} />}
      <div>
        <b>{title}</b>
        <p>{desc}</p>
        {state.error && !pending && <p className="err" role="alert">{state.error}</p>}
      </div>
      <button className="btn p" type="submit" disabled={pending}>{pending ? busy : label}</button>
    </form>
  );
}
