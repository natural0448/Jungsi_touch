/** Request-local bounded control reads. No control object is promoted to an engine artifact. */
import { AccessError } from "../application/access.ts";
import { ReferenceReceiptExpired, ReferenceReceiptInvalidated } from "../application/access.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";
import type { NativeSelectionHeadPort } from "./native_data_provider.ts";
import { STORAGE_CHECK_REUSE_MS, SupabaseArtifactClient } from "./supabase_artifacts.ts";
import type {
  ApprovedRuntimeBinding,
  ControlSourceName,
  RuntimeReadLimits,
} from "./runtime_settings.ts";
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function object(value: unknown): NativeObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    value instanceof JsonFloat
  ) fail();
  return value as NativeObject;
}
export class RuntimeReadBudget {
  private requests = 0;
  private bytes = 0;
  private physicalRequests = 0;
  private physicalBytes = 0;
  private reusedArtifacts = 0;
  private externalReadOperations = 0;
  private externalPayloadBytes = 0;
  constructor(private readonly limits: RuntimeReadLimits) {
    if (
      !limits ||
      [limits.maxRequests, limits.maxBytes].some((v) => !Number.isSafeInteger(v) || v < 1)
    ) fail();
    this.limits = Object.freeze({ ...limits });
  }
  request(): void {
    if (this.requests >= this.limits.maxRequests) fail();
    this.requests++;
  }
  consume(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.maxBytes - this.bytes) {
      fail();
    }
    this.bytes += bytes;
  }
  /** Separate SQL payload accounting; not a count of individual PostgreSQL wire messages. */
  externalReadSnapshot(): Readonly<{ operations: number; payloadBytes: number }> {
    return Object.freeze({
      operations: this.externalReadOperations,
      payloadBytes: this.externalPayloadBytes,
    });
  }
  /** Reserve the bounded worst-case DB response before starting SQL. No quota increase or refund. */
  reserveExternal(bytes: number): (actualBytes: number) => void {
    if (
      !Number.isSafeInteger(bytes) || bytes < 1 || this.requests >= this.limits.maxRequests ||
      bytes > this.limits.maxBytes - this.bytes
    ) fail();
    this.requests++;
    this.bytes += bytes;
    this.externalReadOperations++;
    let settled = false;
    return (actualBytes: number) => {
      if (settled || !Number.isSafeInteger(actualBytes) || actualBytes < 0 || actualBytes > bytes) {
        fail();
      }
      settled = true;
      this.externalPayloadBytes += actualBytes;
    };
  }
  reuseArtifact(bytes: number): void {
    if (
      this.requests >= this.limits.maxRequests || !Number.isSafeInteger(bytes) || bytes < 1 ||
      bytes > this.limits.maxBytes - this.bytes
    ) fail();
    this.requests++;
    this.bytes += bytes;
    this.reusedArtifacts++;
  }
  /** Reused control metadata is still charged as a logical read and its full byte size. */
  reuseControl(bytes: number): void {
    if (
      this.requests >= this.limits.maxRequests || !Number.isSafeInteger(bytes) || bytes < 1 ||
      bytes > this.limits.maxBytes - this.bytes
    ) fail();
    this.requests++;
    this.bytes += bytes;
  }
  snapshot(): Readonly<{
    requests: number;
    bytes: number;
    physicalRequests: number;
    physicalBytes: number;
    reusedArtifacts: number;
  }> {
    return Object.freeze({
      requests: this.requests,
      bytes: this.bytes,
      physicalRequests: this.physicalRequests,
      physicalBytes: this.physicalBytes,
      reusedArtifacts: this.reusedArtifacts,
    });
  }
  /** The same fetch wrapper must serve control and selected-artifact reads for this request. */
  fetch(base: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      this.request();
      this.physicalRequests++;
      const response = await base(input, init);
      if (!response.body || response.status < 200 || response.status > 599) return response;
      const reader = response.body.getReader();
      const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull: async (controller) => {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              controller.close();
              reader.releaseLock();
              return;
            }
            this.physicalBytes += chunk.value.byteLength;
            this.consume(chunk.value.byteLength);
            controller.enqueue(Uint8Array.from(chunk.value));
          } catch (error) {
            try {
              await reader.cancel();
            } catch { /* Keep the safe budget/dependency error. */ }
            reader.releaseLock();
            controller.error(error);
          }
        },
        cancel: async (reason) => {
          try {
            await reader.cancel(reason);
          } finally {
            reader.releaseLock();
          }
        },
      });
      const result = new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperty(result, "url", { value: response.url });
      Object.defineProperty(result, "redirected", { value: response.redirected });
      return result;
    }) as typeof fetch;
  }
}
export class SupabaseRuntimeControls implements NativeSelectionHeadPort {
  readonly fetcher: typeof fetch;
  constructor(
    private readonly binding: ApprovedRuntimeBinding,
    private readonly clock: RequestClockPort,
    private readonly readBudget: RuntimeReadBudget,
    fetcher: typeof fetch = fetch,
  ) {
    if (
      !binding || !clock || typeof clock.nowUtc !== "function" ||
      !(readBudget instanceof RuntimeReadBudget)
    ) fail();
    // Reuse the established strict origin/key/bucket/prefix checks without reading or approving data.
    new SupabaseArtifactClient({ projectUrl: binding.projectUrl, ...binding.storage }, fetcher);
    this.fetcher = readBudget.fetch(fetcher);
    this.assertLive();
  }
  reserveExternalRead(maximumBytes: number): (actualBytes: number) => void {
    this.assertLive();
    return this.readBudget.reserveExternal(maximumBytes);
  }
  reuseArtifact(bytes: number): void {
    this.assertLive();
    this.readBudget.reuseArtifact(bytes);
  }
  private assertLive(): void {
    const now = this.clock.nowUtc();
    if (typeof now !== "bigint" || now >= this.binding.expiresAtUtc) fail();
  }
  private async get(
    path: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.assertLive();
    if (signal?.aborted) fail();
    const url = this.binding.projectUrl + "/storage/v1/" + path, abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.binding.storage.limits.requestTimeoutMs);
    const stop = () => abort.abort();
    signal?.addEventListener("abort", stop, { once: true });
    try {
      if (signal?.aborted) fail();
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { apikey: this.binding.storage.secretKey, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: abort.signal,
      });
      if (signal?.aborted) {
        await response.body?.cancel();
        fail();
      }
      if (
        response.status !== 200 || response.redirected || response.url !== url || !response.body
      ) {
        await response.body?.cancel();
        fail();
      }
      const declared = response.headers.get("content-length");
      if (
        declared !== null &&
        (!/^(0|[1-9][0-9]{0,15})$/.test(declared) || BigInt(declared) > BigInt(limit))
      ) {
        await response.body.cancel();
        fail();
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (signal?.aborted) {
            await reader.cancel();
            fail();
          }
          if (chunk.done) break;
          if (chunk.value.byteLength > limit - total) {
            await reader.cancel();
            fail();
          }
          total += chunk.value.byteLength;
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      if (signal?.aborted) fail();
      this.assertLive();
      return result;
    } catch {
      return fail();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }
  private recentBucket?: {
    readonly startedMs: number;
    readonly signal?: AbortSignal;
    readonly raw: Promise<Uint8Array<ArrayBuffer>>;
    complete: boolean;
  };
  /** Only identical in-flight checks may share work; completed checks are never reused. */
  private async bucketMetadata(signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    this.assertLive();
    if (signal?.aborted) fail();
    const now = performance.now(), recent = this.recentBucket;
    if (
      recent && !recent.complete && recent.signal === signal && Number.isFinite(now) &&
      now >= recent.startedMs && now - recent.startedMs < STORAGE_CHECK_REUSE_MS
    ) {
      const raw = await recent.raw;
      if (signal?.aborted) fail();
      this.assertLive();
      this.readBudget.reuseControl(raw.length);
      return raw;
    }
    const raw = this.get(
      "bucket/" + encodeURIComponent(this.binding.storage.bucket),
      this.binding.storage.limits.maxMetadataBytes,
      signal,
    );
    const entry = { startedMs: now, signal, raw, complete: false };
    this.recentBucket = entry;
    try {
      const value = await raw;
      if (signal?.aborted) fail();
      this.assertLive();
      entry.complete = true;
      return value;
    } catch (error) {
      if (this.recentBucket === entry) this.recentBucket = undefined;
      throw error;
    }
  }
  async read(name: ControlSourceName, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const reference = this.binding.references[name];
    if (!reference) fail();
    const bucket = this.binding.storage.bucket;
    const metadata = object(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(
      await this.bucketMetadata(signal),
    )));
    const cap = metadata.file_size_limit;
    if (
      metadata.id !== bucket || metadata.public !== false ||
      !(typeof cap === "bigint" || typeof cap === "number" && Number.isSafeInteger(cap)) ||
      cap <= 0 || cap > this.binding.storage.limits.maxBucketBytes || cap < reference.bytes
    ) fail();
    const content = await this.get(
      "object/authenticated/" + encodeURIComponent(bucket) + "/" +
        reference.objectKey.split("/").map(encodeURIComponent).join("/"),
      reference.bytes,
      signal,
    );
    if (content.length !== reference.bytes || signal?.aborted) fail();
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", content))].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    if (sha !== reference.sha256) fail();
    this.assertLive();
    return content;
  }
  private recentHead?: {
    readonly startedMs: number;
    readonly signal?: AbortSignal;
    readonly result: ReturnType<NativeSelectionHeadPort["current"]>;
    complete: boolean;
  };
  private readonly receiptHeads = new WeakMap<AbortSignal, {
    readonly entry: object;
    readonly startedMs: number;
    readonly head: Awaited<ReturnType<NativeSelectionHeadPort["current"]>>;
  }>();
  /** A local receipt is valid only for the captured request signal and original head read start. */
  currentReceipt(signal: AbortSignal): Readonly<{ assertCurrent(): void }> {
    this.assertLive();
    const receipt = this.receiptHeads.get(signal);
    const check = () => {
      this.assertLive();
      const now = performance.now();
      if (
        !receipt || signal.aborted || receipt.head.status !== "approved" ||
        !Number.isFinite(now) || !Number.isFinite(receipt.startedMs) ||
        now < receipt.startedMs
      ) fail();
      if (this.recentHead !== receipt.entry) {
        throw new ReferenceReceiptInvalidated("security_policy_unavailable");
      }
      if (now - receipt.startedMs >= STORAGE_CHECK_REUSE_MS) {
        throw new ReferenceReceiptExpired();
      }
    };
    check();
    return Object.freeze({ assertCurrent: check });
  }
  /** Completed checks retain their original freshness; in-flight work is shared only by its signal. */
  async current(signal?: AbortSignal): ReturnType<NativeSelectionHeadPort["current"]> {
    this.assertLive();
    if (signal?.aborted) fail();
    const now = performance.now(), recent = this.recentHead;
    if (
      recent && now >= recent.startedMs && now - recent.startedMs < STORAGE_CHECK_REUSE_MS &&
      (recent.complete || recent.signal === signal)
    ) {
      const head = await recent.result;
      if (signal?.aborted) fail();
      this.assertLive();
      if (signal && this.recentHead === recent) {
        this.receiptHeads.set(signal, { entry: recent, startedMs: recent.startedMs, head });
      }
      return head;
    }
    const result = this.freshCurrent(signal);
    const entry = { startedMs: now, signal, result, complete: false };
    this.recentHead = entry;
    try {
      const head = await result;
      if (signal?.aborted) fail();
      entry.complete = true;
      if (signal && this.recentHead === entry) {
        this.receiptHeads.set(signal, { entry, startedMs: entry.startedMs, head });
      }
      return head;
    } catch (error) {
      if (this.recentHead === entry) this.recentHead = undefined;
      throw error;
    }
  }
  private async freshCurrent(signal?: AbortSignal): ReturnType<NativeSelectionHeadPort["current"]> {
    let raw: NativeObject, expiresAtUtc: bigint;
    try {
      raw = object(
        parseNativeJson(
          new TextDecoder("utf-8", { fatal: true }).decode(await this.read("head", signal)),
        ),
      );
      if (typeof raw.expires_at !== "string") fail();
      expiresAtUtc = utcInstant(raw.expires_at);
    } catch {
      fail();
    }
    const fields = [
      "format",
      "status",
      "purpose",
      "project_url",
      "scope_sha256",
      "registry_sha256",
      "selection_sha256",
      "usage_policy_sha256",
      "approval_reference_sha256",
      "expires_at",
    ];
    if (
      Object.keys(raw).length !== fields.length || fields.some((key) => !Object.hasOwn(raw, key)) ||
      raw.format !== "jungsi.native-selection-head/v1" || raw.status !== "approved" ||
      raw.purpose !== "jungsi-api-runtime" ||
      raw.project_url !== this.binding.projectUrl ||
      raw.scope_sha256 !== this.binding.scopeSha256 ||
      raw.registry_sha256 !== this.binding.references.registry.sha256 ||
      raw.selection_sha256 !== this.binding.references.selection.sha256 ||
      raw.usage_policy_sha256 !== this.binding.references.usage_policy.sha256 ||
      raw.approval_reference_sha256 !== this.binding.approvalReferenceSha256 ||
      expiresAtUtc !== this.binding.expiresAtUtc
    ) fail();
    this.assertLive();
    return Object.freeze({
      status: "approved",
      registrySha256: this.binding.references.registry.sha256,
      selectionSha256: this.binding.references.selection.sha256,
      approvalReferenceSha256: this.binding.approvalReferenceSha256,
      expiresAtUtc,
    });
  }
}
