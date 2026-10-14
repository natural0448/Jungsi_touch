import {
  estimateYear,
  NativeBridgePolicy,
  NativeRankDistribution,
  prepareEquatedProfile,
  TailRank,
} from "../../supabase/functions/_shared/jungsi/domain/year_equating.ts";
import { NativeConversionRelease } from "../../supabase/functions/_shared/jungsi/domain/conversion_release.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { syntheticBridgeFixture, syntheticRankRaw } from "./synthetic_year_equating.ts";
import { SyntheticUniversityData } from "./synthetic_university.ts";
import { assert, equal, rejects } from "./fixture.ts";
Deno.test("rank distribution exact ties inverse center and reported grade remain separate from percentile", () => {
  const d = new NativeRankDistribution(syntheticRankRaw());
  equal(d.rank(9).inclusive.toString(), "1/9");
  equal(d.rank(9).exclusive.toString(), "0");
  equal(d.inverse(new TailRank(exact(0), exact("0.2"))).score, 9);
  equal(d.reportedScore(7)!.grade, 3);
  assert(!Object.hasOwn(d.reportedScore(7)!, "percentile"));
  rejects(() => d.rank(new JsonFloat("9.0")), "SCORE_NOT_IN_DISTRIBUTION");
});
Deno.test("rank counts observed fractions missing sources and noninteger reports fail closed", () => {
  for (
    const [change, code] of [
      [(r: NativeObject) => ((r.counts as NativeObject)["1"] = "0.5"), "FRACTIONAL_COUNT"],
      [(r: NativeObject) => (r.source_refs = []), "SOURCE_REQUIRED"],
      [
        (
          r: NativeObject,
        ) => (((r.reported_scores as NativeObject)["1"] as NativeObject).grade = new JsonFloat(
          "9.0",
        )),
        "INVALID_REPORTED_SCORE",
      ],
    ] as const
  ) {
    const r = syntheticRankRaw();
    change(r);
    rejects(() => new NativeRankDistribution(r), code);
  }
});
Deno.test("year bridge exact DP preserves individual subject rank and target total", () => {
  const f = syntheticBridgeFixture(),
    r = estimateYear(f.scores, f.source, f.target, f.policy, f.sourceTotal, f.targetTotal);
  equal(r.status, "estimated");
  equal(r.public_eligible, true);
  equal(r.estimated_standard_scores, f.scores);
  equal(r.total_standard_score, 30);
  const error = r.rank_fit_error as NativeObject;
  assert(error.numerator === 0n && error.denominator === 1n);
  equal(r.reason_codes, ["ABSOLUTE_GRADES_HELD_CONSTANT"]);
});
Deno.test("year bridge missing total distributions remains a calibration candidate", () => {
  const f = syntheticBridgeFixture(), r = estimateYear(f.scores, f.source, f.target, f.policy);
  equal(r.public_eligible, false);
  equal(r.estimated_standard_scores, null);
  equal(r.reason_codes, ["TOTAL_CURVE_REQUIRED"]);
  rejects(() => prepareEquatedProfile("SYNTHETIC-profile", r, 3, 2), "YEAR_BRIDGE_REQUIRED");
});
Deno.test("year bridge research policy cannot promote valid-looking calculated scores", () => {
  const f = syntheticBridgeFixture(),
    policy = new NativeBridgePolicy({
      version: "SYNTHETIC-research",
      max_subject_rank_shift: "0.2",
    });
  const r = estimateYear(f.scores, f.source, f.target, policy, f.sourceTotal, f.targetTotal);
  equal(r.status, "research_estimate");
  equal(r.public_eligible, false);
  rejects(() => prepareEquatedProfile("SYNTHETIC-profile", r, 3, 2), "YEAR_BRIDGE_NOT_VALIDATED");
});
Deno.test("year bridge checks total exam population and observed source score independently", () => {
  const f = syntheticBridgeFixture(),
    raw = syntheticRankRaw("SYNTHETIC-target", 2024, "total", true);
  raw.population_id = "SYNTHETIC-partial";
  rejects(
    () =>
      estimateYear(
        f.scores,
        f.source,
        f.target,
        f.policy,
        f.sourceTotal,
        new NativeRankDistribution(raw),
      ),
    "TOTAL_POPULATION_MISMATCH",
  );
  const bad = new NativeRankDistribution(syntheticRankRaw("SYNTHETIC-other", 2024, "total", true));
  rejects(
    () => estimateYear(f.scores, f.source, f.target, f.policy, f.sourceTotal, bad),
    "TOTAL_EXAM_MISMATCH",
  );
  rejects(
    () =>
      estimateYear(
        { ...f.scores, inquiry2: 5 },
        f.source,
        f.target,
        f.policy,
        f.sourceTotal,
        f.targetTotal,
      ),
    "SCORE_NOT_IN_DISTRIBUTION",
  );
});
Deno.test("year bridge impossible total fit stays pending instead of fabricating subject scores", () => {
  const f = syntheticBridgeFixture(),
    raw = syntheticRankRaw("SYNTHETIC-target", 2024, "total", true);
  raw.counts = { "20": 9 };
  const p = new NativeBridgePolicy({
    version: "SYNTHETIC-strict",
    status: "validated",
    validation_ref: "SYNTHETIC",
    max_subject_rank_shift: "0",
  });
  const r = estimateYear(
    f.scores,
    f.source,
    f.target,
    p,
    f.sourceTotal,
    new NativeRankDistribution(raw),
  );
  equal(r.status, "profile_alignment_required");
  equal(r.public_eligible, false);
  equal(r.estimated_standard_scores, null);
  equal(r.reason_codes, ["NO_PROFILE_WITHIN_RANK_LIMIT"]);
});
Deno.test("equated profile carries verified target mappings and holds absolute grades without inferred percentile", () => {
  const f = syntheticBridgeFixture(),
    r = estimateYear(f.scores, f.source, f.target, f.policy, f.sourceTotal, f.targetTotal),
    p = prepareEquatedProfile("SYNTHETIC-profile", r, 3, null, { korean_choice: "가상국어선택" });
  const values = p.values as NativeObject;
  equal(values.english_grade, 3);
  equal(values.korean_history_grade, null);
  equal(values.korean_grade, 1);
  equal(values.korean_percentile, null);
  equal(p.bridge_validated, true);
  equal(p.score_basis, "year_equated_estimate");
  rejects(
    () => prepareEquatedProfile("SYNTHETIC-profile", r, new JsonFloat("3.0"), 2),
    "INVALID_GRADE",
  );
  rejects(
    () => prepareEquatedProfile("SYNTHETIC-profile", r, 3, 2, { korean_standard_score: 100 }),
    "INVALID_CHOICE_FIELD",
  );
});
Deno.test("four year comparison never omits unmapped years or accepts actual profile as equated input", () => {
  const f = new SyntheticUniversityData(),
    binding = f.bundle!.bindings[0],
    release = new NativeConversionRelease("SYNTHETIC-release", [f.rawRule], [binding]);
  const compared = release.compareYears(
    { "2027": f.offering.offering_id },
    new Map([[2027, {
      academic_year: 2027,
      exam_id: f.pack!.examId,
      profile_version: "SYNTHETIC-profile",
      score_basis: "actual_exam",
      values: {},
    }]]),
  );
  const rows = compared.years as NativeObject[];
  equal(rows.length, 4);
  equal(rows[0].reason_codes, ["OFFERING_MAPPING_REQUIRED"]);
  equal(rows[3].reason_codes, ["YEAR_BRIDGE_REQUIRED"]);
});
