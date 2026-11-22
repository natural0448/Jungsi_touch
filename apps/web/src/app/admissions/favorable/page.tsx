import { myFavorites } from "@/lib/favorites";
import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import Link from "@/components/link";
import { ArrowRightIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { MemberMark } from "@/components/member-mark";
import { PaidGate } from "@/components/paid-gate";
import { ScoreBasis } from "@/components/score-basis";
import { StreamTray } from "@/components/shortlist-tray-stream";
import { BookLoading } from "@/components/book-loading";
import { memberName } from "@/lib/member-name";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source, type Caller, type JungsiSource } from "@/lib/api";
import type { ReportDto, StatisticsDto } from "@/lib/dto";
import { loadMineEager, logSettleError, pickedIds, provisionalOnly, settleAnalyses, settleCandidates, type ReportState } from "@/lib/report-ops";
import { ProvisionalPendingGate } from "@/components/provisional-pending";
import { InaccurateNotice } from "@/components/inaccurate-notice";
import { inaccurateSeen } from "@/lib/report-ref";
import { RunAnalysis } from "@/components/run-analysis";
import type { StatsPromise } from "@/components/stats-slot";
import { viewPath } from "@/lib/content-view";
import { lockFor, page } from "@/lib/routes";
import { FILTERS, hrefWith, parseQuery, pastFavorableHref, type Query } from "./query";
import { csatOpen, MOCK_EXAM } from "@/lib/exam";
import { isProvisionalOverall, type OwnReportListDto } from "@/lib/dto";
import { choosePastReport, hasMockReports } from "@/lib/past-mock";
import { seoulDateTime } from "@/lib/format";
import { bestDelta, SchoolCard } from "./school-card";
import { ReferenceWildcardDeck, WildcardDeck } from "./wildcard";
import { ReferenceGroups } from "./reference-groups";
import { CsatGroups } from "./csat-groups";
import { csatView } from "@/lib/provisional-view";
import { referenceGroups } from "@/lib/reference-percentile";
import { referencePool, referenceUniversities, referenceWildcards } from "@/lib/reference-view";
import { CatalogBrowse } from "../possibilities/catalog-browse";
import { listKey } from "../possibilities/query";
import "./favorable.css";

const route = page("PAGE-04");
export const metadata: Metadata = { title: route.label };
const FEATURES = ["내 성적으로 지원 검토 범위(도전·핵심·여유)에 드는 학교 찾기", "학교를 펼쳐 학과 · 전형 · 모집군마다 지원가능성 확인", "간호 · 교육 · 계약학과 · 해양 · 철도 등 와일드카드 — 비장의 한 수", "마음에 드는 곳을 핵심 지원 학교에 담아 리포트로 정리"];

