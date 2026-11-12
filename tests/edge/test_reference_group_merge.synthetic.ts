import { assert, equal } from "./fixture.ts";
import {
  mergeReferenceGroups,
  referenceGroupsContain,
} from "../../supabase/functions/_shared/jungsi/application/reference_group_merge.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
const row = (id: string, value: string) => ({
  offering: { offering_id: id },
  reference_percentile: {
    status: "reference_estimated",
    estimated_upper_cumulative_percent_all_examinees: value,
    metric: "estimated_upper_cumulative_percent_all_examinees",
    calculation_review_scope: "same_exam_mathematical_reference",
    production_allowed: false,
    actual_admission_full_total_approved: false,
  },
});
Deno.test("old and other universities' new reference groups coexist without replacing old values", () => {
  const old = [{ university_id: "u1", university_name: "old", offerings: [row("old", "10")] }];
  const fresh = [{ university_id: "u2", university_name: "new", offerings: [row("new", "20")] }];
  const combined = mergeReferenceGroups(old, fresh);
  assert(combined);
  equal(combined.length, 2);
  assert(referenceGroupsContain(old, combined));
  equal(nativeJsonText(combined[0], true), nativeJsonText(fresh[0], true));
});
Deno.test("old reference row is preserved even when same offering is recalculated", () => {
  const old = [{ university_id: "u", university_name: "name", offerings: [row("old", "10")] }];
  const fresh = [{
    university_id: "u",
    university_name: "name",
    offerings: [row("old", "99"), row("new", "20")],
  }];
  const combined = mergeReferenceGroups(old, fresh);
  assert(combined);
  assert(referenceGroupsContain(old, combined));
  const offerings = combined[0].offerings as NativeObject[];
  equal(
    (offerings[0].reference_percentile as NativeObject)
      .estimated_upper_cumulative_percent_all_examinees,
    "10",
  );
  equal(offerings.length, 2);
});
Deno.test("changed university metadata holds only that group and duplicate IDs fail closed", () => {
  const old = [{ university_id: "u", university_name: "name", offerings: [row("old", "10")] }];
  const result = mergeReferenceGroups(old, [{
    university_id: "u",
    university_name: "changed",
    offerings: [row("new", "20")],
  }, { university_id: "v", university_name: "other", offerings: [row("other", "30")] }]);
  assert(result);
  equal(result.length, 2);
  assert(referenceGroupsContain(old, result));
  equal((result.find((g) => g.university_id === "v")!.offerings as NativeObject[]).length, 1);
  assert(
    mergeReferenceGroups(old, [{
      university_id: "v",
      university_name: "name",
      offerings: [row("new", "20"), row("new", "30")],
    }]) === null,
  );
});
