import { reviewHistoryScoreContexts as review } from "../../supabase/functions/_shared/jungsi/application/history_score_context_review.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
const A = (v) => {
  if (!v) throw Error("assertion_failed");
};
const eq = (a, b) => A(Object.is(a, b));
const H = "a".repeat(64), D = "b".repeat(64), S = "c".repeat(64), I = "d".repeat(64);
const pins = { source_head_sha256: H, descriptor_sha256: D, scope_sha256: S, authority_sha256: I };
const obs = (n) => "observation:" + n.toString(16).padStart(64, "0");
function row(n = 1) {
  return {
    observation_id: obs(n),
    p1_row_academic_year: 2024,
    original_pk: "P" + n,
    source_school_id: "S1",
    target_school_id: "S1",
    target_admission_year: 2025,
    formula_school_id: "S1",
    source_result_year: 2024,
    score_basis_academic_year: 2025,
    department_label_reference_year: 2025,
    source_population_note: "synthetic source population",
    source_group: "A",
    display_group: "B",
    production_allowed: false,
    value: new JsonFloat("1.500"),
  };
}
function fixture(override = () => ({})) {
  const calls = { live: 0, batch: 0 };
  const authority = {
    async assertLive() {
      await Promise.resolve();
      calls.live++;
    },
    async verifyBatch(p, subjects) {
      await Promise.resolve();
      calls.batch++;
      A(Object.isFrozen(subjects));
      return subjects.map((s) => ({
        subject_sha256: s.subject_sha256,
        source_head_sha256: p.source_head_sha256,
        descriptor_sha256: p.descriptor_sha256,
        scope_sha256: p.scope_sha256,
        authority_sha256: p.authority_sha256,
        disposition: "approved",
        source_observation_verified: true,
        source_observation_sha256: H,
        source_original_file_sha256: D,
        source_original_cell_sha256: S,
        source_cell_match_status: "matched_original_cell",
        target_identity_verified: true,
        target_membership_verified: true,
        target_membership_sha256: H,
        source_population_verified: true,
        source_population_sha256: D,
        formula_source_verified: true,
        formula_source_sha256: S,
        department_label_year_verified: true,
        department_label_evidence_sha256: I,
        group_compatibility_verified: true,
        group_evidence_sha256: H,
        ...override(s),
      }));
    },
  };
  return { calls, authority, run: (rows) => review(pins, rows, authority) };
}
Deno.test("later formula and target remain distinct from source cohort; false is preserved", async () => {
  const f = fixture(), input = row(), [r] = await f.run([input]);
  eq(r.action, "REFERENCE_CANDIDATE");
  eq(r.target_slot, "alternate");
  eq(r.source_production_allowed, false);
  eq(r.publication_ready, false);
  eq(r.score_calculation_context.source_result_year, 2024);
  eq(r.score_calculation_context.score_calculation_year, 2025);
  eq(r.score_calculation_context.observation_role, "prior_year_recalculated_reference");
  eq(r.publication_context.publication_role, "unresolved");
  eq(r.publication_context.simulation_target_academic_year, null);
  eq(r.target_admission_year, 2025);
  eq(r.department_label_reference_year, 2025);
  eq(r.source_population_note, input.source_population_note);
  eq(r.source_group, "A");
  eq(r.display_group, "B");
  A(r.value instanceof JsonFloat);
  eq(r.value.lexeme, "1.500");
  eq(input.value.lexeme, "1.500");
  eq(input.production_allowed, false);
  eq(f.calls.batch, 1);
  eq(f.calls.live, 2);
});
Deno.test("same school PK or group spelling never replaces independent group and population proof", async () => {
  const a = row(1), b = row(2);
  a.display_group = a.source_group;
  const f = fixture((s) =>
    s.observation_id === a.observation_id ? { group_compatibility_verified: false } : {}
  );
  const [x, y] = await f.run([a, b]);
  eq(x.action, "HOLD");
  eq(x.source_production_allowed, false);
  eq(y.action, "REFERENCE_CANDIDATE");
  const g = fixture(() => ({ source_population_verified: false }));
  eq((await g.run([a]))[0].action, "HOLD");
});
Deno.test("foreign formula is never promoted to actual even in the same year", async () => {
  const input = {
    ...row(),
    formula_school_id: "S2",
    target_admission_year: 2024,
    score_basis_academic_year: 2024,
    department_label_reference_year: 2024,
  };
  const [r] = await fixture().run([input]);
  eq(r.action, "REFERENCE_CANDIDATE");
  eq(r.target_slot, "alternate");
  eq(r.source_school_id, "S1");
  eq(r.target_school_id, "S1");
  eq(r.formula_school_id, "S2");
  eq(r.score_calculation_context.observation_role, "unresolved");
  eq(r.publication_context.publication_role, "unresolved");
  eq(r.source_production_allowed, false);
});
Deno.test("missing source facts or false row-to-cohort relation hold only those rows", async () => {
  const missing = row(1);
  delete missing.score_basis_academic_year;
  const noCohort = { ...row(2), source_population_note: null };
  const mismatch = { ...row(3), source_result_year: 2023 };
  const [a, b, c, d] = await fixture().run([missing, noCohort, mismatch, row(4)]);
  for (const x of [a, b, c]) {
    eq(x.action, "HOLD");
    eq(x.source_production_allowed, false);
  }
  eq(d.action, "REFERENCE_CANDIDATE");
});
Deno.test("same-year actual stays HOLD without publication purpose and exact target slot", async () => {
  const base = {
    ...row(),
    target_admission_year: 2024,
    score_basis_academic_year: 2024,
    department_label_reference_year: 2024,
    source_group: "A",
    display_group: "A",
    value: 0,
  };
  const [a, b] = await fixture().run([{ ...base, production_allowed: true }, {
    ...base,
    observation_id: obs(2),
    original_pk: "P2",
    production_allowed: false,
  }]);
  eq(a.action, "HOLD");
  eq(a.reason_code, "PUBLICATION_PURPOSE_OR_TARGET_SLOT_UNPROVEN");
  eq(base.value, 0);
  eq(a.publication_ready, false);
  eq(b.action, "HOLD");
  eq(b.source_production_allowed, false);
});
Deno.test("missing or unrepresentable value does not become zero", async () => {
  const [a, b] = await fixture().run([{ ...row(1), value: null }, { ...row(2), value: true }]);
  eq(a.action, "HOLD");
  eq(a.reason_code, "SOURCE_VALUE_MISSING");
  eq(b.action, "HOLD");
  eq(b.source_production_allowed, false);
});
Deno.test("changed head and malformed proof hold affected rows only", async () => {
  const f = fixture((s) =>
    s.observation_id === obs(1) ? { source_head_sha256: "e".repeat(64) } : {}
  );
  const [a, b] = await f.run([row(1), row(2)]);
  eq(a.action, "HOLD");
  eq(b.action, "REFERENCE_CANDIDATE");
});
Deno.test("duplicate observation does not choose a winner or block a separate row", async () => {
  const [a, b, c] = await fixture().run([row(1), row(1), row(2)]);
  eq(a.action, "HOLD");
  eq(b.action, "HOLD");
  eq(c.action, "REFERENCE_CANDIDATE");
});

