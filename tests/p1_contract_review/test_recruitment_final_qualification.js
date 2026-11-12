import {
  validateHistorySnapshotPayload,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import {
  nativeValueSha256 as valueHash,
  prepareRecruitmentFinalCandidates as run,
} from "../../supabase/functions/_shared/jungsi/application/recruitment_final_qualification.ts";
const test = Deno.test;
function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue(a[k], b[k]));
}
const assert = {
  ok(v) {
    if (!v) throw Error("assert.ok failed");
  },
  equal(a, b) {
    if (!Object.is(a, b)) throw Error("assert.equal failed");
  },
  deepEqual(a, b) {
    if (!sameValue(a, b)) throw Error("assert.deepEqual failed");
  },
  match(v, re) {
    if (typeof v !== "string" || !re.test(v)) throw Error("assert.match failed");
  },
  async rejects(p, re) {
    try {
      await p;
    } catch (error) {
      if (re.test(error instanceof Error ? error.message : String(error))) return;
      throw Error("assert.rejects unexpected error");
    }
    throw Error("assert.rejects expected rejection");
  },
};
const H = "a".repeat(64),
  S = "b".repeat(64),
  A = "c".repeat(64),
  P = "d".repeat(64),
  X = "e".repeat(64),
  M = "f".repeat(64);
