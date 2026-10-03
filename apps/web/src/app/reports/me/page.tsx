import type { Metadata } from "next";
import { PendingPage } from "@/components/pending-page";
import { page } from "@/lib/routes";

const route = page("PAGE-02");
export const metadata: Metadata = { title: route.label };

export default function Page() {
  return <PendingPage number={route.number} label={route.label} note="내 성적 리포트 화면은 다음 단계에서 만듭니다. 성적 입력과 전체 성적 위치(overall.analyze)를 연결합니다." />;
}