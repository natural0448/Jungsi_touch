import { StarButton } from "@/components/star-button";
import { FAVORITE_LIMIT, myFavorites, type Favorites } from "@/lib/favorites";
import { FieldTag } from "@/components/field-tag";
import { ConnectionNotice } from "@/components/connection-notice";
import Form from "next/form";
import Link from "@/components/link";
import { MemberMark } from "@/components/member-mark";
import { PaidGate } from "@/components/paid-gate";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";
import type { CatalogSearchDto, OfferingDto, ReportDto } from "@/lib/dto";
import { SCAN_EMPTY_HOPS, SCAN_PAGES, STATUS_KEYS, STATUS_LABEL, statusKeyOf, toggleStatus, type StatusKey } from "@/lib/status-filter";
import { Suspense } from "react";
import { asOfDate } from "@/lib/format";
import { REGIONS } from "@/lib/regions";
import { provisionalOnly, settleAnalyses, startMine } from "@/lib/report-ops";
import { ProvisionalPendingNote } from "@/components/provisional-pending";
import { viewPath } from "@/lib/content-view";
import { page, type PageRoute } from "@/lib/routes";
import { ItemShell } from "./item-shell";
import { MineBasis, MineCells, MineConds, MineDetail, MineLegend, MineTray, cellOf } from "./mine-parts";
import { GROUPS, hrefWith, LIMIT, parseQuery, skipEmptyPages, toSearch, type CatalogDestination, type Query, YEAR } from "./query";
import "./possibilities.css";

