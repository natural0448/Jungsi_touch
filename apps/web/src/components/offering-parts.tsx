import type { AssessmentDto, BandCode, Category, OverallResultDto, ReasonDto, StatisticsDto } from "@/lib/dto";
import { referenceAdvantage } from "@/lib/reference-advantage";
import { pctText, seoulDate } from "@/lib/format";
import { POSITION_NONE_DESC, POSITION_NONE_LABEL, positionNoteOf, positionNoteShort } from "@/lib/position-note";

/* 3·4페이지(와 2페이지 유료 부분)가 같이 쓰는 모집단위 칸. 응답 모양은 assessment·statistics DTO */

/** 학과마다의 지원 판단(assessment.category). 색과 함께 점 모양으로도 구분, 빨강은 '지원 조건 미충족'에만.
 * desc 는 입시 용어에 익숙하지 않은 사용자(수험생·학부모)를 위한 쉬운 풀이 — 기준 점수는 적지 않는다 */
export const CATEGORY: Record<Category, { cls: string; label: string; desc: string }> = {
  challenge: { cls: "reach", label: "도전", desc: "지금 점수보다 다소 높아 결과를 장담하기 어렵지만, 지원해 볼 수 있는 범위입니다." },
  core: { cls: "core", label: "핵심 검토", desc: "올해 적극적으로 검토해 볼 만한 범위입니다." },
  room: { cls: "safe", label: "여유 후보", desc: "내 점수에 비교적 여유가 있는 범위입니다. 그래도 합격이 보장되는 것은 아닙니다." },
  outside: { cls: "out", label: "검토 범위 밖", desc: "올해 기준으로는 지원 검토 범위에 들지 않습니다. 지원 자체가 불가능하다는 뜻은 아닙니다." },
  pending: { cls: "check", label: "판단 보류", desc: "판단에 필요한 자료가 아직 갖춰지지 않아 결론을 내리지 않았습니다." },
  ineligible: { cls: "inel", label: "지원 조건 미충족", desc: "이 전형이 요구하는 지원 조건(과목·자격)을 충족하지 않습니다." },
};

/** 7단계 판정(assessment.band). 예상 합격권 폭의 15%·30% 를 경계로 가른다. 색은 기존 세 묶음(여유·핵심·도전)을 그대로 쓴다 */
export const BAND: Record<BandCode, { cls: string; label: string; desc: string }> = {
  stable: { cls: "safe", label: "안정", desc: "예상 합격권보다 충분히 앞선 위치입니다. 그래도 합격이 보장되는 것은 아닙니다." },
  downward: { cls: "safe", label: "하향", desc: "예상 합격권보다 조금 앞선 위치입니다." },
  target: { cls: "core", label: "적정", desc: "예상 합격권 안에서 앞쪽 절반에 드는 위치입니다." },
  aspirational: { cls: "core", label: "소신", desc: "예상 합격권 안에서 뒤쪽 절반에 드는 위치입니다." },
  upward: { cls: "reach", label: "상향", desc: "예상 합격권에서 조금 벗어난 위치입니다." },
  challenge: { cls: "reach", label: "도전", desc: "예상 합격권에서 꽤 벗어나 결과를 장담하기 어려운 위치입니다." },
  outside: { cls: "out", label: "불가", desc: "예상 합격권에서 많이 벗어난 위치입니다. 지원 자격이 없다는 뜻은 아닙니다." },
};
/** 화면에 보일 판정 이름·풀이. 7단계가 오면 그것을, 아니면 기존 category 를 쓴다 */
export const decisionOf = (a: AssessmentDto) => (a.status === "ready" && a.band && BAND[a.band.code] ? BAND[a.band.code] : CATEGORY[a.category]);

