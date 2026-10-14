/** Local synthetic comparison only. This is not a production API or approved native adapter. */
import { ConversionRule, type Row, row } from "../domain/conversion.ts";
import { requireContract as check } from "../domain/exact.ts";
export interface SyntheticOfferingPort {
  read(): { offering: Row; pack: Row; bundle: Row; profile: Row };
}
const CONTEXT = ["academic_year", "university_id", "campus", "department", "track", "group"];
export function calculateSyntheticOffering(port: SyntheticOfferingPort) {
  const { offering, pack, bundle, profile } = structuredClone(port.read());
  check(
    bundle.data_kind === "synthetic" && bundle.status === "synthetic",
    "SYNTHETIC_SCOPE_REQUIRED",
  );
  check(
    pack.exam_id === profile.exam_id && pack.pack_version === profile.pack_version,
    "conversion_pack_mismatch",
  );
  check(
    pack.academic_year === offering.academic_year && pack.academic_year === profile.academic_year,
    "year_bridge_required",
  );
  check(bundle.academic_year === offering.academic_year, "conversion_year_mismatch");
  check(
    bundle.exam_id === pack.exam_id && bundle.source_pack_version === pack.pack_version,
    "conversion_exam_mismatch",
  );
  check(pack.exam_type === "csat" && bundle.exam_type === "csat", "conversion_exam_mismatch");
  check(Array.isArray(bundle.bindings), "conversion_binding_mismatch");
  const seen = new Set<string>();
  let selected: Row | undefined;
  for (const raw of bundle.bindings) {
    const binding = row(raw), key = JSON.stringify([binding.academic_year, binding.offering_pk]);
    check(!seen.has(key), "RULE_BINDING_AMBIGUOUS");
    seen.add(key);
    if (
      binding.academic_year === offering.academic_year &&
      binding.offering_pk === offering.offering_id
    ) selected = binding;
  }
  check(selected, "conversion_binding_missing");
  check(
    CONTEXT.every((k) => Object.hasOwn(offering, k) && selected[k] === offering[k]),
    "conversion_context_mismatch",
  );
  const rule = row(bundle.rule);
  check(rule.academic_year === bundle.academic_year, "BINDING_YEAR_MISMATCH");
  check(selected.rule_version === rule.rule_version, "conversion_binding_mismatch");
  check(
    rule.data_kind === "synthetic" && rule.review_status === "draft" &&
      profile.score_basis === "synthetic",
    "SYNTHETIC_SCOPE_REQUIRED",
  );
  for (const metadata of [rule, ...Object.values(row(rule.tables)).map((v) => row(v))]) {
    for (
      const [key, v] of [["exam_id", bundle.exam_id], [
        "source_pack_version",
        bundle.source_pack_version,
      ], ["rule_version", rule.rule_version]]
    ) {
      check(
        !Object.hasOwn(metadata, String(key)) || metadata[String(key)] === v,
        "conversion_rule_context_mismatch",
      );
    }
  }
  const result = new ConversionRule(rule).calculate(profile, true);
  return Object.freeze({
    kind: "synthetic_local_evidence",
    score: result.score,
    convertedScore: result.convertedScore,
    scoringStatus: "ready",
    percentileStatus: "pending",
    judgmentStatus: "pending",
    productionReady: false,
  });
}
