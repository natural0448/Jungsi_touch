"use client";

import { useEffect, useState } from "react";

/*
  예상하지 못한 오류 화면(app/error.tsx·app/global-error.tsx)에서 스스로 다시 시도한다(2026-11-25 대표님 요청:
  오류 화면이 고객에게 보이지 않게). 대부분 서버가 잠깐 실패한 순간이라 몇 초 뒤 다시 그리면 열린다.
  - 같은 주소에서 1분 안에 두 번까지만(계속 실패할 때 되풀이하지 않게). 그 뒤에는 '다시 시도' 버튼만 남긴다.
  - 화면을 다시 그리는 것뿐이라 성적 입력·분석 횟수와는 무관하다.
*/
const WAIT_MS = 2500;
const MAX_TRIES = 2;
const WINDOW_MS = 60_000;

/** 'retrying': 곧 다시 시도함, 'stopped': 자동 재시도를 다 써서 버튼만 남김 */
export function useAutoRetry(retry: () => void): "retrying" | "stopped" {
  const [state, setState] = useState<"retrying" | "stopped">("retrying");
  useEffect(() => {
    const key = `jt-auto-retry:${window.location.pathname}${window.location.search}`;
    let tries = 0;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as { n: number; t: number } | null;
      if (saved && typeof saved.n === "number" && typeof saved.t === "number" && Date.now() - saved.t < WINDOW_MS) tries = saved.n;
    } catch {
      /* 저장소를 못 쓰면 한 번만 */
    }
    if (tries >= MAX_TRIES) {
      const stop = window.setTimeout(() => setState("stopped"), 0);
      return () => window.clearTimeout(stop);
    }
    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(key, JSON.stringify({ n: tries + 1, t: Date.now() }));
      } catch {
        /* 무시 */
      }
      retry();
    }, WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [retry]);
  return state;
}
