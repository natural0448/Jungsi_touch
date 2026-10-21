"use client";

import { useActionState } from "react";
import type { ProActionState } from "./actions";

/** 숨은 칸 + 버튼 하나로 서버 동작을 부르는 작은 양식(유리한 대학 찾기·담기). 실패 사유는 버튼 옆에 */
export function ActionButton({ act, fields, label, busy, primary }: { act: (prev: ProActionState, fd: FormData) => Promise<ProActionState>; fields: Record<string, string>; label: string; busy: string; primary?: boolean }) {
  const [state, action, pending] = useActionState<ProActionState, FormData>(act, null);
  return (
    <form action={action} className="pro-act">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={primary ? "btn p" : "btn"} type="submit" disabled={pending}>{pending ? busy : label}</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
    </form>
  );
}
