import { syncPromise } from "./fixture.ts";
import {
  evaluateOffering,
  NativeOfferingAnalysisRelease,
  scoreEligibility,
} from "../../supabase/functions/_shared/jungsi/application/offering_analysis.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { UniversityPercentileService } from "../../supabase/functions/_shared/jungsi/application/university_percentile.ts";
import {
  cloneNativeJson,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { syntheticOfferingAnalysisFixture } from "./synthetic_offering_analysis.ts";
import { assert, equal } from "./fixture.ts";
async function fixture() {
  const f = syntheticOfferingAnalysisFixture(),
    conversion = await new UniversityScoringService(f.data).calculate(
      f.data.offering,
      f.data.profile(),
    );
  const m = f.settings.curves.get(2027)!.metadata;
  const percentile = await new UniversityPercentileService({
    getPercentile() {
      return syncPromise(() => {
        return {
          version: "SYNTHETIC-percentile.v1",
          status: "approved",
          releaseId: "SYNTHETIC-percentile-release",
          academicYear: 2027,
          examId: f.data.pack!.examId,
          sourcePackVersion: f.data.pack!.packVersion,
          examType: "csat",
          ruleVersion: conversion.state.rule_version!,
          curve: f.settings.curves.get(2027)!,
          bindings: [{
            ...f.data.offering,
            offering_pk: f.data.offering.offering_id,
            rule_version: conversion.state.rule_version,
            curve_version: m.curve_version,
          }],
        };
      });
    },
  }).calculate(f.data.offering, conversion);
  assert(conversion.ready && percentile.ready);
  return {
    ...f,
    conversion,
    percentile,
    run: (release: NativeOfferingAnalysisRelease | null = f.release()) =>
      evaluateOffering(
        f.data.offering,
        f.data.profile(),
        f.overall,
        release,
        conversion,
        percentile,
      ),
  };
}
Deno.test("approved four-year analysis keeps converted scores tails eligibility and actual advantage", async () => {
  const f = await fixture(), r = f.run();
  equal(r.status, "ready");
  equal(r.category, "core");
  equal(r.converted_score, "30.00");
  equal(r.converted_percentile, "44.444444");
  equal((r.years as NativeObject[]).map((y) => y.status), ["ready", "ready", "ready", "ready"]);
  equal((r.advantage as NativeObject).delta_pp, "22.222222");
  equal(r.eligibility_status, "eligible");
});
Deno.test("missing analysis never erases independent conversion percentile or current year", async () => {
  const f = await fixture(), r = f.run(null);
  equal(r.reason_code, "analysis_release_missing");
  equal(r.converted_score, "30.00");
  equal(r.converted_percentile, "44.444444");
  equal((r.years as NativeObject[]).length, 4);
  equal((r.years as NativeObject[])[3].status, "ready");
});
Deno.test("pending total model holds only other year bridges when current same-exam result is ready", async () => {
  const f = await fixture();
  f.overall.overall = {
    status: "pending",
    reason_code: "total_model_missing",
    model_version: null,
  };
  const r = f.run();
  equal(r.status, "ready");
  equal((r.years as NativeObject[]).slice(0, 3).map((y) => y.reason_code), [
    "total_model_missing",
    "total_model_missing",
    "total_model_missing",
  ]);
});
Deno.test("explicit bad percentile artifact cannot be bypassed by legacy curve", async () => {
  const f = await fixture(),
    missing = f.percentile.with({
      inclusive: null,
      exclusive: null,
      reason_code: "percentile_release_missing",
    });
  const legacy = evaluateOffering(
    f.data.offering,
    f.data.profile(),
    f.overall,
    f.release(),
    f.conversion,
    missing,
  );
  equal(legacy.status, "ready");
  const invalid = f.percentile.with({
    inclusive: null,
    exclusive: null,
    reason_code: "percentile_release_context_mismatch",
  });
  const held = evaluateOffering(
    f.data.offering,
    f.data.profile(),
    f.overall,
    f.release(),
    f.conversion,
    invalid,
  );
  equal(held.status, "pending");
  equal(held.reason_code, "percentile_release_context_mismatch");
  equal(held.converted_score, "30.00");
});
Deno.test("decision context and evidence failure hold judgment while successful score remains", async () => {
  const f = await fixture(),
    decisions = new Map(f.settings.decisions),
    d = cloneNativeJson(decisions.get(2027)!);
  (d.context as NativeObject).offering_id = "SYNTHETIC-other";
  decisions.set(2027, d);
  const r = f.run(new NativeOfferingAnalysisRelease({ ...f.settings, decisions }));
  equal(r.reason_code, "decision_context_mismatch");
  equal(r.converted_score, "30.00");
  const g = await fixture(),
    map = new Map(g.settings.decisions),
    bad = cloneNativeJson(map.get(2027)!);
  ((bad.evidence as NativeObject).historical_metrics as NativeObject[])[0].source_url =
    "https://example.invalid/a?access_token=SYNTHETIC";
  map.set(2027, bad);
  equal(
    g.run(new NativeOfferingAnalysisRelease({ ...g.settings, decisions: map })).reason_code,
    "decision_evidence_unapproved",
  );
});
Deno.test("eligibility distinguishes missing confirmation ineligible and real threshold", () => {
  equal(
    scoreEligibility({ english_grade: 3 }, {
      status: "approved",
      version: "SYNTHETIC",
      requirements: [{ field: "english_grade", operator: "at_most", value: 3 }],
    }),
    "eligible",
  );
  equal(
    scoreEligibility({ english_grade: 4 }, {
      status: "approved",
      version: "SYNTHETIC",
      requirements: [{ field: "english_grade", operator: "at_most", value: 3 }],
    }),
    "ineligible",
  );
  equal(
    scoreEligibility({ english_grade: null }, {
      status: "approved",
      version: "SYNTHETIC",
      requirements: [{ field: "english_grade", operator: "at_most", value: 3 }],
    }),
    "needs_confirmation",
  );
  equal(
    scoreEligibility({ english_grade: 3 }, {
      status: "approved",
      version: "SYNTHETIC",
      requirements: null,
    }),
    "needs_confirmation",
  );
});
Deno.test("overlapping support ranges hold judgment and approved counselor adjustment applies once", async () => {
  const f = await fixture(),
    decisions = new Map(f.settings.decisions),
    d = cloneNativeJson(decisions.get(2027)!);
  (d.ranges as NativeObject[]).push({ lower: 29, upper: 31, category: "room" });
  decisions.set(2027, d);
  equal(
    f.run(new NativeOfferingAnalysisRelease({ ...f.settings, decisions })).reason_code,
    "decision_range_unconfirmed",
  );
  const g = await fixture(),
    map = new Map(g.settings.decisions),
    a = cloneNativeJson(map.get(2027)!);
  a.adjustment = {
    status: "approved",
    base_version: a.version,
    version: "SYNTHETIC-adjustment.v1",
    ranges: [{ lower: 0, upper: 100, category: "challenge" }],
  };
  map.set(2027, a);
  const r = g.run(new NativeOfferingAnalysisRelease({ ...g.settings, decisions: map }));
  equal(r.category, "challenge");
  equal((r.decision_components as NativeObject).base_category, "core");
  equal((r.decision_components as NativeObject).adjusted_category, "challenge");
});
Deno.test("analysis source pack and binding mismatches remain distinct holds", async () => {
  const f = await fixture();
  equal(
    f.run(
      new NativeOfferingAnalysisRelease({ ...f.settings, sourcePackVersion: "SYNTHETIC-other" }),
    ).reason_code,
    "analysis_pack_mismatch",
  );
  equal(
    f.run(
      new NativeOfferingAnalysisRelease({
        ...f.settings,
        offeringsByYear: { ...f.settings.offeringsByYear, "2027": "SYNTHETIC-other" },
      }),
    ).reason_code,
    "offering_binding_mismatch",
  );
  equal(
    f.run(new NativeOfferingAnalysisRelease({ ...f.settings, status: "draft" })).reason_code,
    "analysis_release_not_approved",
  );
});
