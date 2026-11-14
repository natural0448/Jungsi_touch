import { assert, equal } from "./fixture.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { PinnedSchoolReferenceSource } from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
import {
  projectReferenceInputs,
  SchoolReferenceScoringService,
} from "../../supabase/functions/_shared/jungsi/application/school_reference_scoring.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
async function fixture() {
  const b = await new SyntheticReferenceBytes().seal(), source = new PinnedSchoolReferenceSource(b);
  return { b, source, service: new SchoolReferenceScoringService(source) };
}
async function code(work: Promise<unknown>, expected: string) {
  try {
    await work;
  } catch (e) {
    equal((e as { code?: string }).code, expected);
    return;
  }
  throw new Error("Expected rejection");
}
Deno.test("reference numeric success preserves native approval flags and source input", async () => {
  const { b, service } = await fixture(),
    before = nativeJsonText(b.body),
    input = b.input(),
    raw = nativeJsonText(input.values);
  const r = await service.calculate(b.university.offering, input);
  equal(r.status, "reference_calculated");
  equal(r.convertedScore, "31.00");
  equal(r.exactScore!.toString(), "31");
  equal(r.reasonCode, "reference_conversion_not_production_approved");
  equal(nativeJsonText(b.body), before);
  equal(nativeJsonText(input.values), raw);
  equal((b.body.rule as NativeObject).engine_approved, false);
});
Deno.test("reference source shared rule is loaded once across offerings and concurrent calls", async () => {
  const b = new SyntheticReferenceBytes(), bindings = b.body.bindings as NativeObject[];
  bindings.push({ ...bindings[0], offering_pk: "SYNTHETIC-second" });
  await b.seal();
  const source = new PinnedSchoolReferenceSource(b);
  await Promise.all([
    source.getReference(String(bindings[0].offering_pk)),
    source.getReference("SYNTHETIC-second"),
  ]);
  equal(b.reads, 1);
  equal(b.checks, 2);
});
Deno.test("reference cache cannot mix changed pins", async () => {
  const { b, source } = await fixture();
  await source.getReference(String(b.university.offering.offering_id));
  b.pin = { ...b.pin, sha256: "c".repeat(64) };
  await code(
    source.getReference(String(b.university.offering.offering_id)),
    "reference_pin_changed",
  );
});
Deno.test("reference corrupt bytes rejected without score", async () => {
  const { b, service } = await fixture();
  b.raw[0] ^= 1;
  equal(
    (await service.calculate(b.university.offering, b.input())).reasonCode,
    "reference_pin_invalid",
  );
});
Deno.test("reference source current head failure is safe and never a calculation", async () => {
  const { b, service } = await fixture();
  b.changed = true;
  const r = await service.calculate(b.university.offering, b.input());
  equal(r.status, "pending");
  equal(r.convertedScore, null);
  equal(r.reasonCode, "reference_conversion_unavailable");
});
Deno.test("reference independently selected review SHA and scope are mandatory", async () => {
  for (
    const patch of [{ independent_sha256: "c".repeat(64) }, { production_allowed: true }, {
      applicant_eligibility_approved: true,
    }]
  ) {
    const b = new SyntheticReferenceBytes();
    Object.assign(b.body.review as NativeObject, patch);
    await b.seal();
    const r = await new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(b)).calculate(
      b.university.offering,
      b.input(),
    );
    equal(r.reasonCode, "reference_review_scope_invalid");
  }
});
Deno.test("reference binds year exact exam pack and exam type", async () => {
  for (
    const patch of [{ academicYear: 2026 }, { examId: "SYNTHETIC-other" }, {
      packVersion: "SYNTHETIC-other",
    }, { examType: "september_mock" }]
  ) {
    const { b, service } = await fixture();
    equal(
      (await service.calculate(b.university.offering, { ...b.input(), ...patch })).reasonCode,
      "reference_exam_context_mismatch",
    );
  }
});
Deno.test("reference binds exact campus department track and group", async () => {
  for (const key of ["university_id", "campus", "department", "track", "group"]) {
    const { b, service } = await fixture();
    equal(
      (await service.calculate({ ...b.university.offering, [key]: "SYNTHETIC-other" }, b.input()))
        .reasonCode,
      "reference_offering_context_mismatch",
    );
  }
});
Deno.test("reference raw partial weighted axis cannot substitute native score", async () => {
  const b = new SyntheticReferenceBytes();
  (b.body.rule as NativeObject).score_axis = "weighted_percentile_before_final_transform";
  await b.seal();
  equal(
    (await new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(b)).calculate(
      b.university.offering,
      b.input(),
    )).reasonCode,
    "reference_rule_context_mismatch",
  );
});
Deno.test("reference missing fields and real zero remain distinct", async () => {
  const { b, service } = await fixture();
  equal(
    (await service.calculate(
      b.university.offering,
      b.input({ inquiry1_percentile: 0, inquiry2_percentile: 0 }),
    )).convertedScore,
    "0.00",
  );
  equal(
    (await service.calculate(b.university.offering, b.input({ korean_history_grade: null })))
      .reasonCode,
    "reference_required_input_missing",
  );
  equal(
    (await service.calculate(b.university.offering, b.input({ inquiry1_percentile: null })))
      .reasonCode,
    "reference_inquiry_incomplete",
  );
});
Deno.test("reference observed one inquiry is enough only when declared and truly absent", async () => {
  const { b, service } = await fixture();
  const r = await service.calculate(
    b.university.offering,
    b.input({ inquiry2_subject: null, inquiry2_percentile: null }),
  );
  equal(r.convertedScore, "31.00");
});
Deno.test("reference forbidden duplicate inquiry category and boolean percentile rejected", async () => {
  const { b, service } = await fixture();
  equal(
    (await service.calculate(b.university.offering, b.input({ inquiry2_subject: "SYNTHETIC-q1" })))
      .reasonCode,
    "reference_duplicate_inquiry",
  );
  equal(
    (await service.calculate(b.university.offering, {
      ...b.input(),
      inquiryCategories: ["foreign", "science"],
    })).reasonCode,
    "reference_inquiry_category_unsupported",
  );
  equal(
    (await service.calculate(b.university.offering, b.input({ inquiry1_percentile: true })))
      .reasonCode,
    "reference_input_invalid",
  );
});
Deno.test("reference unsupported source only blocks its selection", async () => {
  const { b, service } = await fixture();
  b.selected = false;
  equal(
    (await service.calculate(b.university.offering, b.input())).reasonCode,
    "reference_conversion_missing",
  );
  b.selected = true;
  equal((await service.calculate(b.university.offering, b.input())).status, "reference_calculated");
});
Deno.test("reference derivation semantic aliases cannot silently change max to sum", async () => {
  const b = new SyntheticReferenceBytes();
  ((b.body.domain as NativeObject).derivations as NativeObject[])[0].operation = "observed_sum";
  await b.seal();
  equal(
    (await new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(b)).calculate(
      b.university.offering,
      b.input(),
    )).reasonCode,
    "reference_derivation_invalid",
  );
});
Deno.test("reference no invented inquiry requirement for an unreflected subject", async () => {
  const { b, source } = await fixture(),
    f = await source.getReference(String(b.university.offering.offering_id));
  assert(f);
  const plain = {
    ...f,
    minimumInquiry: 0,
    derivations: [],
    requiredFields: ["korean_history_grade"],
    rule: { data: { inputs: { korean_history_grade: {} } } } as unknown as typeof f.rule,
  };
  const p = projectReferenceInputs(
    plain,
    b.input({ inquiry1_percentile: null, inquiry2_percentile: null }),
  );
  equal(p.inquiry1_percentile, null);
});
Deno.test("reference exact derived mean preserves half without floating conversion", async () => {
  const { b, source } = await fixture(),
    f = await source.getReference(String(b.university.offering.offering_id));
  assert(f);
  const r = projectReferenceInputs({
    ...f,
    derivations: [{
      field: "inquiry_average_percentile",
      operation: "observed_average",
      inputs: ["inquiry1_percentile", "inquiry2_percentile"],
      minimumPresent: 1,
    }],
  }, b.input({ inquiry1_percentile: 1, inquiry2_percentile: 0 }));
  equal(r.inquiry_average_percentile, "0.5");
});
Deno.test("explicit inquiry subjects never widen to an entire category and math or mixed restrictions are retained", async () => {
  const b = new SyntheticReferenceBytes(), d = b.body.domain as NativeObject;
  d.inquiry_subjects = ["SYNTHETIC-q1", "SYNTHETIC-q2"];
  d.math_choices = ["SYNTHETIC-math-choice"];
  d.mixed_social_science_allowed = false;
  await b.seal();
  const service = new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(b));
  const input = {
    ...b.input({ math_choice: "SYNTHETIC-math-choice" }),
    inquiryCategories: ["science", "science"],
  };
  equal((await service.calculate(b.university.offering, input)).status, "reference_calculated");
  equal(
    (await service.calculate(b.university.offering, {
      ...input,
      values: { ...input.values, inquiry1_subject: "SYNTHETIC-another-science" },
    })).reasonCode,
    "reference_inquiry_category_unsupported",
  );
  equal(
    (await service.calculate(b.university.offering, {
      ...input,
      values: { ...input.values, math_choice: "SYNTHETIC-another-choice" },
    })).reasonCode,
    "reference_required_input_missing",
  );
  equal(
    (await service.calculate(b.university.offering, {
      ...input,
      inquiryCategories: ["social", "science"],
    })).reasonCode,
    "reference_inquiry_category_unsupported",
  );
});
Deno.test("production scoring stays first and reference port is never called on approval failure", async () => {
  const { b } = await fixture();
  let called = 0;
  const ref = {
    calculate() {
      called++;
      throw new Error("Never call fallback");
    },
  };
  const r = await new UniversityScoringService(b.university, ref).calculate(
    b.university.offering,
    b.university.profile(),
  );
  assert(r.ready);
  equal(called, 0);
  b.university.bundle = { ...b.university.bundle!, status: "draft" };
  equal(
    (await new UniversityScoringService(b.university, ref).calculate(
      b.university.offering,
      b.university.profile(),
    )).state.reason_code,
    "conversion_release_not_approved",
  );
  equal(called, 0);
});
Deno.test("existing scoring port retains reference score but never grants production ready", async () => {
  const { b, service } = await fixture();
  b.university.bundle = null;
  const profile = b.university.profile();
  (profile.scores.inquiry as NativeObject[])[0].percentile = 31;
  (profile.scores.inquiry as NativeObject[])[1].percentile = 17;
  const r = await new UniversityScoringService(b.university, service).calculate(
    b.university.offering,
    profile,
  );
  equal(r.dto().converted_score, "31.00");
  equal(r.dto().status, "pending");
  assert(!r.ready);
  equal(r.state.score, null);
  equal(r.dto().reason_code, "reference_conversion_not_production_approved");
  for (
    const k of ["reference_status", "values", "source_sha256", "independent_sha256", "exactScore"]
  ) assert(!Object.hasOwn(r.dto(), k));
});
Deno.test("existing production missing conversion still pending without explicit reference injection", async () => {
  const { b } = await fixture();
  b.university.bundle = null;
  equal(
    (await new UniversityScoringService(b.university).calculate(
      b.university.offering,
      b.university.profile(),
    )).state.reason_code,
    "conversion_release_missing",
  );
});
Deno.test("reference exact same mock scenario is labelled and never accepted as CSAT", async () => {
  const b = new SyntheticReferenceBytes(), pack = cloneNativeJson(b.university.rawPack);
  (pack.exam as NativeObject).exam_type = "september_mock";
  b.university.pack = new NativeExamPack(pack);
  b.body.exam_type = "september_mock";
  await b.seal();
  const service = new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(b));
  equal(
    (await service.calculate(b.university.offering, {
      ...b.input(),
      examType: "september_mock",
      scoreBasis: "mock_exam",
    })).status,
    "reference_calculated",
  );
  equal(
    (await service.calculate(b.university.offering, b.input())).reasonCode,
    "reference_exam_context_mismatch",
  );
});

