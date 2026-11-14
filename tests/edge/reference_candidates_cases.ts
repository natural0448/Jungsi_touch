import { personalResultComponents } from "../../supabase/functions/_shared/jungsi/application/paid_result_components.ts";
import { assert, equal } from "./fixture.ts";
import { referenceCandidateGroups } from "../../supabase/functions/_shared/jungsi/application/reference_candidates.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
const row: NativeObject = {
  offering_id: "SYNTHETIC-o",
  university_id: "SYNTHETIC-u",
  university_name: "SYNTHETIC-name",
};
function result(): NativeObject {
  return {
    status: "pending",
    conversion: { reason_code: "reference_conversion_not_production_approved" },
    reference_percentile: {
      status: "reference_estimated",
      metric: "estimated_upper_cumulative_percent_all_examinees",
      estimated_upper_cumulative_percent_all_examinees: "30.5",
      production_allowed: false,
      actual_admission_full_total_approved: false,
      calculation_review_scope: "same_exam_mathematical_reference",
      internal_secret: "never-public",
    },
  };
}
Deno.test("reference candidates remain unranked and never become an admission decision", () => {
  const view = referenceCandidateGroups([row, row], { "SYNTHETIC-o": result() });
  equal(view.status, "reference_only");
  equal(view.judgment_status, "pending");
  const groups = view.university_groups as NativeObject[];
  equal(groups.length, 1);
  const items = groups[0].offerings as NativeObject[];
  equal(items.length, 1);
  assert(!JSON.stringify(view).includes("internal_secret"));
  assert(!JSON.stringify(view).includes("challenge"));
});
Deno.test("reference candidates exclude invalid, ineligible, unverified and out-of-range data", () => {
  for (
    const change of [{ status: "ineligible" }, {
      reference_percentile: { status: "reference_estimated", production_allowed: true },
    }, {
      reference_percentile: {
        status: "reference_estimated",
        metric: "estimated_upper_cumulative_percent_all_examinees",
        estimated_upper_cumulative_percent_all_examinees: "101",
        production_allowed: false,
        actual_admission_full_total_approved: false,
      },
    }] as NativeObject[]
  ) {
    const a = { ...result(), ...change };
    equal(
      (referenceCandidateGroups([row], { "SYNTHETIC-o": a }).university_groups as NativeObject[])
        .length,
      0,
    );
  }
});

Deno.test("reference candidates remain protected personal report components", () => {
  const view = referenceCandidateGroups([row], { "SYNTHETIC-o": result() });
  const report = { candidates: { reference_university_groups: view.university_groups } };
  assert(personalResultComponents(report).includes("candidates"));
  const one = (view.university_groups as NativeObject[])[0];
  const item = (one.offerings as NativeObject[])[0];
  (item.reference_percentile as NativeObject).estimated_upper_cumulative_percent_all_examinees =
    "0";
  assert(personalResultComponents(report).includes("candidates"));
});
