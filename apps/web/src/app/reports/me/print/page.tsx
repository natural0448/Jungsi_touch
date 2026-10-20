import { ConnectionNotice } from "@/components/connection-notice";
import { examTypeLabel } from "@/lib/exam";
import { MemberMark } from "@/components/member-mark";
import { PASS_HREF } from "@/lib/links";
import type { Metadata } from "next";
import Link from "@/components/link";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import type { SnapshotDto } from "@/lib/dto";
import { seoulDate } from "@/lib/format";
import { getReportId } from "@/lib/report-ref";
import { pickedItems, type PickedItem } from "@/lib/report-ops";
import { page } from "@/lib/routes";
import { ComboChart, OverallCard, PickedTable, PositionChart, SubjectsSheet } from "../report-view";
import { PrintButton } from "./print-button";
import "../report.css";

export const metadata: Metadata = { title: "상담 리포트" };

/**
 * 상담 리포트 인쇄용 화면 — report.export(유료·본인·확인 성적)의 고정 revision 을 그대로 그린다.
 * 인쇄 시 머리글·탭·띠는 숨긴다(styles/jungsi.css @media print).
 */
export default async function Page() {
  const back = page("PAGE-02").path;
  const caller = await getCaller();
  const src = source();
  const reportId = await getReportId();
  let snap: SnapshotDto | null = null;
  let shortlist: PickedItem[] = [];
  try {
    snap = reportId ? await src.exportReport(caller, reportId) : null;
    // 고정된 revision 의 shortlist·analyses 를 그대로 쓴다. 이름만 offering.read 로 붙인다
    if (snap) shortlist = await pickedItems(src, caller, snap.report);
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} />;
    if (!(e instanceof AccessDenied)) throw e;
    return (
      <div className="wrap pg-body">
        <section className="gate">
          <h2>상담 리포트 인쇄는 이용권 회원 전용입니다</h2>
          <p>전체 성적 위치는 내 성적 리포트에서 그대로 볼 수 있습니다.</p>
          <div className="acts"><a className="btn t" href={PASS_HREF}>이용권 보기</a><Link className="btn" href={back}>내 성적 리포트로</Link></div>
        </section>
      </div>
    );
  }
  if (!snap) {
    return (
      <div className="wrap pg-body">
        <section className="gate">
          <h2>인쇄할 리포트가 없습니다</h2>
          <p>먼저 성적을 넣어 리포트를 만들어 주세요.</p>
          <div className="acts"><Link className="btn p" href={back}>성적 입력하기</Link></div>
        </section>
      </div>
    );
  }
  const a = snap.report.overall;

  return (
    <div className="wrap pg-body pr">
      {/* 상담 리포트 인쇄본: 회원 식별 표시(인쇄·PDF 에도 찍힘) + 조회 기록 */}
      <MemberMark kind="report" path="/jeongsi/reports/me/print" />
      <div className="pr-tools">
        <Link className="btn" href={back}>돌아가기</Link>
        <PrintButton />
      </div>
      <article className="pr-sheet">
        <header className="pr-hd">
          <div>
            <p className="pr-brand">에듀터치 정시터치 · 상담 리포트</p>
            <h1>{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)} 기준</h1>
          </div>
          <dl>
            <div><dt>리포트 판</dt><dd className="num">{snap.snapshot_version}</dd></div>
            <div><dt>발행</dt><dd className="num">{seoulDate(snap.generated_at)}</dd></div>
          </dl>
        </header>

        <OverallCard a={a} />
        <h2>과목별 결과</h2>
        <SubjectsSheet a={a} />
        <PositionChart a={a} />
        <ComboChart a={a} />

        <h2>핵심 지원 학교 <span className="num">{shortlist.length}</span></h2>
        {shortlist.length === 0 ? (
          <p className="rp-foot">담은 학교가 없습니다.</p>
        ) : (
          <PickedTable items={shortlist} print />
        )}
        <footer className="pr-foot">
          지원가능성은 합격 확률이 아닙니다. 대학마다 만점과 반영 방식이 달라 다른 대학의 환산점수와 크기를 비교할 수 없습니다. 모의지원 서비스에서 모집군·지원 조건·모집인원 변경을 다시 확인하세요.
        </footer>
      </article>
    </div>
  );
}
