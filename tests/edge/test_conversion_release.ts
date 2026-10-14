import {
  NativeConversionRelease,
  NativeConversionRule,
} from "../../supabase/functions/_shared/jungsi/domain/conversion_release.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal, rejects, syntheticFixture } from "./fixture.ts";
function data() {
  return syntheticFixture().bundle.rule as unknown as NativeObject;
}
function profile() {
  return { ...syntheticFixture().profile, score_basis: "actual_exam" };
}
Deno.test("native conversion adapts numeric bounds and rank weights while preserving immutable raw float types", () => {
  const d = data();
  d.inputs = {
    korean: {
      type: "number",
      min: new JsonFloat("0.0"),
      max: new JsonFloat("100.0"),
      integer: false,
    },
  };
  d.nodes = {
    score: {
      op: "rank_weighted",
      args: [{ op: "input", field: "korean" }],
      weights: [new JsonFloat("0.5")],
    },
  };
  d.official_max_score = new JsonFloat("100.0");
  const r = new NativeConversionRule(d);
  assert(r.data.official_max_score instanceof JsonFloat);
  const c = r.calculate({
    ...profile(),
    values: { korean: new JsonFloat("10.5") },
  }, true);
  equal(c.score.toString(), "21/4");
  assert(
    Object.isFrozen(r.data) &&
      (r.data.inputs as NativeObject).korean !== d.inputs.korean,
  );
});
Deno.test("native conversion raw decimal constants and numeric structural names never become valid text or integers", () => {
  const d = data();
  d.nodes = { score: { op: "const", value: new JsonFloat("2.0") } };
  rejects(() => new NativeConversionRule(d), "INVALID_CONSTANT");
  const e = data();
  e.nodes = { score: { op: "input", field: new JsonFloat("2.0") } };
  rejects(() => new NativeConversionRule(e), "UNKNOWN_INPUT");
});
Deno.test("native conversion explicit null defaults remain invalid", () => {
  for (const field of ["display_places"]) {
    const d = data();
    d[field] = null;
    rejects(() => new NativeConversionRule(d), "INVALID_PRECISION");
  }
  const d = data();
  ((d.inputs as NativeObject).korean as NativeObject).integer = null;
  rejects(() => new NativeConversionRule(d), "INVALID_INPUT_TYPE");
});
Deno.test("native conversion rule is not promoted by source validation or synthetic data", () => {
  const d = data(), r = new NativeConversionRule(d);
  rejects(() => r.calculate(profile()), "RULE_NOT_APPROVED");
  d.review_status = "calculation_verified";
  const approved = new NativeConversionRule(d);
  rejects(() => approved.calculate(profile()), "RULE_NOT_APPROVED");
});
Deno.test("native conversion release binds exact year offering and rejects duplicate or mismatched rows", () => {
  const d = data(),
    binding = {
      academic_year: 2027,
      offering_pk: "SYNTHETIC-OFFERING",
      rule_version: d.rule_version,
    };
  const r = new NativeConversionRelease("SYNTHETIC-release", [d], [binding]);
  equal(r.binding(2027, "SYNTHETIC-OFFERING"), d.rule_version);
  equal(r.binding(2026, "SYNTHETIC-OFFERING"), null);
  assert(r.rule(d.rule_version as string) instanceof NativeConversionRule);
  rejects(
    () => new NativeConversionRelease("SYNTHETIC-release", [d], [binding, binding]),
    "RULE_BINDING_AMBIGUOUS",
  );
  rejects(
    () =>
      new NativeConversionRelease("SYNTHETIC-release", [d], [{
        ...binding,
        academic_year: 2026,
      }]),
    "BINDING_YEAR_MISMATCH",
  );
});
