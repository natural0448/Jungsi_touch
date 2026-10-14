import { syncPromise } from "./fixture.ts";
/** Invented Storage responses and limits only; no network, private source or runtime approval. */
import {
  type StorageArtifactSettings,
  SupabaseArtifactClient,
} from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
const ORIGIN = "https://abcdefghijklmnopqrst.supabase.co";
const SETTINGS: StorageArtifactSettings = {
  projectUrl: ORIGIN,
  secretKey: "sb_secret_SYNTHETIC",
  bucket: "synthetic-private",
  objectPrefix: "SYNTHETIC/",
  limits: {
    maxArtifactBytes: 4096,
    maxBucketBytes: 8192,
    maxMetadataBytes: 1024,
    requestTimeoutMs: 1000,
  },
};
async function hash(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map((
    v,
  ) => v.toString(16).padStart(2, "0")).join("");
}
function response(url: string, bytes: Uint8Array | string, headers?: Record<string, string>) {
  const result = new Response(typeof bytes === "string" ? bytes : Uint8Array.from(bytes), {
    headers,
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
async function fixture(
  text = '{"version":"SYNTHETIC-v","count":9007199254740993,"float":1e0,"negative":-0e0}',
) {
  const bytes = new TextEncoder().encode(text), calls: { url: string; init: RequestInit }[] = [];
  const entry: NativeObject = {
    bucket: SETTINGS.bucket,
    object_key: "SYNTHETIC/가상.json",
    bytes: bytes.length,
    sha256: await hash(bytes),
    version: "SYNTHETIC-v",
    status: "approved",
    engine_approved: true,
    production_allowed: true,
    archive_only: false,
  };
  let bucket = '{"id":"synthetic-private","public":false,"file_size_limit":8192}';
  let objectBytes = bytes,
    override: ((url: string, init: RequestInit) => Promise<Response>) | null = null;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init! });
    if (override) return await override(url, init!);
    return response(url, url.includes("/bucket/") ? bucket : objectBytes);
  }) as typeof fetch;
  const client = new SupabaseArtifactClient(SETTINGS, fetcher);
  return {
    client,
    entry,
    calls,
    bytes,
    fetcher,
    setBucket(value: string) {
      bucket = value;
    },
    setBytes(value: Uint8Array) {
      objectBytes = Uint8Array.from(value);
    },
    setFetch(value: (url: string, init: RequestInit) => Promise<Response>) {
      override = value;
    },
  };
}
async function denied(run: () => unknown, code: string) {
  let error: unknown;
  try {
    await run();
  } catch (value) {
    error = value;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
  equal(error.http, 503);
}
Deno.test("Storage verifies original bytes before preserving large integers and float exponent lexemes", async () => {
  const f = await fixture(), result = await f.client.artifact(f.entry);
  assert(result.payload.count === 9007199254740993n);
  assert(result.payload.float instanceof JsonFloat);
  equal(result.payload.float.lexeme, "1e0");
  assert(result.payload.negative instanceof JsonFloat);
  equal(result.payload.negative.lexeme, "-0e0");
  equal(result.verifiedSha256, f.entry.sha256);
  equal(result.verifiedBytes, f.bytes.length);
  equal(f.calls.length, 2);
  equal(
    f.calls[1].url,
    ORIGIN + "/storage/v1/object/authenticated/synthetic-private/SYNTHETIC/%EA%B0%80%EC%83%81.json",
  );
  for (const { init } of f.calls) {
    equal(init.method, "GET");
    equal(init.redirect, "error");
    equal(new Headers(init.headers).get("apikey"), "sb_secret_SYNTHETIC");
  }
});
Deno.test("Storage rejects unapproved nonboolean or archive entries before any GET", async () => {
  for (
    const [key, value, code] of [
      ["status", "staged", "artifact_not_approved"],
      ["engine_approved", 1, "artifact_not_approved"],
      ["production_allowed", "true", "artifact_not_approved"],
      ["archive_only", true, "storage_archive_only"],
      ["archive_only", null, "storage_reference_invalid"],
    ] as const
  ) {
    const f = await fixture();
    f.entry[key] = value;
    await denied(() => f.client.artifact(f.entry), code);
    equal(f.calls.length, 0);
  }
});
Deno.test("Storage reference scope rejects traversal encoded separators other buckets and wrong numeric types", async () => {
  for (
    const patch of [
      { object_key: "OTHER/file.json" },
      { bucket: "other" },
      { object_key: "SYNTHETIC/../file.json" },
      { object_key: "SYNTHETIC/%2f/file.json" },
      { object_key: "SYNTHETIC/\\file.json" },
      { bytes: new JsonFloat("1e0") },
      { bytes: true },
      ...[...Array.from({ length: 32 }, (_, code) => code), 0x7f].map((code) => ({
        object_key: "SYNTHETIC/" + String.fromCharCode(code) + ".json",
      })),
    ]
  ) {
    const f = await fixture();
    Object.assign(f.entry, patch);
    await denied(
      () => f.client.artifact(f.entry),
      patch.object_key?.startsWith("OTHER") || patch.bucket
        ? "storage_reference_scope_mismatch"
        : "storage_reference_invalid",
    );
    equal(f.calls.length, 0);
  }
});
Deno.test("Storage requires a private bucket and native positive bounded integer capacity", async () => {
  for (
    const [body, code] of [
      [
        '{"id":"synthetic-private","public":true,"file_size_limit":8192}',
        "storage_bucket_not_private",
      ],
      [
        '{"id":"synthetic-private","public":false,"file_size_limit":8192e0}',
        "storage_bucket_limit_unverified",
      ],
      [
        '{"id":"synthetic-private","public":false,"file_size_limit":true}',
        "storage_bucket_limit_unverified",
      ],
      ['{"id":"synthetic-private","public":false}', "storage_bucket_limit_unverified"],
      [
        '{"id":"synthetic-private","public":false,"file_size_limit":9000}',
        "storage_bucket_limit_unverified",
      ],
    ]
  ) {
    const f = await fixture();
    f.setBucket(body);
    await denied(() => f.client.artifact(f.entry), code);
    equal(f.calls.length, 1);
  }
});
Deno.test("Storage detects raw byte hash mismatch independently of parsed JSON equivalence", async () => {
  const f = await fixture('{"version":"SYNTHETIC-v","value":1}');
  f.setBytes(new TextEncoder().encode('{"version":"SYNTHETIC-v","value":2}'));
  await denied(() => f.client.artifact(f.entry), "storage_hash_mismatch");
});
Deno.test("Storage rejects duplicate keys malformed UTF8 and nonobject sources after matching original hash", async () => {
  for (const text of ['{"version":"SYNTHETIC-v","value":1,"value":2}', "[]"]) {
    const f = await fixture(text);
    await denied(() => f.client.artifact(f.entry), "storage_artifact_invalid");
  }
  const f = await fixture(), malformed = new Uint8Array([0xc3, 0x28]);
  f.entry.bytes = malformed.length;
  f.entry.sha256 = await hash(malformed);
  f.setBytes(malformed);
  await denied(() => f.client.artifact(f.entry), "storage_artifact_invalid");
});
Deno.test("Storage aborts changed URL and redirect results without fetching the object", async () => {
  const f = await fixture();
  f.setFetch(() => syncPromise(() => response("https://untrusted.invalid/", "{}")));
  await denied(() => f.client.artifact(f.entry), "storage_unavailable");
  equal(f.calls.length, 1);
  const g = await fixture();
  g.setFetch((url) =>
    syncPromise(() => {
      const r = response(url, "{}");
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    })
  );
  await denied(() => g.client.artifact(g.entry), "storage_unavailable");
});
Deno.test("Storage enforces declared and actual byte bounds even when Content-Length understates the stream", async () => {
  const f = await fixture();
  f.setFetch((url) => syncPromise(() => response(url, "{}", { "Content-Length": "1025" })));
  await denied(() => f.client.artifact(f.entry), "storage_artifact_too_large");
  const g = await fixture();
  g.setFetch((url) =>
    syncPromise(() => response(url, new Uint8Array(1025), { "Content-Length": "1" }))
  );
  await denied(() => g.client.artifact(g.entry), "storage_artifact_too_large");
  const short = await fixture();
  short.setBytes(new Uint8Array([32]));
  await denied(() => short.client.artifact(short.entry), "storage_size_mismatch");
});
Deno.test("Storage snapshots the selected reference before awaits and checks an explicit null version", async () => {
  const f = await fixture();
  f.setFetch((url) =>
    syncPromise(() => {
      f.entry.sha256 = "a".repeat(64);
      f.entry.bytes = 1;
      return response(
        url,
        url.includes("/bucket/")
          ? '{"id":"synthetic-private","public":false,"file_size_limit":8192}'
          : f.bytes,
      );
    })
  );
  equal((await f.client.artifact(f.entry)).verifiedBytes, f.bytes.length);
  const g = await fixture('{"version":null,"pack_version":"SYNTHETIC-v"}');
  await denied(() => g.client.artifact(g.entry), "artifact_version_mismatch");
});
Deno.test("Storage constructor rejects missing limits weak project URL and browser or legacy keys", async () => {
  for (
    const patch of [
      { projectUrl: "http://abcdefghijklmnopqrst.supabase.co" },
      { projectUrl: ORIGIN + "/path" },
      { secretKey: "sb_publishable_SYNTHETIC" },
      { secretKey: "SYNTHETIC-JWT" },
      { bucket: undefined },
      { objectPrefix: "" },
      { limits: undefined },
    ]
  ) {
    await denied(
      () => new SupabaseArtifactClient({ ...SETTINGS, ...patch } as StorageArtifactSettings),
      "storage_configuration_invalid",
    );
  }
});
