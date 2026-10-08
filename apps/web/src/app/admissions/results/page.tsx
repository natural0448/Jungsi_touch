import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import type { CatalogSearchDto, HistoryMetricDto, RecruitmentDto } from "@/lib/dto";
import { plainDate, signed } from "@/lib/format";
import { loginHref } from "@/lib/links";
import { lockFor, page } from "@/lib/routes";
import { GROUPS, PATH, REGIONS, hrefWith, parseQuery, type Query } from "./query";
import "./results.css";

const route = page("PAGE-01");
export const metadata: Metadata = { title: route.label };

/*
  목록의 축은 실제 발행된 2024~2026 입시결과다(1.9.12 지시). 학년도마다 한 번씩(각 정수 단일 요청,
  limit 100 — 지표 행 기준) 조회하고, next_cursor 가 남으면 미수집 범위를 화면에 분명히 알린다.
  숨은 전국 전량 읽기를 추가하지 않는다. 연도 묶음은 발표 자료의 같은 모집행 PK(offering_id)가
  같을 때만 합치고, PK 접미사를 지워 계보를 추정하지 않는다. 2027 모집 인원 상자는 같은 PK 의
  recruitment.read 가 ready 일 때만 채운다(2027 입결 placeholder 를 만들지 않는다).
*/
const PAST_YEARS = [2026, 2025, 2024] as const;
const LIMIT_PAST = 100;

/** 지표 열 순서. 발표가 흔한 것부터, 목록에 없는 지표는 받은 순서대로 뒤에 붙인다(이름을 바꾸거나 합치지 않는다) */
const METRIC_ORDER = ["모집인원", "경쟁률", "충원인원", "최종등록자 50%", "최종등록자 70%", "최종등록자 평균", "최종 합격선"];

/**
 * 1페이지 · 대학 발표 입시결과 (REQ-01)
 * 한 모집단위에서 2024~2026 발표 결과(경쟁률 포함)와 2027 모집 인원을 한 번에 본다.
 * 대학이 발표한 지표의 이름·정의·값·단위·척도·출처를 그대로 보이고, 자체 누적·예상 컷·개인 분석으로
 * 빈칸을 채우지 않는다(REQ-13: 미발표는 0 이 아니라 미발표). 개인 성적은 쓰지 않는다.
 * 응답 모양: history.search(catalog_search, items=history_metric) · recruitment.read — lib/dto.ts
 */
