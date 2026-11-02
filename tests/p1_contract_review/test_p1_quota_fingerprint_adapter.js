import { bindP1QuotaFingerprintBatch as bind } from "../../supabase/functions/_shared/jungsi/application/p1_quota_fingerprint_adapter.ts";
import {
  nativeValueSha256,
  prepareRecruitmentFinalCandidates,
} from "../../supabase/functions/_shared/jungsi/application/recruitment_final_qualification.ts";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
function eq(a, b) {
  if (!Object.is(a, b)) throw Error("not equal");
}
const H = "a".repeat(64),
  P = "b".repeat(64),
  A = "c".repeat(64),
  S = "d".repeat(64),
  Q = "e".repeat(64),
  R = "f".repeat(64),
  CID = "observation:" + H;
const QSHA = "0481232414ef418dae02e26ae5a4a30708f199904136671e3ba16ec2c078ca40";
const PY = "163301eb12fbf6995e5e2cbf04f9b17073f4f3a1da6a333f26856b9e7b5691ed";
const PY_ALT = "ec93a85ee8d4da8e876c744a07e69258ed4512662baa6b0b946df352c72d1c3d";
const UNICODE = "f0052325b6af2dcc446ed06a3b81d15b3937a58b48a2504aca8fd7e10444d894";
const NULLCTX = "990c1701bfcaf983d818c1a5f037d4e5089e7d1f1cf847f234ac7a54abefcf85";
const ENCODING = "SHA256 compact sorted-key UTF-8 JSON; scalar native types preserved";
async function bytesSha(b) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", b)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function cell() {
  return {
    value: "007",
    unit: "명",
    status: "pending_metadata",
    reason_code: "SYNTHETIC",
    source_url: null,
    source_as_of: null,
    statistic_label: null,
    cohort: null,
    source_context: {
      observation_id: CID,
      identity_variant_index: 7,
      scope_status: "review_pending",
    },
    stage: "unspecified",
  };
}
async function fixture(n) {
  const pins = {
    approved_reference_sha256: "",
    approved_reference_schema: "synthetic-reference/v1",
    current_source_head_sha256: H,
    current_p1_manifest_sha256: P,
    approved_scope_sha256: S,
    authority_sha256: A,
  };
  const selectors = Array.from(
    { length: n },
    (_, i) => ({ academic_year: 2025, school_id: "SYNTH", offering_pk: "TEST-" + i }),
  );
  const rows = selectors.map((s, i) => ({
    ...s,
    admission_track: "SYNTH",
    recruit_group: "A",
    p1_part_id: "SYNTH-PART",
    p1_part_sha256: Q,
    p1_row_1based: i + 1,
    existing_canonical_result_id: CID,
    identity_variant_index: 7,
    previous_cell: cell(),
    metric_value_json_type: "string",
    metric_value_literal: '"007"',
    numeric_projection: { codec: "sql_numeric_integer_canonical_decimal/v1", literal: "7" },
    raw_source_row_sha256: R,
  }));
  const targets = rows.map((r) => ({
    academic_year: r.academic_year,
    school_id: r.school_id,
    offering_pk: r.offering_pk,
    p1_part_id: r.p1_part_id,
    p1_part_sha256: r.p1_part_sha256,
    p1_row_1based: r.p1_row_1based,
    existing_canonical_result_id: r.existing_canonical_result_id,
    identity_variant_index_candidate: r.identity_variant_index,
    expected_cell_sha256: PY,
    expected_cell_fingerprint_encoding: ENCODING,
    context_case: "EXISTING_ID_CONTEXT",
  }));
  const reference = {
    schema: pins.approved_reference_schema,
    original_p1_manifest_sha256: P,
    targets,
  };
  let bytes, transform = (p) => p, scopeTransform = (p) => p;
  let authorized = selectors.map((s) => ({ ...s }));
  async function approvedScopeSha(p) {
    const ordered = authorized.map((s) => ({
      academic_year: s.academic_year,
      school_id: s.school_id,
      offering_pk: s.offering_pk,
    }));
    ordered.sort((a, b) =>
      a.academic_year - b.academic_year ||
      (a.school_id < b.school_id ? -1 : a.school_id > b.school_id ? 1 : 0) ||
      (a.offering_pk < b.offering_pk ? -1 : a.offering_pk > b.offering_pk ? 1 : 0)
    );
    return await nativeJsonSha256({
      codec: "jungsi.p1-quota-bridge-request-scope/v1",
      approved_reference_sha256: p.approved_reference_sha256,
      current_source_head_sha256: p.current_source_head_sha256,
      current_p1_manifest_sha256: p.current_p1_manifest_sha256,
      approved_scope_sha256: p.approved_scope_sha256,
      qualification_source_sha256: QSHA,
      selectors: ordered,
    });
  }
  const calls = { budget: [], authorize: 0, read: [], verify: [], live: 0 };
  const port = {
    async assertLive() {
      await Promise.resolve();
      calls.live++;
    },
    async executeWithSharedBudget(_p, meta, work) {
      calls.budget.push(meta);
      await work();
    },
    async authorizeRequestScope(p, scope) {
      calls.authorize++;
      const approved = scope.request_scope_sha256 === await approvedScopeSha(p) &&
        scope.request_scope_count === authorized.length;
      return scopeTransform({
        disposition: approved ? "approved" : "hold",
        authority_sha256: p.authority_sha256,
        approved_reference_sha256: p.approved_reference_sha256,
        current_source_head_sha256: p.current_source_head_sha256,
        current_p1_manifest_sha256: p.current_p1_manifest_sha256,
        approved_scope_sha256: p.approved_scope_sha256,
        approved_request_scope_sha256: scope.request_scope_sha256,
        approved_request_scope_count: scope.request_scope_count,
        request_scope_binding: approved ? "independent_exact_approved" : "denied",
      });
    },
    async readTrustedSnapshotBatch(p, chunk, include, scope) {
      calls.read.push({ count: chunk.length, include, scope: scope.request_scope_sha256 });
      if (
        scope.request_scope_sha256 !== await approvedScopeSha(p) ||
        scope.request_scope_count !== authorized.length
      ) throw Error("scope_not_authorized");
      return {
        reference_bytes: include ? bytes : null,
        rows: chunk.map((s) => rows.find((r) => r.offering_pk === s.offering_pk)),
      };
    },
    async verifyBindingsBatch(p, scope, subjects) {
      calls.verify.push(subjects.length);
      const approved = scope.request_scope_sha256 === await approvedScopeSha(p) &&
        scope.request_scope_count === authorized.length;
      for (const s of subjects) eq(s.qualification_source_sha256, QSHA);
      return await Promise.all(subjects.map(async (s) => {
        const groupSha = await nativeJsonSha256({
          codec: "jungsi.p1-recruitment-target-cell-group/v2",
          cell: [s.academic_year, s.offering_pk],
          observation_ids: [s.existing_canonical_result_id],
        });
        return transform({
          disposition: "approved",
          subject_sha256: s.subject_sha256,
          authority_sha256: p.authority_sha256,
          approved_reference_sha256: p.approved_reference_sha256,
          current_source_head_sha256: p.current_source_head_sha256,
          current_p1_manifest_sha256: p.current_p1_manifest_sha256,
          approved_scope_sha256: p.approved_scope_sha256,
          current_p1_part_sha256: s.p1_part_sha256,
          previous_cell_binding: s.previous_cell_binding,
          part_bytes_verified: true,
          same_snapshot_verified: true,
          source_row_verified: true,
          metric_literal_verified: true,
          numeric_projection_verified: true,
          fingerprint_codec_verified: true,
          approved_request_scope_sha256: scope.request_scope_sha256,
          approved_request_scope_count: scope.request_scope_count,
          request_scope_binding: approved ? "independent_exact_approved" : "denied",
          source_metric_binding: "approved_recruitment_final_count",
          source_production_allowed: false,
          source_cohort_sha256: R,
          source_cohort_binding: "approved",
          source_announced_groups: ["A", "B"],
          source_announced_groups_binding: "approved",
          target_membership_sha256: H,
          target_membership_binding: "approved",
          target_cell_group_sha256: groupSha,
          target_cell_selection: "single_selection_approved",
          target_cell_selected_observation_id: s.existing_canonical_result_id,
        }, s);
      }));
    },
  };
  async function sync() {
    bytes = new TextEncoder().encode(JSON.stringify(reference));
    pins.approved_reference_sha256 = await bytesSha(bytes);
  }
  await sync();
  return {
    pins,
    selectors,
    rows,
    targets,
    reference,
    port,
    calls,
    sync,
    setAuthorized(value) {
      authorized = value.map((s) => ({ ...s }));
    },
    set transform(x) {
      transform = x;
    },
    set scopeTransform(x) {
      scopeTransform = x;
    },
    run: () => bind(pins, selectors, port),
  };
}
Deno.test("one row: bounded shared budget and distinct Python/v12 fingerprints", async () => {
  const f = await fixture(1), r = await f.run();
  eq(r.action, "REVIEW_ONLY");
  eq(r.results[0].data_team_cell_sha256, PY);
  eq(r.publication_ready, false);
  eq(r.results[0].source_production_allowed, false);
  eq(f.calls.budget.length, 1);
  eq(f.calls.authorize, 1);
  eq(f.calls.read.length, 1);
  eq(f.calls.verify.length, 1);
  const pins = {
    source_head_sha256: H,
    approved_scope_sha256: S,
    authority_sha256: A,
    previous_manifest_sha256: P,
  };
  const row = {
    ...f.selectors[0],
    admission_track: "SYNTH",
    recruit_group: "A",
    identity_variant_index: 7,
    metric_kind: "recruitment_quota_published_stage_unspecified",
    active_service: true,
    observation_id: CID,
    value: "007",
    expected_native_value_sha256: await nativeValueSha256("007"),
    raw_source_row_sha256: R,
    previous_cell: f.rows[0].previous_cell,
  };
  let oldHash = null, approved = r.results[0].service_previous_cell_sha256;
  const authority = {
    async assertLive() {
      await Promise.resolve();
    },
    async verifyBatch(p, items) {
      await Promise.resolve();
      const s = items[0];
      oldHash = s.previous_cell_sha256;
      if (
        oldHash !== approved || s.target_cell_group_sha256 !== r.results[0].target_cell_group_sha256
      ) return [{ disposition: "hold" }];
      return [{
        subject_sha256: s.subject_sha256,
        source_head_sha256: p.source_head_sha256,
        approved_scope_sha256: p.approved_scope_sha256,
        authority_sha256: p.authority_sha256,
        previous_manifest_sha256: p.previous_manifest_sha256,
        previous_cell_sha256: s.previous_cell_sha256,
        previous_cell_binding: "existing_context_review_pending_verified",
        identity_variant_index: 7,
        target_cell_group_sha256: s.target_cell_group_sha256,
        target_cell_selection: "single_selection_approved",
        target_cell_selected_observation_id: CID,
        native_value_sha256: s.native_value_sha256,
        native_value_type: s.native_value_type,
        native_value_json_type: s.native_value_json_type,
        native_value_codec: s.native_value_codec,
        raw_source_row_sha256: R,
        source_snapshot_confirmed: true,
        stage: "final",
        unit: "명",
        source_sha256: Q,
        source_ref: "SYNTH-SOURCE",
        source_url: "https://example.edu/source",
        source_as_of: "2025-01-01",
        source_as_of_kind: "official_announcement_date",
        source_metric_binding: r.results[0].source_metric_binding,
        source_production_allowed: r.results[0].source_production_allowed,
        source_cohort_sha256: r.results[0].source_cohort_sha256,
        source_cohort_binding: "approved",
        source_announced_groups: r.results[0].source_announced_groups,
        source_announced_groups_binding: "approved",
        target_membership_sha256: r.results[0].target_membership_sha256,
        target_membership_binding: "approved",
        disposition: "approved",
      }];
    },
  };
  const out = await prepareRecruitmentFinalCandidates(pins, [row], authority);
  eq(oldHash, approved);
  eq(out.results[0].action, "PROPOSED");
  if (approved === PY) throw Error("distinct fingerprints unexpectedly equal");
  approved = R;
  eq((await prepareRecruitmentFinalCandidates(pins, [row], authority)).results[0].action, "HOLD");
});
Deno.test("36 inputs: one shared-budget read and one issuer batch", async () => {
  const f = await fixture(36), r = await f.run();
  eq(r.action, "REVIEW_ONLY");
  eq(r.results.length, 36);
  eq(r.requested_scope_count, 36);
  eq(r.reference_target_coverage, "ALL_REFERENCE_TARGETS_REQUESTED");
  eq(r.request_scope_authorization, "INDEPENDENTLY_APPROVED_EXACT_REQUEST");
  eq(f.calls.budget.length, 1);
  eq(f.calls.authorize, 1);
  eq(f.calls.read.length, 1);
  eq(f.calls.verify.length, 1);
  eq(f.calls.read[0].count, 36);
  eq(f.calls.read[0].include, true);
  eq(f.calls.verify[0], 36);
});
Deno.test("101 inputs: bounded chunks of 100 and 1 with no per-row fallback", async () => {
  const f = await fixture(101), r = await f.run();
  eq(r.action, "REVIEW_ONLY");
  eq(r.results.length, 101);
  eq(f.calls.authorize, 1);
  eq(f.calls.budget.length, 2);
  eq(f.calls.read.length, 2);
  eq(f.calls.verify.length, 2);
  eq(f.calls.read[0].count, 100);
  eq(f.calls.read[1].count, 1);
  eq(f.calls.read[0].include, true);
  eq(f.calls.read[1].include, false);
  eq(f.calls.budget[0].max_authorization_calls, 1);
  eq(f.calls.budget[1].max_authorization_calls, 0);
  eq(f.calls.verify[0], 100);
  eq(f.calls.verify[1], 1);
  eq(f.calls.read[0].scope, f.calls.read[1].scope);
  eq(r.requested_scope_count, 101);
});
Deno.test("row mismatches and unsupported numeric representations HOLD without fallback", async () => {
  const f = await fixture(4);
  f.rows[0].metric_value_literal = "7e0";
  f.rows[1].numeric_projection.literal = "8";
  f.rows[2].previous_cell.value = 7.0;
  const r = await f.run();
  eq(r.action, "PARTIAL_REVIEW_ONLY");
  eq(r.results[0].action, "HOLD");
  eq(r.results[1].action, "HOLD");
  eq(r.results[2].action, "HOLD");
  eq(r.results[3].action, "BOUND_REVIEW_ONLY");
  eq(f.calls.read.length, 1);
  eq(f.calls.verify.length, 1);
  eq(f.calls.verify[0], 1);
});
Deno.test("duplicates, missing rows, unapproved issuer and changed heads fail closed", async () => {
  const d = await fixture(1), dupe = await bind(d.pins, [d.selectors[0], d.selectors[0]], d.port);
  eq(dupe.action, "HOLD_ALL");
  eq(d.calls.read.length, 0);
  const m = await fixture(1);
  m.port.readTrustedSnapshotBatch = async () => {
    await Promise.resolve();
    return { reference_bytes: new Uint8Array([1]), rows: [] };
  };
  eq((await m.run()).action, "HOLD_ALL");
  const v = await fixture(1);
  v.transform = (p) => ({ ...p, approved_scope_sha256: R });
  eq((await v.run()).results[0].action, "HOLD");
  const h = await fixture(101);
  let live = 0;
  h.port.assertLive = async () => {
    await Promise.resolve();
    if (++live === 3) throw Error("head changed");
  };
  eq((await h.run()).action, "HOLD_ALL");
  eq(h.calls.read.length, 1);
});
Deno.test("budget denial and spoofed reference bytes never fall back", async () => {
  const f = await fixture(1);
  f.port.executeWithSharedBudget = async () => {
    await Promise.resolve();
    throw Error("denied");
  };
  eq((await f.run()).action, "HOLD_ALL");
  eq(f.calls.read.length, 0);
  eq(f.calls.verify.length, 0);
  const denied = await fixture(1);
  denied.port.executeWithSharedBudget = async (_p, _meta, work) => {
    await work();
    return false;
  };
  eq((await denied.run()).action, "HOLD_ALL");
  const b = await fixture(1);
  b.port.readTrustedSnapshotBatch = async (_p, chunk) => {
    await Promise.resolve();
    return { reference_bytes: new Uint16Array(4), rows: chunk.map(() => b.rows[0]) };
  };
  eq((await b.run()).action, "HOLD_ALL");
});
Deno.test("Python Unicode and missing-context vectors need corresponding issuer bindings", async () => {
  const u = await fixture(1);
  u.rows[0].previous_cell.statistic_label = "한글🚀";
  u.targets[0].expected_cell_sha256 = UNICODE;
  await u.sync();
  eq((await u.run()).action, "REVIEW_ONLY");
  const n = await fixture(1);
  n.rows[0].previous_cell.source_context = null;
  n.targets[0].expected_cell_sha256 = NULLCTX;
  n.targets[0].context_case = "NULL_CONTEXT_CANDIDATE";
  await n.sync();
  eq((await n.run()).action, "REVIEW_ONLY");
  n.transform = (p) => ({
    ...p,
    previous_cell_binding: "existing_context_review_pending_verified",
  });
  eq((await n.run()).results[0].action, "HOLD");
});