export default async function Page({ searchParams }: PageProps<"/admissions/favorable">) {
  const sp = await searchParams;
  const catalogView = sp.view === "catalog";
  const head = (
    <PageHead
      kicker={`PAGE ${route.number} · 유료`}
      title={route.label}
      desc={catalogView ? "전국 대학과 학과를 검색하고 모집단위별 지원 정보를 확인하세요." : "전체 성적에서 출발해 환산에 유리한 학교를 찾고, 학교 안에서 학과마다 지원 범위를 따로 확인하세요."}
      side={<Link prefetch={false} className="btn" href={catalogView ? route.path : `${route.path}?view=catalog`}>{catalogView ? "유리한 대학 추천 보기" : "전국 대학·학과 보기"}</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const naming = memberName(); // 대기 화면 문구용. 서비스 API 와 별개 조회라 함께 보낸다
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  const lock = lockFor(session, route);
  if (lock) return <>{head}<PaidGate kind={lock} route={route} features={FEATURES} /></>;
  const name = await naming;

  // 머리글은 바로 보이고, 내 리포트가 필요한 본문만 기다린다(2026-11-10 부담당자 요청: 먼저 온 것부터 그리기)
  return (
    <>
      {head}
      {/* 필터·검색·다음 쪽처럼 목록이 바뀌면 key 가 바뀌어 다시 책 넘김을 보인다(펼치기 open 만 바뀌면 그대로, 2026-11-21) */}
      <Suspense key={listKey(sp)} fallback={<BookLoading name={name} kind={catalogView ? "possibilities" : "favorable"} />}>
        {catalogView ? (
          <CatalogBrowse src={src} caller={caller} sp={sp} route={route} features={FEATURES} catalogView />
        ) : csatOpen() && parseQuery(sp).past ? (
          <PastBody src={src} caller={caller} sp={sp} />
        ) : (
          <Body src={src} caller={caller} sp={sp} />
        )}
      </Suspense>
    </>
  );
}

type SP = Awaited<PageProps<"/admissions/favorable">["searchParams"]>;

async function Body({ src, caller, sp }: { src: JungsiSource; caller: Caller; sp: SP }) {
  const p3 = page("PAGE-03");
  const cur = parseQuery(sp);
  let state: ReportState;
  try {
    // 입력 상태와 지난번 현재 리포트를 동시에 읽는다(2026-11-10 임시 단축, report-ops 참고)
    const mine = await loadMineEager(src, caller);
    // 부정확 입력 상태(2026-11-22 대표님 결정): 분석하지 않고 안내와 정정 길만 보인다(직접 주소로 들어와도 같다)
    if (!mine && inaccurateSeen(caller)) return <div className="wrap pg-body fv"><InaccurateNotice name={await memberName()} correctHref={`${page("PAGE-02").path}?correct=1`} back /></div>;
    // 열 때마다 후보(candidates.build)를 한 번 만들고 그 응답의 참고 목록으로 그린다(dep_r17, report-ops settleCandidates).
    // 그동안은 책 넘김 대기 화면이다. 서버 액션(담기·계열 펼침 계산) 뒤 다시 그릴 때는 방금 받은 목록을 다시 쓴다(한 번 열 때 한 번)
    const actionRender = (await headers()).has("next-action");
    state = mine ? { kind: "ready", report: await settleCandidates(src, caller, mine, { reuse: actionRender }) } : { kind: "none" };
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} />;
    if (e instanceof AccessDenied) return <PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} />;
    // 2026-11-22 운영 사고: 리포트 읽기가 예상 밖 응답(연결 오류가 아닌 오류)으로 끝나면 화면 전체가 Next 오류 화면이 됐다.
    // 이유를 기록하고, 같은 '잠시 연결할 수 없음' 안내로 바꿔 스스로 다시 열게 한다
    logSettleError("p3-load", e);
    return <ConnectionNotice e={new ConnectionError("unavailable", "report_read_failed")} reopenUnavailable />;
  }

  if (state.kind !== "ready") {
    return (
      <>
        <div className="wrap pg-body fv">
          <ScoreBasis overall={null} emptyText="유리한 대학 찾기는 확인된 성적으로 계산합니다. 성적을 넣으면 학교 목록과 와일드카드가 나옵니다." />
          <PastEntrySlot src={src} caller={caller} />
          <section className="gate flat">
            <h2>성적을 넣으면 유리한 학교를 찾아 드립니다</h2>
            <p>성적 없이 대학·학과를 둘러보려면 {p3.label}에서 검색하세요. 모집 정보는 성적 없이도 볼 수 있습니다.</p>
            <div className="acts">
              <Link className="btn p" href={page("PAGE-02").path}>성적 입력하기</Link>
              <Link className="btn" href={p3.path}>{p3.label}</Link>
            </div>
          </section>
        </div>
      </>
    );
  }

  const report = state.report;
  // 수능 가채점 리포트(2026-11-23 전환). candidates.build 응답에 학교별 가채점 7단계(source g 행, dep_r22)가 오면
  // 9모 참고 목록과 같은 대학 → 계열 → 학과 목록·배지로 그린다. 판정 행이 하나도 없으면(판정 Secret 이 없을 때 등)
  // 지금처럼 '가채점 판정 준비 중'. 가채점에는 누백·합격선 위치·유불리·와일드카드가 없어 그 부분은 그리지 않는다
  if (provisionalOnly(report)) {
    let csat: ReturnType<typeof csatView> = { universities: [], outsideBand: 0, judged: 0 };
    try {
      csat = csatView(report.candidates);
    } catch (e) {
      logSettleError("p3-csat", e);
    }
    if (csat.universities.length === 0) {
      return (
        <div className="wrap pg-body fv">
          <ScoreBasis overall={report.overall} emptyText="" />
          <PastEntrySlot src={src} caller={caller} />
          <ProvisionalPendingGate catalogHref={`${route.path}?view=catalog`} />
        </div>
      );
    }
    const favs = (await myFavorites())?.ids ?? null;
    const known = csat.universities.flatMap((u) => u.fields.flatMap((f) => f.items.map((x) => x.offering)));
    return (
      <>
        <MemberMark kind="recommend" path={viewPath(route.path, sp)} />
        <div className="wrap pg-body fv">
          <ScoreBasis overall={report.overall} emptyText="" />
          <PastEntrySlot src={src} caller={caller} />
          <section className="fv-main fv-refmode" aria-label="유리한 대학">
            <CsatGroups universities={csat.universities} favs={favs} outsideBand={csat.outsideBand} p3Label={p3.label} />
          </section>
        </div>
        <Suspense key={hrefWith(cur, {})} fallback={null}>
          <StreamTray report={report} known={known} src={src} caller={caller} other="PAGE-03" />
        </Suspense>
      </>
    );
  }
  return <ReportBody src={src} caller={caller} sp={sp} cur={cur} report={report} />;
}

