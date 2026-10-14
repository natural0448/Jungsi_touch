/** Reuse the Python synthetic pack; never an official or publishable source. */
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { ContractError } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { assert, equal } from "./fixture.ts";
import { syntheticNativePackData as data } from "./synthetic_exam_pack.ts";

function request() {
  return {
    exam_id: "SYNTHETIC-mock",
    korean: { standard_score: 5, choice: "가상국어선택" },
    math: { standard_score: 6, choice: "가상수학선택" },
    inquiry: [{ subject: "가상탐구가", standard_score: 7 }, {
      subject: "가상탐구나",
      standard_score: 8,
    }],
    english_grade: 3,
  };
}
function set(root: unknown, path: string[], value: unknown) {
  let at = root as Record<string, unknown>;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path[path.length - 1]] = value;
}
function denied(run: () => unknown, expected: string) {
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof ContractError);
  equal(error.code, expected);
}
Deno.test("native exam validates the existing Python invented fixture and four subjects", () => {
  const pack = new NativeExamPack(data()), result = pack.analyze(request());
  equal(pack.examId, "SYNTHETIC-mock");
  equal(result.packVersion, "SYNTHETIC-pack.v1");
  equal(result.totalStandardScore, 26);
  equal(result.subjects.map((s) => s.grade), [5, 4, 3, 2]);
  equal(result.subjects[0].top_percent_exclusive, "44.444444");
  equal(result.subjects[0].top_percent_inclusive, "55.555556");
  equal(result.absoluteGrades, { "영어": 3 });
  equal(result.scoreBasis, "mock_exam");
});
Deno.test("native overall uses inquiry sum and never substitutes inquiry average", () => {
  const result = new NativeExamPack(data()).analyze(request());
  equal(result.totalStandardScore, 5 + 6 + 7 + 8);
  assert(result.totalStandardScore !== 5 + 6 + (7 + 8) / 2);
});
Deno.test("native pack owns a validated source copy", () => {
  const source = data(), pack = new NativeExamPack(source);
  set(source, ["subjects", "국어", "denominator"], 999);
  equal(pack.analyze(request()).subjects[0].top_percent_inclusive, "55.555556");
});
Deno.test("native pack rejects exam mismatch and unobserved standard scores", () => {
  const pack = new NativeExamPack(data());
  denied(() => pack.analyze({ ...request(), exam_id: "SYNTHETIC-other" }), "exam_mismatch");
  const p = request();
  p.korean.standard_score = 10;
  denied(() => pack.analyze(p), "unobserved_standard_score");
});
Deno.test("native pack rejects duplicate normalized inquiry and unknown choices", () => {
  const pack = new NativeExamPack(data()), p = request();
  p.inquiry[1].subject = "가상 탐구가";
  denied(() => pack.analyze(p), "duplicate_inquiry");
  const q = request();
  q.korean.choice = "SYNTHETIC-UNKNOWN";
  denied(() => pack.analyze(q), "invalid_choice");
});
Deno.test("native pack rejects unknown subject and inquiry with the original safe code", () => {
  const pack = new NativeExamPack(data()), p = request();
  denied(() => pack.subjectResult("SYNTHETIC-MISSING", 5), "invalid_subject");
  p.inquiry[0].subject = "SYNTHETIC-MISSING";
  denied(() => pack.analyze(p), "invalid_inquiry");
});
Deno.test("native input keeps integer float and boolean distinct", () => {
  const pack = new NativeExamPack(data());
  for (const value of [true, new JsonFloat("5.0"), "5"]) {
    const p = request();
    set(p, ["korean", "standard_score"], value);
    denied(() => pack.analyze(p), "invalid_integer");
  }
});
Deno.test("native reported grade and percentile checks never derive a report percentile from tail", () => {
  const pack = new NativeExamPack(data()), a = request();
  set(a, ["korean", "grade"], 1);
  denied(() => pack.analyze(a), "reported_grade_conflict");
  const b = request();
  set(b, ["korean", "percentile"], false);
  denied(() => pack.analyze(b), "invalid_reported_percentile");
  const c = request();
  set(c, ["korean", "percentile"], 90);
  equal(pack.analyze(c).subjects[0].top_percent_inclusive, "55.555556");
});
Deno.test("native pack rejects cumulative frequency gender and published count drift", () => {
  const mutations: [string[], unknown, string][] = [
    [["subjects", "국어", "frequencies", "0", "cumulative_count"], 8, "cumulative_mismatch"],
    [["subjects", "국어", "frequencies", "0", "male_count"], 2, "gender_count_mismatch"],
    [["subjects", "국어", "published_total"], 8, "frequency_total_mismatch"],
    [["subjects", "국어", "grades", "0", "published_percent"], "0", "grade_percent_mismatch"],
  ];
  for (const [path, value, code] of mutations) {
    const source = data();
    set(source, path, value);
    denied(() => new NativeExamPack(source), code);
  }
});
Deno.test("native pack rejects noninteger counts without coercion", () => {
  for (const value of [true, new JsonFloat("1.0"), "1"]) {
    const source = data();
    set(source, ["subjects", "국어", "frequencies", "0", "count"], value);
    denied(() => new NativeExamPack(source), "invalid_integer");
  }
});
Deno.test("native pack keeps source and target population constraints coupled", () => {
  const mutations: [string[], unknown, string][] = [
    [["participants", "choice_counts", "국어", "가상국어선택"], 8, "choice_total_mismatch"],
    [["participants", "two_inquiry_derived", "total"], 8, "two_inquiry_count_mismatch"],
    [["participants", "target_population", "count_lower_bound"], 8, "population_bounds_mismatch"],
    [["participants", "target_population", "count"], 8, "invalid_population_count"],
    [["sources", "0", "sha256"], "0".repeat(63), "invalid_source_hash"],
  ];
  for (const [path, value, code] of mutations) {
    const source = data();
    set(source, path, value);
    denied(() => new NativeExamPack(source), code);
  }
});
Deno.test("native unknown target count stays null rather than actual zero", () => {
  const source = data();
  set(source, ["participants", "target_population", "count"], null);
  equal(new NativeExamPack(source).populationBounds().count, null);
});
Deno.test("native published decimal percentage retains its lexical numeric type", () => {
  const source = data();
  set(source, ["subjects", "국어", "grades", "0", "published_percent"], new JsonFloat("11.11"));
  equal(new NativeExamPack(source).analyze(request()).totalStandardScore, 26);
});
Deno.test("native same-exam reported mapping is used and conflicting input is rejected", () => {
  const source = data();
  set(source, ["subjects", "국어", "reported_scores"], {
    "5": { percentile: 67, grade: 5, source_ref: "SYNTHETIC:mapping" },
  });
  const pack = new NativeExamPack(source), p = request();
  set(p, ["korean", "percentile"], 67);
  equal(pack.reportedScore("국어", 5).percentile, 67);
  pack.analyze(p);
  set(p, ["korean", "percentile"], 68);
  denied(() => pack.analyze(p), "reported_percentile_conflict");
});
