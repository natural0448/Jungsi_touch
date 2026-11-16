import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// TypeScript sources import siblings without an extension (same as live-retry.test.mjs)
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { cutoffLine, yearCutoffLines } = await import("../src/lib/year-cutoffs.ts");

const O = "observation:" + "a".repeat(64);
const c = (year, v, metric = "최종등록자 70%컷") => ({ academic_year: year, published_metric: metric, cutoff_top_percent: v, observation_id: O });

test("gap uses exact decimals: smaller top percent means above the cutoff", () => {
  assert.deepEqual(cutoffLine(c(2026, "8.25"), "5.70"), { metric: "최종등록자 70%컷", scope: null, cutoff: "8.3", gap: "내가 2.6%p 위", side: "above" });
  assert.deepEqual(cutoffLine(c(2026, "3.1"), "5.7"), { metric: "최종등록자 70%컷", scope: null, cutoff: "3.1", gap: "내가 2.6%p 아래", side: "below" });
  assert.equal(cutoffLine(c(2026, "5.72"), "5.7").side, "same");
  assert.equal(cutoffLine(c(2026, "0.1"), "0.3").gap, "내가 0.2%p 아래");
});

test("missing or malformed values", () => {
  assert.deepEqual(cutoffLine(c(2026, "8.25"), null), { metric: "최종등록자 70%컷", scope: null, cutoff: "8.3", gap: null, side: null });
  assert.equal(cutoffLine(c(2026, "x"), "5"), null);
  assert.equal(cutoffLine(c(2026, "101"), "5"), null);
});

test("lines group by year, newest first, and use the unrounded reference value", () => {
  const a = {
    reference_percentile: { status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: "5.749" },
    year_cutoffs: [c(2025, "6.0", "최종컷"), c(2026, "5.75"), c(2026, "7", "최종컷")],
  };
  const got = yearCutoffLines(a);
  assert.deepEqual(got.map((g) => [g.year, g.lines.length]), [[2026, 2], [2025, 1]]);
  assert.equal(got[0].lines[0].side, "same");
  assert.equal(got[1].lines[0].gap, "내가 0.3%p 위");
  assert.deepEqual(yearCutoffLines({}), []);
  assert.equal(yearCutoffLines({ year_cutoffs: [c(2026, "5")] })[0].lines[0].gap, null);
});

test("my exact reference percentile with more than six decimals is still compared (11-16 production)", () => {
  assert.equal(cutoffLine(c(2026, "21.881343"), "5.712345678901234").gap, "내가 16.2%p 위");
  assert.equal(cutoffLine(c(2026, "5.7123465"), "5.71234549").side, "same");
});

test("my reference percentile as a range gives a range gap, or 'similar' when it straddles the cutoff (2026-11-16)", () => {
  assert.equal(cutoffLine(c(2026, "20"), "12.3", "14.8").gap, "내가 5.2~7.7%p 위");
  assert.equal(cutoffLine(c(2026, "10"), "12.3", "14.8").gap, "내가 2.3~4.8%p 아래");
  const s = cutoffLine(c(2026, "13"), "12.3", "14.8");
  assert.equal(s.side, "same");
  assert.equal(s.gap, "합격선과 비슷한 위치(내 범위가 걸침)");
  assert.equal(cutoffLine(c(2026, "20"), "12.3", "12.3").gap, "내가 7.7%p 위"); // 상한이 하한과 같으면 한 값
  assert.equal(cutoffLine(c(2026, "20"), "12.3", null).gap, "내가 7.7%p 위");
  const a = { reference_percentile: { status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: "12.3", estimated_upper_cumulative_percent_upper_bound: "14.8" }, year_cutoffs: [c(2026, "20")] };
  assert.equal(yearCutoffLines(a)[0].lines[0].gap, "내가 5.2~7.7%p 위");
});

test("a combined-track release is tagged and mean score components get their own names (2026-11-16)", () => {
  const combined = { ...c(2025, "8.25", "70%컷"), published_scope: "combined_tracks" };
  assert.equal(cutoffLine(combined, "5.7").scope, "전형 통합 발표");
  assert.equal(cutoffLine(combined, "5.7").metric, "70%컷");
  assert.equal(cutoffLine({ ...c(2024, "9", "평균"), score_component: "csat_converted" }, null).metric, "수능 환산점수 평균");
  assert.equal(cutoffLine({ ...c(2024, "9", "평균"), score_component: "selection_total" }, null).metric, "전형 총점 평균");
  assert.equal(cutoffLine(c(2024, "9", "평균"), null).scope, null);
});

test("the same release recorded as two observations shows once (2026-11-16)", () => {
  const O2 = "observation:" + "b".repeat(64);
  const a = { reference_percentile: null, year_cutoffs: [c(2024, "8.93349", "70%컷"), { ...c(2024, "8.93349", "70%컷"), observation_id: O2 }, c(2024, "9.1", "70%컷")] };
  const lines = yearCutoffLines(a);
  assert.equal(lines[0].lines.length, 2);
});
