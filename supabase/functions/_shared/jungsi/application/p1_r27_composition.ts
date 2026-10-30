/** P1 v2 service composition candidate. Synthetic ports only; no writer or runtime activation. */
import {
  HISTORY_SNAPSHOT_SLOTS,
  type SnapshotPart,
  type SnapshotPayloadCounts,
  type SnapshotPublication,
  validateHistorySnapshotPayload,
  validateQualifiedHistorySnapshotPayload,
} from "./history_snapshot.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import {
  buildStandaloneR27,
  type ReviewedR27Links,
  type ReviewedR27Scope,
} from "./r27_standalone.ts";

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function need(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function object(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  need(
    raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
      !(raw instanceof JsonFloat) && [Object.prototype, null].includes(Object.getPrototypeOf(raw)),
    "invalid_evidence",
  );
  const keys = Reflect.ownKeys(raw);
  need(
    keys.length === fields.length &&
      keys.every((key) => typeof key === "string" && fields.includes(key)),
    "invalid_evidence",
  );
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(raw, field);
    need(d && d.enumerable && "value" in d, "invalid_evidence");
    result[field] = d.value;
  }
  return result;
}
function count(value: unknown, max: number): number {
  need(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max,
    "invalid_count",
  );
  return value;
}
function shaField(value: unknown): string {
  need(typeof value === "string" && HASH.test(value), "invalid_pin");
  return value;
}
/** Copies the exact view using typed-array internals, without calling its iterator. */
function bytesSnapshot(raw: Uint8Array, max: number): Uint8Array<ArrayBuffer> {
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  need(raw instanceof Uint8Array && typeof getter === "function", "invalid_bytes");
  const size = Reflect.apply(getter, raw, []) as number;
  need(size > 0 && size <= max, "invalid_bytes");
  const copy = new Uint8Array(new ArrayBuffer(size));
  Uint8Array.prototype.set.call(copy, raw);
  return copy;
}
async function sha(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw.buffer))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
}
function parsed(raw: Uint8Array<ArrayBuffer>): unknown {
  return parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(raw));
}
export interface P1R27Pins {
  readonly manifest_sha256: string;
  readonly coverage_sha256: string;
  readonly source_sha256: string;
  readonly source_head_sha256: string;
  readonly previous_publication_sha256: string;
  readonly previous_source_head_sha256: string;
  readonly scope_sha256: string;
}
export interface BoundP1R27Evidence {
  readonly kind: "bound_p1_r27_evidence";
}
type PagePin = { readonly sha256: string; readonly bytes: number; readonly rows: number };
type Evidence = P1R27Pins & { readonly pages: readonly PagePin[]; readonly expectedRows: number };
const bindings = new WeakMap<BoundP1R27Evidence, Evidence>();
const candidateSeals = new WeakMap<P1R27Candidate, BoundP1R27Evidence>();
const candidateIndexSeals = new WeakMap<NativeObject, {
  readonly candidate: P1R27Candidate;
  readonly evidence: BoundP1R27Evidence;
  readonly partial: boolean;
}>();
/** Inputs were decoded and bounded inside this module before freezing. */
function freezeTree(root: unknown): void {
  const pending: object[] = [], visited = new Set<object>();
  if (root && typeof root === "object") pending.push(root);
  while (pending.length) {
    const item = pending.pop()!;
    if (visited.has(item)) continue;
    visited.add(item);
    for (const value of Object.values(item)) {
      if (value && typeof value === "object" && !visited.has(value)) pending.push(value);
    }
    Object.freeze(item);
  }
}

/** Trusted pins must come from a separately authorized server descriptor, not an API request.
 * The receipt's statements are not proof of live DB state. This candidate never publishes.
 */
