import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  selectWildcards,
  type WildcardChoice,
  type WildcardStability,
} from "../../supabase/functions/_shared/jungsi/application/wildcard_selection.ts";

function assert(ok: unknown): asserts ok {
  if (!ok) throw new Error("assertion failed");
}
function same(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}
const evidence: Omit<WildcardStability, "marginPp"> = {
  academicYear: 2027,
  examId: "synthetic-exam",
  scoreBasis: "actual_exam",
  sourceModelVersion: "synthetic-model",
  referencePopulationSha256: "a".repeat(64),
  effectivePopulationWeightsSha256: "b".repeat(64),
  denominatorPolicyId: "synthetic-denominator",
  populationUnit: "weighted-students",
  metricDefinitionId: "synthetic-forecast70",
  tiePolicy: "include_equal",
  forecastApprovalId: "synthetic-approval",
};
function choice(
  id: string,
  group: string,
  category: string,
  margin: string | null,
  status = "ready",
): WildcardChoice<string> {
  return {
    offeringId: id,
    group: group === "other" ? null : group,
    groupClassification: group === "other" ? "excluded" : "approved",
    status,
    category,
    stability: margin === null ? null : { ...evidence, marginPp: exact(margin) },
    value: id,
  };
}
function items(result: ReturnType<typeof selectWildcards<string>>): readonly string[] {
  assert(result.status === "ready");
  return result.items;
}
Deno.test("different groups first, highest remaining fourth", () => {
  same(
    items(selectWildcards([
      choice("a", "nursing", "room", "9"),
      choice("b", "nursing", "room", "8"),
      choice("c", "health", "core", "2"),
      choice("d", "education", "challenge", "1"),
      choice("e", "contract", "challenge", "0"),
    ])),
    ["a", "c", "d", "b"],
  );
});
Deno.test("all six approved groups can participate", () => {
  const result = selectWildcards([
    choice("a", "contract", "room", "6"),
    choice("b", "maritime", "room", "5"),
    choice("c", "railway", "room", "4"),
    choice("d", "nursing", "room", "3"),
    choice("e", "health", "room", "2"),
    choice("f", "education", "room", "1"),
  ]);
  same(items(result), ["a", "b", "c", "d"]);
});
Deno.test("same group fills vacancies and never exceeds four", () => {
  const scores: Record<string, string> = { a: "5", b: "4", c: "3", d: "2", e: "1" };
  const result = selectWildcards(
    ["e", "c", "a", "d", "b"].map((id) => choice(id, "nursing", "room", scores[id])),
  );
  same(items(result), ["a", "b", "c", "d"]);
});
Deno.test("category priority precedes margin", () => {
  same(
    items(
      selectWildcards([
        choice("a", "nursing", "challenge", "99"),
        choice("b", "health", "room", "-99"),
        choice("c", "railway", "core", "0"),
      ]),
    ),
    ["b", "c", "a"],
  );
});
Deno.test("exact margins order without public display rounding", () => {
  same(
    items(
      selectWildcards([
        choice("a", "nursing", "room", "0.333333333333333333333333333334"),
        choice("b", "health", "room", "0.333333333333333333333333333333"),
      ]),
    ),
    ["a", "b"],
  );
});
Deno.test("zero is a valid stability value", () => {
  same(
    items(
      selectWildcards([choice("b", "health", "room", "-1"), choice("a", "nursing", "room", "0")]),
    ),
    ["a", "b"],
  );
});
Deno.test("missing stability in the same category blocks ranking", () => {
  const r = selectWildcards([
    choice("a", "nursing", "room", "0"),
    choice("b", "health", "room", null),
  ]);
  assert(r.status === "pending");
  same(r.items, []);
});
Deno.test("different cohort or method cannot be ranked together", () => {
  const a = choice("a", "nursing", "room", "2"), b = choice("b", "health", "room", "1");
  assert(b.stability !== null);
  const r = selectWildcards([a, {
    ...b,
    stability: { ...b.stability, referencePopulationSha256: "b".repeat(64) },
  }]);
  assert(r.status === "pending");
});
Deno.test("noncompetitive, unapproved group, pending and ineligible are excluded", () => {
  assert(
    selectWildcards([
      choice("a", "nursing", "outside", null),
      choice("b", "maritime", "room", null, "pending"),
      choice("c", "other", "room", null),
      choice("d", "railway", "room", "1"),
    ]).status === "pending",
  );
  same(
    items(selectWildcards([
      choice("a", "nursing", "outside", null),
      choice("b", "maritime", "room", null, "ineligible"),
      choice("c", "other", "room", null),
      choice("d", "railway", "room", "1"),
    ])),
    ["d"],
  );
  same(items(selectWildcards([])), []);
});
Deno.test("duplicate offering fails closed", () => {
  let threw = false;
  try {
    selectWildcards([choice("a", "nursing", "room", "1"), choice("a", "health", "core", "2")]);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("first three retain priority when duplicate groups fill vacancies", () => {
  same(
    items(selectWildcards([
      choice("a", "nursing", "room", "9"),
      choice("b", "nursing", "room", "8"),
      choice("c", "health", "challenge", "1"),
    ])),
    ["a", "b", "c"],
  );
});
