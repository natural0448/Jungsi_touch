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
  assert.deepEqual(cutoffLine(c(2026, "8.25"), "5.70"), { metric: "최종등록자 70%컷", cutoff: "8.3", gap: "내가 2.6%p 위", side: "above" });
  assert.deepEqual(cutoffLine(c(2026, "3.1"), "5.7"), { metric: "최종등록자 70%컷", cutoff: "3.1", gap: "내가 2.6%p 아래", side: "below" });
  assert.equal(cutoffLine(c(2026, "5.72"), "5.7").side, "same");
  assert.equal(cutoffLine(c(2026, "0.1"), "0.3").gap, "내가 0.2%p 아래");
});

test("missing or malformed values", () => {
  assert.deepEqual(cutoffLine(c(2026, "8.25"), null), { metric: "최종등록자 70%컷", cutoff: "8.3", gap: null, side: null });
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