export async function bindP1R27Evidence(
  manifestBytes: Uint8Array,
  coverageBytes: Uint8Array,
  trusted: P1R27Pins,
): Promise<BoundP1R27Evidence> {
  const names = [
    "manifest_sha256",
    "coverage_sha256",
    "source_sha256",
    "source_head_sha256",
    "previous_publication_sha256",
    "previous_source_head_sha256",
    "scope_sha256",
  ] as const;
  const rawPins = object(trusted, names);
  const pin = Object.freeze(
    Object.fromEntries(names.map((name) => [name, shaField(rawPins[name])])),
  ) as unknown as P1R27Pins;
  const manifestCopy = bytesSnapshot(manifestBytes, 1_048_576);
  const coverageCopy = bytesSnapshot(coverageBytes, 65_536);
  need(
    await sha(manifestCopy) === pin.manifest_sha256 &&
      await sha(coverageCopy) === pin.coverage_sha256,
    "evidence_digest_mismatch",
  );
  const m = object(parsed(manifestCopy), [
    "format",
    "source_sha256",
    "source_head_sha256",
    "coverage_sha256",
    "previous_publication_sha256",
    "previous_source_head_sha256",
    "scope_sha256",
    "expected_rows",
    "pages",
  ]);
  const c = object(parsed(coverageCopy), [
    "format",
    "source_sha256",
    "source_head_sha256",
    "previous_publication_sha256",
    "previous_source_head_sha256",
    "scope_sha256",
    "snapshot_isolation",
    "source_mode",
    "head_rechecked",
    "writer_stable",
    "previous_scope_mapping_reviewed",
    "expected_rows",
    "source_only",
    "view_only",
    "full_scope_duplicates",
    "unresolved_pk_groups",
    "value_mismatches",
    "numeric_mismatches",
    "null_presence_mismatches",
    "literal_mismatches",
  ]);
  need(
    m.format === "jungsi.r27-page-manifest/v1" && c.format === "jungsi.r27-coverage-receipt/v1",
    "evidence_format",
  );
  for (
    const field of [
      "source_sha256",
      "source_head_sha256",
      "previous_publication_sha256",
      "previous_source_head_sha256",
      "scope_sha256",
    ] as const
  ) need(m[field] === pin[field] && c[field] === pin[field], "evidence_pin_mismatch");
  need(
    m.coverage_sha256 === pin.coverage_sha256 && c.snapshot_isolation === "repeatable_read" &&
      c.source_mode === "current_logical_view" && c.head_rechecked === true &&
      c.writer_stable === true && c.previous_scope_mapping_reviewed === true,
    "coverage_not_accepted",
  );
  for (
    const field of [
      "source_only",
      "view_only",
      "full_scope_duplicates",
      "unresolved_pk_groups",
      "value_mismatches",
      "numeric_mismatches",
      "null_presence_mismatches",
      "literal_mismatches",
    ]
  ) need(c[field] === 0, "coverage_not_accepted");
  const expectedRows = count(m.expected_rows, 20_000);
  need(
    c.expected_rows === expectedRows && Array.isArray(m.pages) && m.pages.length > 0 &&
      m.pages.length <= 512,
    "invalid_page_manifest",
  );
  const rawPages = m.pages;
  const pages = rawPages.map((raw, i) => {
    const p = object(raw, ["sha256", "bytes", "rows"]);
    const rowCount = count(p.rows, 128), size = count(p.bytes, 2_097_152);
    need(size > 0 && (i === rawPages.length - 1 || rowCount > 0), "invalid_page_manifest");
    return Object.freeze({ sha256: shaField(p.sha256), bytes: size, rows: rowCount });
  });
  need(pages.reduce((n, p) => n + p.rows, 0) === expectedRows, "invalid_page_manifest");
  const bound = Object.freeze({ kind: "bound_p1_r27_evidence" as const });
  bindings.set(bound, Object.freeze({ ...pin, pages: Object.freeze(pages), expectedRows }));
  return bound;
}
export interface P1R27ByteSource {
  readPage(index: number): Promise<Uint8Array>;
  /** Must do a fresh verified source-head read. This interface grants no DB permission. */
  assertSourceHead(expectedHeadSha256: string): Promise<void>;
}
/** A server-owned publication-preparation port, separate from the single-part request reader.
 * Implementations must authenticate the prior publication and apply their own read budget.
 */
