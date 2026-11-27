import type { Metadata } from "next";
import { StudentView } from "./student-view";
import "../../../reports/me/report.css";
import "../../pro.css";

export const metadata: Metadata = { title: "학생 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/* 전문가용 학생 탭 ① 성적 입력(2026-11-23 탭 개편). 화면은 student-view.tsx(④ 정시 리포트와 함께 쓴다) */
export default async function Page(props: PageProps<"/pro/students/[studentId]">) {
  return StudentView(props, "");
}
