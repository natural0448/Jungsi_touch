/** Student explanations from the executed approved graph; no coefficients or private trace. */
import { exact, Rational } from "../domain/exact.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
type Row = Record<string, unknown>;
function row(v: unknown): v is Row {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat) &&
    !(v instanceof Rational);
}
export function explainRule(
  rule: Readonly<NativeObject>,
  values: Readonly<NativeObject>,
  trace: Readonly<Row>,
): NativeObject[] {
  const nodes = rule.nodes as NativeObject,
    seen = new Set<string>(),
    reasons = new Map<string, string>();
  function condition(raw: unknown): unknown {
    if (!row(raw)) return null;
    const op = raw.op;
    if (op === "ref") {
      return typeof trace[raw.node as string] === "boolean" ? trace[raw.node as string] : null;
    }
    if (op === "input" || op === "const") {
      const value = op === "input" ? values[raw.field as string] : raw.value;
      if (typeof value === "number" && Number.isSafeInteger(value) || typeof value === "bigint") {
        return exact(value);
      }
      if (typeof value === "string") {
        try {
          const fraction = /^([+-]?[0-9]+)\/([+-]?[0-9]+)$/.exec(value);
          return fraction ? new Rational(BigInt(fraction[1]), BigInt(fraction[2])) : exact(value);
        } catch {
          return value;
        }
      }
      return null;
    }
    if (op === "in") {
      const v = condition(raw.value);
      return v === null ? null : (raw.choices as unknown[]).some((x) => same(v, x));
    }
    if (op === "eq") {
      const a = condition(raw.left), b = condition(raw.right);
      return a === null || b === null ? null : same(a, b);
    }
    if (op === "all" || op === "any") {
      const parts = (raw.args as unknown[]).map(condition);
      return parts.some((x) => typeof x !== "boolean")
        ? null
        : op === "all"
        ? parts.every(Boolean)
        : parts.some(Boolean);
    }
    return null;
  }
  function same(a: unknown, b: unknown): boolean {
    if (a instanceof Rational && b instanceof Rational) return a.compare(b) === 0;
    if (
      a instanceof Rational &&
      (typeof b === "boolean" || typeof b === "bigint" ||
        typeof b === "number" && Number.isSafeInteger(b))
    ) return a.compare(exact(typeof b === "boolean" ? Number(b) : b)) === 0;
    if (b instanceof Rational) return same(b, a);
    return a === b;
  }
  function chosen(e: Row): unknown {
    const c = condition(e.condition);
    return typeof c === "boolean" ? e[c ? "then" : "else"] : null;
  }
  function fields(v: unknown): Set<string> {
    if (Array.isArray(v)) return new Set(v.flatMap((x) => [...fields(x)]));
    if (!row(v)) return new Set();
    if (v.op === "if") return fields(chosen(v));
    if (v.op === "input") return new Set([v.field as string]);
    if (v.op === "ref") return fields(nodes[v.node as string]);
    return new Set(Object.values(v).flatMap((x) => [...fields(x)]));
  }
  function walk(v: unknown): void {
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (!row(v)) return;
    if (v.op === "if") {
      walk(chosen(v));
      return;
    }
    if (v.op === "ref") {
      const name = v.node as string;
      if (!seen.has(name)) {
        seen.add(name);
        walk(nodes[name]);
      }
      return;
    }
    const inputs = fields(v);
    if (v.op === "rank_weighted") {
      if (
        (v.weights as unknown[]).length === 1 && inputs.size > 0 &&
        [...inputs].every((f) => f.startsWith("inquiry1_") || f.startsWith("inquiry2_"))
      ) {
        reasons.set(
          "best_inquiry_one",
          "공식 반영식은 탐구 두 과목 중 우수한 한 과목을 반영합니다.",
        );
      } else reasons.set("ranked_areas", "공식 반영식은 영역 성적의 우수 순서에 따라 반영합니다.");
    }
    if (v.op === "subtract" && fields(v.right).has("english_grade")) {
      reasons.set(
        "english_deduction",
        "공식 반영식에 영어 등급별 환산값을 차감하는 연산이 있습니다.",
      );
    } else if ((v.op === "lookup" || v.op === "bands") && inputs.has("english_grade")) {
      reasons.set("english_grade_table", "공식 반영식에서 영어 등급별 환산표를 적용합니다.");
    }
    Object.values(v).forEach(walk);
  }
  walk(nodes[rule.output_node as string]);
  return [...reasons].map(([code, text]) => ({ code, text, evidence_refs: [rule.rule_version] }));
}
