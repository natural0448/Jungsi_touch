import { equal } from "./fixture.ts";
import {
  type HistoryAliasEvidence,
  type HistoryAliasScope,
  p1MetricSlotAlias,
} from "../../supabase/functions/_shared/jungsi/application/history_metric_alias.ts";
const scope: HistoryAliasScope = {
  observation_id: "SYNTHETIC-observation",
  academic_year: 2027,
  offering_id: "SYNTHETIC-offering",
  cohort: "SYNTHETIC-final-registrants",
  score_basis: "SYNTHETIC-native",
  score_scope: "csat_component",
  source_round: "SYNTHETIC-final",
  statistic_percent: null,
};
function proof(
  label: string,
  family: HistoryAliasEvidence["family"] = "final_waitlist_rank",
  s = scope,
): HistoryAliasEvidence {
  return {
    status: "meaning_verified",
    definition_sha256: "a".repeat(64),
    source_label: label,
    family,
    scope: s,
  };
}
Deno.test("ambiguous admitted-count wording needs exact evidence for each synthetic rank candidate", () => {
  const kind = "additional_admitted_count", label = "추합자수";
  const subjects = ["A", "B"].map((suffix) => ({
    ...scope,
    observation_id: `SYNTHETIC-observation-${suffix}`,
    offering_id: `SYNTHETIC-offering-${suffix}`,
  }));
  // This fixture supplies placeholder evidence; the helper does not verify its truth.
  const evidence = subjects.map((s) => proof(label, "final_waitlist_rank", s));
  for (const [index, subject] of subjects.entries()) {
    const noEvidence = p1MetricSlotAlias(kind, label, subject);
    equal(noEvidence.slot, null);
    equal(noEvidence.reason, "semantic_alias_definition_required");
    equal(
      p1MetricSlotAlias(kind, label, subject, evidence[index]).slot,
      "final_additional_admission_rank",
    );
    const swapped = p1MetricSlotAlias(kind, label, subject, evidence[1 - index]);
    equal(swapped.slot, null);
    equal(swapped.reason, "semantic_alias_evidence_mismatch");
    const canonicalCount = p1MetricSlotAlias(
      "additional_admission_count",
      label,
      subject,
      evidence[index],
    );
    equal(canonicalCount.slot, null);
    equal(canonicalCount.reason, "semantic_alias_evidence_mismatch");
  }
});
