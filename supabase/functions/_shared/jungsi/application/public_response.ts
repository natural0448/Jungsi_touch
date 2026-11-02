/** Same closed recursive public catalog as the Python service, supplied by composition. */
import { AccessError } from "./access.ts";
import { validWildcardSelection } from "./wildcard_public_contract.ts";
import { JsonFloat } from "../domain/native_json.ts";

type Row = Record<string, unknown>;
/** Must be supplied only from an independently verified, request-bound immutable writer record.
 * It must bind owner/tenant, report and exact revision (or verified source revision), the
 * selection and order, and approved policy/data context. A hash or payload claim alone is not proof.
 * The normal runtime currently supplies no such authority, so legacy output is preserved.
 */
export interface WildcardProjectionAuthority {
  /** Recheck revocation, expiry, revision and source currentness at each delivery boundary. */
  assertCurrent(signal: AbortSignal): Promise<void>;
  authorizes(
    input: {
      readonly operation: string;
      readonly tier: "standard" | "paid";
      readonly root: unknown;
      readonly candidates: unknown;
      readonly privateView: unknown;
    },
  ): boolean;
}
type ProjectionContext = {
  readonly operation: string;
  readonly tier: "standard" | "paid";
  readonly root: unknown;
  readonly authority?: WildcardProjectionAuthority;
};
function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function exactKeys(value: Row, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every((x) => Object.hasOwn(value, x));
}
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
export class PublicResponseProjection {
  private readonly schemas: Row;
  private readonly operations = new Map<string, Row>();
  private readonly auxiliaryRoots: Row;
  constructor(
    registry: unknown,
    expectedOperations: readonly { id: string; contract_ref: string }[],
  ) {
    try {
      const input: unknown = structuredClone(registry);
      if (
        !record(input) || input.format !== "jungsi.public-response-schemas/v1" ||
        !record(input.schemas) || !Object.keys(input.schemas).length ||
        !Array.isArray(input.operations) || !record(input.auxiliary_roots)
      ) unavailable();
      this.schemas = input.schemas;
      this.auxiliaryRoots = input.auxiliary_roots;
      const expected = new Map(expectedOperations.map((x) => [x.id, x.contract_ref]));
      if (
        expected.size !== expectedOperations.length ||
        !exactKeys(this.auxiliaryRoots, ["error", "readiness"])
      ) unavailable();
      for (const item of input.operations) {
        if (
          !record(item) || !exactKeys(item, ["id", "contract_ref", "roots"]) ||
          typeof item.id !== "string" || this.operations.has(item.id) ||
          expected.get(item.id) !== item.contract_ref || !record(item.roots) ||
          !exactKeys(item.roots, ["standard", "paid"])
        ) unavailable();
        for (const root of Object.values(item.roots)) this.validate(root, new Set());
        this.operations.set(item.id, item.roots);
      }
      if (this.operations.size !== expected.size) unavailable();
      for (const root of Object.values(this.auxiliaryRoots)) this.validate(root, new Set());
      for (const [name, node] of Object.entries(this.schemas)) this.validate(node, new Set([name]));
    } catch {
      unavailable();
    }
  }
  private validate(value: unknown, stack: Set<string>): void {
    if (!record(value) || typeof value.nullable !== "boolean") unavailable();
    if (Object.hasOwn(value, "ref")) {
      if (
        !exactKeys(value, ["ref", "nullable"]) || typeof value.ref !== "string" ||
        !Object.hasOwn(this.schemas, value.ref) || stack.has(value.ref)
      ) unavailable();
      this.validate(this.schemas[value.ref], new Set([...stack, value.ref]));
      return;
    }
    const common = ["type", "nullable"];
    switch (value.type) {
      case "object": {
        if (
          !exactKeys(value, [...common, "properties", "required", "optional"]) ||
          !record(value.properties) || !Array.isArray(value.required) ||
          !Array.isArray(value.optional)
        ) unavailable();
        const names = [...value.required, ...value.optional];
        if (
          names.some((x) => typeof x !== "string") || new Set(names).size !== names.length ||
          !exactKeys(value.properties, names)
        ) unavailable();
        for (const child of Object.values(value.properties)) this.validate(child, stack);
        return;
      }
      case "array":
        if (!exactKeys(value, [...common, "items"])) unavailable();
        this.validate(value.items, stack);
        return;
      case "map": {
        if (!exactKeys(value, [...common, "keys", "values"])) unavailable();
        this.validate(value.keys, stack);
        this.validate(value.values, stack);
        let key = value.keys as Row;
        while (Object.hasOwn(key, "ref")) key = this.schemas[key.ref as string] as Row;
        if (key.type !== "string" || key.nullable !== false) unavailable();
        return;
      }
      case "union":
        if (
          !exactKeys(value, [...common, "options"]) || !Array.isArray(value.options) ||
          value.options.length < 2
        ) unavailable();
        for (const child of value.options) this.validate(child, stack);
        return;
      case "string":
      case "integer":
      case "number":
      case "boolean":
        if (Object.keys(value).some((k) => ![...common, "enum", "pattern"].includes(k))) {
          unavailable();
        }
        if (Object.hasOwn(value, "enum") && (!Array.isArray(value.enum) || !value.enum.length)) {
          unavailable();
        }
        if (Object.hasOwn(value, "pattern")) {
          if (value.type !== "string" || typeof value.pattern !== "string") unavailable();
          new RegExp("^(?:" + value.pattern + ")$");
        }
        return;
      default:
        unavailable();
    }
  }
  private walk(raw: unknown, value: unknown, context?: ProjectionContext): unknown {
    const node = raw as Row;
    if (value === null) return node.nullable === true ? null : unavailable();
    if (Object.hasOwn(node, "ref")) {
      if (node.ref === "candidates" && record(value)) {
        const input: Row = { ...value };
        // Old unknown fields never authorize a new result. Keep legacy cards unchanged.
        delete input.wildcard_selection;
        const privateView = value._wildcard_selection_view;
        let trusted = false;
        if (Object.hasOwn(value, "_wildcard_selection_view") && context?.authority) {
          try {
            trusted = context.authority.authorizes({
              operation: context.operation,
              tier: context.tier,
              root: context.root,
              candidates: value,
              privateView,
            }) === true;
          } catch {
            trusted = false;
          }
        }
        if (trusted) {
          if (
            !record(privateView) || !record(privateView.wildcard_selection) ||
            !Object.hasOwn(privateView, "wildcards")
          ) unavailable();
          input.wildcards = privateView.wildcards;
          input.wildcard_selection = privateView.wildcard_selection;
        }
        const result = this.walk(this.schemas[node.ref as string], input, context);
        if (trusted && !validWildcardSelection(result)) unavailable();
        return result;
      }
      return this.walk(this.schemas[node.ref as string], value, context);
    }
    switch (node.type) {
      case "object": {
        if (!record(value) || (node.required as string[]).some((k) => !Object.hasOwn(value, k))) {
          unavailable();
        }
        const result: Row = Object.create(null);
        for (const [key, child] of Object.entries(node.properties as Row)) {
          if (Object.hasOwn(value, key)) result[key] = this.walk(child, value[key], context);
        }
        return result;
      }
      case "array":
        if (!Array.isArray(value)) unavailable();
        return value.map((x) => this.walk(node.items, x, context));
      case "map": {
        if (!record(value)) unavailable();
        const result: Row = Object.create(null);
        for (const [key, child] of Object.entries(value)) {
          result[this.walk(node.keys, key, context) as string] = this.walk(
            node.values,
            child,
            context,
          );
        }
        return result;
      }
      case "union":
        for (const child of node.options as unknown[]) {
          try {
            return this.walk(child, value, context);
          } catch (error) {
            if (!(error instanceof AccessError)) throw error;
          }
        }
        unavailable();
    }
    const valid = node.type === "string"
      ? typeof value === "string"
      : node.type === "integer"
      ? typeof value === "bigint" || typeof value === "number" && Number.isSafeInteger(value)
      : node.type === "number"
      ? typeof value === "bigint" || typeof value === "number" && Number.isFinite(value) ||
        value instanceof JsonFloat && JSON_NUMBER.test(value.lexeme) &&
          Number.isFinite(Number(value.lexeme))
      : node.type === "boolean" && typeof value === "boolean";
    if (!valid) unavailable();
    if (
      Object.hasOwn(node, "enum") &&
      !(node.enum as unknown[]).some((x) => typeof x === typeof value && x === value)
    ) unavailable();
    if (
      Object.hasOwn(node, "pattern") &&
      new RegExp("^(?:" + node.pattern + ")$").exec(value as string)?.[0] !== value
    ) unavailable();
    return value;
  }
  project(
    operation: string,
    tier: "standard" | "paid",
    value: unknown,
    authority?: WildcardProjectionAuthority,
  ): unknown {
    try {
      const roots = this.operations.get(operation);
      if (!roots || !Object.hasOwn(roots, tier)) unavailable();
      return this.walk(roots[tier], value, { operation, tier, root: value, authority });
    } catch {
      unavailable();
    }
  }
  auxiliary(root: "error" | "readiness", value: unknown): unknown {
    try {
      return this.walk(this.auxiliaryRoots[root], value);
    } catch {
      unavailable();
    }
  }
}
/** Serialize only projected DTOs; retain large integers and native finite decimal literals. */
export function publicJsonText(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : unavailable();
  }
  if (value instanceof JsonFloat) {
    return JSON_NUMBER.test(value.lexeme) && Number.isFinite(Number(value.lexeme))
      ? value.lexeme
      : unavailable();
  }
  if (Array.isArray(value)) return "[" + value.map(publicJsonText).join(",") + "]";
  if (record(value)) {
    return "{" + Object.entries(value).map(([k, v]) =>
      JSON.stringify(k) + ":" + publicJsonText(v)
    ).join(",") + "}";
  }
  return unavailable();
}
