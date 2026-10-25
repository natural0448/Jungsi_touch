"use client";

import { useActionState } from "react";
import { togglePick, type PickResult } from "@/app/shortlist-actions";

const INITIAL: PickResult = { error: null };

/** 담기·빼기 버튼. 서버가 바꾸지 못했으면 버튼 옆에 이유를 보인다. 보내는 중에는 다시 누르지 못한다 */
export function PickButton({ id, on, variant = "pill" }: { id: string; on: boolean; variant?: "pill" | "wide" | "wild" }) {
  const [state, action, pending] = useActionState(togglePick, INITIAL);
  return (
    <form action={action} className={variant === "wild" ? "pick-wild" : undefined}>
      <input type="hidden" name="offering_id" value={id} />
      <input type="hidden" name="selected" value={on ? "0" : "1"} />
      {variant === "pill" ? (
        <button className={`pick${on ? " on" : ""}`} aria-pressed={on} disabled={pending}>
          {on ? "담음" : "담기"}
        </button>
      ) : variant === "wide" ? (
        <button className={`btn${on ? "" : " t"}`} disabled={pending}>{on ? "핵심 지원 학교에서 빼기" : "핵심 지원 학교에 담기"}</button>
      ) : (
        <button className={on ? "on" : undefined} aria-pressed={on} disabled={pending}>
          {on ? "핵심 지원 학교에 담음" : "핵심 지원 학교에 담기"}
        </button>
      )}
      {state.error && !pending && (
        <span className="pick-err" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