const cid = (n) => "observation:" + n.toString(16).padStart(64, "0");
async function row(n = 1, v = "003") {
  return {
    observation_id: cid(n),
    academic_year: 2024,
    school_id: "S1",
    offering_pk: "P" + n,
    admission_track: "general",
    recruit_group: "a",
    identity_variant_index: 0,
    metric_kind: "recruitment_quota_published_stage_unspecified",
    active_service: true,
    value: v,
    expected_native_value_sha256: await valueHash(v),
    raw_source_row_sha256: "1".repeat(64),
    previous_cell: null,
  };
}
const prior = (id, v, stage = "final", idx = 0) => ({
  value: v,
  unit: "명",
  status: "verified_official",
  reason_code: null,
  source_url: "https://example.edu/official",
  source_as_of: "2024-01-01",
  statistic_label: null,
  cohort: null,
  source_context: {
    observation_id: id,
    identity_variant_index: idx,
    scope_status: "source_consistent",
  },
  stage,
});
function fixture(rows) {
  const pins = {
      source_head_sha256: H,
      approved_scope_sha256: S,
      authority_sha256: A,
      previous_manifest_sha256: M,
    },
    calls = [];
  let transform = (x) => x;
  const authority = {
    async assertLive(p) {
      await Promise.resolve();
      calls.push("live");
      assert.deepEqual(p, pins);
    },
    async verifyBatch(_p, subjects) {
      await Promise.resolve();
      calls.push("verify");
      assert.ok(Object.isFrozen(subjects));
      return subjects.map((s, i) =>
        transform({
          subject_sha256: s.subject_sha256,
          source_head_sha256: H,
          approved_scope_sha256: S,
          authority_sha256: A,
          previous_manifest_sha256: M,
          previous_cell_sha256: s.previous_cell_sha256,
          previous_cell_binding: rows[i].previous_cell === null
            ? "absent_previous_cell_verified"
            : rows[i].previous_cell.reason_code === "SOURCE_SELECTION_PENDING"
            ? "empty_selection_cell_verified"
            : "source_consistent_verified",
          identity_variant_index: s.identity_variant_index,
          target_cell_group_sha256: s.target_cell_group_sha256,
          target_cell_selection: "single_selection_approved",
          target_cell_selected_observation_id: s.observation_id,
          native_value_sha256: s.native_value_sha256,
          native_value_type: s.native_value_type,
          native_value_json_type: s.native_value_json_type,
          native_value_codec: s.native_value_codec,
          raw_source_row_sha256: s.raw_source_row_sha256,
          source_snapshot_confirmed: true,
          stage: "final",
          unit: "명",
          source_sha256: P,
          source_ref: "OFFICIAL-SOURCE",
          source_url: "https://example.edu/official",
          source_as_of: "2024-01-01",
          source_as_of_kind: "official_announcement_date",
          source_metric_binding: "approved_recruitment_final_count",
          source_production_allowed: false,
          source_cohort_sha256: "2".repeat(64),
          source_cohort_binding: "approved",
          source_announced_groups: [s.recruit_group],
          source_announced_groups_binding: "approved",
          target_membership_sha256: "3".repeat(64),
          target_membership_binding: "approved",
          disposition: "approved",
        })
      );
    },
  };
  return {
    pins,
    rows,
    calls,
    authority,
    set transform(f) {
      transform = f;
    },
    run: () => run(pins, rows, authority),
  };
}
test("36 existing observations get one candidate cell each after one evidence batch", async () => {
  const rows = await Promise.all(Array.from({ length: 36 }, (_, i) => row(i + 1, String(i)))),
    f = fixture(rows),
    r = await f.run();
  assert.deepEqual(f.calls, ["live", "verify", "live"]);
  assert.equal(r.created_observations, 0);
  assert.equal(r.guide_writes, 0);
  assert.equal(r.publication_ready, false);
  assert.equal(r.results.length, 36);
  for (let i = 0; i < 36; i++) {
    const x = r.results[i];
    assert.equal(x.action, "PROPOSED");
    assert.equal(x.recruitment_count_with_stage.value, String(i));
    assert.equal(x.recruitment_count_with_stage.stage, "final");
    assert.equal(x.recruitment_count_with_stage.status, "verified_official");
    assert.equal(
      x.recruitment_count_with_stage.source_context.observation_id,
      rows[i].observation_id,
    );
    assert.equal(x.private_qualification_reference.source_sha256, P);
  }
});
test("unapproved evidence and stage, unit or source absence remain HOLD", async () => {
  for (
    const patch of [
      { disposition: "hold" },
      { stage: "unspecified" },
      { stage: "initial" },
      { unit: null },
      { unit: "건" },
      { source_sha256: null },
      { source_ref: null },
      { source_url: null },
      { source_as_of: "2024-02-30" },
      { source_as_of_kind: "retrieved_at" },
      { source_as_of_kind: null },
      { source_url: "https://localhost/private" },
    ]
  ) {
    const f = fixture([await row()]);
    f.transform = (x) => ({ ...x, ...patch });
    const r = await f.run();
    assert.equal(r.results[0].action, "HOLD");
    assert.equal(r.results[0].recruitment_count_with_stage, null);
    assert.equal(r.publication_ready, false);
  }
});
test("wrong independent subject, head, scope, authority, native type or hash cannot qualify", async () => {
  for (
    const patch of [
      { subject_sha256: X },
      { source_head_sha256: X },
      { approved_scope_sha256: X },
      { authority_sha256: X },
      { native_value_sha256: X },
      { native_value_type: "number" },
      { identity_variant_index: 7 },
      { native_value_json_type: "number" },
      { native_value_codec: "other" },
      { raw_source_row_sha256: X },
      { source_snapshot_confirmed: false },
    ]
  ) {
    const f = fixture([await row()]);
    f.transform = (x) => ({ ...x, ...patch });
    const r = await f.run();
    assert.equal(r.results[0].action, "HOLD");
  }
});
test("current value fingerprint, inactive state, missing identity and unsupported metric hold", async () => {
  const base = await row();
  for (
    const patch of [
      { expected_native_value_sha256: X },
      { active_service: false },
      { admission_track: null },
      { recruit_group: null },
      { metric_kind: "competition_ratio" },
    ]
  ) {
    const f = fixture([{ ...base, ...patch }]), r = await f.run();
    assert.equal(r.results[0].action, "HOLD");
  }
});
test("numeric text, number zero and bigint keep distinct native fingerprints and values", async () => {
  const rows = [await row(1, "0"), await row(2, 0), await row(3, 0n)],
    f = fixture(rows),
    r = await f.run();
  assert.equal(new Set(await Promise.all(rows.map((x) => valueHash(x.value)))).size, 3);
  assert.equal(typeof r.results[0].recruitment_count_with_stage.value, "string");
  assert.equal(typeof r.results[1].recruitment_count_with_stage.value, "number");
  assert.equal(typeof r.results[2].recruitment_count_with_stage.value, "bigint");
});
test("matching unspecified cell yields new final review candidate without mutating prior", async () => {
  const x = await row(), old = prior(x.observation_id, x.value, "unspecified");
  x.previous_cell = old;
  const f = fixture([x]), r = await f.run(), out = r.results[0];
  assert.equal(out.action, "PROPOSED");
  assert.equal(out.recruitment_count_with_stage.stage, "final");
  assert.equal(out.recruitment_count_with_stage.status, "verified_official");
  assert.equal(old.stage, "unspecified");
  assert.equal(out.private_qualification_reference.previous_manifest_sha256, M);
  assert.match(out.private_qualification_reference.previous_cell_sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.publication_ready, false);
});
test("same exact ID, identity variant, native value, unit and final prior stays preserved", async () => {
  const x = await row();
  x.previous_cell = prior(x.observation_id, x.value);
  const f = fixture([x]), r = await f.run();
  assert.equal(r.results[0].action, "PRESERVED");
  assert.deepEqual(r.results[0].recruitment_count_with_stage, x.previous_cell);
});
test("different native type, identity variant, value or unit in prior is held", async () => {
  const x = await row();
  for (
    const old of [
      prior(x.observation_id, 3),
      prior(x.observation_id, "004"),
      prior(x.observation_id, "003", "final", 1),
      { ...prior(x.observation_id, "003"), unit: "건" },
    ]
  ) {
    const f = fixture([{ ...x, previous_cell: old }]), r = await f.run();
    assert.equal(r.results[0].action, "HOLD");
    assert.deepEqual(r.results[0].recruitment_count_with_stage, old);
  }
});
test("empty source selection placeholder can receive only an unpublished candidate", async () => {
  const x = await row();
  x.previous_cell = {
    value: null,
    unit: null,
    status: "pending_metadata",
    reason_code: "SOURCE_SELECTION_PENDING",
    source_url: null,
    source_as_of: null,
    statistic_label: null,
    cohort: null,
    source_context: null,
    stage: "unspecified",
  };
  const r = await fixture([x]).run();
  assert.equal(r.results[0].action, "PROPOSED");
  assert.equal(r.results[0].recruitment_count_with_stage.status, "verified_official");
  assert.equal(r.publication_ready, false);
});
test("null and non-integer counts do not turn into zero or approved cells", async () => {
  for (const v of [null, "-1", "3.4", -1, 1.5]) {
    const f = fixture([await row(1, v)]), r = await f.run();
    assert.equal(r.results[0].action, "HOLD");
    assert.equal(r.results[0].reason_code, "VALUE_UNRESOLVED");
  }
});
test("sparse or accessor proof arrays and input properties fail without executing getters", async () => {
  let gets = 0;
  const a = fixture([await row()]);
  a.authority.verifyBatch = () => Promise.resolve(new Array(1));
  await assert.rejects(a.run(), /array_shape|array_property/);
  const b = fixture([await row()]);
  const v = [null];
  Object.defineProperty(v, "0", {
    get() {
      gets++;
      return {};
    },
    enumerable: true,
  });
  b.authority.verifyBatch = () => Promise.resolve(v);
  await assert.rejects(b.run(), /array_property/);
  const x = await row();
  Object.defineProperty(x, "value", {
    get() {
      gets++;
      return "003";
    },
    enumerable: true,
  });
  const c = fixture([x]);
  await assert.rejects(c.run(), /property/);
  assert.equal(gets, 0);
});
test("duplicate canonical IDs, malformed proofs and caller approval fields fail closed", async () => {
  const x = await row();
  await assert.rejects(fixture([x, { ...x }]).run(), /duplicate_observation/);
  const b = fixture([await row()]);
  b.authority.verifyBatch = () => Promise.resolve([{}]);
  assert.equal((await b.run()).results[0].action, "HOLD");
  const z = await row();
  z.approved = true;
  await assert.rejects(fixture([z]).run(), /keys/);
});
test("false or revoked authority never returns a candidate result", async () => {
  const a = fixture([await row()]);
  a.authority.assertLive = () => Promise.resolve(false);
  await assert.rejects(a.run(), /authority_protocol/);
  assert.deepEqual(a.calls, []);
  const b = fixture([await row()]);
  let n = 0;
  b.authority.assertLive = async () => {
    await Promise.resolve();
    if (++n === 2) throw Error("revoked");
  };
  await assert.rejects(b.run(), /revoked/);
});

