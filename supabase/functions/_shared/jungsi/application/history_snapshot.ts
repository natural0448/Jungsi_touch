/** Read-only public P1 projection. Normalization decisions belong to the reviewed publisher. */
import { AccessError } from "./access.ts";
import type { RequestClockPort } from "./ports.ts";
import { sessionDto, type SessionSnapshot } from "./session_service.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { hasAsciiControl } from "../domain/text.ts";
import { calendarDate } from "../domain/time.ts";
import { publicSourceUrl } from "./catalog.ts";
import { assertR27ScopeIndex, type VerifiedR27ScopeIndex } from "./history_r27_scope_index.ts";
import { assertP1R27DeliveryMode } from "./p1_r27_delivery_mode.ts";
import { assertP1R27ConsumerGate, type VerifiedP1R27ConsumerGate } from "./p1_r27_consumer_gate.ts";
import {
  assertFieldQualificationPublication,
  detachedQualificationSnapshot,
  validateFieldServiceQualification,
  type VerifiedQualificationPublication,
} from "./history_field_qualification.ts";
import {
  assertHistoricalReferenceBody,
  HISTORICAL_REFERENCE_FIELD,
  validateHistoricalReferenceList,
  type VerifiedHistoricalReferencePublication,
} from "./history_reference_estimates.ts";
export const HISTORY_SNAPSHOT_SLOTS = [
  "recruitment_count_with_stage",
  "competition_ratio",
  "additional_admission_count",
  "final_additional_admission_rank",
  "final_50_percent_cut",
  "final_70_percent_cut",
  "alternate_cut",
] as const;
export const HISTORY_PUBLICATION_STATUSES = [
  "verified_official",
  "pending_metadata",
  "pending_value_type",
  "pending_value_missing",
  "not_published",
] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, HASH = /^[a-f0-9]{64}$/;
export interface SnapshotPart {
  readonly partId: string | null;
  readonly payloadId: string;
  readonly gzipBytes: number;
  readonly gzipSha256: string;
  readonly decodedBytes: number;
  readonly decodedSha256: string;
  readonly rows: number;
  readonly mappedRows: number;
  readonly mappingPendingRows: number;
  readonly objectKey: string;
}
export interface SnapshotPublication {
  readonly snapshotId: string;
  readonly publicationSha256: string;
  readonly sourceHeadSha256: string;
  readonly scopeSha256: string;
  readonly generatedAt: string;
  readonly sourceAsOf: string | null;
  readonly schemaVersion: "jungsi.history-snapshot/v1" | "jungsi.history-snapshot/v2";
  readonly normalizationRulesVersion: string;
  readonly selectionRulesVersion: string;
  readonly expiresAtUtc: bigint;
  readonly counts: {
    readonly rows: number;
    readonly mapped_rows: number;
    readonly mapping_pending_rows: number;
    readonly observations: number;
    readonly schools: number;
  };
  readonly full: SnapshotPart | null;
  readonly parts: readonly SnapshotPart[];
  /** Private server grant context; never a field of the public snapshot head DTO. */
  readonly fieldQualification?: VerifiedQualificationPublication;
  /** Pinned independent historical reference data; never grants raw-cell or applicant eligibility. */
  readonly historicalReferences?: VerifiedHistoricalReferencePublication;
  /** Verified whole-publication 2027 identity scope, bound by the trusted publisher descriptor. */
  readonly r27ScopeIndex?: VerifiedR27ScopeIndex;
  readonly r27Gate?: VerifiedP1R27ConsumerGate;
}
export interface HistorySnapshotPort {
  current(): Promise<SnapshotPublication>;
  read(publication: SnapshotPublication, part: SnapshotPart): Promise<NativeObject>;
  /** A fresh bounded head read. A revoked, unavailable or changed head must fail closed. */
  assertCurrent(publication: SnapshotPublication): Promise<void>;
}
function invalid(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function exact(raw: unknown, fields: readonly string[]): NativeObject {
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) invalid();
  const row = raw as NativeObject;
  if (Object.keys(row).length !== fields.length || fields.some((k) => !Object.hasOwn(row, k))) {
    invalid();
  }
  return row;
}
function text(v: unknown, nullable = false, allowLineFeeds = false): void {
  if (nullable && v === null) return;
  if (
    typeof v !== "string" || !v.trim() || v.length > 2048 ||
    hasAsciiControl(allowLineFeeds ? v.replaceAll("\n", "") : v)
  ) {
    invalid();
  }
}
function instant(v: unknown): void {
  if (typeof v !== "string") invalid();
  try {
    utcInstant(v);
  } catch {
    invalid();
  }
}
function scalar(v: unknown): boolean {
  return v === null || typeof v === "string" || typeof v === "bigint" ||
    typeof v === "number" && Number.isSafeInteger(v) || v instanceof JsonFloat;
}

