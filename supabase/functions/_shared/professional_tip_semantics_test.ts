/** Actual reason composer + professional HTTP/report/fixed-print path, invented ports only. */
import { professionalCounselingReasons } from "./jungsi/application/professional_analysis.ts";
import { blockedOffering } from "./jungsi/application/offering_analysis.ts";
import { type NativeObject } from "./jungsi/domain/json_value.ts";
import { assert, equal, fixture, PROFILE } from "./professional_support.ts";

function assessment(): NativeObject {
  return {
    status: "ready",
    category: "room",
    converted_score: "9007199254740993.1234567890123456789",
    percentile: {
      status: "ready",
      reason_code: null,
      academic_year: 2027,
      population_id: "SYNTHETIC-population",
    },
    decision_components: {
      base_category: "core",
      adjusted_category: "room",
      adopted_category: "room",
    },
    decision_evidence: {
      expected_acceptance_range: {
        lower: "9007199254740992.0000000000000000001",
        upper: "9007199254740994.9999999999999999999",
        unit: "점",
        definition: "서비스 승인 기준구간 정의",
        policy_version: "SYNTHETIC-policy",
      },
      historical_metrics: [{
        source_url: "https://synthetic.invalid/official-result",
        academic_year: 2026,
        metric_name: "70%컷",
      }],
    },
  };
}
function reasons(a: NativeObject) {
  return professionalCounselingReasons({ "SYNTHETIC-offering": a }, 2027);
}
Deno.test("professional tip separates actual population, policy and approved baseline definition", () => {
  const a = assessment(), r = reasons(a)[0], c = r.comparison_context as NativeObject;
  equal(c.population_id, "SYNTHETIC-population");
  equal(c.policy_version, "SYNTHETIC-policy");
  equal(c.range_definition, "서비스 승인 기준구간 정의");
  equal(c.range_role, "baseline_reference");
  equal((r.values as NativeObject[])[0].value, a.converted_score);
  equal((a.decision_components as NativeObject).adjusted_category, "room");
});
for (const change of ["missing", "pending", "wrong_year", "bad_id"]) {
  Deno.test("professional tip unavailable population stays null: " + change, () => {
    const a = assessment(), p = a.percentile as NativeObject;
    if (change === "missing") delete a.percentile;
    if (change === "pending") p.status = "pending";
    if (change === "wrong_year") p.academic_year = 2026;
    if (change === "bad_id") p.population_id = "not an identifier";
    equal((reasons(a)[0].comparison_context as NativeObject).population_id, null);
  });
}
for (const field of ["definition", "unit", "policy_version", "source"]) {
  Deno.test("professional tip missing approved evidence emits no reason: " + field, () => {
    const a = assessment(), e = a.decision_evidence as NativeObject;
    if (field === "source") e.historical_metrics = [];
    else (e.expected_acceptance_range as NativeObject)[field] = null;
    equal(reasons(a), []);
  });
}
Deno.test("professional tip exact reason survives HTTP report read and fixed revision print", async () => {
  const f = await fixture(), a = assessment(), rs = reasons(a);
  f.ports.analysis.analyze = async () =>
    await ({
      result: blockedOffering("SYNTHETIC-offering", "analysis_release_missing"),
      reasons: rs,
    });
  const response = await f.handler(
    f.request("pro.university.analyze", {
      profile_id: PROFILE,
      expected_profile_version: PROFILE,
      offering_id: "SYNTHETIC-offering",
    }),
  );
  equal(response.status, 200);
  equal(response.headers.get("cache-control"), "private, no-store");
  const read = await f.handler(f.request("pro.report.read"));
  equal(read.status, 200);
  const report = (await read.json()).data;
  equal(report.counseling_reasons, rs);
  const printed = await f.handler(
    f.request("pro.report.export", { revision_id: report.revision_id }),
  );
  equal(printed.status, 200);
  equal((await printed.json()).data.counseling_reasons, rs);
  assert(f.f.reserveCalls.length === 3); // no extra analysis or retry introduced
});

Deno.test("professional tip legacy missing definition preserves stored report without a misleading reason", async () => {
  const f = await fixture(), rs = reasons(assessment());
  delete (rs[0].comparison_context as NativeObject).range_definition;
  f.f.reports.set(f.baseReport.reportId, { ...f.baseReport, reasons: rs });
  const response = await f.handler(f.request("pro.report.read"));
  equal(response.status, 200);
  const report = (await response.json()).data;
  equal(report.counseling_reasons, []);
  equal(report.profile_id, PROFILE);
  equal(f.f.analysisCalls, 0);
});