export async function CatalogBrowse({ src, caller, sp, route, features, catalogView = false }: {
  src: JungsiSource;
  caller: Caller;
  sp: Parameters<typeof parseQuery>[0];
  route: PageRoute;
  features: string[];
  catalogView?: boolean;
}) {
  const cur = parseQuery(sp);
  const destination: CatalogDestination = { path: route.path, catalogView };
  const link = (patch: Partial<Query>) => hrefWith(cur, patch, destination);
  // 검색과 내 리포트를 함께 보내고, 보이는 모집단위의 분석까지 끝낸 뒤 목록을 한 번에 그린다
  // (2026-11-21 대표님 지적: '아직 내 성적으로 분석하지 않았습니다' 띠·'분석 대기'·'불러오는 중' 칸이 고객에게 보이면 안 된다).
  // 그동안은 page.tsx 의 Suspense 가 책 넘김 대기 화면을 보인다. 화면을 열 때·다음 30개·검색 때 모두 같다.
  // 분석이 없는 곳만 계산하고(이미 분석한 곳은 다시 계산하지 않음), 옛 자료판 분석은 다시 확인한 뒤 보인다(report-ops settleAnalyses).
  // 펼친 모집행의 2027 모집 정보·발행 기준은 화면에서 펼친 뒤 따로 받는다(item-shell.tsx · extras-actions.ts)
  // 리포트 번호 힌트가 있으면 리포트 읽기를 검색과 함께 먼저 보내고, 입력 상태는 검색 뒤에 보낸다(동시 2건 유지, 2026-11-18)
  // 즐겨찾기(별표)는 본체 DB 에서 따로 읽는다(서비스 API 와 별개). '즐겨찾기만 보기'에서는 검색 대신 별표한 모집단위를 보인다
  const favoring = myFavorites();
  // 서버는 한 번에 훑는 범위가 정해져 있어, 조건에 맞는 행이 뒤쪽에 있으면 빈 쪽과 다음 커서만 준다(예: 지역=제주).
  // 빈 쪽을 '결과 없음'으로 보이지 않도록 다음 커서를 몇 번까지 대신 따라간다(2026-11-19 운영 확인)
  const searching = cur.fav ? favoring.then((f) => favoriteResult(f, cur)) : skipEmptyPages(src, caller, toSearch(cur));
  searching.catch(() => {}); // 아래 try 가 같은 약속을 기다려 처리한다
  const mine = startMine(src, caller, searching);
  let res: CatalogSearchDto<OfferingDto>;
  try {
    res = await searching;
  } catch (e) {
    if (e instanceof ConnectionError) return <ConnectionNotice e={e} />;
    if (e instanceof AccessDenied) return <PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={features} />;
    // 커서가 만료되거나 자료판이 바뀌면 같은 검색 조건으로 처음부터 이어간다.
    if (e instanceof Error && e.message.includes("invalid_cursor")) {
      return (
        <>

          <div className="wrap pg-body ps">
            <section className="gate flat">
              <h2>다음 목록을 여는 시간이 지났습니다</h2>
              <p>검색 결과의 다음 쪽은 잠시 동안만 열 수 있습니다. 같은 조건으로 처음부터 다시 보여 드립니다.</p>
              <div className="acts"><Link className="btn p" href={link({ cursor: undefined, open: undefined })}>처음부터 다시 보기</Link></div>
            </section>
          </div>
        </>
      );
    }
    throw e;
  }

  const items = res.items ?? [];
  const favs = await favoring; // 읽지 못하면 null — 별표를 숨긴다
  // 내 리포트를 기다린다. 받지 못하면 '확인 못 함' 칸을 30줄 그리지 않고 화면 안내 하나로 바꾼다
  const m = await mine;
  if (!m.ok) {
    if ("fatal" in m) throw m.fatal;
    if (m.error instanceof ConnectionError) return <ConnectionNotice e={m.error} reopenUnavailable />;
    return <PaidGate kind={m.error.status === 401 ? "login" : "paid"} route={route} features={features} />;
  }
  // 보이는 모집단위의 분석을 채우고 옛 자료판 분석은 다시 확인한다. 끝난 뒤에 한 번에 그린다
  let report = m.report ? await settleAnalyses(src, caller, m.report, items.map((o) => o.offering_id)) : null;
  // 지원가능성 필터(2026-11-22): 고른 단계만 모은다. 성적이 없으면(리포트 없음) 필터를 쓰지 않는다
  let shown = items;
  let nextCursor = res.next_cursor;
  let scanned: number | null = null;
  // 수능 가채점 리포트(2026-11-23 전환): 학교별 판정이 아직 없어 분석 요청·지원가능성 필터를 쓰지 않는다(검색·모집 정보는 그대로)
  const provisional = provisionalOnly(report);
  if (cur.st && report && !provisional) {
    const want = new Set<StatusKey>(cur.st);
    const hit = (r: ReportDto, o: OfferingDto) => want.has(statusKeyOf(r.analyses?.[o.offering_id] ?? null, r.overall?.overall));
    if (cur.fav) {
      const r = report;
      shown = items.filter((o) => hit(r, o));
      scanned = items.length;
    } else {
      const c = await collectByStatus(src, caller, cur, res, report, hit);
      report = c.report;
      shown = c.items;
      nextCursor = c.next;
      scanned = c.scanned;
    }
  }

  // 같은 대학끼리 묶는다(받은 순서를 지킨다)
  const groups: { id: string; name: string; rows: OfferingDto[] }[] = [];
  for (const o of shown) {
    const last = groups[groups.length - 1];
    if (last && last.id === o.university_id) last.rows.push(o);
    else groups.push({ id: o.university_id, name: o.university_name, rows: [o] });
  }
  // 즐겨찾기만 보기도 조건이다 — 0건을 '올해 모집 정보 미연결'로 안내하지 않는다
  const filtered = Boolean(cur.university_q || cur.department_q || cur.region || cur.group || cur.fav || cur.st);
  const star = (o: OfferingDto) => <span className="c-star">{favs && <StarButton id={o.offering_id} on={favs.ids.has(o.offering_id)} name={`${o.university_name} ${o.department}`} />}</span>;
  // 유료 데이터를 그린 화면: 회원 식별 표시 + 조회 기록. 모집단위를 펼쳤으면 대학 분석, 아니면 가능성 목록
  const view = viewPath(route.path, sp);

  return (
    <>

      <MemberMark kind={cur.open ? "analysis" : "possibility"} path={view} />
      <div className="wrap pg-body ps">
        <MineBasis report={report} />
        {provisional && <ProvisionalPendingNote />}

        <section className="filter" aria-label="검색 조건">
          <Form action={route.path} prefetch={false} className="search" role="search">
            <label className="field">
              <span>대학명</span>
              <input type="search" name="university" defaultValue={cur.university_q} placeholder="예: 강원대, 홍익대" maxLength={40} />
            </label>
            <label className="field">
              <span>학과명</span>
              <input type="search" name="unit" defaultValue={cur.department_q} placeholder="예: 경영, 간호" maxLength={40} />
            </label>
            {catalogView && <input type="hidden" name="view" value="catalog" />}
            {cur.fav && <input type="hidden" name="fav" value="1" />}
            {cur.region && <input type="hidden" name="region" value={cur.region} />}
            {cur.group && <input type="hidden" name="group" value={cur.group} />}
            {cur.st && <input type="hidden" name="st" value={cur.st.join(",")} />}
            <button className="btn p" type="submit">검색</button>
          </Form>
          <ChipRow label="지역" cur={cur} destination={destination} k="region" items={REGIONS.map((r) => ({ v: r, label: r }))} />
          <ChipRow label="모집군" cur={cur} destination={destination} k="group" items={GROUPS.map((g) => ({ v: g, label: `${g}군` }))} />
          {report && !provisional && <StatusChips cur={cur} destination={destination} />}
          {favs && (
            <div className="cfilter">
              <span className="lab">즐겨찾기</span>
              <div className="chips">
                <Link href={link({ fav: cur.fav ? undefined : true, open: undefined })} className={cur.fav ? "on" : undefined} aria-pressed={Boolean(cur.fav)} scroll={false}>
                  ★ 즐겨찾기만 보기 <b className="num">{favs.ids.size}</b>
                </Link>
              </div>
            </div>
          )}
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
                {/* 서버가 전체 개수를 주지 않으면(null) 0으로 보이지 않는다(10-24 QA: 목록이 있는데 '0개 대학') */}
                {res.matching_school_count == null || res.matching_offering_count == null ? (
                  <>검색 결과</>
                ) : (
                  <>
                    <b className="num">{res.matching_school_count}</b>개 대학 · <b className="num">{res.matching_offering_count}</b>개 모집단위
                  </>
                )}
                {/* 날짜만(YYYY-MM-DD)이든 시각까지(ISO)든 'YYYY.MM.DD'로 보인다(10-24 QA: 'T14:51:47Z'가 그대로 보였다) */}
                {asOfDate(res.as_of) && <small> · {asOfDate(res.as_of)} 기준</small>}
                {cur.st && scanned !== null && (
                  <small className="st-scan"> · 지원가능성 {cur.st.map((k) => STATUS_LABEL[k]).join("·")}: 모집단위 <b className="num">{scanned}</b>개를 확인해 <b className="num">{shown.length}</b>개</small>
                )}
              </span>
              <MineLegend report={report} />
            </div>

            {groups.length === 0 && !filtered && !nextCursor ? (
              /* 조건 없이 0건이면 검색이 좁아서가 아니라 올해(YEAR) 모집행 카탈로그가 아직
                 결속되지 않은 자료 보류다 — '지원 가능한 대학 없음'류 결론으로 말하지 않는다
                 (담당자 지시 2026-10-11: 카탈로그 부재와 결과 0 판정을 구분) */
              <section className="gate flat">
                <h2>올해 모집 정보가 아직 연결되지 않았습니다</h2>
                <p>{YEAR}학년도 모집 정보를 맞춰 보는 중이라 검색 결과를 아직 보여 드릴 수 없습니다. 지원할 수 없다는 뜻이 아니며, 자료가 연결되면 이 화면에서 검색할 수 있습니다.</p>
              </section>
            ) : groups.length === 0 && cur.fav ? (
              <section className="gate flat">
                <h2>{favs && favs.ids.size > 0 ? "조건에 맞는 즐겨찾기가 없습니다" : "즐겨찾기한 모집단위가 없습니다"}</h2>
                <p>유리한 대학 찾기나 이 화면에서 학과 옆 별표(☆)를 누르면 여기에 모입니다. 담기 전에 비교해 볼 곳을 {FAVORITE_LIMIT}개까지 넣을 수 있습니다.</p>
                <div className="acts"><Link className="btn" href={link({ fav: undefined, open: undefined })}>전체 목록 보기</Link></div>
              </section>
            ) : groups.length === 0 && nextCursor ? (
              <section className="gate flat">
                <h2>{cur.st ? "확인한 범위에는 고른 지원가능성이 없습니다" : "아직 찾는 중입니다"}</h2>
                <p>{cur.st ? `모집단위 ${scanned ?? 0}개를 내 성적으로 확인했지만 고른 단계에 드는 곳이 없었습니다. 목록 뒤쪽에서 이어서 찾을 수 있습니다.` : "조건에 맞는 모집단위를 목록 뒤쪽에서 더 찾아야 합니다. 결과가 없다는 뜻이 아닙니다."}</p>
                <div className="acts"><Link className="btn p" href={link({ cursor: nextCursor, open: undefined })}>{cur.st ? "이어서 찾기" : "계속 찾기"}</Link></div>
              </section>
            ) : groups.length === 0 ? (
              <section className="gate flat">
                <h2>조건에 맞는 모집단위가 없습니다</h2>
                <p>검색어를 줄이거나 지역·모집군{cur.st ? "·지원가능성" : ""}을 전체로 바꿔 보세요. 결과가 없다는 것은 지원할 수 없다는 뜻이 아닙니다.</p>
                <div className="acts"><Link className="btn" href={hrefWith({}, {}, destination)}>조건 지우기</Link></div>
              </section>
            ) : (
              <>
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
                      <span />
                    </div>
                    <ul>
                      {g.rows.map((o) => {
                        const open = cur.open === o.offering_id;
                        return (
                          <ItemShell
                            key={o.offering_id}
                            o={o}
                            a={cellOf(report, o.offering_id)}
                            initialOpen={open}
                            unit={
                              <>
                                <b>{o.department}</b>
                                <small>{o.track ?? "일반전형"}</small>
                                <FieldTag id={o.offering_id} />
                              </>
                            }
                            cells={
                              <>
                                <span className="c-grp"><span className="grp">{o.group}</span></span>
                                <MineCells report={report} id={o.offering_id} />
                                {star(o)}
                              </>
                            }
                            mmeta={
                              <span className="mmeta">
                                <span className="grp">{o.group}</span>
                                <span>{o.group}군</span>
                              </span>
                            }
                            detail={<MineDetail report={report} o={o} />}
                            conds={<MineConds report={report} o={o} />}
                          />
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              </>
            )}

            {(cur.cursor || nextCursor) && !(groups.length === 0 && nextCursor) && (
              <nav className="pager" aria-label="쪽 넘기기">
                {cur.cursor ? <Link className="btn" href={link({ cursor: undefined, open: undefined })}>처음부터</Link> : <span />}
                {nextCursor && <Link className="btn" href={link({ cursor: nextCursor, open: undefined })}>{cur.st ? "이어서 찾기" : `다음 ${LIMIT}개`}</Link>}
              </nav>
            )}
          </>
        )}
      </div>

      {/* 띠는 담은 곳의 이름·모집군을 모두 받은 뒤 한 번에 그린다. 목록은 띠를 기다리지 않는다 */}
      <Suspense fallback={null}>
        <MineTray report={report} items={items} src={src} caller={caller} />
      </Suspense>
    </>
  );
}

/**
 * 지원가능성 필터를 켰을 때(2026-11-22): 검색 결과를 30개씩 차례로 받아 분석을 채우고(분석 요청은 한 번에 하나, 30개 이하)
 * 고른 단계만 모은다. 30개가 모이거나 한 화면에서 SCAN_PAGES 쪽을 확인했거나 검색이 끝나면 멈추고,
 * 다음 쪽은 멈춘 곳의 검색 커서에서 이어 간다(lib/status-filter.ts). 그동안 화면은 책 넘김 대기 화면이다.
 */
async function collectByStatus(src: JungsiSource, caller: Caller, cur: Query, first: CatalogSearchDto<OfferingDto>, report: ReportDto, hit: (r: ReportDto, o: OfferingDto) => boolean) {
  let page = first;
  let current = report;
  const picked: OfferingDto[] = [];
  let scanned = 0;
  let analyzed = 0;
  let empty = 0;
  for (;;) {
    const items = page.items ?? [];
    if (items.length > 0) {
      current = await settleAnalyses(src, caller, current, items.map((o) => o.offering_id));
      analyzed++;
      scanned += items.length;
      for (const o of items) if (hit(current, o)) picked.push(o);
    } else empty++;
    if (picked.length >= LIMIT || !page.next_cursor || analyzed >= SCAN_PAGES || empty >= SCAN_EMPTY_HOPS) break;
    try {
      page = await src.searchOfferings(caller, { ...toSearch(cur), cursor: page.next_cursor });
    } catch (e) {
      // 다음 쪽을 받지 못하면 모은 만큼 보이고, 같은 곳에서 이어 찾을 수 있게 둔다
      if (e instanceof ConnectionError || e instanceof AccessDenied) break;
      throw e;
    }
  }
  return { items: picked, report: current, scanned, next: page.next_cursor };
}

/** 지원가능성 필터 칩. 여러 개 고를 수 있다. 성적이 있을 때만 보인다 */
function StatusChips({ cur, destination }: { cur: Query; destination: CatalogDestination }) {
  const on = new Set(cur.st ?? []);
  const link = (patch: Partial<Query>) => hrefWith(cur, patch, destination);
  return (
    <div className="cfilter st-filter">
      <span className="lab">지원가능성</span>
      <div className="chips">
        <Link href={link({ st: undefined, open: undefined })} className={on.size ? undefined : "on"} aria-current={on.size ? undefined : "true"} scroll={false}>
          전체
        </Link>
        {STATUS_KEYS.map((k) => (
          <Link key={k} href={link({ st: toggleStatus(cur.st, k), open: undefined })} className={on.has(k) ? "on" : undefined} aria-pressed={on.has(k)} scroll={false}>
            {STATUS_LABEL[k]}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** '즐겨찾기만 보기': 별표한 모집단위를 지금 조건(대학명·학과명·지역·모집군)으로 걸러 검색 결과와 같은 모양으로 만든다 */
function favoriteResult(f: Favorites | null, cur: Query): CatalogSearchDto<OfferingDto> {
  const has = (v: string | null | undefined, q?: string) => !q || (v ?? "").includes(q);
  const items = (f?.items ?? [])
    .filter((o) => o.academic_year === YEAR && has(o.university_name, cur.university_q) && has(o.department, cur.department_q) && (!cur.region || o.region === cur.region) && (!cur.group || o.group.startsWith(cur.group)))
    .sort((a, b) => a.university_name.localeCompare(b.university_name, "ko") || a.department.localeCompare(b.department, "ko"));
  return { status: "ready", reason_code: null, items, matching_offering_count: items.length, matching_school_count: new Set(items.map((o) => o.university_id)).size, catalog_version: null, as_of: null, next_cursor: null };
}

function ChipRow({ label, cur, destination, k, items }: {
  label: string;
  cur: Query;
  destination: CatalogDestination;
  k: "region" | "group";
  items: { v: string; label: string }[];
}) {
  const on = cur[k];
  const link = (patch: Partial<Query>) => hrefWith(cur, patch, destination);
  return (
    <div className="cfilter">
      <span className="lab">{label}</span>
      <div className="chips">
        <Link href={link({ [k]: undefined, open: undefined })} className={on ? undefined : "on"} aria-current={on ? undefined : "true"} scroll={false}>
          전체
        </Link>
        {items.map((i) => (
          <Link key={i.v} href={link({ [k]: i.v, open: undefined })} className={on === i.v ? "on" : undefined} aria-current={on === i.v ? "true" : undefined} scroll={false}>
            {i.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
