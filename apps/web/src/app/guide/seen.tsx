"use client";
import { useEffect } from "react";
import { GUIDE_SEEN_COOKIE } from "@/lib/routes";

/** 안내를 한 번 본 표시(1년). 다음부터 정시터치 첫 진입은 바로 하던 화면으로 간다 */
export function MarkGuideSeen() {
  useEffect(() => {
    try {
      document.cookie = `${GUIDE_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax; secure`;
    } catch { /* 쿠키를 막은 브라우저는 매번 안내로 온다 */ }
  }, []);
  return null;
}
