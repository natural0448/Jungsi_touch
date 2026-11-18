"use client";

import { useActionState, useEffect, useRef, type FormEvent } from "react";
import { analyzeNow, buildNow, refreshAnalysesNow, refreshCandidatesNow, type RunResult } from "@/app/analysis-actions";
import type { RefreshIntent } from "@/lib/report-ops";

const INITIAL: RunResult = { error: null };

/**
 * 분석·후보 만들기를 회원이 한 번 누를 때만 보낸다(화면을 열 때 자동으로 계산하지 않는다).
 * ids 가 있으면 그 모집행 분석(university.analyze), 없으면 유리한 학교 후보 만들기(candidates.build).
 * refresh는 현재 성적·표시 범위에 결속한 별도 재확인이다. 새 submit만 새 intent를 만들고 전송 재시도는 그 값을 유지한다.
 * 보내는 중에는 다시 누르지 못하고, 서버가 거절하면 이유를 버튼 옆에 보인다.
 */
/**
 * auto: 서버가 '지금 자료판과 다른 판으로 계산된 분석'이라고 알려 준 범위(stale)일 때만 켠다(대표님 결정 2026-11-18).
 * 화면을 열면 같은 재확인을 한 번 자동으로 보낸다. 같은 리포트 판·범위에는 한 번만 보내고, 실패하면 다시 보내지 않고 버튼을 남긴다.
 */
export function RunAnalysis({ ids, title, desc, label, busy, refresh, auto }: { ids?: string[]; title: string; desc: string; label: string; busy: string; refresh?: RefreshIntent; auto?: boolean }) {
  const submit = refresh ? (ids ? refreshAnalysesNow : refreshCandidatesNow) : (ids ? analyzeNow : buildNow);
  const [state, action, pending] = useActionState(submit, INITIAL);
  function explicitIntent(e: FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem("refresh_intent");
    if (!pending && input instanceof HTMLInputElement) input.value = crypto.randomUUID();
  }
  const form = useRef<HTMLFormElement>(null);
  const autoKey = auto && refresh ? `jt-auto-refresh:${refresh.reportId}:${refresh.reportVersion}:${ids ? ids.join(",") : "candidates"}` : null;
  useEffect(() => {
    if (!autoKey) return;
    try {
      if (sessionStorage.getItem(autoKey)) return;
      sessionStorage.setItem(autoKey, "1");
    } catch {
      return; // 한 번만 보냈다는 표시를 남길 수 없으면 자동으로 보내지 않는다(되풀이 방지)
    }
    form.current?.requestSubmit();
  }, [autoKey]);
  return (
    <form ref={form} action={action} className="run-box" onSubmit={refresh ? explicitIntent : undefined}>
      {ids && <input type="hidden" name="ids" value={ids.join(",")} />}
      {refresh && <>
        <input type="hidden" name="refresh_intent" defaultValue={refresh.id} />
        <input type="hidden" name="report_id" value={refresh.reportId} />
        <input type="hidden" name="profile_id" value={refresh.profileId} />
        <input type="hidden" name="report_version" value={refresh.reportVersion} />
      </>}
      <div>
        <b>{auto && pending ? "새 자료로 다시 계산하고 있습니다" : title}</b>
        <p>{auto && pending ? "자료가 바뀌어 저장된 분석을 최신 자료로 다시 계산합니다. 잠시만 기다려 주세요. 성적 입력 횟수는 줄지 않습니다." : desc}</p>
        {state.error && !pending && <p className="err" role="alert">{state.error}</p>}
      </div>
      <button className="btn p" type="submit" disabled={pending}>{pending ? busy : label}</button>
    </form>
  );
}
