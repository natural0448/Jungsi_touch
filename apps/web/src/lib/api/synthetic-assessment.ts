import type { AssessmentDto, Category, CandidatesDto, ConversionDto, OfferingDto, OverallAnalysisDto, PercentileDto, ReasonDto, ScoresInput, StatisticsDto } from "@/lib/dto";
import { HISTORY, HISTORY_OFFERINGS } from "./synthetic-history";

/*
  3·4페이지 합성 응답 — 실제 assessment·candidates·statistics DTO 모양으로 만든다.
  2페이지에서 저장한 성적(같은 쿠키)으로 계산해 2·3·4페이지의 숫자가 서로 맞는다.
  반영 비율·기준 점수·구간은 모두 지어낸 값이며 실제 대학 규칙이 아니다.
*/

/** 2027 모집행 = 1페이지 합성 자료의 2027 행(같은 번호를 쓴다) */
export const CATALOG: OfferingDto[] = HISTORY_OFFERINGS.filter((o) => o.academic_year === 2027);

type Rule = { wk: number; wm: number; wi: number; center: number; band: number; max: number };
/** 대학별 합성 반영 비율과 기준 점수(대학 환산점수 척도) */
const RULE: Record<string, Rule> = {
  "syn-gaon": { wk: 0.3, wm: 0.4, wi: 0.3, center: 915, band: 4, max: 1000 },
  "syn-raon": { wk: 0.2, wm: 0.5, wi: 0.3, center: 648, band: 3, max: 700 },
  "syn-daon": { wk: 0.33, wm: 0.34, wi: 0.33, center: 695, band: 4, max: 800 },
  "syn-haesol": { wk: 0.35, wm: 0.25, wi: 0.4, center: 545, band: 4, max: 600 },
  "syn-saebit": { wk: 0.2, wm: 0.3, wi: 0.5, center: 466, band: 3, max: 500 },
  "syn-hanbit": { wk: 0.45, wm: 0.25, wi: 0.3, center: 896, band: 5, max: 1000 },
};
/** 학과마다 기준을 따로 둔다(같은 대학이어도 판단이 다르다) */
const OFFSET: Record<string, number> = { "syn-g1": 6, "syn-g2": 0, "syn-g3": 22, "syn-g4": 0, "syn-r1": 5, "syn-r2": 0, "syn-d1": 0, "syn-d2": -9, "syn-h1": -12, "syn-h2": -1, "syn-h3": 0, "syn-s1": 0, "syn-e1": -2 };
const BASE = (id: string) => id.replace(/-\d{4}$/, "");

const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

function zOf(s: ScoresInput) {
  const iavg = (s.inquiry[0].standard_score + s.inquiry[1].standard_score) / 2;
  return { k: (s.korean.standard_score - 128) / 9, m: (s.math.standard_score - 128) / 10, i: (iavg - 63) / 5 };
}

const EMPTY_CONVERSION: ConversionDto = {
  status: "pending", reason_code: null, score_basis: null, score_scope: null, converted_score: null, official_max_score: null, academic_year: null,
  exam_id: null, rule_version: null, release_version: null, table_versions: null, profile_version: null, pack_version: null,
};
const EMPTY_PERCENTILE_VALUES = { top_percent: null, inclusive_top_percent: null, exclusive_top_percent: null, tie_share_percent: null } as const;
const EMPTY_PERCENTILE: PercentileDto = {
  status: "pending", reason_code: null, score_basis: null, score_scope: null, academic_year: null, exam_id: null, ...EMPTY_PERCENTILE_VALUES,
  tie_policy: null, population_id: null, data_kind: null, rule_version: null, curve_version: null, release_version: null, source_model_version: null,
  profile_version: null, pack_version: null, population_scope: null,
};

