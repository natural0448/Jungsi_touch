/** Native private rules preserve source types; only declared numeric positions adapt to the kernel. */
import { type Calculation, ConversionRule, type Row } from "./conversion.ts";
import { ContractError, requireContract as check } from "./exact.ts";
import { cloneNativeJson, type NativeObject } from "./json_value.ts";
import { JsonFloat, type NativeJson } from "./native_json.ts";
function record(v: unknown): NativeObject {
  check(
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat),
    "INVALID_RULE_SCHEMA",
  );
  return v as NativeObject;
}
function freeze(v: NativeJson): void {
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) v.forEach(freeze);
    else if (!(v instanceof JsonFloat)) Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
}
function numeric(v: NativeJson | undefined): NativeJson | undefined {
  return v instanceof JsonFloat ? v.lexeme : v;
}
function expression(raw: NativeJson): void {
  const e = record(raw), op = e.op;
  if (op === "const") check(!(e.value instanceof JsonFloat), "INVALID_CONSTANT");
  if (op === "input") check(typeof e.field === "string", "UNKNOWN_INPUT");
  if (op === "ref") check(typeof e.node === "string", "UNKNOWN_NODE");
  if (op === "lookup" || op === "bands") {
    check(typeof e.table === "string", "CONVERSION_TABLE_PENDING");
  }
  if (op === "rank_weighted" && Array.isArray(e.weights)) {
    e.weights = e.weights.map((v) => numeric(v)!);
  }
  for (const [key, v] of Object.entries(e)) {
    if (key === "args" && Array.isArray(v)) v.forEach(expression);
    else if (
      ["left", "right", "key", "condition", "then", "else"].includes(key) ||
      key === "value" && op !== "const"
    ) expression(v);
  }
}
function adapted(raw: NativeObject): NativeObject {
  const data = cloneNativeJson(raw);
  if (Object.hasOwn(data, "display_places")) {
    check(
      typeof data.display_places === "number" && Number.isSafeInteger(data.display_places),
      "INVALID_PRECISION",
    );
  }
  if (Object.hasOwn(data, "official_max_score")) {
    data.official_max_score = numeric(data.official_max_score)!;
  }
  if (data.output_range !== undefined) {
    const range = record(data.output_range);
    for (const k of ["min", "max"]) if (Object.hasOwn(range, k)) range[k] = numeric(range[k])!;
  }
  const inputs = record(data.inputs), tables = record(data.tables), nodes = record(data.nodes);
  for (const value of Object.values(inputs)) {
    const spec = record(value);
    if (spec.type === "number") {
      if (Object.hasOwn(spec, "integer")) {
        check(typeof spec.integer === "boolean", "INVALID_INPUT_TYPE");
      }
      if (Object.hasOwn(spec, "min")) spec.min = numeric(spec.min)!;
      if (Object.hasOwn(spec, "max")) spec.max = numeric(spec.max)!;
    }
  }
  for (const value of Object.values(tables)) {
    const table = record(value);
    if (table.status === "pending") continue;
    if (table.kind === "lookup") {
      const values = record(table.values);
      for (const key of Object.keys(values)) values[key] = numeric(values[key])!;
    }
    if (table.kind === "bands" && Array.isArray(table.rows)) {
      for (const item of table.rows) {
        const r = record(item);
        if (Object.hasOwn(r, "include_upper")) {
          check(typeof r.include_upper === "boolean", "INVALID_BANDS");
        }
        for (const key of ["lower", "upper", "value"]) {
          if (Object.hasOwn(r, key)) {
            r[key] = numeric(r[key])!;
          }
        }
      }
    }
  }
  check(typeof data.output_node === "string", "UNKNOWN_NODE");
  for (const e of Object.values(nodes)) expression(e);
  return data;
}
export class NativeConversionRule {
  readonly data: Readonly<NativeObject>;
  private readonly kernel: ConversionRule;
  constructor(value: unknown) {
    try {
      const raw = cloneNativeJson(record(value));
      this.kernel = new ConversionRule(adapted(raw));
      freeze(raw);
      this.data = raw;
      Object.freeze(this);
    } catch (e) {
      if (e instanceof ContractError) throw e;
      throw new ContractError("INVALID_RULE_SCHEMA");
    }
  }
  calculate(profile: Row, research = false): Calculation {
    const inputs = record(this.data.inputs), raw = profile.values;
    check(
      raw !== null && typeof raw === "object" && !Array.isArray(raw) && !(raw instanceof JsonFloat),
      "INVALID_RULE_SCHEMA",
    );
    const values = { ...raw as Row };
    for (const [key, spec] of Object.entries(inputs)) {
      if (record(spec).type === "number" && values[key] instanceof JsonFloat) {
        values[key] = (values[key] as JsonFloat).lexeme;
      }
    }
    return this.kernel.calculate({ ...profile, values }, research);
  }
}
export function conversionBindingKey(year: unknown, pk: unknown): string {
  check(typeof year === "number" && Number.isSafeInteger(year), "BINDING_YEAR_MISMATCH");
  check(
    typeof pk === "string" || typeof pk === "bigint" ||
      typeof pk === "number" && Number.isSafeInteger(pk),
    "INVALID_RULE_SCHEMA",
  );
  return String(year) + "\0" + String(pk);
}
export class NativeConversionRelease {
  readonly releaseId: string;
  private readonly rules: ReadonlyMap<string, NativeConversionRule>;
  private readonly bindings: ReadonlyMap<string, string>;
  constructor(releaseId: unknown, rules: unknown, bindings: unknown) {
    check(typeof releaseId === "string", "INVALID_RULE_METADATA");
    check(Array.isArray(rules) && Array.isArray(bindings), "INVALID_RULE_SCHEMA");
    this.releaseId = releaseId;
    const byVersion = new Map<string, NativeConversionRule>(),
      byOffering = new Map<string, string>();
    for (const raw of rules) {
      const rule = new NativeConversionRule(raw), version = rule.data.rule_version;
      check(typeof version === "string", "INVALID_RULE_METADATA");
      check(!byVersion.has(version), "DUPLICATE_RULE");
      byVersion.set(version, rule);
    }
    for (const raw of bindings) {
      const b = record(raw), key = conversionBindingKey(b.academic_year, b.offering_pk);
      check(!byOffering.has(key), "RULE_BINDING_AMBIGUOUS");
      check(typeof b.rule_version === "string" && byVersion.has(b.rule_version), "RULE_NOT_FOUND");
      check(
        byVersion.get(b.rule_version)!.data.academic_year === b.academic_year,
        "BINDING_YEAR_MISMATCH",
      );
      byOffering.set(key, b.rule_version);
    }
    this.rules = byVersion;
    this.bindings = byOffering;
    Object.freeze(this);
  }
  rule(version: string): NativeConversionRule | null {
    return this.rules.get(version) ?? null;
  }
  binding(year: number, pk: string | number | bigint): string | null {
    return this.bindings.get(conversionBindingKey(year, pk)) ?? null;
  }
  compareYears(
    offeringByYear: Readonly<NativeObject>,
    profiles: ReadonlyMap<number, NativeObject>,
  ): NativeObject {
    const years: NativeObject[] = [];
    for (const year of [2024, 2025, 2026, 2027]) {
      const base: NativeObject = {
        academic_year: year,
        offering_pk: offeringByYear[String(year)] ?? null,
        converted_score: null,
      };
      try {
        check(Object.hasOwn(offeringByYear, String(year)), "OFFERING_MAPPING_REQUIRED");
        const version = this.binding(year, offeringByYear[String(year)] as string);
        check(version !== null, "RULE_NOT_FOUND");
        const profile = profiles.get(year);
        check(
          profile !== undefined && profile.score_basis === "year_equated_estimate",
          "YEAR_BRIDGE_REQUIRED",
        );
        const rule = this.rule(version)!;
        const result = rule.calculate(profile);
        Object.assign(base, {
          academic_year: year,
          exam_id: profile.exam_id,
          profile_version: profile.profile_version,
          score_basis: profile.score_basis,
          rule_version: version,
          calculation_status: "calculated",
          converted_score: result.convertedScore,
          score_scope: "csat_component",
          exact_score: { numerator: result.score.numerator, denominator: result.score.denominator },
        });
      } catch (e) {
        if (!(e instanceof ContractError)) throw e;
        Object.assign(base, { calculation_status: "blocked", reason_codes: [e.code] });
      }
      years.push(base);
    }
    return { release_id: this.releaseId, comparison_basis: "year_equated_estimate", years };
  }
}