async function filteredScienceFixtureScopedReview(operation = "observed_max_science") {
  const bytes = new SyntheticReferenceBytes();
  const domain = bytes.body.domain as NativeObject;
  domain.inquiry_categories = ["social", "science"];
  (domain.derivations as NativeObject[])[0].operation = operation;
  await bytes.seal();
  const service = new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(bytes));
  return { bytes, service };
}

function filteredScienceInputScopedReview(
  bytes: SyntheticReferenceBytes,
  first: { category: string; subject: string; percentile: number | null },
  second: { category: string; subject: string; percentile: number | null },
) {
  return {
    ...bytes.input({
      inquiry1_subject: first.subject,
      inquiry1_percentile: first.percentile,
      inquiry2_subject: second.subject,
      inquiry2_percentile: second.percentile,
    }),
    inquiryCategories: [first.category, second.category],
  };
}

Deno.test("filtered reference uses science only for mixed inquiries in either order", async () => {
  const { bytes, service } = await filteredScienceFixtureScopedReview();
  const social = { category: "social", subject: "SYNTHETIC-social", percentile: 93 };
  const science = { category: "science", subject: "SYNTHETIC-science", percentile: 27 };
  for (const [first, second] of [[social, science], [science, social]]) {
    const result = await service.calculate(
      bytes.university.offering,
      filteredScienceInputScopedReview(bytes, first, second),
    );
    equal(result.status, "reference_calculated");
    equal(result.convertedScore, "27.00");
    equal(result.reasonCode, "reference_conversion_not_production_approved");
  }
});

