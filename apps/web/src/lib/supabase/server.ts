import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/*
  에듀터치와 같은 Supabase 프로젝트의 로그인 쿠키를 읽는다(DEV-006 authentication).
  - URL 과 publishable 키만 쓴다. 운영 DB·내부 엔진·비공개 저장소에는 접근하지 않는다.
  - 이름은 에듀터치 본체(web)와 같은 NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY.
  - 토큰 갱신(쿠키 쓰기)은 proxy.ts 에서 한다. 서버 컴포넌트에서는 쿠키를 쓸 수 없다.
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
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 갱신은 proxy.ts 가 맡는다.
        }
      },
    },
  });
}
