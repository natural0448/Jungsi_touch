/**
 * REVIEW-ONLY projection for missing published-score cells.
 * No route, publisher, database, runtime authority or evidence adapter is installed here.
 * The only public DTO is a per-cell allowlisted reason array; generic reason_code is never evidence.
 */
import { AccessError } from "./access.ts";
import { detachedQualificationSnapshot } from "./history_field_qualification.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { hasAsciiControl } from "../domain/text.ts";

type ScoreField = "final_50_percent_cut" | "final_70_percent_cut";
export type VerifiedScoreNullReason = "other_statistic_only" | "three_or_fewer";
export interface ScoreNullReasonDto {
  readonly field: ScoreField;
  readonly verified_score_null_reasons: readonly VerifiedScoreNullReason[];
}
export interface ScoreNullReasonSnapshot {
  readonly publication_sha256: string;
  readonly source_head_sha256: string;
  readonly scope_sha256: string;
}
export interface ScoreNullReasonTarget {
  readonly field: ScoreField;
  readonly row: NativeObject;
  /** Server-selected actual-result anchor in the same validated row; never client input. */
  readonly selection?:
    | Readonly<{ anchor_field: ScoreField | "alternate_cut"; entry_index: number | null }>
    | Readonly<
      {
        anchor_field: "target_slot";
        entry_index: null;
        cohort_code: string;
        basis_code: string;
        official_document_sha256: string;
      }
    >;
}
export interface ScoreNullReasonEvidenceRequest {
  readonly snapshot: ScoreNullReasonSnapshot;
  readonly subjects: readonly Readonly<
    { subject: NativeObject; cell_sha256: string; identity_review_sha256: string }
  >[];
}
/**
 * Server-owned adapter only: it must independently authenticate issuer, purpose, exact
 * snapshot/subject and official evidence, including confirmed-null identity, expiry and
 * revocation. It must not echo a request, trust a status string, or accept client proof.
 * Actual implementation, hard cancellation and an atomic publication boundary are NOT_RUN.
 */
