import test from "node:test";
import assert from "node:assert/strict";

// 1페이지 '대학 발표 성적 ①·②' 고르기 규칙(2026-10-28 사용자 결정). 실제 TypeScript 모듈을 그대로 실행한다.
const { publishedStats, statName, cohortTier } = await import("../src/lib/p1-published-stats.ts");

const none = { v: null, s: "unpublished", r: null, u: null, l: null };
const cell = (l, v, b = "대학 환산점수", co = "최종등록자", p = null) => ({ v, s: "pending_metadata", r: null, u: null, l, b, co, p });
const row = (c50, c70, e) => ({ c50: c50 ?? none, c70: c70 ?? none, alt: { s: "", r: null, om: 0, e } });
const pick = (r) => publishedStats(r).map((x) => (x ? `${x.label} ${x.cell.v}` : "─"));

test("school spellings collapse to one name; unknown or English names stay hidden", () => {
  for (const l of ["85%컷", "85% 컷", "85%cut", "85_percent_cut", "85% cut", "85%"]) assert.equal(statName(l), "85%컷");
  assert.equal(statName("최상위"), "최고"); assert.equal(statName("최대"), "최고"); assert.equal(statName("최하위"), "최저");
  for (const l of ["mean", "best", "worst", "상위80% 집단 평균", "평균총점", "0%컷", "101%컷", null]) assert.equal(statName(l), null);
});

test("fixed columns: ① is the 50%컷 place (평균 next), ② is the 70%컷 place (75·80%컷 next)", () => {
  assert.deepEqual(pick(row(cell("50%컷", "812.3"), cell("70%컷", "798.0"), [cell("평균", "805.1")])), ["50%컷 812.3", "70%컷 798.0"]);
  assert.deepEqual(pick(row(null, cell("70%컷", "389.5"), [cell("최저", "387.6"), cell("평균", "393.25"), cell("75%컷", "389.45")])), ["평균 393.25", "70%컷 389.5"]);
  // 70%컷만 있으면 ① 은 비고 ② 에 선다
  assert.deepEqual(pick(row(null, cell("70%컷", "403.00"), [])), ["─", "70%컷 403.00"]);
  assert.deepEqual(pick(row(null, null, [cell("80%컷", "4")])), ["─", "80%컷 4"]);
  // ② 칸: 다른 %컷이 최저·최고보다 먼저. 최저는 최고보다 먼저. 평균은 ① 이 50%컷일 때만 ② 로 간다
  assert.deepEqual(pick(row(null, null, [cell("최고", "9"), cell("85% 컷", "3"), cell("75%컷", "4"), cell("최저", "1")])), ["─", "75%컷 4"]);
  assert.deepEqual(pick(row(null, null, [cell("최고", "9"), cell("최저", "1")])), ["─", "최저 1"]);
  assert.deepEqual(pick(row(null, null, [cell("최고", "9")])), ["─", "최고 9"]);
  assert.deepEqual(pick(row(null, null, [cell("평균", "5"), cell("최저", "1"), cell("최고", "9")])), ["평균 5", "최저 1"]);
  assert.deepEqual(pick(row(cell("50%컷", "5"), null, [cell("최저", "1")])), ["50%컷 5", "최저 1"]);
  assert.deepEqual(pick(row(cell("50%컷", "5"), null, [cell("최저", "1"), cell("평균", "4")])), ["50%컷 5", "평균 4"]);
  assert.deepEqual(pick(row(null, null, [cell("mean", "5"), cell("평균", "6")])), ["평균 6", "─"]);
  // 50%컷과 평균만 있으면 평균이 ② 칸으로 간다. ② 자리 통계가 있으면 그대로
  assert.deepEqual(pick(row(cell("50%컷", "390"), null, [cell("평균", "385")])), ["50%컷 390", "평균 385"]);
  assert.deepEqual(pick(row(cell("50%컷", "390"), null, [cell("평균", "385"), cell("75%컷", "380")])), ["50%컷 390", "75%컷 380"]);
});