/** 모집단위 하나의 개인 분석. 실제 엔진처럼 판단 보류·자격 미충족도 낸다 */
export function assess(o: OfferingDto, scores: ScoresInput, overall: OverallAnalysisDto): AssessmentDto {
  const id = o.offering_id;
  const base = BASE(id);
  const rule = RULE[o.university_id];
  const blocked = (reason: string): AssessmentDto => ({
    offering_id: id, status: "pending", reason_code: reason, converted_score: null, converted_percentile: null,
    category: "pending", advantage: null, years: [], versions: {}, eligibility_status: "needs_confirmation",
    conversion: { ...EMPTY_CONVERSION, reason_code: reason }, percentile: { ...EMPTY_PERCENTILE, reason_code: reason }, recommendation_reasons: [],
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

  // 지금 성적은 9월 모의평가라 올해 행은 모평 기준, 지난 해는 연도 보정 추정이다
  const years = [2024, 2025, 2026, 2027].map((y) => ({
    academic_year: y, offering_id: `${base}-${y}`, score_basis: y === 2027 ? "mock_exam" : "year_equated_estimate",
    converted_score: fmt(score - (2027 - y) * rule.band * 0.25), status: "ready", reason_code: null,
  }));
  const versions = { analysis: "SYNTHETIC-analysis-v1", profile: "synthetic", pack: scores.pack_version, source_model: overall.overall.model_version ?? "", bridge: "SYNTHETIC-bridge-v1", rule: `SYNTHETIC-rule-${o.university_id}` };
  const historical_metrics = HISTORY.filter((h) => h.offering_id.startsWith(`${base}-`) && h.academic_year < 2027).map((h) => ({
    academic_year: h.academic_year, metric_name: h.metric_name, metric_definition: h.metric_definition, value: h.value, unit: h.unit,
    original_scale: h.original_scale, publication_status: h.publication_status, source_url: h.source_url, source_as_of: h.source_as_of,
  }));
  const forecastPending = base === "syn-g3";
  const conversion: ConversionDto = {
    status: "ready", reason_code: null, score_basis: "mock_exam", score_scope: "국어·수학·탐구 반영 합(합성)", converted_score: fmt(score),
    official_max_score: String(rule.max), academic_year: 2027, exam_id: scores.exam_id, rule_version: versions.rule, release_version: "SYNTHETIC-scoring-v1",
    table_versions: {}, profile_version: 1, pack_version: scores.pack_version,
  };
  // 물리치료학과: 대학 반영 성적을 모두 가진 응시자만 비교하는 별도 비교집단(전체 누백과 분모가 달라 유불리는 보류)
  const scope = base === "syn-s1" ? "required_rule_inputs_present" : "whole_complete";
  const percentile: PercentileDto = {
    status: "ready", reason_code: null, score_basis: "mock_exam", score_scope: conversion.score_scope, academic_year: 2027, exam_id: scores.exam_id,
    top_percent: fmt(convPct), inclusive_top_percent: fmt(convPct), exclusive_top_percent: fmt(Math.max(0, convPct - 0.03)), tie_share_percent: "0.03",
    tie_policy: "include_equal", population_id: `SYNTHETIC-2027-09-${scope}`, data_kind: "estimated_weights", rule_version: versions.rule,
    curve_version: "SYNTHETIC-univ-curve-v1", release_version: "SYNTHETIC-percentile-v1", source_model_version: versions.source_model,
    profile_version: 1, pack_version: scores.pack_version, population_scope: scope,
  };
  const policyReasons: ReasonDto[] = forecastPending
    ? []
    : [{ code: "forecast_basis_trend", text: "올해 예상 70% 기준선은 2024~2026 같은 지표 비교값의 가중 평균으로 정했습니다(합성).", evidence_refs: [`SYNTHETIC-evidence-${base}`] }];
  const decision_evidence = {
    version: "SYNTHETIC-evidence-v1",
    historical_metrics,
    forecast_70: forecastPending
      ? { status: "pending" as const, reason_code: "forecast_70_not_published", value: null, unit: null, definition: null, version: null }
      : { status: "ready" as const, reason_code: null, value: fmt(center - rule.band), unit: "점", definition: "올해 최종등록자 70% 예상 기준선(합성)", version: "SYNTHETIC-forecast-v1" },
    expected_acceptance_range: { lower: fmt(center - rule.band), upper: fmt(center + rule.band), unit: "점", definition: "지원 판단용 채택 구간(합성). 이 구간이면 핵심 검토", policy_version: `SYNTHETIC-policy-${base}` },
    forecast_release_version: forecastPending ? null : "SYNTHETIC-forecast-release-v1",
    basis_summary: forecastPending ? null : "2024~2026 최종등록자 70% 비교값(공통 척도)의 가중 평균(합성)",
    issue_summaries: base === "syn-h1" ? ["2027 모집인원이 3명 늘었습니다(대학 변경 공고). 점수에 주는 영향은 확인하지 않아 숫자로 반영하지 않았습니다."] : [],
    recommendation_reasons: policyReasons,
    adjustment_summary: null as string | null,
  };

  const result: AssessmentDto = {
    offering_id: id, status: "pending", reason_code: null, converted_score: fmt(score), converted_percentile: fmt(convPct),
    category: "pending", advantage: null, years, versions, eligibility_status: "eligible", decision_evidence,
    conversion, percentile, recommendation_reasons: [],
  };
  // 자유전공: 올해 판단 구간이 확정되지 않아 보류(환산점수·위치는 보인다)
  // 환산은 성공했지만 학교 누백 곡선이 아직 발행되지 않았고 판단 구간도 미확정이다
  if (base === "syn-g4")
    return {
      ...result,
      reason_code: "decision_range_unconfirmed",
      decision_evidence: undefined,
      converted_percentile: null,
      percentile: { ...percentile, ...EMPTY_PERCENTILE_VALUES, status: "pending", reason_code: "percentile_curve_unpublished" },
    };
  // 군사학과: 영어 1등급 이내 조건(합성). 등급이 없으면 확인 필요, 넘으면 미충족
  if (base === "syn-h3") {
    if (scores.english_grade === undefined) return { ...result, eligibility_status: "needs_confirmation", reason_code: "eligibility_confirmation_required" };
    if (scores.english_grade > 1) return { ...result, status: "ineligible", category: "ineligible", eligibility_status: "ineligible", reason_code: "eligibility_not_met" };
  }
  const cat: Category = score >= center + rule.band ? "room" : score >= center - rule.band ? "core" : score >= center - rule.band * 3 ? "challenge" : "outside";
  // 임상병리: 상담 판단으로 한 단계 조정한 예(기본·조정·채택을 따로 보인다)
  const adjusted: Category | null = base === "syn-h1" && cat === "room" ? "core" : null;
  const adopted = adjusted ?? cat;
  const sameScope = scope === "whole_complete";
  const lo = fmt(center - rule.band);
  const hi = fmt(center + rule.band);
  // 서버가 만드는 학생별 이유(합성). 화면은 문장을 지어내지 않고 이 값을 그대로 보인다
  const reasons: ReasonDto[] = [];
  if (sameScope && delta > 0.005) reasons.push({ code: "conversion_advantage", text: `이 대학 반영식에서 총점 기준보다 위치가 ${fmt(delta)}%p 올라갑니다.`, evidence_refs: [versions.rule] });
  // 구간 설명은 학생 점수로 본 기본 판단 기준이고, 상담 조정은 따로 적는다
  reasons.push(
    cat === "core"
      ? { code: "within_acceptance_range", text: `내 환산점수 ${fmt(score)}점이 판단 구간 ${lo}~${hi}점 안에 있습니다.`, evidence_refs: [`SYNTHETIC-policy-${base}`] }
      : cat === "room"
        ? { code: "above_acceptance_range", text: `내 환산점수 ${fmt(score)}점이 판단 구간 위쪽 끝(${hi}점)보다 높습니다.`, evidence_refs: [`SYNTHETIC-policy-${base}`] }
        : { code: "below_acceptance_range", text: `내 환산점수 ${fmt(score)}점이 판단 구간 아래쪽 끝(${lo}점)보다 낮습니다.`, evidence_refs: [`SYNTHETIC-policy-${base}`] },
  );
  if (adjusted) reasons.push({ code: "counselor_adjustment", text: "상담 판단으로 한 단계 조정해 핵심 검토로 봅니다.", evidence_refs: ["SYNTHETIC-adjustment-v1"] });
  return {
    ...result,
    status: "ready",
    category: adopted,
    decision_components: { base_category: cat, adjusted_category: adjusted, adopted_category: adopted, base_policy_version: `SYNTHETIC-policy-${base}`, adjustment_version: adjusted ? "SYNTHETIC-adjustment-v1" : null },
    decision_evidence: adjusted ? { ...decision_evidence, adjustment_summary: "상담 판단으로 한 단계 조정했습니다(여유 후보 → 핵심 검토)." } : decision_evidence,
    // 비교집단이 전체 응시자와 다르면 분모가 달라 유불리를 보류한다
    advantage: sameScope ? { delta_pp: fmt(delta), status: delta > 0.005 ? "favorable" : delta < -0.005 ? "unfavorable" : "neutral", baseline_version: "SYNTHETIC-baseline-v1" } : null,
    reason_code: sameScope ? null : "advantage_population_mismatch",
    recommendation_reasons: reasons,
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
