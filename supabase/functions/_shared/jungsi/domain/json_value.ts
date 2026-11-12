/** Exact private JSON serialization, separate from role-based public projection. */
import { requireContract } from "./exact.ts";
import { JsonFloat, type NativeJson } from "./native_json.ts";
export type NativeObject = { [key: string]: NativeJson };
function keyOrder(a: string, b: string): number {
  // Code-unit order equals code-point order until a surrogate is involved; only then use the slow path.
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const p = a.charCodeAt(i), q = b.charCodeAt(i);
    if (p === q) continue;
    if ((p < 0xd800 || p > 0xdfff) && (q < 0xd800 || q > 0xdfff)) return p - q;
    return codePointOrder(a, b);
  }
  return a.length === b.length ? 0 : codePointOrder(a, b);
}
function codePointOrder(a: string, b: string): number {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const difference = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (difference) return difference;
  }
  return x.length - y.length;
}
export function nativeJsonText(value: unknown, sortedKeys = false): string {
  const seen = new Set<object>();
  function encode(v: unknown, depth: number): string {
    requireContract(depth <= 128, "native_json_depth");
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (typeof v === "bigint") return String(v);
    if (typeof v === "number") {
      requireContract(
        Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)),
        "native_json_invalid",
      );
      return JSON.stringify(v);
    }
    if (v instanceof JsonFloat) {
      requireContract(
        /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(v.lexeme),
        "native_json_invalid",
      );
      // A numeric SQL column may declare a decimal even when its text is "2".
      // Keep that explicit decimal type; parsed source exponent spelling stays intact.
      return /[.eE]/.test(v.lexeme) ? v.lexeme : v.lexeme + ".0";
    }
    requireContract(typeof v === "object" && v !== null && !seen.has(v), "native_json_invalid");
    const object = v as object;
    requireContract(
      Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v)),
      "native_json_invalid",
    );
    seen.add(object);
    let result: string;
    if (Array.isArray(v)) {
      requireContract(Object.keys(v).length === v.length, "native_json_invalid");
      result = "[" + v.map((x) => encode(x, depth + 1)).join(",") + "]";
    } else {
      const data = v as Record<string, unknown>, keys = Object.keys(data);
      if (sortedKeys) keys.sort(keyOrder);
      result = "{" + keys.map((k) =>
        JSON.stringify(k) + ":" + encode(data[k], depth + 1)
      ).join(",") + "}";
    }
    seen.delete(object);
    return result;
  }
  return encode(value, 0);
}
const FLOAT_LEXEME = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER), SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
/**
 * Same result and errors as parseNativeJson(nativeJsonText(value)) without the text round trip:
 * null-prototype objects in key order, non-integer numbers as JsonFloat(JSON.stringify(n)),
 * -0 as 0, safe bigints as numbers, and JsonFloat integers spelled with ".0".
 */
export function cloneNativeJson<T extends NativeJson>(value: T): T {
  const seen = new Set<object>();
  function copy(v: unknown, depth: number): NativeJson {
    requireContract(depth <= 128, "native_json_depth");
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "bigint") return v >= SAFE_MIN && v <= SAFE_MAX ? Number(v) : v;
    if (typeof v === "number") {
      requireContract(
        Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)),
        "native_json_invalid",
      );
      return Number.isInteger(v) ? (v === 0 ? 0 : v) : new JsonFloat(JSON.stringify(v));
    }
    if (v instanceof JsonFloat) {
      requireContract(FLOAT_LEXEME.test(v.lexeme), "native_json_invalid");
      return new JsonFloat(/[.eE]/.test(v.lexeme) ? v.lexeme : v.lexeme + ".0");
    }
    requireContract(typeof v === "object" && v !== null && !seen.has(v), "native_json_invalid");
    const object = v as object, proto = Object.getPrototypeOf(v);
    requireContract(
      Array.isArray(v) || proto === Object.prototype || proto === null,
      "native_json_invalid",
    );
    seen.add(object);
    let result: NativeJson;
    if (Array.isArray(v)) {
      requireContract(Object.keys(v).length === v.length, "native_json_invalid");
      result = v.map((x) => copy(x, depth + 1));
    } else {
      const data = v as Record<string, unknown>,
        out: { [key: string]: NativeJson } = Object.create(null);
      for (const k of Object.keys(data)) out[k] = copy(data[k], depth + 1);
      result = out;
    }
    seen.delete(object);
    return result;
  }
  return copy(value, 0) as T;
}
export async function nativeJsonSha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(nativeJsonText(value, true)),
  );
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}
