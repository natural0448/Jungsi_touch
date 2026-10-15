/** Request-local bounded control reads. No control object is promoted to an engine artifact. */
import { AccessError } from "../application/access.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";
import type { NativeSelectionHeadPort } from "./native_data_provider.ts";
import { SupabaseArtifactClient } from "./supabase_artifacts.ts";
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
  /** The same fetch wrapper must serve control and selected-artifact reads for this request. */
  fetch(base: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      this.request();
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
    readBudget: RuntimeReadBudget,
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
  private assertLive(): void {
    const now = this.clock.nowUtc();
    if (typeof now !== "bigint" || now >= this.binding.expiresAtUtc) fail();
  }
  private async get(path: string, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    this.assertLive();
    const url = this.binding.projectUrl + "/storage/v1/" + path, abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.binding.storage.limits.requestTimeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { apikey: this.binding.storage.secretKey, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: abort.signal,
      });
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
      this.assertLive();
      return result;
    } catch {
      fail();
    } finally {
      clearTimeout(timer);
    }
  }
  async read(name: ControlSourceName): Promise<Uint8Array<ArrayBuffer>> {
    const reference = this.binding.references[name];
    if (!reference) fail();
    const bucket = this.binding.storage.bucket;
    const metadata = object(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(
      await this.get(
        "bucket/" + encodeURIComponent(bucket),
        this.binding.storage.limits.maxMetadataBytes,
      ),
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
    );
    if (content.length !== reference.bytes) fail();
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", content))].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    if (sha !== reference.sha256) fail();
    this.assertLive();
    return content;
  }
  async current(): ReturnType<NativeSelectionHeadPort["current"]> {
    let raw: NativeObject, expiresAtUtc: bigint;
    try {
      raw = object(
        parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(await this.read("head"))),
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
