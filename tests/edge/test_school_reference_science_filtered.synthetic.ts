/** Invented fixtures only; tests neither encode actual university data nor approve production. */
import { equal } from "./fixture.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { PinnedSchoolReferenceSource } from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
import { SchoolReferenceScoringService } from "../../supabase/functions/_shared/jungsi/application/school_reference_scoring.ts";
import { type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

async function filteredScienceFixture139Review(operation = "observed_max_science") {
  const bytes = new SyntheticReferenceBytes();
  const domain = bytes.body.domain as NativeObject;
  domain.inquiry_categories = ["social", "science"];
  (domain.derivations as NativeObject[])[0].operation = operation;
  await bytes.seal();
  const service = new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(bytes));
  return { bytes, service };
}

function filteredScienceInput139Review(
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
  const { bytes, service } = await filteredScienceFixture139Review();
  const social = { category: "social", subject: "SYNTHETIC-social", percentile: 93 };
  const science = { category: "science", subject: "SYNTHETIC-science", percentile: 27 };
  for (const [first, second] of [[social, science], [science, social]]) {
    const result = await service.calculate(
      bytes.university.offering,
      filteredScienceInput139Review(bytes, first, second),
    );
    equal(result.status, "reference_calculated");
    equal(result.convertedScore, "27.00");
    equal(result.reasonCode, "reference_conversion_not_production_approved");
  }
});

Deno.test("filtered reference selects maximum among eligible science inquiries", async () => {
  const { bytes, service } = await filteredScienceFixture139Review();
  const result = await service.calculate(
    bytes.university.offering,
    filteredScienceInput139Review(
      bytes,
      { category: "science", subject: "SYNTHETIC-s1", percentile: 24 },
      { category: "science", subject: "SYNTHETIC-s2", percentile: 74 },
    ),
  );
  equal(result.status, "reference_calculated");
  equal(result.convertedScore, "74.00");
});

Deno.test("filtered reference requires science and preserves an observed zero", async () => {
  const { bytes, service } = await filteredScienceFixture139Review();
  const social = { category: "social", subject: "SYNTHETIC-social", percentile: 93 };
  const missingScience = await service.calculate(
    bytes.university.offering,
    filteredScienceInput139Review(
      bytes,
      social,
      { category: "social", subject: "SYNTHETIC-social2", percentile: 60 },
    ),
  );
  equal(missingScience.status, "pending");
  equal(missingScience.reasonCode, "reference_required_input_missing");
  const realZero = await service.calculate(
    bytes.university.offering,
    filteredScienceInput139Review(
      bytes,
      social,
      { category: "science", subject: "SYNTHETIC-science", percentile: 0 },
    ),
  );
  equal(realZero.status, "reference_calculated");
  equal(realZero.convertedScore, "0.00");
});

Deno.test("filtered reference still rejects duplicate, incomplete, invalid, and unsupported inquiry inputs", async () => {
  const { bytes, service } = await filteredScienceFixture139Review();
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
      filteredScienceInput139Review(bytes, test.first, test.second),
    );
    equal(result.status, "pending");
    equal(result.reasonCode, test.reason);
  }
});

Deno.test("unfiltered maximum retains existing behavior for a different reference domain", async () => {
  const { bytes, service } = await filteredScienceFixture139Review("observed_max");
  const result = await service.calculate(
    bytes.university.offering,
    filteredScienceInput139Review(
      bytes,
      { category: "social", subject: "SYNTHETIC-social", percentile: 93 },
      { category: "science", subject: "SYNTHETIC-science", percentile: 27 },
    ),
  );
  equal(result.status, "reference_calculated");
  equal(result.convertedScore, "93.00");
});

Deno.test("filtered operation is limited to best inquiry and caller cannot supply its derived value", async () => {
  const { bytes, service } = await filteredScienceFixture139Review();
  const input = filteredScienceInput139Review(
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
