/**
 * Review candidate: batch over an independently authorized owner-published v25 source.
 * No SQL identifier, privileges, publisher, live source head, or operational wiring is installed.
 * Requires the approved new boundary to supply the two keys and all 13 specified value fields.
 * The existing owner-only 15-column view is not directly readable by the app; never connect it
 * directly, fabricate missing fields, or infer the separate Guide fields.
 */
import { AccessError } from "./access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";

export const V25_TEXT_FIELDS = [
  "최초모집인원",
  "수시이월인원",
  "최종모집인원",
  "모집인원_발표기준미명시",
  "경쟁률",
  "충원합격인원_명",
  "최종합격예비번호_번",
  "충원발표값_정의확인대기",
  "원문충원항목명",
  "발표모집집단",
  "공동발표학과목록",
  "조회자료상태",
  "최종합격예비번호_발표기준",
] as const;
export type V25Field = typeof V25_TEXT_FIELDS[number];
export type V25Key = Readonly<{ academicYear: number; offeringPk: string }>;
export type V25Values = Readonly<Record<V25Field, string | null>>;
export type V25PublishedRow = Readonly<V25Key & { values: V25Values }>;
export type V25BatchResult = Readonly<{
  key: V25Key;
  state: "present" | "missing" | "separate_2027";
  values: V25Values | null;
}>;
/**
 * Server-owned authority must bind the exact request, active session/admission, approved v25
 * publisher and current source head. It must reject an old uploaded release as source.
 * It also independently ensures the reader's permission and source identity.
 */
export interface OwnerV25Authority {
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    reader: OwnerV25BatchReader,
  ): Promise<void>;
}
export interface OwnerV25BatchReader {
  /** One bounded operation; cancellation must settle only when the underlying read has stopped. */
  read(keys: readonly V25Key[], signal: AbortSignal): Promise<readonly V25PublishedRow[]>;
}
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function stableKey(year: number, pk: string): string {
  return JSON.stringify([year, pk]);
}
function keyOf(value: unknown): V25Key {
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  const k = value as Record<string, unknown>;
  if (
    !Number.isInteger(k.academicYear) ||
    ![2024, 2025, 2026, 2027].includes(k.academicYear as number) ||
    typeof k.offeringPk !== "string" || k.offeringPk.length === 0 ||
    k.offeringPk.length > 512 || k.offeringPk.trim() !== k.offeringPk
  ) unavailable();
  return Object.freeze({ academicYear: k.academicYear as number, offeringPk: k.offeringPk });
}
function snapshotValues(value: unknown): V25Values {
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  const source = value as Record<string, unknown>;
  const output: Partial<Record<V25Field, string | null>> = {};
  for (const key of Object.keys(source)) {
    if (!V25_TEXT_FIELDS.includes(key as V25Field)) unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (
      !descriptor || !("value" in descriptor) ||
      (descriptor.value !== null && typeof descriptor.value !== "string")
    ) unavailable();
    output[key as V25Field] = descriptor.value as string | null;
  }
  if (V25_TEXT_FIELDS.some((field) => !Object.hasOwn(output, field))) unavailable();
  return Object.freeze(output) as V25Values;
}
/**
 * Preserves request order, missing row vs explicit null, and the distinct count/rank fields.
 * A 2027 key is returned as separate_2027 and never sent to this 2024-2026 source.
 * No old release fallback, per-key IO, number conversion, write or detached task is provided.
 */
export async function readOwnerV25Batch(
  request: ApiExecution,
  keys: readonly V25Key[],
  boundary: ApiExecutionBoundary,
  authority: OwnerV25Authority,
  reader: OwnerV25BatchReader,
): Promise<readonly V25BatchResult[]> {
  if (
    !request || !boundary || !boundary.admission || !boundary.signal || boundary.signal.aborted ||
    !authority || typeof authority.assertCurrent !== "function" ||
    !reader || typeof reader.read !== "function" || !Array.isArray(keys) ||
    keys.length < 1 || keys.length > 100
  ) unavailable();
  const signal = boundary.signal, admission = boundary.admission;
  const assertBoundary = () => {
    if (signal.aborted || boundary.signal !== signal || boundary.admission !== admission) {
      unavailable();
    }
  };
  const input = keys.map(keyOf);
  const seen = new Set(input.map((k) => stableKey(k.academicYear, k.offeringPk)));
  if (seen.size !== input.length) unavailable();
  const requested = input.filter((k) => k.academicYear !== 2027);
  const allowed = new Set(requested.map((k) => stableKey(k.academicYear, k.offeringPk)));
  await authority.assertCurrent(request, boundary, reader);
  assertBoundary();
  const rows = requested.length ? await reader.read(Object.freeze(requested), signal) : [];
  assertBoundary();
  if (!Array.isArray(rows) || rows.length > requested.length) unavailable();
  const collected = new Map<string, V25Values>();
  for (const row of rows) {
    const k = keyOf(row);
    const id = stableKey(k.academicYear, k.offeringPk);
    if (!allowed.has(id) || collected.has(id)) unavailable();
    collected.set(id, snapshotValues(row.values));
  }
  await authority.assertCurrent(request, boundary, reader);
  assertBoundary();
  return Object.freeze(input.map((key) => {
    if (key.academicYear === 2027) {
      return Object.freeze({ key, state: "separate_2027" as const, values: null });
    }
    const value = collected.get(stableKey(key.academicYear, key.offeringPk));
    return value === undefined
      ? Object.freeze({ key, state: "missing" as const, values: null })
      : Object.freeze({ key, state: "present" as const, values: value });
  }));
}