export interface ScoreNullReasonEvidencePort {
  verifyBatch(request: ScoreNullReasonEvidenceRequest): Promise<unknown>;
  assertCurrent(
    snapshot: ScoreNullReasonSnapshot,
    receiptSha256s: readonly string[],
  ): Promise<void>;
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OBS = /^(?:observation|admission):[a-f0-9]{64}$/;
const FIELDS = ["final_50_percent_cut", "final_70_percent_cut"] as const;
const EMPTY: readonly VerifiedScoreNullReason[] = Object.freeze([]);
function invalid(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value);
  if (
    Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))
  ) invalid();
  return result;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) invalid();
  return value;
}
function stringValue(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !hasAsciiControl(value);
}
function snapshot(value: unknown): ScoreNullReasonSnapshot {
  const s = exact(value, ["publication_sha256", "source_head_sha256", "scope_sha256"]);
  return Object.freeze({
    publication_sha256: hash(s.publication_sha256),
    source_head_sha256: hash(s.source_head_sha256),
    scope_sha256: hash(s.scope_sha256),
  });
}
interface Candidate {
  readonly field: ScoreField;
  readonly subject: NativeObject;
  readonly subjectSha256: string;
  readonly cellSha256: string;
  readonly identityReviewSha256: string;
}
async function candidate(
  raw: unknown,
): Promise<{ field: ScoreField; candidate: Candidate | null }> {
  const initial = object(raw);
  const target = exact(raw, [
    "field",
    "row",
    ...(Object.hasOwn(initial, "selection") ? ["selection"] : []),
  ]);
  if (!FIELDS.includes(target.field as ScoreField)) invalid();
  const field = target.field as ScoreField;
  const row = object(target.row);
  const cell = object(row[field]);
  const identityReview = object(row.identity_review);
  const year = row.academic_year;
  const percent = field === "final_50_percent_cut" ? 50 : 70;
  // A 2027 recruitment placeholder is not an observed historical admission result.
  if (
    cell.value !== null ||
    !["not_published", "pending_value_missing"].includes(cell.status as string) ||
    row.mapping_status !== "mapped" || identityReview.status !== "source_consistent" ||
    identityReview.reason_code !== null ||
    !Array.isArray(identityReview.variants) || ![2024, 2025, 2026].includes(year as number) ||
    !stringValue(row.university_id, 128) || !ID.test(row.university_id) ||
    !stringValue(row.original_pk, 128) || !ID.test(row.original_pk) ||
    row.offering_id !== `${year}:${row.original_pk}` ||
    cell.statistic_percent !== null && cell.statistic_percent !== percent
  ) {
    return { field, candidate: null };
  }
  const optionalFields = ["campus", "admission_track", "group"] as const;
  if (optionalFields.some((key) => row[key] !== null && !stringValue(row[key]))) {
    return { field, candidate: null };
  }
  const source = cell.source_context === null || cell.source_context === undefined
    ? null
    : object(cell.source_context);
  const pub = cell.publication_context === undefined ? null : object(cell.publication_context);
  const calculation = cell.score_calculation_context === undefined
    ? null
    : object(cell.score_calculation_context);
  if (
    pub && pub.publication_role !== "actual_result" || calculation &&
      (calculation.observation_role !== "actual_result" ||
        calculation.source_result_year !== year ||
        calculation.score_calculation_year !== year)
  ) return { field, candidate: null };

  let observationId: string | null = null;
  let variant: number;
  let cohort: string;
  let basis: string;
  let anchorInfo: NativeObject | null = null;
  if (source) {
    if (
      Object.hasOwn(target, "selection") || source.scope_status !== "source_consistent" ||
      typeof source.observation_id !== "string" || !OBS.test(source.observation_id) ||
      !Number.isSafeInteger(source.identity_variant_index) ||
      Number(source.identity_variant_index) < 0 ||
      Number(source.identity_variant_index) > 15 ||
      Number(source.identity_variant_index) >= identityReview.variants.length ||
      cell.statistic_percent !== percent || !stringValue(cell.cohort_code, 128) ||
      !stringValue(cell.basis_code, 128) ||
      pub?.publication_role !== "actual_result" || calculation?.observation_role !== "actual_result"
    ) {
      return { field, candidate: null };
    }
    observationId = source.observation_id;
    variant = Number(source.identity_variant_index);
    cohort = cell.cohort_code;
    basis = cell.basis_code;
  } else {
    // No observation is invented for the absent cell. Selection must point at an existing
    // actual published score in this same row; the trusted provider independently reviews
    // that this is the selected cohort/basis and that its evidence covers the empty slot.
    if (!Object.hasOwn(target, "selection") || identityReview.variants.length !== 1) {
      return { field, candidate: null };
    }
    const selectionRaw = object(target.selection);
    if (selectionRaw.anchor_field === "target_slot") {
      const selected = exact(selectionRaw, [
        "anchor_field",
        "entry_index",
        "cohort_code",
        "basis_code",
        "official_document_sha256",
      ]);
      if (
        selected.entry_index !== null || !stringValue(selected.cohort_code, 128) ||
        !stringValue(selected.basis_code, 128) ||
        typeof selected.official_document_sha256 !== "string" ||
        !HASH.test(selected.official_document_sha256) ||
        cell.cohort_code !== null && cell.cohort_code !== undefined &&
          cell.cohort_code !== selected.cohort_code ||
        cell.basis_code !== null && cell.basis_code !== undefined &&
          cell.basis_code !== selected.basis_code
      ) {
        return { field, candidate: null };
      }
      // The independently authenticated provider must prove the official document and the
      // exact target-slot/cohort/basis; the server selection alone never grants a reason.
      variant = 0;
      cohort = selected.cohort_code;
      basis = selected.basis_code;
      anchorInfo = Object.freeze({
        field: "target_slot",
        entry_index: null,
        observation_id: null,
        statistic_percent: null,
        cell_sha256: null,
        official_document_sha256: selected.official_document_sha256,
      }) as NativeObject;
    } else {
      const selected = exact(selectionRaw, ["anchor_field", "entry_index"]);
      const anchorField = selected.anchor_field;
      let anchor: Record<string, unknown>;
      if (anchorField === "alternate_cut") {
        const alt = object(row.alternate_cut);
        if (
          !Array.isArray(alt.entries) || alt.entries.length > 16 ||
          !Number.isSafeInteger(selected.entry_index) ||
          Number(selected.entry_index) < 0 || Number(selected.entry_index) >= alt.entries.length
        ) {
          return { field, candidate: null };
        }
        anchor = object(alt.entries[Number(selected.entry_index)]);
      } else if (
        FIELDS.includes(anchorField as ScoreField) && anchorField !== field &&
        selected.entry_index === null
      ) {
        anchor = object(row[anchorField as string]);
      } else return { field, candidate: null };
      const anchorSource = anchor.source_context === null || anchor.source_context === undefined
        ? null
        : object(anchor.source_context);
      const anchorPub = anchor.publication_context === undefined
        ? null
        : object(anchor.publication_context);
      const anchorCalc = anchor.score_calculation_context === undefined
        ? null
        : object(anchor.score_calculation_context);
      const anchorValue = anchor.value;
      if (
        !(typeof anchorValue === "string" && !!anchorValue.trim() ||
          typeof anchorValue === "bigint" ||
          typeof anchorValue === "number" && Number.isSafeInteger(anchorValue) ||
          anchorValue instanceof JsonFloat) ||
        anchor.status !== "verified_official" || !stringValue(anchor.unit) ||
        !stringValue(anchor.source_url, 2048) ||
        !stringValue(anchor.source_as_of, 64) || !stringValue(anchor.cohort_code, 128) ||
        !stringValue(anchor.basis_code, 128) || !anchorSource ||
        anchorSource.scope_status !== "source_consistent" ||
        typeof anchorSource.observation_id !== "string" || !OBS.test(anchorSource.observation_id) ||
        !Number.isSafeInteger(anchorSource.identity_variant_index) ||
        Number(anchorSource.identity_variant_index) < 0 ||
        Number(anchorSource.identity_variant_index) > 15 ||
        Number(anchorSource.identity_variant_index) >= identityReview.variants.length ||
        anchorPub?.publication_role !== "actual_result" ||
        anchorCalc?.observation_role !== "actual_result" ||
        anchorCalc.source_result_year !== year || anchorCalc.score_calculation_year !== year ||
        cell.cohort_code !== null && cell.cohort_code !== undefined &&
          cell.cohort_code !== anchor.cohort_code ||
        cell.basis_code !== null && cell.basis_code !== undefined &&
          cell.basis_code !== anchor.basis_code ||
        anchor.statistic_percent === percent ||
        anchorField === "final_50_percent_cut" && anchor.statistic_percent !== 50 ||
        anchorField === "final_70_percent_cut" && anchor.statistic_percent !== 70 ||
        anchor.statistic_percent !== null && (!Number.isSafeInteger(anchor.statistic_percent) ||
            Number(anchor.statistic_percent) < 1 || Number(anchor.statistic_percent) > 100)
      ) {
        return { field, candidate: null };
      }
      variant = Number(anchorSource.identity_variant_index);
      cohort = anchor.cohort_code;
      basis = anchor.basis_code;
      anchorInfo = Object.freeze({
        field: anchorField as string,
        entry_index: selected.entry_index as number | null,
        observation_id: anchorSource.observation_id,
        statistic_percent: anchor.statistic_percent as number | null,
        cell_sha256: await nativeJsonSha256(anchor as NativeObject),
      }) as NativeObject;
    }
  }
  const variantRow = object(identityReview.variants[variant]);
  if (
    ["university_name", "department", "admission_track", "group"].some((key) =>
      !Object.hasOwn(row, key) || !Object.hasOwn(variantRow, key) || variantRow[key] !== row[key]
    )
  ) return { field, candidate: null };
  const subject = Object.freeze({
    academic_year: year as number,
    university_id: row.university_id,
    original_pk: row.original_pk,
    campus: row.campus as string | null,
    admission_track: row.admission_track as string | null,
    group: row.group as string | null,
    confirmed_null_identity_fields: Object.freeze(
      optionalFields.filter((key) => row[key] === null),
    ),
    // null is the genuine missing target observation, not a fabricated ID.
    observation_id: observationId,
    identity_variant_index: variant,
    cohort_code: cohort,
    basis_code: basis,
    statistic_percent: percent,
    field,
    selection_anchor: anchorInfo,
  }) as unknown as NativeObject;
  return {
    field,
    candidate: Object.freeze({
      field,
      subject,
      subjectSha256: await nativeJsonSha256(subject),
      cellSha256: await nativeJsonSha256(cell as NativeObject),
      identityReviewSha256: await nativeJsonSha256(identityReview as NativeObject),
    }),
  };
}
function validReason(raw: unknown, subject: NativeObject): VerifiedScoreNullReason {
  const r = object(raw);
  if (r.kind === "three_or_fewer") {
    exact(r, ["kind", "cohort_code", "maximum_count", "count_scope"]);
    if (
      r.cohort_code !== subject.cohort_code || r.maximum_count !== 3 ||
      r.count_scope !== "same_cohort"
    ) invalid();
    return "three_or_fewer";
  }
  if (r.kind === "other_statistic_only") {
    exact(r, [
      "kind",
      "cohort_code",
      "basis_code",
      "statistic_kind",
      "statistic_percent",
      "observation_id",
      "publication_role",
    ]);
    if (
      r.cohort_code !== subject.cohort_code || r.basis_code !== subject.basis_code ||
      r.publication_role !== "actual_result" || typeof r.observation_id !== "string" ||
      !OBS.test(r.observation_id) ||
      !["percent_cut", "mean", "lowest", "highest"].includes(r.statistic_kind as string)
    ) invalid();
    const anchor = subject.selection_anchor === null ? null : object(subject.selection_anchor);
    if (
      anchor &&
      (r.observation_id !== anchor.observation_id ||
        r.statistic_percent !== anchor.statistic_percent)
    ) invalid();
    if (r.statistic_kind === "percent_cut") {
      if (
        !Number.isSafeInteger(r.statistic_percent) || Number(r.statistic_percent) < 1 ||
        Number(r.statistic_percent) > 100 || r.statistic_percent === subject.statistic_percent
      ) invalid();
    } else if (r.statistic_percent !== null) invalid();
    return "other_statistic_only";
  }
  return invalid();
}
/**
 * Per-target DTOs preserve input order and contain only the two public enum values.
 * Missing adapter or ineligible/unproven cells yield an empty array, never an inferred reason.
 * Only a trusted server composition may supply the snapshot and evidence port.
 */
