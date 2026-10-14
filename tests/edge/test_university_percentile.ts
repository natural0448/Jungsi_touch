import { syncPromise } from "./fixture.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import {
  type UniversityPercentileRelease,
  UniversityPercentileService,
} from "../../supabase/functions/_shared/jungsi/application/university_percentile.ts";
import { NativeUniversityScoreDistribution } from "../../supabase/functions/_shared/jungsi/domain/university_distribution.ts";
import { OVERALL_POPULATION_ID } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { pythonDefaultStrJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/python_json_digest.ts";
import { type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SyntheticUniversityData } from "./synthetic_university.ts";
import { syntheticUniversityCurveData } from "./synthetic_university_curve.ts";
import { assert, equal } from "./fixture.ts";

Deno.test("partial population missing validation checks stays unverified rather than passed", async () => {
  const f = await partialFixture();
  const { checks: _checks, ...receipt } = f.state.bundle!.validationReceipt!;
  f.state.bundle = { ...f.state.bundle!, validationReceipt: receipt };
  equal(
    (await f.service.calculate(f.data.offering, f.conversion)).state.reason_code,
    "percentile_population_unverified",
  );
  const g = await partialFixture();
  g.state.bundle = {
    ...g.state.bundle!,
    validationReceipt: { ...g.state.bundle!.validationReceipt!, validation_checks: null },
  };
  equal(
    (await g.service.calculate(g.data.offering, g.conversion)).state.reason_code,
    "percentile_population_unverified",
  );
});
async function fixture(partial = false) {
  const data = new SyntheticUniversityData();
  data.bundle = data.release({
    ...data.rawRule,
    score_scale_id: "SYNTHETIC-scale",
    bonus_treatment: "excluded",
  });
  const conversion = await new UniversityScoringService(data).calculate(
    data.offering,
    data.profile(),
  );
  assert(conversion.ready);
  const raw = syntheticUniversityCurveData();
  if (partial) {
    (raw.metadata as NativeObject).population_id = "SYNTHETIC-required-population";
  }
  const curve = new NativeUniversityScoreDistribution(raw),
    binding = {
      ...data.offering,
      offering_pk: data.offering.offering_id,
      rule_version: conversion.state.rule_version,
      curve_version: curve.metadata.curve_version,
    };
  const state: { bundle: UniversityPercentileRelease | null } = {
    bundle: {
      version: "SYNTHETIC-percentile.v1",
      status: "approved",
      releaseId: "SYNTHETIC-percentile.v1",
      academicYear: 2027,
      examId: conversion.state.exam_id,
      sourcePackVersion: conversion.state.pack_version,
      examType: "csat",
      ruleVersion: conversion.state.rule_version!,
      curve,
      bindings: [binding],
      comparisonPopulation: null,
      validationReceipt: null,
    },
  };
  const port = {
    getPercentile() {
      return syncPromise(() => {
        return state.bundle;
      });
    },
  };
  return {
    data,
    conversion,
    state,
    curve,
    service: new UniversityPercentileService(port),
  };
}
async function partialFixture() {
  const f = await fixture(true), m = f.curve.metadata, s = f.conversion.state;
  const shared = {
    population_id: m.population_id,
    academic_year: m.academic_year,
    exam_id: m.exam_id,
    rule_version: m.rule_version,
    curve_version: m.curve_version,
    source_pack_version: s.pack_version,
    required_input_fields: [...s.required_input_fields],
  };
  const c = {
    ...shared,
    format: "jungsi.university-comparison-population/v1",
    status: "approved",
    scope: "required_rule_inputs_present",
    base_population_id: OVERALL_POPULATION_ID,
    validation_receipt_version: "SYNTHETIC-receipt.v1",
  };
  const receipt = {
    ...shared,
    format: "jungsi.estimate-release-receipt/v1",
    status: "approved",
    version: "SYNTHETIC-receipt.v1",
    source_model_version: m.source_model_version,
    curve_sha256: await pythonDefaultStrJsonSha256(f.curve.data),
    validation_status: "self_validated_estimate",
    checks: {
      model_validation: true,
      filter_complete: true,
      rule_replay: true,
      serialization: true,
    },
    validation_checks: { SYNTHETIC: true },
    population_ledger: {
      total_complete_weight: 12,
      retained_weight: 9,
      excluded_weight: 3,
      exclusions: [{
        weight: 3,
        missing_input_fields: [s.required_input_fields[0]],
      }],
    },
  };
  f.state.bundle = {
    ...f.state.bundle!,
    comparisonPopulation: c,
    validationReceipt: receipt,
  };
  return f;
}
Deno.test("university percentile preserves exact tails independent of successful conversion", async () => {
  const f = await fixture(),
    p = await f.service.calculate(f.data.offering, f.conversion);
  assert(p.ready);
  equal(p.state.inclusive!.toString(), "4/9");
  equal(p.dto().top_percent, "44.444444");
  equal(p.dto().tie_share_percent, "0.000000");
  equal(p.dto().population_scope, "whole_complete");
  assert(f.conversion.ready);
  equal(f.conversion.dto().converted_score, "30.00");
  for (const k of ["inclusive", "exclusive", "context", "exact_score"]) {
    assert(!Object.hasOwn(p.dto(), k));
  }
});
Deno.test("missing percentile release keeps successful score and held percentile state", async () => {
  const f = await fixture();
  f.state.bundle = null;
  const p = await f.service.calculate(f.data.offering, f.conversion);
  equal(p.state.reason_code, "percentile_release_missing");
  equal(p.dto().top_percent, null);
  assert(f.conversion.ready);
});
Deno.test("university percentile requires full conversion scale and bonus context", async () => {
  const f = await fixture(),
    bad = f.conversion.with({
      context: { ...f.conversion.state.context, score_scale_id: null },
    });
  equal(
    (await f.service.calculate(f.data.offering, bad)).state.reason_code,
    "percentile_conversion_context_missing",
  );
  const mismatch = f.conversion.with({
    context: { ...f.conversion.state.context, group: "SYNTHETIC-other" },
  });
  equal(
    (await f.service.calculate(f.data.offering, mismatch)).state.reason_code,
    "percentile_conversion_context_mismatch",
  );
});
Deno.test("university percentile release binds exam year rule and source pack", async () => {
  for (
    const patch of [
      { examId: "SYNTHETIC-other" },
      { sourcePackVersion: "SYNTHETIC-other" },
      { academicYear: 2026 },
      { ruleVersion: "SYNTHETIC-other" },
    ]
  ) {
    const f = await fixture();
    f.state.bundle = { ...f.state.bundle!, ...patch };
    equal(
      (await f.service.calculate(f.data.offering, f.conversion)).state
        .reason_code,
      "percentile_release_context_mismatch",
    );
  }
  const f = await fixture();
  f.state.bundle = { ...f.state.bundle!, status: "draft" };
  equal(
    (await f.service.calculate(f.data.offering, f.conversion)).state
      .reason_code,
    "percentile_release_not_approved",
  );
});
Deno.test("university percentile independently checks curve metadata and offering bindings", async () => {
  const f = await fixture(), raw = syntheticUniversityCurveData();
  (raw.metadata as NativeObject).bonus_treatment = "included";
  f.state.bundle = {
    ...f.state.bundle!,
    curve: new NativeUniversityScoreDistribution(raw),
  };
  equal(
    (await f.service.calculate(f.data.offering, f.conversion)).state
      .reason_code,
    "percentile_curve_context_mismatch",
  );
  const g = await fixture();
  g.state.bundle = {
    ...g.state.bundle!,
    bindings: [...g.state.bundle!.bindings, ...g.state.bundle!.bindings],
  };
  equal(
    (await g.service.calculate(g.data.offering, g.conversion)).state
      .reason_code,
    "percentile_binding_ambiguous",
  );
  const h = await fixture();
  h.state.bundle = {
    ...h.state.bundle!,
    bindings: h.state.bundle!.bindings.map((b) => ({
      ...b,
      campus: "SYNTHETIC-other",
    })),
  };
  equal(
    (await h.service.calculate(h.data.offering, h.conversion)).state
      .reason_code,
    "percentile_binding_mismatch",
  );
});
Deno.test("whole population curve cannot be relabeled by partial population contract", async () => {
  const f = await fixture();
  f.state.bundle = {
    ...f.state.bundle!,
    comparisonPopulation: { status: "approved" },
  };
  equal(
    (await f.service.calculate(f.data.offering, f.conversion)).state
      .reason_code,
    "percentile_population_mismatch",
  );
});
Deno.test("partial university curve requires an independent matching receipt before tails", async () => {
  const f = await fixture(true);
  equal(
    (await f.service.calculate(f.data.offering, f.conversion)).state
      .reason_code,
    "percentile_population_receipt_missing",
  );
  const g = await partialFixture(),
    p = await g.service.calculate(g.data.offering, g.conversion);
  assert(p.ready, p.state.reason_code ?? "");
  equal(p.dto().population_scope, "required_rule_inputs_present");
  equal(p.dto().population_id, "SYNTHETIC-required-population");
});
Deno.test("partial population curve hash and validation booleans cannot be asserted by one flag", async () => {
  const f = await partialFixture();
  f.state.bundle = {
    ...f.state.bundle!,
    validationReceipt: {
      ...f.state.bundle!.validationReceipt!,
      curve_sha256: "0".repeat(64),
    },
  };
  equal(
    (await f.service.calculate(f.data.offering, f.conversion)).state
      .reason_code,
    "percentile_population_receipt_mismatch",
  );
  const g = await partialFixture();
  g.state.bundle = {
    ...g.state.bundle!,
    validationReceipt: {
      ...g.state.bundle!.validationReceipt!,
      checks: {
        model_validation: true,
        filter_complete: true,
        rule_replay: true,
        serialization: false,
      },
    },
  };
  equal(
    (await g.service.calculate(g.data.offering, g.conversion)).state
      .reason_code,
    "percentile_population_unverified",
  );
});
Deno.test("partial population retained excluded and complete weights must reconcile exactly", async () => {
  const f = await partialFixture(),
    receipt = f.state.bundle!.validationReceipt!,
    ledger = receipt.population_ledger as NativeObject;
  f.state.bundle = {
    ...f.state.bundle!,
    validationReceipt: {
      ...receipt,
      population_ledger: { ...ledger, total_complete_weight: 11 },
    },
  };
  equal(
    (await f.service.calculate(f.data.offering, f.conversion)).state
      .reason_code,
    "percentile_population_weight_mismatch",
  );
  const g = await partialFixture(),
    r = g.state.bundle!.validationReceipt!,
    l = r.population_ledger as NativeObject;
  g.state.bundle = {
    ...g.state.bundle!,
    validationReceipt: {
      ...r,
      population_ledger: {
        ...l,
        exclusions: [{
          weight: 3,
          missing_input_fields: ["SYNTHETIC-unknown"],
        }],
      },
    },
  };
  equal(
    (await g.service.calculate(g.data.offering, g.conversion)).state
      .reason_code,
    "percentile_population_exclusion_mismatch",
  );
});
Deno.test("percentile snapshots are immutable and incomplete conversion never requests a curve", async () => {
  const f = await fixture();
  let calls = 0;
  const service = new UniversityPercentileService({
    getPercentile() {
      return syncPromise(() => {
        calls++;
        return f.state.bundle;
      });
    },
  });
  const p = await service.calculate(
    f.data.offering,
    f.conversion.with({ score: null, reason_code: "REQUIRED_INPUT_MISSING" }),
  );
  equal(p.state.reason_code, "conversion_not_ready");
  equal(calls, 0);
  const ready = await f.service.calculate(f.data.offering, f.conversion);
  assert(Object.isFrozen(ready.state.context));
});
