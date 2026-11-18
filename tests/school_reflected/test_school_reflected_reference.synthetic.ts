import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  attachEligibilityConditions,
  attachSchoolReflected,
  attachYearCutoffs,
  eligibilityConditionsDto,
  schoolReflectedDto,
  yearCutoffDto,
} from "../../supabase/functions/_shared/jungsi/application/school_reflected_projection.ts";
import {
  eligibilityConditionsEntry,
  parseEligibilityConditions,
  parseSchoolReflectedAllowlist,
  parseYearCutoffs,
  schoolReflectedEntry,
  yearCutoffsEntry,
} from "../../supabase/functions/_shared/jungsi/infrastructure/school_reflected_allowlist.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

import {
  type ReflectedReferenceRule,
  type ReflectedStudentScores,
  schoolReflectedReference,
} from "../../supabase/functions/_shared/jungsi/application/school_reflected_reference.ts";
import { assert, equal } from "../edge/fixture.ts";
import {
  ACTIVE_REPORTS_SQL,
  MEMBER_RESULTS_FN_SQL,
  MEMBER_RESULTS_SQL,
  MEMBER_STATISTICS_FN_SQL,
  memberResultsReader,
  SupabaseMemberShortlistLegacy,
  SupabaseMemberStatisticsRows,
} from "../../supabase/functions/_shared/jungsi/infrastructure/member_shortlist_postgres.ts";
import type { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { nativeJsonText } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SavedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/saved_reference_projection.ts";
import { referenceCandidateGroups } from "../../supabase/functions/_shared/jungsi/application/reference_candidates.ts";

const rule = (
  over: Partial<ReflectedReferenceRule> = {},
): ReflectedReferenceRule => ({
  offeringId: "SYNTHETIC-offering",
  korean: 25,
  math: 30,
  inquiry: 25,
  inquiryMode: "two_equal",
  eligibilityNote: false,
  ...over,
});
const scores = (
  over: Partial<ReflectedStudentScores> = {},
): ReflectedStudentScores => ({
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
  equal(
    value(schoolReflectedReference(rule(), scores())),
    (90 * 25 + 80 * 30 + 65 * 25) / 80,
  );
  const r = schoolReflectedReference(rule(), scores());
  assert(
    r.status === "reference" &&
      r.excluded.join() === "english,korean_history,bonus",
  );
});

Deno.test("best inquiry subject by percentile or by standard score", () => {
  equal(
    value(
      schoolReflectedReference(
        rule({ inquiryMode: "best1_percentile" }),
        scores(),
      ),
    ),
    (90 * 25 + 80 * 30 + 70 * 25) / 80,
  );
  // 표준점수가 높은 과목(66)은 백분위 60이다
  equal(
    value(
      schoolReflectedReference(
        rule({ inquiryMode: "best1_standard" }),
        scores(),
      ),
    ),
    (90 * 25 + 80 * 30 + 60 * 25) / 80,
  );
});

Deno.test("real zero is kept and unreflected areas are not required", () => {
  equal(
    value(schoolReflectedReference(
      rule({ korean: 40, math: 0, inquiry: 0, inquiryMode: "none" }),
      scores({
        korean: { percentile: 0, standard: 50 },
        math: null,
        inquiry: [],
      }),
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
  equal(
    one.status === "pending" && one.reason,
    "inquiry_two_subjects_required",
  );
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

function eq(a: unknown, b: unknown) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(x + " !== " + y);
}
const payload = {
  format: "jungsi.school-reflected-reference-allowlist/v1",
  version: "v1",
  academic_year: 2027,
  rows: [["1000000001", 25, 30, 25, "2", 0], ["1000000002", 40, 0, 0, "n", 1]],
} as unknown as NativeObject;

Deno.test("allowlist parses and rejects malformed rows", () => {
  const rules = parseSchoolReflectedAllowlist(payload, "v1");
  eq(rules.size, 2);
  eq(rules.get("1000000002")?.inquiryMode, "none");
  for (
    const bad of [
      { ...payload, version: "v2" },
      { ...payload, rows: [["x", 1, 1, 1, "2", 0]] },
      { ...payload, rows: [["1000000001", 1, 1, 1, "q", 0]] },
      {
        ...payload,
        rows: [["1000000001", 1, 1, 1, "2", 0], [
          "1000000001",
          1,
          1,
          1,
          "2",
          0,
        ]],
      },
    ]
  ) {
    let threw = false;
    try {
      parseSchoolReflectedAllowlist(bad as unknown as NativeObject, "v1");
    } catch {
      threw = true;
    }
    eq(threw, true);
  }
});

Deno.test("setting is optional and strict", () => {
  const env = (v?: string) => ({
    get: (k: string) => k === "JUNGSI_SCHOOL_REFLECTED_ALLOWLIST" ? v : undefined,
  });
  eq(schoolReflectedEntry(env()), null);
  eq(schoolReflectedEntry(env("{}")), null);
  const ok = JSON.stringify({
    bucket: "b",
    object_key: "p/a.json",
    bytes: 10,
    sha256: "a".repeat(64),
    version: "v1",
  });
  eq(schoolReflectedEntry(env(ok))?.version, "v1");
  eq(schoolReflectedEntry(env(ok.replace('"v1"}', '"v1","x":1}'))), null);
});

Deno.test("attach adds values to analyses and nested candidate items only for allowed 2027 offerings", () => {
  const rules = parseSchoolReflectedAllowlist(payload, "v1");
  const result: NativeObject = {
    analyses: {
      "2027:1000000001": { offering_id: "2027:1000000001" },
      "2027:1000000009": { offering_id: "2027:1000000009" },
      "2026:1000000001": { offering_id: "2026:1000000001" },
    },
    candidates: {
      basic_university_groups: [{
        items: [{
          offering: {},
          assessment: { offering_id: "2027:1000000002" },
        }],
      }],
    },
  };
  const student = {
    korean: { percentile: 90, standard: 130 },
    math: { percentile: 80, standard: 135 },
    inquiry: [{ percentile: 70, standard: 60 }, {
      percentile: 60,
      standard: 66,
    }],
  };
  attachSchoolReflected(result, rules, student);
  const a = result.analyses as Record<string, NativeObject>;
  eq(
    (a["2027:1000000001"].school_reflected as NativeObject).value,
    (90 * 25 + 80 * 30 + 65 * 25) / 80,
  );
  eq("school_reflected" in a["2027:1000000009"], false);
  eq("school_reflected" in a["2026:1000000001"], false);
  const item = ((result.candidates as NativeObject)
    .basic_university_groups as NativeObject[])[0];
  const c = ((item.items as NativeObject[])[0].assessment as NativeObject)
    .school_reflected as NativeObject;
  eq([c.status, c.value, c.eligibility_note], ["reference", 90, true]);
});

Deno.test("public schema keeps the field and rejects a wrong shape", () => {
  const s = (schemas as unknown as { schemas: NativeObject }).schemas;
  const ops = [{ id: "x", contract_ref: "X" }];
  const projection = new PublicResponseProjection({
    format: "jungsi.public-response-schemas/v1",
    schemas: s,
    operations: [{
      ...ops[0],
      roots: {
        standard: { ref: "school_reflected", nullable: false },
        paid: { ref: "school_reflected", nullable: false },
      },
    }],
    auxiliary_roots: {
      error: { ref: "school_reflected", nullable: false },
      readiness: { ref: "school_reflected", nullable: false },
    },
  } as unknown as NativeObject, ops);
  const ok = schoolReflectedDto({
    status: "reference",
    offeringId: "o",
    value: 81.25,
    excluded: ["english", "korean_history", "bonus"],
    eligibilityNote: false,
  });
  eq(projection.project("x", "paid", ok), ok);
  const pending = schoolReflectedDto({
    status: "pending",
    offeringId: "o",
    reason: "korean_missing",
  });
  eq(projection.project("x", "paid", pending), pending);
  let threw = false;
  try {
    projection.project("x", "paid", { ...ok, status: "maybe" });
  } catch {
    threw = true;
  }
  eq(threw, true);
  // assessment 정의에도 선택 필드로 등록됨
  const a = s.assessment as NativeObject;
  eq((a.optional as string[]).includes("school_reflected"), true);
});

Deno.test("eligibility conditions parse, attach to 2027 analyses only and reject malformed rows", () => {
  const payload = {
    format: "jungsi.eligibility-conditions/v1",
    version: "eligibility-2027.v1",
    academic_year: 2027,
    notes: ["선택과목 제한 없음", "과학탐구 2과목"],
    rows: [
      [
        "1000000001",
        ["국어", "수학", "영어", "탐구"],
        ["미적분", "기하"],
        null,
        ["과학"],
        1,
      ],
      ["1000000002", [], null, 0, null, null],
    ],
  } as unknown as NativeObject;
  const map = parseEligibilityConditions(payload, "eligibility-2027.v1");
  equal(map.size, 2);
  const result = {
    analyses: {
      "2027:1000000001": { offering_id: "2027:1000000001" },
      "2027:1000000002": { offering_id: "2027:1000000002" },
      "2027:1000000009": { offering_id: "2027:1000000009" },
      "2026:1000000001": { offering_id: "2026:1000000001" },
    },
  } as unknown as NativeObject;
  attachEligibilityConditions(result, map);
  const a = result.analyses as Record<string, NativeObject>;
  equal(
    JSON.stringify(a["2027:1000000001"].eligibility_conditions),
    JSON.stringify({
      required_areas: ["국어", "수학", "영어", "탐구"],
      math_choices: ["미적분", "기하"],
      math_note: null,
      inquiry_domains: ["과학"],
      inquiry_note: "과학탐구 2과목",
    }),
  );
  equal(
    JSON.stringify(a["2027:1000000002"].eligibility_conditions),
    JSON.stringify({
      required_areas: [],
      math_choices: null,
      math_note: "선택과목 제한 없음",
      inquiry_domains: null,
      inquiry_note: null,
    }),
  );
  equal("eligibility_conditions" in a["2027:1000000009"], false);
  equal("eligibility_conditions" in a["2026:1000000001"], false);
  for (
    const bad of [
      { ...payload, version: "other" },
      { ...payload, rows: [["1000000001", ["수학Ⅰ"], null, null, null, null]] },
      { ...payload, rows: [["1000000001", null, null, 7, null, null]] },
      { ...payload, rows: [["1000000001", null, null, null, null]] },
    ]
  ) {
    let threw = false;
    try {
      parseEligibilityConditions(
        bad as unknown as NativeObject,
        "eligibility-2027.v1",
      );
    } catch {
      threw = true;
    }
    assert(threw);
  }
  const env = (v?: string) => ({
    get: (k: string) => (k === "JUNGSI_ELIGIBILITY_CONDITIONS" ? v : undefined),
  });
  equal(eligibilityConditionsEntry(env() as never), null);
  equal(eligibilityConditionsEntry(env("{}") as never), null);
});

Deno.test("public schema accepts eligibility_conditions and rejects unknown subject names", () => {
  const s = (schemas as unknown as { schemas: NativeObject }).schemas;
  const ops = [{ id: "x", contract_ref: "X" }];
  const root = { ref: "eligibility_conditions", nullable: false };
  const projection = new PublicResponseProjection(
    {
      format: "jungsi.public-response-schemas/v1",
      schemas: s,
      operations: [{ ...ops[0], roots: { standard: root, paid: root } }],
      auxiliary_roots: { error: root, readiness: root },
    } as unknown as NativeObject,
    ops,
  );
  const ok = eligibilityConditionsDto({
    requiredAreas: ["국어", "수학"],
    mathChoices: ["미적분"],
    mathNote: null,
    inquiryDomains: ["과학"],
    inquiryNote: "과학탐구 2과목",
  });
  equal(
    JSON.stringify(projection.project("x", "paid", ok)),
    JSON.stringify(ok),
  );
  let threw = false;
  try {
    projection.project("x", "paid", { ...ok, math_choices: ["수학Ⅰ"] });
  } catch {
    threw = true;
  }
  assert(threw);
  assert(
    ((s.assessment as NativeObject).optional as string[]).includes(
      "eligibility_conditions",
    ),
  );
});

Deno.test("year cutoffs parse newest year first, attach to 2027 analyses only and reject malformed rows", () => {
  const payload = {
    format: "jungsi.year-cutoff-references/v1",
    version: "year-cutoffs-2027.v1",
    academic_year: 2027,
    metrics: ["최종등록자 70%컷", "최종컷"],
    rows: [["1000000001", [[
      2025,
      "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      1,
      "8.25",
    ], [
      2026,
      "observation:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      0,
      "5.7",
    ]]]],
  } as unknown as NativeObject;
  const map = parseYearCutoffs(payload, "year-cutoffs-2027.v1");
  equal(map.get("1000000001")!.map((c) => c.academicYear).join(), "2026,2025");
  const result = {
    analyses: {
      "2027:1000000001": { offering_id: "2027:1000000001" },
      "2027:1000000009": { offering_id: "2027:1000000009" },
      "2026:1000000001": { offering_id: "2026:1000000001" },
    },
  } as unknown as NativeObject;
  attachYearCutoffs(result, map);
  const a = result.analyses as Record<string, NativeObject>;
  equal(
    JSON.stringify(a["2027:1000000001"].year_cutoffs),
    JSON.stringify([
      {
        academic_year: 2026,
        published_metric: "최종등록자 70%컷",
        cutoff_top_percent: "5.7",
        observation_id:
          "observation:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        academic_year: 2025,
        published_metric: "최종컷",
        cutoff_top_percent: "8.25",
        observation_id:
          "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ]),
  );
  equal("year_cutoffs" in a["2027:1000000009"], false);
  equal("year_cutoffs" in a["2026:1000000001"], false);
  for (
    const items of [
      [[
        2027,
        "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        0,
        "5.7",
      ]],
      [[2026, "observation:short", 0, "5.7"]],
      [[
        2026,
        "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        5,
        "5.7",
      ]],
      [[
        2026,
        "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        0,
        "101",
      ]],
      [[
        2026,
        "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        0,
        5.7,
      ]],
      [[
        2026,
        "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        0,
        "5.7",
      ], [
        2025,
        "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        1,
        "6",
      ]],
    ]
  ) {
    let threw = false;
    try {
      parseYearCutoffs(
        {
          ...payload,
          rows: [["1000000001", items]],
        } as unknown as NativeObject,
        "year-cutoffs-2027.v1",
      );
    } catch {
      threw = true;
    }
    assert(threw);
  }
  const env = (v?: string) => ({
    get: (k: string) => (k === "JUNGSI_YEAR_CUTOFF_REFERENCES" ? v : undefined),
  });
  equal(yearCutoffsEntry(env() as never), null);
  equal(yearCutoffsEntry(env("[]") as never), null);
});

Deno.test("year cutoff tags mark a combined-track release and the mean score component", () => {
  const id = (c: string) => "observation:" + c.repeat(64);
  const base = {
    format: "jungsi.year-cutoff-references/v1",
    version: "year-cutoffs-2027.v4",
    academic_year: 2027,
    metrics: ["평균", "70%컷"],
  };
  const map = parseYearCutoffs(
    {
      ...base,
      rows: [["1000000001", [
        [2025, id("a"), 1, "8.25", { published_scope: "combined_tracks" }],
        [2024, id("b"), 0, "9", { score_component: "csat_converted" }],
        [2024, id("c"), 0, "9.5", { score_component: "selection_total" }],
        [2026, id("d"), 1, "7"],
      ]]],
    } as unknown as NativeObject,
    "year-cutoffs-2027.v4",
  );
  const dto = map.get("1000000001")!.map(yearCutoffDto);
  equal(dto[0].published_scope, undefined);
  equal("score_component" in dto[0], false);
  equal(dto[1].published_scope, "combined_tracks");
  equal(dto.filter((d) => d.score_component === "csat_converted").length, 1);
  equal(dto.filter((d) => d.score_component === "selection_total").length, 1);
  for (
    const tags of [
      {},
      null,
      [],
      { published_scope: "general" },
      { score_component: "mean" },
      { other: "x" },
    ]
  ) {
    let threw = false;
    try {
      parseYearCutoffs(
        {
          ...base,
          rows: [["1000000001", [[2025, id("a"), 1, "8.25", tags]]]],
        } as never,
        "year-cutoffs-2027.v4",
      );
    } catch {
      threw = true;
    }
    assert(threw, JSON.stringify(tags));
  }
});

Deno.test("public schema accepts year_cutoffs and rejects a malformed percent", () => {
  const s = (schemas as unknown as { schemas: NativeObject }).schemas;
  const ops = [{ id: "x", contract_ref: "X" }];
  const root = { ref: "year_cutoff", nullable: false };
  const projection = new PublicResponseProjection(
    {
      format: "jungsi.public-response-schemas/v1",
      schemas: s,
      operations: [{ ...ops[0], roots: { standard: root, paid: root } }],
      auxiliary_roots: { error: root, readiness: root },
    } as unknown as NativeObject,
    ops,
  );
  const ok = yearCutoffDto({
    academicYear: 2026,
    observationId: "observation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    publishedMetric: "최종컷",
    cutoffTopPercent: "5.7",
  });
  equal(
    JSON.stringify(projection.project("x", "paid", ok)),
    JSON.stringify(ok),
  );
  let threw = false;
  try {
    projection.project("x", "paid", { ...ok, cutoff_top_percent: "5.7%" });
  } catch {
    threw = true;
  }
  assert(threw);
  assert(
    ((s.assessment as NativeObject).optional as string[]).includes(
      "year_cutoffs",
    ),
  );
});

// 참고 누백 상한(대표님 결정 2026-11-16): 점수를 낼 수 없는 질량(전체-점수 정의)을 모두 위로 둔 값.
const tailContext: NativeObject = {
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
};
const tailEvidence: NativeObject = Object.fromEntries(
  [
    "source_csv_sha256",
    "source_cdf_sha256",
    "definition_sha256",
    "shared_proof_sha256",
    "binder_sha256",
    "independent_sha256",
  ]
    .map((k) => [k, "b".repeat(64)]),
);
async function tailCurve(whole: [string, string, string]) {
  const p: NativeObject = {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "SYNTHETIC-tail.v1",
    context: tailContext,
    evidence: tailEvidence,
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + "d".repeat(64),
      weight_decimal_scale: 1,
      eligible_weight_units: "15",
      whole_mass_decimal: whole[0],
      whole_mass_numerator: whole[1],
      whole_mass_denominator: whole[2],
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    rows: [
      {
        score_numerator: "10",
        score_denominator: "1",
        strict_weight_units: "5",
        tie_weight_units: "10",
        inclusive_weight_units: "15",
      },
      {
        score_numerator: "20",
        score_denominator: "1",
        strict_weight_units: "0",
        tie_weight_units: "5",
        inclusive_weight_units: "5",
      },
    ],
  };
  const bytes = new TextEncoder().encode(nativeJsonText(p));
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
  return await SavedReferenceTailProjection.bind(bytes, {
    sha256,
    bytes: bytes.length,
    maxBytes: 65536,
    context: tailContext,
    evidence: tailEvidence,
  });
}
const tailIdentity = {
  academic_year: 2027,
  exam_id: "SYNTHETIC-mock",
  exam_type: "september_mock",
  source_pack_version: "SYNTHETIC-pack",
  rule_version: "SYNTHETIC-rule",
  score_scale_id: "SYNTHETIC-native",
};

Deno.test("reference percentile upper bound adds unscored mass above and equals the lower bound without it", async () => {
  // 전체 3.00001, 점수 정의 1.5, 미정의 1.50001
  const curve = await tailCurve(["3.00001", "300001", "100000"]);
  const a = curve.query(exact(10), tailIdentity)!;
  equal(a.estimated_upper_cumulative_percent_all_examinees, "49.999833333889");
  equal(a.estimated_upper_cumulative_percent_upper_bound, "100.000000000000");
  const b = curve.query(exact(20), tailIdentity)!;
  equal(b.estimated_upper_cumulative_percent_all_examinees, "16.666611111296");
  equal(b.estimated_upper_cumulative_percent_upper_bound, "66.666777777407");
  const none = await tailCurve(["1.5", "3", "2"]);
  const c = none.query(exact(20), tailIdentity)!;
  equal(
    c.estimated_upper_cumulative_percent_upper_bound,
    c.estimated_upper_cumulative_percent_all_examinees,
  );
});

Deno.test("reference candidates pass only a valid upper bound", () => {
  const row = (id: string) => ({
    offering_id: id,
    university_id: "U1",
    university_name: "SYNTHETIC",
  });
  const analysis = (n: string, u?: string) => ({
    status: "pending",
    conversion: { reason_code: "reference_conversion_not_production_approved" },
    reference_percentile: {
      status: "reference_estimated",
      metric: "estimated_upper_cumulative_percent_all_examinees",
      estimated_upper_cumulative_percent_all_examinees: n,
      ...(u === undefined ? {} : { estimated_upper_cumulative_percent_upper_bound: u }),
      calculation_review_scope: "same_exam_mathematical_reference",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
  });
  const out = referenceCandidateGroups(
    [row("2027:1"), row("2027:2"), row("2027:3"), row("2027:4")],
    {
      "2027:1": analysis("12.3", "14.8"),
      "2027:2": analysis("12.3", "11"),
      "2027:3": analysis("12.3", "100.1"),
      "2027:4": analysis("12.3"),
    },
  );
  const groups = out.university_groups as NativeObject[];
  const rows = (groups[0].offerings as NativeObject[]).map((x) =>
    x.reference_percentile as NativeObject
  );
  equal(rows[0].estimated_upper_cumulative_percent_upper_bound, "14.8");
  for (const r of rows.slice(1)) {
    assert(!("estimated_upper_cumulative_percent_upper_bound" in r));
  }
});

Deno.test("public schema accepts the reference upper bound and rejects a malformed one", () => {
  const s = (schemas as unknown as { schemas: NativeObject }).schemas;
  const ops = [{ id: "x", contract_ref: "X" }];
  const root = { ref: "reference_percentile", nullable: false };
  const projection = new PublicResponseProjection(
    {
      format: "jungsi.public-response-schemas/v1",
      schemas: s,
      operations: [{ ...ops[0], roots: { standard: root, paid: root } }],
      auxiliary_roots: { error: root, readiness: root },
    } as unknown as NativeObject,
    ops,
  );
  const ok = {
    status: "reference_estimated",
    estimated_upper_cumulative_percent_all_examinees: "12.3",
    estimated_upper_cumulative_percent_upper_bound: "14.8",
    metric: "estimated_upper_cumulative_percent_all_examinees",
    denominator_kind: "same_year_original_model_whole_exact_mass",
    calculation_review_scope: "same_exam_mathematical_reference",
    production_allowed: false,
    actual_admission_full_total_approved: false,
  };
  equal(
    JSON.stringify(projection.project("x", "paid", ok)),
    JSON.stringify(ok),
  );
  let threw = false;
  try {
    projection.project("x", "paid", {
      ...ok,
      estimated_upper_cumulative_percent_upper_bound: "14.8%",
    });
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("member saved results 015 reader switch keeps the reviewed SQL unless fn_v2", async () => {
  equal(memberResultsReader("fn_v2"), "fn_v2");
  for (const v of [undefined, null, "", "sql", "FN_V2", " fn_v2", "fn_v2 "]) {
    equal(memberResultsReader(v), "sql");
  }
  assert(
    MEMBER_RESULTS_FN_SQL.includes(
      "jungsi_backend.read_member_saved_results_v2($1,$2,$3::text::jsonb,$4,$5::bigint)",
    ),
  );
  const owner = "aaaaaaaa-0000-4000-8000-000000000001";
  const seen: { owner: string; sql: string; args: readonly unknown[] }[] = [];
  const transport = {
    read: (o: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        query: (sql: string, args: readonly unknown[] = []) => {
          seen.push({ owner: o, sql, args });
          return Promise.resolve([]);
        },
      }),
  } as unknown as SupabaseSqlTransport;
  for (const reader of ["sql", "fn_v2"] as const) {
    const legacy = new SupabaseMemberShortlistLegacy(
      transport,
      1048576,
      100,
      null,
      reader,
    );
    equal(
      await legacy.read(owner, 2027, ["SYNTHETIC-a"], "SYNTHETIC-r", 3),
      null,
    );
  }
  equal(seen.length, 2);
  equal(seen[0].sql, MEMBER_RESULTS_SQL);
  equal(seen[1].sql, MEMBER_RESULTS_FN_SQL);
  equal(JSON.stringify(seen[1].args), JSON.stringify(seen[0].args));
  equal(
    JSON.stringify(seen[0].args),
    JSON.stringify([owner, "2027", '["SYNTHETIC-a"]', "SYNTHETIC-r", "3"]),
  );
  equal(seen[1].owner, owner);
  // statistics.read: the old aggregate skips non-UUID synthetic owners; the 015b rows
  // keep the member's own ID and accept only UUID-shaped keys for others.
  assert(ACTIVE_REPORTS_SQL.includes("WHERE r.owner_id ~ '^[0-9a-f]{8}-"));
  assert(
    MEMBER_STATISTICS_FN_SQL.includes(
      "jungsi_backend.read_member_statistics_rows_v1($1)",
    ),
  );
  const other = "0f0e0d0c-0b0a-4908-8706-050403020100";
  const row = (key: string) => [
    "SYNTHETIC-r",
    key,
    "SYNTHETIC-p",
    "2",
    '{"analyses":{},"shortlist":{}}',
    "2026-11-15T00:00:00.000001Z",
  ];
  const stats = (rows: unknown[][]) =>
    new SupabaseMemberStatisticsRows({
      read: (o: string, work: (tx: unknown) => Promise<unknown>) => {
        equal(o, owner);
        return work({
          query: (sql: string, args: readonly unknown[]) => {
            equal(sql, MEMBER_STATISTICS_FN_SQL);
            equal(JSON.stringify(args), JSON.stringify([owner]));
            return Promise.resolve(rows);
          },
        });
      },
    } as unknown as SupabaseSqlTransport, 1048576);
  const got = await stats([row(owner), row(other)]).activeReports(owner);
  equal(
    JSON.stringify(got.map((r) => [r.owner_id, r.revision, r.updated_at])),
    JSON.stringify([
      [owner, 2, "2026-11-15T00:00:00.000001Z"],
      [other, 2, "2026-11-15T00:00:00.000001Z"],
    ]),
  );
  let refused = false;
  try {
    await stats([row("SYNTHETIC_LEGACY_OWNER")]).activeReports(owner);
  } catch {
    refused = true;
  }
  assert(refused);
});
