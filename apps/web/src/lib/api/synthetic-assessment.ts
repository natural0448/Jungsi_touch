import type { AssessmentDto, Category, CandidatesDto, OfferingDto, OverallAnalysisDto, ScoresInput, StatisticsDto } from "@/lib/dto";
import { HISTORY, HISTORY_OFFERINGS } from "./synthetic-history";

/*
  3·4페이지 합성 응답 — 실제 assessment·candidates·statistics DTO 모양으로 만든다.
  2페이지에서 저장한 성적(같은 쿠키)으로 계산해 2·3·4페이지의 숫자가 서로 맞는다.
  반영 비율·기준 점수·구간은 모두 지어낸 값이며 실제 대학 규칙이 아니다.
*/

/** 2027 모집행 = 1페이지 합성 자료의 2027 행(같은 번호를 쓴다) */
export const CATALOG: OfferingDto[] = HISTORY_OFFERINGS.filter((o) => o.academic_year === 2027);

type Rule = { wk: number; wm: number; wi: number; center: number; band: number };
/** 대학별 합성 반영 비율과 기준 점수(대학 환산점수 척도) */
const RULE: Record<string, Rule> = {
  "syn-gaon": { wk: 0.3, wm: 0.4, wi: 0.3, center: 915, band: 4 },
  "syn-raon": { wk: 0.2, wm: 0.5, wi: 0.3, center: 648, band: 3 },
  "syn-daon": { wk: 0.33, wm: 0.34, wi: 0.33, center: 695, band: 4 },
  "syn-haesol": { wk: 0.35, wm: 0.25, wi: 0.4, center: 545, band: 4 },
  "syn-saebit": { wk: 0.2, wm: 0.3, wi: 0.5, center: 466, band: 3 },
  "syn-hanbit": { wk: 0.45, wm: 0.25, wi: 0.3, center: 896, band: 5 },
};
/** 학과마다 기준을 따로 둔다(같은 대학이어도 판단이 다르다) */
const OFFSET: Record<string, number> = { "syn-g1": 6, "syn-g2": 0, "syn-g3": 22, "syn-g4": 0, "syn-r1": 5, "syn-r2": 0, "syn-d1": 0, "syn-d2": -9, "syn-h1": -12, "syn-h2": -1, "syn-h3": 0, "syn-s1": 0, "syn-e1": -2 };
const BASE = (id: string) => id.replace(/-\d{4}$/, "");

const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

function zOf(s: ScoresInput) {
  const iavg = (s.inquiry[0].standard_score + s.inquiry[1].standard_score) / 2;
  return { k: (s.korean.standard_score - 128) / 9, m: (s.math.standard_score - 128) / 10, i: (iavg - 63) / 5 };
}

