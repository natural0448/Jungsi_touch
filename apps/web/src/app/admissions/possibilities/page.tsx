import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ChevronIcon } from "@/components/icons";
import { AdvantageCell, CategoryLegend, PickButton, ScoreCell, StatusCell, type Cell } from "@/components/offering-parts";
import { PaidGate } from "@/components/paid-gate";
import { ScoreBasis } from "@/components/score-basis";
import { ShortlistTray } from "@/components/shortlist-tray";
import { PageHead } from "@/components/page-head";
import { AccessDenied, getCaller, source } from "@/lib/api";
import type { CatalogSearchDto, OfferingDto, RecruitmentDto } from "@/lib/dto";
import { REGIONS } from "@/lib/regions";
import { ensureAnalyses, loadMine, pickedItems, type PickedItem, type ReportState } from "@/lib/report-ops";
import { lockFor, page } from "@/lib/routes";
import { Detail } from "./parts";
import { GROUPS, hrefWith, LIMIT, parseQuery, toSearch, type Query } from "./query";
import "./possibilities.css";

const route = page("PAGE-03");
const FEATURES = ["추천에 없는 대학·학과까지 직접 검색", "모집단위마다 내 환산점수 · 지원가능성 · 환산 유불리", "마음에 드는 곳을 핵심 지원 학교에 담아 리포트로 정리"];
export const metadata: Metadata = { title: route.label };