/** 판단 보류·자격 확인의 이유(서버 reason_code) */
const REASON: Record<string, string> = {
  eligibility_confirmation_required: "지원 자격을 확인해야 합니다.",
  eligibility_not_met: "입력한 성적으로는 이 전형의 지원 자격을 충족하지 않습니다.",
  designated_subject_not_taken: "이 전형이 지정한 과목을 응시하지 않아 지원할 수 없습니다.",
  decision_range_unconfirmed: "올해 판단 구간이 아직 확정되지 않았습니다.",
  decision_policy_missing: "이 모집단위의 판단 기준이 아직 없습니다.",
  decision_policy_not_approved: "판단 기준을 검수하고 있습니다.",
  decision_evidence_unapproved: "판단 근거 자료를 검수하고 있습니다.",
  comparison_distribution_missing: "비교할 환산 분포가 아직 없습니다.",
  // 아래 3코드는 지원 판단용 OfferingAnalysis 자료의 보류를 뜻한다(서버 offering_analysis.py)
  // — 환산 성공과 독립이라 환산 자료가 없다는 표현을 쓰지 않는다
  analysis_release_missing: "지원 판단에 필요한 이 모집단위의 분석 기준이 아직 없습니다.",
  analysis_release_not_approved: "이 모집단위의 지원 판단 기준을 검수하고 있습니다.",
  analysis_pack_mismatch: "입력한 시험과 판단 자료의 기준 시험이 달라 판단하지 않았습니다.",
  target_distribution_missing: "그해 비교 분포가 아직 없습니다.",
  total_model_missing: "전체 위치를 계산할 자료가 아직 연결되지 않았습니다. 기다린다고 계산되는 것은 아니니, 같은 성적을 다시 저장하지 않으셔도 됩니다.",
  year_bridge_required: "지난해 결과를 올해 성적과 비교할 자료가 아직 없습니다.",
  reference_conversion_not_production_approved: "이 대학의 수능 반영 방식(영역 비율·점수 종류)대로 계산한 내 점수입니다. 같은 대학 안의 다른 학과와 비교할 때 쓰세요.",
  reference_conversion_unavailable: "이 모집단위의 참고 환산 자료를 확인하고 있습니다.",
  reference_conversion_missing: "이 모집단위의 참고 환산 자료를 연결하고 있습니다.",
  reference_exam_context_mismatch: "입력한 시험과 학교 참고 환산 자료가 일치하지 않습니다.",
  reference_offering_context_mismatch: "모집단위와 학교 환산식의 연결을 확인하고 있습니다.",
  reference_rule_context_mismatch: "모집단위와 학교 환산식의 연결을 확인하고 있습니다.",
  reference_rule_unsupported: "이 학교 환산식을 연결하고 있습니다.",
  reference_required_input_missing: "참고 점수 계산에 필요한 성적 항목이 없습니다.",
  reference_inquiry_category_unsupported: "이 모집단위는 선택한 탐구 과목을 반영하지 않아 참고 점수를 계산하지 않았습니다.",
  reference_inquiry_incomplete: "탐구 성적 자료를 연결하고 있습니다.",
  conversion_release_missing: "이 모집단위의 참고 환산 자료를 연결하고 있습니다.",
  // 화면 전용: 참고 점수만 계산되고 지원 판단 기준은 아직 없을 때(assessment.reason_code 가 참고 코드로 올 때)
  reference_decision_pending: "점수 위치로 비교하고, 지원 자격은 모집요강에서 직접 확인하세요.",
  reference_score_outside_domain: "이 환산식의 확인된 계산 범위를 벗어나 참고 점수를 표시하지 않았습니다.",
  conversion_not_ready: "환산 결과가 준비되지 않아 이 대학 위치를 계산하지 않았습니다.",
  offering_analysis_pending: "올해 모집 정보와 대학 분석 자료를 맞춰 보는 중이라 후보를 아직 만들지 않았습니다.",
  counselor_adjustment_unapproved: "상담 조정 기준을 검수하고 있습니다.",
  percentile_curve_unpublished: "이 대학 환산 분포가 아직 준비되지 않았습니다.",
  percentile_release_missing: "이 대학의 환산 분포 자료가 아직 준비되지 않아 대학 안 위치를 계산하지 않았습니다.",
  percentile_conversion_context_missing: "이 대학 환산점수를 위치로 바꿀 자료가 없어 대학 안 위치를 계산하지 않았습니다.",
  advantage_population_mismatch: "비교하는 학생 범위가 전체 응시자와 달라 유불리를 보여 드리지 않습니다.",
  forecast_70_not_published: "올해 70% 예상선이 아직 준비되지 않았습니다.",
  forecast_not_published: "학과별 예상 기준이 아직 준비되지 않았습니다.",
};
export const reasonText = (code: string | null | undefined) => (code ? REASON[code] ?? "자료를 확인하고 있습니다." : "");

