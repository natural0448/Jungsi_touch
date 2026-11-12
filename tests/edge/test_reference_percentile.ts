// Preserve the synchronous execution order of async test doubles.
// deno-lint-ignore-file require-await
import {
  ATTENDANCE_AREAS,
  referenceAttendance,
} from "../../supabase/functions/_shared/jungsi/application/reference_attendance.ts";
import { ScoringResult } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { assert, equal } from "./fixture.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { SavedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/saved_reference_projection.ts";
import { NativeReferenceCdfProjection } from "../../supabase/functions/_shared/jungsi/domain/native_reference_cdf_projection.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { SchoolReferenceScoringService } from "../../supabase/functions/_shared/jungsi/application/school_reference_scoring.ts";
import { PinnedSchoolReferenceSource } from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { ReferencePercentileService } from "../../supabase/functions/_shared/jungsi/application/reference_percentile.ts";
import {
  prefetchSelectedSavedTails,
  preservePrefetchFailures,
} from "../../supabase/functions/_shared/jungsi/infrastructure/reference_tail_prefetch.ts";
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

async function setup(requiredAttendance = false) {
  const b = new SyntheticReferenceBytes(), pack = cloneNativeJson(b.university.rawPack);
  if (requiredAttendance) {
    (b.body.domain as NativeObject).required_attendance = [...ATTENDANCE_AREAS];
  }
  (pack.exam as NativeObject).exam_type = "september_mock";
  b.university.pack = new NativeExamPack(pack);
  b.body.exam_type = "september_mock";
  await b.seal();
  b.university.bundle = null;
  const reference = new PinnedSchoolReferenceSource(b), profile = b.university.profile();
  (profile.scores.inquiry as NativeObject[])[0].percentile = 31;
  (profile.scores.inquiry as NativeObject[])[1].percentile = 17;
  const profileForClaim = {
    ...profile,
    owner_id: "synthetic-owner",
    confirmed: true,
    created_at: "synthetic",
  };
  const claim = requiredAttendance
    ? referenceAttendance({
      profile_id: profile.profile_id,
      exam_id: profile.scores.exam_id,
      pack_version: profile.scores.pack_version,
      ...Object.fromEntries(ATTENDANCE_AREAS.map((k) => [k, true])),
    }, profileForClaim)
    : null;
  const conversion = await new UniversityScoringService(
    b.university,
    new SchoolReferenceScoringService(reference),
  ).calculate(b.university.offering, profile, claim);
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
      return {
        projection: curve,
        binding,
        async assertCompatible() {},
        async assertCurrent() {
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
    claim,
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
Deno.test("saved tail is preferred over a separately available native DB adapter", async () => {
  const x = await setup();
  let nativeReads = 0;
  const source = {
    ...x.source,
    async getNativeReferenceTail() {
      nativeReads++;
      return null;
    },
  };
  const result = await new ReferencePercentileService(source).calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
  );
  equal(result.status, "reference_estimated");
  equal(result.estimated_upper_cumulative_percent_all_examinees, "16.666611111296");
  equal(nativeReads, 0);
});
Deno.test("native DB is consulted only when the saved and chunked sources are unselected", async () => {
  const x = await setup();
  const calls: string[] = [];
  const source = {
    ...x.source,
    async getReferenceTail() {
      calls.push("saved");
      return null;
    },
    async getChunkedReferenceTail() {
      calls.push("chunked");
      return null;
    },
    async getNativeReferenceTail() {
      calls.push("native");
      return null;
    },
  };
  const result = await new ReferencePercentileService(source).calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
  );
  equal(calls.join(","), "saved,chunked,native");
  equal(result.reason_code, "reference_tail_missing");
});
Deno.test("saved source errors never fall through to a native DB source", async () => {
  const x = await setup();
  let nativeReads = 0;
  const source = {
    ...x.source,
    async getReferenceTail(): Promise<never> {
      throw new Error("synthetic permission or integrity failure");
    },
    async getNativeReferenceTail() {
      nativeReads++;
      return null;
    },
  };
  const result = await new ReferencePercentileService(source).calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
  );
  equal(result.reason_code, "reference_tail_unavailable");
  equal(nativeReads, 0);
});
Deno.test("3P keeps a successful row when another selected saved source fails", async () => {
  const x = await setup(),
    good = String(x.b.university.offering.offering_id),
    bad = "SYNTHETIC-bad",
    signal = new AbortController().signal;
  const failures = new Map<string, unknown>();
  let badReads = 0, nativeReads = 0;
  const tail = {
    async getReferenceTail(id: string) {
      if (id === bad) {
        badReads++;
        throw Error("synthetic integrity failure");
      }
      return await x.source.getReferenceTail();
    },
    async getNativeReferenceTail() {
      nativeReads++;
      return null;
    },
  };
  await prefetchSelectedSavedTails(tail, [bad, good], signal, signal, failures);
  const service = new ReferencePercentileService({
    ...x.source,
    ...preservePrefetchFailures(tail, failures),
  });
  const badOffering = { ...x.b.university.offering, offering_id: bad };
  equal(
    (await service.calculate(badOffering, x.conversion, x.profile, signal)).reason_code,
    "reference_tail_unavailable",
  );
  equal(
    (await service.calculate(x.b.university.offering, x.conversion, x.profile, signal)).status,
    "reference_estimated",
  );
  equal(badReads, 1);
  equal(nativeReads, 0);
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
  const patches: NativeObject[] = [{ offering_id: "SYNTHETIC-other" }, {
    department: "SYNTHETIC-other",
  }, { academic_year: 2026 }];
  for (const patch of patches) {
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

Deno.test("verified reference inputs are reused within a request and selections are still rechecked", async () => {
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
  equal(reads, 0);
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

Deno.test("reference provenance is stored privately only for the successful exact result", async () => {
  const x = await setup(), original = x.source.getReferenceTail;
  const source = {
    ...x.source,
    async getReferenceTail() {
      const selected = await original();
      return {
        ...selected,
        async verifiedProvenance(identity: Readonly<NativeObject>) {
          return {
            release_sha256: "a".repeat(64),
            selection_sha256: "b".repeat(64),
            tail_sha256: "c".repeat(64),
            compatibility_sha256: "d".repeat(64),
            academic_year: identity.academic_year,
            exam_id: identity.exam_id,
            source_pack_version: identity.source_pack_version,
            rule_version: identity.rule_version,
            score_scale_id: identity.score_scale_id,
            offering_id: identity.offering_id,
          };
        },
      };
    },
  };
  const service = new ReferencePercentileService(source),
    value = await service.calculate(x.b.university.offering, x.conversion, x.profile);
  equal(value.status, "reference_estimated");
  assert(!Object.hasOwn(value, "provenance"));
  const evidence = service.evidenceFor(x.b.university.offering.offering_id as string);
  assert(evidence);
  equal(evidence.value_sha256, await nativeJsonSha256(value));
  assert((evidence.provenance as NativeObject).offering_id === x.b.university.offering.offering_id);
});
Deno.test("mismatched or failed reference provenance cannot certify the result", async () => {
  for (const mode of ["wrong-id", "failed"] as const) {
    const x = await setup(), original = x.source.getReferenceTail;
    const source = {
      ...x.source,
      async getReferenceTail() {
        const selected = await original();
        return {
          ...selected,
          async verifiedProvenance(identity: Readonly<NativeObject>) {
            if (mode === "failed") throw new Error("revoked");
            return {
              release_sha256: "a".repeat(64),
              selection_sha256: "b".repeat(64),
              tail_sha256: "c".repeat(64),
              compatibility_sha256: "d".repeat(64),
              academic_year: identity.academic_year,
              exam_id: identity.exam_id,
              source_pack_version: identity.source_pack_version,
              rule_version: identity.rule_version,
              score_scale_id: identity.score_scale_id,
              offering_id: "other",
            };
          },
        };
      },
    };
    const service = new ReferencePercentileService(source),
      value = await service.calculate(x.b.university.offering, x.conversion, x.profile);
    equal(value.status, "pending");
    equal(service.evidenceFor(x.b.university.offering.offering_id as string), null);
  }
});

Deno.test("native DB reference reaches the same university percentile service without changing production status", async () => {
  const x = await setup(),
    signal = new AbortController().signal,
    rule = (x.b.body.rule as NativeObject).rule_version as string;
  const selectedPack = x.b.university.pack;
  assert(selectedPack);
  const exam = selectedPack.examId,
    pack = selectedPack.packVersion,
    axis = x.b.body.score_scale_id as string;
  const methodId = "estimated-whole-cohort-percentile:" + "d".repeat(64), packSha = "a".repeat(64);
  const doc = {
    academic_year: 2027,
    exam_id: exam,
    exam_type: "september_mock",
    source_rule_id: rule,
    model_references: { pack: { sha256: packSha } },
    engine_approved: false,
    production_allowed: false,
    data_kind: "fixed_mock_model_reference_not_actual_admission",
    actual_2027_csat_available: false,
    support_bin_count: 2,
    eligible_weight_units: "15",
    weight_decimal_scale: 0,
    whole_model_weight: "30",
    whole_model_weight_units: "30",
    score_denominator: 1,
    frequencies_numerator_integer_weight: [[10, "10"], [50, "5"]],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
  const pin = {
    sourceSha256: hash,
    sourceBytes: bytes.length,
    methodId,
    year: 2027,
    examId: exam,
    examType: "september_mock",
    sourcePackVersion: pack,
    modelPackSha256: packSha,
    ruleVersion: rule,
    scoreScaleId: axis,
    offeringId: x.binding.offering_id as string,
    maximumSupportRows: 125000,
  };
  const method: NativeObject = {
    method_id: methodId,
    metric: "estimated_upper_cumulative_percent_all_examinees",
    native_score_and_source_definition_metadata: {
      academic_year: 2027,
      source_rule_id: rule,
      score_denominator: 1,
      engine_approved: false,
      reference_curve_id: "curve",
    },
    binding: {
      projection_arguments: {
        expected_curve_id: "curve",
        eligible_weight_units: "15",
        weight_decimal_scale: 0,
        whole_model_weight_decimal: "30",
      },
    },
  };
  const projection = await NativeReferenceCdfProjection.bind(bytes, pin, method, signal);
  let compatible = 0;
  const source = {
    ...x.source,
    getReferenceTail: undefined,
    async getNativeReferenceTail() {
      return {
        projection,
        binding: x.binding,
        async assertCompatible() {
          compatible++;
        },
        async assertCurrent() {},
      };
    },
  };
  const result = await new ReferencePercentileService(source).calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
    signal,
  );
  equal(result.status, "reference_estimated");
  equal(result.estimated_upper_cumulative_percent_all_examinees, "16.666666666667");
  equal(result.production_allowed, false);
  assert(compatible > 0);
});

Deno.test("attendance remains required for reused and direct reference percentile paths", async () => {
  const x = await setup(true);
  assert(x.claim);
  const service = new ReferencePercentileService(x.source);
  const matching = await service.calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
    undefined,
    x.claim,
  );
  equal(matching.status, "reference_estimated");
  const missing = await service.calculate(x.b.university.offering, x.conversion, x.profile);
  equal(missing.status, "pending");
  const forged = { ...x.claim, areas: { ...x.claim.areas, english: false } };
  const wrong = await service.calculate(
    x.b.university.offering,
    x.conversion,
    x.profile,
    undefined,
    forged,
  );
  equal(wrong.status, "pending");
  const copied = new ScoringResult(x.conversion.state);
  const directMissing = await service.calculate(x.b.university.offering, copied, x.profile);
  equal(directMissing.status, "pending");
  const directConfirmed = await service.calculate(
    x.b.university.offering,
    copied,
    x.profile,
    undefined,
    x.claim,
  );
  equal(directConfirmed.status, "reference_estimated");
});
