import { reviewHistoryScoreContexts } from "../../supabase/functions/_shared/jungsi/application/history_score_context_review.ts";
import { validateHistorySnapshotPayload } from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
const eq = (a, b) => {
  if (!Object.is(a, b)) throw Error("assert_equal");
};
const H = "a".repeat(64), D = "b".repeat(64), S = "c".repeat(64), I = "d".repeat(64);
const observation_id = "observation:" + "e".repeat(64);
const pins = { source_head_sha256: H, descriptor_sha256: D, scope_sha256: S, authority_sha256: I };
const source = {
  observation_id,
  p1_row_academic_year: 2024,
  original_pk: "P1",
  source_school_id: "S1",
  target_school_id: "S1",
  target_admission_year: 2025,
  formula_school_id: "S1",
  source_result_year: 2024,
  score_basis_academic_year: 2025,
  department_label_reference_year: 2025,
  source_population_note: "synthetic population",
  source_group: "A",
  display_group: "B",
  production_allowed: false,
  value: "001.50",
};
const authority = {
  async assertLive() {
    await Promise.resolve();
  },
  async verifyBatch(p, subjects) {
    await Promise.resolve();
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
    }));
  },
};
Deno.test("alternate context from separate source axes is accepted by unchanged P1 validator", async () => {
  const [candidate] = await reviewHistoryScoreContexts(pins, [source], authority);
  eq(candidate.action, "REFERENCE_CANDIDATE");
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
  const entry = {
    ...cut(),
    value: candidate.value,
    unit: "point",
    status: "pending_metadata",
    reason_code: "SYNTHETIC_REFERENCE_HOLD",
    statistic_label: "synthetic reference",
    source_context: { observation_id, identity_variant_index: 0, scope_status: "review_pending" },
    score_calculation_context: candidate.score_calculation_context,
    publication_context: candidate.publication_context,
  };
  const row = {
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
        admission_track: "synthetic",
        group: "A",
      }],
    },
    university_id: "S1",
    university_name: "Synthetic",
    region: null,
    campus: null,
    department: "Synthetic",
    admission_track: "synthetic",
    group: "A",
    recruitment_count_with_stage: { ...blank(), stage: "unspecified" },
    competition_ratio: blank(),
    additional_admission_count: blank(),
    final_additional_admission_rank: blank(),
    final_50_percent_cut: cut(),
    final_70_percent_cut: cut(),
    alternate_cut: { ...cut(), entries: [entry], omitted_other_basis_count: 0 },
  };
  const body = {
    format: "jungsi.history-snapshot/v1",
    payload_id: "synthetic-payload",
    part_id: "synthetic-part",
    rows: [row],
  };
  for (
    const [key, value] of [["department_label_reference_year", 2025], [
      "source_population_note",
      "SYNTHETIC unknown cohort",
    ]]
  ) {
    const changed = structuredClone(body);
    changed.rows[0].alternate_cut.entries[0][key] = value;
    let rejected = false;
    try {
      validateHistorySnapshotPayload(changed, {
        partId: "synthetic-part",
        payloadId: "synthetic-payload",
        rows: 1,
        mappedRows: 1,
        mappingPendingRows: 0,
      });
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("unexpected_schema_extension");
  }
  const checked = validateHistorySnapshotPayload(body, {
    partId: "synthetic-part",
    payloadId: "synthetic-payload",
    rows: 1,
    mappedRows: 1,
    mappingPendingRows: 0,
  });
  const got = checked.rows[0];
  eq(got.alternate_cut.entries[0].cohort, null);
  eq(got.academic_year, 2024);
  eq(got.group, "A");
  eq(got.alternate_cut.entries[0].value, "001.50");
  eq(got.alternate_cut.entries[0].score_calculation_context.score_calculation_year, 2025);
  eq(got.alternate_cut.entries[0].publication_context.publication_role, "unresolved");
  eq(source.production_allowed, false);
});
