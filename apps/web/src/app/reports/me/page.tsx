import { ConnectionNotice } from "@/components/connection-notice";
import { MemberMark } from "@/components/member-mark";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "@/components/link";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source, type Caller, type JungsiSource } from "@/lib/api";
import type { ReportDto, ScoreInputStatusDto } from "@/lib/dto";
import { EXAM, examTitle, examTypeLabel, stageOf } from "@/lib/exam";
import { seoulDateTime } from "@/lib/format";
import { loginHref } from "@/lib/links";
import { PaidGate } from "@/components/paid-gate";
import { correctionExhausted } from "@/lib/superseded";
import { readPicks } from "@/lib/shortlist";
import { finishEagerReport, pickedIds, rememberCurrentReport, startEagerReport } from "@/lib/report-ops";
import { RunAnalysis } from "@/components/run-analysis";
import { BookLoading } from "@/components/book-loading";
import { viewPath } from "@/lib/content-view";
import { lockFor, page } from "@/lib/routes";
import { ComboScores, OverallCard, PickedTable, PositionChart, SubjectsSheet } from "./report-view";
import { InputStatus, NoInput, canInput } from "./rights";
import { CorrectionPanel } from "./correction";
import { canRequestCorrection, csatReleaseOn, myLatestCorrection } from "@/lib/correction";
import { correctionInputClosed } from "@/lib/csat-release";
import { ScoreForm, type ScoreDefaults } from "./score-form";
import { ProvisionalForm } from "./provisional-form";
import { ProvisionalPreview } from "./provisional-preview";
import { StageSteps } from "./stage-steps";
import "./report.css";

const route = page("PAGE-02");
const FEATURES = ["수능(모의평가) 성적을 넣으면 전체 응시자 중 내 위치", "담아 둔 학교마다 내 환산점수 · 지원가능성 · 환산 유불리를 한 장에", "상담용 리포트 인쇄"];
export const metadata: Metadata = { title: route.label };