test("unbound prior cell, prior manifest, pending identity or initial prior remains held", async () => {
  const x = await row();
  x.previous_cell = prior(x.observation_id, x.value, "unspecified");
  for (const patch of [{ previous_manifest_sha256: X }, { previous_cell_sha256: X }]) {
    const f = fixture([x]);
    f.transform = (z) => ({ ...z, ...patch });
    const r = await f.run();
    assert.equal(r.results[0].action, "HOLD");
    assert.deepEqual(r.results[0].recruitment_count_with_stage, x.previous_cell);
  }
  const y = {
    ...x,
    previous_cell: {
      ...x.previous_cell,
      source_context: { ...x.previous_cell.source_context, scope_status: "review_pending" },
    },
  };
  assert.equal((await fixture([y]).run()).results[0].action, "HOLD");
  const z = { ...x, previous_cell: prior(x.observation_id, x.value, "initial") };
  assert.equal((await fixture([z]).run()).results[0].action, "HOLD");
  const q = { ...x, previous_cell: { ...x.previous_cell, status: "not_published" } };
  assert.equal((await fixture([q]).run()).results[0].action, "HOLD");
});

test("pending final cell gains verified candidate with official evidence", async () => {
  const x = await row(),
    old = {
      ...prior(x.observation_id, x.value, "final"),
      status: "pending_metadata",
      reason_code: "PENDING",
      source_url: null,
      source_as_of: null,
    };
  x.previous_cell = old;
  const r = await fixture([x]).run(), o = r.results[0];
  assert.equal(o.action, "PROPOSED");
  assert.equal(o.recruitment_count_with_stage.status, "verified_official");
  assert.equal(o.recruitment_count_with_stage.source_url, "https://example.edu/official");
  assert.equal(o.recruitment_count_with_stage.source_as_of, "2024-01-01");
  assert.equal(old.status, "pending_metadata");
  assert.equal(old.source_url, null);
  assert.equal(r.publication_ready, false);
});
test("review-pending and missing context require distinct explicit issuer binding", async () => {
  const x = await row(),
    old = {
      ...prior(x.observation_id, x.value, "unspecified"),
      status: "pending_metadata",
      reason_code: "PENDING",
      source_url: null,
      source_as_of: null,
    };
  for (
    const [context, binding] of [[
      { ...old.source_context, scope_status: "review_pending" },
      "existing_context_review_pending_verified",
    ], [null, "missing_context_verified"]]
  ) {
    const y = { ...x, previous_cell: { ...old, source_context: context } }, wrong = fixture([y]);
    assert.equal((await wrong.run()).results[0].action, "HOLD");
    const ok = fixture([y]);
    ok.transform = (p) => ({ ...p, previous_cell_binding: binding });
    const z = await ok.run();
    assert.equal(z.results[0].action, "PROPOSED");
    assert.equal(
      z.results[0].recruitment_count_with_stage.source_context.observation_id,
      x.observation_id,
    );
    assert.equal(
      z.results[0].recruitment_count_with_stage.source_context.scope_status,
      "source_consistent",
    );
    assert.deepEqual(y.previous_cell.source_context, context);
    assert.equal(z.publication_ready, false);
  }
});
test("missing raw row SHA, prior source conflict and inconsistent identity HOLD", async () => {
  const x = await row(), missing = { ...x, raw_source_row_sha256: null };
  assert.equal((await fixture([missing]).run()).results[0].action, "HOLD");
  for (
    const change of [{ source_url: "https://other.example.edu/official" }, {
      source_as_of: "2024-01-02",
    }, {
      source_context: {
        observation_id: cid(2),
        identity_variant_index: 0,
        scope_status: "source_consistent",
      },
    }]
  ) {
    const old = { ...prior(x.observation_id, x.value, "unspecified"), ...change };
    const r = await fixture([{ ...x, previous_cell: old }]).run();
    assert.equal(r.results[0].action, "HOLD");
    assert.deepEqual(r.results[0].recruitment_count_with_stage, old);
  }
});