Deno.test("each independent source target formula population and group claim is required per observation", async () => {
  for (
    const flag of [
      "source_observation_verified",
      "target_identity_verified",
      "target_membership_verified",
      "source_population_verified",
      "formula_source_verified",
      "department_label_year_verified",
      "group_compatibility_verified",
    ]
  ) {
    const f = fixture((s) => s.observation_id === obs(1) ? { [flag]: false } : {});
    const [a, b] = await f.run([row(1), row(2)]);
    eq(a.action, "HOLD");
    eq(a.source_production_allowed, false);
    eq(b.action, "REFERENCE_CANDIDATE");
  }
});
Deno.test("revoked authority never returns accumulated candidate rows", async () => {
  const f = fixture();
  let count = 0;
  f.authority.assertLive = async () => {
    await Promise.resolve();
    if (++count === 2) throw Error("synthetic_revoked");
  };
  let caught = null;
  try {
    await f.run([row()]);
  } catch (error) {
    caught = error;
  }
  A(caught instanceof Error);
  eq(caught.message, "synthetic_revoked");
});

Deno.test("one source observation can support independently verified distinct targets without duplication", async () => {
  const a = row(1), b = { ...row(2), observation_id: a.observation_id, display_group: "C" };
  const [x, y] = await fixture().run([a, b]);
  eq(x.action, "REFERENCE_CANDIDATE");
  eq(y.action, "REFERENCE_CANDIDATE");
  eq(x.observation_id, y.observation_id);
  eq(x.original_pk, "P1");
  eq(y.original_pk, "P2");
  eq(x.source_production_allowed, false);
  eq(y.source_production_allowed, false);
  eq(x.evidence.target_membership_sha256, H);
});
Deno.test("unapproved conflicting member does not suppress an approved member", async () => {
  const a = row(1),
    b = {
      ...row(2),
      observation_id: a.observation_id,
      source_population_note: "different synthetic population",
    };
  const f = fixture((s) => s.original_pk === "P2" ? { target_membership_verified: false } : {});
  const [x, y] = await f.run([a, b]);
  eq(x.action, "REFERENCE_CANDIDATE");
  eq(y.action, "HOLD");
});
Deno.test("approved conflicting source value or cohort holds every member of only that observation", async () => {
  for (
    const change of [{ value: new JsonFloat("9.500") }, {
      source_population_note: "different synthetic population",
    }]
  ) {
    const a = row(1), b = { ...row(2), ...change, observation_id: a.observation_id };
    const [x, y, z] = await fixture().run([a, b, row(3)]);
    eq(x.action, "HOLD");
    eq(x.reason_code, "SOURCE_OBSERVATION_EVIDENCE_CONFLICT");
    eq(y.action, "HOLD");
    eq(z.action, "REFERENCE_CANDIDATE");
  }
});
Deno.test("relation and source proof hashes must be present independently for each target", async () => {
  for (
    const field of [
      "source_observation_sha256",
      "target_membership_sha256",
      "source_population_sha256",
      "formula_source_sha256",
      "department_label_evidence_sha256",
      "group_evidence_sha256",
    ]
  ) {
    const f = fixture((s) => s.original_pk === "P1" ? { [field]: null } : {});
    const [x, y] = await f.run([row(1), row(2)]);
    eq(x.action, "HOLD");
    eq(y.action, "REFERENCE_CANDIDATE");
  }
});