Deno.test("issuer cohort membership is per-row and conflicting approved cohorts HOLD across chunks", async () => {
  const one = await fixture(2);
  one.transform = (p, s) =>
    s.offering_pk === "TEST-1" ? { ...p, target_membership_binding: "missing" } : p;
  const a = await one.run();
  eq(a.results[0].action, "BOUND_REVIEW_ONLY");
  eq(a.results[1].action, "HOLD");
  for (
    const change of [
      { source_metric_binding: "score" },
      { source_production_allowed: null },
      { source_cohort_binding: "missing" },
      { source_announced_groups: ["B"] },
      { target_membership_sha256: null },
      { target_cell_selection: "missing" },
    ]
  ) {
    const f = await fixture(1);
    f.transform = (p) => ({ ...p, ...change });
    eq((await f.run()).results[0].action, "HOLD");
  }
  const conflict = await fixture(101);
  conflict.transform = (p, s) =>
    s.offering_pk === "TEST-100" ? { ...p, source_cohort_sha256: H } : p;
  const r = await conflict.run();
  eq(r.results.filter((x) => x.action === "HOLD").length, 101);
  eq(conflict.calls.read.length, 2);
  eq(conflict.calls.verify.length, 2);
});

Deno.test("subset requires independent exact approval and never claims full reference coverage", async () => {
  const f = await fixture(2);
  const denied = await bind(f.pins, [f.selectors[0]], f.port);
  eq(denied.action, "HOLD_ALL");
  eq(f.calls.authorize, 1);
  eq(f.calls.read.length, 0);
  eq(f.calls.verify.length, 0);
  f.setAuthorized([f.selectors[0]]);
  const approved = await bind(f.pins, [f.selectors[0]], f.port);
  eq(approved.action, "REVIEW_ONLY");
  eq(approved.requested_scope_count, 1);
  eq(approved.reference_target_count, 2);
  eq(approved.reference_target_coverage, "SUBSET_OR_DIFFERENT");
  eq(approved.request_scope_authorization, "INDEPENDENTLY_APPROVED_EXACT_REQUEST");
});
Deno.test("request scope additions, omissions, tampering and duplicate reference targets fail closed", async () => {
  const f = await fixture(2);
  const unknown = { ...f.selectors[0], offering_pk: "OUTSIDE" };
  eq((await bind(f.pins, [...f.selectors, unknown], f.port)).action, "HOLD_ALL");
  const changed = { ...f.selectors[0], school_id: "OTHER" };
  eq((await bind(f.pins, [changed, f.selectors[1]], f.port)).action, "HOLD_ALL");
  for (
    const patch of [{ approved_request_scope_sha256: R }, { approved_request_scope_count: 9 }, {
      request_scope_binding: "denied",
    }]
  ) {
    const x = await fixture(1);
    x.transform = (p) => ({ ...p, ...patch });
    const r = await x.run();
    eq(r.results[0].action, "HOLD");
    eq(r.request_scope_authorization, "NOT_PROVEN_FOR_ALL");
  }
  const duplicate = await fixture(2);
  duplicate.reference.targets.push({ ...duplicate.targets[0] });
  await duplicate.sync();
  eq((await duplicate.run()).action, "HOLD_ALL");
});

