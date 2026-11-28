import { redirect } from "next/navigation";
import { GUIDE_TAB } from "@/lib/routes";

/**
 * 루트(/jeongsi). 2026-11-28 대표님 결정: 에듀터치 메뉴의 '정시터치'를 누르면 늘 이용 안내로 간다
 * (전에는 안내를 한 번 본 사람은 1페이지로 보냈다 — 11-25).
 */
export default async function Page() {
  redirect(GUIDE_TAB.path);
}
