import { hasAsciiControl } from "../domain/text.ts";
/** Read-only private Storage source bytes. No upload, registry adoption or source rewriting. */
import { AccessError } from "../application/access.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson, parseNativeJson } from "../domain/native_json.ts";
export interface StorageArtifactLimits {
  readonly maxArtifactBytes: number;
  readonly maxBucketBytes: number;
  readonly maxMetadataBytes: number;
  readonly requestTimeoutMs: number;
}
export interface StorageArtifactSettings {
  readonly projectUrl: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly objectPrefix: string;
  readonly limits: StorageArtifactLimits;
}
export interface VerifiedStorageArtifact {
  readonly payload: NativeObject;
  readonly verifiedSha256: string;
  readonly verifiedBytes: number;
}
/** Binder context of a saved reference tail plus the public offerings it may serve. */
export const REFERENCE_TAIL_CONTEXT_KEYS = [
  "academic_year",
  "exam_id",
  "exam_type",
  "model_version",
  "offering_ids",
  "profile_sha256",
  "reference_curve_id",
  "resolved_model_scenario",
  "rule_version",
  "score_scale_id",
  "source_pack_version",
  "source_scenario_field_present",
  "source_scenario_value",
  "weight_encoding",
].sort().join(",");
export const REFERENCE_TAIL_EVIDENCE_KEYS = [
  "binder_sha256",
  "definition_sha256",
  "independent_sha256",
  "shared_proof_sha256",
  "source_cdf_sha256",
  "source_csv_sha256",
].sort().join(",");
export const REFERENCE_TAIL_MAX_BYTES = 8388608;
/** Selected index object whose pieces live beside it; each piece is pinned by the index hash. */
export const REFERENCE_TAIL_CHUNKED_LAYOUT = "chunked_index_v1";
function fail(code: string): never {
  throw new AccessError(code, 503);
}
function object(value: unknown): NativeObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    value instanceof JsonFloat
  ) {
    fail("storage_artifact_invalid");
  }
  return value as NativeObject;
}
function positiveInteger(value: unknown): value is number | bigint {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ||
    typeof value === "bigint" && value > 0n;
}
function objectKey(value: unknown): string {
  if (
    typeof value !== "string" || !value || new TextEncoder().encode(value).length > 1024 ||
    /[\\%]/.test(value) || hasAsciiControl(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail("storage_reference_invalid");
  }
  // URL encoding must not silently replace a source identifier's lone surrogate.
  try {
    encodeURIComponent(value);
  } catch {
    fail("storage_reference_invalid");
  }
  return value;
}
/** Max age of a reused head/bucket verification inside one request (monotonic clock). */
export const STORAGE_CHECK_REUSE_MS = 1500;
function parsed(content: Uint8Array): NativeObject {
  try {
    return object(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(content)));
  } catch {
    fail("storage_artifact_invalid");
  }
}
async function rawHash(content: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", content))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Only completed, SHA-verified immutable source payloads live here. No pending promises or users. */
export class VerifiedArtifactCache {
  private readonly entries = new Map<string, {
    value: VerifiedStorageArtifact;
    cachedAt: number;
  }>();
  private retainedBytes = 0;
  private lastTime = 0;
  constructor(
    private readonly maxEntries = 16,
    private readonly maxBytes = 4 * 1024 * 1024,
    private readonly maxAgeMs = 60_000,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 16 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 60_000 ||
      typeof now !== "function"
    ) fail("storage_configuration_invalid");
  }
  private time(): number | null {
    let time: number;
    try {
      time = this.now();
    } catch {
      time = NaN;
    }
    if (!Number.isFinite(time) || time < this.lastTime || time < 0) {
      this.entries.clear();
      this.retainedBytes = 0;
      this.lastTime = 0;
      return null;
    }
    this.lastTime = time;
    return time;
  }
  snapshot(): Readonly<{ entries: number; bytes: number }> {
    return Object.freeze({ entries: this.entries.size, bytes: this.retainedBytes });
  }
  async artifact(
    settings: Readonly<StorageArtifactSettings>,
    selected: Readonly<NativeObject>,
    load: () => Promise<Uint8Array<ArrayBuffer>>,
    onReuse: (bytes: number) => void,
  ): Promise<VerifiedStorageArtifact> {
    const entry = cloneNativeJson(object(selected));
    // Credential rotation also separates entries, without retaining a plaintext credential key.
    const key = await rawHash(new TextEncoder().encode(JSON.stringify([
      settings.projectUrl,
      settings.secretKey,
      settings.bucket,
      entry.object_key,
      entry.sha256,
      String(entry.bytes),
      entry.version,
    ])));
    const time = this.time(), cached = this.entries.get(key);
    if (cached && time !== null && time - cached.cachedAt < this.maxAgeMs) {
      onReuse(cached.value.verifiedBytes);
      this.entries.delete(key);
      this.entries.set(key, cached);
      return copyArtifact(cached.value);
    }
    if (cached) {
      this.entries.delete(key);
      this.retainedBytes -= cached.value.verifiedBytes;
    }
    // Concurrent misses load independently under their own timeout/read budget. Never share a
    // request's promise, abort signal, queue, authorization, reservation or dependency failure.
    const value = await verifyContent(await load(), entry), completed = this.time();
    if (completed === null || value.verifiedBytes > this.maxBytes) return value;
    const prior = this.entries.get(key);
    if (prior) {
      this.entries.delete(key);
      this.retainedBytes -= prior.value.verifiedBytes;
    }
    while (
      this.entries.size >= this.maxEntries ||
      this.retainedBytes + value.verifiedBytes > this.maxBytes
    ) {
      const oldest = this.entries.keys().next().value!;
      this.retainedBytes -= this.entries.get(oldest)!.value.verifiedBytes;
      this.entries.delete(oldest);
    }
    freezePayload(value.payload);
    this.entries.set(key, { value, cachedAt: completed });
    this.retainedBytes += value.verifiedBytes;
    return copyArtifact(value);
  }
}
function freezePayload(value: NativeJson): void {
  if (value === null || typeof value !== "object" || value instanceof JsonFloat) return;
  for (const child of Object.values(value)) freezePayload(child);
  Object.freeze(value);
}
function copyPayload(value: NativeJson): NativeJson {
  if (value === null || typeof value !== "object" || value instanceof JsonFloat) return value;
  if (Array.isArray(value)) return value.map(copyPayload);
  const result: NativeObject = Object.create(null);
  for (const [key, child] of Object.entries(value)) result[key] = copyPayload(child);
  return result;
}
function copyArtifact(value: VerifiedStorageArtifact): VerifiedStorageArtifact {
  return Object.freeze({ ...value, payload: copyPayload(value.payload) as NativeObject });
}
async function verifyContent(
  content: Uint8Array<ArrayBuffer>,
  entry: Readonly<NativeObject>,
): Promise<VerifiedStorageArtifact> {
  const bytes = Number(entry.bytes);
  if (content.length !== bytes) fail("storage_size_mismatch");
  if (await rawHash(content) !== entry.sha256) fail("storage_hash_mismatch");
  const payload = parsed(content);
  const version = Object.hasOwn(payload, "version") ? payload.version : payload.pack_version;
  if (version !== entry.version) fail("artifact_version_mismatch");
  return Object.freeze({ payload, verifiedSha256: entry.sha256 as string, verifiedBytes: bytes });
}
export interface StorageArtifactReuse {
  readonly cache: VerifiedArtifactCache;
  readonly onReuse: (bytes: number) => void;
}
export class SupabaseArtifactClient {
  private readonly origin: string;
  private readonly settings: Readonly<StorageArtifactSettings>;
  constructor(
    settings: StorageArtifactSettings,
    private readonly fetcher: typeof fetch = fetch,
    private readonly reuse?: StorageArtifactReuse,
  ) {
    try {
      const url = new URL(settings.projectUrl);
      if (
        url.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
        url.username || url.password || url.port || url.pathname !== "/" || url.search ||
        url.hash ||
        typeof settings.secretKey !== "string" || !settings.secretKey.startsWith("sb_secret_") ||
        settings.secretKey.length <= 10 || settings.secretKey.length > 4096 ||
        /\s/.test(settings.secretKey) || hasAsciiControl(settings.secretKey) ||
        typeof settings.bucket !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(settings.bucket) ||
        typeof settings.objectPrefix !== "string" || !settings.objectPrefix.endsWith("/") ||
        typeof fetcher !== "function" || !settings.limits ||
        Object.values(settings.limits).length !== 4 ||
        [
          settings.limits.maxArtifactBytes,
          settings.limits.maxBucketBytes,
          settings.limits.maxMetadataBytes,
          settings.limits.requestTimeoutMs,
        ].some((v) =>
          typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v >= Number.MAX_SAFE_INTEGER
        ) ||
        settings.limits.maxArtifactBytes > settings.limits.maxBucketBytes ||
        settings.limits.maxMetadataBytes > settings.limits.maxArtifactBytes
      ) {
        throw new Error();
      }
      objectKey(settings.objectPrefix.slice(0, -1));
      this.origin = url.origin;
    } catch {
      fail("storage_configuration_invalid");
    }
    this.settings = Object.freeze({ ...settings, limits: Object.freeze({ ...settings.limits }) });
  }
  validateReference(raw: Readonly<NativeObject>): string {
    const entry = object(raw), key = objectKey(entry.object_key);
    if (entry.bucket !== this.settings.bucket || !key.startsWith(this.settings.objectPrefix)) {
      fail("storage_reference_scope_mismatch");
    }
    if (
      !positiveInteger(entry.bytes) || typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) || typeof entry.version !== "string" || !entry.version
    ) {
      fail("storage_reference_invalid");
    }
    return key;
  }
  validateSelectedReference(raw: Readonly<NativeObject>): string {
    const entry = object(raw), key = this.validateReference(entry);
    if (
      entry.status !== "approved" || entry.engine_approved !== true ||
      entry.production_allowed !== true
    ) {
      fail("artifact_not_approved");
    }
    if (entry.archive_only === true) fail("storage_archive_only");
    if (entry.archive_only !== false) fail("storage_reference_invalid");
    if ((entry.bytes as number | bigint) > this.settings.limits.maxArtifactBytes) {
      fail("storage_artifact_too_large");
    }
    return key;
  }
  /** Separate reference-calculation scope; legacy production approvals are never rewritten. */
  validateReferenceCalculation(raw: Readonly<NativeObject>): string {
    const entry = object(raw), key = this.validateReference(entry);
    if (
      entry.kind !== "reference_conversion" || entry.status !== "approved_reference" ||
      entry.approval_scope !== "same_exam_mathematical_reference" ||
      entry.engine_approved !== false || entry.production_allowed !== false ||
      typeof entry.source_review_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.source_review_sha256) ||
      typeof entry.independent_review_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.independent_review_sha256)
    ) {
      fail("artifact_not_approved");
    }
    if (entry.archive_only !== false) fail("storage_archive_only");
    const context = object(entry.reference_context);
    if (
      Object.keys(context).sort().join(",") !==
        "academic_year,exam_id,exam_type,offering_ids,rule_version,score_scale_id,source_pack_version" ||
      typeof context.academic_year !== "number" || !Number.isSafeInteger(context.academic_year) ||
      context.academic_year < 2024 || context.academic_year > 2027 ||
      !["csat", "june_mock", "september_mock"].includes(String(context.exam_type)) ||
      ["exam_id", "source_pack_version", "rule_version", "score_scale_id"].some((k) =>
        typeof context[k] !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context[k] as string)
      ) ||
      !Array.isArray(context.offering_ids) || context.offering_ids.length < 1 ||
      context.offering_ids.length > 256 ||
      context.offering_ids.some((v) =>
        typeof v !== "string" || v.length < 1 || v.length > 128 || hasAsciiControl(v)
      ) ||
      new Set(context.offering_ids).size !== context.offering_ids.length
    ) fail("storage_reference_invalid");
    if (
      (entry.bytes as number | bigint) > this.settings.limits.maxArtifactBytes ||
      (entry.bytes as number | bigint) > 131072
    ) fail("storage_artifact_too_large");
    return key;
  }
  /** Saved reference tails: same reference-only scope, exact binder context and evidence pins. */
  validateReferenceTail(raw: Readonly<NativeObject>): string {
    const entry = object(raw), key = this.validateReference(entry);
    if (
      entry.kind !== "reference_tail" || entry.status !== "approved_reference" ||
      entry.approval_scope !== "same_exam_mathematical_reference" ||
      entry.engine_approved !== false || entry.production_allowed !== false ||
      typeof entry.source_review_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.source_review_sha256) ||
      typeof entry.independent_review_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.independent_review_sha256)
    ) {
      fail("artifact_not_approved");
    }
    if (entry.archive_only !== false) fail("storage_archive_only");
    if (entry.tail_layout !== undefined && entry.tail_layout !== REFERENCE_TAIL_CHUNKED_LAYOUT) {
      fail("storage_reference_invalid");
    }
    const context = object(entry.reference_context), evidence = object(entry.reference_evidence);
    if (
      Object.keys(context).sort().join(",") !== REFERENCE_TAIL_CONTEXT_KEYS ||
      typeof context.academic_year !== "number" || !Number.isSafeInteger(context.academic_year) ||
      context.academic_year < 2024 || context.academic_year > 2027 ||
      !["csat", "june_mock", "september_mock"].includes(String(context.exam_type)) ||
      ["exam_id", "source_pack_version", "rule_version", "score_scale_id"].some((k) =>
        typeof context[k] !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context[k] as string)
      ) ||
      ["model_version", "reference_curve_id", "weight_encoding", "resolved_model_scenario"].some(
        (k) =>
          typeof context[k] !== "string" || !(context[k] as string).length ||
          (context[k] as string).length > 256 || hasAsciiControl(context[k] as string),
      ) ||
      typeof context.profile_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(context.profile_sha256) ||
      typeof context.source_scenario_field_present !== "boolean" ||
      !Array.isArray(context.offering_ids) || context.offering_ids.length < 1 ||
      context.offering_ids.length > 256 ||
      context.offering_ids.some((v) =>
        typeof v !== "string" || v.length < 1 || v.length > 128 || hasAsciiControl(v)
      ) ||
      new Set(context.offering_ids).size !== context.offering_ids.length ||
      Object.keys(evidence).sort().join(",") !== REFERENCE_TAIL_EVIDENCE_KEYS ||
      Object.values(evidence).some((v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
    ) fail("storage_reference_invalid");
    if (
      (entry.bytes as number | bigint) > this.settings.limits.maxArtifactBytes ||
      (entry.bytes as number | bigint) > REFERENCE_TAIL_MAX_BYTES
    ) fail("storage_artifact_too_large");
    return key;
  }
  /** A separately selected compatibility receipt, never a production approval. */
  validateReferenceCompatibility(raw: Readonly<NativeObject>): string {
    const entry = object(raw), key = this.validateReference(entry);
    if (
      entry.kind !== "reference_compatibility" || entry.status !== "approved_reference" ||
      entry.approval_scope !== "same_exam_mathematical_reference" ||
      entry.engine_approved !== false || entry.production_allowed !== false ||
      entry.archive_only !== false ||
      ![entry.source_review_sha256, entry.independent_review_sha256].every((v) =>
        typeof v === "string" && /^[a-f0-9]{64}$/.test(v)
      )
    ) fail("artifact_not_approved");
    if (
      (entry.bytes as number | bigint) > this.settings.limits.maxArtifactBytes ||
      (entry.bytes as number | bigint) > 131072
    ) fail("storage_artifact_too_large");
    return key;
  }
  /** The selected head and issuer still must validate the receipt's exact semantic scope. */
  async referenceCompatibilityArtifact(
    raw: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<VerifiedStorageArtifact> {
    if (!signal || signal.aborted) fail("storage_unavailable");
    const entry = cloneNativeJson(object(raw)), key = this.validateReferenceCompatibility(entry);
    return await this.fetchArtifact(entry, key, signal);
  }
  /** Raw pinned bytes for request-local projection binding; SHA is verified by the binder. */
  async referenceTailBytes(raw: Readonly<NativeObject>, signal?: AbortSignal): Promise<Uint8Array> {
    const entry = cloneNativeJson(object(raw)), key = this.validateReferenceTail(entry);
    const bytes = Number(entry.bytes);
    await this.assertBucket(bytes, signal);
    if (signal?.aborted) fail("storage_unavailable");
    const path = "object/authenticated/" + encodeURIComponent(this.settings.bucket) + "/" +
      key.split("/").map(encodeURIComponent).join("/");
    const content = await this.get(path, bytes, signal);
    if (content.length !== bytes) fail("storage_size_mismatch");
    return content;
  }
  /** One piece of a selected chunked index. The caller has already matched key, length and
   * hash against the index bytes pinned by this entry; the piece must sit in the index folder. */
  async referenceTailChunkBytes(
    raw: Readonly<NativeObject>,
    chunkKey: string,
    bytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const entry = cloneNativeJson(object(raw)), key = this.validateReferenceTail(entry);
    if (entry.tail_layout !== REFERENCE_TAIL_CHUNKED_LAYOUT) fail("storage_reference_invalid");
    const piece = objectKey(chunkKey), folder = key.slice(0, key.lastIndexOf("/") + 1);
    if (
      !folder || !piece.startsWith(folder) || piece === key ||
      !piece.startsWith(this.settings.objectPrefix) || !Number.isSafeInteger(bytes) || bytes < 1 ||
      bytes > REFERENCE_TAIL_MAX_BYTES || bytes > this.settings.limits.maxArtifactBytes
    ) fail("storage_reference_invalid");
    await this.assertBucket(bytes, signal);
    if (signal?.aborted) fail("storage_unavailable");
    const path = "object/authenticated/" + encodeURIComponent(this.settings.bucket) + "/" +
      piece.split("/").map(encodeURIComponent).join("/");
    const content = await this.get(path, bytes, signal);
    if (content.length !== bytes) fail("storage_size_mismatch");
    return content;
  }
  private async get(
    path: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const url = this.origin + "/storage/v1/" + path, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.limits.requestTimeoutMs);
    const stop = () => controller.abort();
    try {
      if (signal) {
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) fail("storage_unavailable");
      }
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { apikey: this.settings.secretKey, Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      if (signal?.aborted) {
        await response.body?.cancel();
        fail("storage_unavailable");
      }
      if (
        response.status !== 200 || response.redirected || response.url !== url || !response.body
      ) {
        await response.body?.cancel();
        fail("storage_unavailable");
      }
      const declared = response.headers.get("Content-Length");
      if (
        declared !== null &&
        (!/^(0|[1-9][0-9]*)$/.test(declared) || BigInt(declared) > BigInt(limit))
      ) {
        await response.body.cancel();
        fail("storage_artifact_too_large");
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let total = 0, cancellation: Promise<void> | null = null;
      const cancelReader = () => {
        cancellation ??= reader.cancel().catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      if (controller.signal.aborted) cancelReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (controller.signal.aborted || signal?.aborted) {
            cancelReader();
            fail("storage_unavailable");
          }
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || chunk.value.length > limit - total) {
            await reader.cancel();
            fail("storage_artifact_too_large");
          }
          total += chunk.value.length;
          chunks.push(chunk.value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancelReader);
        if (cancellation) await cancellation;
        reader.releaseLock();
      }
      const content = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
      if (signal?.aborted) fail("storage_unavailable");
      return content;
    } catch (error) {
      if (error instanceof AccessError) throw error;
      throw new AccessError("storage_unavailable", 503);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", stop);
    }
  }
  private recentBucket?: {
    readonly startedMs: number;
    readonly signal?: AbortSignal;
    readonly raw: Promise<Uint8Array>;
    complete: boolean;
  };
  /** Completed metadata may be reused within its age bound; in-flight reads stay scope-bound. */
  private bucketMetadata(signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) fail("storage_unavailable");
    const now = performance.now(), recent = this.recentBucket;
    if (
      recent && now >= recent.startedMs && now - recent.startedMs < STORAGE_CHECK_REUSE_MS &&
      (recent.complete || recent.signal === signal)
    ) {
      return recent.raw;
    }
    const raw = this.get(
      "bucket/" + encodeURIComponent(this.settings.bucket),
      this.settings.limits.maxMetadataBytes,
      signal,
    );
    const entry = { startedMs: now, signal, raw, complete: false };
    this.recentBucket = entry;
    void raw.then(() => {
      entry.complete = true;
    }, () => {
      if (this.recentBucket === entry) this.recentBucket = undefined;
    });
    return raw;
  }
  private async assertBucket(bytes: number, signal?: AbortSignal): Promise<void> {
    const bucket = parsed(await this.bucketMetadata(signal));
    if (signal?.aborted) fail("storage_unavailable");
    if (bucket.id !== this.settings.bucket || bucket.public !== false) {
      fail("storage_bucket_not_private");
    }
    const cap = bucket.file_size_limit;
    if (!positiveInteger(cap) || cap > this.settings.limits.maxBucketBytes || cap < bytes) {
      fail("storage_bucket_limit_unverified");
    }
  }
  /** One fresh metadata response checks every selected reference, including deferred bodies. */
  async assertSelectedMetadata(entries: readonly Readonly<NativeObject>[]): Promise<void> {
    if (!entries.length) fail("storage_reference_invalid");
    let maximum = 0;
    for (const entry of entries) {
      if (entry.kind === "reference_conversion") this.validateReferenceCalculation(entry);
      else if (entry.kind === "reference_tail") this.validateReferenceTail(entry);
      else if (entry.kind === "reference_compatibility") this.validateReferenceCompatibility(entry);
      else this.validateSelectedReference(entry);
      maximum = Math.max(maximum, Number(entry.bytes));
    }
    await this.assertBucket(maximum);
  }
  async artifact(raw: Readonly<NativeObject>): Promise<VerifiedStorageArtifact> {
    // Snapshot the selected entry before any await; later caller mutations cannot repin a read.
    const entry = cloneNativeJson(object(raw)), key = this.validateSelectedReference(entry);
    return await this.fetchArtifact(entry, key);
  }
  /**
   * 연결 설정과 따로 지문을 고정한 비공개 파일(학교 반영 참고백분위 허가 목록 등).
   * 같은 버킷·접두사·크기 한도·지문 검사를 그대로 쓴다
   */
  async pinnedArtifact(raw: Readonly<NativeObject>): Promise<VerifiedStorageArtifact> {
    const entry = cloneNativeJson(object(raw)), key = this.validateReference(entry);
    if ((entry.bytes as number | bigint) > this.settings.limits.maxArtifactBytes) {
      fail("storage_artifact_too_large");
    }
    return await this.fetchArtifact(entry, key);
  }
  async referenceCalculationArtifact(
    raw: Readonly<NativeObject>,
    signal?: AbortSignal,
  ): Promise<VerifiedStorageArtifact> {
    const entry = cloneNativeJson(object(raw)), key = this.validateReferenceCalculation(entry);
    return await this.fetchArtifact(entry, key, signal);
  }
  private async fetchArtifact(
    entry: NativeObject,
    key: string,
    signal?: AbortSignal,
  ): Promise<VerifiedStorageArtifact> {
    const bytes = Number(entry.bytes);
    await this.assertBucket(bytes, signal);
    if (signal?.aborted) fail("storage_unavailable");
    const path = "object/authenticated/" + encodeURIComponent(this.settings.bucket) + "/" +
      key.split("/").map(encodeURIComponent).join("/");
    const load = () => this.get(path, bytes, signal);
    const result = this.reuse
      ? await this.reuse.cache.artifact(this.settings, entry, load, this.reuse.onReuse)
      : await verifyContent(await load(), entry);
    if (signal?.aborted) fail("storage_unavailable");
    return result;
  }
}
