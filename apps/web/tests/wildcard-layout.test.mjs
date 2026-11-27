import test from "node:test";
import assert from "node:assert/strict";

const { wildcardLayout, wildcardReasonText, FEATURED, MAX_SELECTED } = await import("../src/lib/wildcard-layout.ts");

const item = (id, delta, group = "nursing") => ({
  offering: { offering_id: id, wildcard_group: group },
  assessment: { advantage: delta === null ? null : { delta_pp: String(delta), status: "favorable", baseline_version: "b" } },
});
const ids = (xs) => xs.map((x) => x.offering.offering_id);
const stab = (list, pending = []) => list.map((x) => ({ offering_id: x.offering.offering_id, status: pending.includes(x.offering.offering_id) ? "pending" : "verified" }));

test("without wildcard_selection the legacy order is kept: biggest advantage first, 3 featured, the rest folded", () => {
  const picks = [item("a", 1), item("b", 5), item("c", null), item("d", 3), item("e", 2)];
  for (const sel of [undefined, null]) {
    const l = wildcardLayout(picks, sel);
    assert.equal(l.mode, "legacy");
    assert.deepEqual(ids(l.featured), ["b", "d", "e"]);
    assert.deepEqual(ids(l.rest), ["a", "c"]);
    assert.equal(l.status, null);
    assert.deepEqual(l.groupLabels, ["간호", "보건", "교육"]);
  }
});

test("with wildcard_selection the server order is used as is: 3 featured + the 4th behind 더보기", () => {
  const picks = [item("x", -2, "maritime"), item("y", 9, "nursing"), item("z", 0, "railway"), item("w", 4, "contract")];
  const l = wildcardLayout(picks, { status: "ready", reason_code: null, card_stability: stab(picks) });
  assert.equal(l.mode, "selected");
  assert.deepEqual(ids(l.featured), ["x", "y", "z"]);
  assert.deepEqual(ids(l.rest), ["w"]);
  assert.equal(l.reasonCode, null);
  assert.equal(l.pendingIds.size, 0);
  assert.deepEqual(l.groupLabels, ["간호", "보건", "교육", "계약학과", "해양", "철도"]);
});

test("the screen never shows more than 4 selected cards, even if more arrive", () => {
  const picks = ["a", "b", "c", "d", "e", "f"].map((id) => item(id, 1));
  const l = wildcardLayout(picks, { status: "ready", reason_code: null, card_stability: stab(picks) });
  assert.equal(l.featured.length + l.rest.length, MAX_SELECTED);
  assert.equal(l.featured.length, FEATURED);
});

test("partial marks the unverified cards and keeps the reason; pending has no cards and a reason", () => {
  const picks = [item("a", 1), item("b", 2)];
  const p = wildcardLayout(picks, { status: "partial", reason_code: "wildcard_comparison_unverified", card_stability: stab(picks, ["b"]) });
  assert.equal(p.status, "partial");
  assert.equal(p.reasonCode, "wildcard_comparison_unverified");
  assert.deepEqual([...p.pendingIds], ["b"]);
  assert.deepEqual(ids(p.featured), ["a", "b"]);

  const q = wildcardLayout([], { status: "pending", reason_code: "wildcard_assessment_pending", card_stability: [] });
  assert.equal(q.featured.length + q.rest.length, 0);
  assert.match(wildcardReasonText(q.reasonCode), /판단 자료를 확인/);
  assert.equal(wildcardReasonText(null), "");
  assert.match(wildcardReasonText("unknown_code"), /확인하고 있습니다/);
});

test("non-CSAT condition notes: known codes only, once each, hidden when absent", async () => {
  const { nonCsatConditionTexts } = await import("../src/lib/wildcard-layout.ts");
  assert.deepEqual(nonCsatConditionTexts(undefined), []);
  assert.deepEqual(nonCsatConditionTexts(null), []);
  assert.deepEqual(nonCsatConditionTexts([]), []);
  assert.deepEqual(nonCsatConditionTexts(["seafarer_health_exam", "unknown", "csat_minimum", "seafarer_health_exam"]), ["선원건강진단 기준이 있습니다", "수능 최저기준이 있습니다"]);
  assert.deepEqual(nonCsatConditionTexts(["railway_driver_aptitude"]), ["철도운전 신체·적성검사가 있습니다"]);
});
