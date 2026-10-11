import { togglePick } from "@/app/shortlist-actions";
import type { AssessmentDto, Category, ReasonDto, StatisticsDto } from "@/lib/dto";
import { seoulDate } from "@/lib/format";

/* 3·4페이지(와 2페이지 유료 부분)가 같이 쓰는 모집단위 칸. 응답 모양은 assessment·statistics DTO */

/** 학과마다의 지원 판단(assessment.category). 색과 함께 점 모양으로도 구분, 빨강은 '지원 조건 미충족'에만.
 * desc 는 입시 용어에 익숙하지 않은 사용자(수험생·학부모)를 위한 쉬운 풀이 — 기준 점수는 적지 않는다 */
export const CATEGORY: Record<Category, { cls: string; label: string; desc: string }> = {
  challenge: { cls: "reach", label: "도전", desc: "지금 점수보다 다소 높은 곳이지만, 남은 기간을 보고 노려볼 수 있는 범위입니다." },
  core: { cls: "core", label: "핵심 검토", desc: "올해 적극적으로 검토해 볼 만한 범위입니다." },
  room: { cls: "safe", label: "여유 후보", desc: "내 점수에 비교적 여유가 있는 범위입니다. 그래도 합격이 보장되는 것은 아닙니다." },
  outside: { cls: "out", label: "추천 범위 밖", desc: "올해 기준으로는 추천 범위에 들지 않습니다. 지원 자체가 불가능하다는 뜻은 아닙니다." },
  pending: { cls: "check", label: "판단 보류", desc: "판단에 필요한 자료가 아직 갖춰지지 않아 결론을 내리지 않았습니다." },
  ineligible: { cls: "inel", label: "지원 조건 미충족", desc: "이 전형이 요구하는 지원 조건(과목·자격)을 충족하지 않습니다." },
};

/** 판단 보류·자격 확인의 이유(서버 reason_code) */
const REASON: Record<string, string> = {
  eligibility_confirmation_required: "지원 자격을 확인해야 합니다.",
  eligibility_not_met: "입력한 성적으로는 이 전형의 지원 자격을 충족하지 않습니다.",
  decision_range_unconfirmed: "올해 판단 구간이 아직 확정되지 않았습니다.",
  decision_policy_missing: "이 모집단위의 판단 기준이 아직 없습니다.",
  decision_policy_not_approved: "판단 기준을 검수하고 있습니다.",
  decision_evidence_unapproved: "판단 근거 자료를 검수하고 있습니다.",
  comparison_distribution_missing: "비교할 환산 분포가 아직 없습니다.",
  analysis_release_missing: "이 모집단위의 환산 자료가 아직 없습니다.",
  analysis_release_not_approved: "환산 자료를 검수하고 있습니다.",
  analysis_pack_mismatch: "입력한 시험과 환산 자료의 버전이 맞지 않습니다.",
  target_distribution_missing: "그해 비교 분포가 아직 없습니다.",
  total_model_missing: "전체 누적 곡선이 아직 발행되지 않았습니다.",
  year_bridge_required: "과거 학년도 모집행과 올해 성적을 잇는 연도 연계 자료가 아직 없습니다.",
  conversion_not_ready: "환산 결과가 준비되지 않아 이 대학 위치를 계산하지 않았습니다.",
  offering_analysis_pending: "올해 모집행과 대학 분석 자료가 결속되기 전이라 후보 산출을 보류했습니다.",
  counselor_adjustment_unapproved: "상담 조정 기준을 검수하고 있습니다.",
  percentile_curve_unpublished: "이 대학 환산 분포가 아직 발행되지 않았습니다.",
  percentile_conversion_context_missing: "환산 척도 근거가 없어 대학 위치를 계산하지 않았습니다.",
  advantage_population_mismatch: "비교집단이 전체 응시자와 달라 유불리를 보류합니다.",
  forecast_70_not_published: "올해 70% 예상선이 아직 발행되지 않았습니다.",
  forecast_not_published: "학과별 예상 기준이 아직 발행되지 않았습니다.",
};
export const reasonText = (code: string | null | undefined) => (code ? REASON[code] ?? "자료를 확인하고 있습니다." : "");

export function CategoryBadge({ a }: { a: AssessmentDto }) {
  if (a.status === "pending" && a.eligibility_status === "needs_confirmation") return <span className="st check">자격 확인 필요</span>;
  const c = CATEGORY[a.category];
  return <span className={`st ${c.cls}`}>{c.label}</span>;
}