/** 모집단위 하나의 개인 분석. 실제 엔진처럼 판단 보류·자격 미충족도 낸다 */
export function assess(o: OfferingDto, scores: ScoresInput, overall: OverallAnalysisDto): AssessmentDto {
  const id = o.offering_id;
  const base = BASE(id);
  const rule = RULE[o.university_id];
  const blocked = (reason: string): AssessmentDto => ({
    offering_id: id, status: "pending", reason_code: reason, converted_score: null, converted_percentile: null,
    category: "pending", advantage: null, years: [], versions: {}, eligibility_status: "needs_confirmation",
  });
  if (!rule) return blocked("analysis_release_missing");
  if (overall.overall.status === "pending" || !overall.overall.inclusive_top_percent) return blocked(overall.overall.reason_code ?? "total_model_missing");

  const z = zOf(scores);
  const zw = rule.wk * z.k + rule.wm * z.m + rule.wi * z.i;
  // 내 환산점수는 대학 반영식만으로 정해지고, 판단 기준(center)은 학과마다 다르다
  const score = rule.center + rule.band * 2 * zw;
  const center = rule.center + (OFFSET[base] ?? 0);
  const overallPct = Number(overall.overall.inclusive_top_percent);
  const adv = (zw - (z.k + z.m + z.i) / 3) * 4;
  const convPct = Math.max(0.01, overallPct * Math.exp(-adv));
  const delta = overallPct - convPct;

  const years = [2024, 2025, 2026, 2027].map((y) => ({
    academic_year: y, offering_id: `${base}-${y}`, score_basis: "year_equated_estimate",
    converted_score: fmt(score - (2027 - y) * rule.band * 0.25), status: "ready", reason_code: null,
  }));
  const versions = { analysis: "SYNTHETIC-analysis-v1", profile: "synthetic", pack: scores.pack_version, source_model: overall.overall.model_version ?? "", bridge: "SYNTHETIC-bridge-v1", rule: `SYNTHETIC-rule-${o.university_id}` };
  const historical_metrics = HISTORY.filter((h) => h.offering_id.startsWith(`${base}-`) && h.academic_year < 2027).map((h) => ({
    academic_year: h.academic_year, metric_name: h.metric_name, metric_definition: h.metric_definition, value: h.value, unit: h.unit,
    original_scale: h.original_scale, publication_status: h.publication_status, source_url: h.source_url, source_as_of: h.source_as_of,
  }));
  const forecastPending = base === "syn-g3";
  const decision_evidence = {
    version: "SYNTHETIC-evidence-v1",
    historical_metrics,
    forecast_70: forecastPending
      ? { status: "pending" as const, reason_code: "forecast_70_not_published", value: null, unit: null, definition: null, version: null }
      : { status: "ready" as const, reason_code: null, value: fmt(center - rule.band), unit: "점", definition: "올해 최종등록자 70% 예상 기준선(합성)", version: "SYNTHETIC-forecast-v1" },
    expected_acceptance_range: { lower: fmt(center - rule.band), upper: fmt(center + rule.band), unit: "점", definition: "지원 판단용 채택 구간(합성). 이 구간이면 핵심 검토", policy_version: `SYNTHETIC-policy-${base}` },
  };

  const result: AssessmentDto = {
    offering_id: id, status: "pending", reason_code: null, converted_score: fmt(score), converted_percentile: fmt(convPct),
    category: "pending", advantage: null, years, versions, eligibility_status: "eligible", decision_evidence,
  };
  // 자유전공: 올해 판단 구간이 확정되지 않아 보류(환산점수·위치는 보인다)
  if (base === "syn-g4") return { ...result, reason_code: "decision_range_unconfirmed", decision_evidence: undefined };
  // 군사학과: 영어 1등급 이내 조건(합성). 등급이 없으면 확인 필요, 넘으면 미충족
  if (base === "syn-h3") {
    if (scores.english_grade === undefined) return { ...result, eligibility_status: "needs_confirmation", reason_code: "eligibility_confirmation_required" };
    if (scores.english_grade > 1) return { ...result, status: "ineligible", category: "ineligible", eligibility_status: "ineligible", reason_code: "eligibility_not_met" };
  }
  const cat: Category = score >= center + rule.band ? "room" : score >= center - rule.band ? "core" : score >= center - rule.band * 3 ? "challenge" : "outside";
  // 임상병리: 상담 판단으로 한 단계 조정한 예(기본·조정·채택을 따로 보인다)
  const adjusted: Category | null = base === "syn-h1" && cat === "room" ? "core" : null;
  return {
    ...result,
    status: "ready",
    category: adjusted ?? cat,
    decision_components: { base_category: cat, adjusted_category: adjusted, adopted_category: adjusted ?? cat, base_policy_version: `SYNTHETIC-policy-${base}`, adjustment_version: adjusted ? "SYNTHETIC-adjustment-v1" : null },
    advantage: { delta_pp: fmt(delta), status: delta > 0.005 ? "favorable" : delta < -0.005 ? "unfavorable" : "neutral", baseline_version: "SYNTHETIC-baseline-v1" },
  };
}

/** candidates.build 와 같은 규칙: 판단이 도전·핵심·여유인 모집행만 대학별로, 간호·보건·교육은 와일드카드에도 */
export function buildCandidates(analyses: Record<string, AssessmentDto>): CandidatesDto {
  const groups = new Map<string, CandidatesDto["basic_university_groups"][number]>();
  const wildcards: CandidatesDto["wildcards"] = [];
  const pending: CandidatesDto["pending_offerings"] = [];
  for (const o of CATALOG) {
    const a = analyses[o.offering_id];
    if (!a) continue;
    if (a.status !== "ready" || !["challenge", "core", "room"].includes(a.category)) {
      pending.push({ offering_id: o.offering_id, category: a.category, reason_code: a.reason_code });
      continue;
    }
    const item = { offering: o, assessment: a };
    if (!groups.has(o.university_id)) groups.set(o.university_id, { university_id: o.university_id, university_name: o.university_name, offerings: [] });
    groups.get(o.university_id)!.offerings.push(item);
    if (o.wildcard_group) wildcards.push(item);
  }
  return {
    status: groups.size ? "ready" : "pending",
    reason_code: groups.size ? null : "approved_candidates_missing",
    basic_university_groups: Array.from(groups.values()),
    wildcards,
    pending_offerings: pending,
    catalog_version: "SYNTHETIC-catalog-v1",
  };
}

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** statistics.read 합성: 서비스 이용자 수는 지어낸 값, 내 순위는 내 위치로 정한다 */
export function statistics(id: string, a: AssessmentDto | undefined, recommended: boolean, selected: boolean): StatisticsDto {
  const updated = "2026-10-04T03:00:00Z";
  if (!a || a.status !== "ready" || !a.converted_percentile) {
    return { status: "pending", reason_code: "compatible_analysis_missing", recommended_count: null, selected_count: null, recommended_rank: null, selected_rank: null, updated_at: updated, scope: "service_users_not_actual_university_applicants" };
  }
  const rec = 80 + (hash(id) % 220);
  const sel = 10 + (hash(id + "s") % 70);
  const share = Math.min(0.95, Number(a.converted_percentile) / 8);
  const rank = (pop: number) => ({ rank: Math.max(1, Math.round(pop * share)), tie_count: 1 + (hash(id + "t") % 2), population_count: pop, tie_policy: "competition" });
  return {
    status: "ready", reason_code: null, recommended_count: rec, selected_count: sel,
    recommended_rank: recommended ? rank(rec) : null, selected_rank: selected ? rank(sel) : null,
    updated_at: updated, scope: "service_users_not_actual_university_applicants",
  };
}
