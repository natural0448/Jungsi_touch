"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * 잠깐 기다리면 풀리는 상태(예: 1페이지 현재판 확인 중)에서 화면을 스스로 다시 불러온다.
 * 정해진 횟수만 시도하고 멈춘다(끝없이 서버를 부르지 않는다). 그 뒤에는 안내 문구대로 이용자가 다시 연다.
 */
export function AutoRefresh({ seconds = 3, tries = 5 }: { seconds?: number; tries?: number }) {
  const router = useRouter();
  const done = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (done.current >= tries) return clearInterval(id);
      done.current += 1;
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds, tries]);
  return null;
}
