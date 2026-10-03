import type { Metadata } from "next";
import { PendingPage } from "@/components/pending-page";
import { page } from "@/lib/routes";

const route = page("PAGE-01");
export const metadata: Metadata = { title: route.label };

export default function Page() {
  return <PendingPage number={route.number} label={route.label} note="대학 발표 입시결과 화면은 다음 단계에서 만듭니다. 3페이지 검색과 같은 구성을 씁니다." />;
}