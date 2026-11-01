/** Historical observation estimates only. No student rank, rule execution or source-cell promotion. */
import { AccessError } from "./access.ts";
import { exact } from "../domain/exact.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";

const HASH = /^[a-f0-9]{64}$/;
const CID = /^(?:observation|admission):[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const HISTORICAL_REFERENCE_FIELD = "historical_cutoff_references";
export const HISTORICAL_REFERENCE_METRIC = "estimated_upper_cumulative_percent_all_examinees";
const publications = new WeakMap<object, readonly string[]>();
export interface VerifiedHistoricalReferencePublication {
  readonly releaseId: string;
  readonly exportSha256: string;
  readonly headReceiptSha256: string;
  readonly observationCount: number;
  readonly schoolCount: number;
}
function fail(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function object(raw: unknown, keys: readonly string[]): NativeObject {
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) fail();
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some((k) => typeof k !== "string" || !keys.includes(k))) {
    fail();
  }
  for (const key of own) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !d.enumerable || !("value" in d)) fail();
  }
  return raw as NativeObject;
}
/** Called only after the independent review's bytes, publisher, manifest and rule pins are verified. */
export function bindHistoricalReferencePublication(
  descriptor: unknown,
  manifestSha256: string,
  sourceHeadSha256: string,
  scopeSha256: string,
): VerifiedHistoricalReferencePublication {
  const d = object(descriptor, [
    "format",
    "release_id",
    "source_export_sha256",
    "head_readback_receipt_sha256",
    "metric",
    "observation_count",
    "school_count",
    "engine_approved",
    "production_allowed",
    "display_scope",
  ]);
  if (
    d.format !== "jungsi.history-reference-estimates/v1" ||
    typeof d.release_id !== "string" || !/^reference-percentile:[a-f0-9]{64}$/.test(d.release_id) ||
    [
      d.source_export_sha256,
      d.head_readback_receipt_sha256,
      manifestSha256,
      sourceHeadSha256,
      scopeSha256,
    ].some((v) => typeof v !== "string" || !HASH.test(v)) ||
    d.metric !== HISTORICAL_REFERENCE_METRIC || d.engine_approved !== false ||
    d.production_allowed !== false || d.display_scope !== "historical_admission_only" ||
    !Number.isSafeInteger(d.observation_count) || Number(d.observation_count) < 1 ||
    !Number.isSafeInteger(d.school_count) || Number(d.school_count) < 1 ||
    Number(d.school_count) > Number(d.observation_count)
  ) fail();
  const value = Object.freeze({
    releaseId: d.release_id,
    exportSha256: d.source_export_sha256 as string,
    headReceiptSha256: d.head_readback_receipt_sha256 as string,
    observationCount: Number(d.observation_count),
    schoolCount: Number(d.school_count),
  });
  publications.set(value, Object.freeze([manifestSha256, sourceHeadSha256, scopeSha256]));
  return value;
}

/** A row-level list keeps each derived value once; selected cuts resolve it by their existing CID. */
export function validateHistoricalReferenceList(raw: unknown, row: NativeObject): void {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16) fail();
  const seen = new Set<string>();
  for (const item of raw) {
    const e = object(item, [
      "format",
      "observation_id",
      "academic_year",
      "school_id",
      "offering_pk",
      "value",
      "unit",
      "status",
      "label",
      "scope",
      "method_id",
      "release_id",
      "display_role",
      "statistic_label",
      "reference_status",
      "engine_approved",
      "production_allowed",
    ]);
    if (
      e.format !== "jungsi.historical-cutoff-reference/v1" ||
      typeof e.observation_id !== "string" || !CID.test(e.observation_id) ||
      seen.has(e.observation_id) ||
      e.academic_year !== row.academic_year ||
      ![2024, 2025, 2026, 2027].includes(e.academic_year as number) ||
      typeof e.school_id !== "string" || !ID.test(e.school_id) ||
      e.school_id !== row.university_id ||
      typeof e.offering_pk !== "string" || !ID.test(e.offering_pk) ||
      e.offering_pk !== row.original_pk ||
      e.unit !== "%" || e.status !== "model_estimated" || e.label !== "추정상위누백(전체응시자)" ||
      e.scope !== "historical_admission_cutoff" || e.display_role !== "independent_observation" ||
      e.statistic_label !== null ||
      e.reference_status !== "CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE" ||
      e.engine_approved !== false || e.production_allowed !== false ||
      typeof e.method_id !== "string" ||
      !/^estimated-whole-cohort-percentile:[a-f0-9]{64}$/.test(e.method_id) ||
      typeof e.release_id !== "string" ||
      !/^reference-percentile:[a-f0-9]{64}$/.test(e.release_id) ||
      typeof e.value !== "string" || e.value.length > 128 ||
      !/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(e.value)
    ) fail();
    try {
      const number = exact(e.value);
      if (number.compare(exact(0)) < 0 || number.compare(exact(100)) > 0) fail();
    } catch {
      fail();
    }
    seen.add(e.observation_id);
  }
}

/** Structural validation alone is insufficient to serve a new mathematical-reference field. */
export function assertHistoricalReferenceBody(
  body: NativeObject,
  context: VerifiedHistoricalReferencePublication | undefined,
  manifestSha256?: string,
  sourceHeadSha256?: string,
  scopeSha256?: string,
): void {
  const rows = body.rows as NativeObject[];
  const all = rows.flatMap((r) => (r[HISTORICAL_REFERENCE_FIELD] ?? []) as NativeObject[]);
  if (!all.length) return;
  const pins = context && publications.get(context);
  if (
    !context || !pins || pins[0] !== manifestSha256 || pins[1] !== sourceHeadSha256 ||
    pins[2] !== scopeSha256 || all.length > context.observationCount
  ) fail();
  const seen = new Set<string>();
  for (const e of all) {
    if (e.release_id !== context.releaseId || seen.has(e.observation_id as string)) fail();
    seen.add(e.observation_id as string);
  }
}
