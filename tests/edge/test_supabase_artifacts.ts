import { syncPromise } from "./fixture.ts";
/** Invented Storage responses and limits only; no network, private source or runtime approval. */
import {
  STORAGE_CHECK_REUSE_MS,
  type StorageArtifactSettings,
  SupabaseArtifactClient,
  VerifiedArtifactCache,
} from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { agedChecks, assert, equal, withMonotonic } from "./fixture.ts";
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

Deno.test("artifact reuse avoids only the immutable object GET and isolates mutable payloads", () =>
  agedChecks(async () => {
    const f = await fixture(), cache = new VerifiedArtifactCache();
    const reused: number[] = [];
    const client = new SupabaseArtifactClient(SETTINGS, f.fetcher, {
      cache,
      onReuse: (n) => reused.push(n),
    });
    const first = await client.artifact(f.entry);
    first.payload.count = 0;
    const second = await client.artifact(f.entry);
    equal(f.calls.length, 3);
    equal(reused, [f.bytes.length]);
    assert(second.payload.count === 9007199254740993n);
    assert(second.payload.float instanceof JsonFloat);
    equal(second.payload.float.lexeme, "1e0");
    assert(second.payload.negative instanceof JsonFloat);
    equal(second.payload.negative.lexeme, "-0e0");
  }));
Deno.test("warm artifact still rejects revoked selection before GET", async () => {
  const f = await fixture(),
    client = new SupabaseArtifactClient(SETTINGS, f.fetcher, {
      cache: new VerifiedArtifactCache(),
      onReuse: () => {},
    });
  await client.artifact(f.entry);
  f.entry.engine_approved = false;
  await denied(() => client.artifact(f.entry), "artifact_not_approved");
  equal(f.calls.length, 2);
});
Deno.test("warm artifact still rereads bucket privacy", () =>
  agedChecks(async () => {
    const f = await fixture(),
      client = new SupabaseArtifactClient(SETTINGS, f.fetcher, {
        cache: new VerifiedArtifactCache(),
        onReuse: () => {},
      });
    await client.artifact(f.entry);
    f.setBucket('{"id":"synthetic-private","public":true,"file_size_limit":8192}');
    await denied(() => client.artifact(f.entry), "storage_bucket_not_private");
    equal(f.calls.length, 3);
  }).then(() => {
    let clock = 1000;
    return withMonotonic(() => clock, async () => {
      // One bucket answer serves this request's reads for under 1.5 s; then it is re-read.
      const g = await fixture(),
        client = new SupabaseArtifactClient(SETTINGS, g.fetcher, {
          cache: new VerifiedArtifactCache(),
          onReuse: () => {},
        });
      await client.artifact(g.entry);
      clock += STORAGE_CHECK_REUSE_MS - 1;
      await client.artifact(g.entry);
      equal(g.calls.length, 2);
      g.setBucket('{"id":"synthetic-private","public":true,"file_size_limit":8192}');
      clock += 1;
      await denied(() => client.artifact(g.entry), "storage_bucket_not_private");
      equal(g.calls.length, 3);
    });
  }));
Deno.test("warm artifact still rereads bucket cap", () =>
  agedChecks(async () => {
    const f = await fixture(),
      client = new SupabaseArtifactClient(SETTINGS, f.fetcher, {
        cache: new VerifiedArtifactCache(),
        onReuse: () => {},
      });
    await client.artifact(f.entry);
    f.setBucket('{"id":"synthetic-private","public":false,"file_size_limit":1}');
    await denied(() => client.artifact(f.entry), "storage_bucket_limit_unverified");
  }));
Deno.test("failed hash and failed length never populate reuse", () =>
  agedChecks(async () => {
    const f = await fixture(), cache = new VerifiedArtifactCache();
    const client = new SupabaseArtifactClient(SETTINGS, f.fetcher, { cache, onReuse: () => {} });
    f.setBytes(new Uint8Array(f.bytes.length));
    await denied(() => client.artifact(f.entry), "storage_hash_mismatch");
    equal(cache.snapshot().entries, 0);
    f.setBytes(new Uint8Array([32]));
    await denied(() => client.artifact(f.entry), "storage_size_mismatch");
    equal(cache.snapshot().entries, 0);
    f.setBytes(f.bytes);
    await client.artifact(f.entry);
    equal(f.calls.length, 6);
  }));
Deno.test("version mismatch is verified before reuse adoption", () =>
  agedChecks(async () => {
    const f = await fixture(), cache = new VerifiedArtifactCache();
    const client = new SupabaseArtifactClient(SETTINGS, f.fetcher, { cache, onReuse: () => {} });
    f.entry.version = "SYNTHETIC-other";
    await denied(() => client.artifact(f.entry), "artifact_version_mismatch");
    equal(cache.snapshot().entries, 0);
    f.entry.version = "SYNTHETIC-v";
    await client.artifact(f.entry);
    equal(f.calls.length, 4);
  }));
