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
/** 학년도별 조회 예산(쪽 수). 예산 안에서 next_cursor 를 이어 받고, 넘치면 잘린 모집행을 버리고 미수집을 알린다 */
const MAX_PAGES = 3;


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
      side={<Link prefetch={false} className="btn" href={page("PAGE-03").path}>내 성적으로 가능성 보기</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  if (lockFor(session, route)) return <>{head}<LoginGate /></>;

  const cur = parseQuery(await searchParams);
  const base = { university_q: cur.university, department_q: cur.unit, region: cur.region, group: cur.group };
  /** 한 학년도를 예산(MAX_PAGES×limit) 안에서 이어 받는다. 예산을 넘겨 잘린 꼬리 모집행은
   *  지표 일부만 담겨 표·산술이 틀려 보일 수 있으므로 버리고(완전한 모집행만 표시) 미수집으로 알린다 */
  async function searchYear(y: (typeof PAST_YEARS)[number]): Promise<{ items: HistoryMetricDto[]; ready: boolean; as_of: string | null; truncated: boolean }> {
    const items: HistoryMetricDto[] = [];
    let cursor: string | undefined;
    let ready = false;
    let as_of: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const r: CatalogSearchDto<HistoryMetricDto> = await src.searchHistory(caller, { ...base, academic_year: y, cursor, limit: LIMIT_PAST });
      if (r.status === "ready" && r.items !== null) ready = true;
      if (r.as_of) as_of = r.as_of;
      items.push(...(r.items ?? []));
      if (!r.next_cursor) return { items, ready, as_of, truncated: false };
      cursor = r.next_cursor;
    }
    const tail = items.at(-1)?.offering_id;
    return { items: items.filter((m) => m.offering_id !== tail), ready, as_of, truncated: true };
  }
  let past: { items: HistoryMetricDto[]; ready: boolean; as_of: string | null; truncated: boolean }[];
  try {
    // 학년도 순서대로 하나씩(동시 조회는 계정당 승인 동시성을 넘긴다 — FE-LIVE-P1-CONCURRENCY-01)
    past = [];
    for (const y of PAST_YEARS) past.push(await searchYear(y));
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    throw e;
  }

  // 발행된 과거 결과를 대학 → 모집행(PK 그대로) → 학년도로 묶는다. 최신 학년도의 행이 카드 머리가 된다
  const anyReady = past.some((r) => r.ready);
  const uncollected = PAST_YEARS.filter((_, i) => past[i].truncated);
  const asOf = past.map((r) => r.as_of).filter(Boolean).sort().at(-1) ?? null;
  type Off = { id: string; first: HistoryMetricDto; years: Map<number, HistoryMetricDto[]> };
  const univs: { id: string; name: string; region: string | null; offerings: Off[] }[] = [];
  const byId = new Map<string, Off>();
  /** 공개 offering_id 는 "{학년도}:{모집행 PK}" 꼴이다. 접두사 학년도가 그 행의 academic_year 와
   *  일치할 때만 PK 를 꺼내 연도 결합 키로 쓰고(대학 범위 안에서), 그 외 형태는 결합하지 않는다 —
   *  접두사 제거는 발표 자료가 밝힌 같은 모집행 PK 의 확인이지 접미사 계보 추정이 아니다 */
  const pkOf = (m: HistoryMetricDto) => {
    const t = /^(\d{4}):(.+)$/.exec(m.offering_id);
    return t && Number(t[1]) === m.academic_year ? `${m.university_id}#${t[2]}` : m.offering_id;
  };
  for (const res of past)
    for (const m of res.items) {
      let u = univs.find((x) => x.id === m.university_id);
      if (!u) univs.push((u = { id: m.university_id, name: m.university_name, region: m.region, offerings: [] }));
      const pk = pkOf(m);
      let o = byId.get(pk);
      if (!o) {
        byId.set(pk, (o = { id: pk, first: m, years: new Map() }));
        u.offerings.push(o);
      }
      o.years.set(m.academic_year, [...(o.years.get(m.academic_year) ?? []), m]);
    }
  const units = univs.flatMap((u) => u.offerings);

  // 올해 모집 인원(화면에 보이는 모집단위만). 권한 거절은 빈칸으로 두고, 연결 실패는 화면 전체 안내로
  const recs = new Map<string, RecruitmentDto | null>();
  try {
    // 모집단위마다 recruitment.read. 실제 동시 호출 수는 BFF(lib/api/live.ts)가 회원 등급별 상한(일반 1·유료 2)으로 줄 세운다
    await Promise.all(
      units.map(async (o) => {
        try {
          // 2027 모집 인원은 같은 PK 의 최신 발행 학년도 offering_id 로 묻는다(결합 키는 API id 가 아니다)
          recs.set(o.id, await src.readRecruitment(caller, o.first.offering_id));
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
          <p className="hint">실제 발행된 2024~2026학년도 결과를 기준으로 모집단위를 보여 드리고, 2027학년도 모집 인원은 확인된 모집행에만 붙입니다. 입시결과는 대학이 발표한 최종 50%컷·70%컷을 발표 그대로 보여 드리며, 70%컷 대신 75%컷을 발표한 대학은 75%컷으로 보여 드립니다.</p>
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
                <b>{uncollected.join("·")}학년도</b> 결과는 일부만 조회됐습니다(학년도마다 {MAX_PAGES}쪽 × 지표 {LIMIT_PAST}개 예산으로 조회하며,
                지표가 일부만 담긴 잘린 모집행은 표에서 뺐습니다). 대학명·학과명으로 조건을 좁히면 조회 범위를 줄일 수 있으나, 이 안내가 보이는 동안은 일부 조회입니다. 담기지 않은 결과는 미발표·자료 없음이 아닙니다.
              </p>
            )}


            {univs.length === 0 ? (
              uncollected.length > 0 ? (
                /* FE-HISTORY-03S: 잔여 커서가 있는 동안은 빈 화면이어도 '없음'을 단정하지 않는다 —
                   예산 종료로 지표가 일부만 담긴 모집행을 보류해 카드가 0개일 수 있다 */
                <section className="gate flat">
                  <h2>일부 조회 상태입니다 — 아직 담긴 결과가 없습니다</h2>
                  <p>조회 예산이 끝나 지표가 일부만 담긴 모집행을 보류했기 때문일 수 있습니다. 조건에 맞는 발행 결과가 없다는 뜻이 아닙니다. 대학명·학과명으로 조건을 더 좁혀 다시 조회해 주세요.</p>
                </section>
              ) : (
                <section className="gate flat">
                  <h2>{words ? `‘${words}’에 맞는 발행 결과가 없습니다` : "조건에 맞는 발행 결과가 없습니다"}</h2>
                  <p>검색어를 줄이거나 다른 지역·모집군을 골라 보세요. 발행이 학교 단위로 나뉘어 진행되는 동안에는 아직 이번 판에 포함되지 않은 대학일 수 있습니다 — 자료가 없다는 뜻이 아닙니다. 실기 반영 전형은 서비스 범위에서 빠져 있습니다.</p>
                </section>
              )
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
  // 최종 관리자 지시(2026-10-09): 입결 지표는 최종 50%컷·최종 70%컷 두 개만 보인다.
  // 같은 통계는 직접 발표를 어디가 제출보다 먼저 고르고, 70%컷이 없으면 발표된 75%컷을
  // 대신 보인다(열 이름도 75%로 적는다). 열 순서는 모집인원/경쟁률/추정 총 지원자/
  // 충원인원/추정 탈락자/최종 50%컷/최종 70%컷 고정. 값·단위·척도는 발표 그대로다
  const seen: string[] = [];
  for (const y of PAST_YEARS) for (const m of years?.get(y) ?? []) if (!seen.includes(m.metric_name)) seen.push(m.metric_name);
  const pickCut = (percents: number[]) => {
    for (const src of ["대학 직접 발표", "대학 제출 어디가"])
      for (const pct of percents) {
        const name = seen.find((n) => n.includes(`최종등록자 ${pct}%컷`) && n.includes(src));
        if (name) return { key: name, label: `최종 ${pct}%컷` };
      }
    return null;
  };
  const cuts = [pickCut([50]), pickCut([70, 75])].filter((c): c is { key: string; label: string } => c !== null);
  // 추정 2열은 재료가 부족해도 열을 없애지 않는다 — 값만 ─ 로 둔다(1.9.13 지적: A/R 결측·C행 없음에서 열 누락 금지)
  type Col = { key: string; label: string; derived?: boolean };
  const cols: Col[] = [];
  if (seen.includes("모집인원")) cols.push({ key: "모집인원", label: "모집인원" });
  if (seen.includes("경쟁률")) cols.push({ key: "경쟁률", label: "경쟁률" });
  cols.push({ key: "__applicants", label: "추정 총 지원자", derived: true });
  if (seen.includes("충원인원")) cols.push({ key: "충원인원", label: "충원인원" });
  cols.push({ key: "__dropped", label: "추정 탈락자", derived: true });
  // 최종 합격 예비번호(단위 '번')는 독립 지표 열이다 — 충원인원의 별칭이 아니고,
  // 추정 총 지원자·탈락자 계산의 재료로도 쓰지 않는다(담당자 지시 2026-10-11 v3)
  if (seen.includes("최종 합격 예비번호")) cols.push({ key: "최종 합격 예비번호", label: "최종 합격 예비번호" });
  for (const c of cuts) cols.push(c);
  const metricCols = cols.filter((c) => !c.derived).map((c) => c.key);
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
                // 모집·충원 재료: '명' 단위로 발표된 비음수 정수만(단위 미확인·%·순위 등은 보류, 반례3).
                // 십진 숫자 문법을 직접 검사한다 — Number("")·Number("  ")가 0 이 되는 변환을 쓰지 않는다(1.9.13 지적)
                const personInt = (m: HistoryMetricDto | "dup" | null): number | null => {
                  if (!m || m === "dup" || m.value === null || m.unit !== "명") return null;
                  const s = String(m.value).trim();
                  if (!/^\d{1,9}$/.test(s)) return null;
                  return Number(s);
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

/** 2027 모집 인원 요약 한 줄. 미공개는 0 이 아니라 미공개(REQ-13).
 *  과거 모집행에 2027 연계가 확인되지 않은 것과 '2027 모집이 있는데 비공개'를 섞어 쓰지 않는다(1.9.13 지적).
 *  FE-HISTORY-02R: 응답 offering.academic_year 가 2027 일 때만 '2027 모집' 상자를 채운다 —
 *  recruitment.read 는 요청 모집행의 학년도를 그대로 돌려주므로, 과거 학년도 ready 응답을 2027 로 재명명하지 않는다 */
function RecruitLine({ rec }: { rec: RecruitmentDto | null }) {
  // FE-HISTORY-02S: 학년도·모집행 결속을 상태 문구보다 먼저 본다 — 2027 결속이 확인되지 않은 응답은
  // ready/pending 을 가리지 않고 '연계 확인 전'. 과거·미확인 pending 을 '2027 미발행'으로 표시하지 않는다
  if (!rec || rec.offering?.academic_year !== 2027)
    return <span className="rs-rec wait">2027 모집행 연계 확인 전</span>;
  if (rec.status !== "ready" || !rec.recruitment)
    return <span className="rs-rec wait">2027 모집 정보 미발행</span>;
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
