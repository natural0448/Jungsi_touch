import test from "node:test";
import assert from "node:assert/strict";
const { referenceAdvantage } = await import("../src/lib/reference-advantage.ts");

const ref = (lo, hi) => ({ status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: lo, ...(hi ? { estimated_upper_cumulative_percent_upper_bound: hi } : {}),
  calculation_review_scope: "same_exam_mathematical_reference", production_allowed: false, actual_admission_full_total_approved: false });
const all = (top, ex = null, inc = null) => ({ status: "estimated", reason_code: null, top_percent: top, exclusive_top_percent: ex, inclusive_top_percent: inc,
  tie_share_percent: null, tie_interval_percent: null, tie_policy: null, population_id: null, model_version: null });

test("single values: overall minus school, positive means a better position at this school (R16)", () => {
  assert.deepEqual(referenceAdvantage(ref("3.2"), all("4.45")), { text: "+1.3", tone: "up", mid: 1.25 });
  assert.equal(referenceAdvantage(ref("6.1"), all("4.0")).text, "−2.1");
  assert.equal(referenceAdvantage(ref("6.1"), all("4.0")).tone, "down");
  assert.equal(referenceAdvantage(ref("4.02"), all("4.0")).tone, "even");
});

test("ranges give [overall low − school high, overall high − school low]", () => {
  const r = referenceAdvantage(ref("3.0", "5.0"), all("4.0", "3.9", "4.1"));
  assert.equal(r.text, "−1.1~+1.1");
  assert.equal(r.tone, "even");
  assert.equal(referenceAdvantage(ref("1.0", "2.0"), all("4.0")).text, "+2.0~+3.0");
  assert.equal(referenceAdvantage(ref("1.0", "2.0"), all("4.0")).tone, "up");
});

test("nothing without a reference estimate or an overall position", () => {
  assert.equal(referenceAdvantage(null, all("4.0")), null);
  assert.equal(referenceAdvantage({ ...ref("3"), status: "pending" }, all("4.0")), null);
  assert.equal(referenceAdvantage(ref("3"), { ...all("4.0"), status: "pending" }), null);
  assert.equal(referenceAdvantage(ref("3"), null), null);
  assert.equal(referenceAdvantage(ref("x"), all("4.0")), null);
});
