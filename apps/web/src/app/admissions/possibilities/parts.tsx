import Link from "next/link";
import { CATEGORY, CategoryBadge, EnrichedReasonList, PickButton, reasonText, type Cell } from "@/components/offering-parts";
import { DATA_KIND, POPULATION, scoreBasisLabel } from "@/lib/analysis-labels";
import type { AssessmentDto, ForecastPublicDto, IssueSummaryDto, OfferingDto, RecruitmentDto } from "@/lib/dto";
import { signed } from "@/lib/format";
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
          <DetailReasons a={a} />
        </div>
      )}
      <AdoptedEvidence a={a} />
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
    { k: "점수 변환", ok: conv === "ready", why: a.conversion?.reason_code },
    { k: "대학 안 내 위치", ok: pct === "ready", why: a.percentile?.reason_code },
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
            내 성적을 올해 이 대학이 정한 과목 비율대로 다시 계산한 점수입니다.
            {c?.score_basis && <span className="tag">{scoreBasisLabel(c.score_basis)}</span>}
          </p>
        </>
      ) : (
        <>
          <div className="big hold">계산 보류</div>
          <p>{reasonText(c?.reason_code ?? a.reason_code)} 작년 기준으로 대신 계산하지 않습니다.</p>
        </>
      )}
      <span className="note">대학마다 만점과 계산 방법이 달라, 이 점수를 다른 대학 점수와 직접 비교하면 안 됩니다.</span>
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
      <h3>이 대학 기준 내 위치</h3>
      {top && p?.status !== "pending" ? (
        <>
          <div className="big num">
            상위 {top}
            <small>%</small>
          </div>
          <p>
            이 대학 방식으로 점수를 매겼을 때 나는 비교 대상 중 상위 <b className="num">{top}%</b>쯤입니다.
            {p?.exclusive_top_percent && <> 나와 같은 점수인 사람을 빼고 세면 상위 <b className="num">{p.exclusive_top_percent}%</b>입니다.</>}
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

/** 판단 구간·예상선 같은 내부 기준 수치는 보이지 않는다(최종 관리자 지시 2026-10-07). 뜻풀이와 조정 여부만 적는다 */
function DecisionCard({ a }: { a: AssessmentDto }) {
  const d = a.decision_components;
  return (
    <section className="card" aria-label="지원가능성">
      <h3>지원가능성</h3>
      <div>
        <CategoryBadge a={a} />
      </div>
      {a.status !== "ready" ? (
        <p>{reasonText(a.reason_code)}{a.status === "ineligible" ? " 지원 조건을 충족하지 않으면 점수 비교를 하지 않습니다." : ""}</p>
      ) : (
        <>
          <p>{CATEGORY[a.category].desc}</p>
          {d?.adjusted_category && (
            <p className="adj">
              점수로 본 판단은 <b>{CATEGORY[d.base_category].label}</b>이지만, 상담 경험을 반영해 <b>{CATEGORY[d.adjusted_category].label}</b>로 조정했습니다.
            </p>
          )}
        </>
      )}
      <span className="note">올해 예상 기준과 대학 발표 자료로 학과마다 따로 판단하며, 판단에 쓰는 기준 점수는 공개하지 않습니다. 지원가능성은 합격 확률이 아닙니다.</span>
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
  // 이 대학 기준 위치만 보여 준다(사용자 지시 2026-10-08): 유불리로 역산한 '전체 기준' 수치는
  // 페이지 상단의 전체 위치와 달라 보일 수 있어(비교 보정 차이) 혼란을 만들므로 적지 않는다
  const uniTop = a.percentile?.inclusive_top_percent ?? a.percentile?.top_percent ?? a.converted_percentile ?? null;
  return (
    <section className="card" aria-label="환산 유불리">
      <h3>환산 유불리</h3>
      <div className={`big num ${tone}`}>
        {n > 0 ? "+" : ""}
        {v.delta_pp}
        <small>%p</small>
      </div>
      <p>
        같은 성적이라도 대학마다 반영하는 과목과 비율이 달라, 어느 대학 방식으로 계산하느냐에 따라 내 위치가 달라집니다.
        {uniTop !== null ? (
          <>
            {" "}이 대학 방식으로는 상위 <b className="num">{uniTop}%</b>이고,
            {v.status === "favorable" ? " 전체 성적(총점) 기준 위치보다 그만큼 올라간 자리입니다" : v.status === "unfavorable" ? " 전체 성적(총점) 기준 위치보다 그만큼 내려간 자리입니다" : " 전체 성적(총점) 기준 위치와 거의 같은 자리입니다"}
            {" "}— 위 숫자가 그 차이입니다.
          </>
        ) : v.status === "favorable" ? (
          " 이 대학 방식이 내 과목 구성에 비교적 유리합니다."
        ) : v.status === "unfavorable" ? (
          " 이 대학 방식이 내 과목 구성에 다소 불리합니다."
        ) : (
          " 이 대학 방식으로 봐도 위치가 거의 같습니다."
        )}
      </p>
      <span className="note">
        지원해도 되는지는 이 숫자가 아니라 왼쪽 <b>지원가능성</b> 판단을 보세요 — 유불리는 비슷한 수준의 대학 중
        어디가 내 과목 구성에 더 잘 맞는지 고를 때 쓰는 보조 지표이며, 유리해도 합격을, 불리해도 지원 불가를 뜻하지 않습니다.
      </span>
    </section>
  );
}

/**
 * 판단 이유를 수험생·학부모가 이해할 수 있게 구체적으로 적는다(최종 관리자 지시 2026-10-08).
 * - 유불리 이유에는 실제 이동 폭(%p)을 붙인다(사용자 자신의 상대값 — 내부 기준 아님).
 * - 범위 이유에는 '공개된 과거 발표값(최종등록자 70%) ↔ 그해 기준 내 환산점수'의 연도별 대조를 붙인다.
 *   올해 판단 기준 점수 자체는 계속 공개하지 않고, 산출 방법·자료판도 화면에 보이지 않는다.
 */
const RANGE_CODES = new Set(["within_acceptance_range", "above_acceptance_range", "below_acceptance_range"]);

function DetailReasons({ a }: { a: AssessmentDto }) {
  const hasRange = (a.recommendation_reasons ?? []).some((r) => RANGE_CODES.has(r.code));
  return (
    <>
      <EnrichedReasonList a={a} />
      {hasRange && <RangeEvidence a={a} />}
    </>
  );
}

/**
 * 범위 판단의 체감 근거(1.9.16 보강): 공개 발표값(그해 최종등록자 70%)과 그해 기준 내 환산점수를
 * '값 나열'로만 보여 준다 — 통계 정의·산출 단계까지 같은지는 화면이 입증할 수 없으므로 추세·비교
 * 해석 문장을 붙이지 않고, 과거 대조 방향으로 올해 기준의 높낮이·원인을 단정하지 않는다.
 * 단위가 '점'이고 발표 척도의 만점이 올해 환산 만점과 같을 때만 같은 척도로 보고 나열한다.
 */
function RangeEvidence({ a }: { a: AssessmentDto }) {
  const metrics = a.decision_evidence?.historical_metrics ?? [];
  const officialMax = a.conversion?.official_max_score != null ? Number(a.conversion.official_max_score) : NaN;
  const scaleMax = (s: string | null | undefined) => {
    const t = s ? /(\d+(?:\.\d+)?)\s*점\s*만점/.exec(s) : null;
    return t ? Number(t[1]) : NaN;
  };
  const rows = a.years
    .map((y) => {
      const same = metrics.filter((x) => x.academic_year === y.academic_year && x.metric_name === "최종등록자 70%");
      const m = same.length === 1 ? same[0] : null; // 같은 이름 중복이면 첫 지표를 고르지 않는다
      if (!m || m.value === null || m.unit !== "점") return null;
      if (!Number.isFinite(officialMax) || scaleMax(m.original_scale) !== officialMax) return null;
      const mine = y.converted_score !== null ? Number(y.converted_score) : NaN;
      if (!Number.isFinite(mine) || !Number.isFinite(Number(m.value))) return null;
      return { year: y.academic_year, mine: y.converted_score!, pub: String(m.value), unit: m.unit };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((x, y) => y.year - x.year)
    .slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <div className="range-ev">
      <p>
        참고로, 발표된 과거 값과 그해 기준 내 환산점수를 나란히 보존해 보여 드립니다 — 만점 숫자({officialMax}점)가 같은
        발표값만 골랐으며, 이것이 연도별 산식·단위·집단까지 같다는 뜻은 아닙니다(동등성은 검수 대상).
      </p>
      <ul>
        {rows.map((r) => (
          <li key={r.year}>
            <b className="num">{r.year}</b> 내 환산 <b className="num">{r.mine}</b>{r.unit} · 발표 최종등록자 70% <b className="num">{r.pub}</b>{r.unit}
          </li>
        ))}
      </ul>
      <p className="caveat">
        통계 정의·산출 단계까지 완전히 같은지는 검수 전이라 값만 보여 드리며, 추세·비교 해석은 하지 않습니다.
        올해 판단은 올해 예상 기준으로 하며, 그 기준 점수는 공개하지 않습니다.
      </p>
    </div>
  );
}

/** 채택본에 결속된 공개 근거(올해 변화·상담 조정·자료판)는 비노출 대상이 아니다 — 1.9.16 보존 요구.
 *  산출 방법(basis) 문구는 최종 관리자 지시대로 계속 보이지 않는다 */
function AdoptedEvidence({ a }: { a: AssessmentDto }) {
  const ev = a.decision_evidence;
  const issues = ev?.issue_summaries ?? [];
  const adj = ev?.adjustment_summary;
  const version = ev?.forecast_release_version ?? null;
  // 버전만 있는 채택본도 자료판 결속을 지우지 않는다(1.9.16 FE-ANALYSIS-02) — 다른 발표본으로 덮지 않음
  if (issues.length === 0 && !adj?.applied && !version) return null;
  return (
    <div className="evidence">
      <h3>
        이 분석이 채택한 발표 자료
        {version && <small> · 자료판 {version}</small>}
      </h3>
      {issues.length === 0 && !adj?.applied ? (
        <p className="ev-only-version">이 판단은 위 자료판에 결속돼 있습니다. 올해 변화·상담 조정 항목은 없습니다.</p>
      ) : (
        <ul>
          {issues.map((t) => <IssueItem key={t.issue_id} t={t} />)}
          {adj?.applied && (
            <li>
              <b>상담 조정</b> {adj.reason ?? "상담 경험을 반영해 기준을 조정했습니다."}
              {adj.version && <small> · {adj.version}</small>}
            </li>
          )}
        </ul>
      )}
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
  // 발표본·정책·입력 버전은 양쪽 모두 비어 있지 않은 문자열이어야 한다. 둘 다 없거나 null 인 것을 '같다'로 보지 않는다
  const id = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
  const pairs: [unknown, unknown][] = [
    [ev.forecast_release_version, f.release_version],
    [ev.policy_version, f.policy_version],
    [ev.input_version, f.input_version],
  ];
  return pairs.every(([a, b]) => id(a) && id(b) && a === b) && CONTEXT_FIELDS.every((k) => k in x && k in y && x[k] === y[k]);
}

/** 발행된 학과별 예상 기준(forecast.published.read). 예상선·합격권·구간표 같은 기준 수치는
 * 화면에 보이지 않는다(최종 관리자 지시 2026-10-07) — 자료판·준비 상태·만든 방법·올해 변화만 적는다 */
function Published({ f, same }: { f: ForecastPublicDto | null; same: boolean }) {
  if (!f || f.status !== "published") return null;
  const ready = f.forecast_70?.status === "ready";
  return (
    <div className="published">
      <h3>
        이 판단에 쓴 자료 <small>자료판 {f.release_version}</small>
      </h3>
      <p>
        올해 예상 기준이 {ready ? "검수를 마치고 준비돼 있습니다." : <span className="wait">아직 발표 대기입니다.</span>}
        {f.adjustment_summary.applied && <> 상담 경험을 반영한 조정이 들어 있습니다.</>}
      </p>
      {f.issue_summaries.length > 0 && (
        <ul className="pub-issues">
          {f.issue_summaries.map((t) => <IssueItem key={t.issue_id} t={t} />)}
        </ul>
      )}
      <span className="note">
        {same
          ? "이 학과의 지원 판단도 이 자료로 계산했습니다. "
          : "이 학과의 지원 판단은 다른 판 자료로 계산됐을 수 있습니다. 최신 기준으로 보려면 성적을 다시 분석해 주세요. "}
        판단에 쓰는 기준 점수는 공개하지 않으며, 이 자료는 실제 합격 확률이나 최저 합격점이 아닙니다.
      </span>
    </div>
  );
}