test("missing official date yields final pending without inventing a date", async () => {
  const x = await row(),
    old = {
      ...prior(x.observation_id, x.value, "unspecified"),
      status: "pending_metadata",
      reason_code: "PENDING",
      source_url: null,
      source_as_of: null,
      source_context: {
        observation_id: x.observation_id,
        identity_variant_index: 0,
        scope_status: "review_pending",
      },
    };
  x.previous_cell = old;
  const f = fixture([x]);
  f.transform = (p) => ({
    ...p,
    source_as_of: null,
    source_as_of_kind: null,
    previous_cell_binding: "existing_context_review_pending_verified",
  });
  const r = await f.run(), c = r.results[0].recruitment_count_with_stage;
  assert.equal(r.results[0].action, "PROPOSED");
  assert.equal(c.stage, "final");
  assert.equal(c.status, "pending_metadata");
  assert.equal(c.reason_code, "SOURCE_AS_OF_UNCONFIRMED");
  assert.equal(c.source_as_of, null);
  assert.equal(old.stage, "unspecified");
  assert.equal(r.publication_ready, false);
});
test("actual project P1 payload validator accepts dated and undated candidates", async () => {
  const x = await row(),
    f = fixture([x]),
    withDate = (await f.run()).results[0].recruitment_count_with_stage;
  const n = fixture([x]);
  n.transform = (p) => ({ ...p, source_as_of: null, source_as_of_kind: null });
  const withoutDate = (await n.run()).results[0].recruitment_count_with_stage;
  const blank = () => ({
    value: null,
    unit: null,
    status: "not_published",
    reason_code: "NOT_PUBLISHED",
    source_url: null,
    source_as_of: null,
    statistic_label: null,
    cohort: null,
    source_context: null,
  });
  const cut = () => ({
    ...blank(),
    statistic_percent: null,
    basis_code: null,
    basis_label: null,
    cohort_code: null,
    cohort_label: null,
    selection_rule_ref: null,
  });
  for (const cell of [withDate, withoutDate]) {
    const r = {
      offering_id: "2024:P1",
      academic_year: 2024,
      original_pk: "P1",
      observation_key: null,
      mapping_status: "mapped",
      identity_review: {
        status: "source_consistent",
        reason_code: null,
        variants: [{
          university_name: "Synthetic",
          department: "Synthetic",
          admission_track: "general",
          group: "a",
        }],
      },
      university_id: "S1",
      university_name: "Synthetic",
      region: null,
      campus: null,
      department: "Synthetic",
      admission_track: "general",
      group: "a",
      recruitment_count_with_stage: cell,
      competition_ratio: blank(),
      additional_admission_count: blank(),
      final_additional_admission_rank: blank(),
      final_50_percent_cut: cut(),
      final_70_percent_cut: cut(),
      alternate_cut: { ...cut(), entries: [], omitted_other_basis_count: 0 },
    };
    const body = {
      format: "jungsi.history-snapshot/v1",
      payload_id: "synthetic-payload",
      part_id: "synthetic-part",
      rows: [r],
    };
    const checked = validateHistorySnapshotPayload(body, {
      partId: "synthetic-part",
      payloadId: "synthetic-payload",
      rows: 1,
      mappedRows: 1,
      mappingPendingRows: 0,
    });
    assert.equal(checked.rows[0].recruitment_count_with_stage.status, cell.status);
  }
});

