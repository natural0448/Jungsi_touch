/** Synthetic HTTP responses only; no network permission or operating secret. */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApprovedRuntimeBinding } from "./jungsi/infrastructure/runtime_settings.ts";
import { currentPublicKeyObjectReader } from "./current_public_key_storage.ts";
function assert(x: unknown): asserts x {
  if (!x) throw new Error("assertion_failed");
}
const binding = {
  projectUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  storage: {
    bucket: "synthetic-private",
    objectPrefix: "SYNTHETIC/",
    secretKey: "sb_secret_SYNTHETIC_NOT_REAL",
    limits: {
      maxArtifactBytes: 524288,
      maxBucketBytes: 1048576,
      maxMetadataBytes: 4096,
      requestTimeoutMs: 1000,
    },
  },
} as unknown as ApprovedRuntimeBinding;
const reference = {
  object_key: "SYNTHETIC/keys.json",
  bytes: 2,
  sha256: "a".repeat(64),
};
function response(
  url: string,
  body: BodyInit,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const r = new Response(body, { status, headers });
  Object.defineProperty(r, "url", { value: url });
  return r;
}
async function rejects(run: () => Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  assert(error.http === 503);
}
Deno.test("key object reader uses private bucket metadata and a bounded exact-prefix GET", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (input, init) => {
    await Promise.resolve(); // Simulate an HTTP boundary.
    const url = String(input);
    calls.push({ url, init });
    return response(
      url,
      url.includes("/bucket/")
        ? JSON.stringify({
          id: "synthetic-private",
          public: false,
          file_size_limit: 1048576,
        })
        : "{}",
    );
  }) as typeof fetch;
  const read = currentPublicKeyObjectReader(binding, fetcher);
  assert(new TextDecoder().decode(await read(reference)) === "{}");
  assert(calls.length === 2);
  assert(
    calls.every((c) =>
      c.init?.method === "GET" && c.init?.cache === "no-store" &&
      c.init?.redirect === "error"
    ),
  );
  assert(
    calls[1].url.endsWith(
      "/object/authenticated/synthetic-private/SYNTHETIC/keys.json",
    ),
  );
});
Deno.test("key object reader rejects a public bucket before reading its object", async () => {
  let objects = 0;
  const fetcher = (async (input) => {
    await Promise.resolve(); // Simulate an HTTP boundary.
    const url = String(input);
    if (!url.includes("/bucket/")) objects++;
    return response(
      url,
      JSON.stringify({
        id: "synthetic-private",
        public: true,
        file_size_limit: 1048576,
      }),
    );
  }) as typeof fetch;
  await rejects(() => currentPublicKeyObjectReader(binding, fetcher)(reference));
  assert(objects === 0);
});
Deno.test("key object reader rejects an oversized streamed body even without content-length", async () => {
  const fetcher = (async (input) => {
    await Promise.resolve(); // Simulate an HTTP boundary.
    const url = String(input);
    return response(
      url,
      url.includes("/bucket/")
        ? JSON.stringify({
          id: "synthetic-private",
          public: false,
          file_size_limit: 1048576,
        })
        : "{}x",
    );
  }) as typeof fetch;
  await rejects(() => currentPublicKeyObjectReader(binding, fetcher)(reference));
});
Deno.test("key object reader rejects a reference outside the approved prefix without fetching", async () => {
  let requests = 0;
  const fetcher = (async () => {
    await Promise.resolve(); // Simulate an HTTP boundary.
    requests++;
    throw new Error("unexpected_fetch");
  }) as typeof fetch;
  await rejects(() =>
    currentPublicKeyObjectReader(binding, fetcher)({
      ...reference,
      object_key: "OTHER/keys.json",
    })
  );
  assert(requests === 0);
});
