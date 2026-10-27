import test from "node:test";
import assert from "node:assert/strict";

// 1페이지 '대학 발표 성적 ①·②' 고르기 규칙(2026-10-28 사용자 결정). 실제 TypeScript 모듈을 그대로 실행한다.
const { publishedStats, statName, cohortTier } = await import("../src/lib/p1-published-stats.ts");

const none = { v: null, s: "unpublished", r: null, u: null, l: null };
const cell = (l, v, b = "대학 환산점수", co = "최종등록자", p = null) => ({ v, s: "pending_metadata", r: null, u: null, l, b, co, p });
const row = (c50, c70, e) => ({ c50: c50 ?? none, c70: c70 ?? none, alt: { s: "", r: null, om: 0, e } });
const pick = (r) => publishedStats(r).map((x) => `${x.label} ${x.cell.v}`);

test("school spellings collapse to one name; unknown or English names stay hidden", () => {
  for (const l of ["85%컷", "85% 컷", "85%cut", "85_percent_cut", "85% cut", "85%"]) assert.equal(statName(l), "85%컷");
  assert.equal(statName("최상위"), "최고"); assert.equal(statName("최대"), "최고"); assert.equal(statName("최하위"), "최저");
  for (const l of ["mean", "best", "worst", "상위80% 집단 평균", "평균총점", "0%컷", "101%컷", null]) assert.equal(statName(l), null);
});

test("50·70%컷 come first; otherwise 평균, then other cuts by ratio, then 최저·최고", () => {
  assert.deepEqual(pick(row(cell("50%컷", "812.3"), cell("70%컷", "798.0"), [cell("평균", "805.1")])), ["50%컷 812.3", "70%컷 798.0"]);
  assert.deepEqual(pick(row(null, cell("70%컷", "389.5"), [cell("최저", "387.6"), cell("평균", "393.25"), cell("75%컷", "389.45")])), ["70%컷 389.5", "평균 393.25"]);
  assert.deepEqual(pick(row(null, null, [cell("최고", "9"), cell("85% 컷", "3"), cell("75%컷", "4"), cell("최저", "1")])), ["75%컷 4", "85%컷 3"]);
  assert.deepEqual(pick(row(null, null, [cell("최고", "9"), cell("최저", "1")])), ["최저 1", "최고 9"]);
  assert.deepEqual(pick(row(null, null, [cell("mean", "5"), cell("평균", "6")])), ["평균 6"]);
});

test("final registrants beat first-round admits; one cohort and one basis per row", () => {
  const r = row(null, null, [cell("평균", "397.3", "대학 환산점수", "최초합격자"), cell("최저", "391.5", "대학 환산점수", "최초합격자"), cell("평균", "393.2", "대학 환산점수", "최종등록자 기준")]);
  assert.deepEqual(pick(r), ["평균 393.2"]);
  assert.equal(cohortTier(cell("평균", "1", "x", null)), 3);
  assert.equal(cohortTier({ ...none, cc: "final_registrants" }), 1);
  // 같은 집단 안에서는 환산점수를 먼저 쓰고 등급과 섞지 않는다
  const mixed = row(null, null, [cell("평균", "3.7", "학생부 등급"), cell("평균", "295.1"), cell("최저", "4.1", "학생부 등급")]);
  assert.deepEqual(pick(mixed), ["평균 295.1"]);
  // 기준이 확인 중인 값은 보이지 않는다
  assert.deepEqual(pick(row(null, null, [cell("평균", "412.5", "대학 발표 성적 · 기준 확인 중")])), []);
});

test("학생부 등급 values are marked, and nothing is invented for an empty row", () => {
  const r = publishedStats(row(cell("50%컷", "4.92", "학생부 등급"), cell("70%컷", "5.23", "학생부 등급"), []));
  assert.deepEqual(r.map((x) => [x.label, x.cell.v, x.schoolRecord]), [["50%컷", "4.92", true], ["70%컷", "5.23", true]]);
  assert.deepEqual(publishedStats(row(null, null, [])), []);
});