Deno.test("filtered reference selects maximum among eligible science inquiries", async () => {
  const { bytes, service } = await filteredScienceFixtureScopedReview();
  const result = await service.calculate(
    bytes.university.offering,
    filteredScienceInputScopedReview(
      bytes,
      { category: "science", subject: "SYNTHETIC-s1", percentile: 24 },
      { category: "science", subject: "SYNTHETIC-s2", percentile: 74 },
    ),
  );
  equal(result.status, "reference_calculated");
  equal(result.convertedScore, "74.00");
});

Deno.test("filtered reference requires science and preserves an observed zero", async () => {
  const { bytes, service } = await filteredScienceFixtureScopedReview();
  const social = { category: "social", subject: "SYNTHETIC-social", percentile: 93 };
  const missingScience = await service.calculate(
    bytes.university.offering,
    filteredScienceInputScopedReview(
      bytes,
      social,
      { category: "social", subject: "SYNTHETIC-social2", percentile: 60 },
    ),
  );
  equal(missingScience.status, "pending");
  equal(missingScience.reasonCode, "reference_required_input_missing");
  const realZero = await service.calculate(
    bytes.university.offering,
    filteredScienceInputScopedReview(
      bytes,
      social,
      { category: "science", subject: "SYNTHETIC-science", percentile: 0 },
    ),
  );
  equal(realZero.status, "reference_calculated");
  equal(realZero.convertedScore, "0.00");
});

