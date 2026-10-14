/** Compatibility digest for Python json.dumps(default=str), never a raw-source byte hash. */
import { Rational, requireContract as check } from "./exact.ts";
import { nativeJsonSha256, type NativeObject } from "./json_value.ts";
import { JsonFloat, type NativeJson } from "./native_json.ts";
/** Decimal.__str__ spelling, without converting the number through IEEE-754. */
export function pythonDecimalText(raw: string): string {
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(raw);
  check(m, "INVALID_NUMBER");
  const fraction = m[3] ?? "", all = m[2] + fraction, digits = all.replace(/^0+/, "") || "0";
  const e = BigInt(m[4] ?? "0") - BigInt(fraction.length);
  check(e >= -10000n && e <= 10000n, "NUMERIC_RESOURCE_LIMIT");
  const adjusted = e + BigInt(digits.length) - 1n, sign = m[1];
  if (e <= 0n && adjusted >= -6n) {
    const point = BigInt(digits.length) + e;
    if (e === 0n) return sign + digits;
    if (point <= 0n) return sign + "0." + "0".repeat(Number(-point)) + digits;
    return sign + digits.slice(0, Number(point)) + "." + digits.slice(Number(point));
  }
  return sign + digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") + "E" +
    (adjusted >= 0n ? "+" : "") + String(adjusted);
}
export async function pythonDefaultStrJsonSha256(value: unknown): Promise<string> {
  function adapted(v: unknown): NativeJson {
    if (v instanceof JsonFloat) return pythonDecimalText(v.lexeme);
    if (v instanceof Rational) return v.toString();
    if (Array.isArray(v)) return v.map(adapted);
    if (v !== null && typeof v === "object") {
      check([Object.prototype, null].includes(Object.getPrototypeOf(v)), "native_json_invalid");
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, adapted(x)])) as NativeObject;
    }
    return v as NativeJson;
  }
  return await nativeJsonSha256(adapted(value));
}
