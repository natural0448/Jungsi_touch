/** Existing app-role head SELECT plus bounded private immutable object reads. No publisher writes. */
import { AccessError } from "../application/access.ts";
import {
  type HistorySnapshotPort,
  type SnapshotPart,
  type SnapshotPublication,
  validateHistorySnapshotPayload,
} from "../application/history_snapshot.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { calendarDate, utcInstant } from "../domain/time.ts";
import { hasAsciiControl } from "../domain/text.ts";
import { SupabaseSqlTransport } from "./transaction_sql.ts";
import type { StorageArtifactSettings } from "./supabase_artifacts.ts";
import { SupabaseArtifactClient } from "./supabase_artifacts.ts";
export interface SnapshotTrustBinding {
  readonly artifactKind: string;
  readonly lineage: string;
  readonly minimumSequence: bigint;
  readonly scopeSha256: string;
  readonly normalizationRulesVersion: string;
  readonly normalizationRulesSha256: string;
  readonly selectionRulesVersion: string;
  readonly selectionRulesSha256: string;
  readonly publisherReferences: readonly string[];
  readonly reviewerReferences: readonly string[];
  readonly objectPrefix: string;
  readonly maxMetadataBytes: number;
  readonly maxGzipBytes: number;
  readonly maxDecodedBytes: number;
  readonly maxRows: number;
  readonly maxParts: number;
  readonly maxDepth: number;
  readonly maxInMemoryBytes: number;
  readonly expiresAtUtc: bigint;
}
export interface SnapshotHeadRow {
  readonly releaseVersion: string;
  readonly contentSha256: string;
  readonly reviewStatus: string;
  readonly metadataText: string;
}
export interface SnapshotResourceEnvelope {
  readonly maxReadBytes: number;
  readonly maxResultBytes: bigint;
  readonly runtimeMilliseconds: number;
}
export interface SnapshotHeadPort {
  latest(artifactKind: string, lineage: string): Promise<SnapshotHeadRow | null>;
}
export const SNAPSHOT_HEAD_SQL =
  `SELECT release_version,content_sha256,review_status,metadata::text FROM jungsi_backend.artifact_releases WHERE artifact_kind=$1 AND release_version COLLATE "C">=$2 COLLATE "C" AND release_version COLLATE "C"<$3 COLLATE "C" ORDER BY release_version COLLATE "C" DESC LIMIT 1`;
