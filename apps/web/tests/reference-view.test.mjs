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
const { cutoffMargin, referencePool, referenceUniversities, referenceWildcards, referenceWildcardGroup } = await import("../src/lib/reference-view.ts");

const overall = { status: "estimated", top_percent: "4", exclusive_top_percent: "4", inclusive_top_percent: "4" };
const ref = (lo, hi = lo) => ({ status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: lo, estimated_upper_cumulative_percent_upper_bound: hi });
const cut = (y, metric, v) => ({ academic_year: y, published_metric: metric, cutoff_top_percent: v, observation_id: `${y}${metric}` });

test("margin uses the latest year's 70% cutoff, then 50%, and the unfavourable end of my range (2026-11-19)", () => {
  const cs = [cut(2024, "70%컷", "20"), cut(2025, "50%컷", "12.1"), cut(2025, "70%컷", "15.7")];
  const m = cutoffMargin(cs, ref("5.0", "8.5"));
  assert.equal(m.text, "2025 70%컷보다 7.2~10.7%p 위");
  assert.equal(m.side, "above");
  assert.ok(Math.abs(m.worst - 7.2) < 1e-9);
  assert.equal(cutoffMargin([cut(2025, "50%컷", "6")], ref("5", "8")).side, "near");
  assert.equal(cutoffMargin([cut(2025, "70%컷", "3")], ref("5", "8")).text, "2025 70%컷보다 2.0~5.0%p 아래");
  assert.equal(cutoffMargin([], ref("5")), null);
  assert.equal(cutoffMargin([cut(2025, "평균", "9")], ref("5")), null);
});

const off = (id, uni, dept, wg = null) => ({ offering: { offering_id: `2027:${id}`, university_id: uni, university_name: uni, department: dept, track: null, group: "가", region: "서울", wildcard_group: wg }, reference_percentile: ref("5") });
const groups = [
  { university_id: "A", university_name: "A", offerings: [off(1, "A", "간호학과"), off(2, "A", "경영학과"), off(3, "A", "사학과")] },
  { university_id: "B", university_name: "B", offerings: [off(4, "B", "초등교육과"), off(5, "B", "물리치료학과", "health"), off(6, "B", "유아교육과"), off(7, "B", "응급구조학과")] },
];
const analyses = {
  "2027:1": { year_cutoffs: [cut(2025, "70%컷", "9")] },   // +4 위
  "2027:2": { year_cutoffs: [cut(2025, "70%컷", "3")] },   // 아래 → 빠짐
  "2027:4": { year_cutoffs: [cut(2025, "70%컷", "12")] },  // +7 위
  "2027:5": { year_cutoffs: [cut(2025, "70%컷", "6")] },   // +1
  "2027:6": { year_cutoffs: [cut(2025, "70%컷", "8")] },   // +3
  "2027:7": { year_cutoffs: [cut(2025, "70%컷", "5")] },   // 같음 → 비슷
};

test("only departments that reach last year's cutoff are listed, ordered by margin; the rest are counted", () => {
  const pool = referencePool(groups, overall, analyses);
  assert.deepEqual(pool.items.map((i) => i.offering.department), ["초등교육과", "간호학과", "유아교육과", "물리치료학과", "응급구조학과"]);
  assert.equal(pool.below, 1);
  assert.equal(pool.noCutoff, 1);
  const u = referenceUniversities(pool);
  assert.deepEqual(u.map((x) => x.university_id), ["B", "A"]);
  assert.equal(u[0].count, 4);
});

test("wildcards: at most 4 cards (3 shown, 1 more), same pool and order (2026-11-19)", () => {
  const w = referenceWildcards(referencePool(groups, overall, analyses));
  assert.equal(w.featured.length, 3);
  assert.equal(w.rest.length, 1);
  assert.deepEqual(w.featured.map((i) => i.offering.department), ["초등교육과", "간호학과", "유아교육과"]);
});

test("when the server leaves wildcard_group empty, the group comes from the department name (2026-11-19)", () => {
  const o = (department) => ({ offering_id: "2027:1", department, wildcard_group: null });
  assert.equal(referenceWildcardGroup(o("간호학과")), "nursing");
  assert.equal(referenceWildcardGroup(o("초등교육과")), "education");
  assert.equal(referenceWildcardGroup(o("경영학과")), null);
  assert.equal(referenceWildcardGroup({ ...o("경영학과"), wildcard_group: "health" }), "health");
  assert.equal(referenceWildcardGroup({ ...o("간호학과"), wildcard_group: "일반" }), "nursing");
});

test("7-stage reference band comes first: up to 상향 listed (unfavourable end), 도전·불가 counted, no band falls back to cutoffs (2026-11-21 p3_empty)", () => {
  const band = (code, upper) => ({ basis: "reference_percentile", code, label: code, policy_version: "20261120.september-national-modeled.p3.v1", approval_version: "v", ...(upper ? { upper_code: upper, upper_label: upper } : {}) });
  const withBands = {
    ...analyses,
    "2027:2": { ...analyses["2027:2"], reference_band: band("target") },            // 합격선 아래여도 7단계가 적정이면 넣는다
    "2027:3": { reference_band: band("aspirational", "challenge") },                 // 불리한 끝 도전 → 뺀다
    "2027:4": { ...analyses["2027:4"], reference_band: band("outside") },            // 합격선 위여도 불가 → 뺀다
    "2027:6": { ...analyses["2027:6"], reference_band: band("stable") },
  };
  const pool = referencePool(groups, overall, withBands);
  assert.deepEqual(pool.items.map((i) => i.offering.department), ["경영학과", "유아교육과", "간호학과", "물리치료학과", "응급구조학과"]);
  assert.equal(pool.outsideBand, 2);
  assert.equal(pool.below, 0);
  assert.equal(pool.noCutoff, 0);
  const u = referenceUniversities(pool);
  assert.deepEqual(u.map((x) => x.university_id), ["A", "B"]);
  assert.equal(u[0].bestBand.code, "target");
});
