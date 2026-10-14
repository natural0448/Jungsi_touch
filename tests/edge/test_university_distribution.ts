import {
  NativeUniversityScoreDistribution,
  publicationInterval,
  universityNumber,
} from "../../supabase/functions/_shared/jungsi/domain/university_distribution.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { assert, equal, rejects } from "./fixture.ts";
import { syntheticUniversityCurveData } from "./synthetic_university_curve.ts";
Deno.test("university curve exact ties and denominator preserve observed count meaning", () => {
  const c = new NativeUniversityScoreDistribution(
    syntheticUniversityCurveData(),
  );
  equal(c.total.toString(), "9");
  equal(c.tail(exact(20), true).toString(), "7/9");
  equal(c.tail(exact(20), false).toString(), "4/9");
  equal(c.tail(exact(100), true).toString(), "0");
  equal(c.tail(exact(-1), true).toString(), "1");
});
Deno.test("university curve source objects and bins are immutable independent copies", () => {
  const d = syntheticUniversityCurveData(),
    c = new NativeUniversityScoreDistribution(d);
  (d.metadata as NativeObject).status = "draft";
  equal(c.metadata.status, "approved");
  assert(
    Object.isFrozen(c) && Object.isFrozen(c.data) &&
      Object.isFrozen(c.metadata),
  );
  equal(c.tail(exact(20), true).toString(), "7/9");
});
Deno.test("university curve schema preserves integer year and exact boolean requirements", () => {
  for (
    const [field, value, code] of [
      ["academic_year", new JsonFloat("2027.0"), "INVALID_YEAR"],
      ["complete", 1, "INVALID_METADATA"],
      ["population_verified", "true", "INVALID_METADATA"],
      ["complete", false, "INCOMPLETE_CURVE"],
      ["population_verified", false, "POPULATION_UNVERIFIED"],
    ] as const
  ) {
    const d = syntheticUniversityCurveData();
    (d.metadata as NativeObject)[field] = value;
    rejects(() => new NativeUniversityScoreDistribution(d), code);
  }
});
Deno.test("university curve domain duplicate bins denominator and weights are independently checked", () => {
  for (
    const [change, code] of [
      [
        (d: NativeObject) =>
          (d.frequencies as NativeObject[]).push({
            converted_score: "20.0",
            weight: 1,
          }),
        "DUPLICATE_SCORE",
      ],
      [
        (d: NativeObject) => ((d.frequencies as NativeObject[])[0].weight = 0),
        "INVALID_WEIGHT",
      ],
      [
        (
          d: NativeObject,
        ) => ((d.metadata as NativeObject).expected_total_weight = 10),
        "WEIGHT_MISMATCH",
      ],
      [
        (d: NativeObject) => ((d.metadata as NativeObject).score_min = 0),
        "DOMAIN_MISMATCH",
      ],
      [
        (
          d: NativeObject,
        ) => ((d.frequencies as NativeObject[])[0].weight = "0.5"),
        "FRACTIONAL_COUNT",
      ],
    ] as const
  ) {
    const d = syntheticUniversityCurveData();
    change(d);
    rejects(() => new NativeUniversityScoreDistribution(d), code);
  }
});
Deno.test("estimated university weights accept native decimals and reject fraction strings", () => {
  const d = syntheticUniversityCurveData();
  (d.metadata as NativeObject).kind = "estimated_weights";
  (d.metadata as NativeObject).expected_total_weight = "7.5";
  (d.frequencies as NativeObject[])[0].weight = new JsonFloat("0.5");
  const c = new NativeUniversityScoreDistribution(d);
  equal(c.total.toString(), "15/2");
  equal(c.tail(exact(20), true).toString(), "14/15");
  rejects(() => universityNumber("1/2"), "INVALID_NUMBER");
  rejects(() => universityNumber(true), "INVALID_NUMBER");
});
Deno.test("university cutoff uses exact rounding interval and explicit same context", () => {
  const c = new NativeUniversityScoreDistribution(
      syntheticUniversityCurveData(),
    ),
    r = {
      ...c.metadata,
      score_value: "20.0",
      publication_precision: { mode: "half_up", places: 1 },
    };
  const out = c.lookup(r),
    at = out.at_reported_score as NativeObject,
    range = out.upper_percentile_range as NativeObject;
  equal(at.strictly_above_percent, "44.444444");
  equal(at.above_or_equal_percent, "77.777778");
  equal(range.lower_percent, "44.444444");
  equal(range.upper_percent, "77.777778");
  rejects(
    () => c.lookup({ ...r, rule_version: "SYNTHETIC-other" }),
    "CONTEXT_MISMATCH",
  );
  rejects(
    () => c.lookup({ ...r, score_metric: "average_subject_percentile" }),
    "SCORE_METRIC_MISMATCH",
  );
  rejects(() => c.lookup({ ...r, score_value: 100 }), "CUTOFF_OUTSIDE_DOMAIN");
});
Deno.test("publication rounding preserves signed endpoint inclusion and real zero interval", () => {
  const positive = publicationInterval(exact(2), {
      mode: "half_up",
      places: 0,
    }),
    negative = publicationInterval(exact(-2), { mode: "half_up", places: 0 });
  assert(positive.includeLower && !positive.includeUpper);
  assert(!negative.includeLower && negative.includeUpper);
  const zero = publicationInterval(exact(0), { mode: "truncate", places: 1 });
  equal(zero.lower.toString(), "-1/10");
  equal(zero.upper.toString(), "1/10");
  assert(!zero.includeLower && !zero.includeUpper);
  rejects(
    () => publicationInterval(exact("1.25"), { mode: "half_up", places: 1 }),
    "PRECISION_MISMATCH",
  );
  rejects(
    () => publicationInterval(exact(1), { mode: "unknown" }),
    "ROUNDING_UNCONFIRMED",
  );
});
