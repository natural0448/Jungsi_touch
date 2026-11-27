"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProActionState } from "./actions";

/** 숨은 칸 + 버튼 하나로 서버 동작을 부르는 작은 양식(유리한 대학 찾기·담기). 실패 사유는 버튼 옆에 */
export function ActionButton({ act, fields, label, busy, primary }: { act: (prev: ProActionState, fd: FormData) => Promise<ProActionState>; fields: Record<string, string>; label: string; busy: string; primary?: boolean }) {
  const [state, action, pending] = useActionState<ProActionState, FormData>(act, null);
  const router = useRouter();
  const [, refresh] = useTransition();
  // 담기·빼기는 성공하면 바로 '담음'·'뺌'으로 보이고, 담은 학교 칸은 뒤에서 화면을 새로 받아 바꾼다(2026-11-23)
  useEffect(() => {
    if (state?.done) refresh(() => router.refresh());
  }, [state, router]);
  return (
    <form action={action} className="pro-act">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={primary ? "btn p" : "btn"} type="submit" disabled={pending || !!state?.done}>{pending ? busy : state?.done ?? label}</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
    </form>
  );
}
