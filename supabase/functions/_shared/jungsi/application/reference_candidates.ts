/** Build an unranked reference-only view from an already authorized, bounded catalog. */
import { offeringDto } from "./catalog.ts";
import { exact } from "../domain/exact.ts";
import { type NativeJson } from "../domain/native_json.ts";
import { type NativeObject } from "../domain/json_value.ts";
function object(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
/** 상한은 숫자 문자열이고 하한 이상·100 이하일 때만 넘긴다(아니면 뺀다) */
function upperOk(n: string, u: unknown): boolean {
  if (typeof u !== "string" || !/^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$/.test(u)) return false;
  try {
    return exact(u).compare(exact(n)) >= 0 && exact(u).compare(exact(100)) <= 0;
  } catch {
    return false;
  }
}
/** This does not fetch rows, create eligibility, rank applicants or authorize delivery. */
export function referenceCandidateGroups(
  rows: readonly NativeObject[],
  analyses: Readonly<NativeObject>,
): NativeObject {
  const groups = new Map<string, NativeObject>(), seen = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.offering_id !== "string" || seen.has(row.offering_id) ||
      typeof row.university_id !== "string"
    ) continue;
    seen.add(row.offering_id);
    const a = analyses[row.offering_id];
    if (
      !object(a) || a.status !== "pending" || !object(a.conversion) ||
      a.conversion.reason_code !== "reference_conversion_not_production_approved" ||
      !object(a.reference_percentile)
    ) continue;
    const p = a.reference_percentile,
      n = p.estimated_upper_cumulative_percent_all_examinees,
      u = p.estimated_upper_cumulative_percent_upper_bound;
    if (
      p.status !== "reference_estimated" || p.production_allowed !== false ||
      p.actual_admission_full_total_approved !== false ||
      p.calculation_review_scope !== "same_exam_mathematical_reference" ||
      p.metric !== "estimated_upper_cumulative_percent_all_examinees" ||
      typeof n !== "string" || !/^(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$/.test(n)
    ) continue;
    try {
      if (exact(n).compare(exact(0)) < 0 || exact(n).compare(exact(100)) > 0) continue;
    } catch {
      continue;
    }
    let group = groups.get(row.university_id);
    if (!group) {
      group = {
        university_id: row.university_id,
        university_name: row.university_name ?? null,
        offerings: [],
      };
      groups.set(row.university_id, group);
    }
    (group.offerings as NativeJson[]).push({
      offering: offeringDto(row),
      reference_percentile: {
        status: "reference_estimated",
        estimated_upper_cumulative_percent_all_examinees: n,
        ...(upperOk(n, u) ? { estimated_upper_cumulative_percent_upper_bound: u as string } : {}),
        metric: p.metric,
        calculation_review_scope: "same_exam_mathematical_reference",
        production_allowed: false,
        actual_admission_full_total_approved: false,
      },
    });
  }
  return {
    status: "reference_only",
    judgment_status: "pending",
    university_groups: [...groups.values()],
  };
}
