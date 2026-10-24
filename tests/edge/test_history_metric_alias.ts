import { assert, equal } from "./fixture.ts";
import {
  currentHistoryServiceItem,
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
Deno.test("strong final-rank aliases link to one existing P1 slot without changing API legacy keys", () => {
  for (
    const label of ["최종충원순위", "충원합격순위", "최종합격자 예비번호", "마지막 합격 후보순위"]
  ) {
    equal(
      p1MetricSlotAlias("final_waitlist_rank", label, scope).slot,
      "final_additional_admission_rank",
    );
    equal(
      p1MetricSlotAlias("final_waitlist_rank", label, scope).serviceLabel,
      "최종 합격 예비번호",
    );
  }
  equal(
    currentHistoryServiceItem("final_additional_admission_rank", "최종충원순위", scope),
    "final_additional_admission_rank",
  );
  equal(
    currentHistoryServiceItem("additional_admission_rank", "최종충원순위", scope),
    "additional_admission_rank",
  );
});
Deno.test("ambiguous replenishment and waiting labels remain unresolved without field definition evidence", () => {
  for (
    const label of [
      "충원인원",
      "추가모집인원",
      "추가합격인원",
      "합격대기번호",
      "추가합격 인원(예비순위)",
    ]
  ) {
    equal(p1MetricSlotAlias(null, label, scope).slot, null);
  }
});
Deno.test("officially defined additional acceptance persons provisional-rank wording maps to rank only in exact evidence scope", () => {
  const label = "추가합격 인원(예비순위)", before = JSON.stringify(scope), p = proof(label);
  equal(p1MetricSlotAlias(null, label, scope, p).slot, "final_additional_admission_rank");
  equal(p1MetricSlotAlias(null, label, scope, p).serviceLabel, "최종 합격 예비번호");
  equal(JSON.stringify(scope), before);
});
Deno.test("additional accepted persons and separate recruitment quotas and initial rank stay distinct", () => {
  equal(
    p1MetricSlotAlias(
      null,
      "추가합격인원",
      scope,
      proof("추가합격인원", "additional_admission_count"),
    ).slot,
    "additional_admission_count",
  );
  equal(
    p1MetricSlotAlias(
      null,
      "추가모집인원",
      scope,
      proof("추가모집인원", "separate_recruitment_quota"),
    ).slot,
    null,
  );
  equal(
    p1MetricSlotAlias(null, "합격대기번호", scope, proof("합격대기번호", "initial_waitlist_number"))
      .slot,
    null,
  );
});
Deno.test("same raw label never transfers proof across year PK CID cohort score-axis scope or publication round", () => {
  for (
    const field of [
      "observation_id",
      "academic_year",
      "offering_id",
      "cohort",
      "score_basis",
      "score_scope",
      "source_round",
    ] as const
  ) {
    const changed = { ...scope, [field]: field === "academic_year" ? 2026 : "SYNTHETIC-other" };
    equal(p1MetricSlotAlias(null, "충원인원", changed, proof("충원인원")).slot, null);
  }
});
Deno.test("strong alias conflicting with count or stale definition is rejected without moving a value", () => {
  equal(p1MetricSlotAlias("additional_admission_count", "최종충원순위", scope).slot, null);
  equal(p1MetricSlotAlias(null, "충원인원", scope, proof("추가모집인원")).slot, null);
});
Deno.test("50 70 75 cuts and mean keep distinct source statistics and original API keys", () => {
  const slots = [];
  for (const n of [50, 70, 75]) {
    const s = { ...scope, statistic_percent: n }, label = String(n) + "%";
    slots.push(p1MetricSlotAlias("score_cut", label, s, proof(label, "score_cut", s)).slot);
    equal(
      p1MetricSlotAlias(
        "score_cut",
        label,
        { ...s, statistic_percent: n + 1 },
        proof(label, "score_cut", s),
      ).slot,
      null,
    );
  }
  equal(slots, ["final_50_percent_cut", "final_70_percent_cut", "alternate_cut"]);
  const mean = p1MetricSlotAlias("mean_score", "평균", scope, proof("평균", "mean_score"));
  equal(mean.slot, "alternate_cut");
  equal(mean.serviceLabel, "평균 성적");
  equal(
    currentHistoryServiceItem(
      "final_75_percent_cut",
      "75%",
      { ...scope, statistic_percent: 75 },
      proof("75%", "score_cut", { ...scope, statistic_percent: 75 }),
    ),
    "final_75_percent_cut",
  );
});
Deno.test("malformed or unreviewed evidence remains a reasoned alias hold", () => {
  for (
    const p of [{ ...proof("충원인원"), scope: undefined }, {
      ...proof("충원인원"),
      status: "pending",
    }, { ...proof("충원인원"), definition_sha256: "bad" }]
  ) {
    const r = p1MetricSlotAlias(null, "충원인원", scope, p as unknown as HistoryAliasEvidence);
    equal(r.slot, null);
    assert(r.reason !== null);
  }
});
