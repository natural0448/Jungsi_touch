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
const { referenceUniversities, referenceWildcards, referenceWildcardGroup } = await import("../src/lib/reference-view.ts");

const overall = { status: "estimated", top_percent: "10", exclusive_top_percent: "10", inclusive_top_percent: "10" };
const ref = (p) => ({ status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: p, estimated_upper_cumulative_percent_upper_bound: p });
const off = (id, uni, dept, wg = null) => ({ offering: { offering_id: `2027:${id}`, university_id: uni, university_name: uni, department: dept, track: null, group: "가", region: "서울", wildcard_group: wg }, reference_percentile: ref(id === 3 ? "x" : String(id)) });
const groups = [
  { university_id: "A", university_name: "A", offerings: [off(12, "A", "a1"), off(9, "A", "a2", "nursing")] },
  { university_id: "B", university_name: "B", offerings: [off(5, "B", "b1", "education"), off(3, "B", "b2", "health")] },
];

test("universities are ordered by their best reference advantage, departments inside too (2026-11-19)", () => {
  const u = referenceUniversities(groups, overall);
  assert.deepEqual(u.map((x) => x.university_id), ["B", "A"]);
  assert.equal(u[0].best.text, "+5.0");
  assert.equal(u[1].best.text, "+1.0");
  const flatA = u[1].fields.flatMap((f) => f.items.map((i) => i.offering.department));
  assert.deepEqual(flatA, ["a2", "a1"]);
  assert.equal(u[1].count, 2);
});

test("reference wildcards take nursing/health/education only, best advantage first, unknown advantage last", () => {
  const w = referenceWildcards(groups, overall);
  assert.deepEqual([...w.featured, ...w.rest].map((i) => i.offering.department), ["b1", "a2", "b2"]);
  assert.equal(w.featured.length, 3);
  assert.equal(w.featured[2].advantage, null);
});

test("without an overall position nothing is ranked but the list still shows", () => {
  const u = referenceUniversities(groups, null);
  assert.deepEqual(u.map((x) => x.university_id), ["A", "B"]);
  assert.equal(u[0].best, null);
});

test("when the server leaves wildcard_group empty, the group comes from the department name (2026-11-19)", () => {
  const o = (department) => ({ offering_id: "2027:1", department, wildcard_group: null });
  assert.equal(referenceWildcardGroup(o("간호학과")), "nursing");
  assert.equal(referenceWildcardGroup(o("초등교육과")), "education");
  assert.equal(referenceWildcardGroup(o("경영학과")), null);
  assert.equal(referenceWildcardGroup({ ...o("경영학과"), wildcard_group: "health" }), "health");
  assert.equal(referenceWildcardGroup({ ...o("경영학과"), wildcard_group: "contract" }), null);
});
