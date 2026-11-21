"use client";

import { useActionState, useOptimistic } from "react";
import { toggleFavorite, type FavoriteResult } from "@/app/favorite-actions";

const INITIAL: FavoriteResult = { error: null };

/** 즐겨찾기 별표. 누르면 바로 채워 보이고, 서버가 바꾸지 못하면 되돌아가며 이유를 보인다 */
export function StarButton({ id, on, name }: { id: string; on: boolean; name: string }) {
  const [state, action, pending] = useActionState(toggleFavorite, INITIAL);
  const [shown, setShown] = useOptimistic(on);
  return (
    <form
      className="star-f"
      action={(fd) => {
        setShown(!on);
        return action(fd);
      }}
    >
      <input type="hidden" name="offering_id" value={id} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <button className={`star${shown ? " on" : ""}`} aria-pressed={shown} aria-label={`${name} ${shown ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}`} title={shown ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"} disabled={pending}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z" />
        </svg>
      </button>
      {state.error && !pending && (
        <span className="pick-err" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