test("missing date with a claimed meaning cannot qualify", async () => {
  const f = fixture([await row()]);
  f.transform = (p) => ({ ...p, source_as_of: null, source_as_of_kind: "retrieved_at" });
  const r = await f.run();
  assert.equal(r.results[0].action, "HOLD");
});

test("conflicting observations for one cell all HOLD without selection, even for equal values", async () => {
  const a = await row(1, "8"), b = { ...await row(2, "8"), offering_pk: a.offering_pk };
  const r = await fixture([a, b]).run();
  assert.deepEqual(r.results.map((x) => x.action), ["HOLD", "HOLD"]);
  assert.deepEqual(r.results.map((x) => x.reason_code), [
    "DUPLICATE_CELL_SELECTION_REQUIRED",
    "DUPLICATE_CELL_SELECTION_REQUIRED",
  ]);
  assert.equal(r.publication_ready, false);
});
test("issuer group selection must agree across proofs and can choose at most one observation", async () => {
  const a = await row(1, "8"), b = { ...await row(2, "8"), offering_pk: a.offering_pk };
  const f = fixture([a, b]);
  f.transform = (p) => ({
    ...p,
    target_cell_selection: "single_selection_approved",
    target_cell_selected_observation_id: a.observation_id,
  });
  const r = await f.run();
  assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "HOLD"]);
  const mixed = fixture([a, b]);
  let count = 0;
  mixed.transform = (p) => ({
    ...p,
    target_cell_selection: "single_selection_approved",
    target_cell_selected_observation_id: ++count === 1 ? a.observation_id : b.observation_id,
  });
  const bad = await mixed.run();
  assert.deepEqual(bad.results.map((x) => x.action), ["HOLD", "HOLD"]);
});