/** Proposed v2 identity is based only on already-public, explicitly supplied scope. */
function r27ScopeKey(row: NativeObject): string {
  return JSON.stringify([
    row.academic_year,
    row.university_id,
    row.original_pk,
    row.campus,
    row.admission_track,
    row.group,
  ]);
}
function r27Optional(raw: unknown, allowed: readonly string[]): NativeObject {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat) invalid();
  const fields = Object.keys(raw);
  if (fields.some((field) => !allowed.includes(field))) invalid();
  return exact(raw, fields);
}
function r27Source(row: NativeObject): void {
  const info = exact(row.r27_source, [
    "scope_key",
    "scope_review",
    "quota",
    "quota_review_status",
    "history_link_status",
    "history_link_pending_years",
    "historical_links",
  ]);
  if (info.scope_key !== r27ScopeKey(row) || info.scope_review !== "eligible") invalid();
  const quota = r27Optional(info.quota, [
    "quota_value",
    "quota_literal_state",
    "quota_stage",
    "quota_condition_text",
    "quota_cell",
  ]);
  if (Object.hasOwn(quota, "quota_value") && !scalar(quota.quota_value)) invalid();
  if (typeof quota.quota_value === "string" && quota.quota_value.length > 1024) invalid();
  for (const name of ["quota_literal_state", "quota_stage", "quota_condition_text"]) {
    if (Object.hasOwn(quota, name)) text(quota[name], true);
  }
  let meta: NativeObject | null = null;
  if (Object.hasOwn(quota, "quota_cell") && quota.quota_cell !== null) {
    meta = r27Optional(quota.quota_cell, ["status", "reason_code", "unit", "source_as_of"]);
    for (const name of Object.keys(meta)) text(meta[name], true);
    if (meta.source_as_of !== null && meta.source_as_of !== undefined) {
      try {
        if (typeof meta.source_as_of === "string" && meta.source_as_of.length === 10) {
          calendarDate(meta.source_as_of);
        } else instant(meta.source_as_of);
      } catch {
        invalid();
      }
    }
  }
  const expectedValue = Object.hasOwn(quota, "quota_value") ? quota.quota_value : null;
  const conflict = meta?.status === "verified_official" &&
    (expectedValue === null || expectedValue === "");
  if (conflict) invalid();
  const conditional = typeof quota.quota_condition_text === "string" ||
    quota.quota_literal_state === "conditional_transfer" ||
    quota.quota_literal_state === "conditional_carryover";
  const expectedReview = conditional
    ? "condition_present"
    : !Object.hasOwn(quota, "quota_stage") || quota.quota_stage === null
    ? "stage_unknown"
    : "source_stage_only";
  if (info.quota_review_status !== expectedReview) invalid();
  const cell = row.recruitment_count_with_stage as NativeObject;
  if (nativeJsonText(cell.value) !== nativeJsonText(expectedValue)) invalid();
  if (
    (!Object.hasOwn(quota, "quota_stage") || quota.quota_stage === null) &&
    cell.stage !== "unspecified"
  ) invalid();
  if (conditional && cell.stage === "final") invalid();
  if (cell.stage !== "unspecified" && cell.stage !== quota.quota_stage) invalid();

  const pending = info.history_link_pending_years, links = info.historical_links;
  if (!Array.isArray(pending) || !Array.isArray(links) || pending.length > 3 || links.length > 3) {
    invalid();
  }
  const pendingYears = new Set<number>();
  for (const year of pending) {
    if (
      !Number.isSafeInteger(year) || ![2024, 2025, 2026].includes(Number(year)) ||
      pendingYears.has(Number(year))
    ) invalid();
    pendingYears.add(Number(year));
  }
  const linkedYears = new Set<number>();
  for (const rawLink of links) {
    const link = exact(rawLink, [
      "academic_year",
      "school_id",
      "original_pk",
      "campus",
      "admission_track",
      "group",
    ]);
    const year = Number(link.academic_year);
    if (
      !Number.isSafeInteger(link.academic_year) || ![2024, 2025, 2026].includes(year) ||
      linkedYears.has(year) || pendingYears.has(year) ||
      typeof link.original_pk !== "string" || !ID.test(link.original_pk) ||
      link.school_id !== row.university_id ||
      [row.campus, row.admission_track, row.group].some((v) => v === null) ||
      link.campus !== row.campus || link.admission_track !== row.admission_track ||
      link.group !== row.group
    ) invalid();
    linkedYears.add(year);
  }
  const expectedLinkStatus = pending.length
    ? links.length ? "partially_reviewed" : "conflict_pending"
    : links.length
    ? "exact_reviewed"
    : "not_reviewed";
  if (info.history_link_status !== expectedLinkStatus) invalid();
}

