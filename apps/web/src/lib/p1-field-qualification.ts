/** PRIVATE INTEGRATION DRAFT. Accept only the existing authenticated snapshot API's
 * backend-validated, current-publication, immutable-part-pinned payload.
 * Shape/parent checks here are NOT descriptor/authority approval. */
import type { Cell } from "./p1-shape";
type Obj = Record<string, unknown>;
type MetadataText = (value: unknown) => string | null;
const RANK = "final_additional_admission_rank";
const SUBJECT = ["observation_id", "academic_year", "offering_pk", "identity_variant_index"];
const YEARS = ["2024", "2025", "2026", "2027"];
function invalid(): never { throw new Error("p1_field_qualification_invalid"); }
function closed(value: unknown, keys: readonly string[]): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) invalid();
  const row = value as Obj, own = Reflect.ownKeys(row), descriptors = Object.getOwnPropertyDescriptors(row);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]) || !descriptors[key].enumerable)) invalid();
  return row;
}
function hash(value: unknown): void { if (typeof value !== "string" || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) invalid(); }
function metadata(value: unknown, text: MetadataText, year: boolean): string {
  const s = text(value);
  if (s === null || (year ? !YEARS.includes(s) : !/^(?:[0-9]|1[0-5])$/.test(s))) invalid();
  return s;
}
/** No value/rank conversion, no URI/date synthesis, no head grants or self-binding. */
export function projectBackendValidatedRank(slot: string, rawCell: Obj, row: Obj | undefined, text: MetadataText): Cell["sq"] {
  if (!Object.hasOwn(rawCell, "service_qualification")) return undefined;
  if (slot !== RANK || row === undefined) invalid();
  const q = closed(rawCell.service_qualification, ["format", "authority_sha256", "qualification_receipt_sha256", "subject", "normalized_service_fields"]);
  if (q.format !== "jungsi.history-field-service-qualification/v1") invalid();
  hash(q.authority_sha256); hash(q.qualification_receipt_sha256);
  const subject = closed(q.subject, SUBJECT), context = closed(rawCell.source_context, ["observation_id", "identity_variant_index", "scope_status"]);
  const selected = metadata(subject.identity_variant_index, text, false);
  if (typeof subject.observation_id !== "string" || !/^(?:observation|admission):[a-f0-9]{64}$/.test(subject.observation_id) || typeof subject.offering_pk !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(subject.offering_pk)) invalid();
  if (row.mapping_status !== "mapped" || metadata(subject.academic_year, text, true) !== metadata(row.academic_year, text, true) || row.original_pk !== subject.offering_pk || context.observation_id !== subject.observation_id || metadata(context.identity_variant_index, text, false) !== selected || !["source_consistent", "review_pending"].includes(String(context.scope_status))) invalid();
  const review = closed(row.identity_review, ["status", "reason_code", "variants"]);
  if (!["source_consistent", "metadata_pending", "review_pending"].includes(String(review.status)) || !Array.isArray(review.variants) || review.variants.length > 16 || !review.variants.some((_v, i) => String(i) === selected)) invalid();
  const normalized = closed(q.normalized_service_fields, ["status", "unit"]);
  if (normalized.status !== "verified_official" || normalized.unit !== "번" || rawCell.status !== "pending_metadata" || rawCell.unit !== null || typeof rawCell.value !== "string" || !/^(?:0|[1-9][0-9]{0,1023})$/.test(rawCell.value)) invalid();
  // No q subject, authority/receipt, CID or PK is newly copied to browser props.
  return { status: "verified_official", unit: "번" };
}
export function rankDisplayModel(cell: Cell): { cell: Cell; qualified: boolean; rawPending: boolean } {
  if (!Object.hasOwn(cell, "sq")) return { cell, qualified: false, rawPending: cell.s.startsWith("pending") };
  const q = closed(cell.sq, ["status", "unit"]);
  if (q.status !== "verified_official" || q.unit !== "번" || cell.v === null || !/^(?:0|[1-9][0-9]{0,1023})$/.test(cell.v) || cell.s !== "pending_metadata" || cell.u !== null) invalid();
  return { cell: { ...cell, s: "verified_official", u: "번" }, qualified: true, rawPending: true };
}
