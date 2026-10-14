/** Invented four-year analysis only; every approval flag is a control-flow fixture. */
import {
  NativeOfferingAnalysisRelease,
  type OfferingAnalysisSettings,
  type YearBridge,
} from "../../supabase/functions/_shared/jungsi/application/offering_analysis.ts";
import { NativeConversionRelease } from "../../supabase/functions/_shared/jungsi/domain/conversion_release.ts";
import {
  NativeBridgePolicy,
  NativeRankDistribution,
} from "../../supabase/functions/_shared/jungsi/domain/year_equating.ts";
import {
  NativeUniversityScoreDistribution,
  UNIVERSITY_MATCH_FIELDS,
} from "../../supabase/functions/_shared/jungsi/domain/university_distribution.ts";
import { type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SyntheticUniversityData } from "./synthetic_university.ts";
import { syntheticRankRaw } from "./synthetic_year_equating.ts";
import { syntheticUniversityCurveData } from "./synthetic_university_curve.ts";
export function syntheticOfferingAnalysisFixture() {
  const data = new SyntheticUniversityData(),
    sourceModel = "SYNTHETIC-source-total",
    version = "SYNTHETIC-analysis.v1";
  data.rawRule = {
    ...data.rawRule,
    score_scale_id: "SYNTHETIC-scale",
    bonus_treatment: "excluded",
  };
  data.bundle = data.release();
  const rules: NativeObject[] = [],
    bindings: NativeObject[] = [],
    offeringByYear: NativeObject = {},
    bridges = new Map<number, YearBridge>(),
    curves = new Map<number, NativeUniversityScoreDistribution>(),
    decisions = new Map<number, NativeObject>();
  const subjects = { korean: "국어", math: "수학", inquiry1: "가상탐구가", inquiry2: "가상탐구나" };
  for (const year of [2024, 2025, 2026, 2027]) {
    const oid = "SYNTHETIC-A-" + String(year),
      exam = year === 2027 ? data.pack!.examId : "SYNTHETIC-csat-" + String(year),
      targetVersion = "SYNTHETIC-target-" + String(year);
    offeringByYear[String(year)] = oid;
    const rule = {
      ...data.rawRule,
      academic_year: year,
      rule_version: "SYNTHETIC-A-" + String(year),
    };
    rules.push(rule);
    bindings.push({ academic_year: year, offering_pk: oid, rule_version: rule.rule_version });
    const rank = (ex: string, y: number, subject: string, version: string, total = false) => {
      const raw = syntheticRankRaw(ex, y, subject, total);
      raw.version = version;
      return new NativeRankDistribution(raw);
    };
    const source = Object.fromEntries(
        Object.entries(subjects).map((
          [a, s],
        ) => [a, rank(data.pack!.examId, 2027, s, data.pack!.packVersion)]),
      ) as unknown as YearBridge["source"],
      target = Object.fromEntries(
        Object.entries(subjects).map(([a, s]) => [a, rank(exam, year, s, targetVersion)]),
      ) as unknown as YearBridge["target"];
    bridges.set(year, {
      source,
      target,
      sourceTotal: rank(data.pack!.examId, 2027, "total", sourceModel, true),
      targetTotal: rank(exam, year, "total", targetVersion, true),
    });
    const raw = syntheticUniversityCurveData(), m = raw.metadata as NativeObject;
    Object.assign(m, {
      academic_year: year,
      exam_id: exam,
      rule_version: rule.rule_version,
      curve_id: "SYNTHETIC-A-" + String(year),
      curve_version: "SYNTHETIC-curve-A-" + String(year),
    });
    const curve = new NativeUniversityScoreDistribution(raw);
    curves.set(year, curve);
    const context: NativeObject = Object.fromEntries(UNIVERSITY_MATCH_FIELDS.map((k) => [k, m[k]]));
    Object.assign(context, {
      offering_id: oid,
      curve_version: m.curve_version,
      analysis_version: version,
    });
    const decision: NativeObject = {
      status: "approved",
      version: "SYNTHETIC-policy-A-" + String(year),
      context,
      eligibility_policy: {
        status: "approved",
        version: "SYNTHETIC-eligibility.v1",
        requirements: [{ field: "english_grade", operator: "at_most", value: 3 }],
      },
      ranges: [{ lower: 0, upper: 25, category: "challenge" }, {
        lower: 25,
        upper: 33,
        category: "core",
      }, { lower: 33, upper: 100, category: "room" }],
      baseline: {
        status: "approved",
        version: targetVersion,
        academic_year: year,
        exam_id: exam,
        population_id: m.population_id,
        tie_policy: "include_equal",
      },
    };
    decision.evidence = {
      status: "approved",
      version: "SYNTHETIC-evidence.v1",
      context: { ...context },
      historical_metrics: [{
        academic_year: 2024,
        metric_name: "가상 발표 평균",
        metric_definition: "가상 등록자 평균",
        value: "20",
        unit: "점",
        original_scale: "가상척도",
        publication_status: "published",
        verification_status: "verified_official",
        source_url: "https://example.invalid/synthetic",
        source_as_of: "2026-10-03",
      }],
      forecast_70: {
        status: "approved",
        version: "SYNTHETIC-forecast.v1",
        value: "26",
        unit: "점",
        definition: "가상 올해 등록자 예상 70% 기준선",
      },
      expected_acceptance_range: {
        status: "approved",
        policy_version: decision.version,
        lower: "25",
        upper: "33",
        unit: "점",
        definition: "가상 지원 판단용 채택 구간",
      },
    };
    decisions.set(year, decision);
  }
  const settings: OfferingAnalysisSettings = {
    version,
    status: "approved",
    sourcePackVersion: data.pack!.packVersion,
    release: new NativeConversionRelease("SYNTHETIC-conversion.v1", rules, bindings),
    offeringsByYear: offeringByYear,
    bridges,
    policy: new NativeBridgePolicy({
      version: "SYNTHETIC-bridge.v1",
      status: "validated",
      validation_ref: "SYNTHETIC-validation",
      max_subject_rank_shift: "0.2",
    }),
    curves,
    decisions,
  };
  const overall: NativeObject = {
    exam: { academic_year: 2027, exam_id: data.pack!.examId },
    overall: { status: "ready", reason_code: null, model_version: sourceModel },
  };
  return { data, settings, overall, release: () => new NativeOfferingAnalysisRelease(settings) };
}
