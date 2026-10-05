"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import { runForecast, type ForecastFormState } from "./actions";

const INITIAL: ForecastFormState = { code: null, status: null, message: null, key: null };

/**
 * 관리 작업 폼. 서버 거절은 코드와 함께 폼 아래에 보인다.
 * form action 은 끝나면 입력을 비우므로(React 19) 직접 제출해 거절 뒤에도 입력한 값이 남게 한다.
 */
export function ActionForm({ hidden, submit, tone = "p", children }: { hidden: Record<string, string>; submit: string; tone?: "p" | "plain"; children?: ReactNode }) {
  const [state, action, pending] = useActionState(runForecast, INITIAL);
  return (
    <form
      className="mg-form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    >
      {Object.entries({ ...hidden, ...(state.key ? { key: state.key } : {}) }).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <div className="mg-submit">
        <button className={`btn${tone === "p" ? " p" : ""}`} disabled={pending}>
          {pending ? "보내는 중…" : submit}
        </button>
      </div>
      {state.message && (
        <p className="mg-err" role="alert">
          {state.message} <code>{state.status} {state.code}</code>
        </p>
      )}
    </form>
  );
}
