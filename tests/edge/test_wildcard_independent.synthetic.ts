/** Independent synthetic counterexamples; never uses real student data or network. */
import { exact, Rational } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  selectWildcards,
  type WildcardChoice,
  type WildcardStability,
} from "../../supabase/functions/_shared/jungsi/application/wildcard_selection.ts";

const H = (s: string) => s.repeat(64);
const evidence: Omit<WildcardStability, "marginPp"> = {
  academicYear: 2027,
  examId: "SYNTHETIC-exam",
  scoreBasis: "actual_exam",
  sourceModelVersion: "SYNTHETIC-v1",
  referencePopulationSha256: H("a"),
  effectivePopulationWeightsSha256: H("a"),
  denominatorPolicyId: "SYNTHETIC-denominator",
  populationUnit: "weighted-students",
  metricDefinitionId: "SYNTHETIC-approved-metric",
  tiePolicy: "include_equal",
  forecastApprovalId: "SYNTHETIC-approval",
};
function item(
  offeringId: string,
  group: string,
  category: string,
  margin: string | null,
  status = "ready",
): WildcardChoice<string> {
  return {
    offeringId,
    group,
    groupClassification: "approved",
    category,
    status,
    stability: margin === null ? null : { ...evidence, marginPp: exact(margin) },
    value: String(offeringId),
  };
}
function assert(value: unknown, note = "assertion failed"): asserts value {
  if (!value) throw new Error(note);
}
function same(a: unknown, b: unknown) {
  assert(JSON.stringify(a) === JSON.stringify(b), "unexpected output");
}
function selection(candidates: readonly WildcardChoice<string>[]) {
  const out = selectWildcards(candidates);
  assert(out.status === "ready");
  return out.items;
}
function* permutations<T>(values: readonly T[]): Generator<T[]> {
  if (!values.length) {
    yield [];
    return;
  }
  for (let i = 0; i < values.length; i++) {
    const tail = values.filter((_x, index) => index !== i);
    for (const p of permutations(tail)) yield [values[i], ...p];
  }
}

Deno.test("different post-filter weighted populations require pending", () => {
  const a = item("a", "nursing", "room", "2");
  const b = item("b", "health", "room", "1");
  assert(a.stability && b.stability);
  const input = [{
    ...a,
    stability: { ...a.stability, effectivePopulationWeightsSha256: H("b") },
  }, {
    ...b,
    stability: { ...b.stability, effectivePopulationWeightsSha256: H("c") },
  }];
  const result = selectWildcards(input);
  assert(result.status === "pending", "different eligible profile/weight fingerprints were ranked");
});

Deno.test("a lone eligible candidate needs no within-category comparison", () => {
  const result = selectWildcards([item("a", "nursing", "room", null)]);
  assert(result.status === "ready");
  same(result.items, ["a"]);
});

Deno.test("pending candidate is not silently hidden behind overall ready", () => {
  const result = selectWildcards([
    item("a", "nursing", "room", "2"),
    item("b", "health", "room", null, "pending"),
  ]);
  assert(
    result.status === "pending",
    "unresolved candidate was excluded and selection marked ready",
  );
});

Deno.test("non-string offering identifiers are rejected rather than coerced", () => {
  const a = item(42 as unknown as string, "nursing", "room", "0");
  const b = item("42", "health", "room", "0");
  let rejected = false;
  try {
    selectWildcards([a, b]);
  } catch {
    rejected = true;
  }
  assert(rejected, "numeric/string duplicate identity bypassed validation");
});

Deno.test("forged Rational with zero denominator cannot count as verified evidence", () => {
  const forged = Object.create(Rational.prototype) as Rational;
  Object.defineProperties(forged, {
    numerator: { value: 0n, enumerable: true },
    denominator: { value: 0n, enumerable: true },
  });
  const a = item("a", "nursing", "room", "2");
  const b = item("b", "health", "room", "1");
  assert(a.stability);
  const result = selectWildcards([{ ...a, stability: { ...a.stability, marginPp: forged } }, b]);
  assert(result.status === "pending", "invalid rational evidence was accepted");
});

Deno.test("valid candidates are deterministic across all 720 input permutations", () => {
  const values = [
    item("a", "nursing", "room", "3.001"),
    item("b", "nursing", "room", "3.002"),
    item("c", "health", "room", "2"),
    item("d", "education", "core", "99"),
    item("e", "contract", "challenge", "10"),
    item("f", "railway", "challenge", "9"),
  ];
  let n = 0;
  for (const p of permutations(values)) {
    same(selection(p), ["b", "c", "d", "a"]);
    n++;
  }
  same(n, 720);
});

Deno.test("priority dominates margin and exact zero is neither missing nor rounded", () => {
  same(
    selection([
      item("a", "nursing", "challenge", "99"),
      item("b", "health", "room", "-99"),
      item("c", "railway", "core", "0"),
    ]),
    ["b", "c", "a"],
  );
  same(
    selection([
      item("a", "nursing", "room", "0.000000000000000000000000000001"),
      item("b", "health", "room", "0"),
      item("c", "railway", "room", "-0.000000000000000000000000000001"),
    ]),
    ["a", "b", "c"],
  );
});

Deno.test("known unequal source population and missing evidence within a category are pending", () => {
  const a = item("a", "nursing", "room", "2");
  const b = item("b", "health", "room", "1");
  assert(b.stability);
  assert(
    selectWildcards([a, {
      ...b,
      stability: { ...b.stability, referencePopulationSha256: H("b") },
    }]).status === "pending",
  );
  assert(selectWildcards([a, item("c", "railway", "room", null)]).status === "pending");
});

Deno.test("first three diversify and fourth returns to remaining best rank", () => {
  same(
    selection([
      item("b", "nursing", "room", "8"),
      item("d", "education", "challenge", "1"),
      item("a", "nursing", "room", "9"),
      item("c", "health", "core", "2"),
      item("e", "contract", "challenge", "0"),
    ]),
    ["a", "c", "d", "b"],
  );
});
