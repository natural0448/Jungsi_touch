import { ConnectionNotice } from "@/components/connection-notice";
import { examTypeLabel } from "@/lib/exam";
import { MemberMark } from "@/components/member-mark";
import { PASS_HREF } from "@/lib/links";
import type { Metadata } from "next";
import Link from "@/components/link";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import { isProvisionalOverall, type SnapshotDto } from "@/lib/dto";
import { seoulDate } from "@/lib/format";
import { EXAM, MOCK_EXAM } from "@/lib/exam";
import { pastHref } from "../past-records";
import { readPicks, type PickedItem } from "@/lib/shortlist";
import { isInaccurate } from "@/lib/score-validity";
import { ComboScores, OverallCard, PickedTable, PositionChart, ProvisionalComboScores, ProvisionalOverallCard, ProvisionalPositionChart, ProvisionalSubjectsSheet, SubjectsSheet } from "../report-view";
import { CsatPickedTable } from "../csat-picked";
import { provisionalBands } from "@/lib/report-ops";
import { REPORT_TAB } from "@/lib/routes";
import type { ReferenceBandDto } from "@/lib/dto";
import { PrintDetail } from "../print-detail";
import { loadPrintExtras } from "@/app/admissions/possibilities/print-extras";
import type { Extras } from "@/app/admissions/possibilities/extras-actions";
import { PrintButton } from "./print-button";
import "@/app/admissions/possibilities/possibilities.css";
import "../report.css";

export const metadata: Metadata = { title: "상담 리포트" };

/**
 * 상담 리포트 인쇄용 화면 — report.export(유료·본인·확인 성적)의 고정 revision 을 그대로 그린다.
 * 인쇄 시 머리글·탭·띠는 숨긴다(styles/jungsi.css @media print).
 */
