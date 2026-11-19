import { myFavorites } from "@/lib/favorites";
import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
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
import { loadMineEager, pickedIds, type ReportState } from "@/lib/report-ops";
import { RunAnalysis } from "@/components/run-analysis";
import type { StatsPromise } from "@/components/stats-slot";
import { viewPath } from "@/lib/content-view";
import { lockFor, page } from "@/lib/routes";
import { FILTERS, hrefWith, parseQuery } from "./query";
import { bestDelta, SchoolCard } from "./school-card";
import { WildcardDeck } from "./wildcard";
import { CatalogBrowse } from "../possibilities/catalog-browse";
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
      <Suspense fallback={<BookLoading name={name} kind={catalogView ? "possibilities" : "favorable"} />}>
        {catalogView ? <CatalogBrowse src={src} caller={caller} sp={sp} route={route} features={FEATURES} catalogView /> : <Body src={src} caller={caller} sp={sp} />}
      </Suspense>
    </>
  );
}

async function Body({ src, caller, sp }: { src: JungsiSource; caller: Caller; sp: Awaited<PageProps<"/admissions/favorable">["searchParams"]> }) {
  const p3 = page("PAGE-03");
  const cur = parseQuery(sp);
  let state: ReportState;
  try {
    // 입력 상태와 지난번 현재 리포트를 동시에 읽는다(2026-11-10 임시 단축, report-ops 참고)
    const mine = await loadMineEager(src, caller);
    // 저장된 후보만 읽는다. 후보가 아직 없으면 회원이 버튼을 눌러야 만든다(담당자 회신 2026-10-25)
    state = mine ? { kind: "ready", report: mine } : { kind: "none" };
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} />;
    if (e instanceof AccessDenied) return <PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} />;
    throw e;
  }

  if (state.kind !== "ready") {
    return (
      <>
        <div className="wrap pg-body fv">
          <ScoreBasis overall={null} emptyText="유리한 대학 찾기는 확인된 성적으로 계산합니다. 성적을 넣으면 학교 목록과 와일드카드가 나옵니다." />
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
  const c = report.candidates;
  if (!c) {
    return (
      <>
        <div className="wrap pg-body fv">
          <ScoreBasis overall={report.overall} emptyText="" />
          <RunAnalysis
            title="이 성적으로 아직 유리한 학교를 찾지 않았습니다"
            desc="누르면 저장한 성적으로 학교 목록과 와일드카드를 한 번 만듭니다. 만든 목록은 다시 열어도 그대로 보입니다. 성적을 다시 저장하지 않으며 입력 횟수는 줄지 않습니다."
            label="유리한 학교 찾기"
            busy="찾는 중…"
          />
          <p className="fv-note">성적 없이 대학·학과를 둘러보려면 <Link href={p3.path}>{p3.label}</Link>에서 검색하세요.</p>
        </div>
      </>
    );
  }
  const groups = [...(c?.basic_university_groups ?? [])].sort((a, b) => (bestDelta(b) ?? -Infinity) - (bestDelta(a) ?? -Infinity));
  const wildcards = c?.wildcards ?? [];
  const pendingCount = c?.pending_offerings.length ?? 0;
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
  const known = [...c.basic_university_groups.flatMap((g) => g.offerings), ...c.wildcards].map((i) => i.offering);
  const count = (f?: string) => groups.filter((g) => !f || g.offerings.some((o) => o.assessment.category === f)).length;
  const shown = groups.filter((g) => !cur.has || g.offerings.some((o) => o.assessment.category === cur.has));
  // 유료 데이터(유리한 학교 목록)를 그린 화면: 회원 식별 표시 + 조회 기록
  const view = viewPath(route.path, sp);

  // 추천 목록·와일드카드가 하나도 없으면 빈 목록 틀 대신 안내를 보인다. 제외된 모집단위를 참고 누백 묶음이나
  // 환산만 끝난 목록으로 다시 채우지 않는다(대표님 결정 2026-11-19: 3페이지 자동 목록은 상향까지).
  // 판정이 켜진 대학이 하나라도 생기면 원래 화면(기본 학교 목록 + 와일드카드)으로 돌아간다
  const referenceMode = groups.length === 0 && wildcards.length === 0;
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

        <RunAnalysis
          refresh={{ id: crypto.randomUUID(), reportId: report.report_id, profileId: report.profile_id, reportVersion: report.report_version }}
          title="저장된 후보를 현재 자료로 다시 확인합니다"
          desc="저장한 성적을 그대로 사용해 후보를 최신 자료로 다시 확인합니다. 결과가 바뀔 수 있으며 성적 입력 횟수는 줄지 않습니다."
          label="후보 다시 확인"
          busy="다시 확인하는 중…"
          auto={report.candidates_stale === true}
        />

        {/* 좁은 화면에서는 와일드카드가 목록 아래로 내려간다. 있다는 것을 위에서 먼저 알린다 */}
        {wildcards.length > 0 && (
          <a className="wd-teaser" href="#wildcard">
            <span className="k">WILD CARD</span>
            <span>
              비장의 한 수 <b className="num">{wildcards.length}장</b>
            </span>
            <span className="go"><ArrowRightIcon /></span>
          </a>
        )}

        {referenceMode ? (
          <section className="fv-main fv-refmode" aria-labelledby="refmode-t">
            <section className="gate flat">
              {c.status === "pending" ? (
                <>
                  <h2 id="refmode-t">판정 자료 준비 중</h2>
                  <p>
                    지금은 대학별 판정 자료를 연결하는 중이라 추천 학교 목록을 아직 만들지 않았습니다. 지원할 수 있는 대학이 없다는 뜻이 아닙니다.
                    판정은 준비되는 대학부터 차례로 켜지고, 켜지면 이 화면에 안정·하향·적정·소신·상향으로 판정된 대학과 학과가 나타납니다.
                    그동안은 {p3.label}에서 대학·학과를 직접 검색해 환산점수와 내 위치를 확인할 수 있습니다.
                  </p>
                </>
              ) : (
                <>
                  <h2 id="refmode-t">현재 상향 범위 이내 추천 후보 없음</h2>
                  <p>
                    판정이 나온 모집단위 가운데 안정·하향·적정·소신·상향에 드는 곳이 없습니다. 도전·불가로 나온 곳과 그 밖의 모집단위는 {p3.label}에서
                    직접 검색해 하나씩 확인할 수 있습니다.
                  </p>
                </>
              )}
              <div className="acts">
                <Link className="btn" href={p3.path}>{p3.label}</Link>
              </div>
            </section>
            {tail}
          </section>
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
                  <SchoolCard key={g.university_id} g={g} cur={cur} picked={picked} favs={favs} stats={stats} statsKey={qk} />
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
            <WildcardDeck picks={wildcards} selection={c?.wildcard_selection} picked={picked} favs={favs} stats={stats} statsKey={qk} canPick analysisPending={report.analysis_status?.status === "pending"} />
          </aside>
        </div>
        )}
      </div>
      <Suspense key={qk} fallback={null}>
        <StreamTray report={report} known={known} src={src} caller={caller} other="PAGE-03" />
      </Suspense>
    </>
  );
}

/** 집계는 모집단위마다 따로 부른다. 펼친 학교와 와일드카드만. 받지 못한 곳은 '집계 준비 중'으로 둔다(목록은 그대로) */
function statsFor(src: JungsiSource, caller: Caller, report: ReportDto, open: string | undefined): StatsPromise {
  const c = report.candidates;
  const openGroup = c?.basic_university_groups.find((g) => g.university_id === open);
  const ids = Array.from(new Set([...(openGroup?.offerings ?? []), ...(c?.wildcards ?? [])].map((i) => i.offering.offering_id)));
  const p = Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await src.readStatistics(caller, report.report_id, id)] as const;
      } catch (e) {
        if (e instanceof ConnectionError || e instanceof AccessDenied) return [id, null] as const;
        throw e;
      }
    }),
  ).then((rows) => new Map<string, StatisticsDto | null>(rows));
  // 필터로 그 줄이 그려지지 않아 아무도 기다리지 않을 때 처리되지 않은 거절로 남지 않게 한다(기다리는 칸에는 그대로 전해진다)
  p.catch(() => {});
  return p;
}
