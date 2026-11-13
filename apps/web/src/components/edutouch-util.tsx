import { apiMode } from "@/lib/api";
import { edutouch, loginHref } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * 맨 위 이용 메뉴 줄 — 에듀터치 본체 머리글(components/home/main-header.tsx 의 .util)과 같은 항목·순서(2026-10-28 사용자 요청).
 * 이름·역할은 회원 본인 세션으로 profiles 에서 읽는다(본체와 같은 표). 로그아웃은 본체 POST /logout 이 세션 쿠키를 지운다.
 * 정시터치 안에서 지금 화면으로 돌아오는 로그인 주소만 다르다.
 * 이름 옆에 회원 유형과 읽지 않은 알림 종(본체 member_notifications, 본체 마이그레이션 76)을 붙이고 '마이페이지'를 따로 둔다(2026-10-28).
 */
const ROLE_LABEL: Record<string, string> = { student: "학생", parent: "학부모", teacher: "교사·강사", admin: "관리자" };

export async function EdutouchUtil() {
  let me: { name: string; admin: boolean; role: string | undefined; unread: number } | null = null;
  if (apiMode() === "live") {
    const supabase = await supabaseServer();
    const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    if (data.user && supabase) {
      const [{ data: p }, { count, error }] = await Promise.all([
        supabase.from("profiles").select("name, role").eq("id", data.user.id).maybeSingle(),
        // 표를 읽지 못하면 종을 띄우지 않는다
        supabase.from("member_notifications").select("id", { count: "exact", head: true }).eq("user_id", data.user.id).is("read_at", null),
      ]);
      me = { name: (p?.name as string | undefined) || "회원", admin: p?.role === "admin", role: ROLE_LABEL[p?.role as string], unread: error ? 0 : (count ?? 0) };
    }
  }
  return (
    <nav className="jt-top" aria-label="이용 메뉴">
      <div className="wrap">
        <ul>
          {apiMode() === "synthetic" ? (
            // 합성(PC 안 시험) 화면은 에듀터치 로그인과 연결되지 않는다. '로그인'이 보이면 로그아웃된 줄 알기 쉬워(2026-11-13) 시험 화면임을 적는다
            <li className="me"><span className="urole">PC 안 시험 화면 · 에듀터치 로그인과 별개</span></li>
          ) : me ? (
            <>
              <li className="me">
                <a href={edutouch("/mypage")} className="uname">{me.name}님</a>
                {me.role && <span className="urole">{me.role}</span>}
                {me.unread > 0 && (
                  <a href={edutouch("/mypage#alerts")} className="bell" aria-label={`${me.unread}개의 알림이 있습니다`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                    </svg>
                    <b>{me.unread}</b>
                    <span className="hide-sm">{me.unread}개의 알림이 있습니다</span>
                  </a>
                )}
              </li>
              <li><a href={edutouch("/mypage")}>마이페이지</a></li>
              {me.admin && <li><a href={edutouch("/admin")} className="prem">관리자</a></li>}
              <li><a href={edutouch("/mypage#favorites")}>관심대학</a></li>
              <li>
                <form action={edutouch("/logout")} method="post">
                  <button type="submit">로그아웃</button>
                </form>
              </li>
            </>
          ) : (
            <>
              <li><a href={loginHref("/")}>로그인</a></li>
              <li><a href={edutouch("/signup")}>회원가입</a></li>
              <li><a href={edutouch("/login?next=%2Fmypage%23favorites")}>관심대학</a></li>
            </>
          )}
          <li><a href={edutouch("/contact")}>고객센터</a></li>
          <li><a className="prem" href={edutouch("/#prem")}>PREMIUM</a></li>
        </ul>
      </div>
    </nav>
  );
}
