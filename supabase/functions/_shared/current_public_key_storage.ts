/** Private metadata projection reads under the existing request-wide Storage budget. */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApprovedRuntimeBinding } from "./jungsi/infrastructure/runtime_settings.ts";
import { SupabaseArtifactClient } from "./jungsi/infrastructure/supabase_artifacts.ts";
import { parseNativeJson } from "./jungsi/domain/native_json.ts";
import type { PublicKeyObjectRead, PublicKeyObjectReference } from "./current_public_key_index.ts";
const fail = (): never => {
  throw new AccessError("current_catalog_key_index_unapproved", 503);
};
/** Metadata is never marked engine_approved to pass an artifact loader. */
export function currentPublicKeyObjectReader(
  binding: ApprovedRuntimeBinding,
  fetcher: typeof fetch,
): PublicKeyObjectRead {
  const validator = new SupabaseArtifactClient({
    projectUrl: binding.projectUrl,
    ...binding.storage,
  }, fetcher);
  let bucketChecked: Promise<number> | undefined;
  const get = async (path: string, cap: number): Promise<Uint8Array> => {
    if (
      !Number.isSafeInteger(cap) || cap < 1 ||
      cap > binding.storage.limits.maxArtifactBytes
    ) return fail();
    const url = binding.projectUrl + "/storage/v1/" + path,
      abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(),
        binding.storage.limits.requestTimeoutMs,
      );
    try {
      const response = await fetcher(url, {
        method: "GET",
        headers: {
          apikey: binding.storage.secretKey,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: abort.signal,
      });
      if (
        response.status !== 200 || response.redirected ||
        response.url !== url || !response.body
      ) {
        await response.body?.cancel();
        return fail();
      }
      const length = response.headers.get("content-length");
      if (
        length !== null &&
        (!/^(0|[1-9][0-9]{0,15})$/.test(length) || BigInt(length) > BigInt(cap))
      ) {
        await response.body.cancel();
        return fail();
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (
            !(chunk.value instanceof Uint8Array) ||
            chunk.value.length > cap - size
          ) {
            await reader.cancel();
            return fail();
          }
          size += chunk.value.length;
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    } catch {
      return fail();
    } finally {
      clearTimeout(timer);
    }
  };
  const bucket = () =>
    bucketChecked ??= (async () => {
      let parsed: unknown;
      try {
        parsed = parseNativeJson(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await get(
              "bucket/" + encodeURIComponent(binding.storage.bucket),
              binding.storage.limits.maxMetadataBytes,
            ),
          ),
        );
      } catch {
        return fail();
      }
      if (
        !parsed || typeof parsed !== "object" || Array.isArray(parsed)
      ) return fail();
      const m = parsed as Record<string, unknown>, cap = m.file_size_limit;
      if (
        m.id !== binding.storage.bucket || m.public !== false ||
        !(typeof cap === "number" && Number.isSafeInteger(cap) ||
          typeof cap === "bigint") ||
        BigInt(cap as number | bigint) < 1n ||
        BigInt(cap as number | bigint) >
          BigInt(binding.storage.limits.maxBucketBytes)
      ) return fail();
      return Number(cap);
    })();
  return async (ref: PublicKeyObjectReference) => {
    const key = validator.validateReference({
      bucket: binding.storage.bucket,
      object_key: ref.object_key,
      bytes: ref.bytes,
      sha256: ref.sha256,
      version: "current-public-key-index-v1",
    });
    if (
      ref.bytes > binding.storage.limits.maxArtifactBytes ||
      ref.bytes > await bucket()
    ) return fail();
    return await get(
      "object/authenticated/" + encodeURIComponent(binding.storage.bucket) +
        "/" + key.split("/").map(encodeURIComponent).join("/"),
      ref.bytes,
    );
  };
}
