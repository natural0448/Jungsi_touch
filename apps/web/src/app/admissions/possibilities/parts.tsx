import Link from "next/link";
import { CATEGORY, CategoryBadge, PickButton, ReasonList, reasonText, type Cell } from "@/components/offering-parts";
import { DATA_KIND, POPULATION, scoreBasisLabel } from "@/lib/analysis-labels";
import type { AssessmentDto, ForecastPublicDto, IssueSummaryDto, OfferingDto, RecruitmentDto } from "@/lib/dto";
import { plainDate, signed } from "@/lib/format";
import { page } from "@/lib/routes";

/**
 * 펼친 줄: 2027 모집 정보(recruitment.read) + 환산·학교 누백·지원 판단·유불리 + 근거(assessment).
 * 환산·누백·판단은 서로 따로 준비된다(1.7.0). 판단이 보류여도 성공한 환산·누백은 숨기지 않는다.
 */
export function Detail({ o, a, rec, pub, picked }: { o: OfferingDto; a: Cell; rec: RecruitmentDto | null; pub: ForecastPublicDto | null; picked: boolean }) {
  const p2 = page("PAGE-02").path;
  const recruit = (
    <>
      <Recruit o={o} rec={rec} />
      <Published f={pub} same={sameRelease(a, pub)} />
    </>
  );

  if (a === "need") {
    return (
      <>
        {recruit}
        <div className="empty-an">
          <p>
            <b>성적을 넣으면 이 모집단위의 내 환산점수 · 지원가능성 · 환산 유불리가 보입니다.</b>
            <br />
            성적이 없어도 검색과 모집 정보는 그대로 볼 수 있습니다.
          </p>
          <Link className="btn p" href={p2}>성적 입력하기</Link>
        </div>
      </>
    );
  }
  if (!a) {
    return (
      <>
        {recruit}
        <div className="empty-an"><p>이 모집단위의 분석 결과를 아직 받지 못했습니다. 잠시 뒤 다시 열어 보세요.</p></div>
      </>
    );
  }

  return (
    <>
      {recruit}
      <StatusStrip a={a} />
      <div className="four">
        <ConversionCard a={a} />
        <PercentileCard a={a} />
        <DecisionCard a={a} />
        <AdvantageCard a={a} />
      </div>
      {(a.recommendation_reasons?.length ?? 0) > 0 && (
        <div className="reasons">
          <h3>이 학과의 판단 이유</h3>
          <ReasonList items={a.recommendation_reasons!} />
        </div>
      )}
      <Evidence a={a} />
      <Years a={a} />
      <div className="acts">
        <PickButton id={o.offering_id} on={picked} variant="wide" />
        <Link className="btn" href={p2}>내 성적 리포트에서 보기</Link>
      </div>
    </>
  );
}

function Recruit({ o, rec }: { o: OfferingDto; rec: RecruitmentDto | null }) {
  const r = rec?.status === "ready" ? rec.recruitment : null;
  const wait = (t: string) => <span className="wait">{t}</span>;
  return (
    <div className="recruit">
      <span>2027 모집군<b>{o.group}군</b></span>
      {r ? (
        <>
          <span>최초 인원<b className="num">{r.initial_count ?? wait("미공개")}</b></span>
          <span>이월·변경<b className="num">{r.rollover_change === null ? wait("미공개") : signed(r.rollover_change)}</b></span>
          <span>최종 인원<b className="num">{r.final_count ?? wait("미확정")}</b></span>
          <span>기준일<b className="num">{plainDate(r.source_as_of)}</b></span>
        </>
      ) : (
        <span>모집 인원<b>{wait("자료 준비 중")}</b></span>
      )}
      <Link href={`${page("PAGE-01").path}?university=${encodeURIComponent(o.university_name)}&unit=${encodeURIComponent(o.department)}`}>대학 발표 입시결과 보기</Link>
    </div>
  );
}

/** 세 계산의 준비 상태를 따로 보인다 */
function StatusStrip({ a }: { a: AssessmentDto }) {
  const conv = a.conversion?.status ?? (a.converted_score ? "ready" : "pending");
  const pct = a.percentile?.status ?? (a.converted_percentile ? "ready" : "pending");
  const items = [
    { k: "환산", ok: conv === "ready", why: a.conversion?.reason_code },
    { k: "학교 누백", ok: pct === "ready", why: a.percentile?.reason_code },
    { k: "지원 판단", ok: a.status === "ready", why: a.status === "ineligible" ? "eligibility_not_met" : a.reason_code },
  ];
  return (
    <ul className="strip" aria-label="계산 준비 상태">
      {items.map((i) => (
        <li key={i.k} className={i.ok ? "ok" : "hold"}>
          <b>{i.k}</b> {i.ok ? "준비됨" : "보류"}
          {!i.ok && i.why && <small> · {reasonText(i.why)}</small>}
        </li>
      ))}
    </ul>
  );
}

