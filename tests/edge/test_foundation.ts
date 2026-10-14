import {
  displayExact,
  exact,
  roundExact,
} from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  canonicalIntegerKeys,
  JsonFloat,
  parseNativeJson,
} from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import {
  calendarDate,
  seoulDateRange,
  utcInstant,
  utcText,
} from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { ConversionRule } from "../../supabase/functions/_shared/jungsi/domain/conversion.ts";
import { ExactFrequencyDistribution } from "../../supabase/functions/_shared/jungsi/domain/percentile.ts";
import { calculateSyntheticOffering } from "../../supabase/functions/_shared/jungsi/application/research_offering.ts";
import { assert, equal, rejects, syntheticFixture } from "./fixture.ts";
Deno.test("exact rational keeps large integers and sign", () => {
  equal(exact("9007199254740993.125").toString(), "72057594037927945/8");
  equal(exact("-.5e+1").toString(), "-5");
  equal(exact("1_000.00").toString(), "1000");
});
Deno.test("five modes distinguish signed ties", () => {
  const n = exact("-1.245");
  equal(
    ["half_up", "half_even", "truncate", "floor", "ceil"].map((m) =>
      displayExact(roundExact(n, 2, m), 2)
    ),
    ["-1.25", "-1.24", "-1.24", "-1.25", "-1.24"],
  );
});
Deno.test("binary float, bool and nonfinite inputs fail", () => {
  for (const n of [true, false, 1.25, NaN, Infinity, null, "NaN"]) {
    rejects(() => exact(n), "INVALID_NUMBER");
  }
});
Deno.test("decimal JSON 1.0 stays float and cannot become integer", () => {
  const f = parseNativeJson("1.0");
  assert(f instanceof JsonFloat);
  rejects(() => exact(f), "INVALID_NUMBER");
  equal(exact(parseNativeJson("1")).toString(), "1");
});
Deno.test("native integer precision survives beyond Number", () =>
  equal(exact(parseNativeJson("9007199254740993")).toString(), "9007199254740993"));
Deno.test("decoded duplicate object keys fail", () =>
  rejects(() => parseNativeJson('{"1":0,"\\u0031":1}'), "native_json_duplicate_key"));
Deno.test("integer keys reject collisions and noncanonical forms", () => {
  for (const k of ["01", "+1", "-1", " 1", "1.0"]) {
    rejects(() => canonicalIntegerKeys({ [k]: 0 }), "analysis_release_invalid");
  }
  equal(canonicalIntegerKeys({ "0": 0, "1": null }).size, 2);
});
Deno.test("invalid JSON finite constants and trailing values fail", () => {
  for (const s of ["NaN", "Infinity", "01", "{}{}", "[1,]", '{"x":1,}']) {
    let failed = false;
    try {
      parseNativeJson(s);
    } catch {
      failed = true;
    }
    assert(failed, s);
  }
});
Deno.test("microsecond timezone conversion crosses calendar day", () =>
  equal(utcText(utcInstant("2027-01-01T00:00:00.000001+09:00")), "2026-12-31T15:00:00.000001Z"));
Deno.test("negative Unix fractional instants preserve six digits", () =>
  equal(utcText(utcInstant("1969-12-31T23:59:59.999999Z")), "1969-12-31T23:59:59.999999Z"));
Deno.test("naive instant requires explicit Seoul", () => {
  rejects(() => utcInstant("2027-01-01T00:00:00"), "naive_instant_timezone_required");
  equal(utcText(utcInstant("2027-01-01T00:00:00", "Asia/Seoul")), "2026-12-31T15:00:00Z");
});
Deno.test("calendar range is half open across leap day", () =>
  equal(seoulDateRange("2024-02-29", "2024-02-29").map(utcText), [
    "2024-02-28T15:00:00Z",
    "2024-02-29T15:00:00Z",
  ]));