/** 9월 기준 보기에서 연 리포트와 고를 수 있는 9월 리포트 목록 */
interface PastView {
  items: OwnReportListDto["items"];
  reportId: string;
  savedAt: string | null;
}

/**
 * 9월 모의평가 기준으로 보기(2026-11-22 대표님 결정). 수능 가채점 전환 뒤에도 9월 리포트를 저장한 회원은
 * 그 리포트로 찾은 3페이지를 읽기 전용으로 본다(2페이지 지난 기록과 같은 방식).
 * - 목록(report.list-own, exam_id=9월)에 있는 리포트만 연다. 가채점 리포트는 그리지 않는다.
 * - 후보 목록은 candidates.build 를 한 번 시도하고(settleCandidates), 거절·실패면 리포트에 저장된 기본 목록으로 그린다.
 * - 담기·빼기·분석 계산은 하지 않는다(지금의 리포트를 바꾸지 않는다). 별표(즐겨찾기)는 리포트와 무관해 그대로 둔다.
 * - 어떤 실패에도 오류 화면·요청 제한 안내 대신 차분한 안내와 돌아가기 링크를 보인다.
 */
async function PastBody({ src, caller, sp }: { src: JungsiSource; caller: Caller; sp: SP }) {
  const cur = parseQuery(sp);
  let list: OwnReportListDto;
  try {
    list = await src.listOwnReports(caller, { exam_id: MOCK_EXAM.exam_id, limit: 20 });
  } catch (e) {
    if (e instanceof AccessDenied) return <PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} />;
    if (!(e instanceof ConnectionError)) logSettleError("p3-past-list", e);
    return <PastUnavailable />;
  }
  const { items, chosen } = choosePastReport(list?.items, MOCK_EXAM.exam_id, cur.report);
  if (!chosen) return <PastUnavailable empty />;
  let report: ReportDto | null;
  try {
    report = await src.readReport(caller, chosen.report_id);
  } catch (e) {
    if (e instanceof AccessDenied) return <PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} />;
    if (!(e instanceof ConnectionError)) logSettleError("p3-past-read", e);
    return <PastUnavailable />;
  }
  if (!report || !report.overall || isProvisionalOverall(report.overall) || provisionalOnly(report)) return <PastUnavailable />;
  // 저장 시각은 후보를 만들기 전에 읽은 값으로 보인다
  const past: PastView = { items, reportId: report.report_id, savedAt: report.updated_at ?? chosen.updated_at ?? null };
  try {
    // 9월 리포트로 candidates.build 를 시도한다. 15분 안에 같은 리포트로 받은 목록이 있으면 다시 만들지 않는다(reuse).
    // 서버가 거절하거나(닫힌 단계 등) 실패하면 settleCandidates 는 받은 리포트를 그대로 돌려준다 — 저장된 기본 목록으로 그린다
    report = await settleCandidates(src, caller, report, { reuse: true });
  } catch (e) {
    logSettleError("p3-past-candidates", e);
  }
  return <ReportBody src={src} caller={caller} sp={sp} cur={{ ...cur, past: true, report: past.reportId }} report={report} past={past} />;
}

