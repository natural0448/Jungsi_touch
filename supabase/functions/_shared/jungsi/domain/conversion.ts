/** Declarative rule interpreter. No eval, Excel, network, approval mutation or model fit. */
import {
  ContractError,
  displayExact,
  exact,
  Rational,
  requireContract as check,
  roundExact,
} from "./exact.ts";
export type Row = Record<string, unknown>;
export function row(value: unknown, code = "INVALID_RULE_SCHEMA"): Row {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof Rational),
    code,
  );
  return value as Row;
}
function items(value: unknown, code: string): unknown[] {
  check(Array.isArray(value) && value.length > 0, code);
  return value;
}
function text(value: unknown, code = "INVALID_RULE_METADATA"): string {
  check(typeof value === "string" && !!value, code);
  return value;
}
const OPS: Record<string, string[]> = {
  const: ["value"],
  input: ["field"],
  ref: ["node"],
  sum: ["args"],
  product: ["args"],
  average: ["args"],
  max: ["args"],
  min: ["args"],
  subtract: ["left", "right"],
  divide: ["left", "right"],
  lookup: ["table", "key"],
  bands: ["table", "value"],
  rank_weighted: ["args", "weights"],
  round: ["value", "places", "mode"],
  if: ["condition", "then", "else"],
  in: ["value", "choices"],
  eq: ["left", "right"],
  all: ["args"],
  any: ["args"],
};
function inspect(value: unknown, nodes: Row, inputs: Row, tables: Row, depth = 0): void {
  check(depth <= 40, "INVALID_EXPRESSION");
  const e = row(value, "INVALID_EXPRESSION"), op = text(e.op, "UNSUPPORTED_OPERATOR");
  check(Object.hasOwn(OPS, op), "UNSUPPORTED_OPERATOR");
  const expected = [...OPS[op], "op"].sort();
  check(JSON.stringify(Object.keys(e).sort()) === JSON.stringify(expected), "INVALID_EXPRESSION");
  if (op === "ref") check(Object.hasOwn(nodes, String(e.node)), "UNKNOWN_NODE");
  if (op === "input") check(Object.hasOwn(inputs, String(e.field)), "UNKNOWN_INPUT");
  if (op === "lookup" || op === "bands") {
    check(Object.hasOwn(tables, String(e.table)), "CONVERSION_TABLE_PENDING");
    check(
      row(tables[String(e.table)]).kind === (op === "lookup" ? "lookup" : "bands"),
      "TABLE_KIND_MISMATCH",
    );
  }
  if (op === "const") {
    check(
      typeof e.value === "string" || typeof e.value === "bigint" ||
        (typeof e.value === "number" && Number.isSafeInteger(e.value)),
      "INVALID_CONSTANT",
    );
  }
  if (op === "rank_weighted") {
    const weights = items(e.weights, "INVALID_WEIGHTS");
    check(weights.length <= items(e.args, "EMPTY_ARGUMENTS").length, "INVALID_WEIGHTS");
    check(weights.every((w) => exact(w).compare(exact(0)) >= 0), "INVALID_WEIGHTS");
  }
  if (op === "round") roundExact(exact(0), e.places, e.mode);
  if (op === "in") items(e.choices, "INVALID_CHOICES");
  for (const [k, v] of Object.entries(e)) {
    if (k === "args") {
      for (const child of items(v, "EMPTY_ARGUMENTS")) {
        inspect(child, nodes, inputs, tables, depth + 1);
      }
    } else if (
      ["left", "right", "key", "condition", "then", "else"].includes(k) ||
      (k === "value" && op !== "const")
    ) inspect(v, nodes, inputs, tables, depth + 1);
  }
}
function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value !== null && typeof value === "object") {
    const e = value as Row;
    return [...(e.op === "ref" ? [String(e.node)] : []), ...Object.values(e).flatMap(refs)];
  }
  return [];
}
function numeric(value: unknown): Rational {
  check(value instanceof Rational, "INVALID_VALUE_TYPE");
  return value;
}
function equal(a: unknown, b: unknown): boolean {
  if (a instanceof Rational && b instanceof Rational) return a.compare(b) === 0;
  // Fraction equals an integer/bool in Python conditions, while input bools still fail num().
  if (
    a instanceof Rational &&
    (typeof b === "boolean" || typeof b === "number" || typeof b === "bigint")
  ) return a.compare(exact(typeof b === "boolean" ? Number(b) : b)) === 0;
  if (b instanceof Rational) return equal(b, a);
  return a === b;
}
export interface Calculation {
  readonly score: Rational;
  readonly convertedScore: string;
  readonly trace: Readonly<Record<string, unknown>>;
}
export class ConversionRule {
  private readonly data: Row;
  constructor(value: unknown) {
    const d = row(structuredClone(value));
    this.data = d;
    check(d.format === "jungsi.university-rule/v1", "INVALID_RULE_FORMAT");
    check(
      typeof d.academic_year === "number" && Number.isInteger(d.academic_year) &&
        [2024, 2025, 2026, 2027].includes(d.academic_year),
      "INVALID_YEAR",
    );
    check(
      ["draft", "source_verified", "calculation_verified"].includes(String(d.review_status)),
      "INVALID_RULE_STATUS",
    );
    check(["official_rule", "synthetic"].includes(String(d.data_kind)), "INVALID_RULE_KIND");
    for (const k of ["rule_id", "rule_version", "score_scope"]) text(d[k]);
    check(d.score_scope === "csat_component", "UNSUPPORTED_SCOPE");
    roundExact(exact(0), d.display_places ?? 2, "half_up");
    if (d.official_max_score != null) {
      check(exact(d.official_max_score).compare(exact(0)) > 0, "INVALID_RULE_METADATA");
    }
    if (d.output_range !== undefined) {
      const range = row(d.output_range);
      check(
        Object.keys(range).sort().join() === "max,min" &&
          exact(range.min).compare(exact(range.max)) <= 0,
        "INVALID_OUTPUT_RANGE",
      );
    }
    items(d.source_refs, "SOURCE_REQUIRED");
    const inputs = row(d.inputs), tables = row(d.tables), nodes = row(d.nodes);
    for (const raw of Object.values(inputs)) {
      const spec = row(raw);
      check(["number", "text"].includes(String(spec.type)), "INVALID_INPUT_TYPE");
      if (spec.type === "number") {
        check(exact(spec.min).compare(exact(spec.max)) <= 0, "INVALID_INPUT_RANGE");
        check(typeof (spec.integer ?? true) === "boolean", "INVALID_INPUT_TYPE");
      }
    }
    for (const raw of Object.values(tables)) {
      const table = row(raw);
      check(table.academic_year === d.academic_year, "TABLE_YEAR_MISMATCH");
      check(table.version && table.source_ref, "SOURCE_REQUIRED");
      check(["verified", "pending"].includes(String(table.status)), "INVALID_TABLE_STATUS");
      check(["lookup", "bands"].includes(String(table.kind)), "INVALID_TABLE_KIND");
      if (table.status === "pending") continue;
      if (table.kind === "lookup") {
        const values = row(table.values);
        check(Object.keys(values).length, "EMPTY_TABLE");
        for (const v of Object.values(values)) exact(v);
      } else {
        const rows = items(table.rows, "EMPTY_TABLE");
        let previous: Rational | null = null;
        rows.forEach((raw, i) => {
          const r = row(raw), lo = exact(r.lower), hi = exact(r.upper);
          check(lo.compare(hi) < 0 && (!previous || previous.compare(lo) === 0), "INVALID_BANDS");
          check((r.include_upper ?? false) === (i === rows.length - 1), "INVALID_BANDS");
          exact(r.value);
          previous = hi;
        });
      }
    }
    for (const e of Object.values(nodes)) inspect(e, nodes, inputs, tables);
    check(Object.hasOwn(nodes, String(d.output_node)), "UNKNOWN_NODE");
    const seen = new Set<string>(), active = new Set<string>();
    function visit(name: string) {
      check(!active.has(name), "CYCLIC_RULE");
      if (seen.has(name)) return;
      active.add(name);
      for (const ref of refs(nodes[name])) visit(ref);
      active.delete(name);
      seen.add(name);
    }
    for (const name of Object.keys(nodes)) visit(name);
  }
  calculate(value: unknown, research = false): Calculation {
    check(typeof research === "boolean", "INVALID_RESEARCH_OPTION");
    const d = this.data, profile = row(value);
    check(
      research || (d.review_status === "calculation_verified" && d.data_kind === "official_rule"),
      "RULE_NOT_APPROVED",
    );
    check(profile.academic_year === d.academic_year, "PROFILE_YEAR_MISMATCH");
    check(profile.exam_id && profile.profile_version, "PROFILE_VERSION_REQUIRED");
    check(
      ["actual_exam", "mock_exam", "year_equated_estimate", "synthetic"].includes(
        String(profile.score_basis),
      ),
      "INVALID_SCORE_BASIS",
    );
    if (profile.score_basis === "year_equated_estimate") {
      check(profile.bridge_version, "YEAR_BRIDGE_REQUIRED");
      check(research || profile.bridge_validated === true, "YEAR_BRIDGE_NOT_VALIDATED");
    }
    check(research || profile.score_basis !== "synthetic", "SYNTHETIC_PROFILE");
    const values = row(profile.values ?? {}),
      inputs: Row = Object.create(null),
      trace: Row = Object.create(null),
      nodes = row(d.nodes),
      tables = row(d.tables);
    for (const [field, raw] of Object.entries(row(d.inputs))) {
      const spec = row(raw);
      let v = values[field];
      check(v != null, "REQUIRED_INPUT_MISSING");
      if (spec.type === "number") {
        v = exact(v);
        check(
          (v as Rational).compare(exact(spec.min)) >= 0 &&
            (v as Rational).compare(exact(spec.max)) <= 0,
          "SCORE_OUT_OF_RANGE",
        );
        check(!(spec.integer ?? true) || (v as Rational).denominator === 1n, "INVALID_INTEGER");
      } else {
        text(v, "INVALID_TEXT");
        if (spec.choices !== undefined) {
          check(items(spec.choices, "INVALID_CHOICES").includes(v), "INVALID_CHOICE");
        }
      }
      inputs[field] = v;
    }
    function node(name: string): unknown {
      if (!Object.hasOwn(trace, name)) trace[name] = run(nodes[name]);
      return trace[name];
    }
    function run(raw: unknown): unknown {
      const e = row(raw), op = String(e.op);
      if (op === "const") {
        return typeof e.value === "bigint" || typeof e.value === "number" ||
            (typeof e.value === "string" && /^-?\d+(\.\d+)?$/.test(e.value))
          ? exact(e.value)
          : e.value;
      }
      if (op === "input") return inputs[String(e.field)];
      if (op === "ref") return node(String(e.node));
      if (op === "if") {
        const condition = run(e.condition);
        check(typeof condition === "boolean", "INVALID_CONDITION");
        return run(condition ? e.then : e.else);
      }
      if (op === "in") {
        return items(e.choices, "INVALID_CHOICES").some((v) => equal(run(e.value), v));
      }
      if (op === "eq") return equal(run(e.left), run(e.right));
      if (op === "lookup" || op === "bands") {
        const table = row(tables[String(e.table)]);
        check(table.status === "verified", "CONVERSION_TABLE_PENDING");
        const v = run(op === "lookup" ? e.key : e.value);
        if (op === "lookup") {
          const key = typeof v === "boolean" ? (v ? "True" : "False") : String(v),
            values = row(table.values);
          check(Object.hasOwn(values, key), "LOOKUP_KEY_MISSING");
          return exact(values[key]);
        }
        const number = numeric(v);
        for (const raw of items(table.rows, "EMPTY_TABLE")) {
          const r = row(raw);
          if (
            exact(r.lower).compare(number) <= 0 &&
            (number.compare(exact(r.upper)) < 0 ||
              (r.include_upper === true && number.compare(exact(r.upper)) === 0))
          ) return exact(r.value);
        }
        throw new ContractError("LOOKUP_KEY_MISSING");
      }
      if (op === "round") return roundExact(numeric(run(e.value)), e.places, e.mode);
      if (op === "subtract" || op === "divide") {
        const a = numeric(run(e.left)), b = numeric(run(e.right));
        return op === "subtract" ? a.subtract(b) : a.divide(b);
      }
      const args = items(e.args, "EMPTY_ARGUMENTS").map(run);
      if (op === "all" || op === "any") {
        check(args.every((a) => typeof a === "boolean"), "INVALID_CONDITION");
        return op === "all" ? args.every(Boolean) : args.some(Boolean);
      }
      const numbers = args.map(numeric), sum = () => numbers.reduce((a, b) => a.add(b), exact(0));
      if (op === "sum") return sum();
      if (op === "average") return sum().divide(exact(numbers.length));
      if (op === "max" || op === "min") {
        return numbers.reduce((a, b) =>
          (op === "max" ? a.compare(b) >= 0 : a.compare(b) <= 0) ? a : b
        );
      }
      if (op === "product") return numbers.reduce((a, b) => a.multiply(b), exact(1));
      if (op === "rank_weighted") {
        const weights = items(e.weights, "INVALID_WEIGHTS");
        return numbers.sort((a, b) => b.compare(a)).slice(0, weights.length).reduce(
          (a, b, i) => a.add(b.multiply(exact(weights[i]))),
          exact(0),
        );
      }
      throw new ContractError("UNSUPPORTED_OPERATOR");
    }
    const score = node(String(d.output_node));
    check(score instanceof Rational, "INVALID_OUTPUT");
    if (d.output_range !== undefined) {
      const range = row(d.output_range);
      check(
        score.compare(exact(range.min)) >= 0 && score.compare(exact(range.max)) <= 0,
        "OUTPUT_OUT_OF_RANGE",
      );
    }
    return Object.freeze({
      score,
      convertedScore: displayExact(score, Number(d.display_places ?? 2)),
      trace: Object.freeze({ ...trace }),
    });
  }
}
