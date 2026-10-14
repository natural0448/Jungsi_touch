import { hasAsciiControl } from "../domain/text.ts";
/** Read-only private Storage source bytes. No upload, registry adoption or source rewriting. */
import { AccessError } from "../application/access.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
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
export class SupabaseArtifactClient {
  private readonly origin: string;
  private readonly settings: Readonly<StorageArtifactSettings>;
  constructor(settings: StorageArtifactSettings, private readonly fetcher: typeof fetch = fetch) {
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
  private async get(path: string, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    const url = this.origin + "/storage/v1/" + path, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.limits.requestTimeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { apikey: this.settings.secretKey, Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
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
      let total = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || chunk.value.length > limit - total) {
            await reader.cancel();
            fail("storage_artifact_too_large");
          }
          total += chunk.value.length;
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const content = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
      return content;
    } catch (error) {
      if (error instanceof AccessError) throw error;
      fail("storage_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  async artifact(raw: Readonly<NativeObject>): Promise<VerifiedStorageArtifact> {
    // Snapshot the selected entry before any await; later caller mutations cannot repin a read.
    const entry = cloneNativeJson(object(raw)), key = this.validateSelectedReference(entry);
    const bytes = Number(entry.bytes);
    const bucket = parsed(
      await this.get(
        "bucket/" + encodeURIComponent(this.settings.bucket),
        this.settings.limits.maxMetadataBytes,
      ),
    );
    if (bucket.id !== this.settings.bucket || bucket.public !== false) {
      fail("storage_bucket_not_private");
    }
    const cap = bucket.file_size_limit;
    if (!positiveInteger(cap) || cap > this.settings.limits.maxBucketBytes || cap < bytes) {
      fail("storage_bucket_limit_unverified");
    }
    const path = "object/authenticated/" + encodeURIComponent(this.settings.bucket) + "/" +
      key.split("/").map(encodeURIComponent).join("/");
    const content = await this.get(path, bytes);
    if (content.length !== bytes) fail("storage_size_mismatch");
    if (await rawHash(content) !== entry.sha256) fail("storage_hash_mismatch");
    const payload = parsed(content);
    const version = Object.hasOwn(payload, "version") ? payload.version : payload.pack_version;
    if (version !== entry.version) fail("artifact_version_mismatch");
    return Object.freeze({ payload, verifiedSha256: entry.sha256 as string, verifiedBytes: bytes });
  }
}
