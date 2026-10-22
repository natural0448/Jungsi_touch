import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "@/components/link";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import { SnapshotChanged } from "@/lib/api/source";
import { asOfDate, seoulDate } from "@/lib/format";
import { loginHref } from "@/lib/links";
import { currentSnapshot, searchSnapshot, type Current, type SearchResult } from "@/lib/p1-snapshot";
import { lockFor, page } from "@/lib/routes";
import { GROUPS, PATH, REGIONS, hrefWith, parseQuery, type Query } from "./query";
import { groupUnits, latestOf } from "./snapshot-table";
import { UnitList, type SumCell, type SumItem } from "./unit-row";
import { unitKey, type Cell } from "@/lib/p1-shape";
import "./results.css";

const route = page("PAGE-01");
export const metadata: Metadata = { title: route.label };

/*
  1페이지는 전국 정리본(history.snapshot.*, 기획 1.9.95)으로 그린다. 관리자가 미리 받아 검증·저장해 둔 학교별 묶음과
  작은 검색 색인만 읽으므로 첫 화면부터 전국 전체가 보이고, 검색은 서버 API 를 다시 부르지 않는다.
  옛 history.search 6쪽 조립·'조회 미완료'는 이 화면에서 쓰지 않는다(연결계약 v3 §4-5). 두 경로를 함께 부르지 않는다.
  학년도 결합은 같은 원래 PK 일 때만, PK 미연결 관측은 따로 원문 그대로 보인다. 2027 모집 정보는 검증된 목표 모집행
  ID 가 없어 연결하지 않는다(year_mapping).
*/

/**
 * 1페이지 · 대학 발표 입시결과 (REQ-01)
 * 대학이 발표한 2024~2026 결과를 학년도별 한 줄로, 이전 고정 표 배치로 보인다. 값·단위·기준은 발표 그대로이고
 * 확인 중인 값은 사유와 함께 보인다(null 은 0 이 아니다). 개인 성적은 쓰지 않는다.
 */
