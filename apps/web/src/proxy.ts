import { createServerClient } from "@supabase/ssr";
import { CRAWL_ROBOTS } from "@/lib/crawl-policy";
import { NextResponse, type NextRequest } from "next/server";
import { ignoreCookieWrites, noRefreshFetch } from "@/lib/supabase/read-only";

/*
  Next.js 16 의 proxy(옛 middleware). 회원 개인 응답이 CDN 에 공유되지 않도록 private, no-store 를 붙인다
  (DEV-006 authentication). Supabase 토큰 갱신은 쿠키 주인인 에듀터치 본체가 넘기기 전에 한다.
  사용자 확인·회원 등급은 여기서 판단하지 않는다(우리 서비스 API 가 판단). 합성 모드에서는 토큰을 쓰지 않는다.

  예외: JEONGSI_ACCESS_GATE=preview(오픈 전 배포판)이면 화면 전체를 에듀터치 관리자와
  JEONGSI_PREVIEW_EMAILS 명단에만 연다. 전문가용(/pro 아래)은 유효 계약 기관의 구성원에게도 연다(jeongsi_pro_access). 에듀터치 본체 프록시가 /jeongsi 를 넘길 때 같은 도메인의
  로그인 쿠키가 따라오므로, 워커 주소로 직접 온 요청은 로그인이 없어 막힌다(2026-10-13 사용자 결정).
  설정이 빠지면 막는 쪽으로 동작한다. 오픈 때 이 관문을 지우고 회원·이용권 확인은 서비스 API 에 맡긴다.
*/

const BLOCKED_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="${CRAWL_ROBOTS}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>정시터치 준비 중</title></head>
<body style="font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f5;color:#222">
<main style="text-align:center;padding:24px"><h1 style="font-size:20px">정시터치는 준비 중입니다</h1>
<p style="color:#666">오픈 전에는 허용된 계정만 이용할 수 있습니다.</p>
<p><a href="https://edutouch.co.kr" style="color:#2457c5">에듀터치로 가기</a></p></main></body></html>`;

function blocked() {
  return new NextResponse(BLOCKED_HTML, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": CRAWL_ROBOTS },
  });
}

async function previewAllowed(request: NextRequest, url?: string, key?: string) {
  if (!url || !key) return false;
  // 세션 쿠키의 주인은 에듀터치 본체다 — 여기서는 읽기만 하고 갱신 쿠키를 쓰지 않는다
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: ignoreCookieWrites },
    global: { fetch: noRefreshFetch },
  });
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return false;
  const listed = (process.env.JEONGSI_PREVIEW_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (user.email && listed.includes(user.email.toLowerCase())) return true;
  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin" && profile?.status === "active") return true;
  // 전문가용(/pro)만: 유효 계약 기관의 구성원이면 연다(2026-10-21 에듀터치 재회신 — 본체 proxy 와 같은 함수 하나로 판정).
  // 줄이 하나라도 있으면 활성 구성원이다. 실패·빈 배열은 막는다. 개인용 경로는 그대로 닫힘
  if (isProPath(request)) {
    const { data, error } = await supabase.rpc("jeongsi_pro_access");
    return !error && Array.isArray(data) && data.length > 0;
  }
  return false;
}

/** basePath(/jeongsi) 뒤의 /pro 와 그 아래. nextUrl.pathname 은 basePath 를 뺀 값이지만 붙은 경우도 같은 뜻으로 본다 */
function isProPath(request: NextRequest) {
  const p = request.nextUrl.pathname.replace(/^\/jeongsi(?=\/|$)/, "") || "/";
  return p === "/pro" || p.startsWith("/pro/");
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (process.env.JEONGSI_ACCESS_GATE === "preview") {
    try {
      if (!(await previewAllowed(request, url, key))) return blocked();
    } catch {
      return blocked();
    }
  }

  // 토큰 갱신은 에듀터치 본체 proxy 가 넘기기 전에 한다. 여기서 갱신하면 쿠키가 지워질 수 있다(lib/supabase/read-only.ts)
  const response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", CRAWL_ROBOTS);
  return response;
}

export const config = {
  // 루트("/")는 아래 패턴만으로는 잡히지 않아 관문이 빠지므로 따로 적는다
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)"],
};