function ConversionCard({ a }: { a: AssessmentDto }) {
  const c = a.conversion;
  const score = c?.converted_score ?? a.converted_score;
  return (
    <section className="card" aria-label="내 환산점수">
      <h3>내 환산점수</h3>
      {score ? (
        <>
          <div className="big num">
            {score}
            {c?.official_max_score && <small>/ {c.official_max_score}</small>}
          </div>
          <p>
            올해 이 대학 공식 반영식으로 환산했습니다.
            {c?.score_basis && <span className="tag">{scoreBasisLabel(c.score_basis)}</span>}
          </p>
        </>
      ) : (
        <>
          <div className="big hold">계산 보류</div>
          <p>{reasonText(c?.reason_code ?? a.reason_code)} 작년 표로 대신 계산하지 않습니다.</p>
        </>
      )}
      <span className="note">대학마다 만점·반영 방식이 달라 다른 대학 점수와 크기를 비교하지 않습니다.</span>
    </section>
  );
}

function PercentileCard({ a }: { a: AssessmentDto }) {
  const p = a.percentile;
  const top = p?.inclusive_top_percent ?? p?.top_percent ?? a.converted_percentile;
  const kind = p?.data_kind ? DATA_KIND[p.data_kind] : null;
  const pop = p?.population_scope ? POPULATION[p.population_scope] : null;
  return (
    <section className="card" aria-label="학교 환산 누백">
      <h3>이 대학 환산 기준 위치</h3>
      {top && p?.status !== "pending" ? (
        <>
          <div className="big num">
            상위 {top}
            <small>%</small>
          </div>
          <p>
            동점 포함 상위 <b className="num">{top}%</b>
            {p?.exclusive_top_percent && <> · 동점 제외 <b className="num">{p.exclusive_top_percent}%</b></>}
            {p?.tie_share_percent && <> · 동점 비중 {p.tie_share_percent}%</>}
          </p>
          {(kind || pop) && (
            <p className="tags">
              {kind && <span className="tag">{kind.label}</span>}
              {pop && <span className="tag">{pop.label}</span>}
            </p>
          )}
          {pop && <span className="note">{pop.note}</span>}
          {kind && <span className="note">{kind.note}</span>}
        </>
      ) : (
        <>
          <div className="big hold">누백 보류</div>
          <p>{reasonText(p?.reason_code) || "이 대학 환산 분포가 아직 준비되지 않았습니다."} 환산점수는 그대로 보입니다.</p>
        </>
      )}
    </section>
  );
}

function DecisionCard({ a }: { a: AssessmentDto }) {
  const d = a.decision_components;
  const ev = a.decision_evidence;
  const r = ev?.expected_acceptance_range;
  const f = ev?.forecast_70;
  return (
    <section className="card" aria-label="지원가능성">
      <h3>지원가능성</h3>
      <div>
        <CategoryBadge a={a} />
      </div>
      {a.status !== "ready" ? (
        <p>{reasonText(a.reason_code)}{a.status === "ineligible" ? " 자격을 충족하지 않으면 점수 비교를 하지 않습니다." : ""}</p>
      ) : (
        <>
          {d?.adjusted_category && (
            <p className="adj">
              기본 판단 <b>{CATEGORY[d.base_category].label}</b> → 상담 조정 <b>{CATEGORY[d.adjusted_category].label}</b>
            </p>
          )}
          {r && (
            <p>
              판단 구간 <b className="num">{r.lower}~{r.upper}</b>{r.unit}
              <br />
              <small>{r.definition}</small>
            </p>
          )}
          {f && (
            <p>
              올해 70% 예상선{" "}
              {f.status === "ready" ? (
                <b className="num">
                  {f.value}
                  {f.unit}
                </b>
              ) : (
                <span className="wait">발표 대기</span>
              )}
            </p>
          )}
        </>
      )}
      <span className="note">지원가능성은 합격 확률이 아닙니다. 학과마다 따로 판단합니다.</span>
    </section>
  );
}