Deno.test("calendar and invalid overflow stay separate", () => {
  rejects(() => calendarDate("2027-01-01T00:00:00Z"), "invalid_calendar_date");
  rejects(() => utcInstant("2027-02-29T00:00:00Z"), "invalid_instant");
  rejects(() => utcInstant("2027-01-01T00:00:00.0000001Z"), "invalid_instant");
});
Deno.test("single offering has hand computed 17 and judgment pending", () => {
  const f = syntheticFixture(), before = JSON.stringify(f);
  const r = calculateSyntheticOffering({ read: () => f });
  equal(r.convertedScore, "17.00");
  equal(r.score.toString(), "17");
  equal([r.scoringStatus, r.percentileStatus, r.judgmentStatus, r.productionReady], [
    "ready",
    "pending",
    "pending",
    false,
  ]);
  equal(JSON.stringify(f), before);
});
Deno.test("synthetic rule cannot enter normal calculation", () => {
  const f = syntheticFixture();
  rejects(() => new ConversionRule(f.bundle.rule).calculate(f.profile), "RULE_NOT_APPROVED");
});
Deno.test("single offering rejects wrong exam or pack", () => {
  const f = syntheticFixture();
  f.profile.pack_version = "SYNTHETIC-WRONG";
  rejects(() => calculateSyntheticOffering({ read: () => f }), "conversion_pack_mismatch");
});
Deno.test("same name cannot replace offering PK", () => {
  const f = syntheticFixture();
  f.offering.offering_id = "SYNTHETIC-OTHER";
  rejects(() => calculateSyntheticOffering({ read: () => f }), "conversion_binding_missing");
});
Deno.test("duplicate offering binding fails", () => {
  const f = syntheticFixture();
  f.bundle.bindings.push({ ...f.bundle.bindings[0] });
  rejects(() => calculateSyntheticOffering({ read: () => f }), "RULE_BINDING_AMBIGUOUS");
});
Deno.test("campus track group and department are exact context", () => {
  for (const k of ["campus", "track", "group", "department"] as const) {
    const f = syntheticFixture();
    f.offering[k] = "SYNTHETIC-OTHER";
    rejects(() => calculateSyntheticOffering({ read: () => f }), "conversion_context_mismatch");
  }
});
Deno.test("missing score is not zero", () => {
  const f = syntheticFixture();
  delete (f.profile.values as Record<string, unknown>).math;
  rejects(
    () => new ConversionRule(f.bundle.rule).calculate(f.profile, true),
    "REQUIRED_INPUT_MISSING",
  );
});
Deno.test("zero score remains a successful score", () => {
  const f = syntheticFixture();
  f.profile.values = { korean: 0, math: 0 };
  equal(calculateSyntheticOffering({ read: () => f }).convertedScore, "0.00");
});
Deno.test("inactive forbidden operators and cycles fail at construction", () => {
  const f = syntheticFixture();
  const r = structuredClone(f.bundle.rule) as Record<string, unknown>;
  r.nodes = {
    score: {
      op: "if",
      condition: { op: "eq", left: { op: "const", value: 1 }, right: { op: "const", value: 1 } },
      then: { op: "const", value: 3 },
      else: { op: "eval", value: "SYNTHETIC" },
    },
  };
  rejects(() => new ConversionRule(r), "UNSUPPORTED_OPERATOR");
  r.nodes = { score: { op: "ref", node: "other" }, other: { op: "ref", node: "score" } };
  rejects(() => new ConversionRule(r), "CYCLIC_RULE");
});
Deno.test("fractional weights preserve inclusive and exclusive tails", () => {
  const d = new ExactFrequencyDistribution([{ score: 1, weight: "0.5" }, {
    score: 2,
    weight: "1.5",
  }, { score: 3, weight: 1 }], 3);
  equal(d.calculate(2).top.toString(), "5/6");
  equal(d.calculate(2, "exclude_equal").topPercent, "33.333333");
});
Deno.test("population mismatch and observed fractional counts fail", () => {
  rejects(
    () => new ExactFrequencyDistribution([{ score: 1, weight: 1 }], 2),
    "population_total_mismatch",
  );
  rejects(
    () => new ExactFrequencyDistribution([{ score: 1, weight: "0.5" }], "0.5", true),
    "fractional_count",
  );
});
