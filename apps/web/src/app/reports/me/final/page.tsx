import { ConnectionNotice } from "@/components/connection-notice";
import { MemberMark } from "@/components/member-mark";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "@/components/link";
import { PageHead } from "@/components/page-head";
import { PaidGate } from "@/components/paid-gate";
import { BookLoading } from "@/components/book-loading";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source, type Caller, type JungsiSource } from "@/lib/api";
import type { ReportDto } from "@/lib/dto";
import { EXAM, examTypeLabel } from "@/lib/exam";
import { seoulDateTime } from "@/lib/format";
import { isInaccurate } from "@/lib/score-validity";
import { readPicks } from "@/lib/shortlist";
import { PICK_GROUP_LIMIT, PICK_TOTAL_LIMIT } from "@/lib/picked-view";
import { pickedIds, provisionalBands, withSchoolDisplay } from "@/lib/report-ops";
import { csatJudged, provisionalOnly } from "@/lib/report-pure";
import { REPORT_TAB, lockFor, page } from "@/lib/routes";
import { ComboScores, OverallCard, PositionChart, ProvisionalComboScores, ProvisionalOverallCard, ProvisionalPositionChart, ProvisionalSubjectsSheet, SubjectsSheet } from "../report-view";
import { CsatPickedDetails, CsatPickedTable } from "../csat-picked";
import { Picked } from "../picked-section";
import "@/app/admissions/possibilities/possibilities.css";
import "../report.css";

/*
  5번째 탭 '리포트'(2026-11-23 대표님 결정). 2번째 탭은 '성적 입력'(성적 넣기·과목별 결과)으로 두고,
  담은 학교·성적 요약·리포트 출력은 여기에 모은다. 권한·리포트는 2페이지와 같다(계정의 현재 리포트, 유료 회원).
*/
export const metadata: Metadata = { title: REPORT_TAB.label };
const p2 = page("PAGE-02");

export default async function Page() {
  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  const head = <PageHead kicker="PAGE 5" title={REPORT_TAB.label} desc="담아 둔 학교와 내 성적을 한 장으로 정리하고, 상담용 리포트로 출력합니다." />;
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  if (lockFor(session, p2) === "login" || !session) {
    return (
      <>
        {head}
        <div className="wrap pg-body rp"><div className="rp-empty"><p>로그인하면 담은 학교와 성적을 한 장으로 볼 수 있습니다.</p><div className="acts"><Link className="btn p" href={p2.path}>{p2.label}</Link></div></div></div>
      </>
    );
  }
  if (session.member_tier !== "paid") return <>{head}<PaidGate kind="paid" route={p2} features={["담은 학교의 판정·환산점수·대학 안 위치·유불리를 한 장으로", "상담용 리포트 출력"]} /></>;

  let report: ReportDto | null = null;
  try {
    const status = await src.readScoreInputStatus(caller, EXAM.exam_id);
    const id = isInaccurate(status) ? null : status.current_report_id;
    report = id ? await src.readReport(caller, id) : null;
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (!(e instanceof AccessDenied)) throw e;
    report = null;
  }
  if (!report || !report.overall) {
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <div className="rp-empty">
            <p>아직 정리할 리포트가 없습니다. 먼저 성적을 넣어 주세요.</p>
            <div className="acts"><Link className="btn p" href={p2.path}>{p2.label}</Link></div>
          </div>
        </div>
      </>
    );
  }
  const a = report.overall;
  const provisional = provisionalOnly(report);
  // 담은 학교 표는 가채점·실채점 모두 학교별 수능 판정 표
  const judgedCsat = csatJudged(report);
  const picked = [...pickedIds(report)];
  return (
    <>
      {head}
      <MemberMark kind="report" path={REPORT_TAB.path} />
      <div className="wrap pg-body rp">
        <div className="rp-meta">
          <span>{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)} 기준</span>
          <span>{seoulDateTime(report.updated_at)} 저장</span>
          <Link className="btn" href={p2.path}>성적 보기·고치기</Link>
          <Link className="btn p" href={`${p2.path}/print`}>리포트 출력</Link>
        </div>

        <section aria-labelledby="fn-sl" className="rp-sec">
          <div className="rp-sechd">
            <h2 id="fn-sl">담은 학교 <span className="num">{picked.length}/{PICK_TOTAL_LIMIT}</span></h2>
          </div>
          {picked.length === 0 ? (
            <div className="rp-empty">
              <p>아직 담은 학교가 없습니다. 아래 화면에서 모집단위를 담으면 여기에 모입니다. 가·나·다군마다 {PICK_GROUP_LIMIT}곳, 모두 {PICK_TOTAL_LIMIT}곳까지 담을 수 있습니다.</p>
              <div className="acts">
                <Link className="btn" href={page("PAGE-04").path}>{page("PAGE-04").label}</Link>
                <Link className="btn" href={page("PAGE-03").path}>{page("PAGE-03").label}</Link>
              </div>
            </div>
          ) : (
            <Suspense fallback={<BookLoading compact text="담은 학교의 판정을 모으고 있습니다." />}>
              {judgedCsat ? <CsatPicked src={src} caller={caller} report={report} /> : <Picked src={src} caller={caller} report={report} />}
            </Suspense>
          )}
        </section>

        <section aria-labelledby="fn-sc" className="rp-sec">
          <h2 id="fn-sc">내 성적</h2>
          {provisional ? (
            <>
              <ProvisionalOverallCard a={a} single />
              <ProvisionalSubjectsSheet a={a} single />
              <ProvisionalComboScores a={a} single />
              <ProvisionalPositionChart a={a} single />
            </>
          ) : (
            <>
              <OverallCard a={a} />
              <SubjectsSheet a={a} />
              <ComboScores a={a} />
              <PositionChart a={a} />
            </>
          )}
        </section>
        <p className="rp-foot">모의지원 서비스에서 각 모집단위의 모집군·지원 조건·모집인원 변경을 다시 확인하세요. 정시터치는 외부 서비스에 성적을 보내거나 자동으로 등록하지 않습니다.</p>
      </div>
    </>
  );
}

/** 담은 학교: 이름(offering.read)과 가채점 판정(4페이지와 같은 university.analyze)을 받아 군별 표로 */
async function CsatPicked({ src, caller, report }: { src: JungsiSource; caller: Caller; report: ReportDto }) {
  let items;
  try {
    items = await readPicks(src, caller, report);
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} />;
    if (!(e instanceof AccessDenied)) throw e;
    return <p className="rp-note">담은 학교를 열 권한을 확인하지 못했습니다. 다시 로그인해 주세요. (문의 번호 {e.code})</p>;
  }
  const { bands, min, display } = await provisionalBands(src, caller, report, items.map((it) => it.offering_id)).catch(() => ({ bands: {}, min: {}, display: {} }));
  // 서버가 7단계를 내지 않은 모집단위의 환산점수·사유(담당자 v3, 2026-11-24)
  const a = withSchoolDisplay(report.overall, display)!;
  return (
    <>
      <CsatPickedTable single items={items} bands={bands} a={a} min={min} />
      <CsatPickedDetails single items={items} bands={bands} a={a} min={min} />
    </>
  );
}
