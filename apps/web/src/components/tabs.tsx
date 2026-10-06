"use client";

import Link from "next/link";
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
            <Link href={t.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} aria-label={why ? `${t.label} (${why})` : undefined}>
              {t.label}
              {t.lock && <LockIcon />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