export default async function Page({ searchParams }: PageProps<"/admissions/results">) {
  const head = (
    <PageHead
      kicker={`PAGE ${route.number}`}
      title={route.label}
      desc="성적 입력 없이, 대학이 발표한 3개 학년도 입시결과와 올해 모집 인원을 한 번에 확인하세요."
      side={<Link className="btn" href={page("PAGE-03").path}>내 성적으로 가능성 보기</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  if (lockFor(session, route)) return <>{head}<LoginGate /></>;

  const cur = parseQuery(await searchParams);
  const base = { university_q: cur.university, department_q: cur.unit, region: cur.region, group: cur.group };
  let past: CatalogSearchDto<HistoryMetricDto>[];
  try {
    past = await Promise.all(PAST_YEARS.map((y) => src.searchHistory(caller, { ...base, academic_year: y, limit: LIMIT_PAST })));
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    throw e;
  }

  // 발행된 과거 결과를 대학 → 모집행(PK 그대로) → 학년도로 묶는다. 최신 학년도의 행이 카드 머리가 된다
  const anyReady = past.some((r) => r.status === "ready" && r.items !== null);
  const uncollected = PAST_YEARS.filter((_, i) => past[i].next_cursor);
  const asOf = past.map((r) => r.as_of).filter(Boolean).sort().at(-1) ?? null;
  type Off = { id: string; first: HistoryMetricDto; years: Map<number, HistoryMetricDto[]> };
  const univs: { id: string; name: string; region: string | null; offerings: Off[] }[] = [];
  const byId = new Map<string, Off>();
  for (const res of past)
    for (const m of res.items ?? []) {
      let u = univs.find((x) => x.id === m.university_id);
      if (!u) univs.push((u = { id: m.university_id, name: m.university_name, region: m.region, offerings: [] }));
      let o = byId.get(m.offering_id);
      if (!o) {
        byId.set(m.offering_id, (o = { id: m.offering_id, first: m, years: new Map() }));
        u.offerings.push(o);
      }
      o.years.set(m.academic_year, [...(o.years.get(m.academic_year) ?? []), m]);
    }
  const units = univs.flatMap((u) => u.offerings);

  // 올해 모집 인원(화면에 보이는 모집단위만). 권한 거절은 빈칸으로 두고, 연결 실패는 화면 전체 안내로
  const recs = new Map<string, RecruitmentDto | null>();
  try {
    await Promise.all(
      units.map(async (o) => {
        try {
          recs.set(o.id, await src.readRecruitment(caller, o.id));
        } catch (e) {
          if (e instanceof ConnectionError) throw e;
          recs.set(o.id, null);
        }
      }),
    );
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    throw e;
  }

  const filtered = Boolean(cur.university || cur.unit || cur.region || cur.group);
  const words = [cur.university, cur.unit].filter(Boolean).join(" · ");
  const p3 = page("PAGE-03");

  return (
    <>
      {head}
      <div className="wrap pg-body rs">
        <section className="rs-filter" aria-label="검색 조건">
          <Form action={PATH} className="rs-search" role="search">
            <label className="rs-field">
              <span>대학명</span>
              <input type="search" name="university" defaultValue={cur.university} placeholder="예: 가온, 해솔" maxLength={40} />
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
          <p className="hint">실제 발행된 2024~2026학년도 결과를 기준으로 모집단위를 보여 드리고, 2027학년도 모집 인원은 확인된 모집행에만 붙입니다. 대학마다 발표하는 지표(모집·충원인원, 경쟁률, 평균·50%·70%·최종 합격선)가 달라 서로 바꾸지 않고 발표한 그대로입니다.</p>
        </section>

        {!anyReady ? (
          <section className="gate flat">
            <h2>입시결과 자료가 아직 공개되지 않았습니다</h2>
            <p>검수가 끝난 대학 발표 자료부터 차례로 엽니다. 자료가 없는 것이지 결과가 0건인 것은 아닙니다.</p>
          </section>
        ) : (
          <>
            <div className="rs-count">
              <span>
                <b className="num">{univs.length}</b>개 대학 · <b className="num">{units.length}</b>개 모집단위 · 2024~2026 발행 결과 기준
                {asOf && <small> · 자료 기준 {plainDate(asOf)}</small>}
              </span>
              {filtered && <Link href={hrefWith(cur, { university: undefined, unit: undefined, region: undefined, group: undefined })}>조건 지우기</Link>}
            </div>

            {uncollected.length > 0 && (
              <p className="rs-uncollected">
                조건이 넓어 <b>{uncollected.join("·")}학년도</b> 결과 일부가 이 화면에 아직 담기지 않았습니다(학년도마다 지표 {LIMIT_PAST}개까지 조회).
                대학명·학과명으로 조건을 좁히면 모두 볼 수 있습니다. 담기지 않은 결과는 미발표·자료 없음이 아닙니다.
              </p>
            )}

            <CommonLegend units={units} />

            {univs.length === 0 ? (
              <section className="gate flat">
                <h2>{words ? `‘${words}’에 맞는 발행 결과가 없습니다` : "조건에 맞는 발행 결과가 없습니다"}</h2>
                <p>검색어를 줄이거나 다른 지역·모집군을 골라 보세요. 발행이 학교 단위로 나뉘어 진행되는 동안에는 아직 이번 판에 포함되지 않은 대학일 수 있습니다 — 자료가 없다는 뜻이 아닙니다. 실기 반영 전형은 서비스 범위에서 빠져 있습니다.</p>
              </section>
            ) : (
              <div className="rs-list">
                {univs.map((u) => (
                  <section key={u.id} className="rs-univ" aria-label={u.name}>
                    <header>
                      <h2>{u.name}</h2>
                      {u.region && <span className="meta">{u.region}</span>}
                      <span className="cnt num">{u.offerings.length}개 모집단위</span>
                    </header>
                    <ul>
                      {u.offerings.map((o) => (
                        <UnitCard key={o.id} o={o} years={o.years} rec={recs.get(o.id) ?? null} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

          </>
        )}
        <p className="rs-foot">대학 발표 자료만 보여 줍니다. 정시터치가 추정한 값(자체 누적·예상 기준)은 이 화면에 넣지 않습니다. 내 성적과 견주어 보려면 {p3.label}를 이용하세요.</p>
      </div>
    </>
  );
}

/** 한 모집단위: 2027 모집 인원 한 줄 + 2026~2024 결과 표(경쟁률·추정 지원자/탈락자 포함). 지표 설명은 목록 위 공통 한 번 */
function UnitCard({ o, years, rec }: { o: { id: string; first: HistoryMetricDto }; years: Map<number, HistoryMetricDto[]> | undefined; rec: RecruitmentDto | null }) {
  // 이 모집단위가 발표해 온 지표 열(과거 3개 학년도 기준, 순서 고정)
  const seen: string[] = [];
  for (const y of PAST_YEARS) for (const m of years?.get(y) ?? []) if (!seen.includes(m.metric_name)) seen.push(m.metric_name);
  const metricCols = [...METRIC_ORDER.filter((n) => seen.includes(n)), ...seen.filter((n) => !METRIC_ORDER.includes(n))];
  // 추정 2열은 재료 셋(모집인원·경쟁률·충원인원)이 모두 발표 지표로 있을 때만 끼운다(하나라도 없으면 두 칸 다 ─)
  const canDerived = ["모집인원", "경쟁률", "충원인원"].every((n) => metricCols.includes(n));
  type Col = { key: string; label: string; derived?: boolean };
  const cols: Col[] = [];
  for (const n of metricCols) {
    cols.push({ key: n, label: n });
    if (n === "경쟁률" && canDerived) cols.push({ key: "__applicants", label: "추정 총 지원자", derived: true });
    if (n === "충원인원" && canDerived) cols.push({ key: "__dropped", label: "추정 탈락자", derived: true });
  }
  return (
    <li id={o.id} className="rs-off open">
      <div className="rs-offhd plain">
        <span className="grp">{o.first.group}</span>
        <span className="unit">
          <b>{o.first.department}</b>
          <small>{[o.first.campus, o.first.track].filter(Boolean).join(" · ")}</small>
        </span>
        <RecruitLine rec={rec} />
      </div>
      {metricCols.length === 0 ? (
        <p className="rs-wait">이 모집단위의 2024~2026학년도 발표 결과가 아직 없습니다.</p>
      ) : (
        <div className="tblwrap">
          <table className="tb rs-years">
            <thead>
              <tr>
                <th scope="col">학년도</th>
                {cols.map((c) => (
                  <th key={c.key} scope="col" className={c.derived ? "r derived" : "r"}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 이 모집행 PK 로 실제 발행된 학년도만 그린다 — 없는 학년도를 ─ 행으로 만들면
                  '발표 없음'과 '연도 연결 미검증(다른 PK)'이 섞여 보이기 때문 */}
              {PAST_YEARS.filter((y) => years?.has(y)).map((y) => {
                const rows = years?.get(y) ?? [];
                const info = rows[0];
                const renamed = info && info.department !== o.first.department ? info.department : null;
                // 같은 이름 지표가 여러 번 발표된 해는 첫 행을 임의 선택하지 않는다(FE-HISTORY 반례5) — 보류
                const metricAt = (name: string): HistoryMetricDto | "dup" | null => {
                  const ms = rows.filter((x) => x.metric_name === name);
                  return ms.length === 1 ? ms[0] : ms.length === 0 ? null : "dup";
                };
                // 모집·충원 재료: '명' 단위로 발표된 비음수 정수만(단위 미확인·%·순위 등은 보류, 반례3)
                const personInt = (m: HistoryMetricDto | "dup" | null): number | null => {
                  if (!m || m === "dup" || m.value === null || m.unit !== "명") return null;
                  const v = Number(m.value);
                  return Number.isFinite(v) && v >= 0 && Number.isInteger(v) ? v : null;
                };
                // 경쟁률 재료: 발표 원문(십진 문자열)을 그대로 정수 분수로 받는다. 중간 반올림 없음(반례2).
                // 전체 12자리까지만 — Q×n 이 2^53 을 넘지 않아 정수 연산이 정확하다. 넘치면 보류
                const ratioOf = (m: HistoryMetricDto | "dup" | null): { n: number; s: number } | null => {
                  if (!m || m === "dup" || m.value === null) return null;
                  if (m.unit !== null && m.unit !== undefined && !m.unit.includes("대")) return null;
                  const t = /^(\d+)(?:\.(\d+))?$/.exec(String(m.value).trim());
                  if (!t) return null;
                  const frac = t[2] ?? "";
                  const digits = t[1] + frac;
                  if (digits.length > 10) return null;
                  return { n: Number(digits), s: 10 ** frac.length };
                };
                const cap = personInt(metricAt("모집인원"));
                const fill = personInt(metricAt("충원인원"));
                const ratio = ratioOf(metricAt("경쟁률"));
                // 공식 지원자 수 지표의 의미 대응은 데이터팀 검수 뒤 이름을 넣는다(문자열 짐작 대응 금지).
                const OFFICIAL_APPLICANT_METRICS: string[] = [];
                let officialA: number | null = null;
                for (const n of OFFICIAL_APPLICANT_METRICS) {
                  const v = personInt(metricAt(n));
                  if (v !== null) { officialA = v; break; }
                }
                let applicants: number | null = null;
                let dropped: number | null = null;
                if (officialA !== null) {
                  // 공식 A 우선: 추정 지원자 칸은 ─, 탈락자만 A−Q−C(R 불필요). 음수면 ─
                  if (cap !== null && fill !== null) {
                    const d = officialA - cap - fill;
                    dropped = d >= 0 ? d : null;
                  }
                } else if (cap !== null && fill !== null && ratio !== null && cap < 1e5) {
                  // Q·R·C 가 전부 유효할 때만 두 칸을 만든다(하나라도 없으면 둘 다 ─, 반례1).
                  // half-up(Q×R)을 정수 분수로: floor((2QR + s) / 2s) — 모든 피연산자가 2^53 미만 정수라 정확(반례2)
                  const p = cap * ratio.n;
                  applicants = Math.floor((2 * p + ratio.s) / (2 * ratio.s));
                  const d = applicants - cap - fill;
                  dropped = d >= 0 ? d : null; // 음수는 정의·범위 충돌 — 표시하지 않는다
                }
                return (
                  <tr key={y}>
                    <th scope="row">
                      <span className="num">{y}</span>
                      {renamed && <small>당시 {renamed}</small>}
                    </th>
                    {cols.map((c) => {
                      if (c.derived) {
                        const v = c.key === "__applicants" ? applicants : dropped;
                        return (
                          <td key={c.key} className="r derived">
                            {v === null ? <span className="unpub">─</span> : <><b className="num">{v}</b><small> 명</small></>}
                          </td>
                        );
                      }
                      const same = rows.filter((x) => x.metric_name === c.key);
                      const m = same.length === 1 ? same[0] : null;
                      if (same.length > 1)
                        return (
                          <td key={c.key} className="r">
                            <span className="unpub" title="같은 이름 지표가 집단·척도·출처가 다르게 여러 번 발표되어, 의미 확인 전에는 한 값을 고르지 않습니다">복수 발표</span>
                          </td>
                        );
                      return (
                        <td key={c.key} className="r">
                          {!m ? (
                            <span className="unpub">─</span>
                          ) : m.value !== null ? (
                            <>
                              <b className="num">{m.value}</b>
                              {m.unit && <small> {m.unit}</small>}
                            </>
                          ) : (
                            <span className="unpub">미발표</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

/**
 * 지표 설명을 카드마다 반복하지 않고 목록 위에 한 번만 보여 준다(사용자 요청).
 * 같은 지표라도 대학마다 척도·정의가 다를 수 있어, 화면에 나온 카드들에서 서로 다른
 * 발표 정의가 섞여 있으면 그 사실을 적고 특정 대학의 정의를 전체 정의처럼 쓰지 않는다.
 */
function CommonLegend({ units }: { units: { years: Map<number, HistoryMetricDto[]> }[] }) {
  const defs = new Map<string, { scale: string | null; def: string | null }[]>();
  let canDerived = false;
  for (const o of units) {
    const seen: string[] = [];
    for (const y of PAST_YEARS)
      for (const m of o.years.get(y) ?? []) {
        if (!seen.includes(m.metric_name)) seen.push(m.metric_name);
        const list = defs.get(m.metric_name) ?? [];
        if (!list.some((d) => d.scale === m.original_scale && d.def === m.metric_definition))
          list.push({ scale: m.original_scale, def: m.metric_definition });
        defs.set(m.metric_name, list);
      }
    if (["모집인원", "경쟁률", "충원인원"].every((n) => seen.includes(n))) canDerived = true;
  }
  if (defs.size === 0) return null;

  const names = [...METRIC_ORDER.filter((n) => defs.has(n)), ...[...defs.keys()].filter((n) => !METRIC_ORDER.includes(n))];
  const legend = names.map((n) => {
    const list = defs.get(n) ?? [];
    if (list.length === 1) return { name: n, scale: list[0].scale, def: list[0].def ?? (list[0].scale ? null : "대학이 정의를 함께 발표하지 않았습니다.") };
    return { name: n, scale: null, def: "대학마다 발표 척도·정의가 달라 각 표의 값은 그 대학 발표 기준입니다." };
  });
  if (canDerived) {
    legend.push({ name: "추정 총 지원자", scale: "모집인원 × 경쟁률(화면 계산, 0.5 이상 올림)", def: "모집인원·경쟁률·충원인원이 그 해에 모두 발표된 경우에만 계산합니다. 발표된 경쟁률이 반올림된 값이라 실제 지원자 수와 다를 수 있고, 공식 지원자 수가 복원되는 것은 아닙니다. 대학이 지원자 수를 직접 발표하면 그 값을 발표 열에 보이고 이 칸은 ─로 둡니다." });
    legend.push({ name: "추정 탈락자", scale: "추정 총 지원자 − 모집인원 − 충원인원(화면 계산)", def: "합격 후 등록 포기·반복 충원 등을 반영하지 못하는 산술값이라 실제 불합격자 수나 합격 확률을 뜻하지 않습니다. 재료가 하나라도 없거나, '명' 단위가 아니거나, 같은 이름 지표가 중복 발표됐거나, 차감 결과가 음수면 ─로 둡니다." });
  }

  return (
    <details className="rs-legendbox" open>
      <summary>지표 설명 · 추정 산식</summary>
      <dl className="rs-legend">
        {legend.map((l) => (
          <div key={l.name}>
            <dt>{l.name}</dt>
            <dd>
              {l.scale && <b>{l.scale}</b>}
              {l.scale && l.def ? " · " : null}
              {l.def}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** 2027 모집 인원 요약 한 줄. 미공개는 0 이 아니라 미공개(REQ-13) */
function RecruitLine({ rec }: { rec: RecruitmentDto | null }) {
  if (!rec || rec.status !== "ready" || !rec.recruitment)
    return <span className="rs-rec wait">2027 모집 인원 미공개</span>;
  const x = rec.recruitment;
  return (
    <span className="rs-rec">
      <b>2027 모집</b>
      {x.final_count !== null ? (
        <>
          최종 <b className="num">{x.final_count}</b>명
          {x.initial_count !== null && (
            <small>
              (최초 {x.initial_count}
              {x.rollover_change !== null && x.rollover_change !== 0 ? ` ${signed(x.rollover_change)}` : ""})
            </small>
          )}
          {x.count_status !== "confirmed" && <small className="warn">최종 미확정</small>}
        </>
      ) : (
        <span className="wait">인원 미확정</span>
      )}
      {x.deadline && <small>· 원서마감 {plainDate(x.deadline)}</small>}
    </span>
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
