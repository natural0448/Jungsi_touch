/** SQL text boundaries: never reconstruct native payloads from driver objects. */
import { AccessError } from "../application/access.ts";
import { JsonFloat, type NativeJson, parseNativeJson } from "../domain/native_json.ts";
import { calendarDate, utcInstant, utcText } from "../domain/time.ts";

function invalid(): never {
  throw new AccessError("storage_result_invalid", 503);
}
function text(value: unknown, limit: number): string {
  if (
    typeof value !== "string" || !Number.isSafeInteger(limit) || limit < 1 ||
    value.length > limit || new TextEncoder().encode(value).byteLength > limit
  ) invalid();
  return value;
}
/** Call only for an explicitly selected JSON/JSONB column cast to text.
 * JSONB has already normalized its input; original source bytes and duplicate-key
 * evidence must be checked before JSONB storage, never recovered from this read.
 * Integral exponent tokens may already be integer text here. This parser cannot
 * infer their original numeric class; raw artifact decoders must use source bytes.
 */
export function sqlJsonText(value: unknown, maxBytes = 2000000): NativeJson {
  try {
    return parseNativeJson(text(value, maxBytes));
  } catch {
    return invalid();
  }
}
export function sqlObjectText(value: unknown, maxBytes = 2000000): Record<string, NativeJson> {
  const result = sqlJsonText(value, maxBytes);
  if (
    result === null || typeof result !== "object" || Array.isArray(result) ||
    result instanceof JsonFloat
  ) invalid();
  return result as Record<string, NativeJson>;
}
export function sqlArrayText(value: unknown, maxBytes = 2000000): NativeJson[] {
  const result = sqlJsonText(value, maxBytes);
  if (!Array.isArray(result)) invalid();
  return result;
}
/** int8 is text on the wire; preserve values beyond the safe JS integer range. */
export function sqlIntegerText(value: unknown): number | bigint {
  const raw = text(value, 128);
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(raw)) invalid();
  const integer = BigInt(raw);
  return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(integer)
    : integer;
}
/** PostgreSQL numeric is an exact decimal, including a numeric value such as 2.0. */
export function sqlDecimalText(value: unknown): JsonFloat {
  const raw = text(value, 1024);
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) invalid();
  return new JsonFloat(raw);
}
/** Queries format timestamptz as UTC with six fractional digits, not a JS Date. */
export function sqlUtcText(value: unknown): string {
  const raw = text(value, 32);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(raw)) invalid();
  try {
    return utcText(utcInstant(raw));
  } catch {
    return invalid();
  }
}
export function sqlDateText(value: unknown): string {
  try {
    return calendarDate(text(value, 10));
  } catch {
    return invalid();
  }
}
/** Reject uncast JSON and native arrays before they can enter a repository. */
export function requireSqlTextColumns(columns: readonly { type: number }[]): void {
  // Scalar SQL integers/numeric remain exact driver strings where necessary.
  // Floats, dates, timestamps, JSON and every array require an explicit text cast.
  const allowed = new Set([16, 19, 20, 21, 23, 25, 1042, 1043, 1700, 2278, 2950]);
  if (!Array.isArray(columns) || columns.some((c) => !c || !allowed.has(c.type))) invalid();
}
