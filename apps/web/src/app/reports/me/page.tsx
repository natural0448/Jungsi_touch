import { ConnectionNotice } from "@/components/connection-notice";
import { isFreeProvisional } from "@/lib/free-provisional";
import { MemberMark } from "@/components/member-mark";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "@/components/link";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import type { ReportDto, ScoreInputStatusDto } from "@/lib/dto";
import { EXAM, MOCK_EXAM, csatOpen, examTitle, examTypeLabel, finalOpen, stageOf } from "@/lib/exam";
import { isProvisionalReport, provisionalDefaults } from "@/lib/provisional-report";
import { AutoReopen } from "@/components/auto-reopen";
import { seoulDateTime } from "@/lib/format";
import { loginHref } from "@/lib/links";
import { PaidGate } from "@/components/paid-gate";
import { correctionExhausted } from "@/lib/superseded";
import { PICK_TOTAL_LIMIT } from "@/lib/picked-view";
import { finishEagerReport, pickedIds, rememberCurrentReport, startEagerReport } from "@/lib/report-ops";
import { BookLoading } from "@/components/book-loading";
import { viewPath } from "@/lib/content-view";
import { REPORT_TAB, lockFor, page } from "@/lib/routes";
import { ComboScores, OverallCard, PositionChart, ProvisionalComboScores, ProvisionalOverallCard, ProvisionalPositionChart, ProvisionalSubjectsSheet, SubjectsSheet } from "./report-view";
import { PastRecords, pastHref, pastKindOf } from "./past-records";
import { InputStatus, NoInput, canInput } from "./rights";
import { CorrectionPanel } from "./correction";
import { canRequestCorrection, csatReleaseOn, myLatestCorrection } from "@/lib/correction";
import { correctionInputClosed } from "@/lib/csat-release";
import { ScoreForm, type ScoreDefaults } from "./score-form";
import { ProvisionalForm } from "./provisional-form";
import { ProvisionalPreview } from "./provisional-preview";
import { StageSteps } from "./stage-steps";
import { redirect } from "next/navigation";
import { InaccurateNotice } from "@/components/inaccurate-notice";
import { memberName } from "@/lib/member-name";
import { isInaccurate } from "@/lib/score-validity";
import { selfCorrectionOpen } from "@/lib/csat-release";
import { hasPastMock } from "./past-records";
import "./report.css";

