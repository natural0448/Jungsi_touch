import test from "node:test";
import assert from "node:assert/strict";

const { roundPercent1, referencePercentText, referenceGroups } = await import("../src/lib/reference-percentile.ts");

const rp = (v, status = "reference_estimated") => ({
  status,
  estimated_upper_cumulative_percent_all_examinees: v,
  metric: "estimated_upper_cumulative_percent_all_examinees",
  denominator_kind: "same_year_original_model_whole_exact_mass",
  calculation_review_scope: "same_exam_mathematical_reference",
  production_allowed: false,
  actual_admission_full_total_approved: false,
});

test("exact decimal strings round half-up to one decimal place without float error", () => {
  assert.equal(roundPercent1("16.666611111296"), "16.7");
  assert.equal(roundPercent1("16.65"), "16.7"); // (16.65).toFixed(1) 는 16.6 — 문자열로 센다
  assert.equal(roundPercent1("16.649999"), "16.6");
  assert.equal(roundPercent1("0.04"), "0.0");
  assert.equal(roundPercent1("0.05"), "0.1");
  assert.equal(roundPercent1("99.96"), "100.0");
  assert.equal(roundPercent1("7"), "7.0");
  assert.equal(roundPercent1("100"), "100.0");
});

test("non-numeric or missing values are not shown", () => {
  for (const v of [null, undefined, "", "abc", "-1", "1e3", "12.", ".5", 16.6]) assert.equal(roundPercent1(v), null);
  assert.equal(referencePercentText(null), null);
  assert.equal(referencePercentText(undefined), null);
  assert.equal(referencePercentText(rp("12.34", "pending")), null);
  assert.equal(referencePercentText(rp("12.34")), "12.3");
});

test("reference groups keep server order, drop rows without a showable value and empty universities", () => {
  const off = (id) => ({ offering_id: id, department: id, group: "가", track: null });
  const c = {
    reference_university_groups: [
      { university_id: "2", university_name: "B", offerings: [{ offering: off("b1"), reference_percentile: rp("40.0") }, { offering: off("b2"), reference_percentile: rp("5.0") }] },
      { university_id: "1", university_name: "A", offerings: [{ offering: off("a1"), reference_percentile: null }] },
      { university_id: "3", university_name: "C", offerings: [{ offering: off("c1"), reference_percentile: rp("x") }, { offering: off("c2"), reference_percentile: rp("1.25") }] },
    ],
  };
  const g = referenceGroups(c);
  assert.deepEqual(g.map((x) => x.university_id), ["2", "3"]);
  assert.deepEqual(g[0].offerings.map((x) => x.offering.offering_id), ["b1", "b2"]); // 값 순으로 다시 줄 세우지 않는다
  assert.deepEqual(g[1].offerings.map((x) => x.offering.offering_id), ["c2"]);
});

test("no field, null or empty array hides the area", () => {
  assert.deepEqual(referenceGroups(undefined), []);
  assert.deepEqual(referenceGroups(null), []);
  assert.deepEqual(referenceGroups({}), []);
  assert.deepEqual(referenceGroups({ reference_university_groups: null }), []);
  assert.deepEqual(referenceGroups({ reference_university_groups: [] }), []);
});

test("range: lower floors and upper ceils to one decimal, single value when no upper bound (2026-11-16)", () => {
  const r = (lo, hi) => ({ ...rp(lo), ...(hi === undefined ? {} : { estimated_upper_cumulative_percent_upper_bound: hi }) });
  assert.equal(referencePercentText(r("12.36", "14.81")), "12.3~14.9");
  assert.equal(referencePercentText(r("12.36", "12.36")), "12.4"); // 같으면 한 값(반올림)
  assert.equal(referencePercentText(r("12.36")), "12.4"); // 옛 결과: 상한 없음
  assert.equal(referencePercentText(r("12.30", "12.30000")), "12.3");
  assert.equal(referencePercentText(r("12.31", "12.32")), "12.3~12.4");
  assert.equal(referencePercentText(r("49.999833333889", "100.000000000000")), "49.9~100.0");
  assert.equal(referencePercentText(r("12.3", "x")), "12.3"); // 상한이 숫자가 아니면 한 값
  assert.equal(referencePercentText(r("12.3", "11")), "12.3"); // 상한이 하한보다 작으면 한 값
});