test("historical P1 same year and original_pk conflict across school or track", async () => {
  const a = await row(1, "8");
  const b = {
    ...await row(2, "8"),
    offering_pk: a.offering_pk,
    school_id: "OTHER",
    admission_track: "OTHER_TRACK",
  };
  const r = await fixture([a, b]).run();
  assert.deepEqual(r.results.map((x) => x.action), ["HOLD", "HOLD"]);
  assert.deepEqual(r.results.map((x) => x.reason_code), [
    "DUPLICATE_CELL_SELECTION_REQUIRED",
    "DUPLICATE_CELL_SELECTION_REQUIRED",
  ]);
});
test("P1 2027 scope is unsupported by historical cell identity", async () => {
  const x = { ...await row(), academic_year: 2027 };
  const r = await fixture([x]).run();
  assert.equal(r.results[0].action, "HOLD");
  assert.equal(r.results[0].reason_code, "P1_2027_SCOPE_UNSUPPORTED");
});

test("aggregate observation stays single and admits independently verified same-group members", async () => {
  const a = await row(1, "8"), b = { ...await row(2, "8"), observation_id: a.observation_id };
  const r = await fixture([a, b]).run();
  assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "PROPOSED"]);
  assert.equal(r.results[0].observation_id, r.results[1].observation_id);
  assert.equal(r.created_observations, 0);
  assert.equal(r.publication_ready, false);
});
test("aggregate announced group mismatch holds only that member", async () => {
  const a = await row(1, "8"),
    b = {
      ...await row(2, "8"),
      observation_id: a.observation_id,
      recruit_group: "b",
    },
    independent = await row(3, "9");
  const f = fixture([a, b, independent]);
  f.transform = (p) => ({ ...p, source_announced_groups: ["a"] });
  const r = await f.run();
  assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "HOLD", "PROPOSED"]);
  assert.equal(r.results[1].reason_code, "SOURCE_GROUP_UNAPPROVED_OR_MISMATCH");
  assert.equal(r.created_observations, 0);
  assert.equal(r.publication_ready, false);
});
test("explicitly approved multi-group source allows each independently verified member", async () => {
  const a = await row(1, "8"),
    b = {
      ...await row(2, "8"),
      observation_id: a.observation_id,
      recruit_group: "b",
    };
  const f = fixture([a, b]);
  f.transform = (p) => ({ ...p, source_announced_groups: ["a", "b"] });
  const r = await f.run();
  assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "PROPOSED"]);
  assert.equal(r.created_observations, 0);
  assert.equal(r.publication_ready, false);
});
test("missing or malformed cohort group or membership proof holds only that member", async () => {
  for (
    const change of [
      { source_cohort_sha256: null },
      { source_cohort_binding: null },
      { source_announced_groups: null },
      { source_announced_groups_binding: null },
      { target_membership_sha256: null },
      { target_membership_binding: null },
    ]
  ) {
    const a = await row(1, "8"), b = { ...await row(2, "8"), observation_id: a.observation_id };
    const f = fixture([a, b]);
    let index = 0;
    f.transform = (p) => ++index === 2 ? { ...p, ...change } : p;
    const r = await f.run();
    assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "HOLD"]);
    assert.equal(r.publication_ready, false);
  }
});
test("conflicting approved source cohort holds only members of that observation", async () => {
  const a = await row(1, "8"), b = { ...await row(2, "8"), observation_id: a.observation_id };
  const independent = await row(3, "9"), f = fixture([a, b, independent]);
  let index = 0;
  f.transform = (p) => ++index === 2 ? { ...p, source_cohort_sha256: "4".repeat(64) } : p;
  const r = await f.run();
  assert.deepEqual(r.results.map((x) => x.action), ["HOLD", "HOLD", "PROPOSED"]);
  assert.equal(r.results[0].reason_code, "SOURCE_OBSERVATION_EVIDENCE_CONFLICT");
  assert.equal(r.publication_ready, false);
});
test("singleton selection and empty previous cell require explicit independent bindings", async () => {
  for (
    const change of [
      { target_cell_selection: null },
      { target_cell_selected_observation_id: null },
      { previous_cell_binding: null },
      { previous_cell_binding: "unverified" },
    ]
  ) {
    const f = fixture([await row()]);
    f.transform = (p) => ({ ...p, ...change });
    const r = await f.run();
    assert.equal(r.results[0].action, "HOLD");
    assert.equal(r.publication_ready, false);
  }
});