export function CategoryLegend() {
  return (
    <span className="legend" aria-label="지원가능성 표시">
      {Object.values(CATEGORY).map((c) => (
        <span key={c.cls} className={`st ${c.cls}`}>{c.label}</span>
      ))}
    </span>
  );
}

export type Cell = AssessmentDto | null | "need";

export function ScoreCell({ a }: { a: Cell }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a) return <span className="need">분석 대기</span>;
  if (!a.converted_score) return <span className="need">계산 보류</span>;
  return (
    <span className="score">
      <b className="num">{a.converted_score}</b>
      {a.converted_percentile && <small>상위 {a.converted_percentile}%</small>}
    </span>
  );
}

export function StatusCell({ a }: { a: Cell }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a) return <span className="need">분석 대기</span>;
  return <CategoryBadge a={a} />;
}

/** 환산 유불리: 같은 비교집단에서 보정 총점 기준 위치 − 대학 환산 기준 위치(%p). 양수면 유리 */
export function AdvantageCell({ a }: { a: Cell }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a || !a.advantage) return <span className="need">판단 보류</span>;
  const n = Number(a.advantage.delta_pp);
  const tone = a.advantage.status === "neutral" || Math.abs(n) < 0.1 ? "even" : n > 0 ? "up" : "down";
  const width = Math.min(50, (Math.abs(n) / 0.6) * 50);
  return (
    <span className="adv">
      <span className="bar" aria-hidden="true">{tone !== "even" && <i className={n > 0 ? "up" : "down"} style={{ width: `${width}%` }} />}</span>
      <span className={`v num ${tone}`}>
        {n > 0 ? "+" : ""}
        {a.advantage.delta_pp}%p
      </span>
    </span>
  );
}

export function PickButton({ id, on, variant = "pill" }: { id: string; on: boolean; variant?: "pill" | "wide" | "wild" }) {
  return (
    <form action={togglePick} className={variant === "wild" ? "pick-wild" : undefined}>
      <input type="hidden" name="offering_id" value={id} />
      <input type="hidden" name="selected" value={on ? "0" : "1"} />
      {variant === "pill" ? (
        <button className={`pick${on ? " on" : ""}`} aria-pressed={on}>
          {on ? "담음" : "담기"}
        </button>
      ) : variant === "wide" ? (
        <button className={`btn${on ? "" : " t"}`}>{on ? "핵심 지원 학교에서 빼기" : "핵심 지원 학교에 담기"}</button>
      ) : (
        <button className={on ? "on" : undefined} aria-pressed={on}>
          {on ? "핵심 지원 학교에 담음" : "핵심 지원 학교에 담기"}
        </button>
      )}
    </form>
  );
}

/** REQ-10: 서비스 안의 추천·선택 인원과 내 순위. 실제 대학 지원자 수가 아니다 */
export function StatsLine({ s }: { s: StatisticsDto | null | undefined }) {
  if (!s || s.status !== "ready" || s.recommended_count === null) return <span className="stats wait">추천·선택 집계 준비 중</span>;
  const r = s.selected_rank ?? s.recommended_rank;
  return (
    <span className="stats">
      추천 <b className="num">{s.recommended_count}</b>명 · 담음 <b className="num">{s.selected_count}</b>명
      {r && (
        <>
          {" "}· {s.selected_rank ? "담은 사람" : "추천받은 사람"} 중 <b className="num">{r.rank}</b>위
          {r.tie_count > 1 ? <> (같은 점수 {r.tie_count}명)</> : null}
        </>
      )}
      {s.updated_at && <small> {seoulDate(s.updated_at)} 기준</small>}
    </span>
  );
}

/** 이유 코드 → 기준 수치 없는 쉬운 문장 (최종 관리자 지시 2026-10-07: 내부 판단 기준·구간 점수는 화면에 노출하지 않는다).
 * 서버 문장(r.text)에는 구간·기준점 수치가 들어올 수 있어 그대로 보이지 않고, 코드마다 화면 문구를 둔다.
 * 모르는 코드는 수치가 섞였을 수 있으므로 서버 문장 대신 일반 안내로 보인다. */
