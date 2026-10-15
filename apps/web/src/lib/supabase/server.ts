import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ignoreCookieWrites, noRefreshFetch } from "./read-only";

/*
  에듀터치와 같은 Supabase 프로젝트의 로그인 쿠키를 읽는다(DEV-006 authentication).
  - URL 과 publishable 키만 쓴다. 운영 DB·내부 엔진·비공개 저장소에는 접근하지 않는다.
  - 이름은 에듀터치 본체(web)와 같은 NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY.
  - 쿠키는 읽기만 한다. 토큰 갱신·쿠키 쓰기는 쿠키 주인인 에듀터치 본체가 한다(lib/supabase/read-only.ts).
    서버 액션에서도 쓰지 않는다 — 갱신 실패 때 라이브러리가 세션 쿠키를 지우면 에듀터치 로그인이 풀린다.
*/

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

/** 서버 컴포넌트·서버 액션용. 설정이 없으면 null */
export async function supabaseServer() {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const store = await cookies();
  return createServerClient(cfg.url, cfg.key, {
    cookies: { getAll: () => store.getAll(), setAll: ignoreCookieWrites },
    global: { fetch: noRefreshFetch },
  });
}