async function ReportBody({ src, caller, sp, cur, report, past }: { src: JungsiSource; caller: Caller; sp: SP; cur: Query; report: ReportDto; past?: PastView }) {
  const p3 = page("PAGE-03");
  const strip = past ? <PastStrip past={past} /> : <PastEntrySlot src={src} caller={caller} />;
  const c = report.candidates;
  if (!c && past) return <PastUnavailable strip={strip} />;
  if (!c) {
    return (
      <>
        <div className="wrap pg-body fv">
          <ScoreBasis overall={report.overall} emptyText="" />
          {strip}
          <RunAnalysis
            title="유리한 학교 목록을 아직 만들지 못했습니다"
            desc="화면을 열 때 자동으로 만들었지만 이번에는 끝나지 않았습니다. 누르면 저장한 성적으로 학교 목록과 와일드카드를 다시 만듭니다. 성적을 다시 저장하지 않으며 입력 횟수는 줄지 않습니다."
            label="유리한 학교 찾기"
            busy="찾는 중…"
          />
          <p className="fv-note">성적 없이 대학·학과를 둘러보려면 <Link href={p3.path}>{p3.label}</Link>에서 검색하세요.</p>
        </div>
      </>
    );
  }
  // 모양이 어긋난 행(모집단위·판단이 빠진 행)은 그 행만 빼고 그린다(2026-11-22 운영 사고 방어)
  const groups = (c?.basic_university_groups ?? [])
    .filter((g) => g && typeof g === "object")
    .map((g) => ({ ...g, offerings: (g.offerings ?? []).filter((o) => o?.offering && o?.assessment && typeof o.assessment === "object") }))
    .filter((g) => g.offerings.length > 0)
    .sort((a, b) => (bestDelta(b) ?? -Infinity) - (bestDelta(a) ?? -Infinity));
  const wildcards = (c?.wildcards ?? []).filter((o) => o?.offering && o?.assessment && typeof o.assessment === "object");
  // 참고 목록(reference_university_groups)에 함께 온 행은 서버 후보 묶음에서 '보류'로도 세어진다(정식 판정이 없어서).
  // 참고 목록에서 따로 세므로 보류 숫자에서는 뺀다(2026-11-21 p3_empty: '판단을 보류한 61곳' = 홍익대 1 + 참고 60)
  const refIds = new Set((c?.reference_university_groups ?? []).flatMap((g) => (g.offerings ?? []).map((it) => it?.offering?.offering_id)));
  const pendingCount = (c?.pending_offerings ?? []).filter((p) => !refIds.has(p.offering_id)).length;
  const outsideCount = c?.outside_offerings?.length ?? 0;
  const ineligibleCount = c?.ineligible_offerings?.length ?? 0;
  // 담기 표시는 리포트의 shortlist 로 바로 그린다. 집계(live-statistics)와 담은 학교 이름(offering.read)은 학교 목록을
  // 막지 않게 뒤이어 받는다 — 집계 줄·담은 학교 띠만 각자 채워진다
  const picked = pickedIds(report);
  // 즐겨찾기(별표)는 본체 DB 에서 따로 읽는다. 읽지 못하면 별표를 숨긴다. 여기서 별표하면 가능성 보기에도 그대로 보인다
  const favs = (await myFavorites())?.ids ?? null;
  const stats = statsFor(src, caller, report, cur.open);
  // 필터·펼친 학교가 바뀌는 전환에서 집계 줄·띠가 학교 목록을 붙잡지 않게 조건을 경계의 key 로 준다(3페이지와 같은 이유)
  const qk = hrefWith(cur, {});
  const known = [...(c.basic_university_groups ?? []).flatMap((g) => g.offerings ?? []), ...(c.wildcards ?? [])].map((i) => i?.offering).filter((o): o is NonNullable<typeof o> => Boolean(o));
  const count = (f?: string) => groups.filter((g) => !f || g.offerings.some((o) => o.assessment.category === f)).length;
  const shown = groups.filter((g) => !cur.has || g.offerings.some((o) => o.assessment.category === cur.has));
  // 유료 데이터(유리한 학교 목록)를 그린 화면: 회원 식별 표시 + 조회 기록
  const view = viewPath(route.path, sp);

  // 추천 목록·와일드카드가 하나도 없으면(판정이 켜진 대학이 없는 동안) 참고 누백이 나온 대학을 대학 → 계열 → 학과로
  // 보이고, 와일드카드도 같은 참고 목록에서 고른다. 즐겨찾기만 할 수 있다(대표님 결정 2026-11-19 낮, 같은 날 새벽 결정 대체).
  // 판정이 켜진 뒤의 자동 추천 목록은 상향까지라는 결정은 그대로다.
  // 판정이 켜진 대학이 하나라도 생기면 원래 화면(기본 학교 목록 + 와일드카드)으로 돌아간다
  const referenceMode = groups.length === 0 && wildcards.length === 0;
  let refGroups: ReturnType<typeof referenceGroups> = [];
  let refPool: ReturnType<typeof referencePool> = { items: [], below: 0, noCutoff: 0, ineligible: 0, outsideBand: 0 };
  let refWild: ReturnType<typeof referenceWildcards> = { featured: [], rest: [] };
  let refUniversities: ReturnType<typeof referenceUniversities> = [];
  // 화면을 그린 뒤 계열 펼침 계산이 보낼 리포트 판(와일드카드 계산으로 판이 오르면 그 판)
  let viewVersion = report.report_version;
  // 참고 목록 준비가 예상 밖 자료로 실패해도 화면 전체를 오류로 깨지 않는다. 기록만 남기고 빈 참고 목록(안내)으로 그린다(2026-11-22)
  try {
    refGroups = referenceMode ? referenceGroups(c) : [];
    refPool = referencePool(refGroups, report.overall?.overall, report.analyses);
    refWild = referenceWildcards(refPool);
    // 서버 문턱 판정 행(dep_r15)은 누백 없이 온다. 와일드카드 카드는 누백·유불리를 바로 보이므로, 고른 카드 중 아직 계산하지 않은 곳만
    // (최대 4곳) 그리기 전에 내 성적으로 계산해 정확한 값으로 그린다. 목록의 학과들은 계열을 펼칠 때 계산한다(reference-field.tsx)
    // 9월 기준 보기(읽기 전용)에서는 계산하지 않는다(리포트에 쓰지 않는다). 계산 전 카드는 문턱 판정만으로 그린다
    const wildPending = past ? [] : [...refWild.featured, ...refWild.rest].filter((w) => w.pending).map((w) => w.offering.offering_id);
    if (wildPending.length > 0) {
      const settled = await settleAnalyses(src, caller, report, wildPending);
      viewVersion = Math.max(viewVersion, settled.report_version);
      refPool = referencePool(refGroups, settled.overall?.overall, settled.analyses);
      refWild = referenceWildcards(refPool);
    }
    refUniversities = referenceUniversities(refPool);
  } catch (e) {
    logSettleError("p3-reference", e);
    refGroups = [];
    refPool = { items: [], below: 0, noCutoff: 0, ineligible: 0, outsideBand: 0 };
    refWild = { featured: [], rest: [] };
    refUniversities = [];
  }
  const refWildCount = refWild.featured.length + refWild.rest.length;
  // 9월 기준 보기에서 기본 목록·와일드카드·대학 목록이 모두 비면(후보를 만들지 못했을 때) 차분한 안내로 대신한다
  if (past && referenceMode && refGroups.length === 0) return <PastUnavailable strip={strip} />;
  const tail = (
    <>
      {(outsideCount > 0 || ineligibleCount > 0) && (
        <p className="fv-note">
          판정이 나온 모집단위 중 도전·불가 <b className="num">{outsideCount}</b>곳, 지원 조건 미충족 <b className="num">{ineligibleCount}</b>곳은 목록에 넣지 않았습니다. {p3.label}에서 하나씩 확인할 수 있습니다.
        </p>
      )}
      {pendingCount > 0 && (
        <p className="fv-note">
          판정 자료가 아직 없어 판단을 보류한 모집단위 <b className="num">{pendingCount}</b>곳은 목록에 넣지 않았습니다. 보류를 여유로 보지 않습니다. {p3.label}에서 하나씩 확인할 수 있습니다.
        </p>
      )}
    </>
  );

  return (
    <>
      <MemberMark kind="recommend" path={view} />
      <div className="wrap pg-body fv">
        <ScoreBasis overall={report.overall} emptyText="" />
        {strip}

        {/* '후보 다시 확인' 띠·버튼은 두지 않는다(2026-11-21 대표님 지적: 자료판이 바뀔 때마다 모든 고객에게 떴다).
            옛 자료판 후보는 화면을 열 때 서버가 조용히 다시 확인한다(report-ops settleCandidates) */}

        {/* 좁은 화면에서는 와일드카드가 목록 아래로 내려간다. 있다는 것을 위에서 먼저 알린다 */}
        {(wildcards.length > 0 || refWildCount > 0) && (
          <a className="wd-teaser" href="#wildcard">
            <span className="k">WILD CARD</span>
            <span>
              비장의 한 수 <b className="num">{wildcards.length || refWildCount}장</b>
            </span>
            <span className="go"><ArrowRightIcon /></span>
          </a>
        )}

        {referenceMode ? (
        <div className={refUniversities.length > 0 ? "fv-grid" : undefined}>
          <section className="fv-main fv-refmode" aria-label="유리한 대학">
            {refUniversities.length === 0 ? (
              <section className="gate flat">
                <h2>{c.status === "pending" ? "판정 자료 준비 중" : "현재 상향 범위 이내 추천 후보 없음"}</h2>
                <p>
                  {c.status === "pending"
                    ? "지금은 대학별 판정 자료를 연결하는 중이고, 대학 방식 누적 백분위(추정)가 나온 대학도 아직 없습니다. 지원할 수 있는 대학이 없다는 뜻이 아닙니다. 자료가 연결되면 이 화면을 열 때 최신 자료로 다시 찾습니다."
                    : "판정이 나온 모집단위 가운데 안정·하향·적정·소신·상향에 드는 곳이 없습니다."}{" "}
                  {refGroups.length > 0 && <>대학 방식 누적 백분위(추정)가 나온 학과 중 안정~상향에 들거나 지난해 합격선에 내 위치가 닿는 곳이 없습니다(판정 도전·불가 {refPool.outsideBand}곳, 합격선보다 아래 {refPool.below}곳, 합격선 자료 없음 {refPool.noCutoff}곳).{" "}</>}
                  {p3.label}에서 대학·학과를 직접 검색해 하나씩 확인할 수 있습니다.
                </p>
                <div className="acts">
                  <Link className="btn" href={p3.path}>{p3.label}</Link>
                </div>
              </section>
            ) : (
              <ReferenceGroups universities={refUniversities} favs={favs} below={refPool.below} noCutoff={refPool.noCutoff} ineligible={refPool.ineligible} outsideBand={refPool.outsideBand} p3Label={p3.label} reportId={report.report_id} reportVersion={viewVersion} readOnly={!!past} />
            )}
            {tail}
          </section>
          {refUniversities.length > 0 && (
            <aside className="fv-side" aria-label="와일드카드">
              <ReferenceWildcardDeck featured={refWild.featured} rest={refWild.rest} favs={favs} />
            </aside>
          )}
        </div>
        ) : (
        <div className="fv-grid">
          <section className="fv-main" aria-labelledby="basic-t">
            <div className="fv-sec-hd">
              <h2 id="basic-t">
                기본 학교 목록 <span className="num">{count()}</span>
              </h2>
              <span>이 대학의 점수 계산 방식이 내 과목 구성에 유리한 학교부터 보여 줍니다(환산 유불리 큰 순). 지원가능성 판단은 학과마다 따로 봅니다.</span>
            </div>
            <div className="chips" role="group" aria-label="학과 판단으로 거르기">
              <Link href={hrefWith(cur, { has: undefined, open: undefined })} className={cur.has ? undefined : "on"} aria-current={cur.has ? undefined : "true"} scroll={false}>
                전체 <small className="num">{count()}</small>
              </Link>
              {FILTERS.map((f) => (
                <Link key={f.v} href={hrefWith(cur, { has: f.v, open: undefined })} className={cur.has === f.v ? "on" : undefined} aria-current={cur.has === f.v ? "true" : undefined} scroll={false}>
                  {f.label} <small className="num">{count(f.v)}</small>
                </Link>
              ))}
            </div>

            {/* 상위 analysis_status 가 보류면 후보가 ready·빈 목록이어도 '지원 가능한 대학 없음'·
                '추천 완료'로 말하지 않는다 — 분석 자료가 아직 결속되지 않았다는 보류이지
                결과가 0 이라는 판정이 아니다(담당자 지시 2026-10-11) */}
            {report.analysis_status?.status === "pending" && shown.length === 0 ? (
              <section className="gate flat">
                <h2>대학 분석 자료가 아직 준비되지 않았습니다</h2>
                <p>
                  성적과 총점은 계산됐지만 올해 모집 정보와 대학 분석 자료를 맞춰 보는 중이라 후보를 아직 만들지 않았습니다
                  {report.analysis_status.reason_code ? <> (문의 번호 <code>{report.analysis_status.reason_code}</code>)</> : null}.
                  지원 가능한 대학이 없다는 뜻이 아니며, 자료가 연결되면 이 화면에 후보가 나타납니다.
                </p>
              </section>
            ) : c?.status === "pending" || shown.length === 0 ? (
              <section className="gate flat">
                <h2>{c?.status === "pending" ? "아직 찾은 학교가 없습니다" : "이 조건에 해당하는 학교가 없습니다"}</h2>
                <p>다른 조건을 보거나 {p3.label}에서 직접 검색하세요. 목록에 없다는 것이 지원할 수 없다는 뜻은 아닙니다.</p>
              </section>
            ) : (
              <div className="fv-list">
                {shown.map((g) => (
                  <SchoolCard key={g.university_id} g={g} cur={cur} picked={picked} favs={favs} stats={stats} statsKey={qk} canPick={!past} />
                ))}
              </div>
            )}
            {tail}
            <p className="fv-note">
              환산 유불리는 전체 성적 기준과 견줘 그 대학 계산 방식에서 내 위치가 오르내리는 폭(%p)으로, 비슷한 수준의 학교 중 내 과목 구성에 잘 맞는 곳을 고르는 보조 지표입니다.
              여유 후보도 합격을 보장하지 않습니다. 지원가능성은 합격 확률이 아니며, 올해 전형과 지원 조건을 함께 확인해야 합니다.
            </p>
          </section>

          <aside className="fv-side" aria-label="와일드카드">
            <WildcardDeck picks={wildcards} selection={c?.wildcard_selection} picked={picked} favs={favs} stats={stats} statsKey={qk} canPick={!past} analysisPending={report.analysis_status?.status === "pending"} />
          </aside>
        </div>
        )}
      </div>
      {/* 담은 학교 띠(담기·빼기)는 지금의 리포트용이다. 9월 기준 보기에서는 두지 않는다 */}
      {!past && (
        <Suspense key={qk} fallback={null}>
          <StreamTray report={report} known={known} src={src} caller={caller} other="PAGE-03" />
        </Suspense>
      )}
    </>
  );
}