export default async function Page({ searchParams }: PageProps<"/admissions/possibilities">) {
  const head = (
    <PageHead
      kicker={`PAGE ${route.number} · 유료`}
      title={route.label}
      desc="보고 싶은 대학과 학과를 직접 검색하고, 모집단위마다 내 환산점수 · 지원가능성 · 환산 유불리를 따로 확인하세요."
      side={<Link className="btn" href={page("PAGE-04").path}>유리한 대학 찾기로</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const session = await src.getSession(caller);
  // 화면 표시용 잠금. 서버가 검색을 403 으로 막아도 아래 catch 가 같은 안내를 그린다
  const lock = lockFor(session, route);
  if (lock) return <>{head}<PaidGate kind={lock} route={route} features={FEATURES} /></>;

  const cur = parseQuery(await searchParams);
  let res: CatalogSearchDto<OfferingDto>;
  let state: ReportState;
  let rec: RecruitmentDto | null = null;
  let picks: PickedItem[] = [];
  try {
    const [found, mine] = await Promise.all([src.searchOfferings(caller, toSearch(cur)), loadMine(src, caller)]);
    res = found;
    const items = found.items ?? [];
    // 보이는 모집행만 분석한다. 리포트가 없으면(성적 전) 검색과 모집 정보만
    state = mine ? await ensureAnalyses(src, caller, mine, items.map((o) => o.offering_id)) : { kind: "none" };
    const report = state.kind === "none" ? null : state.report;
    const open = items.find((o) => o.offering_id === cur.open);
    [rec, picks] = await Promise.all([open ? src.readRecruitment(caller, open.offering_id) : null, report ? pickedItems(src, caller, report, items) : []]);
  } catch (e) {
    if (e instanceof AccessDenied) return <>{head}<PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} /></>;
    throw e;
  }

  const report = state.kind === "ready" ? state.report : null;
  const an = (id: string): Cell => (report ? report.analyses?.[id] ?? null : "need");
  const picked = new Set(picks.map((p) => p.offering_id));
  const items = res.items ?? [];

  // 같은 대학끼리 묶는다(받은 순서를 지킨다)
  const groups: { id: string; name: string; rows: OfferingDto[] }[] = [];
  for (const o of items) {
    const last = groups[groups.length - 1];
    if (last && last.id === o.university_id) last.rows.push(o);
    else groups.push({ id: o.university_id, name: o.university_name, rows: [o] });
  }
  const filtered = Boolean(cur.university_q || cur.department_q || cur.region || cur.group);

  return (
    <>
      {head}
      <div className="wrap pg-body ps">
        <ScoreBasis
          overall={state.kind === "none" ? null : state.report?.overall ?? null}
          emptyText="검색과 모집 정보는 지금 볼 수 있고, 성적을 넣으면 모집단위마다 내 분석이 붙습니다."
        />
        {state.kind === "score_required" && (
          <p className="ps-warn">성적 확인이 끝나지 않아 모집단위 분석을 붙이지 않았습니다. 내 성적 리포트에서 입력을 확인해 주세요.</p>
        )}

        <section className="filter" aria-label="검색 조건">
          <Form action={route.path} className="search" role="search">
            <label className="field">
              <span>대학명</span>
              <input type="search" name="university" defaultValue={cur.university_q} placeholder="예: 가온, 해솔" maxLength={40} />
            </label>
            <label className="field">
              <span>학과명</span>
              <input type="search" name="unit" defaultValue={cur.department_q} placeholder="예: 경영, 간호" maxLength={40} />
            </label>
            {cur.region && <input type="hidden" name="region" value={cur.region} />}
            {cur.group && <input type="hidden" name="group" value={cur.group} />}
            <button className="btn p" type="submit">검색</button>
          </Form>
          <ChipRow label="지역" cur={cur} k="region" items={REGIONS.map((r) => ({ v: r, label: r }))} />
          <ChipRow label="모집군" cur={cur} k="group" items={GROUPS.map((g) => ({ v: g, label: `${g}군` }))} />
          <p className="hint">대학명만 넣으면 그 대학의 학과를, 학과명만 넣으면 그 학과가 있는 대학을 찾습니다. 추천 여부나 지원가능성 때문에 검색에서 빠지는 모집단위는 없습니다.</p>
        </section>

        {res.status === "pending" ? (
          <section className="gate flat">
            <h2>2027 모집단위 목록을 준비하고 있습니다</h2>
            <p>검증된 카탈로그가 발행되면 여기서 검색할 수 있습니다. 지난 입시결과는 {page("PAGE-01").label}에서 먼저 볼 수 있습니다.</p>
          </section>
        ) : (
          <>
            <div className="count">
              <span>
                <b className="num">{res.matching_school_count ?? 0}</b>개 대학 · <b className="num">{res.matching_offering_count ?? 0}</b>개 모집단위
                {res.as_of && <small> · {res.as_of.replaceAll("-", ".")} 기준</small>}
              </span>
              {report && <CategoryLegend />}
            </div>

            {groups.length === 0 ? (
              <section className="gate flat">
                <h2>조건에 맞는 모집단위가 없습니다</h2>
                <p>검색어를 줄이거나 지역·모집군을 전체로 바꿔 보세요. 결과가 없다는 것은 지원할 수 없다는 뜻이 아닙니다.</p>
                {filtered && <div className="acts"><Link className="btn" href={route.path}>조건 지우기</Link></div>}
              </section>
            ) : (
              <div className="list">
                {groups.map((g) => (
                  <section key={`${g.id}-${g.rows[0].offering_id}`} className="univ" aria-label={g.name}>
                    <header>
                      <h2>{g.name}</h2>
                      <span className="meta">{[g.rows[0].region, g.rows[0].campus].filter(Boolean).join(" · ")}</span>
                    </header>
                    <div className="thead" aria-hidden="true">
                      <span>학과 · 전형</span>
                      <span>군</span>
                      <span className="r">내 환산점수</span>
                      <span>지원가능성</span>
                      <span className="r">환산 유불리</span>
                      <span />
                      <span />
                    </div>
                    <ul>
                      {g.rows.map((o) => {
                        const a = an(o.offering_id);
                        const open = cur.open === o.offering_id;
                        const on = picked.has(o.offering_id);
                        const toggle = `${hrefWith(cur, { open: open ? undefined : o.offering_id })}#${o.offering_id}`;
                        return (
                          <li key={o.offering_id} id={o.offering_id} className={`item${open ? " open" : ""}`}>
                            <div className="row">
                              <Link className="unit" href={toggle} scroll={false} aria-expanded={open}>
                                <b>{o.department}</b>
                                <small>{o.track ?? "일반전형"}</small>
                              </Link>
                              <span className="c-grp"><span className="grp">{o.group}</span></span>
                              <span className="c-score r"><ScoreCell a={a} /></span>
                              <span className="c-st"><StatusCell a={a} /></span>
                              <span className="c-adv r"><AdvantageCell a={a} /></span>
                              <span className="c-pick">{report && <PickButton id={o.offering_id} on={on} />}</span>
                              <Link className="c-chev" href={toggle} scroll={false} aria-label={open ? "접기" : "자세히"}>
                                <ChevronIcon />
                              </Link>
                              <span className="mmeta">
                                <span className="grp">{o.group}</span>
                                <span>{o.group}군</span>
                              </span>
                            </div>
                            {open && (
                              <div className="detail">
                                <Detail o={o} a={a} rec={rec} picked={on} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {(cur.cursor || res.next_cursor) && (
              <nav className="pager" aria-label="쪽 넘기기">
                {cur.cursor ? <Link className="btn" href={hrefWith(cur, { cursor: undefined, open: undefined })}>처음부터</Link> : <span />}
                {res.next_cursor && <Link className="btn" href={hrefWith(cur, { cursor: res.next_cursor, open: undefined })}>다음 {LIMIT}개</Link>}
              </nav>
            )}
          </>
        )}
      </div>

      {report && <ShortlistTray items={picks} other="PAGE-04" />}
    </>
  );
}

function ChipRow({ label, cur, k, items }: { label: string; cur: Query; k: "region" | "group"; items: { v: string; label: string }[] }) {
  const on = cur[k];
  return (
    <div className="cfilter">
      <span className="lab">{label}</span>
      <div className="chips">
        <Link href={hrefWith(cur, { [k]: undefined, open: undefined })} className={on ? undefined : "on"} aria-current={on ? undefined : "true"} scroll={false}>
          전체
        </Link>
        {items.map((i) => (
          <Link key={i.v} href={hrefWith(cur, { [k]: i.v, open: undefined })} className={on === i.v ? "on" : undefined} aria-current={on === i.v ? "true" : undefined} scroll={false}>
            {i.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
