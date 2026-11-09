import { assert, equal } from "./fixture.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { SavedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/saved_reference_projection.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { SchoolReferenceScoringService } from "../../supabase/functions/_shared/jungsi/application/school_reference_scoring.ts";
import { PinnedSchoolReferenceSource } from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { ReferencePercentileService } from "../../supabase/functions/_shared/jungsi/application/reference_percentile.ts";
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

async function setup() {
  const b = new SyntheticReferenceBytes(), pack = cloneNativeJson(b.university.rawPack);
  (pack.exam as NativeObject).exam_type = "september_mock";
  b.university.pack = new NativeExamPack(pack);
  b.body.exam_type = "september_mock";
  await b.seal();
  b.university.bundle = null;
  const reference = new PinnedSchoolReferenceSource(b), profile = b.university.profile();
  (profile.scores.inquiry as NativeObject[])[0].percentile = 31;
  (profile.scores.inquiry as NativeObject[])[1].percentile = 17;
  const conversion = await new UniversityScoringService(
    b.university,
    new SchoolReferenceScoringService(reference),
  ).calculate(b.university.offering, profile);
  const p = fixture(), c = p.context as NativeObject;
  c.exam_id = b.university.pack.examId;
  c.source_pack_version = b.university.pack.packVersion;
  c.rule_version = (b.body.rule as NativeObject).rule_version;
  c.score_scale_id = b.body.score_scale_id;
  (p.rows as NativeObject[])[1].score_numerator = "50";
  const { curve } = await bind(p),
    binding: NativeObject = {
      ...cloneNativeJson((b.body.bindings as NativeObject[])[0]),
      offering_id: b.university.offering.offering_id,
    };
  let current = true;
  const source = {
    getExamPack: b.university.getExamPack.bind(b.university),
    getConversion: b.university.getConversion.bind(b.university),
    getReference: reference.getReference.bind(reference),
    async getReferenceTail() {
      await Promise.resolve();
      return {
        projection: curve,
        binding,
        async assertCompatible() {},
        async assertCurrent() {
          await Promise.resolve();
          if (!current) throw new Error("stale");
        },
      };
    },
  };
  return {
    b,
    profile,
    conversion,
    source,
    binding,
    stale() {
      current = false;
    },
  };
}
Deno.test("reference percentile reuses exact tail and does not grant production readiness", async () => {
  const x = await setup(),
    r = await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion,
      x.profile,
    );
  equal(r.status, "reference_estimated");
  equal(r.estimated_upper_cumulative_percent_all_examinees, "16.666611111296");
  equal(r.production_allowed, false);
  equal(r.actual_admission_full_total_approved, false);
  assert(!x.conversion.ready);
  assert(!Object.hasOwn(r, "derived_method_id"));
  assert(!Object.hasOwn(r, "reference_curve_id"));
});
Deno.test("missing tail and out of support stay pending", async () => {
  const x = await setup();
  const missing = { ...x.source, getReferenceTail: undefined };
  equal(
    (await new ReferencePercentileService(missing).calculate(
      x.b.university.offering,
      x.conversion,
      x.profile,
    )).reason_code,
    "reference_tail_missing",
  );
  const scores = x.profile.scores.inquiry as NativeObject[];
  scores[0].percentile = 80;
  const conversion = await new UniversityScoringService(
    x.b.university,
    new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(x.b)),
  ).calculate(x.b.university.offering, x.profile);
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      conversion,
      x.profile,
    )).reason_code,
    "reference_score_outside_saved_support",
  );
});
Deno.test("wrong offering, rule, exam or pack cannot use a tail", async () => {
  for (
    const patch of [{ offering_id: "SYNTHETIC-other" }, { department: "SYNTHETIC-other" }, {
      academic_year: 2026,
    }] as NativeObject[]
  ) {
    const x = await setup();
    equal(
      (await new ReferencePercentileService(x.source).calculate(
        { ...x.b.university.offering, ...patch },
        x.conversion,
        x.profile,
      )).status,
      "pending",
    );
  }
  for (
    const patch of [{ exam_id: "SYNTHETIC-other" }, { pack_version: "SYNTHETIC-other" }, {
      rule_version: "SYNTHETIC-other",
    }]
  ) {
    const x = await setup();
    equal(
      (await new ReferencePercentileService(x.source).calculate(
        x.b.university.offering,
        x.conversion.with(patch),
        x.profile,
      )).status,
      "pending",
    );
  }
});
Deno.test("stale selection and altered offering binding stay pending", async () => {
  let x = await setup();
  x.stale();
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion,
      x.profile,
    )).status,
    "pending",
  );
  x = await setup();
  x.binding.track = "SYNTHETIC-other";
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion,
      x.profile,
    )).status,
    "pending",
  );
});
Deno.test("production or mismatched profiles cannot enter reference path", async () => {
  const x = await setup();
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion.with({ reason_code: null, score: exact(10) }),
      x.profile,
    )).reason_code,
    "reference_conversion_unavailable",
  );
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion,
      { ...x.profile, profile_id: "SYNTHETIC-other" },
    )).reason_code,
    "reference_conversion_unavailable",
  );
});

