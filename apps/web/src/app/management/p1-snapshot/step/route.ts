import { NextResponse, type NextRequest } from "next/server";
import { runWarmStep } from "../actions";

/*
  1페이지 정리본 준비 한 단계(관리자만). 준비 버튼(runner.tsx)이 fetch 로 부른다(2026-11-07).
  서버 액션은 화면 안에서 한 줄로 차례를 기다려, 응답이 오지 않는 요청 하나가 다음 단계와 '멈추기'까지 막았다
  (seq21 재-warm 234/245 에서 8분 넘게 멈춤, 새로 고쳐야 이어졌다). fetch 는 화면이 기한을 두고 끊은 뒤 다시 보낼 수 있다.
  하는 일은 서버 액션 runWarmStep 과 같다: 관리자 확인 → 짧은 임대(lease)를 잡은 쪽만 한 단계 진행. 끊긴 요청이 서버에서
  늦게 끝나도 임대가 같은 판을 한 작업만 진행하게 하고, 다시 보낸 요청은 진행 상태만 받는다.
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
  if (request.headers.get("x-p1-warm") !== "1") return json({ ok: false, code: "invalid_request", retryable: false }, 400);
  return json(await runWarmStep());
}