export interface P1BaselineBatchPort {
  readPinnedBatch(
    request: Readonly<{
      previous_publication_sha256: string;
      previous_source_head_sha256: string;
      scope_sha256: string;
      max_parts: number;
      max_total_gzip_bytes: number;
      max_total_decoded_bytes: number;
    }>,
  ): Promise<
    {
      readonly publication: SnapshotPublication;
      readonly manifest_bytes: Uint8Array;
      readonly gzip_parts: readonly Uint8Array[];
    }
  >;
  assertCurrent(
    request: Readonly<{
      previous_publication_sha256: string;
      previous_source_head_sha256: string;
      scope_sha256: string;
    }>,
  ): Promise<void>;
}
export interface P1R27Limits {
  readonly max_baseline_parts: number;
  readonly max_combined_rows: number;
  readonly max_body_bytes: number;
  readonly max_baseline_gzip_bytes: number;
  readonly max_baseline_decoded_bytes: number;
  readonly max_part_gzip_bytes: number;
  readonly max_part_decoded_bytes: number;
  readonly max_depth: number;
}
export interface P1R27Candidate {
  readonly status: "HOLD_UNPUBLISHED";
  readonly body: NativeObject;
  readonly counts: SnapshotPayloadCounts;
  readonly held_rows: readonly NativeObject[];
  readonly held_previous_rows: readonly NativeObject[];
  /** Private carry-forward evidence; never a public DTO or proof of new-publication authority. */
  readonly rebind_required: readonly {
    readonly kind: "field_qualification" | "historical_reference";
    readonly row: NativeObject;
  }[];
  readonly excluded_count: number;
  readonly source_head_sha256: string;
  readonly coverage_sha256: string;
  readonly previous_publication_sha256: string;
}
function key(row: NativeObject): string {
  return JSON.stringify([
    row.academic_year,
    row.university_id ?? row.school_id,
    row.original_pk,
    row.campus,
    row.admission_track,
    row.group,
  ]);
}
function newCell(slot: typeof HISTORY_SNAPSHOT_SLOTS[number]): NativeObject {
  const cut = slot.endsWith("percent_cut") || slot === "alternate_cut";
  return {
    value: null,
    unit: null,
    status: "pending_value_missing",
    reason_code: "R27_OTHER_DATA_NOT_REVIEWED",
    source_url: null,
    source_as_of: null,
    statistic_label: null,
    cohort: null,
    source_context: null,
    ...(slot === "recruitment_count_with_stage" ? { stage: "unspecified" } : {}),
    ...(slot === "alternate_cut" ? { entries: [], omitted_other_basis_count: 0 } : {}),
    ...(cut
      ? {
        statistic_percent: null,
        basis_code: null,
        basis_label: null,
        cohort_code: null,
        cohort_label: null,
        selection_rule_ref: null,
      }
      : {}),
  };
}
const quotaFields = [
  "quota_value",
  "quota_literal_state",
  "quota_stage",
  "quota_condition_text",
  "quota_cell",
] as const;
function priorRecruitmentIsSubstantive(cell: NativeObject): boolean {
  // Only this generator's exact empty pending placeholder can be replaced freely.
  // Earlier reasons, labels, cohorts and all provenance are otherwise preserved.
  return nativeJsonText(cell, true) !==
    nativeJsonText(newCell("recruitment_count_with_stage"), true);
}
function priorRecruitmentConflicts(previous: NativeObject, projected: NativeObject): boolean {
  const prior = previous.recruitment_count_with_stage as NativeObject;
  if (!priorRecruitmentIsSubstantive(prior)) return false;
  const next = Object.hasOwn(projected, "quota_value") ? projected.quota_value : null;
  const nextStage = Object.hasOwn(projected, "quota_stage") ? projected.quota_stage : null;
  const conditional = typeof projected.quota_condition_text === "string" ||
    projected.quota_literal_state === "conditional_transfer" ||
    projected.quota_literal_state === "conditional_carryover";
  const meta = projected.quota_cell && typeof projected.quota_cell === "object" &&
      !Array.isArray(projected.quota_cell) && !(projected.quota_cell instanceof JsonFloat)
    ? projected.quota_cell as NativeObject
    : null;
  const incompatibleUnit = prior.unit !== null && meta?.unit !== null &&
    meta?.unit !== undefined && prior.unit !== meta.unit;
  return nativeJsonText(prior.value, true) !== nativeJsonText(next, true) || conditional ||
    incompatibleUnit ||
    (prior.stage === "unspecified"
      ? nextStage !== null && nextStage !== "unspecified"
      : nextStage !== prior.stage);
}
function r27Row(
  projected: NativeObject,
  previous: NativeObject | undefined,
  historicalKeys: Set<string>,
): NativeObject {
  const rawQuota: NativeObject = {};
  for (const field of quotaFields) {
    if (Object.hasOwn(projected, field)) rawQuota[field] = projected[field];
  }
  const value = Object.hasOwn(rawQuota, "quota_value") ? rawQuota.quota_value : null;
  const meta = rawQuota.quota_cell && typeof rawQuota.quota_cell === "object" &&
      !Array.isArray(rawQuota.quota_cell) && !(rawQuota.quota_cell instanceof JsonFloat)
    ? rawQuota.quota_cell as NativeObject
    : null;
  const pendingYears = new Set((projected.history_link_pending_years as number[]) ?? []);
  const links: NativeObject[] = [];
  for (const target of projected.historical_links as NativeObject[]) {
    if (historicalKeys.has(key(target))) links.push(target);
    else pendingYears.add(Number(target.academic_year));
  }
  const years = [...pendingYears].sort((a, b) => a - b);
  const linkStatus = years.length
    ? links.length ? "partially_reviewed" : "conflict_pending"
    : links.length
    ? "exact_reviewed"
    : "not_reviewed";
  const row: NativeObject = previous ? { ...previous } : {
    offering_id: "2027:" + projected.original_pk,
    academic_year: 2027,
    original_pk: projected.original_pk,
    observation_key: null,
    mapping_status: "mapped",
    identity_review: {
      status: "metadata_pending",
      reason_code: "R27_SOURCE_METADATA_REVIEW_PENDING",
      variants: [],
    },
    university_id: projected.school_id,
    university_name: projected.university_name ?? null,
    region: projected.region ?? null,
    campus: projected.campus,
    department: projected.department ?? null,
    admission_track: projected.admission_track,
    group: projected.group,
    ...Object.fromEntries(HISTORY_SNAPSHOT_SLOTS.map((slot) => [slot, newCell(slot)])),
  };
  const recruitment: NativeObject = {
    value,
    unit: meta?.unit ?? null,
    status: "pending_metadata",
    reason_code: "R27_METADATA_REVIEW_PENDING",
    source_url: null,
    source_as_of: meta?.source_as_of ?? null,
    statistic_label: null,
    cohort: null,
    source_context: null,
    stage: "unspecified",
  };
  // Preserve a substantive prior cell exactly when the new source agrees; conflicting
  // or missing replacements are held before this function is called.
  row.recruitment_count_with_stage = previous &&
      priorRecruitmentIsSubstantive(previous.recruitment_count_with_stage as NativeObject)
    ? previous.recruitment_count_with_stage
    : recruitment;
  row.r27_source = {
    scope_key: key(row),
    scope_review: "eligible",
    quota: rawQuota,
    quota_review_status: projected.quota_review_status,
    history_link_status: linkStatus,
    history_link_pending_years: years,
    historical_links: links,
  };
  return row;
}

