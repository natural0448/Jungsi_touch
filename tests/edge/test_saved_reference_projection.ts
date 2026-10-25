import { assert, equal } from "./fixture.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SavedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/saved_reference_projection.ts";
function fixture(): NativeObject {
  return {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "SYNTHETIC-tail.v1",
    context: {
      academic_year: 2027,
      exam_id: "SYNTHETIC-mock",
      exam_type: "september_mock",
      source_pack_version: "SYNTHETIC-pack",
      model_version: "SYNTHETIC-model",
      profile_sha256: "a".repeat(64),
      rule_version: "SYNTHETIC-rule",
      score_scale_id: "SYNTHETIC-native",
      reference_curve_id: "SYNTHETIC-curve",
      weight_encoding: "SYNTHETIC_EXPLICIT_ENCODING",
      source_scenario_field_present: false,
      source_scenario_value: null,
      resolved_model_scenario: "SYNTHETIC-fixed",
    },
    evidence: Object.fromEntries(
      [
        "source_csv_sha256",
        "source_cdf_sha256",
        "definition_sha256",
        "shared_proof_sha256",
        "binder_sha256",
        "independent_sha256",
      ].map((k) => [k, "b".repeat(64)]),
    ),
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + "d".repeat(64),
      weight_decimal_scale: 1,
      eligible_weight_units: "15",
      whole_mass_decimal: "3.00001",
      whole_mass_numerator: "300001",
      whole_mass_denominator: "100000",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    rows: [{
      score_numerator: "10",
      score_denominator: "1",
      strict_weight_units: "5",
      tie_weight_units: "10",
      inclusive_weight_units: "15",
    }, {
      score_numerator: "20",
      score_denominator: "1",
      strict_weight_units: "0",
      tie_weight_units: "5",
      inclusive_weight_units: "5",
    }],
  };
}
async function bind(p = fixture()) {
  const bytes = new TextEncoder().encode(nativeJsonText(p));
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
  const pin = {
    sha256,
    bytes: bytes.length,
    maxBytes: 65536,
    context: p.context as NativeObject,
    evidence: p.evidence as NativeObject,
  };
  return { curve: await SavedReferenceTailProjection.bind(bytes, pin), bytes, pin };
}
async function rejects(work: Promise<unknown>) {
  try {
    await work;
  } catch {
    return;
  }
  throw new Error("Expected rejection");
}
Deno.test("saved wholemass projection uses exact tail units and independently precise whole mass", async () => {
  const p = fixture(),
    { curve } = await bind(p),
    r = curve.query(exact(10), p.context as NativeObject)!;
  equal(r.estimated_upper_cumulative_percent_all_examinees, "49.999833333889");
  equal(r.production_allowed, false);
  equal(r.actual_admission_full_total_approved, false);
});
Deno.test("saved tail query includes full ties and exact between-support threshold", async () => {
  const p = fixture(), { curve } = await bind(p);
  equal(
    curve.query(exact(20), p.context as NativeObject)!
      .estimated_upper_cumulative_percent_all_examinees,
    "16.666611111296",
  );
  equal(
    curve.query(exact("10.00001"), p.context as NativeObject),
    curve.query(exact(20), p.context as NativeObject),
  );
});
Deno.test("saved tail out-of-support remains null rather than invented0or100", async () => {
  const p = fixture(), { curve } = await bind(p);
  equal(curve.query(exact(9), p.context as NativeObject), null);
  equal(curve.query(exact(21), p.context as NativeObject), null);
});
Deno.test("saved tail rejects wrong year exam rule or native score axis", async () => {
  const p = fixture(), { curve } = await bind(p);
  for (
    const k of [
      "academic_year",
      "exam_id",
      "exam_type",
      "source_pack_version",
      "rule_version",
      "score_scale_id",
    ]
  ) {
    let failed = false;
    try {
      curve.query(exact(10), { ...p.context as NativeObject, [k]: "SYNTHETIC-other" });
    } catch {
      failed = true;
    }
    assert(failed);
  }
});
Deno.test("saved tail cannot accept changed pinned bytes or different proof evidence", async () => {
  const { bytes, pin } = await bind();
  const changed = Uint8Array.from(bytes);
  changed[0] ^= 1;
  await rejects(SavedReferenceTailProjection.bind(changed, pin));
  await rejects(
    SavedReferenceTailProjection.bind(bytes, {
      ...pin,
      evidence: { ...pin.evidence, shared_proof_sha256: "c".repeat(64) },
    }),
  );
});
Deno.test("saved tail enforces complete sorted exact mass chain and no production promotion", async () => {
  for (
    const mutate of [
      (p: NativeObject) => (p.projection as NativeObject).production_allowed = true,
      (p: NativeObject) => ((p.rows as NativeObject[])[0].inclusive_weight_units = "14"),
      (p: NativeObject) => ((p.rows as NativeObject[])[0].tie_weight_units = "0"),
      (p: NativeObject) => ((p.projection as NativeObject).whole_mass_numerator = "1"),
    ]
  ) {
    const p = fixture();
    mutate(p);
    await rejects(bind(p));
  }
});
