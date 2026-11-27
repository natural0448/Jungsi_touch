import test from "node:test";
import assert from "node:assert/strict";
// 2026-11-24 담당자 대표 판정(P34): 가운데 성적으로 확정된 가채점 판정만 7단계로 보이고 고른다
const { personalCsatPoint } = await import("../src/lib/personal-csat-point.ts");

const base = { basis: "reference_threshold", code: "target", label: "적정", source: "g" };

test("가운데로 확정된 행(서버가 judgment_basis 를 싣지 않음)은 그 단계 그대로, 가운데 값만 남긴다", () => {
  const b = personalCsatPoint({ ...base, school_score: { central: "703.38", low: "684.58", high: "719.39" }, school_rank: { central: "4.34", best: "1.65", worst: "9.90" }, school_gain: { central: "1.01", low: "0.43", high: "1.90" } });
  assert.equal(b.held, false);
  assert.equal(b.code, "target");
  assert.deepEqual(b.school_score, { central: "703.38", low: "703.38", high: "703.38" });
  assert.deepEqual(b.school_rank, { central: "4.34", best: "4.34", worst: "4.34" });
  assert.equal(b.school_gain.low, "1.01");
});

test("범위로만 정해진 행(interval 또는 upper_code)은 고르지 않는다", () => {
  assert.equal(personalCsatPoint({ ...base, judgment_basis: "interval" }).held, true);
  assert.equal(personalCsatPoint({ ...base, upper_code: "upward" }).held, true);
  assert.equal(personalCsatPoint({ ...base, source: "a" }).held, true);
  assert.equal(personalCsatPoint(null), null);
});