export class SupabaseSnapshotHead implements SnapshotHeadPort {
  constructor(private readonly sql: SupabaseSqlTransport, private readonly owner: string) {}
  async latest(kind: string, lineage: string): Promise<SnapshotHeadRow | null> {
    if (!ID.test(kind) || !ID.test(lineage)) fail();
    return await this.sql.read(this.owner, async (tx) => {
      const rows = await tx.query(SNAPSHOT_HEAD_SQL, [kind, lineage + ":", lineage + ";"]);
      if (rows.length === 0) return null;
      if (rows.length !== 1 || rows[0].length !== 4 || rows[0].some((v) => typeof v !== "string")) {
        fail();
      }
      return {
        releaseVersion: rows[0][0] as string,
        contentSha256: rows[0][1] as string,
        reviewStatus: rows[0][2] as string,
        metadataText: rows[0][3] as string,
      };
    });
  }
}
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(): never {
  throw new AccessError("snapshot_unavailable", 503);
}
function object(raw: unknown, fields: readonly string[]): NativeObject {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat) fail();
  const r = raw as NativeObject;
  if (Object.keys(r).length !== fields.length || fields.some((k) => !Object.hasOwn(r, k))) fail();
  return r;
}
function id(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) fail();
  return raw;
}
function hash(raw: unknown): string {
  if (typeof raw !== "string" || !HASH.test(raw)) fail();
  return raw;
}
function natural(raw: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > max) fail();
  return raw;
}
function positive(raw: unknown, max = Number.MAX_SAFE_INTEGER): number {
  const n = natural(raw, max);
  if (n === 0) fail();
  return n;
}
function time(raw: unknown): bigint {
  if (typeof raw !== "string") fail();
  try {
    return utcInstant(raw);
  } catch {
    fail();
  }
}
function key(raw: unknown, prefix: string): string {
  if (
    typeof raw !== "string" || raw.length > 1024 || !raw.startsWith(prefix) ||
    /[\\%]/.test(raw) || hasAsciiControl(raw) ||
    raw.split("/").some((p) => !p || p === "." || p === "..")
  ) fail();
  try {
    encodeURIComponent(raw);
  } catch {
    fail();
  }
  return raw;
}
export async function snapshotBytesSha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map(
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
/** Scan nesting before invoking the native recursive parser; strings/escapes do not count. */
export function parseBoundedSnapshotJson(
  bytes: Uint8Array,
  maxBytes: number,
  maxDepth: number,
): NativeObject {
  if (bytes.length > maxBytes) fail();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail();
  }
  let depth = 0, string = false, escaped = false;
  for (const c of text) {
    if (string) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') string = false;
    } else if (c === '"') string = true;
    else if (c === "{" || c === "[") { if (++depth > maxDepth) fail(); }
    else if (c === "}" || c === "]") { if (--depth < 0) fail(); }
  }
  if (depth !== 0 || string) fail();
  try {
    const value = parseNativeJson(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonFloat) {
      fail();
    }
    return value;
  } catch {
    fail();
  }
}
export async function readBoundedSnapshotStream(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => rejectAbort = reject);
  const abort = () => {
    rejectAbort?.(new AccessError("snapshot_unavailable", 503));
    void reader.cancel().catch(() => {});
  };
  if (signal?.aborted) {
    await reader.cancel();
    reader.releaseLock();
    fail();
  }
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const chunk = await (signal ? Promise.race([reader.read(), aborted]) : reader.read());
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array) || chunk.value.length > limit - total) {
        await reader.cancel();
        fail();
      }
      total += chunk.value.length;
      chunks.push(chunk.value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
interface Pin {
  objectKey: string;
  bytes: number;
  sha256: string;
}
function pin(raw: unknown, b: SnapshotTrustBinding): Pin {
  const r = object(raw, ["object_key", "bytes", "sha256"]);
  return {
    objectKey: key(r.object_key, b.objectPrefix),
    bytes: positive(r.bytes, b.maxMetadataBytes),
    sha256: hash(r.sha256),
  };
}
export class HistorySnapshotSource implements HistorySnapshotPort {
  private selected?: {
    publication: SnapshotPublication;
    headSha256: string;
    releaseVersion: string;
    body?: NativeObject;
    bodySemanticSha256?: string;
    gzip?: Uint8Array<ArrayBuffer>;
    part?: SnapshotPart;
  };
  private readonly binding: SnapshotTrustBinding;
  private readonly storage: StorageArtifactSettings;
  private readonly started = performance.now();
  private readonly timeoutMs: number;
  constructor(
    private readonly heads: SnapshotHeadPort,
    binding: SnapshotTrustBinding,
    storage: StorageArtifactSettings,
    private readonly clock: RequestClockPort,
    envelope: SnapshotResourceEnvelope,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    new SupabaseArtifactClient(storage, fetcher);
    if (
      !ID.test(binding.artifactKind) || !ID.test(binding.lineage) ||
      typeof binding.minimumSequence !== "bigint" || binding.minimumSequence < 1n ||
      !HASH.test(binding.scopeSha256) || !ID.test(binding.normalizationRulesVersion) ||
      !ID.test(binding.selectionRulesVersion) || !HASH.test(binding.normalizationRulesSha256) ||
      !HASH.test(binding.selectionRulesSha256) ||
      !binding.objectPrefix.startsWith(storage.objectPrefix) ||
      !binding.objectPrefix.endsWith("/") || !binding.publisherReferences.length ||
      !binding.reviewerReferences.length ||
      [...binding.publisherReferences, ...binding.reviewerReferences].some((x) => !ID.test(x)) ||
      [
        binding.maxMetadataBytes,
        binding.maxGzipBytes,
        binding.maxDecodedBytes,
        binding.maxRows,
        binding.maxParts,
        binding.maxDepth,
        binding.maxInMemoryBytes,
      ].some((x) => !Number.isSafeInteger(x) || x < 1) || binding.maxDepth > 128 ||
      binding.maxGzipBytes > storage.limits.maxArtifactBytes ||
      binding.maxMetadataBytes > storage.limits.maxMetadataBytes ||
      !Number.isSafeInteger(envelope.maxReadBytes) || envelope.maxReadBytes < 1 ||
      typeof envelope.maxResultBytes !== "bigint" || envelope.maxResultBytes < 1n ||
      !Number.isSafeInteger(envelope.runtimeMilliseconds) || envelope.runtimeMilliseconds < 1 ||
      binding.maxGzipBytes > envelope.maxReadBytes ||
      BigInt(binding.maxGzipBytes) > envelope.maxResultBytes ||
      binding.maxInMemoryBytes > envelope.maxReadBytes ||
      // Conservative accounting for compressed copies, decoded text/parser/projected copies,
      // per-row objects and descriptors. This is an admission bound, not a measured heap proof.
      4n * BigInt(binding.maxGzipBytes) + 12n * BigInt(binding.maxDecodedBytes) +
            2048n * BigInt(binding.maxRows) + 1024n * BigInt(binding.maxParts) +
            8n * BigInt(binding.maxMetadataBytes) > BigInt(binding.maxInMemoryBytes) ||
      typeof binding.expiresAtUtc !== "bigint"
    ) fail();
    key(binding.objectPrefix + "anchor", storage.objectPrefix);
    this.binding = Object.freeze({
      ...binding,
      publisherReferences: Object.freeze([...binding.publisherReferences]),
      reviewerReferences: Object.freeze([...binding.reviewerReferences]),
    });
    this.storage = Object.freeze({ ...storage, limits: Object.freeze({ ...storage.limits }) });
    this.timeoutMs = Math.min(storage.limits.requestTimeoutMs, envelope.runtimeMilliseconds);
  }
  private live(): void {
    if (
      this.clock.nowUtc() >= this.binding.expiresAtUtc ||
      performance.now() - this.started >= this.timeoutMs
    ) fail();
  }
  private async get(
    path: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.live();
    const url = this.storage.projectUrl + "/storage/v1/" + path,
      controller = new AbortController(),
      timer = setTimeout(
        () => controller.abort(),
        Math.max(1, this.timeoutMs - (performance.now() - this.started)),
      );
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const r = await this.fetcher(url, {
        method: "GET",
        headers: { apikey: this.storage.secretKey, Accept: "application/octet-stream" },
        cache: "no-store",
        redirect: "error",
        signal: combined,
      });
      if (
        r.status !== 200 || r.redirected || r.url !== url || !r.body ||
        r.headers.has("Content-Encoding") && r.headers.get("Content-Encoding") !== "identity"
      ) {
        await r.body?.cancel();
        fail();
      }
      const length = r.headers.get("Content-Length");
      if (
        length !== null &&
        (!/^(0|[1-9][0-9]{0,15})$/.test(length) || BigInt(length) > BigInt(limit))
      ) {
        await r.body.cancel();
        fail();
      }
      const bytes = await readBoundedSnapshotStream(r.body, limit, combined);
      this.live();
      return bytes;
    } catch {
      fail();
    } finally {
      clearTimeout(timer);
    }
  }
  private async bytes(p: Pin, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = await this.get(
      "object/authenticated/" + encodeURIComponent(this.storage.bucket) + "/" +
        p.objectKey.split("/").map(encodeURIComponent).join("/"),
      p.bytes,
      signal,
    );
    if (bytes.length !== p.bytes || await snapshotBytesSha256(bytes) !== p.sha256) fail();
    return bytes;
  }
  private part(raw: unknown, full: boolean): SnapshotPart {
    const r = object(raw, [
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
      ]),
      b = this.binding;
    const partId = r.part_id === null ? null : id(r.part_id);
    if (full !== (partId === null)) fail();
    const rows = natural(r.rows, b.maxRows),
      mappedRows = natural(r.mapped_rows, b.maxRows),
      mappingPendingRows = natural(r.mapping_pending_rows, b.maxRows);
    if (mappedRows + mappingPendingRows !== rows) fail();
    return Object.freeze({
      partId,
      payloadId: id(r.payload_id),
      objectKey: key(r.object_key, b.objectPrefix),
      gzipBytes: positive(r.gzip_bytes, b.maxGzipBytes),
      gzipSha256: hash(r.gzip_sha256),
      decodedBytes: positive(r.decoded_bytes, b.maxDecodedBytes),
      decodedSha256: hash(r.decoded_sha256),
      rows,
      mappedRows,
      mappingPendingRows,
    });
  }
  private async load(): Promise<
    { publication: SnapshotPublication; headSha256: string; releaseVersion: string }
  > {
    this.live();
    const b = this.binding, row = await this.heads.latest(b.artifactKind, b.lineage);
    if (
      !row || row.reviewStatus !== "approved" || !HASH.test(row.contentSha256) ||
      new TextEncoder().encode(row.metadataText).length > b.maxMetadataBytes
    ) fail();
    const h = object(
      parseBoundedSnapshotJson(
        new TextEncoder().encode(row.metadataText),
        b.maxMetadataBytes,
        b.maxDepth,
      ),
      [
        "format",
        "status",
        "purpose",
        "lineage",
        "sequence",
        "previous_head_sha256",
        "source_head_sha256",
        "scope_sha256",
        "normalization_rules_version",
        "normalization_rules_sha256",
        "selection_rules_version",
        "selection_rules_sha256",
        "publisher_ref",
        "reviewer_ref",
        "manifest",
        "review_receipt",
        "expires_at",
      ],
    );
    const sequence = typeof h.sequence === "bigint" ? h.sequence : BigInt(natural(h.sequence));
    if (
      sequence < b.minimumSequence || sequence > 99999999999999999999n ||
      row.releaseVersion !== b.lineage + ":" + String(sequence).padStart(20, "0") ||
      h.format !== "jungsi.history-snapshot-publication-head/v1" || h.status !== "approved" ||
      h.purpose !== "p1-public-history" || h.lineage !== b.lineage ||
      h.scope_sha256 !== b.scopeSha256 ||
      h.normalization_rules_version !== b.normalizationRulesVersion ||
      h.normalization_rules_sha256 !== b.normalizationRulesSha256 ||
      h.selection_rules_version !== b.selectionRulesVersion ||
      h.selection_rules_sha256 !== b.selectionRulesSha256 ||
      !b.publisherReferences.includes(String(h.publisher_ref)) ||
      !b.reviewerReferences.includes(String(h.reviewer_ref)) ||
      h.publisher_ref === h.reviewer_ref || await nativeJsonSha256(h) !== row.contentSha256
    ) fail();
    hash(h.previous_head_sha256);
    hash(h.source_head_sha256);
    const expires = time(h.expires_at);
    if (expires > b.expiresAtUtc || expires <= this.clock.nowUtc()) fail();
    // Existing Owner is the publisher authority. An independently reviewed receipt is hash-bound;
    // no new signing identities, Edge Secrets or database writer are introduced by this reader.
    const manifestPin = pin(h.manifest, b), reviewPin = pin(h.review_receipt, b);
    const bucket = parseBoundedSnapshotJson(
      await this.get("bucket/" + encodeURIComponent(this.storage.bucket), b.maxMetadataBytes),
      b.maxMetadataBytes,
      b.maxDepth,
    );
    if (bucket.id !== this.storage.bucket || bucket.public !== false) fail();
    const cap = positive(bucket.file_size_limit, this.storage.limits.maxBucketBytes);
    if (cap < b.maxGzipBytes) fail();
    const m = object(
      parseBoundedSnapshotJson(await this.bytes(manifestPin), b.maxMetadataBytes, b.maxDepth),
      [
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
      ],
    );
    if (
      m.format !== "jungsi.history-snapshot-manifest/v1" || m.status !== "approved" ||
      m.source_head_sha256 !== h.source_head_sha256 || m.scope_sha256 !== b.scopeSha256 ||
      m.schema_version !== "jungsi.history-snapshot/v1" ||
      m.normalization_rules_version !== b.normalizationRulesVersion ||
      m.normalization_rules_sha256 !== b.normalizationRulesSha256 ||
      m.selection_rules_version !== b.selectionRulesVersion ||
      m.selection_rules_sha256 !== b.selectionRulesSha256 || !Array.isArray(m.parts) ||
      m.parts.length > b.maxParts
    ) fail();
    const review = object(
      parseBoundedSnapshotJson(await this.bytes(reviewPin), b.maxMetadataBytes, b.maxDepth),
      [
        "format",
        "status",
        "lineage",
        "manifest_sha256",
        "source_head_sha256",
        "scope_sha256",
        "normalization_rules_sha256",
        "selection_rules_sha256",
        "publisher_ref",
        "reviewer_ref",
      ],
    );
    if (
      review.format !== "jungsi.history-snapshot-independent-review/v1" ||
      review.status !== "approved" || review.lineage !== b.lineage ||
      review.manifest_sha256 !== manifestPin.sha256 ||
      review.source_head_sha256 !== h.source_head_sha256 || review.scope_sha256 !== b.scopeSha256 ||
      review.normalization_rules_sha256 !== b.normalizationRulesSha256 ||
      review.selection_rules_sha256 !== b.selectionRulesSha256 ||
      review.publisher_ref !== h.publisher_ref || review.reviewer_ref !== h.reviewer_ref
    ) fail();
    const counts = object(m.counts, [
      "rows",
      "mapped_rows",
      "mapping_pending_rows",
      "observations",
      "schools",
    ]);
    const c = {
      rows: natural(counts.rows),
      mapped_rows: natural(counts.mapped_rows),
      mapping_pending_rows: natural(counts.mapping_pending_rows),
      observations: natural(counts.observations),
      schools: natural(counts.schools),
    };
    if (c.mapped_rows + c.mapping_pending_rows !== c.rows) fail();
    const full = m.full === null ? null : this.part(m.full, true),
      parts = m.parts.map((p) => this.part(p, false));
    if (
      !full && !parts.length || new Set(parts.map((p) => p.partId)).size !== parts.length ||
      new Set(parts.map((p) => p.objectKey)).size !== parts.length
    ) fail();
    if (
      full &&
      (full.rows !== c.rows || full.mappedRows !== c.mapped_rows ||
        full.mappingPendingRows !== c.mapping_pending_rows)
    ) fail();
    if (
      parts.length &&
      (parts.reduce((s, p) => s + p.rows, 0) !== c.rows ||
        parts.reduce((s, p) => s + p.mappedRows, 0) !== c.mapped_rows ||
        parts.reduce((s, p) => s + p.mappingPendingRows, 0) !== c.mapping_pending_rows)
    ) fail();
    const generated = time(m.generated_at);
    if (generated > this.clock.nowUtc()) fail();
    if (m.source_as_of !== null) {
      if (typeof m.source_as_of === "string" && m.source_as_of.length === 10) {
        try {
          calendarDate(m.source_as_of);
        } catch {
          fail();
        }
        if (m.source_as_of > String(m.generated_at).slice(0, 10)) fail();
      } else if (time(m.source_as_of) > generated) fail();
    }
    return {
      publication: Object.freeze({
        snapshotId: id(m.snapshot_id),
        publicationSha256: manifestPin.sha256,
        sourceHeadSha256: String(h.source_head_sha256),
        scopeSha256: b.scopeSha256,
        generatedAt: m.generated_at as string,
        sourceAsOf: m.source_as_of as string | null,
        schemaVersion: "jungsi.history-snapshot/v1",
        normalizationRulesVersion: b.normalizationRulesVersion,
        selectionRulesVersion: b.selectionRulesVersion,
        expiresAtUtc: expires,
        counts: Object.freeze(c),
        full,
        parts: Object.freeze(parts),
      }),
      headSha256: row.contentSha256,
      releaseVersion: row.releaseVersion,
    };
  }
  async current(): Promise<SnapshotPublication> {
    if (!this.selected) this.selected = await this.load();
    this.live();
    return this.selected.publication;
  }
  async assertCurrent(p: SnapshotPublication): Promise<void> {
    this.live();
    if (!this.selected || this.selected.publication !== p) fail();
    const row = await this.heads.latest(this.binding.artifactKind, this.binding.lineage);
    if (
      !row || row.reviewStatus !== "approved" || row.contentSha256 !== this.selected.headSha256 ||
      row.releaseVersion !== this.selected.releaseVersion ||
      await nativeJsonSha256(
          parseBoundedSnapshotJson(
            new TextEncoder().encode(row.metadataText),
            this.binding.maxMetadataBytes,
            this.binding.maxDepth,
          ),
        ) !== row.contentSha256
    ) throw new AccessError("publication_changed", 409);
    if (p.expiresAtUtc <= this.clock.nowUtc()) fail();
  }
  async read(p: SnapshotPublication, part: SnapshotPart): Promise<NativeObject> {
    if (
      !this.selected || this.selected.publication !== p ||
      part !== p.full && !p.parts.includes(part) || this.selected.body
    ) fail();
    const controller = new AbortController(),
      timer = setTimeout(
        () => controller.abort(),
        Math.max(1, this.timeoutMs - (performance.now() - this.started)),
      );
    try {
      const gzip = await this.bytes({
        objectKey: part.objectKey,
        bytes: part.gzipBytes,
        sha256: part.gzipSha256,
      }, controller.signal);
      let decoded: Uint8Array;
      try {
        const stream = new Blob([gzip]).stream().pipeThrough(new DecompressionStream("gzip"));
        decoded = await readBoundedSnapshotStream(
          stream,
          Math.min(part.decodedBytes, this.binding.maxDecodedBytes),
          controller.signal,
        );
      } catch {
        fail();
      }
      if (
        decoded.length !== part.decodedBytes ||
        await snapshotBytesSha256(decoded) !== part.decodedSha256
      ) fail();
      const body = validateHistorySnapshotPayload(
        parseBoundedSnapshotJson(decoded, this.binding.maxDecodedBytes, this.binding.maxDepth),
        part,
      );
      this.selected.body = body;
      this.selected.bodySemanticSha256 = await nativeJsonSha256(body);
      this.selected.gzip = gzip;
      this.selected.part = part;
      await this.assertCurrent(p);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
  /** Compare final projected semantics before reusing the exact prevalidated compressed bytes. */
  async representation(
    result: unknown,
  ): Promise<
    { bytes: Uint8Array<ArrayBuffer>; etag: string; snapshotId: string; publicationSha256: string }
  > {
    const s = this.selected;
    if (!s?.body || !s.gzip || !s.part || await nativeJsonSha256(result) !== s.bodySemanticSha256) {
      fail();
    }
    await this.assertCurrent(s.publication);
    return {
      bytes: Uint8Array.from(s.gzip),
      etag: '"' + s.part.gzipSha256 + '"',
      snapshotId: s.publication.snapshotId,
      publicationSha256: s.publication.publicationSha256,
    };
  }
}
