import Link from "@/components/link";
import type { Session } from "@/lib/dto";
import { untilDate } from "@/lib/format";
import { PASS_HREF, edutouch, loginHref } from "@/lib/links";
import { PAGES, ROOT_REDIRECT, lockFor } from "@/lib/routes";
import { Tabs, UserChip } from "./tabs";

/**
 * 정시터치 머리글. 에듀터치 로고와 색·글꼴로 같은 사이트임을 알리고, 화면 넷을 탭으로 둔다.
 * 잠금 표시는 서버가 알려 준 회원 등급(session.read)으로만 그린다.
 */
export function SiteHeader({ session, down = false }: { session: Session | null; down?: boolean }) {
  const tabs = PAGES.map((p) => ({ href: p.path, label: p.label, lock: lockFor(session, p) }));
  return (
    <header>
      <div className="jt-util">
        <div className="wrap">
          <a className="logo" href={edutouch("/")} aria-label="에듀터치 첫 화면">
            {/* 에듀터치 본체의 공개 로고를 그대로 쓴다(10-26 로고 확정, 본체 요청서). 로고가 바뀌면 함께 바뀐다 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://edutouch.co.kr/brand/logo-horizontal.png" alt="EduTouch 에듀터치" width={550} height={108} />
          </a>
          <span className="jt-sep" aria-hidden="true" />
          {/* 루트(/)는 서버가 1페이지로 돌려보낸다. 바로 1페이지로 걸어 한 번 더 오가지 않게 한다(11-11) */}
          <Link prefetch={false} href={ROOT_REDIRECT} className="jt-name">
            정시<em>터치</em>
          </Link>
          <div className="jt-user">
            <UserChip>
            {down ? (
              <span className="pass off">연결 대기</span>
            ) : !session ? (
              <a className="btn p" href={loginHref("/")}>로그인</a>
            ) : session.member_tier === "paid" ? (
              // 유료인데 만료일이 없으면 서버가 관리자 이용권 예외로 연 것이다(FE-ADMIN-ACCESS-01).
              // 실제 이용권이 있는 관리자는 서버가 그 만료일을 보내므로 날짜가 그대로 나온다
              session.entitlement_expires_at ? (
                // 좁은 휴대폰(≤400px)에서는 날짜를 줄여 머리글이 옆으로 밀리지 않게 한다(jungsi.css)
                <span className="pass">이용권<span className="pass-until"> {untilDate(session.entitlement_expires_at)}까지</span></span>
              ) : (
                <span className="pass">관리자 이용</span>
              )
            ) : (
              <>
                <span className="pass off">일반 회원</span>
                <a className="btn t" href={PASS_HREF}>이용권 보기</a>
              </>
            )}
            </UserChip>
          </div>
        </div>
      </div>
      <nav className="jt-tabs" aria-label="정시터치 화면">
        <div className="wrap">
          <Tabs items={tabs} />
        </div>
      </nav>
    </header>
  );
}