function cell(
  raw: unknown,
  slot: typeof HISTORY_SNAPSHOT_SLOTS[number],
  sourceYear: number,
  alternateEntry = false,
): void {
  const cut = slot.endsWith("percent_cut") || slot === "alternate_cut";
  const row = exact(raw, [
    "value",
    "unit",
    "status",
    "reason_code",
    "source_url",
    "source_as_of",
    "statistic_label",
    "cohort",
    "source_context",
    ...(slot === "alternate_cut" && !alternateEntry
      ? ["entries", "omitted_other_basis_count"]
      : []),
    ...(slot === "recruitment_count_with_stage" ? ["stage"] : []),
    ...(cut
      ? [
        "statistic_percent",
        "basis_code",
        "basis_label",
        "cohort_code",
        "cohort_label",
        "selection_rule_ref",
      ]
      : []),
    ...(cut && raw && typeof raw === "object" && Object.hasOwn(raw, "score_calculation_context")
      ? ["score_calculation_context"]
      : []),
    ...(cut && (slot !== "alternate_cut" || alternateEntry) && raw && typeof raw === "object" &&
        Object.hasOwn(raw, "publication_context")
      ? ["publication_context"]
      : []),
  ]);
  if (Object.hasOwn(row, "score_calculation_context")) {
    const context = exact(row.score_calculation_context, [
      "source_result_year",
      "score_calculation_year",
      "observation_role",
    ]);
    const year = context.score_calculation_year, role = context.observation_role;
    if (
      !Number.isSafeInteger(context.source_result_year) ||
      context.source_result_year !== sourceYear ||
      year !== null && (!Number.isSafeInteger(year) || Number(year) < 1 || Number(year) > 9999) ||
      !["actual_result", "prior_year_recalculated_reference", "unresolved"].includes(
        role as string,
      ) ||
      role !== "unresolved" && year === null ||
      role === "actual_result" && Number(year) !== sourceYear ||
      role === "prior_year_recalculated_reference" &&
        (!alternateEntry || Number(year) <= sourceYear) ||
      role === "unresolved" && !alternateEntry && row.value !== null
    ) invalid();
  }
  if (Object.hasOwn(row, "publication_context")) {
    const publication = exact(row.publication_context, [
      "publication_role",
      "simulation_target_academic_year",
    ]);
    const role = publication.publication_role, target = publication.simulation_target_academic_year;
    const score = row.score_calculation_context as NativeObject | undefined;
    if (
      !["actual_result", "simulation_reference", "unresolved"].includes(role as string) ||
      target !== null &&
        (!Number.isSafeInteger(target) || Number(target) < 1 || Number(target) > 9999) ||
      role !== "simulation_reference" && target !== null ||
      role === "simulation_reference" && !alternateEntry ||
      role === "unresolved" && !alternateEntry && row.value !== null ||
      role === "actual_result" && score?.observation_role === "prior_year_recalculated_reference" ||
      role === "simulation_reference" && score?.observation_role === "actual_result"
    ) invalid();
  }
  if (row.source_context !== null) {
    const c = exact(row.source_context, [
      "observation_id",
      "identity_variant_index",
      "scope_status",
    ]);
    if (
      typeof c.observation_id !== "string" ||
      !/^(?:observation|admission):[a-f0-9]{64}$/.test(c.observation_id) ||
      !Number.isSafeInteger(c.identity_variant_index) || Number(c.identity_variant_index) < 0 ||
      Number(c.identity_variant_index) > 15 ||
      !["source_consistent", "review_pending"].includes(c.scope_status as string)
    ) invalid();
  }
  if (slot === "alternate_cut" && !alternateEntry) {
    if (
      !Array.isArray(row.entries) || row.entries.length > 16 ||
      !Number.isSafeInteger(row.omitted_other_basis_count) ||
      Number(row.omitted_other_basis_count) < 0
    ) invalid();
    for (const entry of row.entries) cell(entry, "alternate_cut", sourceYear, true);
  }
  if (
    slot === "recruitment_count_with_stage" &&
    !["initial", "carryover", "final", "unspecified"].includes(row.stage as string)
  ) invalid();
  if (
    !scalar(row.value) || typeof row.value === "string" && row.value.length > 1024 ||
    !HISTORY_PUBLICATION_STATUSES.includes(
      row.status as typeof HISTORY_PUBLICATION_STATUSES[number],
    )
  ) invalid();
  for (
    const k of ["unit", "reason_code", "source_url", "source_as_of", "statistic_label", "cohort"]
  ) text(row[k], true, k === "statistic_label" || k === "cohort");
  if (row.source_as_of !== null) {
    try {
      if (typeof row.source_as_of === "string" && row.source_as_of.length === 10) {
        calendarDate(row.source_as_of);
      } else instant(row.source_as_of);
    } catch {
      invalid();
    }
  }
  if (row.source_url !== null) {
    try {
      const u = new URL(row.source_url as string);
      publicSourceUrl(row.source_url);
      const path = decodeURIComponent(u.pathname).toLowerCase();
      if (
        u.hostname.endsWith(".supabase.co") || /\/storage\/v1\//.test(path) ||
        u.hostname === "localhost" ||
        /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(u.hostname) ||
        u.hostname.includes(":")
      ) invalid();
      if (
        [...u.searchParams.keys()].some((k) =>
          /token|authorization|api[_-]?key|signature|credential|secret|password|cookie|^x-amz-|^x-goog-/i
            .test(k)
        ) || /token|api[_-]?key|signature|secret/i.test(u.hash)
      ) invalid();
    } catch {
      invalid();
    }
  }
  if (
    row.status === "verified_official" &&
    (row.value === null || typeof row.value === "string" && !row.value.trim() ||
      row.unit === null || row.source_url === null ||
      row.source_as_of === null)
  ) invalid();
  if (
    row.status === "verified_official" &&
    (slot === "final_additional_admission_rank" && row.unit !== "번" ||
      slot === "additional_admission_count" && row.unit !== "명")
  ) invalid();
  if (
    ["pending_value_type", "pending_value_missing", "not_published"].includes(
      row.status as string,
    ) && row.value !== null
  ) invalid();
  if (row.status !== "verified_official" && row.reason_code === null) invalid();
  if (cut) {
    for (
      const k of ["basis_code", "basis_label", "cohort_code", "cohort_label", "selection_rule_ref"]
    ) text(row[k], true, k === "basis_label" || k === "cohort_label");
    if (
      row.statistic_percent !== null &&
      (!Number.isSafeInteger(row.statistic_percent) || Number(row.statistic_percent) < 1 ||
        Number(row.statistic_percent) > 100)
    ) invalid();
    const expected = slot === "final_50_percent_cut"
      ? 50
      : slot === "final_70_percent_cut"
      ? 70
      : null;
    if (expected !== null && row.statistic_percent !== null && row.statistic_percent !== expected) {
      invalid();
    }
    if (
      row.value !== null && (slot !== "alternate_cut" || row.status === "verified_official") &&
      ((!alternateEntry && row.statistic_percent === null) || row.basis_code === null ||
        row.basis_label === null || row.cohort_code === null || row.cohort_label === null ||
        row.selection_rule_ref === null)
    ) invalid();
    // A reviewed nonpercent entry is named by its original publication label; do not infer a cut.
    if (
      alternateEntry && row.statistic_percent === null && row.status === "verified_official" &&
      row.statistic_label === null
    ) invalid();
  }
}
/** Reject private/unknown fields before a pre-generated compressed body can be returned intact. */
export type SnapshotPayloadCounts = Pick<
  SnapshotPart,
  "partId" | "payloadId" | "rows" | "mappedRows" | "mappingPendingRows"
