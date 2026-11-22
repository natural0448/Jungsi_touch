import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "@/components/link";
import { BookLoading } from "@/components/book-loading";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { ProScopeProvider } from "@/components/pro-scope";
import { getCaller, source } from "@/lib/api";
import { pickedIds } from "@/lib/report-pure";
import { proFavorites } from "@/lib/pro-favorites";
import { loadProStudent, proP4, proTabHref } from "@/lib/pro-p4";
import { page } from "@/lib/routes";
import { CatalogBrowse, type ProBrowse } from "../../../../admissions/possibilities/catalog-browse";
import { listKey } from "../../../../admissions/possibilities/query";
import { StudentBar, StudentTabs } from "../student-frame";
import "../../../pro.css";

export const metadata: Metadata = { title: "전체 대학·학과 가능성 보기 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/* 전문가용 ③ — 개인용 4페이지(전체 대학·학과 가능성 보기)와 같은 화면, 자료는 지금 보는 학생 것(2026-11-23) */
export default async function Page({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { studentId } = await params;
  const sp = await searchParams;
  const orgParam = typeof sp.org === "string" ? sp.org : "";
  const route = page("PAGE-03");
  const head = (
    <PageHead
      kicker="전문가용"
      title={route.label}
      desc="보고 싶은 대학과 학과를 직접 검색하고, 모집단위마다 학생의 환산점수 · 지원가능성을 따로 확인하세요."
      side={<Link prefetch={false} className="btn" href={proTabHref(orgParam, studentId, "favorable")}>유리한 대학 추천 다시 보기</Link>}
    />
  );
  const caller = await getCaller();
  const got = await loadProStudent(caller, orgParam, studentId);
  if (got.kind === "connection") return <>{head}<ConnectionNotice e={got.error} /></>;
  if (got.kind !== "ok") return <>{head}<NotFoundNote orgParam={orgParam} /></>;
  const v = got.view;
  const favorites = await proFavorites(v.svc.org_id, v.student.student_id);
  const picked = v.report ? [...pickedIds(v.report)] : [];
  const pickedItems = picked.length ? ((await proP4(caller, v, { offering_ids: picked.slice(0, 30) })).search?.items ?? []) : [];
  const pro: ProBrowse = {
    path: `/pro/students/${encodeURIComponent(v.student.student_id)}/possibilities`,
    params: { org: v.svc.org_id },
    report: v.report,
    favorites,
    search: (q) => proP4(caller, v, { search: Object.fromEntries(Object.entries(q).filter(([, x]) => typeof x === "string" && x !== "")) }),
    byIds: async (ids) => (ids.length ? proP4(caller, v, { offering_ids: ids.slice(0, 30) }) : { bands: {} }),
    picked: pickedItems,
    tray: { other: proTabHref(v.svc.org_id, v.student.student_id, "favorable"), report: proTabHref(v.svc.org_id, v.student.student_id, "report"), reportLabel: "정시 리포트에서 정리" },
  };
  const scope = v.shown ? { org_id: v.svc.org_id, student_id: v.student.student_id, report_id: v.shown.report_id } : null;
  return (
    <>
      <StudentBar student={v.student} orgName={v.org.org_name} />
      <StudentTabs orgId={v.svc.org_id} studentId={v.student.student_id} active="possibilities" />
      {head}
      <ProScopeProvider scope={scope}>
        <Suspense key={listKey(sp)} fallback={<BookLoading name={v.student.display_name} kind="possibilities" />}>
          <CatalogBrowse src={source()} caller={caller} sp={sp} route={route} features={[]} pro={pro} />
        </Suspense>
      </ProScopeProvider>
    </>
  );
}

function NotFoundNote({ orgParam }: { orgParam: string }) {
  return (
    <div className="wrap pg-body">
      <section className="gate flat">
        <h2>학생을 찾을 수 없습니다</h2>
        <p>다른 기관의 학생이거나 담당 학생이 아닙니다. 학생 목록에서 다시 골라 주세요.</p>
        <div className="acts"><Link className="btn" href={`/pro?org=${encodeURIComponent(orgParam)}`}>학생 목록</Link></div>
      </section>
    </div>
  );
}
