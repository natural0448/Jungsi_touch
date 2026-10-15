import {
  NativeUniversityScoreDistribution,
  publicationInterval,
  universityNumber,
} from "../../supabase/functions/_shared/jungsi/domain/university_distribution.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { exact, Rational } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
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

/** Invented fractions only; no operating source, population or approval. */
function syntheticRationalCurve(): NativeObject {
  const d = syntheticUniversityCurveData();
  d.format = "jungsi.university-score-distribution/v2";
  const m = d.metadata as NativeObject;
  m.score_representation = "rational_integer_pair";
  m.score_min = { numerator: 1, denominator: 3 };
  m.score_max = { numerator: 1, denominator: 1 };
  const bins = d.frequencies as NativeObject[];
  for (let i = 0; i < bins.length; i++) {
    bins[i].converted_score = { numerator: i + 1, denominator: 3 };
  }
  return d;
}
Deno.test("rational v2 curves preserve thirds and exact tie ranges without decimal rounding", () => {
  const d = syntheticRationalCurve(), c = new NativeUniversityScoreDistribution(d);
  equal(c.total.toString(), "9");
  equal(c.minimum.toString(), "1/3");
  equal(c.maximum.toString(), "1");
  equal(c.tail(new Rational(2n, 3n), true).toString(), "7/9");
  equal(c.tail(new Rational(2n, 3n), false).toString(), "4/9");
  const out = c.lookup({
    ...c.metadata,
    score_value: new Rational(2n, 3n),
    publication_precision: { mode: "exact" },
  });
  equal((out.at_reported_score as NativeObject).above_or_equal_percent, "77.777778");
  equal(((c.data.frequencies as NativeObject[])[1].converted_score as NativeObject).denominator, 3);
});
Deno.test("rational v2 research data remains unavailable to ordinary service lookups", () => {
  const d = syntheticRationalCurve(), m = d.metadata as NativeObject;
  m.status = "research";
  m.population_verified = false;
  d.engine_approved = false;
  d.production_allowed = false;
  const c = new NativeUniversityScoreDistribution(d);
  const input = {
    ...c.metadata,
    score_value: new Rational(2n, 3n),
    publication_precision: { mode: "exact" },
  };
  rejects(() => c.lookup(input), "CURVE_NOT_APPROVED");
  equal(c.lookup(input, true).output_status, "research_only");
  equal(c.data.engine_approved, false);
  equal(c.data.production_allowed, false);
});
Deno.test("v1 does not reinterpret rational objects and v2 requires an explicit encoding", () => {
  const old = syntheticRationalCurve();
  old.format = "jungsi.university-score-distribution/v1";
  rejects(() => new NativeUniversityScoreDistribution(old), "INVALID_NUMBER");
  for (const value of [undefined, null, "decimal", true]) {
    const d = syntheticRationalCurve(), m = d.metadata as NativeObject;
    if (value === undefined) delete m.score_representation;
    else m.score_representation = value;
    rejects(() => new NativeUniversityScoreDistribution(d), "INVALID_SCORE_REPRESENTATION");
  }
});
Deno.test("rational scores reject noninteger bool float string zero negative or extra denominator fields", () => {
  for (
    const bad of [
      { numerator: true, denominator: 3 },
      { numerator: new JsonFloat("1.0"), denominator: 3 },
      { numerator: "1", denominator: 3 },
      { numerator: 1, denominator: "3" },
      { numerator: 1, denominator: 0 },
      { numerator: 1, denominator: -3 },
      { numerator: 1, denominator: 3, extra: 0 },
    ] as NativeObject[]
  ) {
    const d = syntheticRationalCurve();
    (d.frequencies as NativeObject[])[0].converted_score = bad;
    rejects(() => new NativeUniversityScoreDistribution(d), "INVALID_RATIONAL_SCORE");
  }
});
Deno.test("rational v2 preserves native integers above the IEEE safe boundary", () => {
  const d = syntheticRationalCurve(), m = d.metadata as NativeObject, n = 9007199254740993n;
  m.score_min = { numerator: n, denominator: 3 };
  m.score_max = { numerator: n + 2n, denominator: 3 };
  for (const [i, b] of (d.frequencies as NativeObject[]).entries()) {
    b.converted_score = { numerator: n + BigInt(i), denominator: 3 };
  }
  const c = new NativeUniversityScoreDistribution(d);
  assert(c.minimum.compare(new Rational(n, 3n)) === 0);
  const minimum = c.metadata.score_min as NativeObject;
  assert(typeof minimum.numerator === "bigint" && minimum.numerator === n);
  equal(c.tail(new Rational(n + 1n, 3n), true).toString(), "7/9");
});
Deno.test("equivalent rational score bins are rejected rather than silently merged", () => {
  const d = syntheticRationalCurve();
  (d.frequencies as NativeObject[])[1].converted_score = { numerator: 2, denominator: 6 };
  rejects(() => new NativeUniversityScoreDistribution(d), "DUPLICATE_SCORE");
});
Deno.test("rational encoding cannot bypass population or source rule approval checks", () => {
  const unverified = syntheticRationalCurve();
  (unverified.metadata as NativeObject).population_verified = false;
  rejects(() => new NativeUniversityScoreDistribution(unverified), "POPULATION_UNVERIFIED");
  const unreviewed = syntheticRationalCurve();
  (unreviewed.metadata as NativeObject).rule_review_status = "source_verified";
  rejects(() => new NativeUniversityScoreDistribution(unreviewed), "RULE_NOT_APPROVED");
});