export async function projectScoreNullReasons(
  snapshotInput: ScoreNullReasonSnapshot,
  targetsInput: readonly ScoreNullReasonTarget[],
  evidencePort: ScoreNullReasonEvidencePort | null,
  nowUtcMilliseconds: () => number,
): Promise<readonly ScoreNullReasonDto[]> {
  const frozenSnapshot = snapshot(detachedQualificationSnapshot(snapshotInput));
  const frozenTargets = detachedQualificationSnapshot(targetsInput);
  if (
    !Array.isArray(frozenTargets) || frozenTargets.length > 256 ||
    typeof nowUtcMilliseconds !== "function"
  ) invalid();
  const candidates = await Promise.all(frozenTargets.map(candidate));
  const output = () =>
    candidates.map(({ field }) => Object.freeze({ field, verified_score_null_reasons: EMPTY }));
  if (!evidencePort) return Object.freeze(output());
  if (
    typeof evidencePort.verifyBatch !== "function" ||
    typeof evidencePort.assertCurrent !== "function"
  ) invalid();
  const distinct = new Map<string, Candidate>();
  for (const { candidate: item } of candidates) {
    if (item) {
      const existing = distinct.get(item.subjectSha256);
      if (
        existing &&
        (existing.cellSha256 !== item.cellSha256 ||
          existing.identityReviewSha256 !== item.identityReviewSha256)
      ) invalid();
      distinct.set(item.subjectSha256, item);
    }
  }
  if (!distinct.size) return Object.freeze(output());
  const request = Object.freeze({
    snapshot: frozenSnapshot,
    subjects: Object.freeze([...distinct.values()].map((x) =>
      Object.freeze({
        subject: x.subject,
        cell_sha256: x.cellSha256,
        identity_review_sha256: x.identityReviewSha256,
      })
    )),
  });
  let rawEvidence: unknown;
  try {
    rawEvidence = await evidencePort.verifyBatch(request);
  } catch {
    return invalid();
  }
  const raw = detachedQualificationSnapshot(rawEvidence);
  if (!Array.isArray(raw) || raw.length > 512) invalid();
  const reasons = new Map<string, Set<VerifiedScoreNullReason>>();
  const receipts = new Set<string>();
  const expiry: number[] = [];
  const now = nowUtcMilliseconds();
  if (!Number.isSafeInteger(now) || now < 0) invalid();
  for (const item of raw) {
    const proof = exact(item, [
      "publication_sha256",
      "source_head_sha256",
      "scope_sha256",
      "subject",
      "cell_sha256",
      "identity_review_sha256",
      "review_receipt_sha256",
      "issued_at_ms",
      "expires_at_ms",
      "reason",
    ]);
    if (
      proof.publication_sha256 !== frozenSnapshot.publication_sha256 ||
      proof.source_head_sha256 !== frozenSnapshot.source_head_sha256 ||
      proof.scope_sha256 !== frozenSnapshot.scope_sha256 ||
      !Number.isSafeInteger(proof.issued_at_ms) || !Number.isSafeInteger(proof.expires_at_ms) ||
      Number(proof.issued_at_ms) > now || Number(proof.expires_at_ms) <= now ||
      Number(proof.expires_at_ms) <= Number(proof.issued_at_ms)
    ) invalid();
    const subject = object(proof.subject) as NativeObject;
    const subjectHash = await nativeJsonSha256(subject);
    const expected = distinct.get(subjectHash);
    if (
      !expected || proof.cell_sha256 !== expected.cellSha256 ||
      proof.identity_review_sha256 !== expected.identityReviewSha256
    ) invalid();
    const receipt = hash(proof.review_receipt_sha256);
    const reason = validReason(proof.reason, expected.subject);
    const found = reasons.get(subjectHash) ?? new Set<VerifiedScoreNullReason>();
    if (found.has(reason)) invalid();
    found.add(reason);
    reasons.set(subjectHash, found);
    receipts.add(receipt);
    expiry.push(Number(proof.expires_at_ms));
  }
  try {
    await evidencePort.assertCurrent(frozenSnapshot, Object.freeze([...receipts].sort()));
  } catch {
    return invalid();
  }
  const finalNow = nowUtcMilliseconds();
  if (!Number.isSafeInteger(finalNow) || finalNow < now || expiry.some((v) => finalNow >= v)) {
    invalid();
  }
  return Object.freeze(candidates.map(({ field, candidate: item }) => {
    const found = item ? reasons.get(item.subjectSha256) : undefined;
    const list: VerifiedScoreNullReason[] = [];
    if (found?.has("three_or_fewer")) list.push("three_or_fewer");
    if (found?.has("other_statistic_only")) list.push("other_statistic_only");
    return Object.freeze({ field, verified_score_null_reasons: Object.freeze(list) });
  }));
}
