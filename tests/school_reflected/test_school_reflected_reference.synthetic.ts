import {
  type ReflectedReferenceRule,
  type ReflectedStudentScores,
  schoolReflectedReference,
} from "../../supabase/functions/_shared/jungsi/application/school_reflected_reference.ts";
import { assert, equal } from "../edge/fixture.ts";

const rule = (over: Partial<ReflectedReferenceRule> = {}): ReflectedReferenceRule => ({
  offeringId: "SYNTHETIC-offering",
  korean: 25,
  math: 30,
  inquiry: 25,
  inquiryMode: "two_equal",
  eligibilityNote: false,
  ...over,
});
const scores = (over: Partial<ReflectedStudentScores> = {}): ReflectedStudentScores => ({
  korean: { percentile: 90, standard: 130 },
  math: { percentile: 80, standard: 135 },
  inquiry: [{ percentile: 70, standard: 60 }, { percentile: 60, standard: 66 }],
  ...over,
});
const value = (r: ReturnType<typeof schoolReflectedReference>) => {
  assert(r.status === "reference", JSON.stringify(r));
  return r.status === "reference" ? r.value : NaN;
};

Deno.test("two inquiry subjects share the inquiry weight and English is excluded", () => {
  // (90*25 + 80*30 + 65*25) / 80
  equal(value(schoolReflectedReference(rule(), scores())), (90 * 25 + 80 * 30 + 65 * 25) / 80);
  const r = schoolReflectedReference(rule(), scores());
  assert(r.status === "reference" && r.excluded.join() === "english,korean_history,bonus");
});

Deno.test("best inquiry subject by percentile or by standard score", () => {
  equal(
    value(schoolReflectedReference(rule({ inquiryMode: "best1_percentile" }), scores())),
    (90 * 25 + 80 * 30 + 70 * 25) / 80,
  );
  // 표준점수가 높은 과목(66)은 백분위 60이다
  equal(
    value(schoolReflectedReference(rule({ inquiryMode: "best1_standard" }), scores())),
    (90 * 25 + 80 * 30 + 60 * 25) / 80,
  );
});

Deno.test("real zero is kept and unreflected areas are not required", () => {
  equal(
    value(schoolReflectedReference(
      rule({ korean: 40, math: 0, inquiry: 0, inquiryMode: "none" }),
      scores({ korean: { percentile: 0, standard: 50 }, math: null, inquiry: [] }),
    )),
    0,
  );
});

Deno.test("missing reflected inputs wait instead of becoming zero", () => {
  const korean = schoolReflectedReference(rule(), scores({ korean: null }));
  equal(korean.status === "pending" && korean.reason, "korean_missing");
  const one = schoolReflectedReference(
    rule(),
    scores({ inquiry: [{ percentile: 70, standard: 60 }] }),
  );
  equal(one.status === "pending" && one.reason, "inquiry_two_subjects_required");
  const noStd = schoolReflectedReference(
    rule({ inquiryMode: "best1_standard" }),
    scores({ inquiry: [{ percentile: 70, standard: null }] }),
  );
  equal(noStd.status === "pending" && noStd.reason, "inquiry_missing");
});

Deno.test("invalid rules and scores are rejected", () => {
  for (
    const bad of [
      rule({ korean: -1 }),
      rule({ korean: 0, math: 0, inquiry: 0, inquiryMode: "none" }),
      rule({ inquiry: 0 }),
      rule({ inquiryMode: "none" }),
    ]
  ) {
    const r = schoolReflectedReference(bad, scores());
    equal(r.status === "pending" && r.reason, "rule_invalid");
  }
  const over = schoolReflectedReference(
    rule(),
    scores({ korean: { percentile: 101, standard: 1 } }),
  );
  equal(over.status === "pending" && over.reason, "korean_missing");
});

Deno.test("eligibility note travels with the reference value", () => {
  const r = schoolReflectedReference(rule({ eligibilityNote: true }), scores());
  assert(r.status === "reference" && r.eligibilityNote === true);
});
