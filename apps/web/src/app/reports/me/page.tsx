import { ConnectionNotice } from "@/components/connection-notice";
import { MemberMark } from "@/components/member-mark";
import type { Metadata } from "next";
import Link from "@/components/link";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import type { OwnReportListDto, ReportDto, ScoreInputStatusDto } from "@/lib/dto";
import { EXAM, examTypeLabel } from "@/lib/exam";
import { seoulDateTime } from "@/lib/format";
import { loginHref } from "@/lib/links";
import { PaidGate } from "@/components/paid-gate";
import { getReportId } from "@/lib/report-ref";
import { readPicks, type PickedItem } from "@/lib/shortlist";
import { RunAnalysis } from "@/components/run-analysis";
import { viewPath } from "@/lib/content-view";
import { lockFor, page } from "@/lib/routes";
import { ComboChart, OverallCard, PickedTable, PositionChart, SubjectsSheet } from "./report-view";
import { OwnReports } from "./own-reports";
import { RefreshOverall } from "./refresh-overall";
import { InputStatus, NoInput, canInput } from "./rights";
import { CorrectionPanel } from "./correction";
import { canRequestCorrection, myLatestCorrection } from "@/lib/correction";
import { ScoreForm, type ScoreDefaults } from "./score-form";
import "./report.css";

const route = page("PAGE-02");
/** 자료가 연결되면 다시 계산으로 풀릴 수 있는 보류 사유. 입력 범위 밖 등 다시 계산해도 같은 결과인 사유는 넣지 않는다 */
const REFRESHABLE = new Set(["total_model_missing", "total_model_not_approved"]);
const FEATURES = ["수능(모의평가) 성적을 넣으면 전체 응시자 중 내 위치", "담아 둔 학교마다 내 환산점수 · 지원가능성 · 환산 유불리를 한 장에", "상담용 리포트 인쇄"];
export const metadata: Metadata = { title: route.label };