/**
 * 2페이지 · 내 성적 리포트 (REQ-02, REQ-11)
 * 유료: 입력권 확인(score-input.status.read) → 성적 입력(score-profile.create, 단계마다 1회) → 전체 분석 → 리포트
 * 일반: 이용권 안내만(2026-10-27 사용자 결정 — 가상 견본은 빼고, 제대로 만든 예시 리포트는 나중에 따로 둔다.
 *       만료 회원은 에듀터치 본체가 정시터치 전체를 막으므로 여기 오는 일반 회원은 이용권을 산 적 없는 회원이다)
 * 유료: 리포트는 계정의 현재 리포트 하나만 연다(2026-11-04 사용자 결정 — 기기·브라우저와 무관, 예전 리포트 고르기 없음)
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
      desc="수능(모의평가) 성적을 넣으면 전체 응시자 중 내 위치를 보여 드립니다. 이용권이 있으면 담아 둔 학교의 분석까지 한 장으로 정리합니다."
    />
  );
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  if (lockFor(session, route)) return <>{head}<LoginGate /></>;
  const paid = session?.member_tier === "paid";
  if (!paid) return <>{head}<PaidGate kind="paid" route={route} features={FEATURES} /></>;

  const sp = await searchParams;
  // 수능 가채점 예상 성적 미리보기(2026-11-20 대표님 결정): 저장하지 않는 조회라 입력 상태·리포트를 읽지 않는다
  if (sp.preview === "csat") {
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <ProvisionalPreview />
          <Link className="btn" href={route.path}>내 성적 리포트로 돌아가기</Link>
        </div>
      </>
    );
  }
  const editing = sp.edit === "1";
  // 어느 리포트를 열지는 계정 기준이다(2026-11-04 사용자 결정): 서버 입력 상태의 현재 리포트.
  // 입력 상태를 읽지 못하면 어느 리포트가 내 것인지 모르므로 성적 입력 칸을 열지 않고 연결 안내를 보인다(횟수를 추정하지 않는다)
  let status: ScoreInputStatusDto;
  let report: ReportDto | null = null;
  let releaseP: Promise<string | null> = Promise.resolve(null);
  let corrP: ReturnType<typeof myLatestCorrection> = Promise.resolve(null);
  // 지난번 현재 리포트를 입력 상태와 동시에 읽어 둔다(2026-11-10 임시 단축, report-ops 참고). 여는 리포트는 아래 입력 상태가 정한다
  const eagerP = startEagerReport(src, caller);
  try {
    status = await src.readScoreInputStatus(caller, EXAM.exam_id);
    // 입력 상태만 있으면 되는 배부일·정정 요청 조회(에듀터치 DB)는 리포트를 기다리지 않고 함께 보낸다(2026-11-10 나눠 그리기)
    // 수능 성적표 배부일(본체 관리자 설정). 가채점 정정은 배부일 전날까지만 요청·입력한다(2026-10-29 사용자 결정)
    const st = status;
    releaseP = st.stage === "provisional" ? csatReleaseOn(st.academic_year) : Promise.resolve(null);
    // 성적 정정 요청(2026-10-28 사용자 결정): 이 단계의 내 마지막 요청. 표를 읽지 못하면 요청 길을 열지 않는다
    corrP = myLatestCorrection(EXAM.exam_id, st.stage);
    // 아래에서 연결 안내로 먼저 끝나도 처리되지 않은 거절로 남지 않게 한다(기다리는 곳에는 그대로 전해진다)
    releaseP.catch(() => {});
    corrP.catch(() => {});
    // 정정 입력 뒤에는 정정한 리포트가 현재 리포트다(2026-10-28 사용자 결정)
    const current = status.current_report_id;
    await rememberCurrentReport(src, caller, current);
    report = current ? await finishEagerReport(src, caller, await eagerP, current) : null;
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    throw e;
  }
  const releaseOn = await releaseP;
  const inputOpen = canInput(status) && !correctionInputClosed(status, releaseOn);
  const corr = await corrP;
  const latestCorr = corr?.row ?? null;
  const canCorrect = !!corr && canRequestCorrection(status, latestCorr, releaseOn);
  const correctHref = canCorrect || latestCorr?.status === "pending" || latestCorr?.status === "returned" ? `${route.path}?correct=1` : null;
  if (sp.correct === "1" && status && corr) {
    // 관리자가 저장된 점수와 비교하도록 지금 성적(현재 리포트)을 함께 보낸다
    const current = report;
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <InputStatus st={status} />
          <CorrectionPanel st={status} latest={latestCorr} can={canCorrect} releaseOn={releaseOn} savedScores={current ? JSON.stringify(defaultsFrom(current)) : ""} />
          <Link className="btn" href={route.path}>내 성적 리포트로 돌아가기</Link>
        </div>
      </>
    );
  }
  // 리포트 표시(2026-11-04 사용자 결정): 판 번호 대신 '○○ 기준 ○○ 저장'. 정정 입력을 다 쓴 뒤에만 '정정 입력 횟수 소진'을 붙인다
  // (리포트는 늘 현재 리포트 하나라 '현재 성적' 꼬리표는 쓰지 않는다). 판 번호는 서버의 겹침 방지에만 쓴다
  const tag = correctionExhausted(status) ? "정정 입력 횟수 소진" : null;
  const idem = crypto.randomUUID();
  // 입력 단계(2026-11-12 최종관리자 결정): 서버가 정한 단계로 양식을 고른다. 수능 뒤에는 9월 모의평가가 보이지 않는다
  const stage = stageOf(status.stage);
  const title = examTitle(stage, status.academic_year);

  if (!report || editing) {
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <StageSteps stage={stage} finalOpen={status.stage_state === "open"} />
          {status && <InputStatus st={status} />}
          <p className="rp-note"><Link href={`${route.path}?preview=csat`}>수능 가채점 원점수로 과목별 예상 성적 보기</Link> — 저장하지 않는 조회입니다.</p>
          {inputOpen && stage === "provisional" ? (
            <ProvisionalForm examLabel={title} />
          ) : inputOpen ? (
            <>
              {report && (
                <p className="rp-note">
                  새 성적을 저장하면 리포트가 새로 계산됩니다. 담아 둔 학교는 남아 있고, 새 성적으로 다시 확인할 때까지 &lsquo;다시 확인 필요&rsquo;로 표시됩니다.
                </p>
              )}
              <ScoreForm
                examLabel={title}
                kicker={stage === "final" ? "성적 입력 · 수능 실채점" : "성적 입력"}
                banner={stage === "final" ? "가채점 성적이 있으면 실채점 성적을 저장할 때 리포트가 실채점 기준으로 바뀝니다. 가채점 기록은 그대로 남습니다." : undefined}
                idem={idem} defaults={report ? defaultsFrom(report) : {}} update={report ? { reportId: report.report_id, version: report.report_version } : undefined} />
            </>
          ) : (
            <NoInput st={status} correctHref={correctHref} />
          )}
          {report && <Link className="btn" href={route.path}>고치지 않고 돌아가기</Link>}
        </div>
      </>
    );
  }

  // 리포트 열람에서는 저장된 판정만 읽는다. 분석이 없는 곳은 아래 버튼을 눌러야 계산한다(담당자 회신 2026-10-25)
  // 담은 곳의 수·분석 여부는 리포트로 바로 알고, 이름(offering.read)이 필요한 표만 뒤이어 그린다(2026-11-10 나눠 그리기)
  const pickedList = [...pickedIds(report)];
  const a = report.overall;
  // 담은 곳 중 지금 리포트에 분석이 없는 곳(성적을 새로 넣은 뒤 등)
  const unanalyzed = pickedList.filter((id) => !report.analyses?.[id]);

  return (
    <>
      {head}
      {/* 이용권 회원의 리포트(핵심 지원 학교 분석 포함): 회원 식별 표시 + 조회 기록 */}
      <MemberMark kind="report" path={viewPath(route.path, sp)} />
      <div className="wrap pg-body rp">
        <div className="rp-meta">
          <span>{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)} 기준</span>
          <span>{seoulDateTime(report.updated_at)} 저장</span>
          {tag && <span className="rp-tag">{tag}</span>}
          {/* 저장한 성적은 고치지 않는다 — 입력권이 남은 유료 회원만 새 성적으로 리포트의 새 판을 만든다 */}
          {inputOpen && <Link className="btn" href={`${route.path}?edit=1`}>새 성적 입력</Link>}
          {!inputOpen && correctHref && <Link className="btn" href={correctHref}>{canCorrect ? "성적 정정 요청" : "정정 요청 상태"}</Link>}
          <Link className="btn" href={`${route.path}?preview=csat`}>수능 가채점 예상 성적 보기</Link>
        </div>

        <OverallCard a={a} />
        {/* 저장 스냅샷이 자료 연결 전 상태로 남은 리포트만. 사용자가 한 번 누를 때만 계산한다(자동 요청 없음) */}
        <section aria-labelledby="sub-h" className="rp-sec">
          <h2 id="sub-h">과목별 결과</h2>
          <SubjectsSheet a={a} />
          <PositionChart a={a} />
          <ComboScores a={a} />
        </section>

        <section aria-labelledby="sl-h" className="rp-sec">
          <div className="rp-sechd">
            <h2 id="sl-h">
              핵심 지원 학교 <span className="num">{pickedList.length}</span>
            </h2>
            <Link className="btn p" href={`${route.path}/print`}>상담 리포트 인쇄용 보기</Link>
          </div>
          {pickedList.length === 0 ? (
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
                  desc="누르면 이 리포트의 성적으로 그 학교만 분석합니다. 성적을 다시 저장하지 않으며 입력 횟수는 줄지 않습니다."
                  label="지금 성적으로 분석"
                  busy="분석하는 중…"
                />
              )}
              <Suspense fallback={<BookLoading compact text="담은 학교를 불러오고 있습니다." />}>
                <Picked src={src} caller={caller} report={report} />
              </Suspense>
            </>
          )}
          <p className="rp-foot">모의지원 서비스에서 각 모집단위의 모집군·지원 조건·모집인원 변경을 다시 확인하세요. 정시터치는 외부 서비스에 성적을 보내거나 자동으로 등록하지 않습니다.</p>
        </section>
      </div>
    </>
  );
}

/** 담은 학교 표. 이름은 offering.read 로 받는다. 받지 못하면 이 자리에만 연결 안내를 보인다(위 리포트는 그대로) */
async function Picked({ src, caller, report }: { src: JungsiSource; caller: Caller; report: ReportDto }) {
  let items;
  let failed: ConnectionError | AccessDenied | null = null;
  try {
    items = await readPicks(src, caller, report);
  } catch (e) {
    if (!(e instanceof ConnectionError || e instanceof AccessDenied)) throw e;
    failed = e;
  }
  if (failed instanceof ConnectionError) return <ConnectionNotice e={failed} />;
  if (failed || !items) return <p className="rp-note">담은 학교를 열 권한을 확인하지 못했습니다. 다시 로그인해 주세요.{failed ? ` (문의 번호 ${failed.code})` : ""}</p>;
  return <PickedTable items={items} />;
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
