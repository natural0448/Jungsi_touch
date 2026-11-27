"use client";

import { useActionState, useEffect, useRef, type FormEvent } from "react";
import { analyzeNow, buildNow, refreshAnalysesNow, refreshCandidatesNow, type RunResult } from "@/app/analysis-actions";
import { enqueue } from "@/lib/client-queue";
import type { RefreshIntent } from "@/lib/report-ops";

const INITIAL: RunResult = { error: null };
const AUTO_SUBMIT_DELAY_MS = 250;

function navigationKey() {
  const url = new URL(window.location.href);
  url.searchParams.delete("open"); // Opening a card does not select a new result set.
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams}`;
}

/**
 * 분석·후보 만들기를 회원이 한 번 누를 때만 보낸다(화면을 열 때 자동으로 계산하지 않는다).
 * ids 가 있으면 그 모집행 분석(university.analyze), 없으면 유리한 학교 후보 만들기(candidates.build).
 * refresh는 현재 성적·표시 범위에 결속한 별도 재확인이다. 새 submit만 새 intent를 만들고 전송 재시도는 그 값을 유지한다.
 * 보내는 중에는 다시 누르지 못하고, 서버가 거절하면 이유를 버튼 옆에 보인다.
 */
/**
 * auto: 서버가 '지금 자료판과 다른 판으로 계산된 분석'이라고 알려 준 범위(stale)일 때만 켠다(대표님 결정 2026-11-18).
 * 화면을 열면 같은 재확인을 한 번 자동으로 보낸다. 같은 리포트 판·범위에는 한 번만 보내고, 실패하면 다시 보내지 않고 버튼을 남긴다.
 * autoScope: 재확인이 아닌 첫 분석도 자동으로 보낼 때 쓰는 범위 이름(리포트 번호). 4페이지에서 보이는 모집단위를 버튼 없이 분석한다
 * (대표님 결정 2026-11-19, 전 모집단위 요약 미리 계산이 들어가기 전까지의 임시 방식). 같은 리포트·같은 모집단위 묶음에는 한 번만 보낸다.
 */
export function RunAnalysis({ ids, title, desc, label, busy, refresh, auto, autoScope }: { ids?: string[]; title: string; desc: string; label: string; busy: string; refresh?: RefreshIntent; auto?: boolean; autoScope?: string }) {
  const submit = refresh ? (ids ? refreshAnalysesNow : refreshCandidatesNow) : (ids ? analyzeNow : buildNow);
  // 담기·다른 분석과 겹치지 않게 한 줄로 세워 보낸다(같은 계정 요청 겹침 방지, 2026-11-21)
  const [state, action, pending] = useActionState((prev: RunResult, fd: FormData) => enqueue(() => submit(prev, fd)), INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const attemptedFor = useRef<string | null>(null);
  const autoKey = !auto
    ? null
    : refresh
      ? `jt-auto-refresh:${refresh.reportId}:${refresh.reportVersion}:${ids ? ids.join(",") : "candidates"}`
      : autoScope && ids
        ? `jt-auto-analyze:${autoScope}:${ids.join(",")}`
        : null;
  const first = !refresh;
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    attemptedFor.current = autoKey;
    if (!refresh || pending) return;
    const input = e.currentTarget.elements.namedItem("refresh_intent");
    if (input instanceof HTMLInputElement) input.value = crypto.randomUUID();
  }
  useEffect(() => {
    if (!autoKey || pending) return;
    const key: string = autoKey;
    const initialNavigation = navigationKey();
    let timer: number | undefined;
    function cancel() {
      window.clearTimeout(timer);
    }
    function schedule() {
      cancel();
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        const current = form.current;
        if (document.visibilityState !== "visible" || navigationKey() !== initialNavigation ||
            !current?.isConnected || attemptedFor.current === autoKey) return;
        try {
          if (sessionStorage.getItem(key)) return;
          sessionStorage.setItem(key, "1");
        } catch {
          return; // Prevent automatic repetition when tab storage is unavailable.
        }
        current.requestSubmit();
      }, AUTO_SUBMIT_DELAY_MS);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("pagehide", cancel);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("pagehide", cancel);
    };
  }, [autoKey, pending]);
  return (
    <form ref={form} action={action} className="run-box" onSubmit={onSubmit}>
      {ids && <input type="hidden" name="ids" value={ids.join(",")} />}
      {refresh && <>
        <input type="hidden" name="refresh_intent" defaultValue={refresh.id} />
        <input type="hidden" name="report_id" value={refresh.reportId} />
        <input type="hidden" name="profile_id" value={refresh.profileId} />
        <input type="hidden" name="report_version" value={refresh.reportVersion} />
      </>}
      <div>
        <b>{auto && pending ? (first ? "내 성적으로 계산하고 있습니다" : "새 자료로 다시 계산하고 있습니다") : title}</b>
        <p>{auto && pending ? (first ? "지금 보이는 모집단위를 내 성적으로 계산합니다. 잠시만 기다려 주세요. 성적 입력 횟수는 줄지 않습니다." : "자료가 바뀌어 저장된 분석을 최신 자료로 다시 계산합니다. 잠시만 기다려 주세요. 성적 입력 횟수는 줄지 않습니다.") : desc}</p>
        {state.error && !pending && <p className="err" role="alert">{state.error}</p>}
      </div>
      <button className="btn p" type="submit" disabled={pending}>{pending ? busy : label}</button>
    </form>
  );
}