Deno.test("current view missing year values and null PK remain HOLD without inventing source values", async () => {
  const unresolved = { ...row(1), original_pk: null, production_allowed: false };
  delete unresolved.score_basis_academic_year;
  delete unresolved.department_label_reference_year;
  const typePresence = {
    score_basis_academic_year: "integer",
    department_label_reference_year: "integer",
  };
  const f = fixture();
  const [a, b] = await f.run([unresolved, row(2)]);
  eq(typePresence.score_basis_academic_year, "integer");
  eq(a.action, "HOLD");
  eq(a.source_production_allowed, false);
  eq(b.action, "REFERENCE_CANDIDATE");
  eq(unresolved.original_pk, null);
  A(!Object.hasOwn(unresolved, "score_basis_academic_year"));
  A(!Object.hasOwn(unresolved, "department_label_reference_year"));
  eq(f.calls.batch, 1);
});

Deno.test("row descriptor exceptions hold that row without suppressing a healthy row", async () => {
  const invalid = new Proxy(row(1), {
    getOwnPropertyDescriptor() {
      throw Error("synthetic_descriptor_error");
    },
  });
  const f = fixture(), [a, b] = await f.run([invalid, row(2)]);
  eq(a.action, "HOLD");
  eq(b.action, "REFERENCE_CANDIDATE");
});
Deno.test("P1 text length accepts 1024 and holds 1025 without truncation", async () => {
  const [a, b, c] = await fixture().run([
    { ...row(1), value: "7".repeat(1024) },
    { ...row(2), value: "7".repeat(1025) },
    row(3),
  ]);
  eq(a.action, "REFERENCE_CANDIDATE");
  eq(a.value.length, 1024);
  eq(b.action, "HOLD");
  eq(b.source_production_allowed, false);
  eq(c.action, "REFERENCE_CANDIDATE");
});
Deno.test("unmatched source cell and absent original file or cell hash hold affected rows", async () => {
  for (
    const patch of [
      { source_cell_match_status: "difference_pending" },
      { source_original_file_sha256: null },
      { source_original_cell_sha256: null },
    ]
  ) {
    const f = fixture((s) => s.original_pk === "P1" ? patch : {});
    const [a, b] = await f.run([row(1), row(2)]);
    eq(a.action, "HOLD");
    eq(a.source_production_allowed, false);
    eq(b.action, "REFERENCE_CANDIDATE");
  }
});
Deno.test("synthetic 58-row metadata gaps and one unverified cell never acquire invented values", async () => {
  const rows = Array.from({ length: 58 }, (_, i) => row(i + 1));
  for (let i = 0; i < 37; i++) delete rows[i].department_label_reference_year;
  for (let i = 0; i < 20; i++) delete rows[i].score_basis_academic_year;
  const f = fixture((s) =>
    s.observation_id === obs(38) ? { source_cell_match_status: "difference_pending" } : {}
  );
  const result = await f.run(rows);
  eq(result.length, 58);
  eq(result.filter((x) => x.action === "HOLD").length, 38);
  eq(result.filter((x) => x.action === "REFERENCE_CANDIDATE").length, 20);
  A(result.every((x) => x.source_production_allowed === false));
  A(!Object.hasOwn(rows[0], "score_basis_academic_year"));
  A(!Object.hasOwn(rows[0], "department_label_reference_year"));
  eq(result[37].action, "HOLD");
});

