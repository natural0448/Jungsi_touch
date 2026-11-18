import { StarButton } from "@/components/star-button";
import { FAVORITE_LIMIT, myFavorites, type Favorites } from "@/lib/favorites";
import { FieldTag } from "@/components/field-tag";
import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
import Form from "next/form";
import { Suspense } from "react";
import Link from "@/components/link";
import { MemberMark } from "@/components/member-mark";
import { PaidGate } from "@/components/paid-gate";
import { PageHead } from "@/components/page-head";
import { BookLoading } from "@/components/book-loading";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source, type Caller, type JungsiSource } from "@/lib/api";
import { memberName } from "@/lib/member-name";
import type { CatalogSearchDto, OfferingDto } from "@/lib/dto";
import { asOfDate } from "@/lib/format";
import { REGIONS } from "@/lib/regions";
import { startMine } from "@/lib/report-ops";
import { viewPath } from "@/lib/content-view";
import { lockFor, page } from "@/lib/routes";
import { ItemShell } from "./item-shell";
import { BasisWait, CellsWait, DetailWait, MineBasis, MineCells, MineDetail, MineLegend, MineRunBoxes, MineTray, cellOf } from "./mine-parts";
import { GROUPS, hrefWith, LIMIT, parseQuery, toSearch, type Query, YEAR } from "./query";
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
      side={<Link prefetch={false} className="btn" href={page("PAGE-04").path}>유리한 대학 추천 다시 보기</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const naming = memberName(); // 대기 화면 문구용. 서비스 API 와 별개 조회라 함께 보낸다
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  // 화면 표시용 잠금. 서버가 검색을 403 으로 막아도 아래 catch 가 같은 안내를 그린다
  const lock = lockFor(session, route);
  if (lock) return <>{head}<PaidGate kind={lock} route={route} features={FEATURES} /></>;

  const sp = await searchParams;
  const name = await naming;
  // 머리글은 바로 보이고, 검색과 내 분석을 기다리는 본문 자리에는 책 넘김 대기 화면을 둔다(2026-11-18 대표님 요청)
  return (
    <>
      {head}
      <Suspense fallback={<BookLoading name={name} kind="possibilities" />}>
        <Body src={src} caller={caller} sp={sp} />
      </Suspense>
    </>
  );
}

