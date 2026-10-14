import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
import Link from "next/link";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import type { ReportDto } from "@/lib/dto";
import { EXAM } from "@/lib/exam";
import { seoulDate } from "@/lib/format";
import { PASS_HREF, loginHref } from "@/lib/links";
import { getReportId } from "@/lib/report-ref";
import { ensureAnalyses, pickedItems, type PickedItem } from "@/lib/report-ops";
import { lockFor, page } from "@/lib/routes";
import { ComboChart, OverallCard, PickedTable, PositionChart, SubjectsSheet } from "./report-view";
import { ScoreForm, type ScoreDefaults } from "./score-form";
import "./report.css";

const route = page("PAGE-02");
export const metadata: Metadata = { title: route.label };

/**
 * 2페이지 · 내 성적 리포트 (REQ-02, REQ-11)
 * 일반·유료: 성적 입력(score-profile.create) → 전체 분석(overall.analyze) → 리포트(report.read)
 * 유료만: 핵심 지원 학교 분석과 상담 리포트 인쇄(report.export)
 * 응답 모양: lib/dto.ts (API_DTO_계약 report·profile·overall-analysis)
 */
export default async function Page({ searchParams }: PageProps<"/reports/me">) {
  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  const head = (
    <PageHead
      kicker={`PAGE ${route.number}`}
      title={route.label}
      desc="수능(모의평가) 표준점수를 넣으면 전체 응시자 중 내 위치를 보여 드립니다. 이용권이 있으면 담아 둔 학교의 분석까지 한 장으로 정리합니다."
    />
  );
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  if (lockFor(session, route)) return <>{head}<LoginGate /></>;

  const sp = await searchParams;
  const editing = sp.edit === "1";
  const reportId = await getReportId();
  let report: ReportDto | null = null;
  try {
    report = reportId ? await src.readReport(caller, reportId) : null;
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    throw e;
  }
  const idem = crypto.randomUUID();

  if (!report || editing) {
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          {report && (
            <p className="rp-note">
              새 성적을 저장하면 리포트가 새로 계산됩니다. 담아 둔 학교는 남아 있고, 새 성적으로 다시 확인할 때까지 &lsquo;다시 확인 필요&rsquo;로 표시됩니다.
            </p>
          )}
          <ScoreForm examLabel={EXAM.label} idem={idem} defaults={report ? defaultsFrom(report) : {}} update={report ? { reportId: report.report_id, version: report.report_version } : undefined} />
          {report && <Link className="btn" href={route.path}>고치지 않고 돌아가기</Link>}
        </div>
      </>
    );
  }

  const paid = session?.member_tier === "paid";
  let shortlist: PickedItem[] = [];
  if (paid) {
    try {
      // 담은 곳 중 분석이 없는 것(성적을 바꾼 뒤 등)은 지금 리포트로 다시 분석한다
      const ids = Object.entries(report.shortlist ?? {}).filter(([, e]) => e.selected).map(([id]) => id);
      const st = await ensureAnalyses(src, caller, report, ids);
      if (st.kind !== "none" && st.report) report = st.report;
      shortlist = await pickedItems(src, caller, report);
    } catch (e) {
      if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
      if (!(e instanceof AccessDenied)) throw e;
    }
  }
  const a = report.overall;

  return (
    <>
      {head}
      <div className="wrap pg-body rp">
        <div className="rp-meta">
          <span>{a.exam.academic_year}학년도 {a.exam.exam_type}</span>
          <span>리포트 {report.report_version}번째 · {seoulDate(report.updated_at)} 저장</span>
          <Link className="btn" href={`${route.path}?edit=1`}>성적 고치기</Link>
        </div>

        <OverallCard a={a} />
        <section aria-labelledby="sub-h" className="rp-sec">
          <h2 id="sub-h">과목별 결과</h2>
          <SubjectsSheet a={a} />
          <PositionChart a={a} />
          <ComboChart a={a} />
        </section>

        {paid ? (
          <section aria-labelledby="sl-h" className="rp-sec">
            <div className="rp-sechd">
              <h2 id="sl-h">
                핵심 지원 학교 <span className="num">{shortlist.length}</span>
              </h2>
              <Link className="btn p" href={`${route.path}/print`}>상담 리포트 인쇄용 보기</Link>
            </div>
            {shortlist.length === 0 ? (
              <div className="rp-empty">
                <p>아직 담은 학교가 없습니다. 아래 화면에서 마음에 드는 모집단위를 담으면 여기에 모입니다.</p>
                <div className="acts">
                  <Link className="btn" href={page("PAGE-04").path}>{page("PAGE-04").label}</Link>
                  <Link className="btn" href={page("PAGE-03").path}>{page("PAGE-03").label}</Link>
                </div>
              </div>
            ) : (
              <PickedTable items={shortlist} />
            )}
            <p className="rp-foot">모의지원 서비스에서 각 모집단위의 모집군·지원 조건·모집인원 변경을 다시 확인하세요. 정시터치는 외부 서비스에 성적을 보내거나 자동으로 등록하지 않습니다.</p>
          </section>
        ) : (
          <section className="rp-lock" aria-labelledby="lock-h">
            <div className="ic"><LockIcon size={18} /></div>
            <div>
              <h2 id="lock-h">대학 분석과 핵심 지원 학교 리포트는 이용권으로 열립니다</h2>
              <p>담아 둔 학교마다 내 환산점수·지원가능성·환산 유불리를 한 장에 모으고 상담용으로 인쇄할 수 있습니다.</p>
            </div>
            <a className="btn t" href={PASS_HREF}>이용권 보기</a>
          </section>
        )}
      </div>
    </>
  );
}

/** 고치기 화면은 지난 리포트의 입력값으로 채운다(서버는 기존 성적을 수정하지 않고 새 프로필을 만든다) */
function defaultsFrom(r: ReportDto): ScoreDefaults {
  const by = Object.fromEntries(r.overall.subjects.map((s) => [s.area, s]));
  return {
    korean_choice: by.korean?.choice ?? undefined,
    korean: by.korean?.standard_score,
    math_choice: by.math?.choice ?? undefined,
    math: by.math?.standard_score,
    inq1: by.inquiry1?.subject,
    inq1_score: by.inquiry1?.standard_score,
    inq2: by.inquiry2?.subject,
    inq2_score: by.inquiry2?.standard_score,
    english: r.overall.absolute_grades.영어,
    history: r.overall.absolute_grades.한국사,
  };
}

function LoginGate() {
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="gate-h">
        <div className="ic"><LockIcon size={20} /></div>
        <h2 id="gate-h">로그인하면 성적을 넣고 내 위치를 볼 수 있습니다</h2>
        <p>성적 입력과 전체 위치는 에듀터치 회원이면 이용권 없이 쓸 수 있습니다.</p>
        <div className="acts">
          <a className="btn p" href={loginHref(route.path)}>에듀터치 로그인</a>
        </div>
      </section>
    </div>
  );
}