function AdvantageCard({ a }: { a: AssessmentDto }) {
  const v = a.advantage;
  if (!v) {
    const otherPop = a.percentile?.population_scope === "required_rule_inputs_present";
    return (
      <section className="card" aria-label="환산 유불리">
        <h3>환산 유불리</h3>
        <div className="big hold">판단 보류</div>
        <p>
          {a.status === "ineligible"
            ? "지원 자격을 충족하지 않아 유불리를 계산하지 않았습니다."
            : otherPop
              ? "이 대학 위치는 반영 성적을 모두 가진 응시자 기준이라 전체 응시자 위치와 분모가 다릅니다. 두 위치의 차이를 유불리로 보이지 않습니다."
              : reasonText(a.reason_code) || "비교할 수 있는 분포와 환산 자료를 확인하고 있습니다."}
        </p>
      </section>
    );
  }
  const n = Number(v.delta_pp);
  const tone = v.status === "neutral" ? "even" : n > 0 ? "up" : "down";
  return (
    <section className="card" aria-label="환산 유불리">
      <h3>환산 유불리</h3>
      <div className={`big num ${tone}`}>
        {n > 0 ? "+" : ""}
        {v.delta_pp}
        <small>%p</small>
      </div>
      <p>{v.status === "favorable" ? "총점보다 이 대학 환산에서 위치가 올라갑니다." : v.status === "unfavorable" ? "총점보다 이 대학 환산에서 위치가 내려갑니다." : "총점과 이 대학 환산의 위치가 거의 같습니다."}</p>
      <span className="note">같은 비교집단 안에서 위치가 얼마나 바뀌는지입니다. 유리해도 합격 가능을, 불리해도 지원 불가를 뜻하지 않습니다.</span>
    </section>
  );
}

/** 발행된 학과별 예상 기준의 공개 근거(DEV-007). 내부 계산 과정은 오지 않는다 */
function Evidence({ a }: { a: AssessmentDto }) {
  const ev = a.decision_evidence;
  if (!ev || (!ev.basis_summary && !ev.issue_summaries?.length && !ev.adjustment_summary?.applied && !ev.recommendation_reasons?.length)) return null;
  return (
    <div className="evidence">
      <h3>
        기준선 근거
        {ev.forecast_release_version && <small> · 발행 {ev.forecast_release_version}</small>}
      </h3>
      <ul>
        {ev.basis_summary && <li><b>산출</b> {ev.basis_summary}</li>}
        {ev.recommendation_reasons?.map((r) => <li key={r.code}><b>근거</b> {r.text}</li>)}
        {ev.issue_summaries?.map((t) => <IssueItem key={t.issue_id} t={t} />)}
        {ev.adjustment_summary?.applied && <li><b>상담 조정</b> {ev.adjustment_summary.reason ?? "상담 판단으로 조정한 값입니다."}</li>}
      </ul>
    </div>
  );
}

