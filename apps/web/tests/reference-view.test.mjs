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

test("7-stage reference band comes first: up to 상향 listed by the estimate stage (code, favourable end — 2026-11-22), 도전·불가 counted, no band falls back to cutoffs", () => {
  const band = (code, upper) => ({ basis: "reference_percentile", code, label: code, policy_version: "20261120.september-national-modeled.p3.v1", approval_version: "v", ...(upper ? { upper_code: upper, upper_label: upper } : {}) });
  const withBands = {
    ...analyses,
    "2027:2": { ...analyses["2027:2"], reference_band: band("target") },            // 합격선 아래여도 7단계가 적정이면 넣는다
    "2027:3": { reference_band: band("aspirational", "challenge") },                 // 범위 소신~도전 → 추정값 단계(소신)로 넣는다(2026-11-22)
    "2027:4": { ...analyses["2027:4"], reference_band: band("outside") },            // 합격선 위여도 불가 → 뺀다
    "2027:6": { ...analyses["2027:6"], reference_band: band("stable") },
  };
  const pool = referencePool(groups, overall, withBands);
  assert.deepEqual(pool.items.map((i) => i.offering.department), ["경영학과", "사학과", "유아교육과", "간호학과", "물리치료학과", "응급구조학과"]);
  assert.equal(pool.outsideBand, 1);
  assert.equal(pool.below, 0);
  assert.equal(pool.noCutoff, 0);
  const u = referenceUniversities(pool);
  assert.deepEqual(u.map((x) => x.university_id), ["A", "B"]);
  assert.equal(u[0].bestBand.code, "target");
});

test("dep_r15 threshold rows: no percentile, band on the row; analyses band wins; listed by code up to 상향; marked pending until analysed", async () => {
  const { referenceGroups } = await import("../src/lib/reference-percentile.ts");
  const off = (id, dept) => ({ offering_id: id, academic_year: 2027, university_id: "T", university_name: "문턱대", campus: null, department: dept, track: null, group: "가", region: "서울", wildcard_group: null });
  const tb = (code) => ({ basis: "reference_threshold", code, label: code, source: "a" });
  const c = { reference_university_groups: [{ university_id: "T", university_name: "문턱대", offerings: [
    { offering: off("2027:91", "경영학과"), reference_band: tb("target") },
    { offering: off("2027:92", "법학과"), reference_band: tb("challenge") },
    { offering: off("2027:93", "사학과"), reference_band: { code: "target" } }, // basis 가 없으면 받지 않는다
    { offering: off("2027:94", "철학과"), reference_band: tb("outside") },
  ] }] };
  const groups = referenceGroups(c);
  assert.deepEqual(groups[0].offerings.map((it) => it.offering.offering_id), ["2027:91", "2027:92", "2027:94"]);
  const analyses = { "2027:94": { reference_band: { basis: "reference_percentile", code: "upward", label: "상향" }, reference_percentile: ref("5"), year_cutoffs: [cut(2025, "최종등록자 70%컷", "8")] } };
  const pool = referencePool(groups, overall, analyses);
  assert.deepEqual(pool.items.map((i) => [i.offering.offering_id, i.band.code, i.pending]), [["2027:91", "target", true], ["2027:94", "upward", false]]);
  assert.equal(pool.outsideBand, 1);
  assert.equal(pool.items[0].margin, null);
  assert.ok(pool.items[1].margin);
});

test("malformed rows never break page 3: bad offering/band/percentile/cutoffs are dropped row by row (2026-11-22 incident)", async () => {
  const { referenceGroups } = await import("../src/lib/reference-percentile.ts");
  const off = (id, dept) => ({ offering_id: id, academic_year: 2027, university_id: "M", university_name: "모양대", campus: null, department: dept, track: null, group: "가", region: null, wildcard_group: null });
  const tb = (code) => ({ basis: "reference_threshold", code, label: code, source: "a" });
  const c = { reference_university_groups: [
    null,
    { university_id: "M", university_name: "모양대", offerings: [
      null,
      { offering: null, reference_band: tb("target") },
      { offering: { offering_id: "2027:80" }, reference_band: tb("target") },                  // 이름 없음
      { offering: off("2027:81", "가학과"), reference_band: tb("bogus") },                     // 모르는 단계
      { offering: off("2027:82", "나학과"), reference_percentile: { status: "reference_estimated" } }, // 값 없는 누백
      { offering: off("2027:83", "다학과"), reference_band: tb("target") },
      { offering: off("2027:84", "라학과"), reference_band: tb("upward") },
    ] },
    { university_id: "E", university_name: "빈대", offerings: "not-a-list" },
  ] };
  const groups = referenceGroups(c);
  assert.deepEqual(groups.flatMap((g) => g.offerings.map((it) => it.offering.offering_id)), ["2027:83", "2027:84"]);
  const analyses = {
    "2027:83": { reference_band: { code: "nonsense" }, year_cutoffs: [null, { academic_year: 2025 }, { academic_year: 2025, published_metric: "최종등록자 70%컷", cutoff_top_percent: "9" }], reference_percentile: ref("5") },
    "2027:84": "garbage",
  };
  const pool = referencePool(groups, overall, analyses);
  assert.deepEqual(pool.items.map((i) => [i.offering.offering_id, i.band.code]), [["2027:83", "target"], ["2027:84", "upward"]]);
  assert.equal(pool.items[0].margin.side, "above");
  assert.doesNotThrow(() => referenceUniversities(pool));
  assert.doesNotThrow(() => referenceWildcards(pool));
});
