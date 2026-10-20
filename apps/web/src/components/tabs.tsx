"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import type { Lock } from "@/lib/routes";
import { LockIcon } from "./icons";

/** 탭 줄. 지금 화면에 주황 밑줄. 잠긴 탭도 숨기지 않고 자물쇠만 붙인다(눌러서 안내를 본다) */
export function Tabs({ items }: { items: { href: string; label: string; lock: Lock }[] }) {
  const path = usePathname();
  return (
    <ul>
      {items.map((t) => {
        const on = path === t.href || path.startsWith(`${t.href}/`);
        const why = t.lock === "login" ? "로그인 필요" : t.lock === "paid" ? "이용권 필요" : null;
        return (
          <li key={t.href}>
            {/* 미리 불러오기 끔: 화면 하나를 열 때 탭 4개의 서버 렌더·정시 API 호출과 에듀터치 토큰 갱신이 한꺼번에 몰려
                계정당 동시 한도(429)와 로그인 풀림을 일으켰다(2026-10-18) */}
            <Link prefetch={false} href={t.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} aria-label={why ? `${t.label} (${why})` : undefined}>
              {t.label}
              {t.lock && <LockIcon />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