/** 연도별: 그해 기준으로 옮긴 내 환산점수와 대학 발표 지표를 나란히. 화면이 둘을 비교해 판정하지 않는다 */
function Years({ a }: { a: AssessmentDto }) {
  const metrics = a.decision_evidence?.historical_metrics ?? [];
  const years = a.years;
  const all = Array.from(new Set([...years.map((y) => y.academic_year), ...metrics.map((m) => m.academic_year)])).sort((x, y) => y - x);
  if (all.length === 0) return null;
  return (
    <div className="years">
      <table>
        <caption>연도별 근거</caption>
        <thead>
          <tr>
            <th scope="col">학년도</th>
            <th scope="col" className="r">내 환산점수</th>
            <th scope="col">기준</th>
            <th scope="col">대학 발표 지표</th>
          </tr>
        </thead>
        <tbody>
          {all.map((yr) => {
            const y = years.find((x) => x.academic_year === yr);
            const ms = metrics.filter((m) => m.academic_year === yr);
            return (
              <tr key={yr}>
                <th scope="row" className="num">{yr}</th>
                <td className="r num">{y?.converted_score ?? <span className="na">─</span>}</td>
                <td>{y ? (y.status === "ready" ? scoreBasisLabel(y.score_basis) : <span className="na">{reasonText(y.reason_code) || "보류"}</span>) : <span className="na">─</span>}</td>
                <td>
                  {ms.length === 0 ? (
                    <span className="na">{yr === 2027 ? "올해는 아직 결과 없음" : "자료 없음"}</span>
                  ) : (
                    ms.map((m) => (
                      <span key={m.metric_name} className="m">
                        {m.metric_name}{" "}
                        {m.value === null ? <span className="na">미발표</span> : <b className="num">{m.value}{m.unit ?? ""}</b>}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <span className="note">올해 행은 지금 입력한 시험 기준, 지난 해는 그해 성적으로 옮긴 추정입니다. 대학 발표 지표는 대학마다 기준이 달라 내 점수와 그대로 비교하지 않습니다.</span>
    </div>
  );
}

function IssueItem({ t }: { t: IssueSummaryDto }) {
  return (
    <li>
      <b>올해 변화</b> {t.title}: {t.summary}
      {!t.numeric_effect_applied && <small> · 점수에는 반영하지 않음</small>}
    </li>
  );
}

/** 공개 context 17필드(서비스·DB 인계 ③). 값·타입·명시적 null 이 모두 같아야 같은 근거다 */
const CONTEXT_FIELDS = [
  "offering_id", "academic_year", "exam_id", "source_pack_version", "catalog_version", "rule_id", "rule_version", "curve_version",
  "analysis_version", "score_scale_id", "score_scope", "bonus_treatment", "population_id", "comparison_metric", "unit", "direction", "tie_policy",
] as const;

/** 학과 판단에 쓴 근거(decision_evidence)와 발행본(forecast_public)이 같은 발표본인지: 발표본 버전·정책·입력 버전과 context 17필드가 모두 같을 때만 */
export function sameRelease(a: Cell, f: ForecastPublicDto | null) {
  const ev = a && a !== "need" ? a.decision_evidence : undefined;
  if (!ev || !f || f.status !== "published" || !ev.context || !f.context) return false;
  const x = ev.context as unknown as Record<string, unknown>;
  const y = f.context as unknown as Record<string, unknown>;
  return (
    ev.forecast_release_version === f.release_version &&
    ev.policy_version === f.policy_version &&
    ev.input_version === f.input_version &&
    CONTEXT_FIELDS.every((k) => k in x && k in y && x[k] === y[k])
  );
}

const CAT_LABEL: Record<string, string> = { challenge: "도전", core: "핵심 검토", room: "여유 후보", outside: "추천 범위 밖" };

/** 발행된 학과별 예상 기준(forecast.published.read). 합격 확률·최저점이 아니다. 발행 전이면 보이지 않는다 */
function Published({ f, same }: { f: ForecastPublicDto | null; same: boolean }) {
  if (!f || f.status !== "published") return null;
  const v = f.forecast_70;
  const r = f.expected_acceptance_range;
  return (
    <div className="published">
      <h3>
        발행된 학과 기준 <small>{f.release_version}</small>
      </h3>
      <dl>
        {v && (
          <div>
            <dt>올해 70% 예상선</dt>
            <dd className="num">{v.status === "ready" ? `${v.value}${v.unit ?? ""}` : <span className="wait">발표 대기</span>}</dd>
          </div>
        )}
        {r && (
          <div>
            <dt>판단용 합격권</dt>
            <dd className="num">{r.status === "ready" ? `${r.lower}~${r.upper}${r.unit ?? ""}` : <span className="wait">발표 대기</span>}</dd>
          </div>
        )}
        {f.category_ranges.map((c) => (
          <div key={c.category}>
            <dt>{CAT_LABEL[c.category] ?? c.category}</dt>
            <dd className="num">[{c.lower}, {c.upper})</dd>
          </div>
        ))}
      </dl>
      {(f.basis_summary || f.adjustment_summary.applied) && (
        <p>
          {f.basis_summary}
          {f.adjustment_summary.applied && <> · 상담 조정: {f.adjustment_summary.reason ?? "반영됨"}</>}
        </p>
      )}
      {f.issue_summaries.length > 0 && (
        <ul className="pub-issues">
          {f.issue_summaries.map((t) => <IssueItem key={t.issue_id} t={t} />)}
        </ul>
      )}
      <span className="note">
        {same
          ? "이 학과의 지원 판단도 이 발표본으로 계산했습니다. "
          : "이 학과의 지원 판단은 다른 발표본·기준으로 계산됐을 수 있어 아래 판단과 합쳐 보지 않습니다. 새 기준으로 보려면 성적을 다시 분석해야 합니다. "}
        학과 기준은 지원 판단의 근거이며 실제 지원자의 합격 확률이나 최저 합격점이 아닙니다.
      </span>
    </div>
  );
}