export default async function Page({ searchParams }: PageProps<"/admissions/results">) {
  const head = (
    <PageHead
      kicker={`PAGE ${route.number}`}
      title={route.label}
      desc="성적 입력 없이, 대학이 발표한 3개 학년도 입시결과를 전국 대학 단위로 한 번에 확인하세요."
      side={<Link className="btn" href={page("PAGE-03").path}>내 성적으로 가능성 보기</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  if (lockFor(session, route)) return <>{head}<LoginGate /></>;

  const cur = parseQuery(await searchParams);
  let snap: Current;
  let res: SearchResult | null = null;
  try {
    snap = await currentSnapshot(src, caller);
    if (snap.state === "ready")
      res = await searchSnapshot(snap.ready, { university: cur.university, unit: cur.unit, region: cur.region, group: cur.group, page: cur.page ? Number(cur.page) : 1 });
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    if (e instanceof SnapshotChanged) snap = { state: "changed" };
    else throw e;
  }

  const filtered = Boolean(cur.university || cur.unit || cur.region || cur.group);
  const words = [cur.university, cur.unit].filter(Boolean).join(" · ");
  const p3 = page("PAGE-03");

  return (
    <>
      {head}
      <div className="wrap pg-body rs">
        <section className="rs-filter" aria-label="검색 조건">
          <Form action={PATH} prefetch={false} className="rs-search" role="search">
            <label className="rs-field">
              <span>대학명</span>
              <input type="search" name="university" defaultValue={cur.university} placeholder="예: 강원대, 홍익대" maxLength={40} />
            </label>
            <label className="rs-field">
              <span>학과명</span>
              <input type="search" name="unit" defaultValue={cur.unit} placeholder="예: 경영, 간호" maxLength={40} />
            </label>
            {cur.region && <input type="hidden" name="region" value={cur.region} />}
            {cur.group && <input type="hidden" name="group" value={cur.group} />}
            <button className="btn p" type="submit">검색</button>
          </Form>
          <ChipRow label="지역" cur={cur} k="region" items={REGIONS} />
          <ChipRow label="모집군" cur={cur} k="group" items={[...GROUPS]} suffix="군" />
          <p className="hint">대학이 발표한 2024~2026학년도 결과를 학년도별로 보여 드립니다. 최종 50%컷·70%컷은 같은 기준의 발표만 씁니다. 대학이 다른 비율·평균·최저 등으로 발표한 값은 &lsquo;대학 발표 통계&rsquo;에 원래 기준·대상과 함께 보여 드립니다. &lsquo;확인 중&rsquo; 꼬리표는 값은 발표 그대로이고 정의·단위·발표일 확인이 남았다는 뜻입니다(꼬리표에 마우스를 올리면 사유가 보입니다).</p>
        </section>

        {snap.state !== "ready" || !res ? (
          <NotReady state={snap.state} />
        ) : (
          <>
            <div className="rs-count">
              <span>
                <b className="num">{res.total_schools}</b>개 대학 · <b className="num">{res.total_units}</b>개 모집단위
                {res.total_pending > 0 && <> · 모집행 연결 확인 중 <b className="num">{res.total_pending}</b>건</>}
                <small>
                  {" "}· 정리본 갱신 {seoulDate(snap.ready.generated_at)} · 공식 발표 기준일 {asOfDate(snap.ready.source_as_of) ?? "확인 중"}
                </small>
              </span>
              {filtered && <Link href={hrefWith(cur, { university: undefined, unit: undefined, region: undefined, group: undefined })}>조건 지우기</Link>}
            </div>

            {res.schools.length === 0 ? (
              <section className="gate flat">
                <h2>{words ? `‘${words}’에 맞는 발표 결과가 없습니다` : "조건에 맞는 발표 결과가 없습니다"}</h2>
                <p>검색어를 줄이거나 다른 지역·모집군을 골라 보세요. 이번 정리본에 아직 들어오지 않은 대학일 수 있습니다 — 자료가 없다는 뜻이 아닙니다. 실기 반영 전형은 서비스 범위에서 빠져 있습니다.</p>
              </section>
            ) : (
              <div className="rs-list">
                {res.schools.map(({ school, rows }) => {
                  const units = groupUnits(rows);
                  const mapped = units.filter((u) => u[0].pk !== null).length;
                  return (
                    <section key={school.id} className="rs-univ" aria-label={school.name}>
                      <header>
                        <h2>{school.name}</h2>
                        {school.names.length > 1 && <span className="meta">외 발표명 {school.names.length - 1}개</span>}
                        {school.region && <span className="meta">{school.region}</span>}
                        <span className="cnt num">
                          {mapped}개 모집단위{units.length > mapped && ` · 연결 확인 중 ${units.length - mapped}건`}
                        </span>
                      </header>
                      {school.names.length > 1 && (
                        <p className="rs-names">학년도·자료마다 발표 대학명이 다릅니다: {school.names.join(" / ")}. 다른 이름의 행에는 그 해 발표명을 함께 적었습니다.</p>
                      )}
                      <UnitList pub={snap.ready.pub} schoolId={school.id} schoolName={school.name} items={units.map(summaryOf)} />
                    </section>
                  );
                })}
              </div>
            )}

            {res.pages > 1 && (
              <nav className="rs-pager" aria-label="대학 쪽 이동">
                {res.page > 1 ? <Link href={hrefWith(cur, { page: String(res.page - 1) })}>← 이전 대학 20곳</Link> : <span />}
                <span className="num">
                  {res.page} / {res.pages}
                </span>
                {res.page < res.pages ? <Link href={hrefWith(cur, { page: String(res.page + 1) })}>다음 대학 20곳 →</Link> : <span />}
              </nav>
            )}
          </>
        )}
        <p className="rs-foot">대학 발표 자료만 보여 줍니다. 추정 총 지원자(모집인원×경쟁률)와 추정 탈락자(추정 총 지원자−모집인원−충원인원) 두 칸만 계산한 값이고, 그 밖의 정시터치 추정값은 이 화면에 넣지 않습니다. 내 성적과 견주어 보려면 {p3.label}를 이용하세요.</p>
      </div>
    </>
  );
}

const sumCell = (c: Cell): SumCell => [c.v, c.u, c.s.startsWith("pending") && (c.v !== null || c.s === "pending_metadata") ? c.r : null];
/** 접힌 줄에 넘길 작은 요약: 가장 최근 학년도의 모집인원·경쟁률·50/70%컷 */
function summaryOf(rows: Parameters<typeof latestOf>[0]): SumItem {
  const l = latestOf(rows);
  return {
    k: unitKey(l),
    g: l.g,
    d: l.d,
    sub: [l.c, l.t, l.pk === null ? "모집행 연결 확인 중" : null].filter(Boolean).join(" · "),
    y: l.y,
    c: [sumCell(l.rc), sumCell(l.cr), sumCell(l.c50), sumCell(l.c70)],
  };
}

function NotReady({ state }: { state: "none" | "changed" | "expired" | "checking" | "ready" }) {
  const text =
    state === "checking"
      ? { h: "입시결과의 현재판을 확인하고 있습니다", p: "현재판 확인을 함께 처리하고 있습니다. 잠시 후 다시 열어 주세요. 이전 판을 최신처럼 보여 드리지는 않습니다." }
      : state === "changed"
      ? { h: "입시결과 새 판을 준비하고 있습니다", p: "대학 발표 정리본이 새 판으로 바뀌어, 확인을 마칠 때까지 잠시 보여 드리지 않습니다. 이전 판을 최신처럼 보이지 않기 위해서입니다." }
      : state === "expired"
        ? { h: "입시결과 정리본의 확인 기간이 지났습니다", p: "새로 확인된 판을 준비하는 동안 잠시 보여 드리지 않습니다." }
        : { h: "입시결과 자료를 준비하고 있습니다", p: "검수가 끝난 대학 발표 정리본을 준비하는 중입니다. 자료가 없는 것이지 결과가 0건인 것은 아닙니다." };
  return (
    <section className="gate flat">
      <h2>{text.h}</h2>
      <p>{text.p}</p>
    </section>
  );
}

function ChipRow({ label, cur, k, items, suffix = "" }: { label: string; cur: Query; k: "region" | "group"; items: string[]; suffix?: string }) {
  const on = cur[k];
  return (
    <div className="cfilter">
      <span className="lab">{label}</span>
      <div className="chips">
        <Link href={hrefWith(cur, { [k]: undefined })} className={on ? undefined : "on"} aria-current={on ? undefined : "true"} scroll={false}>
          전체
        </Link>
        {items.map((v) => (
          <Link key={v} href={hrefWith(cur, { [k]: v })} className={on === v ? "on" : undefined} aria-current={on === v ? "true" : undefined} scroll={false}>
            {v}
            {suffix}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** 1페이지는 로그인한 일반·유료 회원이 본다. 비회원 공개 여부는 기획에서 미정(현재 기본값은 인증 필요) */
function LoginGate() {
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="gate-h">
        <div className="ic"><LockIcon size={20} /></div>
        <h2 id="gate-h">로그인하면 대학 발표 입시결과를 볼 수 있습니다</h2>
        <p>성적 입력이나 이용권 없이, 에듀터치 회원이면 누구나 볼 수 있습니다.</p>
        <div className="acts">
          <a className="btn p" href={loginHref(route.path)}>에듀터치 로그인</a>
        </div>
      </section>
    </div>
  );
}