test("final registrants beat first-round admits; one cohort and one basis per row", () => {
  const r = row(null, null, [cell("평균", "397.3", "대학 환산점수", "최초합격자"), cell("최저", "391.5", "대학 환산점수", "최초합격자"), cell("평균", "393.2", "대학 환산점수", "최종등록자 기준")]);
  assert.deepEqual(pick(r), ["평균 393.2", "─"]);
  assert.equal(cohortTier(cell("평균", "1", "x", null)), 3);
  assert.equal(cohortTier({ ...none, cc: "final_registrants" }), 1);
  // 같은 집단 안에서는 환산점수를 먼저 쓰고 등급과 섞지 않는다
  const mixed = row(null, null, [cell("평균", "3.7", "학생부 등급"), cell("평균", "295.1"), cell("최저", "4.1", "학생부 등급")]);
  assert.deepEqual(pick(mixed), ["평균 295.1", "─"]);
  // 같은 이름·기준·대상에 값이 둘이면 그 통계는 숨긴다. 값이 같으면 하나로 본다
  assert.deepEqual(pick(row(cell("50%컷", "630.44"), null, [cell("평균", "553"), cell("평균", "631.3")])), ["50%컷 630.44", "─"]);
  assert.deepEqual(pick(row(cell("50%컷", "630.44"), null, [cell("평균", "631.3"), cell("평균", "631.3")])), ["50%컷 630.44", "평균 631.3"]);
  // 기준이 확인 중인 값은 보이지 않는다
  assert.deepEqual(pick(row(null, null, [cell("평균", "412.5", "대학 발표 성적 · 기준 확인 중")])), ["─", "─"]);
});

test("학생부 등급 values are marked, and nothing is invented for an empty row", () => {
  const r = publishedStats(row(cell("50%컷", "4.92", "학생부 등급"), cell("70%컷", "5.23", "학생부 등급"), []));
  assert.deepEqual(r.map((x) => [x.label, x.cell.v, x.schoolRecord]), [["50%컷", "4.92", true], ["70%컷", "5.23", true]]);
  assert.deepEqual(publishedStats(row(null, null, [])), [undefined, undefined]);
});

test("only actual results fill the columns once a publication role is given (한국항공대 2025: 631.3 actual, 553.0 reference)", () => {
  const actual = { ...cell("평균", "631.3"), pr: "actual_result" };
  const reference = { ...cell("평균", "553.0"), pr: "simulation_reference" };
  assert.deepEqual(pick(row(cell("50%컷", "630.44"), null, [actual, reference])), ["50%컷 630.44", "평균 631.3"]);
  // 미확인 용도도 쓰지 않는다. 용도 표시가 없는 기존 자료는 그대로
  assert.deepEqual(pick(row(null, null, [{ ...cell("평균", "5"), pr: "unresolved" }])), ["─", "─"]);
  assert.deepEqual(pick(row(null, null, [cell("평균", "5")])), ["평균 5", "─"]);
});

test("published-score null uses the exact label without changing source reasons or native values", async () => {
  const { publishedScoreNullLabel } = await import("../src/lib/p1-published-stats.ts");
  for (const r of [null, "SOURCE_NONDISCLOSED_LE_3", "SOURCE_NONDISCLOSED_LE_5", "NO_FINAL_REGISTRANT_SAME_BASIS_CUT50"]) {
    const c = { ...none, r };
    const before = structuredClone(c);
    assert.equal(publishedScoreNullLabel(c), "3인이하미발표");
    assert.deepEqual(c, before);
  }
  for (const v of ["0", "0.000", "631.300", 0, undefined])
    assert.equal(publishedScoreNullLabel({ ...none, v }), null);
});

test("hidden reference roles and unknown score bases keep the existing display", async () => {
  const { publishedScoreNullLabel } = await import("../src/lib/p1-published-stats.ts");
  for (const pr of ["simulation_reference", "unresolved"])
    assert.equal(publishedScoreNullLabel({ ...none, pr }), null);
  assert.equal(publishedScoreNullLabel({ ...none, b: "대학 발표 성적 · 기준 확인 중" }), null);
  assert.equal(publishedScoreNullLabel({ ...none, pr: "actual_result" }), "3인이하미발표");
  assert.deepEqual(publishedStats(row(null, null, [])), [undefined, undefined]);
});