/** ?report= 로 고를 수 있는 리포트 번호 모양(2페이지 지난 기록 화면과 같은 규칙) */
const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * ?report=<id>: 지난 기록(9월 모의평가) 화면의 '상담 리포트 인쇄용 보기'(대표님 지적 2026-11-22).
 * 이 회원의 9월 리포트 목록(report.list-own)에 있는 번호만 인쇄한다 — 지난 기록 화면이 여는 범위와 같고, 소유권은 서버가 다시 확인한다.
 * 없으면 지금까지처럼 계정의 현재 리포트를 인쇄한다.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ report?: string | string[] }> }) {
  const sp = await searchParams;
  const wanted = typeof sp.report === "string" && REPORT_ID.test(sp.report) ? sp.report : null;
  const back = wanted ? pastHref(wanted) : REPORT_TAB.path;
  const caller = await getCaller();
  const src = source();
  const paidOnly = (
    <div className="wrap pg-body">
      <section className="gate">
        <h2>상담 리포트 인쇄는 이용권 회원 전용입니다</h2>
        <p>전체 성적 위치는 내 성적 리포트에서 그대로 볼 수 있습니다.</p>
        <div className="acts"><a className="btn t" href={PASS_HREF}>이용권 보기</a><Link className="btn" href={back}>내 성적 리포트로</Link></div>
      </section>
    </div>
  );
  // 이용권 없는 회원은 리포트가 없어 '성적 입력하기'로 보내면 막다른 길이 된다 — 먼저 이용권 안내(QA A-02)
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <ConnectionNotice e={down} />;
  if (session && session.member_tier !== "paid") return paidOnly;
  // 인쇄할 리포트는 계정의 현재 리포트(2026-11-04 사용자 결정). 정정 입력 뒤에는 정정한 리포트다(2026-10-28 사용자 결정)
  let snap: SnapshotDto | null = null;
  let shortlist: PickedItem[] = [];
  // 가채점 리포트: 담은 학교의 학교별 판정(4페이지와 같은 university.analyze, 2026-11-23 리포트 탭)
  let csatBands: Record<string, ReferenceBandDto> = {};
  try {
    let reportId: string | null;
    if (wanted) {
      // 지난 기록: 목록에 있는 9월 리포트만(없거나 다른 시험이면 '인쇄할 리포트가 없습니다')
      const list = await src.listOwnReports(caller, { exam_id: MOCK_EXAM.exam_id, limit: 20 });
      reportId = list.items.some((i) => i.report_id === wanted && (!i.exam_id || i.exam_id === MOCK_EXAM.exam_id)) ? wanted : null;
    } else {
      const status = await src.readScoreInputStatus(caller, EXAM.exam_id);
      // 부정확 입력 상태(2026-11-22 대표님 결정)에서는 인쇄할 분석이 없다(2페이지와 같다)
      reportId = isInaccurate(status) ? null : status.current_report_id;
    }
    // 리포트 읽기(report.read)도 함께 받는다: 참고 기준 7단계·지난 합격선 같은 판정 표시는 서버가 읽기 응답에만 붙이고
    // 인쇄용 고정본(report.export)에는 없다. 같은 판일 때만 그 분석으로 바꿔 2페이지 화면과 같은 판정을 인쇄한다(2026-11-21)
    const [exported, read] = reportId
      ? await Promise.all([src.exportReport(caller, reportId), src.readReport(caller, reportId).catch(() => null)])
      : [null, null];
    snap = exported;
    if (snap) {
      const same = !!read && read.report_id === snap.report.report_id && read.report_version === snap.report.report_version;
      const base = same && read ? { ...snap.report, analyses: read.analyses } : snap.report;
      // 고정된 revision 의 shortlist 를 그대로 쓴다. 이름만 offering.read 로 붙인다
      shortlist = await readPicks(src, caller, base);
      if (isProvisionalOverall(base.overall) && read && same && shortlist.length) {
        csatBands = (await provisionalBands(src, caller, read, shortlist.map((s) => s.offering_id)).catch(() => ({ bands: {} }))).bands;
      }
    }
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} />;
    if (!(e instanceof AccessDenied)) throw e;
    return paidOnly;
  }
  if (!snap) {
    return (
      <div className="wrap pg-body">
        <section className="gate">
          <h2>인쇄할 리포트가 없습니다</h2>
          {wanted ? (
            <>
              <p>이 지난 리포트는 지금 인쇄할 수 없습니다. 지난 기록 목록에서 다시 골라 주세요.</p>
              <div className="acts"><Link className="btn p" href={pastHref()}>지난 기록으로</Link></div>
            </>
          ) : (
            <>
              <p>먼저 성적을 넣어 리포트를 만들어 주세요.</p>
              <div className="acts"><Link className="btn p" href={back}>성적 입력하기</Link></div>
            </>
          )}
        </section>
      </div>
    );
  }
  const a = snap.report.overall;
  // 담은 학교 전부의 상세를 펼친 채로 인쇄한다(대표님 결정 2026-11-22). 펼친 상세에 쓰는 자료(2027 모집 정보·발행 기준·
  // 학년도별 대학 발표 성적)를 여기서 미리 받는다 — 최대 15곳, 서버 동시 요청 2 이하(print-extras.ts). 가채점 리포트는 판정 준비 중이라 받지 않는다
  const offerings = isProvisionalOverall(a) ? [] : shortlist.flatMap((s) => (s.offering ? [s.offering] : []));
  const extras: Record<string, Extras> = offerings.length ? await loadPrintExtras(src, caller, offerings) : {};
  const detailOf = (s: PickedItem) =>
    s.offering ? <PrintDetail o={s.offering} a={s.assessment} extras={extras[s.offering_id]} subjects={a.subjects} overall={a.overall} examType={a.exam?.exam_type ?? null} /> : null;

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
            <p className="pr-brand">
              {/* 인쇄본 머리에도 에듀터치 로고(10-26 사용자 결정). 본체 공개 주소를 그대로 쓴다 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://edutouch.co.kr/brand/logo-horizontal.png" alt="EduTouch 에듀터치" width={550} height={108} />
              <span>정시터치 · 상담 리포트</span>
            </p>
            <h1>{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)} 기준</h1>
          </div>
          <dl>
            <div><dt>리포트 판</dt><dd className="num">{snap.snapshot_version}</dd></div>
            <div><dt>발행</dt><dd className="num">{seoulDate(snap.generated_at)}</dd></div>
          </dl>
        </header>

        {isProvisionalOverall(a) ? (
          // 수능 가채점 리포트(2026-11-23 전환): 원점수로 추정한 범위만. 학교별 판정은 아직 없다
          <>
            <ProvisionalOverallCard a={a} fold={false} />
            <h2>과목별 예상 성적</h2>
            <ProvisionalSubjectsSheet a={a} />
            <ProvisionalComboScores a={a} />
            <ProvisionalPositionChart a={a} />
          </>
        ) : (
          <>
            <OverallCard a={a} fold={false} />
            <h2>과목별 결과</h2>
            <SubjectsSheet a={a} />
            <PositionChart a={a} />
            <ComboScores a={a} />
          </>
        )}

        <h2>핵심 지원 학교 <span className="num">{shortlist.length}</span></h2>
        {isProvisionalOverall(a) ? (
          <>
            {shortlist.length === 0 ? <p className="rp-foot">담은 학교가 없습니다.</p> : <CsatPickedTable items={shortlist} bands={csatBands} a={a} print />}
          </>
        ) : shortlist.length === 0 ? (
          <p className="rp-foot">담은 학교가 없습니다.</p>
        ) : (
          <PickedTable items={shortlist} overall={a.overall} print detailOf={detailOf} />
        )}
        <footer className="pr-foot">
          지원가능성은 합격 확률이 아닙니다. 대학마다 만점과 반영 방식이 달라 다른 대학의 환산점수와 크기를 비교할 수 없습니다. 모의지원 서비스에서 모집군·지원 조건·모집인원 변경을 다시 확인하세요.
        </footer>
      </article>
    </div>
  );
}