test("score source cannot qualify as a final recruitment count", async () => {
  const f = fixture([await row()]);
  f.transform = (p) => ({ ...p, source_metric_binding: "approved_score" });
  const r = await f.run();
  assert.equal(r.results[0].action, "HOLD");
  assert.equal(r.results[0].reason_code, "SOURCE_MEASUREMENT_UNAPPROVED");
  assert.equal(r.publication_ready, false);
});
test("source production state remains internal and no review candidate gains publication", async () => {
  for (const allowed of [false, true]) {
    const f = fixture([await row()]);
    f.transform = (p) => ({ ...p, source_production_allowed: allowed });
    const r = await f.run();
    assert.equal(r.results[0].action, "PROPOSED");
    assert.equal(r.results[0].private_qualification_reference.source_production_allowed, allowed);
    assert.equal(r.publication_ready, false);
    assert.equal("production_allowed" in r.results[0].recruitment_count_with_stage, false);
  }
  const f = fixture([await row()]);
  f.transform = (p) => ({ ...p, source_production_allowed: null });
  const r = await f.run();
  assert.equal(r.results[0].action, "HOLD");
  assert.equal(r.publication_ready, false);
});
test("unapproved aggregate member cannot suppress an independently verified member", async () => {
  const a = await row(1, "8"), b = { ...await row(2, "8"), observation_id: a.observation_id };
  const f = fixture([a, b]);
  let index = 0;
  f.transform = (p) =>
    ++index === 2 ? { ...p, previous_cell_binding: null, source_cohort_sha256: "4".repeat(64) } : p;
  const r = await f.run();
  assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "HOLD"]);
  assert.equal(r.results[1].reason_code, "PREVIOUS_CELL_BINDING_UNAPPROVED");
  assert.equal(r.publication_ready, false);
});