>;
export function validateHistorySnapshotPayload(
  raw: unknown,
  part: SnapshotPayloadCounts,
): NativeObject {
  const body = exact(raw, ["format", "payload_id", "part_id", "rows"]);
  if (
    !["jungsi.history-snapshot/v1", "jungsi.history-snapshot/v2"].includes(body.format as string) ||
    body.payload_id !== part.payloadId ||
    body.part_id !== part.partId || !Array.isArray(body.rows) || body.rows.length !== part.rows
  ) invalid();
  const identities = new Set<string>();
  const v2SchoolsByPk = new Map<string, string>();
  const version2 = body.format === "jungsi.history-snapshot/v2";
  let mapped = 0, pending = 0;
  for (const item of body.rows) {
    const row = exact(item, [
      "offering_id",
      "academic_year",
      "original_pk",
      "observation_key",
      "mapping_status",
      "identity_review",
      "university_id",
      "university_name",
      "region",
      "campus",
      "department",
      "admission_track",
      "group",
      ...HISTORY_SNAPSHOT_SLOTS,
      ...(version2 && item && typeof item === "object" && !Array.isArray(item) &&
          !(item instanceof JsonFloat) && (item as NativeObject).academic_year === 2027 &&
          (item as NativeObject).mapping_status === "mapped"
        ? ["r27_source"]
        : []),
      ...(item && typeof item === "object" && Object.hasOwn(item, HISTORICAL_REFERENCE_FIELD)
        ? [HISTORICAL_REFERENCE_FIELD]
        : []),
    ]);
    const review = exact(row.identity_review, ["status", "reason_code", "variants"]);
    if (
      !["source_consistent", "metadata_pending", "review_pending", "mapping_pending"].includes(
        review.status as string,
      ) || !Array.isArray(review.variants) || review.variants.length > 16
    ) invalid();
    text(review.reason_code, true);
    if ((review.status === "source_consistent") !== (review.reason_code === null)) invalid();
    if (
      row.mapping_status === "mapping_pending" && review.status !== "mapping_pending" ||
      row.mapping_status === "mapped" && review.status === "mapping_pending"
    ) invalid();
    for (const v of review.variants) {
      const variant = exact(v, ["university_name", "department", "admission_track", "group"]);
      for (const k of ["university_name", "department", "admission_track", "group"]) {
        text(variant[k], true, k !== "group");
      }
    }
    if (
      !Number.isSafeInteger(row.academic_year) ||
      ![2024, 2025, 2026, 2027].includes(Number(row.academic_year))
    ) invalid();
    let identity: string;
    if (row.mapping_status === "mapped") {
      if (
        !(typeof row.original_pk === "string" && ID.test(row.original_pk) &&
          !hasAsciiControl(row.original_pk)) || row.observation_key !== null
      ) invalid();
      identity = String(row.academic_year) + ":" + row.original_pk;
      if (row.offering_id !== identity || hasAsciiControl(row.offering_id)) invalid();
      mapped++;
    } else if (row.mapping_status === "mapping_pending") {
      if (
        row.original_pk !== null || row.offering_id !== null ||
        typeof row.observation_key !== "string" ||
        !/^observation:[a-f0-9]{64}$/.test(row.observation_key)
      ) invalid();
      identity = row.observation_key;
      pending++;
    } else invalid();
    if (version2 && row.academic_year === 2027 && row.mapping_status === "mapped") {
      const pk = String(row.original_pk), school = String(row.university_id);
      const previousSchool = v2SchoolsByPk.get(pk);
      if (previousSchool !== undefined && previousSchool !== school) invalid();
      v2SchoolsByPk.set(pk, school);
      identity += ":" + r27ScopeKey(row);
    }
    if (identities.has(identity)) invalid();
    identities.add(identity);
    if (
      typeof row.university_id !== "string" || !ID.test(row.university_id) ||
      hasAsciiControl(row.university_id)
    ) invalid();
    // Missing descriptive metadata remains null. A valid original PK does not prove its labels.
    for (const k of ["university_name", "department", "admission_track"]) text(row[k], true, true);
    for (const k of ["region", "campus", "group"]) text(row[k], true, k !== "group");
    for (const slot of HISTORY_SNAPSHOT_SLOTS) cell(row[slot], slot, Number(row.academic_year));
    if (version2 && row.academic_year === 2027 && row.mapping_status === "mapped") r27Source(row);
    if (Object.hasOwn(row, HISTORICAL_REFERENCE_FIELD)) {
      if (version2 && row.academic_year === 2027) invalid();
      validateHistoricalReferenceList(row[HISTORICAL_REFERENCE_FIELD], row);
    }
    for (const slot of HISTORY_SNAPSHOT_SLOTS) {
      const c = row[slot] as NativeObject, context = c.source_context as NativeObject | null;
      if (context !== null && Number(context.identity_variant_index) >= review.variants.length) {
        invalid();
      }
      if (review.status === "review_pending" && c.value !== null && context === null) invalid();
    }
    for (const entry of (row.alternate_cut as NativeObject).entries as NativeObject[]) {
      const context = entry.source_context as NativeObject | null;
      if (
        entry.value !== null && context === null ||
        context !== null && Number(context.identity_variant_index) >= review.variants.length
      ) invalid();
    }
    const lower = row.final_50_percent_cut as NativeObject,
      upper = row.final_70_percent_cut as NativeObject;
    if (lower.value !== null && upper.value !== null) {
      if (["basis_code", "cohort_code", "unit"].some((k) => lower[k] !== upper[k])) invalid();
      const lowContext = lower.score_calculation_context as NativeObject | undefined;
      const highContext = upper.score_calculation_context as NativeObject | undefined;
      if (
        (lowContext || highContext) &&
        (!lowContext || !highContext || lowContext.observation_role !== "actual_result" ||
          highContext.observation_role !== "actual_result" ||
          lowContext.score_calculation_year !== highContext.score_calculation_year)
      ) invalid();
      const lowPublication = lower.publication_context as NativeObject | undefined;
      const highPublication = upper.publication_context as NativeObject | undefined;
      if (
        (lowPublication || highPublication) &&
        (!lowPublication || !highPublication ||
          lowPublication.publication_role !== "actual_result" ||
          highPublication.publication_role !== "actual_result")
      ) invalid();
    }
  }
  if (
    mapped !== part.mappedRows || pending !== part.mappingPendingRows ||
    mapped + pending !== part.rows
  ) invalid();
  return cloneNativeJson(body);
}
function dataProperty(raw: object, name: string, optional = false): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(raw, name);
  if (!descriptor && optional) return undefined;
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
  return descriptor.value;
}
function hasQualifiedRank(raw: unknown, part: SnapshotPart): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const rows = dataProperty(raw, "rows", true);
  if (!Array.isArray(rows) || rows.length !== part.rows) return false;
  for (let i = 0; i < rows.length; i++) {
    const row = dataProperty(rows, String(i));
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rank = dataProperty(row, "final_additional_admission_rank", true);
    if (rank && typeof rank === "object" && Object.hasOwn(rank, "service_qualification")) {
      return true;
    }
  }
  return false;
}
/** Preserve the synchronous legacy validator. Only independently granted rank q is
 * separated from a detached body, then reattached after all original checks.
 */
