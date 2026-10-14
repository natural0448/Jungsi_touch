/** Invented forecast boundary cases; no official admissions data or operating policy. */
import { evaluateForecastRelease } from "../../supabase/functions/_shared/jungsi/application/forecast_assessment.ts";
import {
  forecastDigest,
  generateForecast,
} from "../../supabase/functions/_shared/jungsi/application/forecast_calculation.ts";
import { ScoringResult } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { PercentileResult } from "../../supabase/functions/_shared/jungsi/application/university_percentile.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  cloneNativeJson,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { syntheticForecastFixture } from "./synthetic_forecast.ts";
import { equal } from "./fixture.ts";
async function fixture() {
  const { inputs, policy } = syntheticForecastFixture(), context = inputs.context as NativeObject;
  const calculated = generateForecast(inputs, policy);
  const release: NativeObject = {
    release_id: "SYNTHETIC-release",
    context,
    result: calculated,
    base_result: cloneNativeJson(calculated),
    policy_version: policy.version,
    input_version: inputs.version,
    adjustments: [],
    approval_hash: "a".repeat(64),
    validation_hash: "b".repeat(64),
    eligibility_policy: { status: "approved", version: "SYNTHETIC-eligibility", requirements: [] },
  };
  async function rehash() {
    const { release_hash: _hash, ...body } = release;
    release.release_hash = await forecastDigest(body);
  }
  await rehash();
  const conversion = new ScoringResult({
    academic_year: 2027,
    profile_version: "SYNTHETIC-profile",
    pack_version: "SYNTHETIC-pack",
    exam_id: "SYNTHETIC-exam",
    score_basis: "actual_exam",
    reason_code: null,
    score: exact(56),
    converted_score: "56",
    official_max_score: null,
    rule_version: "SYNTHETIC-rule",
    release_version: "SYNTHETIC-conversion",
    table_versions: [],
    values: {},
    reported_sources: {},
    context,
    required_input_fields: [],
    explanations: [],
  });
  const percentile = new PercentileResult({
    academic_year: 2027,
    exam_id: "SYNTHETIC-exam",
    profile_version: "SYNTHETIC-profile",
    pack_version: "SYNTHETIC-pack",
    score_basis: "actual_exam",
    rule_version: "SYNTHETIC-rule",
    reason_code: null,
    inclusive: exact("0.1"),
    exclusive: exact("0.09"),
    population_id: "SYNTHETIC-pop",
    data_kind: null,
    curve_version: "SYNTHETIC-curve",
    release_version: null,
    source_model_version: null,
    context,
    population_scope: null,
  });
  const offering = { offering_id: "SYNTHETIC-O", academic_year: 2027 };
  const profile = {
    profile_id: "SYNTHETIC-profile",
    owner_id: "SYNTHETIC-owner",
    scores: {},
    confirmed: true,
    created_at: "2026-10-14T00:00:00Z",
  };
  return { release, conversion, percentile, offering, profile, rehash };
}
Deno.test("forecast verified release adopts an exact range while retaining independent outputs", async () => {
  const f = await fixture();
  const result = await evaluateForecastRelease(
    f.offering,
    f.profile,
    f.conversion,
    f.percentile,
    f.release,
  );
  equal(result.status, "ready");
  equal(result.category, "core");
  equal(result.converted_score, "56");
  equal((result.percentile as NativeObject).status, "ready");
});
Deno.test("forecast invalid comparison context retains verified forecast evidence and successful scores", async () => {
  for (
    const [field, value] of [
      ["comparison_metric", "overall_top_percent"],
      ["direction", "lower_is_better"],
      ["unit", "등급"],
      ["tie_policy", "exclude_equal"],
    ]
  ) {
    const f = await fixture();
    (f.release.context as NativeObject)[field] = value;
    (f.release.result as NativeObject).context = cloneNativeJson(f.release.context);
    await f.rehash();
    const result = await evaluateForecastRelease(
      f.offering,
      f.profile,
      f.conversion,
      f.percentile,
      f.release,
    );
    equal(result.status, "pending");
    equal(result.reason_code, "forecast_comparison_basis_mismatch");
    equal(result.converted_score, "56");
    equal((result.percentile as NativeObject).status, "ready");
    equal(((result.decision_evidence as NativeObject).forecast_70 as NativeObject).value, "56");
  }
});
Deno.test("forecast missing percentile preserves separately copied official history and forecast", async () => {
  const f = await fixture();
  const history = [{ academic_year: 2024, metric_name: "가상 발표 평균", value: "50", unit: "점" }];
  const result = await evaluateForecastRelease(
    f.offering,
    f.profile,
    f.conversion,
    f.percentile.with({ inclusive: null, reason_code: "percentile_release_missing" }),
    f.release,
    history,
  );
  equal(result.status, "pending");
  equal(result.reason_code, "percentile_release_missing");
  equal(result.converted_score, "56");
  history[0].value = "999";
  const evidence = result.decision_evidence as NativeObject;
  equal((evidence.historical_metrics as NativeObject[])[0].value, "50");
  equal((evidence.forecast_70 as NativeObject).status, "ready");
});
