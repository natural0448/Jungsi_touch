/** Invented values only; never an admission source or runtime native publication. */
export function syntheticFixture() {
  const rule = {
    format: "jungsi.university-rule/v1",
    academic_year: 2027,
    rule_id: "SYNTHETIC-RULE",
    rule_version: "SYNTHETIC-RULE-v1",
    review_status: "draft",
    data_kind: "synthetic",
    score_scope: "csat_component",
    source_refs: ["SYNTHETIC-INVENTED-NO-WORKBOOK"],
    inputs: {
      korean: { type: "number", min: 0, max: 100, integer: true },
      math: { type: "number", min: 0, max: 100, integer: true },
    },
    tables: {},
    nodes: {
      score: {
        op: "sum",
        args: [{ op: "input", field: "korean" }, {
          op: "product",
          args: [{ op: "input", field: "math" }, { op: "const", value: "0.5" }],
        }],
      },
    },
    output_node: "score",
    display_places: 2,
    official_max_score: 100,
  };
  const offering = {
    academic_year: 2027,
    offering_id: "SYNTHETIC-OFFERING",
    university_id: "SYNTHETIC-U",
    campus: "SYNTHETIC-C",
    department: "SYNTHETIC-D",
    track: "SYNTHETIC-T",
    group: "SYNTHETIC-G",
  };
  const pack = {
    academic_year: 2027,
    exam_id: "SYNTHETIC-EXAM",
    pack_version: "SYNTHETIC-PACK-v1",
    exam_type: "csat",
  };
  const profile = {
    academic_year: 2027,
    exam_id: pack.exam_id,
    pack_version: pack.pack_version,
    profile_version: "SYNTHETIC-PROFILE",
    score_basis: "synthetic",
    values: { korean: 10, math: 14 },
  };
  const bundle = {
    data_kind: "synthetic",
    status: "synthetic",
    academic_year: 2027,
    exam_id: pack.exam_id,
    source_pack_version: pack.pack_version,
    exam_type: "csat",
    rule,
    bindings: [{ ...offering, offering_pk: offering.offering_id, rule_version: rule.rule_version }],
  };
  return { offering, pack, bundle, profile };
}
export function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
export function equal(a: unknown, b: unknown) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
export function rejects(run: () => unknown, code: string) {
  try {
    run();
  } catch (e) {
    equal((e as { code?: string }).code, code);
    return;
  }
  throw new Error("expected " + code);
}