export async function validateQualifiedHistorySnapshotPayloadForPublisher(
  raw: unknown,
  part: SnapshotPart,
  publication: SnapshotPublication | null,
): Promise<NativeObject> {
  if (publication) assertP1R27DeliveryMode(publication);
  const validateBody = async (value: unknown): Promise<NativeObject> => {
    const result = validateHistorySnapshotPayload(value, part);
    if (publication && result.format !== dataProperty(publication, "schemaVersion")) invalid();
    if (publication && result.format === "jungsi.history-snapshot/v2") {
      await assertR27ScopeIndex(
        dataProperty(publication, "r27ScopeIndex", true) as VerifiedR27ScopeIndex | undefined,
        dataProperty(publication, "publicationSha256") as string,
        dataProperty(publication, "sourceHeadSha256") as string,
        dataProperty(publication, "scopeSha256") as string,
        result.rows as NativeObject[],
      );
    }
    assertHistoricalReferenceBody(
      result,
      publication
        ? dataProperty(publication, "historicalReferences", true) as
          | VerifiedHistoricalReferencePublication
          | undefined
        : undefined,
      publication ? dataProperty(publication, "publicationSha256") as string : undefined,
      publication ? dataProperty(publication, "sourceHeadSha256") as string : undefined,
      publication ? dataProperty(publication, "scopeSha256") as string : undefined,
    );
    return result;
  };
  const context = publication
    ? dataProperty(publication, "fieldQualification", true) as
      | VerifiedQualificationPublication
      | undefined
    : undefined;
  if (context !== undefined && (!context || typeof context !== "object")) invalid();
  if (!context && !hasQualifiedRank(raw, part)) return validateBody(raw);
  if (!context || !publication) invalid();
  // Capture parent pins and all input data before the first asynchronous hash operation.
  const publicationSha = dataProperty(publication, "publicationSha256"),
    sourceHeadSha = dataProperty(publication, "sourceHeadSha256"),
    scopeSha = dataProperty(publication, "scopeSha256");
  if ([publicationSha, sourceHeadSha, scopeSha].some((v) => typeof v !== "string")) invalid();
  const input = exact(raw, [
    "format",
    "payload_id",
    "part_id",
    "rows",
  ]);
  const rows = dataProperty(input, "rows");
  if (
    !Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype ||
    rows.length !== part.rows || Reflect.ownKeys(rows).length !== rows.length + 1
  ) invalid();
  const body = {
    format: dataProperty(input, "format"),
    payload_id: dataProperty(input, "payload_id"),
    part_id: dataProperty(input, "part_id"),
  };
  const qualified: { index: number; row: NativeObject; rank: NativeObject }[] = [];
  const legacyRows: NativeObject[] = [];
  for (let index = 0; index < rows.length; index++) {
    const item = dataProperty(rows, String(index));
    if (!item || typeof item !== "object" || Array.isArray(item) || item instanceof JsonFloat) {
      invalid();
    }
    const row = item as NativeObject, rank = dataProperty(row, "final_additional_admission_rank");
    if (
      rank && typeof rank === "object" && !Array.isArray(rank) && !(rank instanceof JsonFloat) &&
      Object.hasOwn(rank, "service_qualification")
    ) {
      if (qualified.length === 2) invalid();
      const captured = detachedQualificationSnapshot(row) as NativeObject;
      if (input.format === "jungsi.history-snapshot/v2" && captured.academic_year === 2027) {
        invalid();
      }
      const capturedRank = captured.final_additional_admission_rank as NativeObject;
      qualified.push({ index, row: captured, rank: capturedRank });
      legacyRows.push({
        ...captured,
        final_additional_admission_rank: Object.fromEntries(
          Object.entries(capturedRank).filter(([key]) => key !== "service_qualification"),
        ),
      });
    } else {
      legacyRows.push(row);
    }
  }
  // The legacy validator captures every other row before await, with its original
  // payload bounds. Qualification's small-object cap applies only to its two rows.
  const result = await validateBody({ ...body, rows: legacyRows });
  const grants = await assertFieldQualificationPublication(
    context,
    publicationSha as string,
    sourceHeadSha as string,
    scopeSha as string,
  );
  const resultRows = result.rows as NativeObject[];
  for (let i = 0; i < resultRows.length; i++) {
    const row = resultRows[i];
    const expected = grants.some((g) => {
      const subject = g.subject as NativeObject;
      return subject.academic_year === row.academic_year && subject.offering_pk === row.original_pk;
    });
    if (expected && !qualified.some((q) => q.index === i)) invalid();
  }
  for (const selected of qualified) {
    const q = await validateFieldServiceQualification(
      "final_additional_admission_rank",
      selected.rank,
      selected.row,
      publicationSha as string,
      context,
    );
    if (!q) invalid();
    const row = (result.rows as NativeObject[])[selected.index];
    row.final_additional_admission_rank = {
      ...row.final_additional_admission_rank as NativeObject,
      service_qualification: q,
    };
  }
  return result;
}
/** Public consumer validation requires a verified v2 gate; publisher preflight uses the separate internal API. */
export async function validateQualifiedHistorySnapshotPayload(
  raw: unknown,
  part: SnapshotPart,
  publication: SnapshotPublication | null,
): Promise<NativeObject> {
  if (publication && dataProperty(publication, "schemaVersion") === "jungsi.history-snapshot/v2") {
    assertP1R27DeliveryMode(publication);
    const index = await assertP1R27ConsumerGate(
      dataProperty(publication, "r27Gate", true) as VerifiedP1R27ConsumerGate | undefined,
      publication,
    );
    if (index !== dataProperty(publication, "r27ScopeIndex", true)) invalid();
  }
  return await validateQualifiedHistorySnapshotPayloadForPublisher(raw, part, publication);
}
function publicPart(p: SnapshotPart): NativeObject {
  return {
    part_id: p.partId,
    payload_id: p.payloadId,
    gzip_bytes: p.gzipBytes,
    gzip_sha256: p.gzipSha256,
    decoded_bytes: p.decodedBytes,
    decoded_sha256: p.decodedSha256,
    rows: p.rows,
    mapped_rows: p.mappedRows,
    mapping_pending_rows: p.mappingPendingRows,
  };
}
export class HistorySnapshotService {
  constructor(
    private readonly source: HistorySnapshotPort,
    private readonly clock: RequestClockPort,
    private readonly scopeSha256: string,
  ) {
    if (!HASH.test(scopeSha256)) invalid();
  }
  private async current(session: SessionSnapshot): Promise<SnapshotPublication> {
    sessionDto(session, this.clock.nowUtc());
    const p = await this.source.current();
    if (
      p.scopeSha256 !== this.scopeSha256 || !ID.test(p.snapshotId) ||
      !HASH.test(p.publicationSha256) || p.expiresAtUtc <= this.clock.nowUtc()
    ) invalid();
    if (p.schemaVersion === "jungsi.history-snapshot/v2") {
      assertP1R27DeliveryMode(p);
      const gateIndex = await assertP1R27ConsumerGate(p.r27Gate, p);
      if (gateIndex !== p.r27ScopeIndex) invalid();
      await assertR27ScopeIndex(
        p.r27ScopeIndex,
        p.publicationSha256,
        p.sourceHeadSha256,
        p.scopeSha256,
        [],
      );
    } else if (p.schemaVersion !== "jungsi.history-snapshot/v1") invalid();
    return p;
  }
  private async finish(session: SessionSnapshot, p: SnapshotPublication): Promise<void> {
    await this.source.assertCurrent(p);
    sessionDto(session, this.clock.nowUtc());
    if (p.expiresAtUtc <= this.clock.nowUtc()) invalid();
  }
  async head(
    session: SessionSnapshot,
    query: Readonly<Record<string, string>>,
  ): Promise<NativeObject> {
    if (Object.keys(query).length) throw new AccessError("invalid_request", 422);
    const p = await this.current(session);
    const result: NativeObject = {
      format: "jungsi.history-snapshot-head/v1",
      status: "approved",
      snapshot_id: p.snapshotId,
      publication_sha256: p.publicationSha256,
      source_head_sha256: p.sourceHeadSha256,
      generated_at: p.generatedAt,
      source_as_of: p.sourceAsOf,
      schema_version: p.schemaVersion,
      normalization_rules_version: p.normalizationRulesVersion,
      selection_rules_version: p.selectionRulesVersion,
      counts: { ...p.counts },
      delivery_mode: p.full ? "full" : "parts",
      full: p.full ? publicPart(p.full) : null,
      parts: p.parts.map(publicPart),
      expires_at: utcText(p.expiresAtUtc),
    };
    await this.finish(session, p);
    return result;
  }
  async read(
    session: SessionSnapshot,
    snapshotId: string,
    query: Readonly<Record<string, string>>,
  ): Promise<NativeObject> {
    if (
      !ID.test(snapshotId) || Object.keys(query).some((k) => k !== "part_id") ||
      query.part_id !== undefined && !ID.test(query.part_id)
    ) throw new AccessError("invalid_request", 422);
    const p = await this.current(session);
    if (p.snapshotId !== snapshotId) throw new AccessError("publication_changed", 409);
    const part = query.part_id === undefined
      ? p.full
      : p.parts.find((x) => x.partId === query.part_id);
    if (!part) {
      throw new AccessError(
        query.part_id === undefined ? "part_required" : "snapshot_part_not_found",
        query.part_id === undefined ? 422 : 404,
      );
    }
    const body = await validateQualifiedHistorySnapshotPayload(
      await this.source.read(p, part),
      part,
      p,
    );
    await this.finish(session, p);
    return body;
  }
}