Deno.test("changed same-profile inputs cannot replay a prior reference conversion", async () => {
  const x = await setup();
  (x.profile.scores.inquiry as NativeObject[])[1].percentile = 18;
  const r = await new ReferencePercentileService(x.source).calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
  );
  equal(r.reason_code, "reference_conversion_context_mismatch");
});
Deno.test("selection freshness is rechecked after the tail query", async () => {
  const x = await setup(), get = x.source.getReferenceTail;
  let checks = 0;
  x.source.getReferenceTail = async () => {
    const selected = await get();
    return {
      ...selected,
      async assertCurrent() {
        await Promise.resolve();
        if (++checks === 2) throw new Error("stale");
      },
    };
  };
  const r = await new ReferencePercentileService(x.source).calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
  );
  equal(r.status, "pending");
  equal(checks, 2);
});

Deno.test("reference inputs are prepared once within a request and selections are still rechecked", async () => {
  const x = await setup(), original = x.source.getExamPack, select = x.source.getReferenceTail;
  let reads = 0, checks = 0;
  x.source.getExamPack = (id) => {
    reads++;
    return original(id);
  };
  x.source.getReferenceTail = async () => {
    const selected = await select();
    return {
      ...selected,
      async assertCurrent() {
        checks++;
        await selected.assertCurrent();
      },
    };
  };
  const service = new ReferencePercentileService(x.source);
  for (let i = 0; i < 2; i++) {
    equal(
      (await service.calculate(x.b.university.offering, x.conversion, x.profile)).status,
      "reference_estimated",
    );
  }
  // The scoring step's exact reference result is reused, so the pack is read at most once.
  assert(reads <= 1);
  equal(checks, 4);
});
Deno.test("public offering ID does not assume the physical source PK has the same representation", async () => {
  const x = await setup();
  x.binding.offering_pk = "SYNTHETIC-physical-pk";
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion,
      x.profile,
    )).status,
    "reference_estimated",
  );
  x.binding.offering_id = "SYNTHETIC-other-public-id";
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion,
      x.profile,
    )).status,
    "pending",
  );
});

Deno.test("same pack version without independent compatibility proof stays pending", async () => {
  const x = await setup(), get = x.source.getReferenceTail;
  x.source.getReferenceTail = async () => {
    const selected = await get();
    return {
      ...selected,
      async assertCompatible() {
        await Promise.resolve();
        throw new Error("unverified");
      },
    };
  };
  equal(
    (await new ReferencePercentileService(x.source).calculate(
      x.b.university.offering,
      x.conversion,
      x.profile,
    )).status,
    "pending",
  );
});