test("same canonical observation: conflicting approved native value HOLDs only that observation", async () => {
  const a = await row(1, "003");
  const b = { ...await row(2, "004"), observation_id: a.observation_id };
  const other = await row(3, "005");
  const r = await fixture([a, b, other]).run();
  assert.deepEqual(r.results.map((x) => x.action), ["HOLD", "HOLD", "PROPOSED"]);
  assert.deepEqual(r.results.slice(0, 2).map((x) => x.reason_code), [
    "SOURCE_OBSERVATION_EVIDENCE_CONFLICT",
    "SOURCE_OBSERVATION_EVIDENCE_CONFLICT",
  ]);
  assert.equal(r.created_observations, 0);
  assert.equal(r.publication_ready, false);
});

test("same canonical observation: conflicting approved JSON and runtime types HOLD", async () => {
  const a = await row(1, "0");
  const b = { ...await row(2, 0), observation_id: a.observation_id };
  const r = await fixture([a, b]).run();
  assert.deepEqual(r.results.map((x) => x.action), ["HOLD", "HOLD"]);
  assert.equal(a.value, "0");
  assert.equal(b.value, 0);
  assert.equal(r.publication_ready, false);
  const c = await row(3, 0);
  const d = { ...await row(4, 0n), observation_id: c.observation_id };
  const runtimeOnly = await fixture([c, d]).run();
  assert.deepEqual(runtimeOnly.results.map((x) => x.action), ["HOLD", "HOLD"]);
  assert.equal(c.value, 0);
  assert.equal(d.value, 0n);
  assert.equal(runtimeOnly.publication_ready, false);
});

test("same canonical observation: conflicting approved raw source row SHA HOLDs", async () => {
  const a = await row(1, "003");
  const b = {
    ...await row(2, "003"),
    observation_id: a.observation_id,
    raw_source_row_sha256: "9".repeat(64),
  };
  const r = await fixture([a, b]).run();
  assert.deepEqual(r.results.map((x) => x.action), ["HOLD", "HOLD"]);
  assert.equal(r.publication_ready, false);
});

test("three approved same-observation members retain distinct PKs and one native value", async () => {
  const a = await row(1, "003");
  const b = { ...await row(2, "003"), observation_id: a.observation_id };
  const c = { ...await row(3, "003"), observation_id: a.observation_id };
  const r = await fixture([a, b, c]).run();
  assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "PROPOSED", "PROPOSED"]);
  assert.deepEqual(r.results.map((x) => x.offering_pk), ["P1", "P2", "P3"]);
  assert.ok(r.results.every((x) => x.observation_id === a.observation_id));
  assert.ok(r.results.every((x) => x.recruitment_count_with_stage.value === "003"));
  assert.equal(r.created_observations, 0);
  assert.equal(r.publication_ready, false);
});

test("unapproved conflicting native value and row SHA cannot suppress approved members", async () => {
  const a = await row(1, "003");
  const b = {
    ...await row(2, "004"),
    observation_id: a.observation_id,
    raw_source_row_sha256: "9".repeat(64),
  };
  const c = { ...await row(3, "003"), observation_id: a.observation_id };
  const f = fixture([a, b, c]);
  let index = 0;
  f.transform = (proof) => ++index === 2 ? { ...proof, target_membership_binding: null } : proof;
  const r = await f.run();
  assert.deepEqual(r.results.map((x) => x.action), ["PROPOSED", "HOLD", "PROPOSED"]);
  assert.equal(r.results[1].reason_code, "TARGET_MEMBERSHIP_UNAPPROVED");
  assert.equal(r.created_observations, 0);
  assert.equal(r.publication_ready, false);
});
