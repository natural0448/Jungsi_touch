import test from "node:test";
import assert from "node:assert/strict";
// 2026-11-24 담당자 개인용 2페이지 가채점 단일 대표값 (expected/admin_example.json 의 가상 입력)
const { projectP2ProvisionalSummary, projectP2ProvisionalSubject, projectP2ProvisionalCombination } = await import("../src/lib/p2-representative-view.ts");

test("가상 입력: 382점 · 상위 3.97% 를 한 쌍으로", () => {
  const v = projectP2ProvisionalSummary({ estimated_standard_score_sum: 382, estimated_top_percent: "3.97", unavailable_reason: null });
  assert.equal(v.scoreText, "382점");
  assert.equal(v.rankText, "상위 3.97%");
  assert.equal(v.rankPoint, 3.97);
  assert.match(v.rankDetail, /같은 점수도 포함해/);
});

test("0.01 미만은 0 으로 찍지 않고 문구만, 사유가 있으면 — 와 사유", () => {
  const tiny = projectP2ProvisionalSummary({ estimated_standard_score_sum: 417, estimated_top_percent: "<0.01", unavailable_reason: null });
  assert.equal(tiny.rankText, "상위 0.01% 미만");
  assert.equal(tiny.rankPoint, null);
  const out = projectP2ProvisionalSummary({ estimated_standard_score_sum: 418, estimated_top_percent: null, unavailable_reason: "outside_central_support" });
  assert.equal(out.scoreText, "418점");
  assert.equal(out.rankText, "—");
  assert.match(out.rankDetail, /계산 범위를 벗어났습니다/);
  const old = projectP2ProvisionalSummary(null);
  assert.equal(old.scoreText, "—");
  assert.match(old.rankDetail, /가채점 모형을 확인하지 못했습니다/);
});

test("대표 등급은 양 끝이 같을 때만, 조합 합은 빈 과목이 있으면 —", () => {
  assert.equal(projectP2ProvisionalSubject({ grade_range: { low: 2, high: 3 } }).grade, "—");
  assert.equal(projectP2ProvisionalSubject({ grade_range: { low: 1, high: 1 } }).grade, 1);
  assert.equal(projectP2ProvisionalCombination([121, 132, 63, 66]), "382점");
  assert.equal(projectP2ProvisionalCombination([121, null]), "—");
});