Deno.test("rational v2 rejects mixed scalar encodings and nonfinite pair components", () => {
  const scalar = syntheticRationalCurve();
  (scalar.metadata as NativeObject).score_min = "0.333333";
  rejects(() => new NativeUniversityScoreDistribution(scalar), "INVALID_RATIONAL_SCORE");
  for (
    const invalid of [
      { numerator: 1, denominator: new JsonFloat("3.0") },
      { numerator: 1, denominator: 3, decimal: "0.333333" },
    ] as NativeObject[]
  ) {
    const d = syntheticRationalCurve();
    (d.frequencies as NativeObject[])[0].converted_score = invalid;
    rejects(() => new NativeUniversityScoreDistribution(d), "INVALID_RATIONAL_SCORE");
  }
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const d = syntheticRationalCurve();
    (d.frequencies as NativeObject[])[0].converted_score = { numerator: invalid, denominator: 3 };
    rejects(() => new NativeUniversityScoreDistribution(d), "native_json_invalid");
  }
});
Deno.test("rational v2 bins sort exactly while source order and zero hundred percent endpoints remain intact", () => {
  const d = syntheticRationalCurve();
  (d.frequencies as NativeObject[]).reverse();
  const c = new NativeUniversityScoreDistribution(d);
  equal(c.tail(new Rational(1n, 3n), true).toString(), "1");
  equal(c.tail(new Rational(1n), false).toString(), "0");
  equal(c.tail(new Rational(2n, 3n), true).toString(), "7/9");
  equal(c.tail(new Rational(2n, 3n), false).toString(), "4/9");
  const stored = (c.data.frequencies as NativeObject[])[0].converted_score as NativeObject;
  equal(stored.numerator, 3);
  const lower = c.lookup({
    ...c.metadata,
    score_value: new Rational(1n, 3n),
    publication_precision: { mode: "exact" },
  });
  const upper = c.lookup({
    ...c.metadata,
    score_value: new Rational(1n),
    publication_precision: { mode: "exact" },
  });
  equal((lower.at_reported_score as NativeObject).above_or_equal_percent, "100.000000");
  equal((upper.at_reported_score as NativeObject).strictly_above_percent, "0.000000");
});
