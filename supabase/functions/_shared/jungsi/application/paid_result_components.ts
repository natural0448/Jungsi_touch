/** Classify only declared personal numerical fields after public projection. */
import type { NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
export function resultObject(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function numeric(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) || typeof v === "bigint" ||
    typeof v === "string" && /^[+-]?[0-9]+(?:\.[0-9]+)?(?:\/[1-9][0-9]*)?$/.test(v) ||
    v instanceof JsonFloat;
}
export function personalAssessment(v: unknown): boolean {
  if (!resultObject(v)) return false;
  return numeric(v.converted_score) ||
    resultObject(v.conversion) && v.conversion.status === "ready" &&
      numeric(v.conversion.converted_score) ||
    resultObject(v.percentile) && v.percentile.status === "ready" &&
      numeric(v.percentile.top_percent);
}
function candidateNumbers(v: unknown): boolean {
  if (!resultObject(v)) return false;
  for (const key of ["basic_university_groups", "wildcards"]) {
    const rows = v[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!resultObject(row)) continue;
      if (personalAssessment(row.assessment)) return true;
      if (
        Array.isArray(row.offerings) &&
        row.offerings.some((x) => resultObject(x) && personalAssessment(x.assessment))
      ) return true;
    }
  }
  return false;
}
export function personalResultComponents(report: NativeObject): readonly string[] {
  const keys: string[] = [];
  if (resultObject(report.overall) && numeric(report.overall.total_standard_score)) {
    keys.push("overall");
  }
  const saved = resultObject(report.read_only_snapshot) ? report.read_only_snapshot : report;
  if (resultObject(saved.analyses)) {
    for (const [id, value] of Object.entries(saved.analyses)) {
      if (personalAssessment(value)) keys.push("analysis:" + id);
    }
  }
  if (candidateNumbers(saved.candidates)) keys.push("candidates");
  return Object.freeze(keys);
}
