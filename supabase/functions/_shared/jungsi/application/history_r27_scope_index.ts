/** Sealed scope membership for proposed P1 v2; requires a separately authorized publisher descriptor. */
import { AccessError } from "./access.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { hasAsciiControl } from "../domain/text.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export interface R27ScopeIndexPins {
  readonly indexSha256: string;
  readonly publicationSha256: string;
  readonly sourceHeadSha256: string;
  readonly scopeSha256: string;
  readonly coverageSha256: string;
}
export interface VerifiedR27ScopeIndex {
  readonly kind: "verified_r27_scope_index";
}
type IndexState = R27ScopeIndexPins & { readonly keys: ReadonlyMap<string, string> };
const states = new WeakMap<VerifiedR27ScopeIndex, IndexState>();
function fail(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function object(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) fail();
  const keys = Reflect.ownKeys(raw);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) fail();
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(raw, field);
    if (!d || !d.enumerable || !("value" in d)) fail();
    result[field] = d.value;
  }
  return result;
}
function nullableText(value: unknown): void {
  if (value === null) return;
  if (
    typeof value !== "string" || !value.trim() || value.length > 2048 ||
    hasAsciiControl(value)
  ) fail();
}
function copyBytes(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  if (!(raw instanceof Uint8Array) || typeof getter !== "function") fail();
  const size = Reflect.apply(getter, raw, []) as number;
  if (size <= 0 || size > 8_388_608) fail();
  const copy = new Uint8Array(new ArrayBuffer(size));
  Uint8Array.prototype.set.call(copy, raw);
  return copy;
}
/** Pins are obtained from verified server publication configuration, never the request. */
export async function bindR27ScopeIndex(
  rawBytes: Uint8Array,
  trusted: R27ScopeIndexPins,
): Promise<VerifiedR27ScopeIndex> {
  const names = [
    "indexSha256",
    "publicationSha256",
    "sourceHeadSha256",
    "scopeSha256",
    "coverageSha256",
  ] as const;
  const rawPins = object(trusted, names);
  const pin = Object.freeze(Object.fromEntries(names.map((name) => {
    const value = rawPins[name];
    if (typeof value !== "string" || !HASH.test(value)) fail();
    return [name, value];
  }))) as unknown as R27ScopeIndexPins;
  const copy = copyBytes(rawBytes);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer))]
    .map((v) => v.toString(16).padStart(2, "0")).join("");
  if (hash !== pin.indexSha256) fail();
  let parsed: unknown;
  try {
    parsed = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(copy));
  } catch {
    fail();
  }
  const index = object(parsed, [
    "format",
    "source_head_sha256",
    "scope_sha256",
    "coverage_sha256",
    "entries",
  ]);
  if (
    index.format !== "jungsi.r27-global-scope-index/v1" ||
    index.source_head_sha256 !== pin.sourceHeadSha256 || index.scope_sha256 !== pin.scopeSha256 ||
    index.coverage_sha256 !== pin.coverageSha256 || !Array.isArray(index.entries) ||
    index.entries.length > 20_000
  ) fail();
  const keys = new Map<string, string>(), schoolsByPk = new Map<string, string>();
  for (const raw of index.entries) {
    const entry = object(raw, [
      "academic_year",
      "university_id",
      "original_pk",
      "campus",
      "admission_track",
      "group",
      "row_sha256",
    ]);
    if (
      entry.academic_year !== 2027 || typeof entry.university_id !== "string" ||
      !ID.test(entry.university_id) ||
      typeof entry.original_pk !== "string" || !ID.test(entry.original_pk) ||
      typeof entry.row_sha256 !== "string" || !HASH.test(entry.row_sha256)
    ) fail();
    nullableText(entry.campus);
    nullableText(entry.admission_track);
    nullableText(entry.group);
    const previous = schoolsByPk.get(entry.original_pk);
    if (previous !== undefined && previous !== entry.university_id) fail();
    schoolsByPk.set(entry.original_pk, entry.university_id);
    const key = JSON.stringify([
      entry.academic_year,
      entry.university_id,
      entry.original_pk,
      entry.campus,
      entry.admission_track,
      entry.group,
    ]);
    if (keys.has(key)) fail();
    keys.set(key, entry.row_sha256);
  }
  const context = Object.freeze({ kind: "verified_r27_scope_index" as const });
  states.set(context, { ...pin, keys });
  return context;
}
export async function assertR27ScopeIndex(
  context: VerifiedR27ScopeIndex | undefined,
  publicationSha256: string,
  sourceHeadSha256: string,
  scopeSha256: string,
  rows: readonly NativeObject[],
): Promise<void> {
  const state = context && states.get(context);
  if (
    !state || state.publicationSha256 !== publicationSha256 ||
    state.sourceHeadSha256 !== sourceHeadSha256 || state.scopeSha256 !== scopeSha256
  ) fail();
  for (const row of rows) {
    if (row.academic_year !== 2027 || row.mapping_status !== "mapped") continue;
    const scope = row.r27_source;
    if (
      !scope || typeof scope !== "object" || Array.isArray(scope) || scope instanceof JsonFloat ||
      typeof (scope as NativeObject).scope_key !== "string"
    ) fail();
    const expected = state.keys.get((scope as NativeObject).scope_key as string);
    if (!expected || await nativeJsonSha256(row) !== expected) fail();
  }
}

/** Publisher-side: all approved parts must contain every index entry exactly once. */
export async function assertCompleteR27ScopeIndex(
  context: VerifiedR27ScopeIndex | undefined,
  publicationSha256: string,
  sourceHeadSha256: string,
  scopeSha256: string,
  rows: readonly NativeObject[],
): Promise<void> {
  await assertR27ScopeIndex(context, publicationSha256, sourceHeadSha256, scopeSha256, rows);
  const state = context && states.get(context);
  if (!state) fail();
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.academic_year !== 2027 || row.mapping_status !== "mapped") continue;
    const source = row.r27_source as NativeObject;
    const key = source.scope_key as string;
    if (seen.has(key)) fail();
    seen.add(key);
  }
  if (seen.size !== state.keys.size) fail();
}