Deno.test("filtered reference still rejects duplicate, incomplete, invalid, and unsupported inquiry inputs", async () => {
  const { bytes, service } = await filteredScienceFixtureScopedReview();
  const science = { category: "science", subject: "SYNTHETIC-science", percentile: 27 };
  const cases = [
    {
      first: science,
      second: { category: "science", subject: "SYNTHETIC-science", percentile: 55 },
      reason: "reference_duplicate_inquiry",
    },
    {
      first: { ...science, percentile: null },
      second: { category: "social", subject: "SYNTHETIC-social", percentile: 93 },
      reason: "reference_inquiry_incomplete",
    },
    {
      first: science,
      second: { category: "social", subject: "SYNTHETIC-social", percentile: 101 },
      reason: "reference_percentile_invalid",
    },
    {
      first: science,
      second: { category: "vocational", subject: "SYNTHETIC-voc", percentile: 93 },
      reason: "reference_inquiry_category_unsupported",
    },
  ];
  for (const test of cases) {
    const result = await service.calculate(
      bytes.university.offering,
      filteredScienceInputScopedReview(bytes, test.first, test.second),
    );
    equal(result.status, "pending");
    equal(result.reasonCode, test.reason);
  }
});

Deno.test("unfiltered maximum retains existing behavior for a different reference domain", async () => {
  const { bytes, service } = await filteredScienceFixtureScopedReview("observed_max");
  const result = await service.calculate(
    bytes.university.offering,
    filteredScienceInputScopedReview(
      bytes,
      { category: "social", subject: "SYNTHETIC-social", percentile: 93 },
      { category: "science", subject: "SYNTHETIC-science", percentile: 27 },
    ),
  );
  equal(result.status, "reference_calculated");
  equal(result.convertedScore, "93.00");
});

Deno.test("filtered operation is limited to best inquiry and caller cannot supply its derived value", async () => {
  const { bytes, service } = await filteredScienceFixtureScopedReview();
  const input = filteredScienceInputScopedReview(
    bytes,
    { category: "social", subject: "SYNTHETIC-social", percentile: 93 },
    { category: "science", subject: "SYNTHETIC-science", percentile: 27 },
  );
  const forged = await service.calculate(bytes.university.offering, {
    ...input,
    values: { ...input.values, inquiry_best_percentile: 99 },
  });
  equal(forged.status, "pending");
  equal(forged.reasonCode, "reference_derivation_invalid");

  const wrongFieldBytes = new SyntheticReferenceBytes();
  const domain = wrongFieldBytes.body.domain as NativeObject;
  domain.inquiry_categories = ["social", "science"];
  const derivation = (domain.derivations as NativeObject[])[0];
  derivation.operation = "observed_max_science";
  derivation.field = "inquiry_sum_percentile";
  await wrongFieldBytes.seal();
  const wrongField = await new SchoolReferenceScoringService(
    new PinnedSchoolReferenceSource(wrongFieldBytes),
  ).calculate(wrongFieldBytes.university.offering, input);
  equal(wrongField.status, "pending");
  equal(wrongField.reasonCode, "reference_derivation_invalid");
});
