import "server-only";
import { cache } from "react";
import { apiMode } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";

/*
  관리자 계정인데 지금 로그인이 2단계 인증(OTP)을 거치지 않았는지(aal1) — 막힘 안내 문구를 고르는 데만 쓴다.
  2026-11-11 운영: 관리자가 비밀번호만으로 다시 로그인되자(aal1) 서버가 관리자 예외를 주지 않아
  2·3·4페이지가 일반 회원과 같은 '이용권 회원 전용입니다'로 조용히 막혔다. 왜 막혔는지 알 수 있게
  이때만 2단계 인증 안내를 보인다.
  - 권한 판단이 아니다. 유료 화면을 여는 것은 지금처럼 서버(session.read)가 정한다. 이 값은 문구만 바꾼다.
  - 토큰을 직접 풀지 않는다. 에듀터치 로그인 쿠키의 세션으로 Supabase 가 알려 주는 인증 단계(현재·다음)를 읽고,
    본인 profiles(role·status)를 RLS 안에서 읽는다(본인 행만 읽힌다). 쿠키는 쓰지 않는다(read-only 클라이언트).
  - 실패·시간 초과·설정 없음이면 false(지금과 같은 막힘 안내).
*/
export const adminMfaPending = cache(async (): Promise<boolean> => {
  if (apiMode() !== "live") return false;
  try {
    const supabase = await supabaseServer();
    if (!supabase) return false;
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // OTP 를 등록해 두었는데(다음 단계 aal2) 지금 로그인은 비밀번호만 거친 경우만
    if (!aal || aal.currentLevel !== "aal1" || aal.nextLevel !== "aal2") return false;
    const { data: s } = await supabase.auth.getSession();
    const id = s.session?.user.id;
    if (!id) return false;
    const { data } = await supabase
      .from("profiles")
      .select("role,status")
      .eq("id", id)
      .abortSignal(AbortSignal.timeout(2000))
      .maybeSingle();
    return data?.role === "admin" && data?.status === "active";
  } catch {
    return false;
  }
});
