import { NextResponse, type NextRequest } from "next/server";
import { runRebuildStart } from "../actions";

/*
  1페이지 정리본 '다시 만들기' 시작(관리자만, 2026-11-16). 준비 단계(step)와 같은 출처·헤더 검사를 한다.
  시작한 뒤 화면이 step 을 끝까지 이어 부른다.
*/

// next.config serverActions.allowedOrigins 와 같은 곳에서 온 요청만 받는다(다른 사이트가 관리자 브라우저로 보내는 요청 차단)
const SAME_SITE = new Set(["edutouch.co.kr", "www.edutouch.co.kr", "edutouch-web.edutouch-web.workers.dev", "jeongsi-touch.edutouch-web.workers.dev", "localhost:3003", "127.0.0.1:3003"]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  let host = "";
  try { host = origin ? new URL(origin).host : ""; } catch { host = ""; }
  if (!SAME_SITE.has(host)) return json({ ok: false, code: "forbidden_origin", retryable: false }, 403);
  // 양식(form) 전송으로는 이 헤더를 붙일 수 없다. 화면의 fetch 만 통과한다
  if (request.headers.get("x-p1-rebuild") !== "1") return json({ ok: false, code: "invalid_request", retryable: false }, 400);
  return json(await runRebuildStart());
}
