"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProActionState } from "./actions";

/** 같은 성적(profile)으로는 이 탭에서 한 번만 자동으로 찾는다(실패해도 다시 돌지 않게) */
export const autoFindKey = (profileId: string) => `pro-autofind:${profileId}`;

/**
 * 2026-11-24 대표님 결정: ② 유리한 대학 찾기에 결과가 아예 없으면(성적 저장 때 자동 찾기 실패) 화면을 열 때 한 번 알아서 찾는다.
 * 찾는 동안 안내를 보이고, 끝나면 화면을 새로 받아 목록을 그린다. 실패하면 사유와 함께 아래 찾기 버튼이 그대로 남는다
 */
export function AutoFind({ act, fields, children }: { act: (prev: ProActionState, fd: FormData) => Promise<ProActionState>; fields: Record<string, string>; children: React.ReactNode }) {
  const [state, action, pending] = useActionState<ProActionState, FormData>(act, null);
  const [, start] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [skipped, setSkipped] = useState(false);
  const router = useRouter();
  const fired = useRef(false);
  const refreshStarted = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const k = autoFindKey(fields.profile_id ?? "");
    try {
      if (sessionStorage.getItem(k)) {
        setSkipped(true);
        return;
      }
      sessionStorage.setItem(k, "1");
    } catch {
      /* 저장소를 못 쓰면 이번 한 번만 찾는다 */
    }
    const fd = new FormData();
    for (const [n, v] of Object.entries(fields)) fd.set(n, v);
    start(() => action(fd));
  }, [action, fields]);
  useEffect(() => {
    if (!state?.done) return;
    refreshStarted.current = true;
    startRefresh(() => router.refresh());
  }, [state, router]);
  // 찾은 뒤 새로 받은 화면에도 결과가 없으면(드문 경우) 버튼과 안내로 돌아간다
  if (skipped || state?.error || (state?.done && refreshStarted.current && !refreshing)) {
    return (
      <>
        {state?.error && <p className="err" role="alert">{state.error}</p>}
        {children}
      </>
    );
  }
  return (
    <section className="gate flat" aria-live="polite">
      <h2>{state?.done ? "찾았습니다. 목록을 불러오는 중입니다…" : "이 학생에게 유리한 대학을 찾는 중입니다…"}</h2>
      <p>{pending ? "저장한 성적으로 계산합니다. 잠시만 기다려 주세요." : "잠시만 기다려 주세요."}</p>
    </section>
  );
}
