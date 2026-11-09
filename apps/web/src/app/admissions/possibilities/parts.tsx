import Link from "@/components/link";
import { CATEGORY, CategoryBadge, EnrichedReasonList, PickButton, decisionReasonCode, isReferenceScore, reasonText, scoreOf, type Cell } from "@/components/offering-parts";
import { DATA_KIND, POPULATION, scoreBasisLabel } from "@/lib/analysis-labels";
import type { ReactNode } from "react";
import type { AssessmentDto, OfferingDto } from "@/lib/dto";
import { page } from "@/lib/routes";
import { IssueItem } from "./recruit-parts";

/**
 * 펼친 줄: 2027 모집 정보(extras 자리, recruit-parts.tsx) + 환산·학교 누백·지원 판단·유불리 + 근거(assessment).
 * 환산·누백·판단은 서로 따로 준비된다(1.7.0). 판단이 보류여도 성공한 환산·누백은 숨기지 않는다.
 */
export function Detail({ o, a, extras, picked }: { o: OfferingDto; a: Cell; extras: ReactNode; picked: boolean }) {
  const p2 = page("PAGE-02").path;
  // 2027 모집 정보·발행 기준은 펼친 뒤 따로 받아 채운다(extras.tsx) — 펼치기를 기다리게 하지 않는다
  const recruit = extras;

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

/** 세 계산의 준비 상태를 따로 보인다 */
function StatusStrip({ a }: { a: AssessmentDto }) {
  const conv = a.conversion?.status ?? (a.converted_score ? "ready" : "pending");
  const ref = isReferenceScore(a) && !!scoreOf(a);
  const pct = a.percentile?.status ?? (a.converted_percentile ? "ready" : "pending");
  const items = [
    { k: "점수 변환", ok: conv === "ready" || ref, label: ref ? "참고 계산" : undefined, why: a.conversion?.reason_code },
    { k: "대학 안 내 위치", ok: pct === "ready", why: a.percentile?.reason_code },
    { k: "지원 판단", ok: a.status === "ready", why: a.status === "ineligible" ? "eligibility_not_met" : decisionReasonCode(a) },
  ];
  return (
    <ul className="strip" aria-label="계산 준비 상태">
      {items.map((i) => (
        <li key={i.k} className={i.ok ? "ok" : "hold"}>
          <b>{i.k}</b> {i.ok ? i.label ?? "준비됨" : "보류"}
          {!i.ok && i.why && <small> · {reasonText(i.why)}</small>}
        </li>
      ))}
    </ul>
  );
}

/** conversion.score_scope 를 사람이 읽는 말로. 모르는 값은 내부 코드라 보이지 않는다 */
const SCOPE: Record<string, string> = { csat_component: "수능 반영분" };

function ConversionCard({ a }: { a: AssessmentDto }) {
  const c = a.conversion;
  const score = scoreOf(a);
  const reference = isReferenceScore(a);
  return (
    <section className="card" aria-label={reference ? "내 참고 환산점수" : "내 환산점수"}>
      <h3>{reference ? "내 참고 환산점수" : "내 환산점수"}</h3>
      {score ? (
        <>
          <div className="big num">
            {score}
            {c?.official_max_score && <small>/ {c.official_max_score}</small>}
          </div>
          <p>
            {!reference && c?.score_scope && SCOPE[c.score_scope] && <>반영 {SCOPE[c.score_scope]} · </>}
            {c?.score_basis && <span className="tag">{scoreBasisLabel(c.score_basis)}</span>}
            {reference && <span className="tag">학교 수능 반영분 · 참고</span>}
          </p>
          {reference && <p>{reasonText("reference_conversion_not_production_approved")}</p>}
        </>
      ) : (
        <>
          <div className="big hold">계산 보류</div>
          <p>{reasonText(c?.reason_code ?? a.reason_code)}</p>
        </>
      )}
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
          {(kind || pop) && (
            <p className="tags">
              {kind && <span className="tag">{kind.label}</span>}
              {pop && <span className="tag">{pop.label}</span>}
            </p>
          )}
          <span className="note">이 숫자만으로 유불리·합격 여부를 판단하지 않습니다 — 판단은 <b>지원가능성</b> 칸이 담당합니다.</span>
        </>
      ) : (
        <>
          <div className="big hold">누백 보류</div>
          <p>{reasonText(p?.reason_code) || "이 대학 환산 분포가 아직 준비되지 않았습니다."}</p>
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
        <p>{reasonText(decisionReasonCode(a))}{a.status === "ineligible" ? " 지원 조건을 충족하지 않으면 점수 비교를 하지 않습니다." : ""}</p>
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
      <span className="note">지원가능성은 합격 확률이 아닙니다.</span>
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
              : reasonText(decisionReasonCode(a)) || "비교할 수 있는 분포와 환산 자료를 확인하고 있습니다."}
        </p>
      </section>
    );
  }
  const n = Number(v.delta_pp);
  const tone = v.status === "neutral" ? "even" : n > 0 ? "up" : "down";
  // 설명은 한 줄로(사용자 지시 2026-10-08). 판정이 추천 범위 밖인데 유불리가 양수면
  // '유리해 보이지만 판정이 우선'임을 바로 적어 모순처럼 읽히지 않게 한다
  const outsideButFavorable = a.status === "ready" && a.category === "outside" && v.status === "favorable";
  return (
    <section className="card" aria-label="환산 유불리">
      <h3>환산 유불리</h3>
      <div className={`big num ${tone}`}>
        {n > 0 ? "+" : ""}
        {v.delta_pp}
        <small>%p</small>
      </div>
      <p>
        {v.status === "favorable"
          ? "이 대학 반영식이 내 과목 구성에 비교적 잘 맞아, 전체 성적 기준보다 위치가 이만큼 올라갑니다."
          : v.status === "unfavorable"
            ? "이 대학 반영식에서는 전체 성적 기준보다 위치가 이만큼 내려갑니다."
            : "이 대학 반영식으로 계산해도 전체 성적 기준과 위치가 거의 같습니다."}
        {outsideButFavorable && <b> 다만 유리해 보여도 이 학과는 올해 추천 범위 밖입니다 — 왼쪽 판정이 우선입니다.</b>}
      </p>
      <span className="note">지원 여부 판단과는 별개인 보조 지표입니다 — 판단은 <b>지원가능성</b> 칸.</span>
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