const REASON_PLAIN: Record<string, string> = {
  within_acceptance_range: "내 점수가 올해 이 학과에 지원해 볼 만한 범위 안에 있습니다.",
  above_acceptance_range: "내 점수가 올해 지원해 볼 만한 범위보다 여유 있게 높습니다.",
  below_acceptance_range: "내 점수가 올해 지원해 볼 만한 범위에 조금 못 미칩니다.",
  // 위치 이동 계열 코드의 기본 문구는 방향을 단정하지 않는다(1.9.16 FE-ANALYSIS-03).
  // 코드·advantage 상태·부호가 전부 맞을 때의 방향 문장은 enrichedReasonTexts 가 만든다
  conversion_advantage: "이 대학 환산 방식에서의 위치 변화가 판단에 반영됐습니다(자세한 폭은 유불리 칸에서 확인).",
  converted_score_position_gain: "이 대학 환산 방식에서의 위치 변화가 판단에 반영됐습니다(자세한 폭은 유불리 칸에서 확인).",
  converted_score_position_loss: "이 대학 환산 방식에서의 위치 변화가 판단에 반영됐습니다(자세한 폭은 유불리 칸에서 확인).",
  converted_score_position_equal: "이 대학 환산 방식에서의 위치 변화가 판단에 반영됐습니다(자세한 폭은 유불리 칸에서 확인).",
  counselor_adjustment: "입시 상담 경험을 반영해 판단을 한 단계 조정했습니다.",
  forecast_basis_trend: "최근 3년 대학 발표 결과의 흐름으로 올해 기준을 잡았습니다.",
  approved_forecast_70: "검수를 마친 올해 예상 기준으로 판단했습니다.",
};
export const plainReason = (r: ReasonDto) => REASON_PLAIN[r.code] ?? "올해 예상 기준과 대학 발표 자료로 판단했습니다.";

/** 서버가 만든 이유 목록(recommendation_reasons)을 기준 수치 없는 화면 문구로 바꿔 보인다. 같은 문구는 한 번만 */
export function ReasonList({ items, max }: { items: ReasonDto[]; max?: number }) {
  const shown = max ? items.slice(0, max) : items;
  const texts = [...new Set(shown.map(plainReason))];
  return (
    <ul className="reason-list">
      {texts.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/** 판단 이유 구체화(최종 관리자 지시 2026-10-08, 3·4페이지 공용): 유불리 이유에는 실제 이동 폭(%p,
 *  사용자 자신의 상대값)을 붙인다. 내부 기준 점수는 여전히 적지 않는다.
 *  1.9.16: 등록 코드(gain/loss/equal)·advantage 상태·부호가 정확히 맞을 때만 수치를 붙이고,
 *  음수를 '잘 맞는다'로 말하지 않으며 0은 '같은 위치'로 적는다. 어긋나면 일반 문구로 보존한다. */
export function enrichedReasonTexts(a: AssessmentDto, max?: number): string[] {
  const adv = a.advantage;
  const n = adv ? Number(adv.delta_pp) : null;
  const items = max ? (a.recommendation_reasons ?? []).slice(0, max) : a.recommendation_reasons ?? [];
  return [...new Set(items.map((r) => {
    // 등록 코드·advantage 준비 상태·부호가 전부 일치할 때만 방향·수치를 적는다.
    // 미등록 conversion_advantage 는 gain 별칭으로 확정하지 않고, 불일치·보류는 방향을 단정하지 않는다
    if (r.code === "converted_score_position_gain" && adv?.status === "favorable" && n !== null && Number.isFinite(n) && n > 0)
      return `이 대학 반영식으로 계산하면 전체 성적 기준보다 내 위치가 +${adv.delta_pp}%p 올라갑니다 — 내 선택과목·점수 구성이 이 대학의 과목 반영 비율과 비교적 잘 맞는다는 뜻입니다.`;
    if (r.code === "converted_score_position_loss" && adv?.status === "unfavorable" && n !== null && Number.isFinite(n) && n < 0)
      return `이 대학 반영식으로 계산하면 전체 성적 기준보다 내 위치가 ${adv.delta_pp}%p 내려갑니다.`;
    if (r.code === "converted_score_position_equal" && adv?.status === "neutral")
      return "이 대학 반영식으로 계산해도 전체 성적 기준과 내 위치가 거의 같습니다.";
    return plainReason(r);
  }))];
}

export function EnrichedReasonList({ a, max }: { a: AssessmentDto; max?: number }) {
  const texts = enrichedReasonTexts(a, max);
  if (texts.length === 0) return null;
  return (
    <ul className="reason-list">
      {texts.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}