/** 이 회원에게 9월 모의평가 리포트가 있는가(1개만 읽는다). 어떤 실패에도 false — 링크를 숨기고 오류는 보이지 않는다 */
async function hasPastMockReport(src: JungsiSource, caller: Caller): Promise<boolean> {
  try {
    return hasMockReports(await src.listOwnReports(caller, { exam_id: MOCK_EXAM.exam_id, limit: 1 }), MOCK_EXAM.exam_id);
  } catch {
    return false;
  }
}

/** '9월 모의평가 기준으로 보기' 입구. 수능 가채점 전환 뒤, 9월 리포트를 저장한 회원에게만 보인다. 확인을 기다리는 동안은 아무것도 그리지 않는다 */
function PastEntrySlot({ src, caller }: { src: JungsiSource; caller: Caller }) {
  if (!csatOpen()) return null;
  return (
    <Suspense fallback={null}>
      <PastEntry src={src} caller={caller} />
    </Suspense>
  );
}
async function PastEntry({ src, caller }: { src: JungsiSource; caller: Caller }) {
  if (!(await hasPastMockReport(src, caller))) return null;
  return (
    <p className="fv-past-entry">
      <Link prefetch={false} className="btn" href={pastFavorableHref()}>9월 모의평가 기준으로 보기</Link>
      <span>저장한 9월 모의평가 성적으로 찾은 학교를 읽기 전용으로 봅니다.</span>
    </p>
  );
}

