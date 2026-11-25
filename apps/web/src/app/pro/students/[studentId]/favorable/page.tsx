import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "@/components/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { ProScopeProvider } from "@/components/pro-scope";
import { ProvisionalPendingGate } from "@/components/provisional-pending";
import { ScoreBasis } from "@/components/score-basis";
import { StreamTray } from "@/components/shortlist-tray-stream";
import { getCaller, source } from "@/lib/api";
import { proCsatEnabled } from "@/lib/exam";
import { csatView } from "@/lib/provisional-view";
import { provisionalOnly } from "@/lib/report-pure";
import { proFavorites } from "@/lib/pro-favorites";
import { loadProStudent, proTabHref } from "@/lib/pro-p4";
import { page } from "@/lib/routes";
import { CsatGroups } from "../../../../admissions/favorable/csat-groups";
import { CsatCandidates } from "../../../../admissions/favorable/csat-candidates";
import { autoFindCandidates, findCandidates } from "../../../actions";
import { ActionButton } from "../../../action-button";
import { AutoFind } from "../../../auto-find";
import { StudentBar, StudentTabs } from "../student-frame";
import "../../../../admissions/favorable/favorable.css";
import "../../../pro.css";

export const metadata: Metadata = { title: "유리한 대학 찾기 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  전문가용 ② — 개인용 3페이지(유리한 대학 찾기)의 수능 가채점 화면과 같은 목록(대학 → 계열 → 학과, 안정~상향, 별표).
  자료는 학생 리포트의 유리한 대학 찾기 결과(pro.candidates, 성적 저장 때 자동 1회). 담기는 ③에서 한다(개인용과 같다).
*/
export default async function Page({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { studentId } = await params;
  const sp = await searchParams;
  const orgParam = typeof sp.org === "string" ? sp.org : "";
  const route = page("PAGE-04"), p3 = page("PAGE-03");
  const head = (
    <PageHead
      kicker="전문가용"
      title={route.label}
      desc="전체 성적에서 출발해 환산에 유리한 학교를 찾고, 학교 안에서 학과마다 지원 범위를 따로 확인하세요."
      side={<Link prefetch={false} className="btn" href={proTabHref(orgParam, studentId, "possibilities")}>전국 대학·학과 보기</Link>}
    />
  );
  const caller = await getCaller();
  const got = await loadProStudent(caller, orgParam, studentId);
  if (got.kind === "connection") return <>{head}<ConnectionNotice e={got.error} /></>;
  if (got.kind !== "ok") return <>{head}<div className="wrap pg-body"><section className="gate flat"><h2>학생을 찾을 수 없습니다</h2><p>학생 목록에서 다시 골라 주세요.</p><div className="acts"><Link className="btn" href={`/pro?org=${encodeURIComponent(orgParam)}`}>학생 목록</Link></div></section></div></>;
  const v = got.view;
  const frame = (
    <>
      <StudentBar student={v.student} orgName={v.org.org_name} />
      <StudentTabs orgId={v.svc.org_id} studentId={v.student.student_id} active="favorable" />
      {head}
    </>
  );
  const report = v.report;
  if (!report || !v.shown) {
    return (
      <>
        {frame}
        <div className="wrap pg-body fv">
          <ScoreBasis overall={null} emptyText="유리한 대학 찾기는 저장한 성적으로 계산합니다." />
          <section className="gate flat">
            <h2>성적을 넣으면 유리한 학교를 찾아 드립니다</h2>
            <p>① 성적 입력에서 이 학생의 성적을 먼저 저장해 주세요. 성적 없이 대학·학과를 둘러보려면 {p3.label}에서 검색하세요.</p>
            <div className="acts">
              <Link className="btn p" href={proTabHref(v.svc.org_id, v.student.student_id, "")}>성적 입력하기</Link>
            </div>
          </section>
        </div>
      </>
    );
  }
  const csat = provisionalOnly(report) ? csatView(report.candidates, true) : { universities: [], outsideBand: 0, judged: 0 };
  const favs = (await proFavorites(v.svc.org_id, v.student.student_id))?.ids ?? null;
  const known = csat.universities.flatMap((u) => u.fields.flatMap((f) => f.items.map((x) => x.offering)));
  const scope = { org_id: v.svc.org_id, student_id: v.student.student_id, report_id: v.shown.report_id };
  const tray = { other: proTabHref(v.svc.org_id, v.student.student_id, "possibilities"), report: proTabHref(v.svc.org_id, v.student.student_id, "report"), reportLabel: "정시 리포트에서 정리" };
  return (
    <>
      {frame}
      <ProScopeProvider scope={scope}>
        <div className="wrap pg-body fv">
          <ScoreBasis overall={report.overall} emptyText="" />
          {csat.universities.length > 0 ? (
            <section className="fv-main fv-refmode" aria-label="유리한 대학">
              <CsatCandidates pointBased c={report.candidates} favs={favs} p3Label={p3.label} allHref={(st) => proTabHref(orgParam, studentId, "possibilities", `st=${st}`)} />
              <CsatGroups pointBased universities={csat.universities} favs={favs} outsideBand={csat.outsideBand} p3Label={p3.label} />
            </section>
          ) : (
            <>
              {/* 성적 저장 때 자동으로 한 번 찾는다. 결과가 없을 때만 찾기 버튼(담당 교사) */}
              {/* 2026-11-24: 대학 찾기 결과(판정 요약)가 아예 없으면(저장 때 찾기 실패 — 전체 위치 판은 빈 후보 칸만 가진다) 열 때 한 번 자동으로 찾는다 */}
              {v.canEdit && provisionalOnly(report) && proCsatEnabled() && !report.candidates?.reference_threshold_summary ? (
                <AutoFind act={autoFindCandidates} fields={{ org_id: v.svc.org_id, student_id: v.student.student_id, profile_id: v.shown.profile_id, profile_version: v.shown.profile_id, idem: crypto.randomUUID() }}>
                  <div className="pro-sechd">
                    <ActionButton act={findCandidates} primary label="이 학생에게 유리한 대학 찾기" busy="찾는 중…" fields={{ org_id: v.svc.org_id, student_id: v.student.student_id, profile_id: v.shown.profile_id, profile_version: v.shown.profile_id, idem: crypto.randomUUID() }} />
                  </div>
                  <ProvisionalPendingGate catalogHref={proTabHref(v.svc.org_id, v.student.student_id, "possibilities")} />
                </AutoFind>
              ) : (
                <>
                  {v.canEdit && provisionalOnly(report) && proCsatEnabled() && (
                    <div className="pro-sechd">
                      <ActionButton act={findCandidates} primary label="이 학생에게 유리한 대학 찾기" busy="찾는 중…" fields={{ org_id: v.svc.org_id, student_id: v.student.student_id, profile_id: v.shown.profile_id, profile_version: v.shown.profile_id, idem: crypto.randomUUID() }} />
                    </div>
                  )}
                  <ProvisionalPendingGate catalogHref={proTabHref(v.svc.org_id, v.student.student_id, "possibilities")} />
                </>
              )}
            </>
          )}
        </div>
        <Suspense fallback={null}>
          <StreamTray report={report} known={known} src={source()} caller={caller} other="PAGE-03" links={tray} />
        </Suspense>
      </ProScopeProvider>
    </>
  );
}