/** Inflates bounded immutable part bytes, retaining the exact decoded bytes for hashing. */
async function inflateBounded(
  raw: Uint8Array<ArrayBuffer>,
  expected: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      need(total <= expected, "baseline_decoded_limit");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  need(total === expected, "baseline_decoded_length");
  const result = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function parseBounded(raw: Uint8Array<ArrayBuffer>, maxDepth: number): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let depth = 0, quoted = false, escaped = false;
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      depth++;
      need(depth <= maxDepth, "baseline_depth_limit");
    } else if (c === "}" || c === "]") {
      depth--;
      need(depth >= 0, "baseline_invalid_json");
    }
  }
  need(depth === 0 && !quoted, "baseline_invalid_json");
  return parseNativeJson(text);
}
function copyPart(raw: SnapshotPart): SnapshotPart {
  return Object.freeze({
    partId: raw.partId,
    payloadId: raw.payloadId,
    gzipBytes: raw.gzipBytes,
    gzipSha256: raw.gzipSha256,
    decodedBytes: raw.decodedBytes,
    decodedSha256: raw.decodedSha256,
    rows: raw.rows,
    mappedRows: raw.mappedRows,
    mappingPendingRows: raw.mappingPendingRows,
    objectKey: raw.objectKey,
  });
}
function manifestPartMatches(raw: unknown, part: SnapshotPart): boolean {
  const m = object(raw, [
    "part_id",
    "payload_id",
    "object_key",
    "gzip_bytes",
    "gzip_sha256",
    "decoded_bytes",
    "decoded_sha256",
    "rows",
    "mapped_rows",
    "mapping_pending_rows",
  ]);
  return m.part_id === part.partId && m.payload_id === part.payloadId &&
    m.object_key === part.objectKey && m.gzip_bytes === part.gzipBytes &&
    m.gzip_sha256 === part.gzipSha256 && m.decoded_bytes === part.decodedBytes &&
    m.decoded_sha256 === part.decodedSha256 && m.rows === part.rows &&
    m.mapped_rows === part.mappedRows && m.mapping_pending_rows === part.mappingPendingRows;
}
function validateBaselineManifest(
  raw: unknown,
  pub: SnapshotPublication,
  parts: readonly SnapshotPart[],
): void {
  const m = object(raw, [
    "format",
    "status",
    "snapshot_id",
    "source_head_sha256",
    "scope_sha256",
    "generated_at",
    "source_as_of",
    "schema_version",
    "normalization_rules_version",
    "normalization_rules_sha256",
    "selection_rules_version",
    "selection_rules_sha256",
    "counts",
    "full",
    "parts",
  ]);
  need(
    m.format === "jungsi.history-snapshot-manifest/v1" && m.status === "approved" &&
      m.snapshot_id === pub.snapshotId && m.source_head_sha256 === pub.sourceHeadSha256 &&
      m.scope_sha256 === pub.scopeSha256 && m.schema_version === pub.schemaVersion &&
      m.generated_at === pub.generatedAt && m.source_as_of === pub.sourceAsOf &&
      m.normalization_rules_version === pub.normalizationRulesVersion &&
      m.selection_rules_version === pub.selectionRulesVersion &&
      typeof m.normalization_rules_sha256 === "string" && HASH.test(m.normalization_rules_sha256) &&
      typeof m.selection_rules_sha256 === "string" && HASH.test(m.selection_rules_sha256),
    "baseline_manifest_mismatch",
  );
  const c = object(m.counts, [
    "rows",
    "mapped_rows",
    "mapping_pending_rows",
    "observations",
    "schools",
  ]);
  for (
    const name of [
      "rows",
      "mapped_rows",
      "mapping_pending_rows",
      "observations",
      "schools",
    ] as const
  ) {
    need(c[name] === pub.counts[name], "baseline_manifest_mismatch");
  }
  if (pub.full) {
    need(
      m.full !== null && parts.length === 1 && manifestPartMatches(m.full, parts[0]),
      "baseline_manifest_mismatch",
    );
  } else {
    need(
      m.full === null && Array.isArray(m.parts) && m.parts.length === parts.length,
      "baseline_manifest_mismatch",
    );
    for (let i = 0; i < parts.length; i++) {
      need(manifestPartMatches((m.parts as unknown[])[i], parts[i]), "baseline_manifest_mismatch");
    }
  }
}