const REFERENCE_CODE = "reference_conversion_not_production_approved";
/** 참고 점수(학교 수능 반영분, 운영 확정본 아님)인지. 서버는 conversion.status 를 pending 이나 reference_calculated 로 보낸다 */
export const isReferenceScore = (a: AssessmentDto) =>
  a.conversion?.status === "reference_calculated" || a.conversion?.reason_code === REFERENCE_CODE || a.reason_code === REFERENCE_CODE;
/** 화면에 보일 내 환산점수. 참고 점수도 포함한다 */
export const scoreOf = (a: AssessmentDto) => a.conversion?.converted_score ?? a.converted_score;
/** 지원 판단 칸의 보류 이유. 참고 코드가 판단 이유로 오면 '판단 기준 확인 중'으로 바꿔 보인다 */
export const decisionReasonCode = (a: AssessmentDto) => (a.reason_code === REFERENCE_CODE ? "reference_decision_pending" : a.reason_code);

/** 참고 기준 판정을 보일지. 정식 판정이 난 곳(ready)·자격 미충족에는 보이지 않는다 */
export const referenceBandOf = (a: AssessmentDto) => (a.status !== "ready" && a.status !== "ineligible" && a.reference_band && BAND[a.reference_band.code] ? a.reference_band : null);
/** 9월 전국 추정 경계로 낸 참고 판정인지(대표님 결정 2026-11-20: 근거 확인 뒤 3페이지만). 기존 승인판과 구분해 '추정 참고'로 보인다 */
export const isModeledReferenceBand = (r: NonNullable<AssessmentDto["reference_band"]>) => r.policy_version.startsWith("20261120.september-national-modeled.");
/** 참고 기준 판정의 이름. 누백이 범위라 양끝의 판정이 다르면 '적정~도전'처럼 함께 적는다 */
export const referenceBandLabel = (r: NonNullable<AssessmentDto["reference_band"]>) => (r.upper_code && BAND[r.upper_code] && r.upper_code !== r.code ? `${BAND[r.code].label}~${BAND[r.upper_code].label}` : BAND[r.code].label);

export function CategoryBadge({ a, overall }: { a: AssessmentDto; overall?: OverallResultDto | null }) {
  const ref = referenceBandOf(a);
  if (ref) {
    // 색은 불리한 끝 기준(더 조심스러운 쪽). 정식 판정과 구분되게 '참고'를 붙인다
    const tone = BAND[ref.upper_code && BAND[ref.upper_code] ? ref.upper_code : ref.code];
    const modeled = isModeledReferenceBand(ref);
    return <span className={`st ${tone.cls} refj`} title={`${modeled ? "추정 경계로 낸 참고 판정" : "참고 기준 판정"} · 지원 자격은 모집요강에서 확인하세요`}>{referenceBandLabel(ref)} <small>{modeled ? "추정 참고" : "참고"}</small></span>;
  }
  // 판정 경계가 없는 곳의 종료 표시(대표님 결정 2026-11-20): 지난해 합격선 대비 위치, 또는 판정 근거 부족
  const pn = positionNoteOf(a, overall);
  if (pn) {
    if (pn.kind === "none") return <span className="st check" title={POSITION_NONE_DESC}>{POSITION_NONE_LABEL}</span>;
    return <span className={`st pos ${pn.margin.side}`} title={`${pn.margin.text} · 판정이 아닌 위치 비교입니다`}>{positionNoteShort(pn)} <small>참고</small></span>;
  }
  if (a.status === "pending" && a.eligibility_status === "needs_confirmation") return <span className="st check" title="이 모집단위의 판정 자료가 아직 준비되지 않았습니다. 지원 자격은 모집요강에서 확인하세요">판정 준비 중</span>;
  const c = decisionOf(a);
  return <span className={`st ${c.cls}`}>{c.label}</span>;
}

