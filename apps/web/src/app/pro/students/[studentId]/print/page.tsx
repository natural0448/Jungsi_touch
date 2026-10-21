import type { Metadata } from "next";
import Link from "@/components/link";
import { validId } from "@/lib/api/pro-source";
import { proAccess } from "@/lib/pro-access";
import { PrintSheet } from "./print-sheet";
import "../../../../reports/me/report.css";
import "../../../pro.css";

export const metadata: Metadata = { title: "상담 리포트 인쇄 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  전문가용 상담 리포트 인쇄·PDF(계약 pro.report). 들어오는 권한은 에듀터치 활성 구성원, 학생·판 권한은 서비스가
  인쇄본 만들기(pro.report.export) 때 다시 확인한다(다른 기관·담당 아닌 학생은 404). 인쇄 시 머리글·탭은 숨긴다.
*/
export default async function Page({ params, searchParams }: PageProps<"/pro/students/[studentId]/print">) {
  const { studentId } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const orgId = one(sp.org), reportId = one(sp.report), rev = one(sp.rev);
  const orgs = await proAccess();
  const ok = orgs?.some((o) => String(o.org_id) === orgId) && validId(studentId) && validId(reportId) && /^[1-9]\d{0,5}$/.test(rev);
  const back = `/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`;
  if (!ok)
    return (
      <div className="wrap pg-body">
        <section className="gate flat">
          <h2>인쇄할 리포트를 찾을 수 없습니다</h2>
          <div className="acts"><Link className="btn" href={back}>학생 화면으로</Link></div>
        </section>
      </div>
    );
  return (
    <div className="wrap pg-body pr pro">
      <div className="pr-tools"><Link className="btn" href={back}>돌아가기</Link></div>
      <PrintSheet fields={{ org_id: orgId, student_id: studentId, report_id: reportId, revision_id: rev, idem: crypto.randomUUID() }} />
    </div>
  );
}
