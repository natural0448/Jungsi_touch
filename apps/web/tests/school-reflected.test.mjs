import test from "node:test";
import assert from "node:assert/strict";

const { reflectedPercentText, schoolReflectedView, schoolReflectedOf } = await import("../src/lib/school-reflected.ts");

const dto = (over = {}) => ({ status: "reference", value: 81.25, reason_code: null, eligibility_note: false, excluded: ["english", "korean_history", "bonus"], ...over });

test("value shows two decimals, half-up, and only within 0..100", () => {
  assert.equal(reflectedPercentText(81.25), "81.25");
  assert.equal(reflectedPercentText(81.125), "81.13");
  assert.equal(reflectedPercentText(0), "0.00");
  assert.equal(reflectedPercentText(100), "100.00");
  assert.equal(reflectedPercentText(100.01), null);
  assert.equal(reflectedPercentText("81"), null);
  assert.equal(reflectedPercentText(NaN), null);
});

test("reference value carries the eligibility note", () => {
  assert.deepEqual(schoolReflectedView(dto()), { kind: "value", text: "81.25", eligibility: false });
  assert.deepEqual(schoolReflectedView(dto({ eligibility_note: true })), { kind: "value", text: "81.25", eligibility: true });
});

test("pending shows a known reason and hides unknown ones", () => {
  assert.equal(schoolReflectedView(dto({ status: "pending", value: null, reason_code: "korean_missing" })).kind, "pending");
  assert.equal(schoolReflectedView(dto({ status: "pending", value: null, reason_code: "rule_invalid" })), null);
});

test("missing field shows nothing", () => {
  assert.equal(schoolReflectedView(null), null);
  assert.equal(schoolReflectedOf({ offering_id: "2027:1" }), null);
  assert.equal(schoolReflectedOf(undefined), null);
});