/** 9월 기준 보기의 머리 띠: 어떤 기준인지, 저장 시각, 돌아가기, 9월 리포트가 여럿이면 고르기 */
function PastStrip({ past }: { past: PastView }) {
  return (
    <section className="fv-past" aria-label="9월 모의평가 기준 보기">
      <div className="fv-past-meta">
        <span className="fv-past-tag">9월 모의평가 기준 · 지난 기록 · 읽기 전용</span>
        {past.savedAt && <span><span className="num">{seoulDateTime(past.savedAt)}</span> 저장</span>}
        <Link prefetch={false} className="btn" href={route.path}>수능 가채점 기준으로 돌아가기</Link>
      </div>
      <p className="fv-note">9월 모의평가 때 저장한 성적으로 찾은 학교입니다. 이 화면에서는 학교를 담거나 빼지 않으며 지금의 수능 가채점 리포트는 바뀌지 않습니다. 별표(즐겨찾기)는 그대로 쓸 수 있습니다.</p>
      {past.items.length > 1 && (
        <ul className="fv-past-list" aria-label="저장한 9월 모의평가 리포트">
          {past.items.map((i) => (
            <li key={i.report_id}>
              <span>
                <span className="num">{seoulDateTime(i.updated_at)}</span> 저장
                {i.is_current && <span className="fv-past-cur">마지막 9월 성적</span>}
              </span>
              {i.report_id === past.reportId ? <span className="on">보는 중</span> : <Link prefetch={false} className="btn" href={pastFavorableHref(i.report_id)}>열기</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 9월 기준 목록을 그릴 수 없을 때의 차분한 안내(오류 화면·요청 제한 안내를 보이지 않는다) */
function PastUnavailable({ strip, empty }: { strip?: React.ReactNode; empty?: boolean }) {
  return (
    <div className="wrap pg-body fv">
      {strip}
      <section className="gate flat">
        <h2>{empty ? "저장한 9월 모의평가 리포트가 없습니다" : "9월 기준 추천 목록을 지금 불러올 수 없습니다"}</h2>
        <p>
          {empty
            ? "9월 모의평가 성적을 저장한 적이 없어 9월 기준으로 볼 학교 목록이 없습니다."
            : "잠시 뒤 다시 열어 주세요. 저장한 9월 리포트의 성적과 담아 둔 학교는 내 성적 리포트의 지난 기록에서 볼 수 있습니다."}
        </p>
        <div className="acts">
          <Link prefetch={false} className="btn p" href={route.path}>수능 가채점 기준으로 돌아가기</Link>
          {!empty && <Link prefetch={false} className="btn" href={`${page("PAGE-02").path}?past=1`}>지난 기록 보기</Link>}
        </div>
      </section>
    </div>
  );
}

/** 집계는 모집단위마다 따로 부른다. 펼친 학교와 와일드카드만. 받지 못한 곳은 '집계 준비 중'으로 둔다(목록은 그대로) */
function statsFor(src: JungsiSource, caller: Caller, report: ReportDto, open: string | undefined): StatsPromise {
  const c = report.candidates;
  const openGroup = (c?.basic_university_groups ?? []).find((g) => g.university_id === open);
  const ids = Array.from(new Set([...(openGroup?.offerings ?? []), ...(c?.wildcards ?? [])].map((i) => i?.offering?.offering_id).filter((id): id is string => typeof id === "string")));
  const p = Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await src.readStatistics(caller, report.report_id, id)] as const;
      } catch (e) {
        // 집계는 보조 줄이다. 어떤 오류든 그 줄만 '집계 준비 중'으로 두고 화면은 깨지 않는다(2026-11-22)
        if (!(e instanceof ConnectionError || e instanceof AccessDenied)) logSettleError("p3-stats", e);
        return [id, null] as const;
      }
    }),
  ).then((rows) => new Map<string, StatisticsDto | null>(rows));
  // 필터로 그 줄이 그려지지 않아 아무도 기다리지 않을 때 처리되지 않은 거절로 남지 않게 한다(기다리는 칸에는 그대로 전해진다)
  p.catch(() => {});
  return p;
}
