import { syncPromise } from "./fixture.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { SyntheticUniversityData } from "./synthetic_university.ts";
import { assert, equal } from "./fixture.ts";
async function result(f: SyntheticUniversityData, profile = f.profile()) {
  return await new UniversityScoringService(f).calculate(f.offering, profile);
}
Deno.test("university scoring actual same exam is independent of aggregate model and admissions judgments", async () => {
  const f = new SyntheticUniversityData(), r = await result(f);
  assert(r.ready, r.state.reason_code ?? "");
  equal(r.state.score!.toString(), "30");
  equal(r.dto().score_basis, "actual_exam");
  equal(f.calls, ["pack", "conversion"]);
  equal(r.dto().converted_score, "30.00");
});
Deno.test("university scoring immutable internal values and public DTO are isolated", async () => {
  const f = new SyntheticUniversityData(),
    p = f.profile(),
    before = nativeJsonText(p),
    r = await result(f, p);
  assert(r.ready);
  equal(nativeJsonText(p), before);
  assert(
    Object.isFrozen(r) && Object.isFrozen(r.state) &&
      Object.isFrozen(r.state.values),
  );
  const dto = r.dto();
  (dto.table_versions as unknown[]).push("SYNTHETIC-edit");
  equal(r.dto().table_versions, []);
  for (
    const key of [
      "score",
      "exact_score",
      "values",
      "context",
      "reported_sources",
      "trace",
    ]
  ) assert(!Object.hasOwn(dto, key));
  assert((r.internalCalculation().exact_score as NativeObject).numerator === 30n);
});
Deno.test("university scoring binds all school campus department track and group dimensions", async () => {
  for (
    const field of ["university_id", "campus", "department", "track", "group"]
  ) {
    const f = new SyntheticUniversityData();
    f.bundle = {
      ...f.bundle!,
      bindings: f.bundle!.bindings.map((b) => ({
        ...b,
        [field]: "SYNTHETIC-other",
      })),
    };
    equal((await result(f)).state.reason_code, "conversion_context_mismatch");
  }
});
Deno.test("university scoring binds year exam pack and optional rule metadata", async () => {
  for (
    const [field, value, code] of [
      ["academicYear", 2026, "conversion_year_mismatch"],
      ["examId", "SYNTHETIC-other", "conversion_exam_mismatch"],
      ["sourcePackVersion", "SYNTHETIC-other", "conversion_exam_mismatch"],
    ] as const
  ) {
    const f = new SyntheticUniversityData();
    f.bundle = { ...f.bundle!, [field]: value };
    equal((await result(f)).state.reason_code, code);
  }
  const f = new SyntheticUniversityData();
  f.offering = { ...f.offering, academic_year: 2026 };
  equal((await result(f)).state.reason_code, "year_bridge_required");
});
Deno.test("university scoring rejects duplicate bindings unapproved release and synthetic rules", async () => {
  const f = new SyntheticUniversityData();
  f.bundle = {
    ...f.bundle!,
    bindings: [...f.bundle!.bindings, ...f.bundle!.bindings],
  };
  equal((await result(f)).state.reason_code, "RULE_BINDING_AMBIGUOUS");
  const g = new SyntheticUniversityData();
  g.bundle = { ...g.bundle!, status: "draft" };
  equal((await result(g)).state.reason_code, "conversion_release_not_approved");
  for (
    const patch of [{ review_status: "source_verified" }, {
      data_kind: "synthetic",
    }] as NativeObject[]
  ) {
    const h = new SyntheticUniversityData();
    h.bundle = h.release({ ...h.rawRule, ...patch });
    equal((await result(h)).state.reason_code, "RULE_NOT_APPROVED");
  }
});
Deno.test("university mock scoring requires exact approved compatibility including source exam type", async () => {
  const f = new SyntheticUniversityData(),
    raw = cloneNativeJson(f.rawPack);
  (raw.exam as NativeObject).exam_type = "september_mock";
  f.pack = new NativeExamPack(raw);
  equal((await result(f)).state.reason_code, "mock_compatibility_not_approved");
  const b = f.bundle!;
  f.bundle = {
    ...b,
    mockCompatibility: {
      status: "approved",
      version: "SYNTHETIC-compat.v1",
      source_exam_id: f.pack.examId,
      source_pack_version: f.pack.packVersion,
      source_exam_type: "september_mock",
      rule_exam_id: b.examId,
      rule_pack_version: b.sourcePackVersion,
    },
  };
  const ready = await result(f);
  assert(ready.ready);
  equal(ready.dto().score_basis, "mock_exam");
  f.bundle = {
    ...f.bundle,
    mockCompatibility: {
      ...f.bundle.mockCompatibility!,
      source_pack_version: "SYNTHETIC-other",
    },
  };
  equal((await result(f)).state.reason_code, "mock_compatibility_not_approved");
});
Deno.test("missing official percentile is pending and entered actual zero remains zero", async () => {
  const f = new SyntheticUniversityData();
  f.bundle = f.release({
    ...f.rawRule,
    inputs: {
      inquiry1_percentile: { type: "number", min: 0, max: 100, integer: true },
    },
    nodes: { total: { op: "input", field: "inquiry1_percentile" } },
  });
  equal((await result(f)).state.reason_code, "REQUIRED_INPUT_MISSING");
  const p = f.profile();
  (p.scores.inquiry as NativeObject[])[0].percentile = 0;
  const r = await result(f, p);
  assert(r.ready);
  equal(r.state.score!.toString(), "0");
  equal(r.state.reported_sources.inquiry1_percentile, "student_report");
});
Deno.test("official mapped grade is preserved and contradictory student report is rejected", async () => {
  const f = new SyntheticUniversityData();
  f.bundle = f.release({
    ...f.rawRule,
    inputs: { korean_grade: { type: "number", min: 1, max: 9, integer: true } },
    nodes: { total: { op: "input", field: "korean_grade" } },
  });
  const r = await result(f);
  assert(r.ready);
  equal(r.state.score!.toString(), "1");
  equal(r.state.reported_sources.korean_grade, "verified_exam_mapping");
  const p = f.profile();
  (p.scores.korean as NativeObject).grade = 9;
  equal((await result(f, p)).state.reason_code, "reported_grade_conflict");
});
Deno.test("university score retains partial version context while invalid public max type stays pending", async () => {
  const f = new SyntheticUniversityData();
  f.bundle = f.release({
    ...f.rawRule,
    official_max_score: new JsonFloat("36.0"),
  });
  const r = await result(f);
  equal(r.state.reason_code, "conversion_release_invalid");
  assert(r.state.rule_version !== null);
  assert(r.state.score === null);
  equal(r.dto().converted_score, null);
});
Deno.test("unsupported rule input is pending before calculation and float standard score is not an integer", async () => {
  const f = new SyntheticUniversityData();
  f.bundle = f.release({
    ...f.rawRule,
    inputs: { private_extra: { type: "number", min: 0, max: 100 } },
    nodes: { total: { op: "input", field: "private_extra" } },
  });
  equal((await result(f)).state.reason_code, "unsupported_conversion_input");
  const g = new SyntheticUniversityData(), p = g.profile();
  (p.scores.korean as NativeObject).standard_score = new JsonFloat("9e0");
  equal((await result(g, p)).state.reason_code, "invalid_integer");
});
Deno.test("university pack mismatch and provider error keep safe pending codes", async () => {
  const f = new SyntheticUniversityData(), p = f.profile();
  p.scores.pack_version = "SYNTHETIC-other";
  equal((await result(f, p)).state.reason_code, "conversion_pack_mismatch");
  const g = new SyntheticUniversityData();
  g.getConversion = () =>
    syncPromise(() => {
      throw new AccessError("storage_unavailable", 503);
    });
  equal((await result(g)).state.reason_code, "storage_unavailable");
});
Deno.test("university approved executed rank rule explains best inquiry without publishing weights", async () => {
  const f = new SyntheticUniversityData();
  f.bundle = f.release({
    ...f.rawRule,
    inputs: {
      inquiry1_standard_score: { type: "number", min: 1, max: 9 },
      inquiry2_standard_score: { type: "number", min: 1, max: 9 },
    },
    nodes: {
      total: {
        op: "rank_weighted",
        args: [{ op: "input", field: "inquiry1_standard_score" }, {
          op: "input",
          field: "inquiry2_standard_score",
        }],
        weights: ["1"],
      },
    },
  });
  const r = await result(f);
  assert(r.ready);
  equal(r.state.score!.toString(), "7");
  equal(r.state.explanations.map((e) => e.code), ["best_inquiry_one"]);
  assert(!nativeJsonText(r.state.explanations).includes("weights"));
});