export function CategoryLegend() {
  return (
    <span className="legend" aria-label="지원가능성 표시">
      {[...Object.values(BAND), { cls: "pos near", label: "합격선 대비 위치" }, { cls: "check", label: POSITION_NONE_LABEL }, CATEGORY.ineligible].map((c) => (
        <span key={c.label} className={`st ${c.cls}`}>{c.label}</span>
      ))}
    </span>
  );
}

export type Cell = AssessmentDto | null | "need";

export function ScoreCell({ a }: { a: Cell }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a) return <span className="need">분석 대기</span>;
  const score = scoreOf(a);
  if (!score) return <span className="need">계산 보류</span>;
  return (
    <span className="score">
      <b className="num">{score}</b>
      {isReferenceScore(a) && <small className="ref">참고</small>}
      {a.converted_percentile && <small>상위 {pctText(a.converted_percentile)}%</small>}
    </span>
  );
}

export function StatusCell({ a, overall }: { a: Cell; overall?: OverallResultDto | null }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a) return <span className="need">분석 대기</span>;
  return <CategoryBadge a={a} overall={overall} />;
}

/** 환산 유불리: 같은 비교집단에서 보정 총점 기준 위치 − 대학 환산 기준 위치(%p). 양수면 유리 */
/** 환산 유불리의 방향을 글자로도 적는다(대표님 지적 2026-11-18: 숫자만으로는 좋은 신호인지 알 수 없다) */
export const ADVANTAGE_WORD: Record<"up" | "down" | "even", string> = { up: "유리", down: "불리", even: "비슷" };

export function AdvantageCell({ a, overall }: { a: Cell; overall?: OverallResultDto | null }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (a && !a.advantage) {
    // 서버 유불리가 없을 때만 대학 참고 누백으로 참고 유불리를 보인다(R16, 2026-11-16)
    const ref = referenceAdvantage(a.reference_percentile, overall);
    if (ref) {
      const width = Math.min(50, (Math.abs(ref.mid) / 0.6) * 50);
      return (
        <span className="adv">
          <span className="bar" aria-hidden="true">{ref.tone !== "even" && <i className={ref.tone} style={{ width: `${width}%` }} />}</span>
          <span className={`v num ${ref.tone}`}><b className="advw">{ADVANTAGE_WORD[ref.tone]}</b> {ref.text}%p <small className="ref">참고</small></span>
        </span>
      );
    }
  }
  if (!a || !a.advantage) return <span className="need">판단 보류</span>;
  const n = Number(a.advantage.delta_pp);
  const tone = a.advantage.status === "neutral" || Math.abs(n) < 0.1 ? "even" : n > 0 ? "up" : "down";
  const width = Math.min(50, (Math.abs(n) / 0.6) * 50);
  return (
    <span className="adv">
      <span className="bar" aria-hidden="true">{tone !== "even" && <i className={n > 0 ? "up" : "down"} style={{ width: `${width}%` }} />}</span>
      <span className={`v num ${tone}`}>
        <b className="advw">{ADVANTAGE_WORD[tone]}</b> {n > 0 ? "+" : ""}
        {a.advantage.delta_pp}%p
      </span>
    </span>
  );
}

// 담기·빼기는 실패 이유를 보여야 해서 클라이언트 컴포넌트로 옮겼다. 기존 import 경로는 그대로 둔다
export { PickButton } from "./pick-button";

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