Deno.test("artifact identity separates project credential bucket path SHA length and version", async () => {
  const f = await fixture(), cache = new VerifiedArtifactCache();
  let loads = 0;
  const load = () => {
    loads++;
    return Promise.resolve(Uint8Array.from(f.bytes));
  };
  await cache.artifact(SETTINGS, f.entry, load, () => {});
  for (
    const settings of [
      { ...SETTINGS, projectUrl: "https://zyxwvutsrqponmlkjihg.supabase.co" },
      { ...SETTINGS, secretKey: "sb_secret_ROTATED_SYNTHETIC" },
      { ...SETTINGS, bucket: "synthetic-other" },
    ]
  ) await cache.artifact(settings, f.entry, load, () => {});
  await cache.artifact(
    SETTINGS,
    { ...f.entry, object_key: "SYNTHETIC/other.json" },
    load,
    () => {},
  );
  for (
    const [patch, code] of [
      [{ sha256: "a".repeat(64) }, "storage_hash_mismatch"],
      [{ bytes: f.bytes.length + 1 }, "storage_size_mismatch"],
      [{ version: "SYNTHETIC-other" }, "artifact_version_mismatch"],
    ] as const
  ) await denied(() => cache.artifact(SETTINGS, { ...f.entry, ...patch }, load, () => {}), code);
  equal(loads, 8);
});
Deno.test("artifact reuse entry limit evicts least recently used completed source", async () => {
  const f = await fixture(), cache = new VerifiedArtifactCache(2);
  let loads = 0;
  const read = (id: string) =>
    cache.artifact(SETTINGS, { ...f.entry, object_key: id }, () => {
      loads++;
      return Promise.resolve(Uint8Array.from(f.bytes));
    }, () => {});
  await read("a");
  await read("b");
  await read("a");
  await read("c");
  await read("b");
  equal(loads, 4);
  equal(cache.snapshot().entries, 2);
});
Deno.test("artifact reuse byte limit bounds retained verified source bytes", async () => {
  const f = await fixture(), cache = new VerifiedArtifactCache(16, f.bytes.length * 2);
  let loads = 0;
  for (const id of ["a", "b", "c", "a"]) {
    await cache.artifact(SETTINGS, { ...f.entry, object_key: id }, () => {
      loads++;
      return Promise.resolve(Uint8Array.from(f.bytes));
    }, () => {});
    assert(cache.snapshot().bytes <= f.bytes.length * 2);
  }
  equal(loads, 4);
  equal(cache.snapshot().entries, 2);
});
Deno.test("artifact reuse TTL expiry rechecks source bytes without caching a failure", () =>
  agedChecks(async () => {
    const f = await fixture();
    let now = 0;
    const cache = new VerifiedArtifactCache(16, 4096, 10, () => now);
    const client = new SupabaseArtifactClient(SETTINGS, f.fetcher, { cache, onReuse: () => {} });
    await client.artifact(f.entry);
    now = 9;
    await client.artifact(f.entry);
    equal(f.calls.length, 3);
    now = 10;
    f.setBytes(new Uint8Array(f.bytes.length));
    await denied(() => client.artifact(f.entry), "storage_hash_mismatch");
    equal(cache.snapshot().entries, 0);
  }));
Deno.test("artifact reuse clock rollback discards completed entries", () =>
  agedChecks(async () => {
    const f = await fixture();
    let now = 20;
    const cache = new VerifiedArtifactCache(16, 4096, 10, () => now);
    const client = new SupabaseArtifactClient(SETTINGS, f.fetcher, { cache, onReuse: () => {} });
    await client.artifact(f.entry);
    now = 19;
    await client.artifact(f.entry);
    equal(f.calls.length, 4);
    equal(cache.snapshot().entries, 1);
  }));
Deno.test("concurrent artifact misses share no promise failure timeout or request queue", async () => {
  const f = await fixture(), cache = new VerifiedArtifactCache();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => release = resolve);
  const failed = cache.artifact(SETTINGS, f.entry, async () => {
    await wait;
    throw new Error("synthetic_abort");
  }, () => {});
  const successful = await cache.artifact(
    SETTINGS,
    f.entry,
    () => Promise.resolve(Uint8Array.from(f.bytes)),
    () => {},
  );
  equal(successful.verifiedBytes, f.bytes.length);
  release();
  try {
    await failed;
    assert(false);
  } catch (error) {
    assert(error instanceof Error);
    equal(error.message, "synthetic_abort");
  }
  let hit = false;
  await cache.artifact(SETTINGS, f.entry, () => {
    throw new Error("unexpected_load");
  }, () => hit = true);
  assert(hit);
  equal(cache.snapshot().entries, 1);
});
Deno.test("artifact larger than cache capacity remains a verified uncached read", () =>
  agedChecks(async () => {
    const f = await fixture(), cache = new VerifiedArtifactCache(16, 1);
    const client = new SupabaseArtifactClient(SETTINGS, f.fetcher, {
      cache,
      onReuse: () => assert(false),
    });
    await client.artifact(f.entry);
    await client.artifact(f.entry);
    equal(f.calls.length, 4);
    equal(cache.snapshot().bytes, 0);
  }));
Deno.test("invalid reuse configuration is denied and invalid cache clock falls back to verification", () =>
  agedChecks(async () => {
    for (
      const work of [
        () => new VerifiedArtifactCache(0),
        () => new VerifiedArtifactCache(17),
        () => new VerifiedArtifactCache(1, 0),
        () => new VerifiedArtifactCache(1, 1, 60_001),
      ]
    ) {
      await denied(work, "storage_configuration_invalid");
    }
    const f = await fixture(), cache = new VerifiedArtifactCache(16, 4096, 10, () => NaN);
    const client = new SupabaseArtifactClient(SETTINGS, f.fetcher, {
      cache,
      onReuse: () => assert(false),
    });
    await client.artifact(f.entry);
    await client.artifact(f.entry);
    equal(f.calls.length, 4);
    equal(cache.snapshot().entries, 0);
  }));
