import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { positionNoteOf, positionNoteShort } = await import("../src/lib/position-note.ts");

// 합성 값(지어낸 숫자)
const ref = (lo, hi = lo) => ({ status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: lo, estimated_upper_cumulative_percent_upper_bound: hi });
const cut = (y, metric, v) => ({ academic_year: y, published_metric: metric, cutoff_top_percent: v, observation_id: `${y}${metric}` });
const base = { offering_id: "2027:9000000001", status: "pending", category: "pending", reason_code: "analysis_release_missing", eligibility_status: "eligible", years: [] };
const overall = { status: "estimated", top_percent: "4", exclusive_top_percent: "4", inclusive_top_percent: "4" };

test("70% line only: position against last year's cutoff, no 7-band (2026-11-20)", () => {
  const n = positionNoteOf({ ...base, year_cutoffs: [cut(2025, "70%컷", "10")], reference_percentile: ref("5") }, overall);
  assert.equal(n.kind, "line");
  assert.equal(n.basis, "school");
  assert.equal(n.margin.text, "2025 70%컷보다 5.0%p 위");
  assert.equal(positionNoteShort(n), "70%컷 대비 위");
});

test("no school position: falls back to the overall position, labelled overall", () => {
  const n = positionNoteOf({ ...base, year_cutoffs: [cut(2025, "70%컷", "3")], reference_percentile: null }, overall);
  assert.equal(n.kind, "line");
  assert.equal(n.basis, "overall");
  assert.equal(n.margin.side, "below");
});

test("no cutoff: 판정 근거 부족, never 판단 보류", () => {
  const n = positionNoteOf({ ...base, year_cutoffs: [], reference_percentile: ref("5") }, overall);
  assert.equal(n.kind, "none");
  assert.equal(positionNoteShort(n), "판정 근거 부족");
});

test("not used for ready, reference band, ineligible, or my-input reasons", () => {
  const cs = [cut(2025, "70%컷", "10")];
  assert.equal(positionNoteOf({ ...base, status: "ready", year_cutoffs: cs }, overall), null);
  assert.equal(positionNoteOf({ ...base, reference_band: { code: "stable" }, year_cutoffs: cs }, overall), null);
  assert.equal(positionNoteOf({ ...base, status: "ineligible", year_cutoffs: cs }, overall), null);
  assert.equal(positionNoteOf({ ...base, reason_code: "reference_inquiry_category_unsupported", year_cutoffs: cs }, overall), null);
});
