import { Suspense } from "react";
import Link from "@/components/link";
import { BookLoading } from "@/components/book-loading";
import { ConnectionNotice } from "@/components/connection-notice";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";
import { isProvisionalOverall, type OwnReportListDto, type ReportDto } from "@/lib/dto";
import { CSAT_EXAM, MOCK_EXAM, examTypeLabel } from "@/lib/exam";
import { seoulDateTime } from "@/lib/format";
import { readPicks } from "@/lib/shortlist";
import { hasMockReports } from "@/lib/past-mock";
import { ComboScores, OverallCard, PickedTable, PositionChart, ProvisionalComboScores, ProvisionalOverallCard, ProvisionalPositionChart, ProvisionalSubjectsSheet, SubjectsSheet } from "./report-view";

/*
  지난 기록(2026-11-23 수능 가채점 전환 뒤, 대표님 결정: 9월 모의평가 기록은 남긴다).
  회원이 저장한 9월 모의평가 리포트 목록(report.list-own, exam_id=9월)과 상세(report.read)를 읽기 전용으로 보인다.
  - 새 입력·정정·분석 버튼은 두지 않는다(서버도 9월 단계를 닫아 새 입력·정정은 409로 거절한다).
  - 상세는 목록에 있는 리포트만 연다(소유권은 서버가 report.read 로 다시 확인한다).
*/

const PAGE = "/reports/me";
/*
  2026-11-25 실채점 전환 준비: 지난 기록은 두 가지다. mock = 9월 모의평가(?past=1), csat = 수능 가채점(?past=csat, 실채점 전환 뒤).
  담당자 실행 안내: 가채점 시험판은 기존 리포트의 지난 기록에 둔다(읽기 전용).
*/
export type PastKind = "mock" | "csat";
const PAST: Record<PastKind, { exam: () => string; label: string; short: string; q: string; note: string; empty: string; tag: string }> = {
  mock: { exam: () => MOCK_EXAM.exam_id, label: MOCK_EXAM.label, short: "9월 모의평가", q: "1", note: "9월 모의평가 성적 입력은 수능 가채점 전환과 함께 끝났습니다. 저장한 9월 리포트는 여기서 그대로 볼 수 있으며, 고치거나 새로 입력할 수 없습니다.", empty: "저장한 9월 모의평가 리포트가 없습니다.", tag: "마지막 9월 성적" },
  csat: { exam: () => CSAT_EXAM.exam_id, label: CSAT_EXAM.label, short: "수능 가채점", q: "csat", note: "수능 가채점 입력은 실채점 전환과 함께 끝났습니다. 저장한 가채점 리포트는 여기서 그대로 볼 수 있으며, 고치거나 새로 입력할 수 없습니다.", empty: "저장한 수능 가채점 리포트가 없습니다.", tag: "마지막 가채점 성적" },
};
export const pastKindOf = (v: unknown): PastKind | null => (v === "1" ? "mock" : v === "csat" ? "csat" : null);
export const pastHref = (reportId?: string, kind: PastKind = "mock") => (reportId ? `${PAGE}?past=${PAST[kind].q}&report=${encodeURIComponent(reportId)}` : `${PAGE}?past=${PAST[kind].q}`);
/** 지난 리포트 하나의 인쇄용 화면(print/page.tsx 가 ?report= 를 받는다) */
export const printHref = (reportId: string) => `${PAGE}/print?report=${encodeURIComponent(reportId)}`;

/** 이 회원에게 9월 모의평가 리포트가 있는가(1개만 읽는다). 읽지 못하면 false — 링크를 숨기고 오류 화면은 보이지 않는다 */
export async function hasPastMock(src: JungsiSource, caller: Caller, kind: PastKind = "mock"): Promise<boolean> {
  try {
    const id = PAST[kind].exam();
    return hasMockReports(await src.listOwnReports(caller, { exam_id: id, limit: 1 }), id);
  } catch {
    return false;
  }
}

