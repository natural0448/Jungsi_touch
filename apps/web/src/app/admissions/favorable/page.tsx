import type { Metadata } from "next";
import { PendingPage } from "@/components/pending-page";
import { page } from "@/lib/routes";

const route = page("PAGE-04");
export const metadata: Metadata = { title: route.label };

export default function Page() {
  return <PendingPage number={route.number} label={route.label} note="유리한 대학 찾기 화면은 다음 단계에서 만듭니다. 3페이지와 같은 핵심 지원 학교 목록을 씁니다." />;
}