import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { MemberMark } from "@/components/member-mark";
import { PaidGate } from "@/components/paid-gate";
import { ScoreBasis } from "@/components/score-basis";
import { ShortlistTray } from "@/components/shortlist-tray";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import type { StatisticsDto } from "@/lib/dto";
import { ensureCandidates, loadMine, pickedItems, type PickedItem, type ReportState } from "@/lib/report-ops";
import { viewPath } from "@/lib/content-view";
import { lockFor, page } from "@/lib/routes";
import { FILTERS, hrefWith, parseQuery } from "./query";
import { bestDelta, SchoolCard } from "./school-card";
import { WildcardDeck } from "./wildcard";
import "./favorable.css";

const route = page("PAGE-04");
export const metadata: Metadata = { title: route.label };
const FEATURES = ["내 성적으로 지원 검토 범위(도전·핵심·여유)에 드는 학교 찾기", "학교를 펼쳐 학과 · 전형 · 모집군마다 지원가능성 확인", "간호 · 보건 · 교육 와일드카드 — 비장의 한 수", "마음에 드는 곳을 핵심 지원 학교에 담아 리포트로 정리"];

export default async function Page({ searchParams }: PageProps<"/admissions/favorable">) {
  const p3 = page("PAGE-03");
  const head = (
    <PageHead
      kicker={`PAGE ${route.number} · 유료`}
      title={route.label}
      desc="전체 성적에서 출발해 환산에 유리한 학교를 찾고, 학교 안에서 학과마다 지원 범위를 따로 확인하세요."
      side={<Link className="btn" href={p3.path}>대학·학과 직접 검색</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  const lock = lockFor(session, route);
  if (lock) return <>{head}<PaidGate kind={lock} route={route} features={FEATURES} /></>;

  const cur = parseQuery(await searchParams);
  let state: ReportState;
  let picks: PickedItem[] = [];
  let stats = new Map<string, StatisticsDto | null>();
  try {
    const mine = await loadMine(src, caller);
    state = mine ? await ensureCandidates(src, caller, mine) : { kind: "none" };
    if (state.kind === "ready") {
      const report = state.report;
      const c = report.candidates;
      // 집계는 모집단위마다 따로 부른다. 펼친 학교와 와일드카드만
      const openGroup = c?.basic_university_groups.find((g) => g.university_id === cur.open);
      const ids = Array.from(new Set([...(openGroup?.offerings ?? []), ...(c?.wildcards ?? [])].map((i) => i.offering.offering_id)));
      const known = c ? [...c.basic_university_groups.flatMap((g) => g.offerings), ...c.wildcards].map((i) => i.offering) : [];
      const [p, s] = await Promise.all([pickedItems(src, caller, report, known), Promise.all(ids.map(async (id) => [id, await src.readStatistics(caller, report.report_id, id)] as const))]);
      picks = p;
      stats = new Map(s);
    }
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} /></>;
    throw e;
  }

  if (state.kind !== "ready") {
    return (
      <>
        {head}
        <div className="wrap pg-body fv">
          <ScoreBasis overall={state.kind === "score_required" ? state.report?.overall ?? null : null} emptyText="유리한 대학 찾기는 확인된 성적으로 계산합니다. 성적을 넣으면 학교 목록과 와일드카드가 나옵니다." />
          <section className="gate flat">
            <h2>{state.kind === "score_required" ? "성적 확인이 끝나면 유리한 학교를 찾아 드립니다" : "성적을 넣으면 유리한 학교를 찾아 드립니다"}</h2>
            <p>성적 없이 대학·학과를 둘러보려면 {p3.label}에서 검색하세요. 모집 정보는 성적 없이도 볼 수 있습니다.</p>
            <div className="acts">
              <Link className="btn p" href={page("PAGE-02").path}>{state.kind === "score_required" ? "성적 확인하기" : "성적 입력하기"}</Link>
              <Link className="btn" href={p3.path}>{p3.label}</Link>
            </div>
          </section>
        </div>
      </>
    );
  }

  const report = state.report;
  const c = report.candidates;
  const groups = [...(c?.basic_university_groups ?? [])].sort((a, b) => (bestDelta(b) ?? -Infinity) - (bestDelta(a) ?? -Infinity));
  const wildcards = c?.wildcards ?? [];
  const pendingCount = c?.pending_offerings.length ?? 0;
  const outsideCount = c?.outside_offerings?.length ?? 0;
  const ineligibleCount = c?.ineligible_offerings?.length ?? 0;
  const picked = new Set(picks.map((p) => p.offering_id));
  const count = (f?: string) => groups.filter((g) => !f || g.offerings.some((o) => o.assessment.category === f)).length;
  const shown = groups.filter((g) => !cur.has || g.offerings.some((o) => o.assessment.category === cur.has));
  // 유료 데이터(유리한 학교 목록)를 그린 화면: 회원 식별 표시 + 조회 기록
  const view = viewPath(route.path, await searchParams);

  return (
    <>
      {head}
      <MemberMark kind="recommend" path={view} />
      <div className="wrap pg-body fv">
        <ScoreBasis overall={report.overall} emptyText="" />

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
                  성적과 총점은 계산됐지만 올해 모집행·대학 분석 자료가 결속되기 전이라 후보 산출을 보류한 상태입니다
                  {report.analysis_status.reason_code ? <> (보류 코드 <code>{report.analysis_status.reason_code}</code>)</> : null}.
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
                  <SchoolCard key={g.university_id} g={g} cur={cur} picked={picked} stats={stats} />
                ))}
              </div>
            )}
            {(outsideCount > 0 || ineligibleCount > 0) && (
              <p className="fv-note">
                판단이 끝난 모집단위 중 추천 범위 밖 <b className="num">{outsideCount}</b>곳, 지원 조건 미충족 <b className="num">{ineligibleCount}</b>곳은 목록에 넣지 않았습니다. {p3.label}에서 하나씩 확인할 수 있습니다.
              </p>
            )}
            {pendingCount > 0 && (
              <p className="fv-note">
                자격 확인이나 자료 검수 때문에 판단을 보류한 모집단위 <b className="num">{pendingCount}</b>곳은 목록에 넣지 않았습니다. 보류를 여유로 보지 않습니다. {p3.label}에서 하나씩 확인할 수 있습니다.
              </p>
            )}
            <p className="fv-note">
              환산 유불리는 전체 성적 기준과 견줘 그 대학 계산 방식에서 내 위치가 오르내리는 폭(%p)으로, 비슷한 수준의 학교 중 내 과목 구성에 잘 맞는 곳을 고르는 보조 지표입니다.
              여유 후보도 합격을 보장하지 않습니다. 지원가능성은 합격 확률이 아니며, 올해 전형과 지원 조건을 함께 확인해야 합니다.
            </p>
          </section>

          <aside className="fv-side" aria-label="와일드카드">
            <WildcardDeck picks={wildcards} picked={picked} stats={stats} canPick analysisPending={report.analysis_status?.status === "pending"} />
          </aside>
        </div>
      </div>
      <ShortlistTray items={picks} other="PAGE-03" />
    </>
  );
}
