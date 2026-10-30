/** REVIEW CANDIDATE ONLY. No publisher writes or server authorization is created here. */
import { AccessError } from "./access.ts";
import { assertP1R27DeliveryMode } from "./p1_r27_delivery_mode.ts";
import { p1R27DeliveryDigest } from "./p1_r27_delivery_digest.ts";
import { validateP1PreparedPartsGlobal } from "./p1_r27_global_parts.ts";
import { bindR27ScopeIndex, type VerifiedR27ScopeIndex } from "./history_r27_scope_index.ts";
import { assertSealedR27Publication } from "./p1_r27_composition.ts";
import { detachedQualificationSnapshot } from "./history_field_qualification.ts";
import type { SnapshotPart, SnapshotPublication } from "./history_snapshot.ts";
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";

const HASH = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function exact(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v || typeof v !== "object" || Array.isArray(v) || v instanceof JsonFloat ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  ) fail();
  const names = Reflect.ownKeys(v);
  if (
    names.length !== keys.length || names.some((k) => typeof k !== "string" || !keys.includes(k))
  ) fail();
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (!d || !d.enumerable || !("value" in d)) fail();
    out[key] = d.value;
  }
  return out;
}
function digest(v: unknown): string {
  if (typeof v !== "string" || !HASH.test(v)) fail();
  return v;
}
function positive(v: unknown, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > max) fail();
  return v;
}
function copy(raw: Uint8Array, max: number): Uint8Array<ArrayBuffer> {
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  if (!(raw instanceof Uint8Array) || !getter) fail();
  const size = Reflect.apply(getter, raw, []) as number;
  if (size < 1 || size > max) fail();
  const out = new Uint8Array(new ArrayBuffer(size));
  Uint8Array.prototype.set.call(out, raw);
  return out;
}
async function sha(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw.buffer))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
function parsed(raw: Uint8Array<ArrayBuffer>, maxDepth: number): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let depth = 0, quoted = false, escape = false;
  for (const c of text) {
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") { if (++depth > maxDepth) fail(); }
    else if (c === "}" || c === "]") { if (--depth < 0) fail(); }
  }
  if (quoted || depth !== 0) fail();
  try {
    return parseNativeJson(text);
  } catch {
    return fail();
  }
}
const partWire = (p: SnapshotPart) => ({
  part_id: p.partId,
  payload_id: p.payloadId,
  object_key: p.objectKey,
  gzip_bytes: p.gzipBytes,
  gzip_sha256: p.gzipSha256,
  decoded_bytes: p.decodedBytes,
  decoded_sha256: p.decodedSha256,
  rows: p.rows,
  mapped_rows: p.mappedRows,
  mapping_pending_rows: p.mappingPendingRows,
});
function publicationSnapshot(
  p: SnapshotPublication,
  index: VerifiedR27ScopeIndex,
): SnapshotPublication {
  const names = [
    "snapshotId",
    "publicationSha256",
    "sourceHeadSha256",
    "scopeSha256",
    "generatedAt",
    "sourceAsOf",
    "schemaVersion",
    "normalizationRulesVersion",
    "selectionRulesVersion",
    "expiresAtUtc",
    "counts",
    "full",
    "parts",
  ] as const;
  const raw: Record<string, unknown> = {};
  for (const key of names) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (!d || !("value" in d)) fail();
    raw[key] = d.value;
  }
  const frozen = detachedQualificationSnapshot(raw) as unknown as SnapshotPublication;
  const q = Object.getOwnPropertyDescriptor(p, "fieldQualification"),
    h = Object.getOwnPropertyDescriptor(p, "historicalReferences");
  if (q && !("value" in q) || h && !("value" in h)) fail();
  return Object.freeze({
    ...frozen,
    r27ScopeIndex: index,
    ...(q?.value ? { fieldQualification: q.value } : {}),
    ...(h?.value ? { historicalReferences: h.value } : {}),
  });
}
export interface P1R27GateLimits {
  readonly maxParts: number;
  readonly maxRows: number;
  readonly maxDecodedBytes: number;
  readonly maxPartBytes: number;
  readonly maxDepth: number;
  readonly maxTotalGzipBytes: number;
  readonly maxPartGzipBytes: number;
  readonly maxManifestBytes: number;
  readonly maxIndexBytes: number;
  readonly timeoutMs: number;
}
function checkedLimits(value: P1R27GateLimits): P1R27GateLimits {
  const names = [
    "maxParts",
    "maxRows",
    "maxDecodedBytes",
    "maxPartBytes",
    "maxDepth",
    "maxTotalGzipBytes",
    "maxPartGzipBytes",
    "maxManifestBytes",
    "maxIndexBytes",
    "timeoutMs",
  ];
  const raw = exact(value, names),
    max = [512, 40000, 268435456, 67108864, 128, 268435456, 67108864, 1048576, 8388608, 30000];
  const out: Record<string, number> = {};
  names.forEach((key, i) => out[key] = positive(raw[key], max[i]));
  return Object.freeze(out) as unknown as P1R27GateLimits;
}
function verifyManifestBody(manifest: unknown, p: SnapshotPublication): void {
  const m = exact(manifest, [
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
  if (
    m.format !== "jungsi.history-snapshot-manifest/v1" || m.status !== "approved" ||
    m.schema_version !== "jungsi.history-snapshot/v2"
  ) fail();
  const expected = {
    snapshot_id: p.snapshotId,
    source_head_sha256: p.sourceHeadSha256,
    scope_sha256: p.scopeSha256,
    generated_at: p.generatedAt,
    source_as_of: p.sourceAsOf,
    schema_version: p.schemaVersion,
    normalization_rules_version: p.normalizationRulesVersion,
    selection_rules_version: p.selectionRulesVersion,
    counts: p.counts,
    full: p.full ? partWire(p.full) : null,
    parts: p.parts.map(partWire),
  };
  const actual = Object.fromEntries(Object.keys(expected).map((k) => [k, m[k]]));
  if (
    nativeJsonText(actual, true) !== nativeJsonText(expected, true) ||
    !HASH.test(String(m.normalization_rules_sha256)) || !HASH.test(String(m.selection_rules_sha256))
  ) fail();
}
async function decodeGzip(
  raw: Uint8Array<ArrayBuffer>,
  max: number,
  deadline: Promise<null>,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(),
    chunks: Uint8Array[] = [];
  let size = 0, done = false;
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part === null) fail();
      if (part.done) {
        done = true;
        break;
      }
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > max - size) fail();
      size += part.value.byteLength;
      chunks.push(part.value);
    }
  } finally {
    if (!done) {
      try {
        void reader.cancel().catch(() => {});
      } catch { /* best effort */ }
    }
    try {
      reader.releaseLock();
    } catch { /* best effort */ }
  }
  const out = new Uint8Array(new ArrayBuffer(size));
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
/** Prepares review evidence from one bounded batch. Result is NOT approval or a publisher write. */
export async function prepareP1R27GlobalReceipt(
  publication: SnapshotPublication,
  manifestBytes: Uint8Array,
  indexBytes: Uint8Array,
  indexSha256: string,
  coverageSha256: string,
  gzipParts: readonly Uint8Array[],
  rawLimits: P1R27GateLimits,
  sealedCandidateIndex?: NativeObject,
): Promise<NativeObject> {
  const lim = checkedLimits(rawLimits),
    indexSha = digest(indexSha256),
    coverageSha = digest(coverageSha256);
  const manifest = copy(manifestBytes, lim.maxManifestBytes),
    index = copy(indexBytes, lim.maxIndexBytes);
  if (!publication || typeof publication !== "object" || !Array.isArray(gzipParts)) fail();
  // Read descriptor fields once before any await; opaque index is rebuilt from pinned bytes.
  const fake = Object.freeze({ kind: "verified_r27_scope_index" as const });
  const p = publicationSnapshot(publication, fake);
  assertP1R27DeliveryMode(p);
  if (p.schemaVersion !== "jungsi.history-snapshot/v2") fail();
  const parts = p.parts.length ? p.parts : p.full ? [p.full] : [];
  if (parts.length < 1 || parts.length > lim.maxParts || gzipParts.length !== parts.length) fail();
  let total = 0, decodedDeclared = 0, rowsDeclared = 0;
  const inputs: Uint8Array[] = [];
  const size = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  for (let i = 0; i < parts.length; i++) {
    const d = Object.getOwnPropertyDescriptor(gzipParts, String(i));
    if (!d || !("value" in d) || !(d.value instanceof Uint8Array) || !size) fail();
    const n = Reflect.apply(size, d.value, []) as number, part = parts[i];
    if (
      n !== part.gzipBytes || n < 1 || n > lim.maxPartGzipBytes ||
      !Number.isSafeInteger(part.decodedBytes) || part.decodedBytes < 1 ||
      part.decodedBytes > lim.maxPartBytes ||
      !Number.isSafeInteger(part.rows) || part.rows < 0
    ) fail();
    total += n;
    decodedDeclared += part.decodedBytes;
    rowsDeclared += part.rows;
    if (
      total > lim.maxTotalGzipBytes || decodedDeclared > lim.maxDecodedBytes ||
      rowsDeclared > lim.maxRows
    ) fail();
    inputs.push(d.value);
  }
  const gzips = inputs.map((v) => copy(v, lim.maxPartGzipBytes));
  if (await sha(manifest) !== p.publicationSha256) fail();
  verifyManifestBody(parsed(manifest, lim.maxDepth), p);
  const verified = await bindR27ScopeIndex(index, {
    indexSha256: indexSha,
    publicationSha256: p.publicationSha256,
    sourceHeadSha256: p.sourceHeadSha256,
    scopeSha256: p.scopeSha256,
    coverageSha256: coverageSha,
  });
  // Both complete and partial receipts require the source-bound in-process
  // candidate index; otherwise a partial body could masquerade as complete.
  if (sealedCandidateIndex === undefined) fail();
  const selected = Object.freeze({ ...p, r27ScopeIndex: verified });
  let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
  const deadline = new Promise<null>((resolve) =>
    timer = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, lim.timeoutMs)
  );
  try {
    const decoded: Uint8Array<ArrayBuffer>[] = [];
    let decodedTotal = 0;
    for (let i = 0; i < parts.length; i++) {
      if (await sha(gzips[i]) !== parts[i].gzipSha256) fail();
      const b = await decodeGzip(
        gzips[i],
        Math.min(lim.maxPartBytes, parts[i].decodedBytes),
        deadline,
      );
      if (b.length !== parts[i].decodedBytes || await sha(b) !== parts[i].decodedSha256) fail();
      decodedTotal += b.length;
      if (decodedTotal > lim.maxDecodedBytes) fail();
      decoded.push(b);
    }
    const result = await validateP1PreparedPartsGlobal(selected, decoded, {
      maxParts: lim.maxParts,
      maxRows: lim.maxRows,
      maxDecodedBytes: lim.maxDecodedBytes,
      maxPartBytes: lim.maxPartBytes,
      maxDepth: lim.maxDepth,
    });
    assertSealedR27Publication(sealedCandidateIndex, index, decoded);
    const delivery = await p1R27DeliveryDigest(p);
    if (timedOut) fail();
    return Object.freeze({
      format: "jungsi.p1-r27-global-validation/v1",
      status: "global_checks_passed",
      manifest_sha256: p.publicationSha256,
      source_head_sha256: p.sourceHeadSha256,
      scope_sha256: p.scopeSha256,
      coverage_sha256: coverageSha,
      index_sha256: indexSha,
      delivery_sha256: delivery,
      parts_checked: result.partsChecked,
      rows_checked: result.rowsChecked,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
/** Runtime pins MUST be independently approved server configuration; never derive them from the head or HTTP. */
