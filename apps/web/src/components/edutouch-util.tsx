import { apiMode } from "@/lib/api";
import { edutouch, loginHref } from "@/lib/links";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * 맨 위 이용 메뉴 줄 — 에듀터치 본체 머리글(components/home/main-header.tsx 의 .util)과 같은 항목·순서(2026-10-28 사용자 요청).
 * 이름·역할은 회원 본인 세션으로 profiles 에서 읽는다(본체와 같은 표). 로그아웃은 본체 POST /logout 이 세션 쿠키를 지운다.
 * 정시터치 안에서 지금 화면으로 돌아오는 로그인 주소만 다르다.
 */
export async function EdutouchUtil() {
  let me: { name: string; admin: boolean } | null = null;
  if (apiMode() === "live") {
    const supabase = await supabaseServer();
    const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    if (data.user && supabase) {
      const { data: p } = await supabase.from("profiles").select("name, role").eq("id", data.user.id).maybeSingle();
      me = { name: (p?.name as string | undefined) || "회원", admin: p?.role === "admin" };
    }
  }
  return (
    <nav className="jt-top" aria-label="이용 메뉴">
      <div className="wrap">
        <ul>
          {me ? (
            <>
              <li><a href={edutouch("/mypage")} className="uname">{me.name}님</a></li>
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
