import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { PaidGate } from "@/components/paid-gate";
import { ScoreBasis } from "@/components/score-basis";
import { ShortlistTray } from "@/components/shortlist-tray";
import { AccessDenied, getCaller, source } from "@/lib/api";
import type { CandidatesResult, OfferingStatistics, ShortlistItem } from "@/lib/contract";
import { lockFor, page } from "@/lib/routes";
import { BUCKETS, hrefWith, parseQuery } from "./query";
import { SchoolCard } from "./school-card";
import { WildcardDeck } from "./wildcard";
import "./favorable.css";

const route = page("PAGE-04");
export const metadata: Metadata = { title: route.label };
const FEATURES = ["도전학교 · 핵심학교 · 여유 후보에서 내 성적에 유리한 학교 찾기", "학교를 펼쳐 학과 · 전형 · 모집군마다 지원 검토 범위 확인", "간호 · 보건 · 교육 와일드카드 — 비장의 한 수", "마음에 드는 곳을 핵심 지원 학교에 담아 리포트로 정리"];

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
  const session = await src.getSession(caller);
  const lock = lockFor(session, route);
  if (lock) return <>{head}<PaidGate kind={lock} route={route} features={FEATURES} /></>;

  const cur = parseQuery(await searchParams);
  let result: CandidatesResult;
  let shortlist: ShortlistItem[];
  try {
    [result, shortlist] = await Promise.all([src.buildCandidates(caller), src.listShortlist(caller)]);
  } catch (e) {
    if (e instanceof AccessDenied) return <>{head}<PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} /></>;
    throw e;
  }

  if (result.state === "score_required") {
    return (
      <>
        {head}
        <div className="wrap pg-body fv">
          <ScoreBasis basis={null} emptyText="유리한 대학 찾기는 확인된 성적으로 계산합니다. 성적을 넣으면 학교 목록과 와일드카드가 나옵니다." />
          <section className="gate flat">
            <h2>성적을 넣으면 유리한 학교를 찾아 드립니다</h2>
            <p>성적 없이 대학·학과를 둘러보려면 {p3.label}에서 검색하세요. 모집 정보와 담기는 성적 없이도 됩니다.</p>
            <div className="acts">
              <Link className="btn p" href={page("PAGE-02").path}>성적 입력하기</Link>
              <Link className="btn" href={p3.path}>{p3.label}</Link>
            </div>
          </section>
        </div>
        <ShortlistTray items={shortlist} other="PAGE-03" />
      </>
    );
  }

  const ids = [...result.schools.flatMap((s) => s.offerings.map((o) => o.offering.offering_id)), ...result.wildcards.map((w) => w.offering.offering_id)];
  const stats = new Map<string, OfferingStatistics>((await src.getStatistics(caller, Array.from(new Set(ids)))).map((s) => [s.offering_id, s]));
  const picked = new Set(shortlist.map((s) => s.offering_id));
  const count = (b?: string) => result.schools.filter((s) => !b || s.bucket === b).length;
  const shown = BUCKETS.filter((b) => !cur.bucket || b.v === cur.bucket)
    .map((b) => ({ ...b, schools: result.schools.filter((s) => s.bucket === b.v) }))
    .filter((g) => g.schools.length > 0);

  return (
    <>
      {head}
      <div className="wrap pg-body fv">
        <ScoreBasis basis={result.basis} emptyText="" />

        {/* 좁은 화면에서는 와일드카드가 목록 아래로 내려간다. 있다는 것을 위에서 먼저 알린다 */}
        {result.wildcards.length > 0 && (
          <a className="wd-teaser" href="#wildcard">
            <span className="k">WILD CARD</span>
            <span>
              비장의 한 수 <b className="num">{result.wildcards.length}장</b>
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
              <span>학교 분류는 전체 성적 1차 선별입니다. 학과마다 판단은 따로 봅니다.</span>
            </div>
            <div className="chips" role="group" aria-label="학교 분류">
              <Link href={hrefWith(cur, { bucket: undefined, open: undefined })} className={cur.bucket ? undefined : "on"} aria-current={cur.bucket ? undefined : "true"} scroll={false}>
                전체 <small className="num">{count()}</small>
              </Link>
              {BUCKETS.map((b) => (
                <Link key={b.v} href={hrefWith(cur, { bucket: b.v, open: undefined })} className={cur.bucket === b.v ? "on" : undefined} aria-current={cur.bucket === b.v ? "true" : undefined} scroll={false}>
                  {b.label} <small className="num">{count(b.v)}</small>
                </Link>
              ))}
            </div>

            {shown.length === 0 ? (
              <section className="gate flat">
                <h2>이 분류에 해당하는 학교가 없습니다</h2>
                <p>다른 분류를 보거나 {p3.label}에서 직접 검색하세요. 목록에 없다는 것이 지원할 수 없다는 뜻은 아닙니다.</p>
              </section>
            ) : (
              shown.map((g) => (
                <div key={g.v} className="fv-group">
                  <h3 className="fv-ghd">
                    {g.label} <span className="num">{g.schools.length}</span>
                  </h3>
                  <div className="fv-list">
                    {g.schools.map((s) => (
                      <SchoolCard key={s.university.university_id} s={s} cur={cur} picked={picked} stats={stats} />
                    ))}
                  </div>
                </div>
              ))
            )}
            <p className="fv-note">여유 후보도 합격을 보장하지 않습니다. 지원가능성은 합격 확률이 아니며, 올해 전형과 지원 조건을 함께 확인해야 합니다.</p>
          </section>

          <aside className="fv-side" aria-label="와일드카드">
            <WildcardDeck picks={result.wildcards} picked={picked} stats={stats} />
          </aside>
        </div>
      </div>
      <ShortlistTray items={shortlist} other="PAGE-03" />
    </>
  );
}
