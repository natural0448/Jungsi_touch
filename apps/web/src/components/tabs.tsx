"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { PASS_HREF } from "@/lib/links";
import type { Lock } from "@/lib/routes";
import { LockIcon } from "./icons";

/** 휴대폰에서 네 탭이 한 줄에 보이도록 쓰는 짧은 이름(10-24 QA: 넷째 탭이 화면 밖으로 밀려 있는 줄 몰랐다) */
const SHORT: Record<string, string> = {
  "대학 발표 입시결과": "입시결과",
  "내 성적 리포트": "내 리포트",
  "전체 대학·학과 가능성 보기": "가능성 보기",
  "유리한 대학 찾기": "유리한 대학",
};

/**
 * 탭 줄. 지금 화면에 주황 밑줄. 잠긴 탭도 숨기지 않고 자물쇠만 붙인다.
 * 이용권이 필요한 탭은 그 화면을 거치지 않고 바로 에듀터치 이용권 안내로 간다(2026-10-27 사용자 결정)
 */
export function Tabs({ items }: { items: { href: string; label: string; lock: Lock }[] }) {
  const path = usePathname();
  return (
    <ul>
      {items.map((t) => {
        const on = path === t.href || path.startsWith(`${t.href}/`);
        const why = t.lock === "login" ? "로그인 필요" : t.lock === "paid" ? "이용권 필요" : null;
        const body = (
          <>
            <span className="tab-full">{t.label}</span>
            {SHORT[t.label] && <span className="tab-short" aria-hidden="true">{SHORT[t.label]}</span>}
            {t.lock && <LockIcon />}
          </>
        );
        return (
          <li key={t.href}>
            {t.lock === "paid" ? (
              <a href={PASS_HREF} className={on ? "on" : undefined} aria-label={`${t.label} (${why})`}>{body}</a>
            ) : (
              /* 미리 불러오기 끔: 화면 하나를 열 때 탭 4개의 서버 렌더·정시 API 호출과 에듀터치 토큰 갱신이 한꺼번에 몰려
                 계정당 동시 한도(429)와 로그인 풀림을 일으켰다(2026-10-18) */
              <Link prefetch={false} href={t.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} aria-label={why ? `${t.label} (${why})` : undefined}>{body}</Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
