/** Invented nine-person converted-score curve; no native publication. */
import { UNIVERSITY_SCORE_METRIC } from "../../supabase/functions/_shared/jungsi/domain/university_distribution.ts";
import { OVERALL_POPULATION_ID } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
export function syntheticUniversityCurveData(): NativeObject {
  return {
    format: "jungsi.university-score-distribution/v1",
    metadata: {
      academic_year: 2027,
      exam_id: "SYNTHETIC-current-csat",
      rule_id: "SYNTHETIC-A",
      rule_version: "SYNTHETIC-A-2027",
      score_metric: UNIVERSITY_SCORE_METRIC,
      score_scope: "csat_component",
      score_scale_id: "SYNTHETIC-scale",
      bonus_treatment: "excluded",
      population_id: OVERALL_POPULATION_ID,
      population_definition: "SYNTHETIC nine fictional examinees",
      curve_id: "SYNTHETIC-A-2027",
      curve_version: "SYNTHETIC-curve-A-2027",
      source_model_id: "SYNTHETIC",
      source_model_version: "SYNTHETIC-v1",
      status: "approved",
      rule_review_status: "calculation_verified",
      complete: true,
      population_verified: true,
      kind: "observed_counts",
      score_min: 4,
      score_max: 36,
      expected_total_weight: 9,
    },
    source_refs: ["SYNTHETIC-CONTROL-FLOW-ONLY"],
    frequencies: [{ converted_score: 4, weight: 2 }, {
      converted_score: 20,
      weight: 3,
    }, {
      converted_score: 36,
      weight: 4,
    }],
  };
}
