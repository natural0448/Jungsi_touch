import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GUIDE_SEEN_COOKIE, GUIDE_TAB, ROOT_REDIRECT } from "@/lib/routes";

/**
 * 루트(/jeongsi). 이용 안내를 본 적 없는 사람은 안내로, 본 사람은 경로 계약의 redirects(지금은 1페이지)로 보낸다(2026-11-25).
 * 판단은 브라우저 쿠키 하나로만 한다(서버·DB 조회 없음).
 */
export default async function Page() {
  const seen = (await cookies()).get(GUIDE_SEEN_COOKIE)?.value === "1";
  redirect(seen ? ROOT_REDIRECT : GUIDE_TAB.path);
}
