import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ChevronIcon, LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, getCaller, source } from "@/lib/api";
import { ACADEMIC_YEARS, type CatalogSearchDto, type HistoryMetricDto, type RecruitmentDto } from "@/lib/dto";
import { plainDate } from "@/lib/format";
import { loginHref } from "@/lib/links";
import { lockFor, page } from "@/lib/routes";
import { DEFAULT_YEAR, GROUPS, PATH, REGIONS, hrefWith, parseQuery, type Query } from "./query";
import { RecruitmentPanel } from "./recruitment";
import "./results.css";

const route = page("PAGE-01");
export const metadata: Metadata = { title: route.label };
const LIMIT = 100;

/**
 * 1페이지 · 대학 발표 입시결과 (REQ-01)
 * 대학이 발표한 지표의 이름·정의·값·단위·척도·출처를 그대로 보인다.
 * 자체 누적·예상 컷·개인 분석으로 빈칸을 채우지 않는다. 개인 성적은 쓰지 않는다.
 * 응답 모양: history.search(catalog_search, items=history_metric) · recruitment.read — lib/dto.ts
 */
export default async function Page({ searchParams }: PageProps<"/admissions/results">) {
  const head = (
    <PageHead
      kicker={`PAGE ${route.number}`}
      title={route.label}
      desc="성적 입력 없이, 대학이 발표한 정시 입시결과를 발표한 그대로 확인하세요."
      side={<Link className="btn" href={page("PAGE-03").path}>내 성적으로 가능성 보기</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const session = await src.getSession(caller);
  if (lockFor(session, route)) return <>{head}<LoginGate /></>;

  const cur = parseQuery(await searchParams);
  let res: CatalogSearchDto<HistoryMetricDto>;
  try {
    res = await src.searchHistory(caller, {
      academic_year: cur.year,
      university_q: cur.university,
      department_q: cur.unit,
      region: cur.region,
      group: cur.group,
      cursor: cur.cursor,
      limit: LIMIT,
    });
  } catch (e) {
    if (e instanceof AccessDenied) return <>{head}<LoginGate /></>;
    throw e;
  }

  // 지표 한 줄씩 오므로 대학 → 모집행으로 묶는다(받은 순서를 지킨다)
  type Off = { id: string; first: HistoryMetricDto; metrics: HistoryMetricDto[] };
  const univs: { id: string; name: string; region: string | null; offerings: Off[] }[] = [];
  for (const m of res.items ?? []) {
    let u = univs.find((x) => x.id === m.university_id);
    if (!u) univs.push((u = { id: m.university_id, name: m.university_name, region: m.region, offerings: [] }));
    let o = u.offerings.find((x) => x.id === m.offering_id);
    if (!o) u.offerings.push((o = { id: m.offering_id, first: m, metrics: [] }));
    o.metrics.push(m);
  }

  const openOff = cur.open ? univs.flatMap((u) => u.offerings).find((o) => o.id === cur.open) : undefined;
  let recruitment: RecruitmentDto | null = null;
  if (openOff && openOff.first.academic_year === 2027) {
    try {
      recruitment = await src.readRecruitment(caller, openOff.id);
    } catch (e) {
      if (!(e instanceof AccessDenied)) throw e;
    }
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
            {cur.year !== DEFAULT_YEAR && <input type="hidden" name="year" value={cur.year} />}
            {cur.region && <input type="hidden" name="region" value={cur.region} />}
            {cur.group && <input type="hidden" name="group" value={cur.group} />}
            <button className="btn p" type="submit">검색</button>
          </Form>
          <div className="cfilter">
            <span className="lab">학년도</span>
            <div className="chips">
              {ACADEMIC_YEARS.map((y) => (
                <Link key={y} href={hrefWith(cur, { year: y, open: undefined })} className={cur.year === y ? "on" : undefined} aria-current={cur.year === y ? "true" : undefined} scroll={false}>
                  {y}학년도{y === 2027 ? " (모집 중)" : ""}
                </Link>
              ))}
            </div>
          </div>
          <ChipRow label="지역" cur={cur} k="region" items={REGIONS} />
          <ChipRow label="모집군" cur={cur} k="group" items={[...GROUPS]} suffix="군" />
          <p className="hint">학년도는 그 학년도에 입학한 학생들의 결과입니다. 대학마다 발표하는 지표(평균·50%·70%·최종 합격선)가 달라 서로 바꾸지 않고 발표한 그대로 보여 드립니다.</p>
        </section>

        {res.status !== "ready" || res.items === null ? (
          <section className="gate flat">
            <h2>입시결과 자료가 아직 공개되지 않았습니다</h2>
            <p>검수가 끝난 대학 발표 자료부터 차례로 엽니다. 자료가 없는 것이지 결과가 0건인 것은 아닙니다.</p>
          </section>
        ) : (
          <>
            <div className="rs-count">
              <span>
                <b className="num">{res.matching_school_count ?? 0}</b>개 대학 · <b className="num">{res.matching_offering_count ?? 0}</b>개 모집단위 · {cur.year}학년도
                {res.as_of && <small> · 자료 기준 {plainDate(res.as_of)}</small>}
              </span>
              {filtered && <Link href={hrefWith(cur, { university: undefined, unit: undefined, region: undefined, group: undefined, open: undefined })}>조건 지우기</Link>}
            </div>
            {cur.year === 2027 && <p className="rs-note">2027학년도는 아직 결과가 발표되지 않았습니다. 모집단위를 펼치면 올해 모집 인원을 볼 수 있습니다.</p>}

            {univs.length === 0 ? (
              <section className="gate flat">
                <h2>{words ? `‘${words}’에 맞는 모집단위가 없습니다` : "조건에 맞는 모집단위가 없습니다"}</h2>
                <p>검색어를 줄이거나 다른 학년도·지역·모집군을 골라 보세요. 실기 반영 전형은 서비스 범위에서 빠져 있습니다.</p>
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
                      {u.offerings.map((o) => {
                        const open = cur.open === o.id;
                        const toggle = `${hrefWith(cur, { open: open ? undefined : o.id })}#${o.id}`;
                        return (
                          <li key={o.id} id={o.id} className={`rs-off${open ? " open" : ""}`}>
                            <Link className="rs-offhd" href={toggle} scroll={false} aria-expanded={open}>
                              <span className="grp">{o.first.group}</span>
                              <span className="unit">
                                <b>{o.first.department}</b>
                                <small>{[o.first.campus, o.first.track].filter(Boolean).join(" · ")}</small>
                              </span>
                              <span className="go"><ChevronIcon /></span>
                            </Link>
                            <div className="tblwrap">
                              <table className="tb rs-metrics">
                                <thead>
                                  <tr>
                                    <th scope="col">발표 지표</th>
                                    <th scope="col" className="r">값</th>
                                    <th scope="col">점수 종류</th>
                                    <th scope="col">출처</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.metrics.map((m) => (
                                    <tr key={m.metric_name}>
                                      <th scope="row">{m.metric_name}</th>
                                      <td className="r">
                                        {m.value !== null ? (
                                          <>
                                            <b className="num">{m.value}</b>
                                            {m.unit && <small> {m.unit}</small>}
                                          </>
                                        ) : (
                                          <span className="unpub">미발표</span>
                                        )}
                                      </td>
                                      <td className="scale">{m.original_scale ?? "─"}</td>
                                      <td className="src">
                                        {m.source_url ? (
                                          <a href={m.source_url} target="_blank" rel="noopener noreferrer">대학 발표</a>
                                        ) : (
                                          "─"
                                        )}
                                        {m.source_as_of && <small className="num"> {plainDate(m.source_as_of)}</small>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {open && (
                              <div className="rs-detail">
                                <dl className="rs-defs">
                                  {o.metrics.map((m) => (
                                    <div key={m.metric_name}>
                                      <dt>{m.metric_name}</dt>
                                      <dd>{m.metric_definition ?? "대학이 정의를 함께 발표하지 않았습니다."}</dd>
                                    </div>
                                  ))}
                                </dl>
                                {o.first.academic_year === 2027 ? (
                                  <RecruitmentPanel r={recruitment} />
                                ) : (
                                  <p className="rs-wait">모집 인원은 올해(2027학년도) 모집단위에서 보여 드립니다. 2027학년도를 골라 같은 학과를 펼쳐 보세요.</p>
                                )}
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
              <nav className="rs-pager" aria-label="쪽 넘기기">
                {cur.cursor ? <Link className="btn" href={hrefWith(cur, { cursor: undefined, open: undefined })}>처음으로</Link> : <span />}
                {res.next_cursor && <Link className="btn" href={hrefWith(cur, { cursor: res.next_cursor, open: undefined })}>다음</Link>}
              </nav>
            )}
          </>
        )}
        <p className="rs-foot">대학 발표 자료만 보여 줍니다. 정시터치가 추정한 값(자체 누적·예상 기준)은 이 화면에 넣지 않습니다. 내 성적과 견주어 보려면 {p3.label}를 이용하세요.</p>
      </div>
    </>
  );
}

function ChipRow({ label, cur, k, items, suffix = "" }: { label: string; cur: Query; k: "region" | "group"; items: string[]; suffix?: string }) {
  const on = cur[k];
  return (
    <div className="cfilter">
      <span className="lab">{label}</span>
      <div className="chips">
        <Link href={hrefWith(cur, { [k]: undefined, open: undefined })} className={on ? undefined : "on"} aria-current={on ? undefined : "true"} scroll={false}>
          전체
        </Link>
        {items.map((v) => (
          <Link key={v} href={hrefWith(cur, { [k]: v, open: undefined })} className={on === v ? "on" : undefined} aria-current={on === v ? "true" : undefined} scroll={false}>
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
