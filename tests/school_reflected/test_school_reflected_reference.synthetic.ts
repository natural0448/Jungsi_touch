import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  attachEligibilityConditions,
  attachSchoolReflected,
  eligibilityConditionsDto,
  schoolReflectedDto,
} from "../../supabase/functions/_shared/jungsi/application/school_reflected_projection.ts";
import {
  eligibilityConditionsEntry,
  parseEligibilityConditions,
  parseSchoolReflectedAllowlist,
  schoolReflectedEntry,
} from "../../supabase/functions/_shared/jungsi/infrastructure/school_reflected_allowlist.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

import {
  type ReflectedReferenceRule,
  type ReflectedStudentScores,
  schoolReflectedReference,
} from "../../supabase/functions/_shared/jungsi/application/school_reflected_reference.ts";
import { assert, equal } from "../edge/fixture.ts";

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
    get: (k: string) =>
      k === "JUNGSI_SCHOOL_REFLECTED_ALLOWLIST" ? v : undefined,
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