Deno.test("three target members hold when original population and cohort are missing", async () => {
  const rows = ["SYN-P1", "SYN-P2", "SYN-P3"].map((pk) => ({
    ...row(),
    original_pk: pk,
    source_population_note: null,
    source_group: null,
    display_group: null,
  }));
  const f = fixture(), got = await f.run(rows);
  eq(got.length, 3);
  eq(f.calls.batch, 0);
  for (const item of got) {
    eq(item.action, "HOLD");
    eq(item.reason_code, "SOURCE_CONTEXT_MISSING_OR_INVALID");
    eq(item.source_production_allowed, false);
    eq(item.publication_ready, false);
    eq(Object.hasOwn(item, "value"), false);
  }
  for (const item of rows) {
    eq(item.source_population_note, null);
    eq(item.source_group, null);
    eq(Object.hasOwn(item, "cohort"), false);
  }
});

Deno.test("partial source population cannot promote three members to whole group", async () => {
  const rows = ["SYN-P1", "SYN-P2", "SYN-P3"].map((pk) => ({
    ...row(),
    original_pk: pk,
    source_population_note: "SYNTHETIC partial faculty population",
    source_group: null,
    display_group: null,
  }));
  const control = { ...row(2), original_pk: "SYN-CONTROL" };
  const f = fixture((s) =>
    s.observation_id === obs(1)
      ? {
        source_population_verified: false,
        target_membership_verified: false,
        group_compatibility_verified: false,
      }
      : {}
  );
  const got = await f.run([...rows, control]);
  eq(f.calls.batch, 1);
  for (const item of got.slice(0, 3)) {
    eq(item.action, "HOLD");
    eq(item.reason_code, "SOURCE_OR_SCOPE_UNVERIFIED");
    eq(item.source_production_allowed, false);
    eq(item.publication_ready, false);
    eq(Object.hasOwn(item, "target_slot"), false);
  }
  eq(got[3].action, "REFERENCE_CANDIDATE");
  eq(got[3].target_slot, "alternate");
  eq(got[3].source_production_allowed, false);
  eq(got[3].publication_ready, false);
  eq(got[3].publication_context.publication_role, "unresolved");
});
