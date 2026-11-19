import { AutoRefresh } from "@/components/auto-refresh";
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
import { UnitList, type SumItem } from "./unit-row";
import { applicantEligibilityLabel, r27Summary, unitKey } from "@/lib/p1-shape";
import "./results.css";

const route = page("PAGE-01");
export const metadata: Metadata = { title: route.label };

/*
  1페이지는 전국 정리본(history.snapshot.*, 기획 1.9.95)으로 그린다. 관리자가 미리 받아 검증·저장해 둔 학교별 묶음과
  작은 검색 색인만 읽으므로 첫 화면부터 전국 전체가 보이고, 검색은 서버 API 를 다시 부르지 않는다.
  옛 history.search 6쪽 조립·'조회 미완료'는 이 화면에서 쓰지 않는다(연결계약 v3 §4-5). 두 경로를 함께 부르지 않는다.
  학년도 결합은 같은 원래 PK 일 때만, PK 미연결 관측은 따로 원문 그대로 보인다. 2027 모집행은 자기 PK 로 따로 두고,
  과거 행은 서버의 검토 확인 연결(historical_links)로만 묶는다. 부분 발행이면 맨 위에 그 사실을 알린다(담당자 1.9.141).
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
      side={<Link className="btn" href={page("PAGE-04").path}>내 성적으로 유리한 대학 찾기</Link>}
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
          <p className="hint">
            대학이 발표한 2024~2026학년도 결과를 학년도별로 보여 드립니다. 최종등록자 기준을 먼저 쓰고, 대학마다 발표 방식이 달라 학교마다 보이는 통계가 다를 수 있습니다.
            <br />① 칸: 합격자 가운데쯤 점수(50%컷, 없으면 평균)
            <br />② 칸: 합격자 70% 지점 점수(70%컷, 없으면 75%·80%컷 등)
          </p>
        </section>

        {snap.state !== "ready" || !res ? (
          <NotReady state={snap.state} />
        ) : (
          <>
            <div className="rs-count">
              <span>
                <b className="num">{res.total_schools}</b>개 대학 · <b className="num">{res.total_units}</b>개 모집단위
                {res.total_pending > 0 && <> · 학과 연결 확인 중 <b className="num">{res.total_pending}</b>건</>}
                <small>
                  {" "}· 정리본 갱신 {seoulDate(snap.ready.generated_at)}
                  {/* 기준일이 없으면 '확인 중'을 쓰지 않고 항목을 뺀다(2026-11-05 사용자 결정: 안내문의 '확인 중'도 제거) */}
                  {asOfDate(snap.ready.source_as_of) && <> · 공식 발표 기준일 {asOfDate(snap.ready.source_as_of)}</>}
                </small>
              </span>
              {filtered && <Link href={hrefWith(cur, { university: undefined, unit: undefined, region: undefined, group: undefined })}>조건 지우기</Link>}
            </div>
            {snap.ready.r27_scope_coverage && (
              <p className="rs-idnote">
                2027학년도 모집 정보는 지금 <b>일부 모집단위만</b> 반영되어 있습니다. 검토 중인 <b className="num">{snap.ready.r27_scope_coverage.review_pending_rows}</b>건은 확인이 끝나는 대로 더해집니다.
              </p>
            )}

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
        <p className="rs-foot">대학 발표 자료만 보여 줍니다. 충원인원은 대학이 발표한 충원(추가 합격) 숫자로, 최종 합격 예비번호로 발표한 대학은 그 번호를 적었습니다. 추정 총 지원자(모집인원×경쟁률)와 추정 탈락자(추정 총 지원자−(모집인원+충원인원)) 두 칸만 계산한 값이고, 대학어디가가 충원인원을 “-”로 적은 해는 0명으로 적었습니다. 그 밖의 정시터치 추정값은 이 화면에 넣지 않습니다. 내 성적과 견주어 보려면 {p3.label}를 이용하세요.</p>
      </div>
    </>
  );
}

/**
 * 접힌 줄에 넘길 작은 요약: 2027학년도 모집인원만(2026-10-24 사용자 결정).
 * 2027 모집행(schema v2 의 r27_source)이 있으면 그 모집인원 원문을, 없으면 null('준비 중')을 넘긴다.
 * 과거 학년도는 담당자가 검토 확인한 연결만 같은 줄로 묶인다(lib/p1-shape linkR27).
 */
function summaryOf(rows: Parameters<typeof latestOf>[0]): SumItem {
  const l = latestOf(rows), r27 = rows.find((r) => r.y === 2027);
  return {
    k: unitKey(l),
    // 모집군은 '가군·나군·다군'으로 통일해 보인다(발표 표기 '다'·'다군'이 섞여 있다, 10-24 사용자 결정)
    g: l.g ? l.g.replace(/^([가나다])군?$/, "$1군") : null,
    d: l.d,
    sub: [l.c, l.t, l.pk === null ? "학과 연결 확인 중" : null].filter(Boolean).join(" · "),
    r27: r27 ? r27Summary(r27.q27) : null,
    eligibility27: applicantEligibilityLabel(r27?.ae27),
    ratio27: null, // 2027 반영비율도 담당자 자료(연도별 반영비 조회) 연결 뒤 여기서 채운다
  };
}

function NotReady({ state }: { state: "none" | "changed" | "expired" | "checking" | "ready" }) {
  const text =
    state === "checking"
      ? { h: "입시결과 최신 자료를 확인하고 있습니다", p: "몇 초 뒤 자동으로 다시 불러옵니다. 계속 이 화면이면 잠시 후 다시 열어 주세요. 정확하지 않은 결과를 보여 드리지 않으려고 잠시 멈춘 것입니다." }
      : state === "changed"
      ? { h: "입시결과 새 자료를 준비하고 있습니다", p: "대학 발표 자료가 새로 바뀌어 확인을 마칠 때까지 잠시 보여 드리지 않습니다. 정확하지 않은 결과를 보여 드리지 않으려고 잠시 멈춘 것입니다." }
      : state === "expired"
        ? { h: "입시결과 자료를 새로 확인하고 있습니다", p: "새로 확인한 자료를 준비하는 동안 잠시 보여 드리지 않습니다. 정확하지 않은 결과를 보여 드리지 않으려고 잠시 멈춘 것입니다." }
        : { h: "입시결과 자료를 준비하고 있습니다", p: "확인을 마친 대학 발표 자료를 준비하는 중입니다. 아직 자료가 준비되지 않은 것이지 결과가 0건인 것은 아닙니다." };
  return (
    <section className="gate flat">
      <h2>{text.h}</h2>
      <p>{text.p}</p>
      {state === "checking" && <AutoRefresh />}
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