/** Assembles a bounded review body using a single publication-preparation batch call.
 * It does not manufacture a publication head, gzip hash, publisher grant or a successful live read.
 */
export async function composeP1R27Candidate(
  previous: P1BaselineBatchPort,
  source: P1R27ByteSource,
  evidence: BoundP1R27Evidence,
  scope: ReviewedR27Scope,
  links: ReviewedR27Links | undefined,
  payloadId: string,
  limits: P1R27Limits,
): Promise<P1R27Candidate> {
  const e = bindings.get(evidence);
  need(e, "evidence_not_bound");
  const limit = object(limits, [
    "max_baseline_parts",
    "max_combined_rows",
    "max_body_bytes",
    "max_baseline_gzip_bytes",
    "max_baseline_decoded_bytes",
    "max_part_gzip_bytes",
    "max_part_decoded_bytes",
    "max_depth",
  ]);
  const maxParts = count(limit.max_baseline_parts, 512),
    maxRows = count(limit.max_combined_rows, 40_000);
  const maxBodyBytes = count(limit.max_body_bytes, 67_108_864);
  const maxGzipTotal = count(limit.max_baseline_gzip_bytes, 134_217_728);
  const maxDecodedTotal = count(limit.max_baseline_decoded_bytes, 268_435_456);
  const maxGzipPart = count(limit.max_part_gzip_bytes, 16_777_216);
  const maxDecodedPart = count(limit.max_part_decoded_bytes, 67_108_864);
  const maxDepth = count(limit.max_depth, 128);
  need(
    [
      maxParts,
      maxRows,
      maxBodyBytes,
      maxGzipTotal,
      maxDecodedTotal,
      maxGzipPart,
      maxDecodedPart,
      maxDepth,
    ]
      .every((n) => n > 0) && typeof payloadId === "string" && ID.test(payloadId),
    "invalid_build_limits",
  );
  need(
    previous && typeof previous.readPinnedBatch === "function" &&
      typeof previous.assertCurrent === "function" &&
      source && typeof source.readPage === "function" &&
      typeof source.assertSourceHead === "function",
    "source_port_unavailable",
  );
  const readBatch = previous.readPinnedBatch.bind(previous),
    assertPrevious = previous.assertCurrent.bind(previous);
  const readPage = source.readPage.bind(source),
    assertSource = source.assertSourceHead.bind(source);
  const expectedHead = Object.freeze({
    previous_publication_sha256: e.previous_publication_sha256,
    previous_source_head_sha256: e.previous_source_head_sha256,
    scope_sha256: e.scope_sha256,
  });
  const fetched = await readBatch(Object.freeze({
    ...expectedHead,
    max_parts: maxParts,
    max_total_gzip_bytes: maxGzipTotal,
    max_total_decoded_bytes: maxDecodedTotal,
  }));
  const p = fetched?.publication;
  need(
    p && p.publicationSha256 === e.previous_publication_sha256 &&
      p.sourceHeadSha256 === e.previous_source_head_sha256 && p.scopeSha256 === e.scope_sha256 &&
      p.schemaVersion === "jungsi.history-snapshot/v1" && Array.isArray(p.parts) &&
      Array.isArray(fetched.gzip_parts),
    "previous_head_mismatch",
  );
  const parts = (p.full ? [p.full] : p.parts).map(copyPart);
  need(
    parts.length > 0 && parts.length <= maxParts && fetched.gzip_parts.length === parts.length,
    "baseline_part_limit",
  );
  const pub = Object.freeze({
    ...p,
    counts: Object.freeze({ ...p.counts }),
    full: p.full ? parts[0] : null,
    parts: Object.freeze(p.full ? [] : parts),
  });
  const manifestBytes = bytesSnapshot(fetched.manifest_bytes, 2_097_152);
  const compressed: Uint8Array<ArrayBuffer>[] = [];
  let gzipTotal = 0, decodedTotal = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const gzipSize = count(part.gzipBytes, maxGzipPart),
      decodedSize = count(part.decodedBytes, maxDecodedPart);
    need(
      gzipSize > 0 && decodedSize > 0 && HASH.test(part.gzipSha256) &&
        HASH.test(part.decodedSha256),
      "baseline_part_pin_invalid",
    );
    gzipTotal += gzipSize;
    decodedTotal += decodedSize;
    need(gzipTotal <= maxGzipTotal && decodedTotal <= maxDecodedTotal, "baseline_byte_limit");
    const bytes = bytesSnapshot(fetched.gzip_parts[i], gzipSize);
    need(bytes.byteLength === gzipSize, "baseline_gzip_length");
    compressed.push(bytes);
  }
  need(
    await sha(manifestBytes) === e.previous_publication_sha256,
    "baseline_manifest_digest_mismatch",
  );
  validateBaselineManifest(parseBounded(manifestBytes, maxDepth), pub, parts);
  const oldRows: NativeObject[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i], gzip = compressed[i];
    need(await sha(gzip) === part.gzipSha256, "baseline_gzip_digest_mismatch");
    const decoded = await inflateBounded(gzip, part.decodedBytes);
    need(await sha(decoded) === part.decodedSha256, "baseline_decoded_digest_mismatch");
    const body = await validateQualifiedHistorySnapshotPayload(
      parseBounded(decoded, maxDepth),
      part,
      pub,
    );
    oldRows.push(...body.rows as NativeObject[]);
    need(oldRows.length <= maxRows, "baseline_row_limit");
  }
  const rebindRequired: {
    kind: "field_qualification" | "historical_reference";
    row: NativeObject;
  }[] = [];
  for (let i = 0; i < oldRows.length; i++) {
    const row = oldRows[i], rank = row.final_additional_admission_rank;
    if (Object.hasOwn(row, "historical_cutoff_references")) {
      rebindRequired.push({ kind: "historical_reference", row });
    }
    if (
      rank && typeof rank === "object" && !Array.isArray(rank) &&
      Object.hasOwn(rank, "service_qualification")
    ) {
      rebindRequired.push({ kind: "field_qualification", row });
      oldRows[i] = {
        ...row,
        final_additional_admission_rank: Object.fromEntries(
          Object.entries(rank).filter(([field]) => field !== "service_qualification"),
        ) as NativeObject,
      };
    }
  }
  const baselineMapped = oldRows.filter((row) => row.mapping_status === "mapped").length;
  need(
    oldRows.length === pub.counts.rows && baselineMapped === pub.counts.mapped_rows &&
      oldRows.length - baselineMapped === pub.counts.mapping_pending_rows,
    "baseline_incomplete",
  );
  let position = 0;
  const stage = await buildStandaloneR27(
    {
      async readPage(request) {
        need(
          position < e.pages.length &&
            request.cursor === (position === 0 ? null : String(position)),
          "page_order",
        );
        const pageIndex = position++, expected = e.pages[pageIndex];
        const data = bytesSnapshot(await readPage(pageIndex), expected.bytes);
        need(
          data.byteLength === expected.bytes && await sha(data) === expected.sha256,
          "page_digest_mismatch",
        );
        const page = object(parsed(data), [
          "format",
          "source_sha256",
          "source_head_sha256",
          "index",
          "rows",
        ]);
        need(
          page.format === "jungsi.r27-source-page/v1" && page.source_sha256 === e.source_sha256 &&
            page.source_head_sha256 === e.source_head_sha256 && page.index === pageIndex &&
            Array.isArray(page.rows) && page.rows.length === expected.rows,
          "page_content_mismatch",
        );
        return {
          source_sha256: e.source_sha256,
          rows: page.rows,
          next_cursor: position < e.pages.length ? String(position) : null,
        };
      },
    },
    {
      source_sha256: e.source_sha256,
      expected_rows: e.expectedRows,
      page_size: 128,
      max_pages: e.pages.length,
      max_rows: e.expectedRows,
    },
    links,
    scope,
  );
  need(position === e.pages.length, "source_page_incomplete");
  need(
    !stage.held.some((row) => row.scope_review === "duplicate_identity_pending"),
    "coverage_source_scope_conflict",
  );
  const schoolsByPk = new Map<string, Set<string>>();
  for (const row of [...stage.rows, ...stage.held]) {
    const pk = String(row.original_pk), schools = schoolsByPk.get(pk) ?? new Set<string>();
    schools.add(String(row.school_id));
    schoolsByPk.set(pk, schools);
  }
  const ambiguousPks = new Set(
    [...schoolsByPk].filter(([, schools]) => schools.size > 1).map(([pk]) => pk),
  );
  const heldRows: NativeObject[] = [...stage.held];
  const eligible = new Map<string, NativeObject>();
  for (const row of stage.rows) {
    if (ambiguousPks.has(String(row.original_pk))) {
      heldRows.push({ ...row, scope_review: "cross_school_pk_pending" });
      continue;
    }
    const k = key(row);
    need(!eligible.has(k), "source_scope_duplicate");
    eligible.set(k, row);
  }
  const heldKeys = new Set(heldRows.map(key));
  const excludedKeys = new Set(stage.excluded.map(key));
  const historicalKeys = new Set(
    oldRows.filter((row) =>
      row.academic_year !== 2027 &&
      row.mapping_status === "mapped"
    ).map(key),
  );
  const used = new Set<string>(), baselineKeys = new Set<string>();
  const assembled: NativeObject[] = [], heldPrevious: NativeObject[] = [];
  for (const old of oldRows) {
    if (old.academic_year !== 2027) {
      assembled.push(old);
      continue;
    }
    if (old.mapping_status !== "mapped") {
      heldPrevious.push(old);
      continue;
    }
    const k = key(old);
    need(!baselineKeys.has(k), "baseline_scope_duplicate");
    baselineKeys.add(k);
    if (excludedKeys.has(k)) continue;
    const sourceRow = eligible.get(k);
    const oldReview = old.identity_review as NativeObject;
    const metadataConflict = sourceRow &&
      ["university_name", "region", "department"].some((field) =>
        old[field] !== null && old[field] !== undefined && sourceRow[field] !== null &&
        sourceRow[field] !== undefined && old[field] !== sourceRow[field]
      );
    const quotaConflict = sourceRow && priorRecruitmentConflicts(old, sourceRow);
    if (
      heldKeys.has(k) || !sourceRow || metadataConflict || quotaConflict ||
      oldReview.status === "review_pending" || oldReview.status === "mapping_pending"
    ) {
      if (sourceRow) {
        used.add(k);
        heldRows.push(sourceRow);
      }
      heldPrevious.push(old);
      continue;
    }
    need(!used.has(k), "baseline_scope_duplicate");
    used.add(k);
    assembled.push(r27Row(sourceRow, old, historicalKeys));
  }
  for (const [k, sourceRow] of eligible) {
    if (!used.has(k)) assembled.push(r27Row(sourceRow, undefined, historicalKeys));
  }
  need(assembled.length <= maxRows, "combined_row_limit");
  const mapped = assembled.filter((row) => row.mapping_status === "mapped").length;
  const counts: SnapshotPayloadCounts = {
    payloadId,
    partId: null,
    rows: assembled.length,
    mappedRows: mapped,
    mappingPendingRows: assembled.length - mapped,
  };
  const candidate: NativeObject = {
    format: "jungsi.history-snapshot/v2",
    payload_id: payloadId,
    part_id: null,
    rows: assembled,
  };
  need(
    new TextEncoder().encode(nativeJsonText(candidate)).length <= maxBodyBytes,
    "body_byte_limit",
  );
  const body = validateHistorySnapshotPayload(candidate, counts);
  await assertSource(e.source_head_sha256);
  await assertPrevious(expectedHead);
  const sealedCandidate: P1R27Candidate = {
    status: "HOLD_UNPUBLISHED",
    body,
    counts,
    held_rows: heldRows,
    held_previous_rows: heldPrevious,
    rebind_required: rebindRequired,
    excluded_count: stage.excluded_count,
    source_head_sha256: e.source_head_sha256,
    coverage_sha256: e.coverage_sha256,
    previous_publication_sha256: e.previous_publication_sha256,
  };
  freezeTree(sealedCandidate);
  candidateSeals.set(sealedCandidate, evidence);
  return sealedCandidate;
}

