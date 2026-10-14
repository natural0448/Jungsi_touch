import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  forecastDecimal,
  forecastDigest,
  forecastNumber,
  generateForecast,
  validateForecastPolicyResult,
  validateForecastResult,
} from "../../supabase/functions/_shared/jungsi/application/forecast_calculation.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { syntheticForecastFixture } from "./synthetic_forecast.ts";
import { assert, equal, rejects } from "./fixture.ts";
Deno.test("forecast generates separate approved 70 and support range outputs from declared histories", async () => {
  const { inputs, policy } = syntheticForecastFixture(),
    r = generateForecast(inputs, policy);
  equal((r.forecast_70 as NativeObject).value, "56");
  equal((r.acceptance_range as NativeObject).lower, "54");
  equal((r.issue_summaries as NativeObject[])[0].effect, null);
  equal((await validateForecastResult(r)).status, "passed");
  equal((await validateForecastPolicyResult(r, policy)).status, "passed");
});
Deno.test("missing support history does not fabricate a range from the 70 result", async () => {
  const { inputs, policy } = syntheticForecastFixture();
  inputs.acceptance_history = [];
  const r = generateForecast(inputs, policy);
  equal((r.forecast_70 as NativeObject).status, "ready");
  equal((r.acceptance_range as NativeObject).status, "pending");
  equal(
    (r.acceptance_range as NativeObject).reason_code,
    "comparable_history_missing",
  );
  equal(r.category_ranges, []);
  equal((await validateForecastResult(r)).checks, ["forecast_70_exact"]);
});
Deno.test("forecast history identity metric scale population and approved bridge are independent guards", () => {
  for (
    const [field, value, code] of [
      ["unit", "등급", "forecast_comparison_mismatch"],
      ["population_id", "SYNTHETIC-other", "forecast_comparison_mismatch"],
      ["offering_lineage_id", "SYNTHETIC-other", "forecast_offering_mismatch"],
      ["metric_definition", "SYNTHETIC-other", "forecast_metric_mismatch"],
      ["bridge_status", "draft", "history_bridge_unapproved"],
    ] as const
  ) {
    const { inputs, policy } = syntheticForecastFixture();
    (inputs.history_70 as NativeObject[])[0][field] = value;
    const r = generateForecast(inputs, policy);
    equal((r.forecast_70 as NativeObject).reason_code, code);
    equal((r.acceptance_range as NativeObject).status, "ready");
  }
});
Deno.test("forecast latest weighted and trend behavior require explicit adopted policy", () => {
  const { inputs, policy } = syntheticForecastFixture(),
    spec = policy.forecast_70 as NativeObject;
  spec.method = "latest_comparable";
  equal(
    (generateForecast(inputs, policy).forecast_70 as NativeObject).value,
    "54",
  );
  Object.assign(spec, {
    method: "weighted_mean",
    weights: { "2024": "1", "2025": "2", "2026": "1" },
  });
  equal(
    (generateForecast(inputs, policy).forecast_70 as NativeObject).value,
    "52",
  );
  Object.assign(spec, { method: "linear_trend", trend_adopted: false });
  equal(
    (generateForecast(inputs, policy).forecast_70 as NativeObject).reason_code,
    "forecast_trend_unapproved",
  );
});
Deno.test("forecast exact fractions are accepted here while floats boolean and malformed fractions remain invalid", () => {
  for (
    const [text, value] of [
      ["1/2", "1/2"],
      ["1 / 2", "1/2"],
      ["1_0/2", "5"],
      [".5", "1/2"],
      ["1.", "1"],
      ["1e3", "1000"],
    ]
  ) equal(forecastNumber(text).toString(), value);
  for (const v of [true, new JsonFloat("1.0"), 1.5, "1/-2", "1__0/2", "NaN"]) {
    rejects(() => forecastNumber(v), "forecast_number_invalid");
  }
  rejects(
    () => forecastDecimal(forecastNumber("1/3")),
    "forecast_nonterminating_exact_value",
  );
});
Deno.test("forecast explicit missing precision holds output and an unknown issue is not a numeric zero", () => {
  const { inputs, policy } = syntheticForecastFixture();
  (policy.forecast_70 as NativeObject).display_places = null;
  equal(
    (generateForecast(inputs, policy).forecast_70 as NativeObject).reason_code,
    "forecast_precision_policy_missing",
  );
  const g = syntheticForecastFixture();
  (g.inputs.issues as NativeObject[])[0].effect = 0;
  rejects(
    () => generateForecast(g.inputs, g.policy),
    "forecast_numeric_issue_policy_unsupported",
  );
});
Deno.test("forecast policy validation rejects display tampering and shifted core boundaries", async () => {
  const { inputs, policy } = syntheticForecastFixture(),
    r = generateForecast(inputs, policy);
  (r.forecast_70 as NativeObject).value = "57";
  let error: unknown;
  try {
    await validateForecastPolicyResult(r, policy);
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, "forecast_display_value_mismatch");
  const g = generateForecast(inputs, policy);
  ((g.exact_values as NativeObject).acceptance_range as NativeObject).lower = "53";
  (g.acceptance_range as NativeObject).lower = "53";
  try {
    await validateForecastPolicyResult(g, policy);
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, "forecast_core_range_mismatch");
});
Deno.test("workflow hash is key-order stable and does not recover floating source spellings", async () => {
  equal(
    await forecastDigest({ b: 2, a: "1/2" }),
    await forecastDigest({ a: "1/2", b: 2 }),
  );
  let e: unknown;
  try {
    await forecastDigest({ not_a_workflow_integer: new JsonFloat("1e0") });
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, "forecast_release_invalid");
});
