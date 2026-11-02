/** 합성 원문·식별자만 사용하며 DB, 외부망, 실제 근거와 연결하지 않는다. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { projectScoreNullReasons } from "../../supabase/functions/_shared/jungsi/application/score_null_reason_review.ts";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

const sha = (x) => x.repeat(64);
const observation = (x) => `observation:${sha(x)}`;
const snapshot = Object.freeze({ publication_sha256: sha("a"), source_head_sha256: sha("b"), scope_sha256: sha("c") });
const now = 1_800_000_000_000;
const clock = () => now;
const rejection = (e) => e?.code === "snapshot_invalid" && e?.http === 503;
function target(field = "final_50_percent_cut") {
  const cell = {
    value: null, status: "not_published", reason_code: "SYNTHETIC_GENERIC",
    statistic_percent: field === "final_50_percent_cut" ? 50 : 70,
    cohort_code: "SYNTHETIC_REGISTERED", basis_code: "SYNTHETIC_SCORE",
    source_context: { observation_id: observation("d"), identity_variant_index: 0, scope_status: "source_consistent" },
    publication_context: { publication_role: "actual_result", simulation_target_academic_year: null },
    score_calculation_context: { source_result_year: 2026, score_calculation_year: 2026, observation_role: "actual_result" },
  };
  return { field, row: {
    academic_year: 2026, university_id: "SYNTHETIC-U", original_pk: "SYNTHETIC-PK", offering_id: "2026:SYNTHETIC-PK", campus: null,
    university_name: "SYNTHETIC-UNIVERSITY", department: "SYNTHETIC-DEPARTMENT",
    admission_track: "SYNTHETIC-TRACK", group: "SYNTHETIC-GROUP", mapping_status: "mapped",
    identity_review: { status: "source_consistent", reason_code: null, variants: [{ university_name: "SYNTHETIC-UNIVERSITY", department: "SYNTHETIC-DEPARTMENT", admission_track: "SYNTHETIC-TRACK", group: "SYNTHETIC-GROUP" }] }, [field]: cell,
  } };
}
const other = (s) => ({ kind: "other_statistic_only", cohort_code: s.cohort_code, basis_code: s.basis_code,
  statistic_kind: "percent_cut", statistic_percent: 85, observation_id: observation("e"), publication_role: "actual_result" });
const few = (s) => ({ kind: "three_or_fewer", cohort_code: s.cohort_code, maximum_count: 3, count_scope: "same_cohort" });
async function proof(subject, t, reason) {
  return { ...snapshot, subject: structuredClone(subject), cell_sha256: await nativeJsonSha256(t.row[t.field]),
    identity_review_sha256: await nativeJsonSha256(t.row.identity_review), review_receipt_sha256: sha("f"),
    issued_at_ms: now - 1000, expires_at_ms: now + 1000, reason: reason(subject) };
}
function portFor(t, makeReasons = [other], mutate = () => {}) {
  let calls = 0, currentCalls = 0;
  return {
    get calls() { return calls; }, get currentCalls() { return currentCalls; },
    async verifyBatch(request) {
      calls++;
      assert.deepEqual(request.snapshot, snapshot);
      const rows = await Promise.all(makeReasons.map((reason) => proof(request.subjects[0].subject, t, reason)));
      mutate(rows, request);
      return rows;
    },
    async assertCurrent(received, receipts) { currentCalls++; assert.deepEqual(received, snapshot); assert.deepEqual(receipts, [sha("f")]); },
  };
}
const project = (targets, port = null, readClock = clock) => projectScoreNullReasons(snapshot, targets, port, readClock);

test("generic reason and missing provider remain unknown", async () => {
  const t = target(); const original = structuredClone(t);
  assert.deepEqual(await project([t]), [{ field: t.field, verified_score_null_reasons: [] }]);
  assert.deepEqual(t, original);
});
test("independently supplied different official statistic yields only enum DTO", async () => {
  const t = target(), port = portFor(t);
  const result = await project([t], port);
  assert.deepEqual(result, [{ field: t.field, verified_score_null_reasons: ["other_statistic_only"] }]);
  assert.equal(port.calls, 1); assert.equal(port.currentCalls, 1);
  assert.ok(!JSON.stringify(result).includes("SYNTHETIC-U"));
  assert.ok(!JSON.stringify(result).includes(observation("d")));
});
test("independently supplied same-cohort three-or-fewer yields correct enum", async () => {
  const t = target("final_70_percent_cut");
  assert.deepEqual((await project([t], portFor(t, [few])))[0].verified_score_null_reasons, ["three_or_fewer"]);
});
test("when both reasons are verified, three-or-fewer takes priority independent of input order", async () => {
  const t = target();
  assert.deepEqual((await project([t], portFor(t, [other, few])))[0].verified_score_null_reasons, ["three_or_fewer", "other_statistic_only"]);
});
test("a different identity, observation, cohort, score basis, statistic or field is rejected", async () => {
  const cases = [
    ["academic_year", 2025], ["university_id", "SYNTHETIC-OTHER"], ["original_pk", "SYNTHETIC-OTHER"],
    ["campus", "SYNTHETIC-OTHER"], ["admission_track", "SYNTHETIC-OTHER"], ["group", "SYNTHETIC-OTHER"],
    ["observation_id", observation("9")], ["identity_variant_index", 1], ["cohort_code", "SYNTHETIC-OTHER"],
    ["basis_code", "SYNTHETIC-OTHER"], ["statistic_percent", 70], ["field", "final_70_percent_cut"],
    ["confirmed_null_identity_fields", []],
  ];
  for (const [key, value] of cases) {
    const t = target();
    await assert.rejects(() => project([t], portFor(t, [other], (rows) => { rows[0].subject[key] = value; })), rejection, key);
  }
});
test("stale publication, source head, scope, cell and identity-review digests fail closed", async () => {
  for (const key of ["publication_sha256", "source_head_sha256", "scope_sha256", "cell_sha256", "identity_review_sha256"]) {
    const t = target();
    await assert.rejects(() => project([t], portFor(t, [other], (rows) => { rows[0][key] = sha("9"); })), rejection, key);
  }
});
test("recruitment headcount and five-person threshold do not prove three-or-fewer", async () => {
  for (const reason of [
    (s) => ({ ...few(s), count_scope: "recruitment_count" }),
    (s) => ({ ...few(s), maximum_count: 5 }),
  ]) { const t = target(); await assert.rejects(() => project([t], portFor(t, [reason])), rejection); }
});
test("other statistic must have same cohort and basis, different criterion and actual publication", async () => {
  for (const patch of [
    { cohort_code: "SYNTHETIC-OTHER" }, { basis_code: "SYNTHETIC-OTHER" }, { statistic_percent: 50 },
    { publication_role: "simulation_reference" }, { statistic_kind: "mean", statistic_percent: 85 },
  ]) { const t = target(); await assert.rejects(() => project([t], portFor(t, [(s) => ({ ...other(s), ...patch })])), rejection); }
});
test("zero, present values, unknown metadata, simulation and missing source are never qualified", async () => {
  const edits = [
    (t) => { t.row[t.field].value = 0; }, (t) => { t.row[t.field].value = "0"; },
    (t) => { t.row[t.field].status = "pending_metadata"; }, (t) => { t.row[t.field].basis_code = null; },
    (t) => { t.row[t.field].source_context = null; }, (t) => { t.row[t.field].publication_context.publication_role = "simulation_reference"; },
    (t) => { t.row[t.field].score_calculation_context.observation_role = "prior_year_recalculated_reference"; },
    (t) => { t.row.identity_review.status = "review_pending"; },
  ];
  for (const edit of edits) { const t = target(); edit(t); const port = portFor(t);
    assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []); assert.equal(port.calls, 0); }
});
test("expired, future, or revoked approval never yields reasons", async () => {
  for (const patch of [{ expires_at_ms: now }, { issued_at_ms: now + 1 }]) {
    const t = target(); await assert.rejects(() => project([t], portFor(t, [other], (rows) => Object.assign(rows[0], patch))), rejection);
  }
  const t = target(), port = portFor(t); port.assertCurrent = async () => { throw new Error("SYNTHETIC_REVOKED"); };
  await assert.rejects(() => project([t], port), rejection);
});
test("approval expiry during recheck is rejected", async () => {
  const t = target(), times = [now, now + 1000];
  await assert.rejects(() => project([t], portFor(t), () => times.shift()), rejection);
});
test("duplicate and conflicting proofs fail closed", async () => {
  const t = target();
  await assert.rejects(() => project([t], portFor(t, [other, other])), rejection);
  const a = target(), b = structuredClone(a); b.row[b.field].reason_code = "SYNTHETIC-DIFFERENT";
  await assert.rejects(() => project([a, b], portFor(a)), rejection);
});
test("duplicated cells get separate immutable DTO arrays", async () => {
  const t = target(), copy = structuredClone(t), result = await project([t, copy], portFor(t));
  assert.deepEqual(result[0], result[1]); assert.notEqual(result[0].verified_score_null_reasons, result[1].verified_score_null_reasons);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0].verified_score_null_reasons));
});
test("caller mutation while authority is pending cannot alter the snapshotted scope", async () => {
  const t = target(), original = structuredClone(t), base = portFor(original);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const port = { async verifyBatch(request) { await gate; return base.verifyBatch(request); }, assertCurrent: base.assertCurrent };
  const pending = project([t], port); t.row.campus = "SYNTHETIC-MUTATED"; t.row[t.field].value = 0; release();
  assert.deepEqual((await pending)[0].verified_score_null_reasons, ["other_statistic_only"]);
});

test("confirmed null identity is explicit and bound to the exact cell and review digests", async () => {
  const t = target(), base = portFor(t);
  const port = { async verifyBatch(request) {
    assert.deepEqual(request.subjects[0].subject.confirmed_null_identity_fields, ["campus"]);
    assert.equal(request.subjects[0].cell_sha256, await nativeJsonSha256(t.row[t.field]));
    assert.equal(request.subjects[0].identity_review_sha256, await nativeJsonSha256(t.row.identity_review));
    return base.verifyBatch(request);
  }, assertCurrent: base.assertCurrent };
  assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, ["other_statistic_only"]);
});
test("no approved claims returns empty per-cell reason and still checks current approval", async () => {
  const t = target(); let checked = false;
  const port = { async verifyBatch() { return []; }, async assertCurrent(_snapshot, receipts) { checked = true; assert.deepEqual(receipts, []); } };
  assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []);
  assert.equal(checked, true);
});
test("verified different non-percent statistic does not become a fabricated percent", async () => {
  const t = target(); const mean = (s) => ({ ...other(s), statistic_kind: "mean", statistic_percent: null });
  assert.deepEqual((await project([t], portFor(t, [mean])))[0].verified_score_null_reasons, ["other_statistic_only"]);
});
test("out-of-order evidence maps to the correct cell and never contaminates its neighbor", async () => {
  const first = target("final_50_percent_cut"), second = target("final_70_percent_cut");
  const port = { async verifyBatch(request) {
    assert.equal(request.subjects.length, 2);
    return [await proof(request.subjects[1].subject, second, few), await proof(request.subjects[0].subject, first, other)];
  }, async assertCurrent(_snapshot, receipts) { assert.deepEqual(receipts, [sha("f")]); } };
  const result = await project([first, second], port);
  assert.deepEqual(result.map((x) => x.verified_score_null_reasons), [["other_statistic_only"], ["three_or_fewer"]]);
});
test("mismatched offering and unconfirmed identity never invoke the evidence provider", async () => {
  for (const edit of [
    (t) => { t.row.offering_id = "2025:SYNTHETIC-PK"; },
    (t) => { t.row.identity_review.reason_code = "SYNTHETIC-PENDING"; },
    (t) => { t.row[t.field].source_context.identity_variant_index = 16; },
    (t) => { t.row[t.field].source_context.scope_status = "review_pending"; },
  ]) { const t = target(); edit(t); const port = portFor(t);
    assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []); assert.equal(port.calls, 0); }
});
test("provider failure is a generic closed error without private diagnostics", async () => {
  const t = target(), port = portFor(t);
  port.verifyBatch = async () => { throw new Error("SYNTHETIC-PRIVATE-DIAGNOSTIC"); };
  await assert.rejects(() => project([t], port), (e) => rejection(e) && !String(e.message).includes("PRIVATE"));
});

function targetSlot(field = "final_50_percent_cut") {
  const t = target(field);
  t.row[t.field] = { value: null, unit: null, status: "not_published", reason_code: "SYNTHETIC_UNPUBLISHED",
    source_url: null, source_as_of: null, statistic_label: null, cohort: null, source_context: null,
    statistic_percent: field === "final_50_percent_cut" ? 50 : 70, basis_code: null, basis_label: null,
    cohort_code: null, cohort_label: null, selection_rule_ref: null };
  t.row.alternate_cut = { entries: [{ value: "12.50", unit: "SYNTHETIC-UNIT", status: "verified_official",
    reason_code: null, source_url: "https://example.org/synthetic", source_as_of: "2026-01-01", statistic_label: "85%컷",
    cohort: "SYNTHETIC_REGISTERED", source_context: { observation_id: observation("e"), identity_variant_index: 0, scope_status: "source_consistent" },
    statistic_percent: 85, basis_code: "SYNTHETIC_SCORE", basis_label: "SYNTHETIC BASIS", cohort_code: "SYNTHETIC_REGISTERED",
    cohort_label: "SYNTHETIC COHORT", selection_rule_ref: "SYNTHETIC-RULE",
    publication_context: { publication_role: "actual_result", simulation_target_academic_year: null },
    score_calculation_context: { source_result_year: 2026, score_calculation_year: 2026, observation_role: "actual_result" },
  }], omitted_other_basis_count: 0, value: null, status: "not_published", reason_code: "SYNTHETIC_UNPUBLISHED" };
  t.selection = { anchor_field: "alternate_cut", entry_index: 0 };
  return t;
}
test("missing target observation can use separately verified same-row actual-statistic anchor", async () => {
  const t = targetSlot(), original = structuredClone(t), base = portFor(t);
  const port = { async verifyBatch(request) {
    const subject = request.subjects[0].subject;
    assert.equal(subject.observation_id, null);
    assert.equal(subject.selection_anchor.observation_id, observation("e"));
    assert.equal(subject.selection_anchor.cell_sha256, await nativeJsonSha256(t.row.alternate_cut.entries[0]));
    assert.equal(subject.identity_variant_index, 0);
    return base.verifyBatch(request);
  }, assertCurrent: base.assertCurrent };
  assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, ["other_statistic_only"]);
  assert.deepEqual(t, original);
});
test("missing target can be separately verified for both reasons with exact priority", async () => {
  const t = targetSlot();
  assert.deepEqual((await project([t], portFor(t, [other, few])))[0].verified_score_null_reasons, ["three_or_fewer", "other_statistic_only"]);
});
test("missing target remains unknown with no anchor or with an unqualified anchor", async () => {
  const edits = [
    (t) => { delete t.selection; }, (t) => { t.selection.entry_index = 4; },
    (t) => { t.row.alternate_cut.entries[0].status = "pending_metadata"; },
    (t) => { t.row.alternate_cut.entries[0].source_context = null; },
    (t) => { t.row.alternate_cut.entries[0].source_context.scope_status = "review_pending"; },
    (t) => { t.row.alternate_cut.entries[0].publication_context.publication_role = "simulation_reference"; },
    (t) => { t.row.alternate_cut.entries[0].score_calculation_context.score_calculation_year = 2027; },
    (t) => { t.row.identity_review.variants.push({}); },
    (t) => { t.row.academic_year = 2027; t.row.offering_id = "2027:SYNTHETIC-PK"; },
  ];
  for (const edit of edits) { const t = targetSlot(); edit(t); const port = portFor(t);
    assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []); assert.equal(port.calls, 0); }
});
test("target original cohort or basis cannot conflict with the selected anchor", async () => {
  for (const key of ["cohort_code", "basis_code"]) { const t = targetSlot(); t.row[t.field][key] = "SYNTHETIC-OTHER";
    const port = portFor(t); assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []); assert.equal(port.calls, 0); }
});
test("anchor observation and statistic must match the reviewed other-statistic evidence", async () => {
  for (const patch of [{ observation_id: observation("9") }, { statistic_percent: 80 }]) {
    const t = targetSlot(); await assert.rejects(() => project([t], portFor(t, [(s) => ({ ...other(s), ...patch })])), rejection);
  }
});
test("target-slot proof cannot substitute a fabricated observation or a different anchor digest", async () => {
  for (const edit of [
    (subject) => { subject.observation_id = observation("9"); },
    (subject) => { subject.selection_anchor.cell_sha256 = sha("9"); },
    (subject) => { subject.selection_anchor.entry_index = 1; },
    (subject) => { subject.identity_variant_index = 1; },
  ]) { const t = targetSlot(); await assert.rejects(() => project([t], portFor(t, [other], (rows) => edit(rows[0].subject))), rejection); }
});
test("an actual zero in the verified anchor remains a valid published value", async () => {
  const t = targetSlot(); t.row.alternate_cut.entries[0].value = 0;
  assert.deepEqual((await project([t], portFor(t)))[0].verified_score_null_reasons, ["other_statistic_only"]);
  assert.equal(t.row.alternate_cut.entries[0].value, 0);
});

function independentTargetSlot() {
  const t = targetSlot();
  t.row.alternate_cut.entries = [];
  t.selection = { anchor_field: "target_slot", entry_index: null,
    cohort_code: "SYNTHETIC_REGISTERED", basis_code: "SYNTHETIC_SCORE", official_document_sha256: sha("7") };
  return t;
}
test("three-or-fewer can be independently verified for an empty slot without any other score", async () => {
  const t = independentTargetSlot(), original = structuredClone(t), base = portFor(t, [few]);
  const port = { async verifyBatch(request) {
    const subject = request.subjects[0].subject;
    assert.equal(subject.observation_id, null);
    assert.equal(subject.selection_anchor.observation_id, null);
    assert.equal(subject.selection_anchor.official_document_sha256, sha("7"));
    assert.equal(subject.selection_anchor.field, "target_slot");
    return base.verifyBatch(request);
  }, assertCurrent: base.assertCurrent };
  assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, ["three_or_fewer"]);
  assert.deepEqual(t, original);
});
test("empty slot without a trusted provider or approved claim stays unknown", async () => {
  const t = independentTargetSlot();
  assert.deepEqual((await project([t]))[0].verified_score_null_reasons, []);
  const port = { async verifyBatch() { return []; }, async assertCurrent(_snapshot, receipts) { assert.deepEqual(receipts, []); } };
  assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []);
});
test("independent slot proof for another cohort, basis, document, year or scope fails", async () => {
  for (const edit of [
    (r) => { r.subject.cohort_code = "SYNTHETIC-OTHER"; },
    (r) => { r.subject.basis_code = "SYNTHETIC-OTHER"; },
    (r) => { r.subject.selection_anchor.official_document_sha256 = sha("9"); },
    (r) => { r.subject.academic_year = 2025; },
    (r) => { r.scope_sha256 = sha("9"); },
    (r) => { r.reason.cohort_code = "SYNTHETIC-OTHER"; },
  ]) { const t = independentTargetSlot(); await assert.rejects(() => project([t], portFor(t, [few], (rows) => edit(rows[0]))), rejection); }
});
test("ambiguous slot, mismatched selection, invalid document and 2027 placeholder remain unknown", async () => {
  const edits = [
    (t) => { t.row.identity_review.variants.push({}); },
    (t) => { t.row[t.field].cohort_code = "SYNTHETIC-OTHER"; },
    (t) => { t.row[t.field].basis_code = "SYNTHETIC-OTHER"; },
    (t) => { t.selection.official_document_sha256 = "SYNTHETIC-NOT-HASH"; },
    (t) => { t.row.academic_year = 2027; t.row.offering_id = "2027:SYNTHETIC-PK"; },
  ];
  for (const edit of edits) { const t = independentTargetSlot(); edit(t); const port = portFor(t, [few]);
    assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []); assert.equal(port.calls, 0); }
});
test("target-slot proof alone cannot claim a different published statistic", async () => {
  const t = independentTargetSlot();
  await assert.rejects(() => project([t], portFor(t, [other])), rejection);
});
test("source identity variant and anchor scalar must match the validated row", async () => {
  for (const edit of [
    (t) => { t.row.identity_review.variants[0].department = "SYNTHETIC-OTHER"; },
    (t) => { t.row.identity_review.variants[0].admission_track = "SYNTHETIC-OTHER"; },
    (t) => { t.row.alternate_cut.entries[0].value = true; },
    (t) => { t.row.alternate_cut.entries[0].statistic_percent = 50; },
  ]) { const t = targetSlot(); edit(t); const port = portFor(t);
    assert.deepEqual((await project([t], port))[0].verified_score_null_reasons, []); assert.equal(port.calls, 0); }
});
