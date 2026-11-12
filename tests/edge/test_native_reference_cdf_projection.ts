/** Synthetic native CDF streaming tests; no operating authorization is implied. */
import {
  type NativeCdfPin,
  NativeReferenceCdfProjection,
} from "../../supabase/functions/_shared/jungsi/domain/native_reference_cdf_projection.ts";
import { Rational } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
const H = (s: string) => s.repeat(64);
async function sha(b: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(b)))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
async function fixture(rows: (number | string)[][] = [[100, "2"], [200, "3"], [300, "1"]]) {
  const doc = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_rule_id: "rule",
    model_references: { pack: { sha256: H("a") } },
    engine_approved: false,
    production_allowed: false,
    data_kind: "fixed_mock_model_reference_not_actual_admission",
    actual_2027_csat_available: false,
    support_bin_count: rows.length,
    eligible_weight_units: "6",
    weight_decimal_scale: 0,
    whole_model_weight: "10",
    whole_model_weight_units: "10",
    score_denominator: 100,
    decoy: { frequencies_numerator_integer_weight: "ignored" },
    frequencies_numerator_integer_weight: rows,
  };
  const method: NativeObject = {
    method_id: "estimated-whole-cohort-percentile:" + H("b"),
    metric: "estimated_upper_cumulative_percent_all_examinees",
    native_score_and_source_definition_metadata: {
      academic_year: 2027,
      source_rule_id: "rule",
      score_denominator: 100,
      engine_approved: false,
      reference_curve_id: "curve",
    },
    binding: {
      projection_arguments: {
        expected_curve_id: "curve",
        eligible_weight_units: "6",
        weight_decimal_scale: 0,
        whole_model_weight_decimal: "10",
      },
    },
  };
  const raw = new TextEncoder().encode(JSON.stringify(doc));
  const pin: NativeCdfPin = {
    sourceSha256: await sha(raw),
    sourceBytes: raw.length,
    methodId: method.method_id as string,
    year: 2027,
    examId: "exam",
    examType: "september_mock",
    sourcePackVersion: "pack",
    modelPackSha256: H("a"),
    ruleVersion: "rule",
    scoreScaleId: "axis",
    offeringId: "offering",
    maximumSupportRows: 125000,
  };
  const identity: NativeObject = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_pack_version: "pack",
    rule_version: "rule",
    score_scale_id: "axis",
    offering_id: "offering",
  };
  return { raw, pin, method, identity };
}
async function denied(f: () => Promise<unknown>) {
  let yes = false;
  try {
    await f();
  } catch {
    yes = true;
  }
  assert(yes);
}
Deno.test("native streaming CDF uses whole cohort denominator and inclusive ties", async () => {
  const f = await fixture(),
    s = new AbortController().signal,
    p = await NativeReferenceCdfProjection.bind(f.raw, f.pin, f.method, s);
  equal(
    (await p.query(new Rational(2n), f.identity, s))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "40.000000000000",
  );
  equal(
    (await p.query(new Rational(5n, 2n), f.identity, s))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "10.000000000000",
  );
  equal(
    (await p.query(new Rational(3n), f.identity, s))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "10.000000000000",
  );
  equal(await p.query(new Rational(4n), f.identity, s), null);
});
Deno.test("native CDF refuses wrong hash, model pack, scope or support cap", async () => {
  for (const kind of ["hash", "model", "limit", "identity"]) {
    const f = await fixture(), s = new AbortController().signal;
    if (kind === "hash") f.pin = { ...f.pin, sourceSha256: H("c") };
    if (kind === "model") f.pin = { ...f.pin, modelPackSha256: H("c") };
    if (kind === "limit") f.pin = { ...f.pin, maximumSupportRows: 2 };
    if (kind === "identity") {
      const p = await NativeReferenceCdfProjection.bind(f.raw, f.pin, f.method, s);
      f.identity.offering_id = "other";
      await denied(() => p.query(new Rational(2n), f.identity, s));
    } else await denied(() => NativeReferenceCdfProjection.bind(f.raw, f.pin, f.method, s));
  }
});
Deno.test("native CDF refuses duplicate score, zero weight and incorrect total", async () => {
  for (
    const rows of [[[100, "2"], [100, "3"], [300, "1"]], [[100, "0"], [200, "3"], [300, "1"]], [
      [100, "2"],
      [200, "3"],
      [300, "2"],
    ]]
  ) {
    const f = await fixture(rows), s = new AbortController().signal;
    await denied(() => NativeReferenceCdfProjection.bind(f.raw, f.pin, f.method, s));
  }
});
Deno.test("native streaming checks cancellation during large input", async () => {
  const rows = Array.from({ length: 10000 }, (_, i) => [i + 1, "1"] as (number | string)[]),
    f = await fixture(rows);
  const doc = JSON.parse(new TextDecoder().decode(f.raw));
  doc.eligible_weight_units = "10000";
  doc.whole_model_weight = "10000";
  doc.whole_model_weight_units = "10000";
  f.raw = new TextEncoder().encode(JSON.stringify(doc));
  (f.method.binding as NativeObject).projection_arguments = {
    expected_curve_id: "curve",
    eligible_weight_units: "10000",
    weight_decimal_scale: 0,
    whole_model_weight_decimal: "10000",
  };
  f.pin = { ...f.pin, sourceSha256: await sha(f.raw), sourceBytes: f.raw.length };
  const c = new AbortController();
  const work = NativeReferenceCdfProjection.bind(f.raw, f.pin, f.method, c.signal);
  setTimeout(() => c.abort(), 0);
  await denied(() => work);
});
Deno.test("native sparse index preserves exact ties at every block boundary", async () => {
  const rows = Array.from({ length: 4098 }, (_, i) => [i + 1, "1"] as (number | string)[]),
    f = await fixture(rows);
  const doc = JSON.parse(new TextDecoder().decode(f.raw));
  doc.eligible_weight_units = "4098";
  doc.whole_model_weight = "5000";
  doc.whole_model_weight_units = "5000";
  f.raw = new TextEncoder().encode(JSON.stringify(doc));
  (f.method.binding as NativeObject).projection_arguments = {
    expected_curve_id: "curve",
    eligible_weight_units: "4098",
    weight_decimal_scale: 0,
    whole_model_weight_decimal: "5000",
  };
  f.pin = { ...f.pin, sourceSha256: await sha(f.raw), sourceBytes: f.raw.length };
  const s = new AbortController().signal,
    p = await NativeReferenceCdfProjection.bind(f.raw, f.pin, f.method, s);
  equal(
    (await p.query(new Rational(2048n, 100n), f.identity, s))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "41.020000000000",
  );
  equal(
    (await p.query(new Rational(4097n, 200n), f.identity, s))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "41.000000000000",
  );
  equal(
    (await p.query(new Rational(2049n, 100n), f.identity, s))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "41.000000000000",
  );
});

Deno.test("native CDF independently binds source rule and calculator version", async () => {
  const f = await fixture(), s = new AbortController().signal;
  f.pin = { ...f.pin, sourceRuleId: "rule", ruleVersion: "calculator-v1" };
  f.identity.rule_version = "calculator-v1";
  const p = await NativeReferenceCdfProjection.bind(f.raw, f.pin, f.method, s);
  equal(
    (await p.query(new Rational(2n), f.identity, s))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "40.000000000000",
  );
  await denied(() =>
    NativeReferenceCdfProjection.bind(
      f.raw,
      { ...f.pin, sourceRuleId: "wrong-source" },
      f.method,
      s,
    )
  );
  await denied(() =>
    NativeReferenceCdfProjection.bind(f.raw, { ...f.pin, sourceRuleId: "" }, f.method, s)
  );
  f.identity.rule_version = "wrong-calculator";
  await denied(() => p.query(new Rational(2n), f.identity, s));
});