async function Body({ src, caller, sp }: { src: JungsiSource; caller: Caller; sp: Awaited<PageProps<"/admissions/possibilities">["searchParams"]> }) {
  const head = null; // 머리글은 Page 가 이미 그렸다
  const cur = parseQuery(sp);
  // 검색과 내 리포트를 함께 보내되 기다리는 것은 검색뿐이다(2026-11-10 부담당자 요청: 먼저 온 것부터 그리기).
  // 목록(대학·학과·모집군)은 검색만 오면 그리고, 내 환산점수·지원가능성·담기·분석 버튼·담은 학교 띠는
  // 각자 Suspense 경계 안에서 내 리포트(mine)를 기다린다(mine-parts.tsx). 리포트는 이 요청에서 한 번만 받는다.
  // 화면을 열 때는 저장된 분석만 붙인다. 분석이 없는 행은 버튼을 눌러야 계산한다(담당자 회신 2026-10-25).
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
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<PaidGate kind={e.status === 401 ? "login" : "paid"} route={route} features={FEATURES} /></>;
    // 다음 쪽 커서는 몇 분만 유효하다. 오래된 링크·뒤로 가기로 다시 열면 화면 오류 대신 처음부터 보게 한다
    if (cur.cursor && e instanceof Error && e.message.includes("invalid_cursor")) {
      return (
        <>
          {head}
          <div className="wrap pg-body ps">
            <section className="gate flat">
              <h2>다음 목록을 여는 시간이 지났습니다</h2>
              <p>검색 결과의 다음 쪽은 잠시 동안만 열 수 있습니다. 같은 조건으로 처음부터 다시 보여 드립니다.</p>
              <div className="acts"><Link className="btn p" href={hrefWith(cur, { cursor: undefined, open: undefined })}>처음부터 다시 보기</Link></div>
            </section>
          </div>
        </>
      );
    }
    throw e;
  }

  // 저장된 분석만 보인다. 분석이 없는 칸은 '분석 대기'로 남고 버튼으로 채운다
  const items = res.items ?? [];
  const favs = await favoring; // 읽지 못하면 null — 별표를 숨긴다
  // 화면 안 검색·칩·다음 쪽은 같은 화면의 전환이다. React 는 전환 중에 이미 보여 준 Suspense 경계가 다시 기다리면
  // 기다리는 칸으로 바꾸지 않고 옛 화면을 붙잡아, 새 목록까지 내 리포트를 기다렸다(11-10 부담당자 측정: 검색 뒤 목록=내 점수).
  // 검색 조건을 경계의 key 로 주어 조건이 바뀌면 새 경계가 되게 한다 — 목록은 먼저 바뀌고 내 칸만 '불러오는 중'으로 기다린다.
  // 같은 조건에서 다시 그릴 때(분석·담기 뒤)는 key 가 같아 옛 내용을 둔 채 새 값으로 바뀐다(깜박임 없음)
  const qk = hrefWith(cur, { open: undefined });

  // 같은 대학끼리 묶는다(받은 순서를 지킨다)
  const groups: { id: string; name: string; rows: OfferingDto[] }[] = [];
  for (const o of items) {
    const last = groups[groups.length - 1];
    if (last && last.id === o.university_id) last.rows.push(o);
    else groups.push({ id: o.university_id, name: o.university_name, rows: [o] });
  }
  // 즐겨찾기만 보기도 조건이다 — 0건을 '올해 모집 정보 미연결'로 안내하지 않는다
  const filtered = Boolean(cur.university_q || cur.department_q || cur.region || cur.group || cur.fav);
  const star = (o: OfferingDto) => <span className="c-star">{favs && <StarButton id={o.offering_id} on={favs.ids.has(o.offering_id)} name={`${o.university_name} ${o.department}`} />}</span>;
  // 유료 데이터를 그린 화면: 회원 식별 표시 + 조회 기록. 모집단위를 펼쳤으면 대학 분석, 아니면 가능성 목록
  const view = viewPath(route.path, sp);

  return (
    <>
      {head}
      <MemberMark kind={cur.open ? "analysis" : "possibility"} path={view} />
      <div className="wrap pg-body ps">
        <Suspense key={qk} fallback={<BasisWait />}>
          <MineBasis p={mine} />
        </Suspense>

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
            {cur.fav && <input type="hidden" name="fav" value="1" />}
            {cur.region && <input type="hidden" name="region" value={cur.region} />}
            {cur.group && <input type="hidden" name="group" value={cur.group} />}
            <button className="btn p" type="submit">검색</button>
          </Form>
          <ChipRow label="지역" cur={cur} k="region" items={REGIONS.map((r) => ({ v: r, label: r }))} />
          <ChipRow label="모집군" cur={cur} k="group" items={GROUPS.map((g) => ({ v: g, label: `${g}군` }))} />
          {favs && (
            <div className="cfilter">
              <span className="lab">즐겨찾기</span>
              <div className="chips">
                <Link href={hrefWith(cur, { fav: cur.fav ? undefined : true, open: undefined })} className={cur.fav ? "on" : undefined} aria-pressed={Boolean(cur.fav)} scroll={false}>
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
              </span>
              <Suspense key={qk} fallback={null}>
                <MineLegend p={mine} />
              </Suspense>
            </div>

            {groups.length === 0 && !filtered ? (
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
                <div className="acts"><Link className="btn" href={hrefWith(cur, { fav: undefined, open: undefined })}>전체 목록 보기</Link></div>
              </section>
            ) : groups.length === 0 && res.next_cursor ? (
              <section className="gate flat">
                <h2>아직 찾는 중입니다</h2>
                <p>조건에 맞는 모집단위를 목록 뒤쪽에서 더 찾아야 합니다. 결과가 없다는 뜻이 아닙니다.</p>
                <div className="acts"><Link className="btn p" href={hrefWith(cur, { cursor: res.next_cursor, open: undefined })}>계속 찾기</Link></div>
              </section>
            ) : groups.length === 0 ? (
              <section className="gate flat">
                <h2>조건에 맞는 모집단위가 없습니다</h2>
                <p>검색어를 줄이거나 지역·모집군을 전체로 바꿔 보세요. 결과가 없다는 것은 지원할 수 없다는 뜻이 아닙니다.</p>
                <div className="acts"><Link className="btn" href={route.path}>조건 지우기</Link></div>
              </section>
            ) : (
              <>
              <Suspense key={qk} fallback={null}>
                <MineRunBoxes p={mine} items={items} />
              </Suspense>
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
                            aP={mine.then((m) => cellOf(m, o.offering_id))}
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
                                <Suspense key={qk} fallback={<CellsWait />}>
                                  <MineCells p={mine} id={o.offering_id} />
                                </Suspense>
                                {star(o)}
                              </>
                            }
                            mmeta={
                              <span className="mmeta">
                                <span className="grp">{o.group}</span>
                                <span>{o.group}군</span>
                              </span>
                            }
                            detail={
                              <Suspense key={qk} fallback={<DetailWait />}>
                                <MineDetail p={mine} o={o} />
                              </Suspense>
                            }
                          />
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              </>
            )}

            {(cur.cursor || res.next_cursor) && !(groups.length === 0 && res.next_cursor) && (
              <nav className="pager" aria-label="쪽 넘기기">
                {cur.cursor ? <Link className="btn" href={hrefWith(cur, { cursor: undefined, open: undefined })}>처음부터</Link> : <span />}
                {res.next_cursor && <Link className="btn" href={hrefWith(cur, { cursor: res.next_cursor, open: undefined })}>다음 {LIMIT}개</Link>}
              </nav>
            )}
          </>
        )}
      </div>

      <Suspense key={qk} fallback={null}>
        <MineTray p={mine} items={items} src={src} caller={caller} />
      </Suspense>
    </>
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

/** 빈 쪽을 건너뛰는 횟수 한도. 쪽마다 서버 요청이 한 번씩 든다 */
const EMPTY_PAGE_HOPS = 5;

async function skipEmptyPages(src: JungsiSource, caller: Caller, q: ReturnType<typeof toSearch>): Promise<CatalogSearchDto<OfferingDto>> {
  let res = await src.searchOfferings(caller, q);
  for (let hop = 0; hop < EMPTY_PAGE_HOPS && (res.items ?? []).length === 0 && res.next_cursor; hop++) {
    res = await src.searchOfferings(caller, { ...q, cursor: res.next_cursor });
  }
  return res;
}