/**
 * 2페이지 · 내 성적 리포트 (REQ-02, REQ-11)
 * 유료: 입력권 확인(score-input.status.read) → 성적 입력(score-profile.create, 단계마다 1회) → 전체 분석 → 리포트
 * 일반: 이용권 안내만(2026-10-27 사용자 결정 — 가상 견본은 빼고, 제대로 만든 예시 리포트는 나중에 따로 둔다.
 *       만료 회원은 에듀터치 본체가 정시터치 전체를 막으므로 여기 오는 일반 회원은 이용권을 산 적 없는 회원이다)
 * 유료: 본인 리포트 목록(report.list-own)에서 다른 기기에서 저장한 리포트를 골라 연다
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
  const paid = session?.member_tier === "paid";
  if (!paid) return <>{head}<PaidGate kind="paid" route={route} features={FEATURES} /></>;

  const sp = await searchParams;
  const editing = sp.edit === "1";
  const picking = sp.pick === "1";
  const reportId = await getReportId();
  let report: ReportDto | null = null;
  try {
    report = reportId ? await src.readReport(caller, reportId) : null;
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    throw e;
  }
  // 입력권 상태. 확인하지 못하면 저장을 열지 않는다(횟수를 추정하지 않는다)
  const status: ScoreInputStatusDto | null = await src.readScoreInputStatus(caller, EXAM.exam_id).catch(() => null);
  const inputOpen = canInput(status);
  // 성적 정정 요청(2026-10-28 사용자 결정): 이 단계의 내 마지막 요청. 표를 읽지 못하면 요청 길을 열지 않는다
  const corr = status ? await myLatestCorrection(EXAM.exam_id, status.stage) : null;
  const latestCorr = corr?.row ?? null;
  const canCorrect = !!corr && canRequestCorrection(status, latestCorr);
  const correctHref = canCorrect || latestCorr?.status === "pending" || latestCorr?.status === "returned" ? `${route.path}?correct=1` : null;
  if (sp.correct === "1" && status && corr) {
    // 관리자가 저장된 점수와 비교하도록 지금 성적의 리포트를 함께 보낸다. 이 브라우저에 연 리포트가 없으면 서버가 알려 준 현재 리포트를 읽는다
    const current = report ?? (status.current_report_id ? await src.readReport(caller, status.current_report_id).catch(() => null) : null);
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <InputStatus st={status} />
          <CorrectionPanel st={status} latest={latestCorr} can={canCorrect} savedScores={current ? JSON.stringify(defaultsFrom(current)) : ""} />
          <Link className="btn" href={route.path}>내 성적 리포트로 돌아가기</Link>
        </div>
      </>
    );
  }
  // 리포트 표시(2026-10-28 사용자 결정): 판 번호 대신 저장 시각과 '현재 성적'·'정정 입력' 표시. 판 번호는 서버의 겹침 방지에만 쓴다
  const tagOf = (id: string) => (status && id === status.current_report_id ? (status.correction_used > 0 ? "정정 입력 · 현재 성적" : "현재 성적") : null);
  // 본인 리포트 목록: 이 브라우저에 리포트가 없을 때, 또는 '다른 리포트 열기'를 눌렀을 때만 부른다
  let own: OwnReportListDto | null = null;
  if (!report || picking) own = await src.listOwnReports(caller, { exam_id: EXAM.exam_id, limit: 10 }).catch(() => null);
  const ownBlock = own && own.items.length > 0 && <OwnReports items={own.items} currentId={report?.report_id ?? null} hasMore={own.has_more} tags={Object.fromEntries(own.items.flatMap((it) => (tagOf(it.report_id) ? [[it.report_id, tagOf(it.report_id)!]] : [])))} />;
  const idem = crypto.randomUUID();

  if (!report || editing) {
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          {status && <InputStatus st={status} />}
          {inputOpen ? (
            <>
              {report && (
                <p className="rp-note">
                  새 성적을 저장하면 리포트가 새로 계산됩니다. 담아 둔 학교는 남아 있고, 새 성적으로 다시 확인할 때까지 &lsquo;다시 확인 필요&rsquo;로 표시됩니다.
                </p>
              )}
              <ScoreForm examLabel={EXAM.label} idem={idem} defaults={report ? defaultsFrom(report) : {}} update={report ? { reportId: report.report_id, version: report.report_version } : undefined} />
            </>
          ) : (
            <NoInput st={status} correctHref={correctHref} />
          )}
          {ownBlock}
          {report && <Link className="btn" href={route.path}>고치지 않고 돌아가기</Link>}
        </div>
      </>
    );
  }

  let shortlist: PickedItem[] = [];
  try {
    // 리포트 열람에서는 저장된 판정만 읽는다. 분석이 없는 곳은 아래 버튼을 눌러야 계산한다(담당자 회신 2026-10-25)
    shortlist = await readPicks(src, caller, report);
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (!(e instanceof AccessDenied)) throw e;
  }
  const a = report.overall;
  // 담은 곳 중 지금 리포트에 분석이 없는 곳(성적을 새로 넣은 뒤 등)
  const unanalyzed = shortlist.filter((s) => !s.assessment).map((s) => s.offering_id);

  return (
    <>
      {head}
      {/* 이용권 회원의 리포트(핵심 지원 학교 분석 포함): 회원 식별 표시 + 조회 기록 */}
      <MemberMark kind="report" path={viewPath(route.path, sp)} />
      <div className="wrap pg-body rp">
        <div className="rp-meta">
          <span>{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)}</span>
          <span>{seoulDateTime(report.updated_at)} 저장</span>
          {tagOf(report.report_id) && <span className="rp-tag">{tagOf(report.report_id)}</span>}
          {/* 저장한 성적은 고치지 않는다 — 입력권이 남은 유료 회원만 새 성적으로 리포트의 새 판을 만든다 */}
          {inputOpen && <Link className="btn" href={`${route.path}?edit=1`}>새 성적 입력</Link>}
          {!inputOpen && correctHref && <Link className="btn" href={correctHref}>{canCorrect ? "성적 정정 요청" : "정정 요청 상태"}</Link>}
          <Link className="btn" href={`${route.path}?pick=1`}>다른 리포트 열기</Link>
        </div>

        {picking && ownBlock}
        <OverallCard a={a} />
        {/* 저장 스냅샷이 자료 연결 전 상태로 남은 리포트만. 사용자가 한 번 누를 때만 계산한다(자동 요청 없음) */}
        {a.overall.status === "pending" && REFRESHABLE.has(a.overall.reason_code ?? "") && <RefreshOverall idem={idem} />}
        <section aria-labelledby="sub-h" className="rp-sec">
          <h2 id="sub-h">과목별 결과</h2>
          <SubjectsSheet a={a} />
          <PositionChart a={a} />
          <ComboChart a={a} />
        </section>

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
            <>
              {unanalyzed.length > 0 && (
                <RunAnalysis
                  ids={unanalyzed}
                  title={`담은 학교 ${unanalyzed.length}곳은 지금 성적으로 아직 분석하지 않았습니다`}
                  desc="누르면 이 리포트의 성적으로 그 학교만 분석합니다. 성적을 다시 저장하지 않으며 입력권은 줄지 않습니다."
                  label="지금 성적으로 분석"
                  busy="분석하는 중…"
                />
              )}
              <PickedTable items={shortlist} />
            </>
          )}
          <p className="rp-foot">모의지원 서비스에서 각 모집단위의 모집군·지원 조건·모집인원 변경을 다시 확인하세요. 정시터치는 외부 서비스에 성적을 보내거나 자동으로 등록하지 않습니다.</p>
        </section>
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
        <h2 id="gate-h">로그인하고 이용권으로 여는 화면입니다</h2>
        <p>성적 입력과 리포트는 이용권 회원이 쓸 수 있습니다.</p>
        <div className="acts">
          <a className="btn p" href={loginHref(route.path)}>에듀터치 로그인</a>
        </div>
      </section>
    </div>
  );
}