/**
 * Candidate-only partial index. The independently evidenced source remains complete, while
 * scope-unknown records are withheld and counted. This is not approval or publication.
 * Previous publication rows and qualification rebinding must still be resolved.
 */
export async function buildCandidateR27PartialScopeIndex(
  candidate: P1R27Candidate,
  evidence: BoundP1R27Evidence,
): Promise<NativeObject> {
  const e = bindings.get(evidence);
  need(
    e && candidateSeals.get(candidate) === evidence && candidate.status === "HOLD_UNPUBLISHED" &&
      candidate.source_head_sha256 === e.source_head_sha256 &&
      candidate.coverage_sha256 === e.coverage_sha256 &&
      candidate.previous_publication_sha256 === e.previous_publication_sha256 &&
      candidate.held_rows.length > 0 && candidate.held_previous_rows.length === 0 &&
      candidate.rebind_required.length === 0,
    "candidate_partial_scope_unresolved",
  );
  const body = validateHistorySnapshotPayload(candidate.body, candidate.counts);
  const rows = (body.rows as NativeObject[]).filter((row) =>
    row.academic_year === 2027 && row.mapping_status === "mapped"
  );
  need(
    rows.length > 0 &&
      rows.length + candidate.excluded_count + candidate.held_rows.length === e.expectedRows,
    "candidate_partial_scope_incomplete",
  );
  const entries: NativeObject[] = [];
  for (const row of rows) {
    entries.push({
      academic_year: row.academic_year,
      university_id: row.university_id,
      original_pk: row.original_pk,
      campus: row.campus,
      admission_track: row.admission_track,
      group: row.group,
      row_sha256: await nativeJsonSha256(row),
    });
  }
  const index: NativeObject = {
    format: "jungsi.r27-global-scope-index/v2",
    source_head_sha256: e.source_head_sha256,
    scope_sha256: e.scope_sha256,
    coverage_sha256: e.coverage_sha256,
    coverage_status: "partial",
    source_rows: e.expectedRows,
    included_rows: rows.length,
    excluded_rows: candidate.excluded_count,
    review_pending_rows: candidate.held_rows.length,
    entries,
  };
  freezeTree(index);
  candidateIndexSeals.set(index, { candidate, evidence, partial: true });
  return index;
}
function partialCoverageFromIndex(index: NativeObject): NativeObject {
  return {
    status: "partial",
    source_rows: index.source_rows,
    included_rows: index.included_rows,
    excluded_rows: index.excluded_rows,
    review_pending_rows: index.review_pending_rows,
  };
}
/** Supply this notice in each compressed part as well as in the pinned head. */
export function buildCandidateR27PartialBody(
  candidate: P1R27Candidate,
  evidence: BoundP1R27Evidence,
  index: NativeObject,
): NativeObject {
  const seal = candidateIndexSeals.get(index);
  need(
    seal && seal.partial && seal.candidate === candidate && seal.evidence === evidence &&
      candidateSeals.get(candidate) === evidence,
    "candidate_partial_index_unsealed",
  );
  const body: NativeObject = {
    ...candidate.body,
    r27_scope_coverage: partialCoverageFromIndex(index),
  };
  const validated = validateHistorySnapshotPayload(body, candidate.counts);
  freezeTree(validated);
  return validated;
}
/**
 * Publisher-side conservation proof. The index must be the in-process object
 * sealed from this candidate, and every row of the to-be-published parts must
 * be byte-semantically identical to its frozen, source-bound candidate.
 * This is not independent source approval.
 */
