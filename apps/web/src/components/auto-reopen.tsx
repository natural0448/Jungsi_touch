"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/*
  같은 계정의 요청이 겹쳐 잠시 제한됐을 때(429 rate_limit_exceeded) 안내 화면을 몇 초 뒤 스스로 다시 연다.
  겹침은 보통 몇 초 안에 풀리는데, 서버가 알려 주는 재시도 시각은 '최악의 경우'라 1분쯤 뒤로 나온다.
  2026-11-19 운영 관측: 안내가 뜬 뒤 회원이 직접 새로 고칠 때까지 70초 동안 아무 요청도 가지 않았다.
  - 같은 주소에서 1분 안에 두 번까지만 다시 연다(계속 막힐 때 되풀이하지 않게).
  - 읽기 화면을 다시 여는 것뿐이라 성적 입력·분석 횟수와는 무관하다.
*/
const WAIT_MS = 4000;
const MAX_TRIES = 2;
const WINDOW_MS = 60_000;

export function AutoReopen() {
  const router = useRouter();
  const [state, setState] = useState<"waiting" | "stopped">("waiting");
  useEffect(() => {
    const key = `jt-auto-reopen:${window.location.pathname}${window.location.search}`;
    let tries = 0;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as { n: number; t: number } | null;
      if (saved && typeof saved.n === "number" && typeof saved.t === "number" && Date.now() - saved.t < WINDOW_MS) tries = saved.n;
    } catch {
      /* 저장소를 못 쓰면 한 번만 다시 연다 */
    }
    if (tries >= MAX_TRIES) {
      // 화면이 다시 그려지며 이 효과가 처음 도는 시점이라 한 번만 바꾼다
      const stop = window.setTimeout(() => setState("stopped"), 0);
      return () => window.clearTimeout(stop);
    }
    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(key, JSON.stringify({ n: tries + 1, t: Date.now() }));
      } catch {
        /* 무시 */
      }
      router.refresh();
    }, WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [router]);
  return (
    <p className="conn-code" role="status">
      {state === "waiting" ? "잠시 뒤 이 화면을 자동으로 다시 엽니다." : "자동으로 다시 열어도 풀리지 않았습니다. 잠시 뒤 새로 고쳐 주세요."}
    </p>
  );
}
