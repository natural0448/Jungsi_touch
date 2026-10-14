/** Exact policy-driven forecast calculation. No production defaults or probability inference. */
import { AccessError } from "./access.ts";
import { exact, Rational, roundExact } from "../domain/exact.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { pythonTrim } from "../domain/text.ts";
export function forecastRequire(ok: unknown, code: string, http = 422): asserts ok {
  if (!ok) throw new AccessError(code, http);
}
export function forecastObject(
  value: unknown,
  code = "forecast_policy_invalid",
  http = 422,
): NativeObject {
  forecastRequire(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    code,
    http,
  );
  return value as NativeObject;
}
export function forecastTruthy(v: NativeJson | undefined): boolean {
  return v !== undefined && v !== null && v !== false && v !== "" && v !== 0 && v !== 0n &&
    (!Array.isArray(v) || v.length > 0) &&
    (typeof v !== "object" || v instanceof JsonFloat || Array.isArray(v) ||
      Object.keys(v).length > 0);
}
export function forecastNumber(value: unknown): Rational {
  forecastRequire(
    typeof value === "string" || typeof value === "bigint" ||
      typeof value === "number" && Number.isSafeInteger(value),
    "forecast_number_invalid",
  );
  try {
    if (typeof value !== "string") return exact(value);
    const raw = pythonTrim(value),
      digits = "[0-9](?:_?[0-9])*",
      f = new RegExp("^([+-]?" + digits + ")\\s*/\\s*(" + digits + ")$").exec(raw);
    if (f) return new Rational(BigInt(f[1].replaceAll("_", "")), BigInt(f[2].replaceAll("_", "")));
    forecastRequire(
      new RegExp(
        "^[+-]?(?:(?:" + digits + ")(?:\\.(?:" + digits + ")?)?|\\." + digits + ")(?:[eE][+-]?" +
          digits + ")?$",
      ).test(raw),
      "forecast_number_invalid",
    );
    return exact(raw);
  } catch {
    throw new AccessError("forecast_number_invalid", 422);
  }
}
/** Workflow object hash. It is not the immutable artifact/source-byte SHA. */
export async function forecastDigest(value: unknown): Promise<string> {
  const seen = new Set<object>();
  function inspect(v: unknown, depth: number): void {
    forecastRequire(depth <= 128, "forecast_release_invalid", 503);
    if (typeof v === "number") {
      forecastRequire(Number.isSafeInteger(v), "forecast_release_invalid", 503);
    }
    forecastRequire(!(v instanceof JsonFloat), "forecast_release_invalid", 503);
    if (v !== null && typeof v === "object") {
      forecastRequire(!seen.has(v), "forecast_release_invalid", 503);
      seen.add(v);
      Object.values(v).forEach((x) => inspect(x, depth + 1));
      seen.delete(v);
    }
  }
  inspect(value, 0);
  try {
    return await nativeJsonSha256(value);
  } catch {
    throw new AccessError("forecast_release_invalid", 503);
  }
}
export function forecastDecimal(value: Rational): string {
  let denominator = value.denominator;
  for (const factor of [2n, 5n]) while (denominator % factor === 0n) denominator /= factor;
  forecastRequire(denominator === 1n, "forecast_nonterminating_exact_value");
  const negative = value.numerator < 0n,
    n = negative ? -value.numerator : value.numerator,
    whole = n / value.denominator;
  let rem = n % value.denominator, digits = "";
  while (rem) {
    rem *= 10n;
    digits += String(rem / value.denominator);
    rem %= value.denominator;
  }
  return (negative ? "-" : "") + String(whole) + (digits ? "." + digits : "");
}
export function forecastPolicyDecimal(value: Rational, policy: Readonly<NativeObject>): string {
  const places = policy.display_places, mode = policy.rounding_mode;
  forecastRequire(
    typeof places === "number" && Number.isSafeInteger(places) && places >= 0 && places <= 8 &&
      ["half_up", "half_even", "floor", "ceil", "truncate"].includes(mode as string),
    "forecast_precision_policy_missing",
  );
  return forecastDecimal(roundExact(value, places, mode));
}
function forecastProject(
  rows: readonly NativeObject[],
  policy: Readonly<NativeObject>,
  year: NativeJson,
): Rational {
  forecastRequire(
    policy.status === "approved" && forecastTruthy(policy.version),
    "forecast_policy_unapproved",
  );
  const minimum = policy.minimum_years;
  forecastRequire(
    typeof minimum === "number" && Number.isSafeInteger(minimum) && minimum >= 1 && minimum <= 3,
    "forecast_policy_invalid",
  );
  forecastRequire(rows.length >= minimum, "comparable_history_missing");
  forecastRequire(policy.target_year === year, "forecast_target_year_mismatch");
  forecastRequire(
    ["higher_is_better", "lower_is_better"].includes(policy.direction as string),
    "forecast_direction_missing",
  );
  forecastRequire(
    typeof policy.require_consecutive_years === "boolean",
    "forecast_continuity_policy_missing",
  );
  if (policy.require_consecutive_years) {
    forecastRequire(
      rows.slice(1).every((r, i) => r.academic_year === (rows[i].academic_year as number) + 1),
      "forecast_history_discontinuous",
    );
  }
  const values = rows.map((r) => forecastNumber(r.comparison_value));
  let result: Rational;
  if (policy.method === "latest_comparable") result = values.at(-1)!;
  else if (policy.method === "weighted_mean") {
    const weights = forecastObject(policy.weights, "forecast_weights_missing");
    forecastRequire(
      Object.keys(weights).sort().join(",") ===
        rows.map((r) => String(r.academic_year)).sort().join(","),
      "forecast_weights_year_mismatch",
    );
    const w = rows.map((r) => forecastNumber(weights[String(r.academic_year)]));
    forecastRequire(w.every((v) => v.compare(exact(0)) > 0), "forecast_weights_invalid");
    result = values.reduce((n, v, i) => n.add(v.multiply(w[i])), exact(0)).divide(
      w.reduce((n, v) => n.add(v), exact(0)),
    );
  } else if (policy.method === "linear_trend") {
    forecastRequire(
      policy.trend_adopted === true && forecastTruthy(policy.trend_evidence_ref),
      "forecast_trend_unapproved",
    );
    forecastRequire(rows.length >= 2, "comparable_history_missing");
    const xs = rows.map((r) => forecastNumber(r.academic_year)),
      mx = xs.reduce((n, v) => n.add(v), exact(0)).divide(exact(xs.length)),
      my = values.reduce((n, v) => n.add(v), exact(0)).divide(exact(values.length));
    const numerator = xs.reduce(
        (n, x, i) => n.add(x.subtract(mx).multiply(values[i].subtract(my))),
        exact(0),
      ),
      denominator = xs.reduce((n, x) => n.add(x.subtract(mx).multiply(x.subtract(mx))), exact(0));
    const slope = numerator.divide(denominator),
      limit = forecastNumber(policy.max_abs_trend_per_year),
      abs = slope.compare(exact(0)) < 0 ? exact(0).subtract(slope) : slope;
    forecastRequire(
      limit.compare(exact(0)) >= 0 && abs.compare(limit) <= 0,
      "forecast_trend_limit_exceeded",
    );
    result = my.add(slope.multiply(forecastNumber(year).subtract(mx)));
  } else throw new AccessError("forecast_method_unsupported", 422);
  const bounds = forecastObject(policy.value_bounds, "forecast_bounds_missing");
  forecastRequire(
    forecastNumber(bounds.lower).compare(result) <= 0 &&
      result.compare(forecastNumber(bounds.upper)) <= 0,
    "forecast_outside_policy_bounds",
  );
  return result;
}
function comparable(
  raw: unknown,
  context: Readonly<NativeObject>,
  metric: Readonly<NativeObject>,
): NativeObject[] {
  forecastRequire(Array.isArray(raw), "forecast_history_invalid");
  const years = new Set<number>(), rows = raw.map((r) => forecastObject(r));
  for (const row of rows) {
    const year = row.academic_year;
    forecastRequire(
      typeof year === "number" && Number.isSafeInteger(year) && [2024, 2025, 2026].includes(year) &&
        !years.has(year),
      "forecast_history_year_invalid",
    );
    years.add(year);
    forecastRequire(
      row.status === "approved" && forecastTruthy(row.source_ref) &&
        typeof row.source_hash === "string" && /^[0-9a-f]{64}$/.test(row.source_hash),
      "forecast_history_unapproved",
    );
    forecastRequire(
      row.offering_lineage_id === context.offering_lineage_id,
      "forecast_offering_mismatch",
    );
    forecastRequire(
      row.metric_id === metric.metric_id && row.metric_definition === metric.definition,
      "forecast_metric_mismatch",
    );
    forecastRequire(
      row.unit === context.unit && row.comparison_scale_id === context.score_scale_id &&
        row.population_id === context.population_id,
      "forecast_comparison_mismatch",
    );
    forecastRequire(
      row.bridge_status === "approved" && forecastTruthy(row.bridge_version) &&
        typeof row.bridge_receipt_hash === "string" &&
        /^[0-9a-f]{64}$/.test(row.bridge_receipt_hash),
      "history_bridge_unapproved",
    );
    forecastNumber(row.comparison_value);
  }
  return rows.sort((a, b) => (a.academic_year as number) - (b.academic_year as number));
}
export function validateForecastRanges(value: unknown): true {
  forecastRequire(Array.isArray(value) && value.length > 0, "forecast_category_ranges_missing");
  const rows = value.map((r) => forecastObject(r));
  forecastRequire(
    new Set(rows.map((r) => r.category)).size === rows.length,
    "forecast_category_duplicate",
  );
  rows.sort((a, b) => forecastNumber(a.lower).compare(forecastNumber(b.lower)));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    forecastRequire(
      ["challenge", "core", "room", "outside"].includes(r.category as string) &&
        forecastNumber(r.lower).compare(forecastNumber(r.upper)) < 0,
      "forecast_range_invalid",
    );
    if (i) {
      forecastRequire(
        forecastNumber(rows[i - 1].upper).compare(forecastNumber(r.lower)) <= 0,
        "forecast_ranges_overlap",
      );
    }
  }
  return true;
}
export function validateForecastDirection(value: unknown, direction: NativeJson | undefined): void {
  forecastRequire(
    ["higher_is_better", "lower_is_better"].includes(direction as string),
    "forecast_direction_missing",
  );
  forecastRequire(Array.isArray(value), "forecast_category_ranges_missing");
  const rows = value.map((r) => forecastObject(r)).sort((a, b) =>
    forecastNumber(a.lower).compare(forecastNumber(b.lower))
  );
  const order: Record<string, number> = { challenge: 0, core: 1, room: 2 },
    ranked = rows.filter((r) => Object.hasOwn(order, r.category as string)).map((r) =>
      order[r.category as string]
    );
  forecastRequire(
    ranked.slice(1).every((v, i) =>
      direction === "lower_is_better" ? ranked[i] >= v : ranked[i] <= v
    ),
    "forecast_category_direction_mismatch",
  );
}
export function generateForecast(inputRaw: unknown, policyRaw: unknown): NativeObject {
  const inputs = forecastObject(inputRaw, "forecast_input_unapproved"),
    policy = forecastObject(policyRaw, "forecast_policy_unapproved");
  forecastRequire(
    inputs.status === "approved" && forecastTruthy(inputs.version),
    "forecast_input_unapproved",
  );
  forecastRequire(
    policy.status === "approved" && forecastTruthy(policy.version),
    "forecast_policy_unapproved",
  );
  forecastRequire(
    typeof policy.require_independent_approver === "boolean",
    "forecast_approval_policy_missing",
  );
  const context = forecastObject(inputs.context, "forecast_context_invalid"),
    required = [
      "offering_id",
      "offering_lineage_id",
      "academic_year",
      "exam_id",
      "rule_version",
      "curve_version",
      "analysis_version",
      "score_scale_id",
      "population_id",
      "unit",
    ];
  forecastRequire(
    required.every((k) => Object.hasOwn(context, k) && context[k] !== null) &&
      context.academic_year === 2027,
    "forecast_context_invalid",
  );
  forecastRequire(
    nativeJsonText(policy.context, true) === nativeJsonText(context, true),
    "forecast_policy_context_mismatch",
  );
  const result: NativeObject = {
      context: cloneNativeJson(context),
      forecast_70: { status: "pending", reason_code: "comparable_history_missing", value: null },
      acceptance_range: {
        status: "pending",
        reason_code: "acceptance_evidence_missing",
        lower: null,
        upper: null,
      },
      category_ranges: [],
      issue_summaries: [],
      basis_summary: [],
      exact_values: { forecast_70: null, acceptance_range: null, category_ranges: [] },
      comparison_basis: null,
    },
    precise = result.exact_values as NativeObject;
  for (
    const [target, key] of [["forecast_70", "history_70"], [
      "acceptance_range",
      "acceptance_history",
    ]] as const
  ) {
    const raw = policy[target];
    if (raw === null || raw === undefined) continue;
    try {
      const spec = forecastObject(raw),
        metric = forecastObject(spec.metric, "forecast_metric_missing"),
        rows = comparable(Object.hasOwn(inputs, key) ? inputs[key] : [], context, metric),
        center = forecastProject(rows, spec, context.academic_year);
      if (target === "forecast_70") {
        result[target] = {
          status: "ready",
          reason_code: null,
          value: forecastPolicyDecimal(center, spec),
          unit: context.unit,
          definition: metric.definition,
          version: policy.version,
        };
        precise[target] = center.toString();
      } else {
        forecastRequire(
          forecastTruthy(spec.range_evidence_ref) && forecastTruthy(spec.category_evidence_ref),
          "acceptance_evidence_missing",
        );
        const lowerWidth = forecastNumber(spec.lower_width),
          upperWidth = forecastNumber(spec.upper_width),
          low = center.subtract(lowerWidth),
          high = center.add(upperWidth);
        forecastRequire(
          low.compare(high) < 0 && lowerWidth.compare(exact(0)) >= 0 &&
            upperWidth.compare(exact(0)) >= 0,
          "forecast_range_invalid",
        );
        result[target] = {
          status: "ready",
          reason_code: null,
          lower: forecastPolicyDecimal(low, spec),
          upper: forecastPolicyDecimal(high, spec),
          unit: context.unit,
          definition: metric.definition,
          policy_version: policy.version,
        };
        const rawOffsets = Object.hasOwn(spec, "category_offsets") ? spec.category_offsets : [];
        forecastRequire(Array.isArray(rawOffsets), "forecast_policy_invalid");
        const ranges = rawOffsets.map((r) => {
          const row = forecastObject(r);
          forecastRequire(
            ["challenge", "core", "room", "outside"].includes(row.category as string),
            "forecast_category_invalid",
          );
          return {
            category: row.category,
            lower: center.add(forecastNumber(row.lower)).toString(),
            upper: center.add(forecastNumber(row.upper)).toString(),
          };
        });
        validateForecastRanges(ranges);
        validateForecastDirection(ranges, spec.direction);
        precise[target] = { lower: low.toString(), upper: high.toString() };
        precise.category_ranges = ranges;
        result.category_ranges = ranges.map((r) => ({
          category: r.category,
          lower: forecastPolicyDecimal(forecastNumber(r.lower), spec),
          upper: forecastPolicyDecimal(forecastNumber(r.upper), spec),
        }));
        forecastRequire(
          ["comparison_metric", "direction", "tie_policy"].every((k) => Object.hasOwn(context, k)),
          "forecast_comparison_basis_missing",
        );
        forecastRequire(
          spec.comparison_metric === context.comparison_metric &&
            spec.direction === context.direction &&
            (spec.tie_policy ?? null) === context.tie_policy,
          "forecast_comparison_basis_mismatch",
        );
        result.comparison_basis = {
          metric: context.comparison_metric,
          unit: context.unit,
          score_scale_id: context.score_scale_id,
          population_id: context.population_id,
          direction: context.direction,
          tie_policy: context.tie_policy,
        };
      }
      (result.basis_summary as NativeJson[]).push({
        target,
        method: spec.method,
        policy_version: policy.version,
        source_refs: rows.map((r) => r.source_ref),
      });
    } catch (e) {
      if (!(e instanceof AccessError)) throw new AccessError("forecast_policy_invalid", 422);
      const value = forecastObject(result[target]);
      Object.assign(value, { status: "pending", reason_code: e.code });
      if (target === "forecast_70") value.value = null;
      else {
        Object.assign(value, { lower: null, upper: null });
        result.category_ranges = [];
        precise[target] = null;
        precise.category_ranges = [];
        result.comparison_basis = null;
      }
    }
  }
  const issues = Object.hasOwn(inputs, "issues") ? inputs.issues : [];
  forecastRequire(Array.isArray(issues), "forecast_issue_invalid");
  for (const raw of issues) {
    const issue = forecastObject(raw, "forecast_issue_invalid");
    forecastRequire(
      forecastTruthy(issue.issue_id) && forecastTruthy(issue.explanation) &&
        forecastTruthy(issue.evidence_ref),
      "forecast_issue_invalid",
    );
    forecastRequire(issue.effect == null, "forecast_numeric_issue_policy_unsupported");
    (result.issue_summaries as NativeJson[]).push(
      Object.fromEntries(
        ["issue_id", "explanation", "evidence_ref", "effect"].map((k) => [k, issue[k] ?? null]),
      ),
    );
  }
  return result;
}
export async function validateForecastResult(raw: unknown): Promise<NativeObject> {
  const result = forecastObject(raw),
    forecast = forecastObject(result.forecast_70),
    acceptance = forecastObject(result.acceptance_range),
    precise = forecastObject(result.exact_values, "forecast_exact_values_missing", 409),
    checks: string[] = [];
  if (forecast.status === "ready") {
    forecastNumber(precise.forecast_70);
    checks.push("forecast_70_exact");
  }
  if (acceptance.status === "ready") {
    const bounds = forecastObject(precise.acceptance_range, "forecast_exact_values_missing", 409);
    forecastRequire(
      forecastNumber(bounds.lower).compare(forecastNumber(bounds.upper)) < 0,
      "forecast_range_invalid",
    );
    validateForecastRanges(precise.category_ranges);
    checks.push("acceptance_ranges_valid");
  }
  forecastRequire(checks.length > 0, "forecast_outputs_pending", 409);
  return { status: "passed", checks, result_hash: await forecastDigest(result) };
}
export async function validateForecastPolicyResult(
  raw: unknown,
  policyRaw: unknown,
): Promise<NativeObject> {
  const result = forecastObject(raw),
    policy = forecastObject(policyRaw),
    receipt = await validateForecastResult(result),
    precise = forecastObject(result.exact_values);
  for (const target of ["forecast_70", "acceptance_range"] as const) {
    const value = forecastObject(result[target]);
    if (value.status !== "ready") continue;
    const spec = forecastObject(policy[target]),
      bounds = forecastObject(spec.value_bounds),
      lo = forecastNumber(bounds.lower),
      hi = forecastNumber(bounds.upper),
      stored = precise[target];
    for (const field of target === "forecast_70" ? ["value"] : ["lower", "upper"]) {
      const number = forecastNumber(
        target === "forecast_70" ? stored : forecastObject(stored)[field],
      );
      forecastRequire(
        lo.compare(number) <= 0 && number.compare(hi) <= 0,
        "forecast_outside_policy_bounds",
      );
      forecastRequire(
        value[field] === forecastPolicyDecimal(number, spec),
        "forecast_display_value_mismatch",
      );
    }
    forecastRequire(
      value.unit === forecastObject(result.context).unit,
      "forecast_adjustment_unit_mismatch",
    );
  }
  if (forecastObject(result.acceptance_range).status === "ready") {
    const rows = precise.category_ranges;
    forecastRequire(Array.isArray(rows), "forecast_category_ranges_missing");
    const spec = forecastObject(policy.acceptance_range);
    validateForecastDirection(rows, spec.direction);
    const context = forecastObject(result.context),
      expected = {
        metric: spec.comparison_metric ?? null,
        unit: context.unit,
        score_scale_id: context.score_scale_id,
        population_id: context.population_id,
        direction: spec.direction,
        tie_policy: spec.tie_policy ?? null,
      };
    forecastRequire(
      nativeJsonText(result.comparison_basis, true) === nativeJsonText(expected, true),
      "forecast_comparison_basis_mismatch",
    );
    const display = rows.map((r) => {
      const row = forecastObject(r);
      return {
        category: row.category,
        lower: forecastPolicyDecimal(forecastNumber(row.lower), spec),
        upper: forecastPolicyDecimal(forecastNumber(row.upper), spec),
      };
    });
    forecastRequire(
      nativeJsonText(result.category_ranges, true) === nativeJsonText(display, true),
      "forecast_display_value_mismatch",
    );
    const cores = rows.map((r) => forecastObject(r)).filter((r) => r.category === "core"),
      bounds = forecastObject(precise.acceptance_range);
    forecastRequire(
      cores.length === 1 &&
        forecastNumber(cores[0].lower).compare(forecastNumber(bounds.lower)) === 0 &&
        forecastNumber(cores[0].upper).compare(forecastNumber(bounds.upper)) === 0,
      "forecast_core_range_mismatch",
    );
  }
  return receipt;
}