export function assertSealedR27Publication(
  index: NativeObject | undefined,
  indexBytes: Uint8Array<ArrayBuffer>,
  decodedParts: readonly Uint8Array<ArrayBuffer>[],
): void {
  const seal = index && candidateIndexSeals.get(index);
  need(seal && candidateSeals.get(seal.candidate) === seal.evidence, "candidate_index_unsealed");
  need(
    nativeJsonText(parsed(indexBytes), true) === nativeJsonText(index, true) &&
      seal.partial === (index!.format === "jungsi.r27-global-scope-index/v2"),
    "candidate_index_changed",
  );
  const expectedRows = seal.candidate.body.rows as NativeObject[];
  const coverage = seal.partial ? partialCoverageFromIndex(index!) : null;
  let position = 0;
  for (const bytes of decodedParts) {
    const part = object(parsed(bytes), [
      "format",
      "payload_id",
      "part_id",
      "rows",
      ...(seal.partial ? ["r27_scope_coverage"] : []),
    ]);
    need(
      part.format === "jungsi.history-snapshot/v2" && Array.isArray(part.rows) &&
        (!seal.partial ||
          nativeJsonText(part.r27_scope_coverage, true) === nativeJsonText(coverage, true)),
      "candidate_body_coverage",
    );
    for (const row of part.rows) {
      need(
        position < expectedRows.length &&
          nativeJsonText(row, true) === nativeJsonText(expectedRows[position], true),
        "candidate_rows_changed",
      );
      position++;
    }
  }
  need(position === expectedRows.length, "candidate_rows_incomplete");
}

