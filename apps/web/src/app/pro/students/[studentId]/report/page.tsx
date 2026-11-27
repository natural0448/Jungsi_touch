import type { Metadata } from "next";
import { StudentView } from "../student-view";
import "../../../../reports/me/report.css";
import "../../../pro.css";

export const metadata: Metadata = { title: "정시 리포트 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/* 전문가용 ④ 정시 리포트 — 성적 요약·조합별 합산·위치 그래프·담은 학교(상담 팁)·인쇄(2026-11-23 대표님 결정) */
export default async function Page(props: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return StudentView(props, "report");
}