Deno.test("same canonical observation with conflicting approved native values or raw row SHA holds across chunks", async () => {
  const f = await fixture(101);
  f.rows[100].previous_cell.value = "008";
  f.rows[100].metric_value_literal = '"008"';
  f.rows[100].numeric_projection.literal = "8";
  f.targets[100].expected_cell_sha256 = PY_ALT;
  await f.sync();
  const r = await f.run();
  eq(r.results.filter((x) => x.action === "HOLD").length, 101);
  eq(r.results[0].reason_code, "SOURCE_OBSERVATION_CONFLICT");
  eq(f.calls.read.length, 2);
  eq(f.calls.verify.length, 2);
  const broken = await fixture(101);
  broken.rows[100].previous_cell.value = "008";
  broken.rows[100].metric_value_literal = '"008"';
  broken.rows[100].numeric_projection.literal = "8";
  broken.targets[100].expected_cell_sha256 = PY_ALT;
  await broken.sync();
  broken.transform = (p, s) =>
    s.offering_pk === "TEST-100" ? { ...p, target_membership_binding: "missing" } : p;
  const b = await broken.run();
  eq(b.results.filter((x) => x.action === "BOUND_REVIEW_ONLY").length, 100);
  eq(b.results[100].action, "HOLD");
  const raw = await fixture(2);
  raw.rows[1].raw_source_row_sha256 = H;
  const q = await raw.run();
  eq(q.results.filter((x) => x.action === "HOLD").length, 2);
});

Deno.test("independent scope authorization rejects before any read when absent or tampered", async () => {
  for (
    const patch of [
      { disposition: "hold" },
      { authority_sha256: R },
      { approved_reference_sha256: R },
      { current_source_head_sha256: R },
      { current_p1_manifest_sha256: R },
      { approved_scope_sha256: R },
      { approved_request_scope_sha256: R },
      { approved_request_scope_count: 9 },
      { request_scope_binding: "denied" },
    ]
  ) {
    const f = await fixture(1);
    f.scopeTransform = (p) => ({ ...p, ...patch });
    const r = await f.run();
    eq(r.action, "HOLD_ALL");
    eq(f.calls.authorize, 1);
    eq(f.calls.read.length, 0);
    eq(f.calls.verify.length, 0);
  }
  const absent = await fixture(1);
  delete absent.port.authorizeRequestScope;
  eq((await absent.run()).action, "HOLD_ALL");
  eq(absent.calls.read.length, 0);
  const falseProof = await fixture(1);
  falseProof.port.authorizeRequestScope = () => Promise.resolve(false);
  eq((await falseProof.run()).action, "HOLD_ALL");
  eq(falseProof.calls.read.length, 0);
});