/** Candidate-only whole-publication index for subsequent independent review and pinning. */
export async function buildCandidateR27ScopeIndex(
  candidate: P1R27Candidate,
  evidence: BoundP1R27Evidence,
): Promise<NativeObject> {
  const e = bindings.get(evidence);
  need(
    e && candidateSeals.get(candidate) === evidence && candidate.status === "HOLD_UNPUBLISHED" &&
      candidate.source_head_sha256 === e.source_head_sha256 &&
      candidate.coverage_sha256 === e.coverage_sha256 &&
      candidate.previous_publication_sha256 === e.previous_publication_sha256 &&
      candidate.held_rows.length === 0 && candidate.held_previous_rows.length === 0 &&
      candidate.rebind_required.length === 0,
    "candidate_scope_unresolved",
  );
  const body = validateHistorySnapshotPayload(candidate.body, candidate.counts);
  const rows = (body.rows as NativeObject[]).filter((row) =>
    row.academic_year === 2027 && row.mapping_status === "mapped"
  );
  need(rows.length + candidate.excluded_count === e.expectedRows, "candidate_scope_incomplete");
  const entries: NativeObject[] = [];
  for (const row of rows) {
    entries.push({
      academic_year: row.academic_year,
      university_id: row.university_id,
      original_pk: row.original_pk,
      campus: row.campus,
      admission_track: row.admission_track,
      group: row.group,
      row_sha256: await nativeJsonSha256(row),
    });
  }
  const index: NativeObject = {
    format: "jungsi.r27-global-scope-index/v1",
    source_head_sha256: e.source_head_sha256,
    scope_sha256: e.scope_sha256,
    coverage_sha256: e.coverage_sha256,
    entries,
  };
  freezeTree(index);
  candidateIndexSeals.set(index, { candidate, evidence, partial: false });
  return index;
}
