import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/*
  Next.js 16 의 proxy(옛 middleware). 쿠키를 쓸 수 있는 경계에서 Supabase 토큰을 갱신하고,
  회원 개인 응답과 갱신 응답이 CDN 에 공유되지 않도록 private, no-store 를 붙인다(DEV-006 authentication).
  사용자 확인·회원 등급은 여기서 판단하지 않는다(우리 서비스 API 가 판단). 합성 모드에서는 토큰을 쓰지 않는다.
*/

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (process.env.JUNGSI_API_MODE === "live" && url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    // 만료가 가까우면 갱신한다. 검증 결과는 쓰지 않는다(신원 검증은 우리 API 의 /auth/v1/user 확인)
    await supabase.auth.getUser();
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)"],
};
