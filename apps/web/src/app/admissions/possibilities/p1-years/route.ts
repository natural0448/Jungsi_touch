import { NextResponse, type NextRequest } from "next/server";
import { p1Years } from "@/lib/p1-years";

/*
  3페이지 연도별 근거의 1페이지 성적 칸(2026-11-17 대표님 요청: 펼침이 늦음).
  서버 액션은 화면 안에서 한 줄로 차례를 기다려, 모집 정보·발행 기준 조회(loadExtras)가 끝날 때까지 이 칸도 기다렸다.
  fetch 는 따로 가므로 화면 서버에 저장된 1페이지 준비본만 읽어 먼저 채운다. 서비스 API는 부르지 않는다.
  1페이지와 같은 공개 자료다. 저장본이 없으면 null — 화면은 loadExtras 의 결과(기존 확인 경로)를 쓴다.
*/
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams, offering = q.get("offering") ?? "", university = q.get("university") ?? "";
  const ok = /^2027:[0-9]{1,12}$/.test(offering) && university.length > 0 && university.length <= 100;
  const p1 = ok ? await p1Years(offering, university) : null;
  return NextResponse.json({ p1 }, { headers: { "Cache-Control": "private, max-age=60", "X-Robots-Tag": "noindex, nofollow" } });
}
