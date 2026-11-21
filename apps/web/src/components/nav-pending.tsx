"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BOOK_SUB, BookLoading } from "@/components/book-loading";
import { LoadingNotice } from "@/components/loading-notice";
import { ROOT_REDIRECT } from "@/lib/routes";

/*
  누르는 순간 화면이 바뀌게(2026-11-10 사용자 요청: 전체 화면이 자연스럽고 부드럽게 열리기를).
  정시터치 링크는 미리 받기가 꺼져 있다(10-20 결정, 예산). 그래서 누른 뒤 서버의 첫 응답(약 1.4초, 한국→화면 서버)이
  올 때까지 앞 화면이 그대로 멈춰 있었다. 브라우저에서 누른 것을 바로 알아채 아래처럼 보인다.
  - 다른 화면으로 갈 때: 그 화면의 불러오는 중 안내(각 loading.tsx 와 같은 글)를 바로 보인다.
    서버 응답이 와서 주소가 바뀌면 진짜 화면(먼저 그 화면의 loading.tsx)으로 넘어간다.
  - 같은 화면 안에서 검색·쪽·펼치기를 바꿀 때: 지금 내용을 그대로 두고 맨 위에 얇은 진행 줄만 보인다
    (3페이지 '목록 먼저'를 가리지 않는다).
  서버에 요청을 더 보내지 않는다(미리 받기 아님). 결과·숫자를 지어내지 않고 자리만 잡는다.
*/

const BASE = "/jeongsi";
// 모든 대기 표시는 책 넘김 애니메이션 하나로 그린다(2026-11-21 대표님 지적). 3·4페이지는 그 화면의 분석 문구를 그대로 쓴다
type Notice = { title: string; desc?: string } | { kind: "favorable" | "possibilities" };
// 각 화면 loading.tsx 와 같은 글. 바꿀 때 함께 바꾼다
const NOTICES: [string, Notice][] = [
  ["/admissions/results", { title: "대학 발표 입시결과를 불러오고 있습니다", desc: "대학이 발표한 지난 3개 학년도 결과를 한 번에 확인하는 중입니다." }],
  ["/admissions/possibilities", { kind: "possibilities" }],
  ["/admissions/favorable", { kind: "favorable" }],
  ["/reports/me", { title: "내 성적 리포트를 불러오고 있습니다", desc: "저장한 성적과 과목별 결과를 확인하는 중입니다." }],
];
const DEFAULT_NOTICE: Notice = { title: "화면을 불러오고 있습니다", desc: BOOK_SUB };
// 같은 화면 안이라도 검색·다음 쪽·필터처럼 목록이 새로 계산되는 이동은 책 넘김으로 가린다(?open= 만 바뀌는 펼치기는 제외)
const RECOMPUTE = ["/admissions/possibilities", "/admissions/favorable"];

/** open 을 뺀 검색 조건(정렬). 같으면 목록은 그대로이고 펼친 줄만 바뀐다 */
function listKey(search: string): string {
  const q = new URLSearchParams(search);
  q.delete("open");
  q.sort();
  return q.toString();
}
const GIVE_UP_MS = 20_000; // 주소가 끝내 바뀌지 않으면(같은 주소로 다시 그림 등) 안내를 거둔다

function noticeFor(path: string): Notice {
  const p = path.startsWith(BASE) ? path.slice(BASE.length) || "/" : path;
  return NOTICES.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`))?.[1] ?? DEFAULT_NOTICE;
}

type Pending = ({ kind: "page"; notice: Notice } | { kind: "same" }) & { from: string };
/** 이동할 주소가 정시터치 안의 다른 주소면 그 주소, 아니면 null */
function target(url: URL): URL | null {
  if (url.origin !== location.origin) return null;
  if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return null;
  // 루트는 서버가 1페이지로 돌려보낸다. 1페이지에서 루트를 누르면 주소가 그대로라 안내가 20초 남았다(11-11 운영 재현)
  if (url.pathname === BASE || url.pathname === `${BASE}/`) url = new URL(BASE + ROOT_REDIRECT + url.search, url);
  if (url.pathname === location.pathname && url.search === location.search) return null; // 같은 주소·#만 바뀜
  return url;
}

export function NavPending() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState<Pending | null>(null);
  // 지금 그려진 화면의 주소. 안내는 누를 때의 주소(from)에서 바뀌면 저절로 거둔다(서버 응답이 와서 화면이 넘어감)
  const current = (pathname === "/" ? BASE : BASE + pathname) + (search ? `?${search}` : "");
  const shown = useRef(current);
  useEffect(() => {
    shown.current = current;
  }, [current]);
  const visible = pending && pending.from === current ? pending : null;

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    const start = (to: URL) => {
      const from = shown.current;
      const same = to.pathname === location.pathname;
      const p = to.pathname.startsWith(BASE) ? to.pathname.slice(BASE.length) : to.pathname;
      const recompute = same && RECOMPUTE.includes(p) && listKey(to.search) !== listKey(location.search);
      setPending(same && !recompute ? { kind: "same", from } : { kind: "page", notice: noticeFor(to.pathname), from });
    };
    const onClick = (e: MouseEvent) => {
      // 링크(next/link)가 자기 처리에서 기본 동작을 막으므로, 그보다 먼저(capture) 본다
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
      const to = target(new URL(a.href, location.href));
      if (to) start(to);
    };
    // next/form(GET)의 화면 안 검색. 서버 액션(POST) 폼은 건드리지 않는다
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || (form.method && form.method.toLowerCase() !== "get")) return;
      const action = form.getAttribute("action");
      if (!action || action.startsWith("javascript:")) return;
      const url = new URL(action, location.href);
      const q = new URLSearchParams();
      for (const [k, v] of new FormData(form, e.submitter)) if (typeof v === "string" && v !== "") q.append(k, v);
      url.search = q.toString() ? `?${q}` : "";
      const to = target(url);
      if (to) start(to);
    };
    // 뒤로·앞으로 가기도 서버 응답을 기다린다
    const onPop = () => {
      if (location.pathname + location.search !== shown.current) setPending({ kind: "same", from: shown.current }); // #만 바뀐 것은 제외
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // 다른 화면으로 갈 때는 앞 화면 내용을 가리고 안내를 보인다(머리글·메뉴는 그대로)
  useEffect(() => {
    const main = document.querySelector(".et.jt > main");
    if (!main) return;
    if (visible?.kind === "page") main.setAttribute("data-nav-pending", "");
    else main.removeAttribute("data-nav-pending");
  }, [visible]);

  if (!visible) return null;
  return (
    <>
      <div className="jt-navbar" role="progressbar" aria-label="화면을 불러오는 중" />
      {visible.kind === "page" && (
        <div className="jt-nav-pending">
          {"kind" in visible.notice ? (
            <BookLoading name="회원" kind={visible.notice.kind} />
          ) : (
            <LoadingNotice title={visible.notice.title} desc={visible.notice.desc} />
          )}
        </div>
      )}
    </>
  );
}
