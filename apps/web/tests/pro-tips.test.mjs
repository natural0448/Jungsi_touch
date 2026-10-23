import test from "node:test";
import assert from "node:assert/strict";
import { tipLine } from "../src/lib/pro-tips.ts";
const reason = () => ({ code: "classification_basis", status: "ready", academic_year: 2027, offering_id: "SYNTHETIC-offering", comparison_context: { academic_year: 2027, reference_year: null, metric: "converted_score", score_scale: "university_converted_score", population_id: "SYNTHETIC-population", policy_version: "SYNTHETIC-policy", range_definition: "승인된 서비스 기준 정의", range_role: "baseline_reference" }, values: [ { name: "converted_score", value: "9007199254740993.1234567890123456789", unit: "점" }, { name: "acceptance_lower", value: "9007199254740992.0000000000000000001", unit: "점" }, { name: "acceptance_upper", value: "9007199254740994.9999999999999999999", unit: "점" } ], public_basis: [], missing_reason: null });
test("classification text preserves exact decimals and baseline definition without invented differences", () => {
  const r = reason(), line = tipLine(r);
  for (const x of r.values) assert.ok(line.text.includes(x.value));
  assert.ok(line.text.includes(r.comparison_context.range_definition));
  assert.ok(line.text.includes(r.comparison_context.policy_version));
  assert.ok(line.text.includes("기준구간 참고")); assert.ok(!line.text.includes("핵심 검토 구간"));
  assert.ok(!line.text.includes("낮습니다")); assert.ok(!line.text.includes("높습니다"));
  assert.ok(line.caution.includes("대학 공식 발표 합격선이 아닙니다"));
});
for (const field of ["range_definition", "policy_version", "range_role"]) test("missing context hides classification text: " + field, () => { const r = reason(); r.comparison_context[field] = null; assert.equal(tipLine(r), null); });
test("incompatible score unit hides classification text", () => { const r = reason(); r.values[1].unit = "%"; assert.equal(tipLine(r), null); });
test("weight changes alone stay neutral even with unverified relative flag", () => {
  for (const relative of ["weak", "strong"]) {
    const r = { ...reason(), code: "rule_weight_change", values: [ {name: "area", value: "수학"}, {name:"previous_weight", value:"33.333333333333333333"}, {name:"current_weight", value:"40.000000000000000001"}, {name:"student_relative", value:relative} ] };
    const line = tipLine(r); assert.ok(line.text.includes("40.000000000000000001")); assert.ok(!line.text.includes("유리")); assert.ok(!line.caution.includes("불리하게"));
  }
});
test("three-year code cannot display synthetic within-year band", () => {
  const r = { ...reason(), code: "historical_cut_spread", values: [{name:"cut50",value:"710"},{name:"cut70",value:"700"},{name:"gap",value:"10"}] };
  assert.equal(tipLine(r), null);
  r.code = "demo_prior_year_cut_band"; r.comparison_context.reference_year = 2026;
  assert.ok(tipLine(r).text.includes("합성 시연")); assert.ok(tipLine(r).text.includes("3개년 70%컷 변동이 아닙니다"));
});
