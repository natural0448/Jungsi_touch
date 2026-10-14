/** Derived JSONB storage only. Source bytes, spelling and digests stay separate. */
import { AccessError } from "../application/access.ts";
import { nativeJsonText } from "../domain/json_value.ts";

function invalid(): never {
  throw new AccessError("storage_parameters_invalid", 503);
}
/** Exact decimal expansion, using Number only for bounded string offsets. */
function fixedDecimal(token: string, maxLength: number): string {
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!m) invalid();
  const fraction = m[3] ?? "", coefficient = m[2] + fraction;
  const exponentText = m[4] ?? "0";
  // Refuse unbounded exponents before allocating a BigInt or expanded text.
  const exponentDigits = exponentText.replace(/^[+-]?0*/, "");
  if (exponentDigits.length > 12) invalid();
  const exponent = BigInt((exponentText[0] === "-" ? "-" : "") + (exponentDigits || "0"));
  const leading = coefficient.match(/^0*/)![0].length;
  const digits = coefficient.slice(leading), zero = digits.length === 0;
  const point = BigInt(m[2].length) + exponent - BigInt(leading);
  const scale = BigInt(digits.length) - point > 0n ? BigInt(digits.length) - point : 1n;
  const integerLength = zero || point < 1n ? 1n : point;
  const length = integerLength + 1n + scale + (m[1] && !zero ? 1n : 0n);
  if (length > BigInt(maxLength)) invalid();
  if (zero) return "0." + "0".repeat(Number(scale));
  let integer: string, decimal: string;
  if (point < 1n) {
    integer = "0";
    decimal = "0".repeat(Number(-point)) + digits;
  } else if (point >= BigInt(digits.length)) {
    integer = digits + "0".repeat(Number(point - BigInt(digits.length)));
    decimal = "0";
  } else {
    integer = digits.slice(0, Number(point));
    decimal = digits.slice(Number(point));
  }
  integer = integer.replace(/^0+(?=[0-9])/, "");
  return m[1] + integer + "." + decimal;
}
/** New derived writes retain a decimal marker through JSONB normalization.
 * This is neither an original-source serializer nor a repair of existing rows.
 * JSONB may still change whitespace, key order and signed zero. Duplicate keys
 * must have been rejected while reading immutable input bytes.
 */
export function nativeJsonbText(value: unknown, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) invalid();
  let raw: string;
  try {
    raw = nativeJsonText(value);
  } catch {
    return invalid();
  }
  let bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes > maxBytes) invalid();
  // Match complete strings first: exponent-looking keys and text are not numbers.
  return raw.replace(
    /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g,
    (token) => {
      if (token[0] === '"' || !/[.eE]/.test(token)) return token;
      const decimal = fixedDecimal(token, maxBytes - bytes + token.length);
      bytes += decimal.length - token.length; // Only ASCII numeric text changes.
      if (bytes > maxBytes) invalid();
      return decimal;
    },
  );
}