const route = page("PAGE-02");
const FEATURES = ["수능(모의평가) 성적을 넣으면 전체 응시자 중 내 위치", "담아 둔 학교마다 내 환산점수 · 지원가능성 · 환산 유불리를 한 장에", "상담용 리포트 인쇄"];
// 2026-11-23 0시 수능 가채점 전환 뒤 문구(lib/exam csatOpen). 전환 전에는 위 문구 그대로다
const CSAT_FEATURES = ["수능 가채점 원점수를 넣으면 전체 응시자 중 내 예상 위치(범위)", "과목마다 예상 표준점수 · 백분위 · 등급 범위", "저장한 9월 모의평가 리포트는 지난 기록으로 그대로"];
const DESC = "수능(모의평가) 성적을 넣으면 전체 응시자 중 내 위치를 보여 드립니다. 이용권이 있으면 담아 둔 학교의 분석까지 한 장으로 정리합니다.";
const CSAT_DESC = "수능 가채점 원점수를 넣으면 예상 표준점수 합과 가채점 모형 기준 추정 상위누백을 보여 드립니다. 저장한 9월 모의평가 리포트는 지난 기록에서 볼 수 있습니다.";
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
  // 9월 모의평가 → 수능 가채점 전환(2026-11-23 0시 KST)은 화면이 요청마다 지금 시각으로 고른다(lib/exam).
  // 전환 전에는 지금까지의 9월 모의평가 화면 그대로다
  const csat = csatOpen();
  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  const head = (
    <PageHead
      kicker={`PAGE ${route.number}`}
      title={route.label}
      desc={csat ? CSAT_DESC : DESC}
    />
  );
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  if (lockFor(session, route)) return <>{head}<LoginGate /></>;
  // 가채점 무료 공개 기간에는 일반 회원도 가채점 성적 입력·리포트를 쓴다(실채점은 서버가 막는다)
  const paid = session?.member_tier === "paid" || isFreeProvisional(session);
  if (!paid) return <>{head}<PaidGate kind="paid" route={route} features={csat ? CSAT_FEATURES : FEATURES} /></>;

  const sp = await searchParams;
  // 지난 기록(전환 뒤): 저장한 9월 모의평가 리포트를 읽기 전용으로 본다(대표님 결정: 9월 기록은 남긴다)
  // 2026-11-25: 실채점 전환 뒤에는 수능 가채점 리포트도 지난 기록(?past=csat)
  const pastKind = pastKindOf(sp.past);
  const fin = finalOpen();
  if (csat && pastKind && (pastKind === "mock" || fin)) {
    // 그 시험 리포트를 저장한 적이 없으면 지난 기록을 열지 않고 지금 리포트 화면으로 돌려보낸다(2026-11-22 대표님 요청)
    if (!(await hasPastMock(src, caller, pastKind))) redirect(route.path);
    const want = typeof sp.report === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sp.report) ? sp.report : null;
    return (
      <>
        {head}
        <MemberMark kind="report" path={viewPath(route.path, sp)} />
        <div className="wrap pg-body rp">
          <Suspense fallback={<BookLoading compact text="지난 기록을 불러오고 있습니다." />}>
            <PastRecords src={src} caller={caller} reportId={want} kind={pastKind} backLabel={fin ? "수능 실채점 리포트로 돌아가기" : "수능 가채점 리포트로 돌아가기"} />
          </Suspense>
        </div>
      </>
    );
  }
  // 수능 가채점 예상 성적 미리보기(2026-11-20 대표님 결정): 저장하지 않는 조회라 입력 상태·리포트를 읽지 않는다.
  // 전환 뒤에는 실제 가채점 입력이 열리므로 미리보기를 내리고 아래 리포트 화면으로 그린다
  if (!csat && sp.preview === "csat") {
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
  // 2026-11-27 속도: 회원 이름(본체 DB, cache)은 처음부터 함께 받는다
  memberName().catch(() => {});
  // 지난 기록 확인(리포트 목록 1개)은 입력 상태 뒤 리포트 읽기와 함께 보낸다(전에는 리포트를 다 받은 뒤 차례로). 동시 2건을 넘지 않게 두 확인은 이어서
  let pastP: Promise<[boolean, boolean]> = Promise.resolve([false, false]);
  try {
    status = await src.readScoreInputStatus(caller, EXAM.exam_id);
    pastP = (async (): Promise<[boolean, boolean]> => {
      const mock = csat ? await hasPastMock(src, caller) : false;
      const pastCsat = fin ? await hasPastMock(src, caller, "csat") : false;
      return [mock, pastCsat];
    })();
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
    // 전환 직후 가채점 입력 설정이 서버에 아직 닿지 않았을 때(score_stage_unavailable 등)도 고객에게 오류 화면을 보이지 않는다.
    // 차분한 한 줄과 지난 기록 길만 두고 몇 초 뒤 스스로 다시 연다(같은 주소 1분에 2번까지)
    if (csat && e instanceof ConnectionError && e.kind !== "unconfigured") return <>{head}<CsatOpening /></>;
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    throw e;
  }
  const releaseOn = await releaseP;
  const inputOpen = canInput(status) && !correctionInputClosed(status, releaseOn);
  const corr = await corrP;
  const latestCorr = corr?.row ?? null;
  // 가채점 원점수 정정은 사진 없이 즉시 자동 승인(2026-11-22 대표님 결정). 그 밖의 단계는 지금처럼 사진과 함께 요청한다
  const provisionalStage = status.stage === "provisional";
  const selfCorrect = selfCorrectionOpen(status, releaseOn);
  const canCorrect = provisionalStage ? selfCorrect : !!corr && canRequestCorrection(status, latestCorr, releaseOn);
  const correctHref = canCorrect || (!provisionalStage && (latestCorr?.status === "pending" || latestCorr?.status === "returned")) ? `${route.path}?correct=1` : null;
  // 정정 입력(승인된 정정권 또는 자동 승인)으로 저장하는 중이면 확인 창에 재입력 경고를 보인다
  const correcting = status.initial_remaining <= 0;
  const name = await memberName();
  const stage = stageOf(status.stage);
  const title = examTitle(stage, status.academic_year);
  const idem = crypto.randomUUID();
  // 부정확 입력(받을 수 없는 점수로 저장, 서버 상태 기준): 분석 대신 안내만, 3·4페이지도 막힌다(lib/report-ref)
  const inaccurate = isInaccurate(status, report);
  if (sp.correct === "1" && provisionalStage && (selfCorrect || (inputOpen && status.correction_granted > status.correction_used))) {
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <InputStatus st={status} />
          <p className="rp-note" role="status">가채점 원점수 정정 요청이 바로 승인되었습니다. 바른 원점수를 다시 넣어 주세요. 정정은 이 단계에서 한 번뿐입니다.</p>
          <ProvisionalForm
            examLabel={title}
            idem={idem}
            name={name}
            correcting
            defaults={report && isProvisionalReport(report) ? provisionalDefaults(report) : {}}
            update={report && isProvisionalReport(report) && !inaccurate ? { reportId: report.report_id, version: report.report_version } : undefined}
          />
          <Link className="btn" href={route.path}>정정하지 않고 돌아가기</Link>
        </div>
      </>
    );
  }
  if (sp.correct === "1" && status && corr) {
    // 관리자가 저장된 점수와 비교하도록 지금 성적(현재 리포트)을 함께 보낸다
    const current = report;
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <InputStatus st={status} />
          <CorrectionPanel st={status} latest={latestCorr} can={canCorrect} releaseOn={releaseOn} savedScores={current ? JSON.stringify(isProvisionalReport(current) ? provisionalDefaults(current) : defaultsFrom(current)) : ""} />
          <Link className="btn" href={route.path}>내 성적 리포트로 돌아가기</Link>
        </div>
      </>
    );
  }
  // 리포트 표시(2026-11-04 사용자 결정): 판 번호 대신 '○○ 기준 ○○ 저장'. 정정 입력을 다 쓴 뒤에만 '정정 입력 횟수 소진'을 붙인다
  // (리포트는 늘 현재 리포트 하나라 '현재 성적' 꼬리표는 쓰지 않는다). 판 번호는 서버의 겹침 방지에만 쓴다
  const tag = correctionExhausted(status) ? "정정 입력 횟수 소진" : null;
  // 입력 단계(2026-11-12 최종관리자 결정): 서버가 정한 단계로 양식을 고른다(stage·title 은 위에서 정했다). 수능 뒤에는 9월 모의평가가 보이지 않는다
  // 전환 뒤 리포트는 수능 가채점 리포트다(9월 리포트는 지난 기록). 가채점 리포트는 범위로만 그린다
  const provisional = isProvisionalReport(report);
  // 지난 기록 · 9월 모의평가는 9월 리포트를 저장한 회원에게만(2026-11-22 대표님 요청). 목록 1개만, 실패하면 숨긴다
  const [pastMock, pastCsat] = await pastP;
  const pastLink = pastMock || pastCsat ? (
    <p className="rp-note">
      {pastCsat && <><Link href={pastHref(undefined, "csat")}>지난 기록 · 수능 가채점 리포트 보기</Link> — 저장한 가채점 리포트를 읽기 전용으로 봅니다. </>}
      {pastMock && <><Link href={pastHref()}>지난 기록 · {MOCK_EXAM.label} 리포트 보기</Link> — 저장한 9월 리포트를 읽기 전용으로 봅니다.</>}
    </p>
  ) : null;

  // 부정확 입력 상태: '○○님께서 부정확한 성적을 입력하여 성적 분석이 되지 않습니다' 문구와 정정 길만(2026-11-22 대표님 결정).
  // 승인된 정정 입력을 고르러 ?edit=1 로 온 경우만 아래 양식으로 간다
  if (inaccurate && !(editing && inputOpen)) {
    const fix = provisionalStage ? (selfCorrect || inputOpen ? `${route.path}?correct=1` : null) : inputOpen ? `${route.path}?edit=1` : correctHref;
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <InputStatus st={status} />
          <InaccurateNotice name={name} correctHref={fix} provisional={provisionalStage} />
          {pastLink}
        </div>
      </>
    );
  }

  if (!report || editing) {
    return (
      <>
        {head}
        <div className="wrap pg-body rp">
          <StageSteps stage={stage} finalOpen={status.stage_state === "open"} />
          {status && <InputStatus st={status} />}
          {!csat && <p className="rp-note"><Link href={`${route.path}?preview=csat`}>수능 가채점 원점수로 과목별 예상 성적 보기</Link> — 저장하지 않는 조회입니다.</p>}
          {inputOpen && stage === "provisional" ? (
            <>
              {report && (
                <p className="rp-note">
                  새 가채점 성적을 저장하면 리포트가 새로 계산됩니다. 담아 둔 학교는 남아 있습니다.
                </p>
              )}
              <ProvisionalForm
                examLabel={title}
                idem={idem}
                name={name}
                correcting={correcting}
                defaults={report && provisional ? provisionalDefaults(report) : {}}
                update={report && provisional ? { reportId: report.report_id, version: report.report_version } : undefined}
              />
            </>
          ) : inputOpen && csat && stage === "mock" ? (
            // 전환 뒤 서버가 9월 단계를 주면 9월 표준점수 양식을 열지 않는다(9월 입력은 끝났다. 실채점 final 은 아래 양식 그대로)
            <NoInput st={{ ...status, stage_state: "closed" }} correctHref={correctHref} />
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
                idem={idem} name={name} defaults={report ? defaultsFrom(report) : {}} update={report ? { reportId: report.report_id, version: report.report_version } : undefined} />
            </>
          ) : (
            <NoInput st={status} correctHref={correctHref} />
          )}
          {pastLink}
          {report && <Link className="btn" href={route.path}>고치지 않고 돌아가기</Link>}
        </div>
      </>
    );
  }

  // 리포트 열람에서는 저장된 판정만 읽는다. 분석이 없는 곳은 아래 버튼을 눌러야 계산한다(담당자 회신 2026-10-25)
  // 담은 곳의 수·분석 여부는 리포트로 바로 알고, 이름(offering.read)이 필요한 표만 뒤이어 그린다(2026-11-10 나눠 그리기)
  const pickedList = [...pickedIds(report)];
  const a = report.overall;

  return (
    <>
      {head}
      {/* 이용권 회원의 리포트(핵심 지원 학교 분석 포함): 회원 식별 표시 + 조회 기록 */}
      <MemberMark kind="report" path={viewPath(route.path, sp)} />
      <div className="wrap pg-body rp">
        <div className="rp-meta">
          <span>{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)} 기준</span>
          {/* 2026-11-25 편의성 QA: 3페이지 판정 목록을 만들 때도 리포트가 새로 쓰여 '저장'이 손님이 저장한 시각처럼 보였다 */}
          <span>{seoulDateTime(report.updated_at)} 리포트 갱신</span>
          {tag && <span className="rp-tag">{tag}</span>}
          {/* 저장한 성적은 고치지 않는다 — 입력권이 남은 유료 회원만 새 성적으로 리포트의 새 판을 만든다 */}
          {inputOpen && <Link className="btn" href={`${route.path}?edit=1`}>새 성적 입력</Link>}
          {!inputOpen && correctHref && <Link className="btn" href={correctHref}>{canCorrect ? "성적 정정 요청" : "정정 요청 상태"}</Link>}
          {!csat && <Link className="btn" href={`${route.path}?preview=csat`}>수능 가채점 예상 성적 보기</Link>}
          {pastCsat && <Link className="btn" href={pastHref(undefined, "csat")}>지난 기록 · 수능 가채점</Link>}
          {pastMock && <Link className="btn" href={pastHref()}>지난 기록 · 9월 모의평가</Link>}
        </div>

        {provisional ? (
          <>
            <StageSteps stage={stage} finalOpen={status.stage_state === "open"} />
            <ProvisionalOverallCard a={a} single />
            <section aria-labelledby="sub-h" className="rp-sec">
              <h2 id="sub-h">과목별 예상 성적</h2>
              <ProvisionalSubjectsSheet a={a} single />
              {/* 2026-11-23 대표님 요청: 전문가용 정시 리포트와 같이 위치 그래프·반영 조합별 합산(가채점은 가운데 값·범위) */}
              <ProvisionalPositionChart a={a} single />
              <ProvisionalComboScores a={a} single />
            </section>
          </>
        ) : (
          <>
            <OverallCard a={a} />
            {/* 저장 스냅샷이 자료 연결 전 상태로 남은 리포트만. 사용자가 한 번 누를 때만 계산한다(자동 요청 없음) */}
            <section aria-labelledby="sub-h" className="rp-sec">
              <h2 id="sub-h">과목별 결과</h2>
              <SubjectsSheet a={a} />
              <PositionChart a={a} />
              <ComboScores a={a} />
            </section>
          </>
        )}

        {/* 담은 학교·리포트 출력은 5번째 탭 '리포트'로 옮겼다(2026-11-23 대표님 결정) */}
        <section aria-labelledby="sl-h" className="rp-sec">
          <div className="rp-sechd">
            <h2 id="sl-h">
              담은 학교 <span className="num">{pickedList.length}/{PICK_TOTAL_LIMIT}</span>
            </h2>
            <Link className="btn p" href={REPORT_TAB.path}>리포트에서 보기·출력</Link>
          </div>
          <p className="rp-foot">담은 학교의 판정·환산점수·대학 안 위치·유불리와 상담용 리포트 출력은 <b>{REPORT_TAB.label}</b> 탭에 모았습니다.</p>
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

/** 전환 직후 가채점 입력 상태를 아직 받지 못했을 때. 오류·문의 번호 없이 한 줄만 보이고 스스로 다시 연다 */
function CsatOpening() {
  return (
    <div className="wrap pg-body rp">
      <section className="gate flat" aria-live="polite">
        <h2>잠시 뒤 수능 가채점 성적 입력 화면을 엽니다</h2>
        <p>이 화면을 자동으로 다시 엽니다. 저장한 9월 모의평가 리포트는 <Link href={pastHref()}>지난 기록</Link>에서 볼 수 있습니다.</p>
        <AutoReopen quiet />
      </section>
    </div>
  );
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
