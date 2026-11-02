import { exact, Rational } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  selectWildcards,
  type WildcardChoice,
} from "../../supabase/functions/_shared/jungsi/application/wildcard_selection.ts";
function check(ok: unknown): asserts ok {
  if (!ok) throw new Error("assertion failed");
}
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
}
function item(
  id: string,
  group: string,
  category: string,
  margin: string | null,
): WildcardChoice<string> {
  return {
    offeringId: id,
    group,
    groupClassification: "approved",
    status: "ready",
    category,
    value: id,
    stability: margin === null ? null : {
      marginPp: exact(margin),
      academicYear: 2027,
      examId: "exam",
      scoreBasis: "actual_exam",
      sourceModelVersion: "model",
      referencePopulationSha256: "a".repeat(64),
      effectivePopulationWeightsSha256: "b".repeat(64),
      denominatorPolicyId: "denominator",
      populationUnit: "weighted-students",
      metricDefinitionId: "forecast70",
      tiePolicy: "include_equal",
      forecastApprovalId: "approval",
    },
  };
}
Deno.test("confirmed higher-category card survives uncertain lower category", () => {
  const out = selectWildcards([
    item("a", "nursing", "room", null),
    item("b", "health", "core", null),
    item("c", "railway", "core", null),
  ]);
  check(out.status === "pending");
  equal(out.items, ["a"]);
});
Deno.test("three confirmed different groups survive an uncertain fourth", () => {
  const out = selectWildcards([
    item("a", "nursing", "room", "3"),
    item("b", "health", "room", "2"),
    item("c", "railway", "room", "1"),
    item("d", "nursing", "core", null),
    item("e", "health", "core", null),
  ]);
  check(out.status === "pending");
  equal(out.items, ["a", "b", "c"]);
});
Deno.test("equal stability is not resolved by ID", () => {
  const out = selectWildcards([
    item("a", "nursing", "room", "0"),
    item("b", "health", "room", "0"),
  ]);
  check(out.status === "pending");
  equal(out.items, []);
});
Deno.test("unresolved group can affect even the first card", () => {
  const unknown = {
    ...item("b", "health", "room", null),
    group: null,
    groupClassification: "unresolved" as const,
    status: "pending",
  };
  const out = selectWildcards([item("a", "nursing", "room", "3"), unknown]);
  check(out.status === "pending");
  equal(out.items, []);
});
Deno.test("subclassed comparison cannot override exact ranking", () => {
  class Forged extends Rational {
    override compare(_b: Rational): number {
      return Number.NaN;
    }
  }
  const candidate = item("a", "nursing", "room", "2");
  check(candidate.stability);
  const forged = { ...candidate, stability: { ...candidate.stability, marginPp: new Forged(2n) } };
  const out = selectWildcards([forged, item("b", "health", "room", "1")]);
  check(out.status === "pending");
  equal(out.items, []);
});
Deno.test("missing incomparable candidates beyond certain fourth do not blank results", () => {
  const out = selectWildcards([
    item("a", "nursing", "room", "4"),
    item("b", "health", "room", "3"),
    item("c", "railway", "room", "2"),
    item("d", "education", "core", null),
    item("e", "contract", "challenge", null),
  ]);
  check(out.status === "ready");
  equal(out.items, ["a", "b", "c", "d"]);
});

Deno.test("confirmed ineligible with unknown group does not suppress a certain card", () => {
  const excluded = {
    ...item("b", "health", "core", null),
    group: null,
    groupClassification: "unresolved" as const,
    status: "ineligible",
  };
  const out = selectWildcards([item("a", "nursing", "room", null), excluded]);
  check(out.status === "ready");
  equal(out.items, ["a"]);
});
Deno.test("confirmed outside with unknown group does not suppress a certain card", () => {
  const excluded = {
    ...item("b", "health", "core", null),
    group: null,
    groupClassification: "unresolved" as const,
    category: "outside",
  };
  const out = selectWildcards([item("a", "nursing", "room", null), excluded]);
  check(out.status === "ready");
  equal(out.items, ["a"]);
});

Deno.test("frozen forged rational accessor cannot masquerade as stable evidence", () => {
  const fake = Object.create(Rational.prototype) as Rational;
  let calls = 0;
  Object.defineProperties(fake, {
    numerator: {
      get() {
        return calls++ === 0 ? 2n : 0n;
      },
      enumerable: true,
    },
    denominator: { value: 1n, enumerable: true },
  });
  Object.freeze(fake);
  const candidate = item("a", "nursing", "room", "2");
  check(candidate.stability);
  const out = selectWildcards([{
    ...candidate,
    stability: { ...candidate.stability, marginPp: fake },
  }, item("b", "health", "room", "1")]);
  check(out.status === "pending");
  equal(out.items, []);
});