export async function PastRecords({ src, caller, reportId, kind = "mock", backLabel = "수능 가채점 리포트로 돌아가기" }: { src: JungsiSource; caller: Caller; reportId: string | null; kind?: PastKind; backLabel?: string }) {
  const P = PAST[kind], examId = P.exam();
  let list: OwnReportListDto;
  try {
    list = await src.listOwnReports(caller, { exam_id: examId, limit: 20 });
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} reopenUnavailable />;
    if (e instanceof AccessDenied) return <p className="rp-note">지난 기록을 열 권한을 확인하지 못했습니다. 다시 로그인해 주세요.</p>;
    throw e;
  }
  // 9월 모의평가 리포트만(목록 조건과 같은 시험). 최근 저장이 먼저
  const items = list.items.filter((i) => !i.exam_id || i.exam_id === examId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const chosen = reportId ? items.find((i) => i.report_id === reportId) ?? null : null;

  return (
    <section className="rp-sec" aria-labelledby="past-h">
      <div className="rp-sechd">
        <h2 id="past-h">지난 기록 · {P.label}</h2>
        <Link className="btn" href={PAGE}>{backLabel}</Link>
      </div>
      <p className="rp-note">{P.note}</p>
      {items.length === 0 ? (
        <div className="rp-empty">
          <p>{P.empty}</p>
        </div>
      ) : (
        <ul className="pro-hist rp-past">
          {items.map((i) => (
            <li key={i.report_id}>
              <span>
                <span className="num">{seoulDateTime(i.updated_at)}</span> 저장
                {i.is_current && <span className="rp-tag">{P.tag}</span>}
              </span>
              {chosen?.report_id === i.report_id ? <span className="cur">보는 중</span> : <Link className="btn" href={pastHref(i.report_id, kind)}>열기</Link>}
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <Suspense key={chosen.report_id} fallback={<BookLoading compact text="지난 리포트를 불러오고 있습니다." />}>
          <PastDetail src={src} caller={caller} reportId={chosen.report_id} kind={kind} />
        </Suspense>
      )}
    </section>
  );
}

async function PastDetail({ src, caller, reportId, kind }: { src: JungsiSource; caller: Caller; reportId: string; kind: PastKind }) {
  let report: ReportDto | null;
  try {
    report = await src.readReport(caller, reportId);
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} reopenUnavailable />;
    if (e instanceof AccessDenied) return <p className="rp-note">이 리포트를 열 권한을 확인하지 못했습니다. 다시 로그인해 주세요.</p>;
    throw e;
  }
  // 목록에서 사라졌거나 다른 시험의 리포트면 지난 기록으로 그리지 않는다(9월 칸에 가채점, 가채점 칸에 9월이 오지 않게)
  if (!report || isProvisionalOverall(report.overall) !== (kind === "csat")) return <p className="rp-note">이 리포트는 지금 열 수 없습니다. 목록에서 다른 리포트를 골라 주세요.</p>;
  const a = report.overall;
  if (kind === "csat") {
    // 가채점 지난 리포트: 지금 가채점 화면과 같은 대표값 보기(읽기 전용, 인쇄·담은 학교 표는 실채점 리포트에서)
    return (
      <article className="rp-pastdoc" aria-label="지난 리포트">
        <div className="rp-meta">
          <span>{a.exam.academic_year}학년도 {PAST.csat.short} 기준</span>
          <span>{seoulDateTime(report.updated_at)} 저장</span>
          <span className="rp-tag">지난 기록 · 읽기 전용</span>
        </div>
        <ProvisionalOverallCard a={a} single />
        <section aria-label="과목별 예상 성적" className="rp-sec">
          <h3>과목별 예상 성적</h3>
          <ProvisionalSubjectsSheet a={a} single />
          <ProvisionalPositionChart a={a} single />
          <ProvisionalComboScores a={a} single />
        </section>
      </article>
    );
  }
  return (
    <article className="rp-pastdoc" aria-label="지난 리포트">
      <div className="rp-meta">
        <span>{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)} 기준</span>
        <span>{seoulDateTime(report.updated_at)} 저장</span>
        <span className="rp-tag">지난 기록 · 읽기 전용</span>
        {/* 이 지난 리포트를 인쇄(대표님 지적 2026-11-22). 인쇄 화면은 ?report= 를 받아 목록에 있는 9월 리포트만 그린다 */}
        <Link className="btn p rp-print" href={printHref(report.report_id)}>상담 리포트 인쇄용 보기</Link>
      </div>
      <OverallCard a={a} />
      <section aria-label="과목별 결과" className="rp-sec">
        <h3>과목별 결과</h3>
        <SubjectsSheet a={a} />
        <PositionChart a={a} />
        <ComboScores a={a} />
      </section>
      <Suspense fallback={<BookLoading compact text="담은 학교를 불러오고 있습니다." />}>
        <PastPicked src={src} caller={caller} report={report} />
      </Suspense>
    </article>
  );
}

/** 그때 담아 둔 학교와 저장된 분석(다시 계산하지 않는다) */
async function PastPicked({ src, caller, report }: { src: JungsiSource; caller: Caller; report: ReportDto }) {
  const picked = Object.entries(report.shortlist ?? {}).filter(([, e]) => e.selected).length;
  if (picked === 0) return <p className="rp-foot">이 리포트에 담아 둔 학교가 없습니다.</p>;
  let items: Awaited<ReturnType<typeof readPicks>>;
  let failed: ConnectionError | AccessDenied | null = null;
  try {
    items = await readPicks(src, caller, report);
  } catch (e) {
    if (!(e instanceof ConnectionError || e instanceof AccessDenied)) throw e;
    failed = e;
    items = [];
  }
  if (failed instanceof ConnectionError) return <ConnectionNotice e={failed} reopenUnavailable />;
  if (failed) return <p className="rp-note">담은 학교를 열 권한을 확인하지 못했습니다. 다시 로그인해 주세요.</p>;
  return (
    <section className="rp-sec" aria-label="그때 담은 학교">
      <h3>그때 담은 학교 <span className="num">{items.length}</span></h3>
      <PickedTable items={items} overall={report.overall?.overall} report={report} />
    </section>
  );
}
