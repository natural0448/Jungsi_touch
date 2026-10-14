import { syncPromise } from "./fixture.ts";
/** Invented private registry pins only. Source-byte acceptance is never engine or live acceptance. */
import {
  NativeSourceSelection,
  type PinnedSourceBytes,
} from "../../supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts";
import { SupabaseArtifactClient } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { assert, equal } from "./fixture.ts";
async function pinned(text: string): Promise<PinnedSourceBytes> {
  const bytes = new TextEncoder().encode(text);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
  return { bytes, sha256: hash, maxBytes: 16384 };
}
async function fixture(text?: string) {
  const payload = await pinned(
    text ?? '{"version":"SYNTHETIC-a-v","large":9007199254740993,"float":1e3}',
  );
  const entry: NativeObject = {
    kind: "catalog",
    key: "service",
    bucket: "synthetic-private",
    object_key: "SYNTHETIC/a.json",
    version: "SYNTHETIC-a-v",
    bytes: payload.bytes.length,
    sha256: payload.sha256,
    status: "approved",
    engine_approved: true,
    production_allowed: true,
    archive_only: false,
  };
  const registry: NativeObject = { format: "jungsi.data-registry/v1", entries: [entry] };
  const selection: NativeObject = {
    format: "jungsi.runtime-selection/v1",
    required: [{ kind: "catalog", key: "service" }],
  };
  const calls: string[] = [];
  const fetcher = ((input: RequestInfo | URL) =>
    syncPromise(() => {
      const url = String(input);
      calls.push(url);
      const result = new Response(
        url.includes("/bucket/")
          ? '{"id":"synthetic-private","public":false,"file_size_limit":16384}'
          : Uint8Array.from(payload.bytes),
      );
      Object.defineProperty(result, "url", { value: url });
      return result;
    })) as typeof fetch;
  const client = new SupabaseArtifactClient({
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    secretKey: "sb_secret_SYNTHETIC",
    bucket: "synthetic-private",
    objectPrefix: "SYNTHETIC/",
    limits: {
      maxArtifactBytes: 8192,
      maxBucketBytes: 16384,
      maxMetadataBytes: 1024,
      requestTimeoutMs: 1000,
    },
  }, fetcher);
  return {
    client,
    registry,
    selection,
    entry,
    calls,
    prepare: async () =>
      NativeSourceSelection.prepare(
        client,
        await pinned(nativeJsonText(registry)),
        await pinned(nativeJsonText(selection)),
      ),
  };
}
async function denied(run: () => Promise<unknown>, code: string) {
  let e: unknown;
  try {
    await run();
  } catch (value) {
    e = value;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, 503);
}
Deno.test("native selection pins raw registry and selection and preserves source numeric types", async () => {
  const f = await fixture(),
    snapshot = await f.prepare(),
    row = snapshot.load("catalog", "service")!;
  assert(row.payload.large === 9007199254740993n);
  assert(row.payload.float instanceof JsonFloat);
  equal(row.payload.float.lexeme, "1e3");
  equal(snapshot.identities(), [{ kind: "catalog", key: "service" }]);
  equal(snapshot.privateReceipt().production_ready, false);
  equal(snapshot.privateReceipt().engine_acceptance, "NOT_VERIFIED_BY_RAW_SOURCE_SELECTION");
  equal(f.calls.length, 2);
});
Deno.test("native selection validates the entire required approval set before any network read", async () => {
  const f = await fixture();
  (f.registry.entries as NativeObject[]).push({
    ...f.entry,
    key: "SYNTHETIC-second",
    engine_approved: false,
  });
  (f.selection.required as NativeObject[]).push({ kind: "catalog", key: "SYNTHETIC-second" });
  await denied(f.prepare, "artifact_not_approved");
  equal(f.calls.length, 0);
});
Deno.test("native selection does not auto-promote staged archive or newly available registry entries", async () => {
  const f = await fixture();
  (f.registry.entries as NativeObject[]).push({
    ...f.entry,
    kind: "conversion",
    key: "SYNTHETIC-unselected",
    status: "staged",
    engine_approved: false,
    production_allowed: false,
    archive_only: true,
  });
  const snapshot = await f.prepare();
  equal(snapshot.load("conversion", "SYNTHETIC-unselected"), null);
  equal(snapshot.identities().length, 1);
  equal(f.calls.length, 2);
});
Deno.test("native selection rejects duplicate registry or selected identities before I/O", async () => {
  const f = await fixture();
  (f.registry.entries as NativeObject[]).push({ ...f.entry });
  await denied(f.prepare, "registry_identity_conflict");
  equal(f.calls.length, 0);
  const g = await fixture();
  (g.selection.required as NativeObject[]).push({ kind: "catalog", key: "service" });
  await denied(g.prepare, "registry_identity_conflict");
  equal(g.calls.length, 0);
});
Deno.test("native selection rejects a changed raw pin and duplicate JSON keys before network access", async () => {
  const f = await fixture(),
    registry = await pinned(nativeJsonText(f.registry)),
    selection = await pinned(nativeJsonText(f.selection));
  registry.bytes[0] = 32;
  await denied(
    () => NativeSourceSelection.prepare(f.client, registry, selection),
    "registry_hash_invalid",
  );
  await denied(
    async () =>
      NativeSourceSelection.prepare(
        f.client,
        await pinned('{"format":"jungsi.data-registry/v1","entries":[],"entries":[]}'),
        selection,
      ),
    "registry_format_invalid",
  );
  equal(f.calls.length, 0);
});
Deno.test("native selection requires exact selection shape and rejects missing dependencies", async () => {
  const f = await fixture();
  f.selection.latest = true;
  await denied(f.prepare, "registry_format_invalid");
  equal(f.calls.length, 0);
  const g = await fixture();
  (g.selection.required as NativeObject[])[0].key = "SYNTHETIC-missing";
  await denied(g.prepare, "runtime_dependency_missing");
  equal(g.calls.length, 0);
});
Deno.test("native selection returns isolated clones without refetching or changing verified receipts", async () => {
  const f = await fixture(),
    snapshot = await f.prepare(),
    first = snapshot.load("catalog", "service")!;
  first.payload.large = 0;
  first.entry.production_allowed = false;
  f.entry.sha256 = "a".repeat(64);
  const next = snapshot.load("catalog", "service")!;
  assert(next.payload.large === 9007199254740993n);
  equal(next.entry.production_allowed, true);
  equal(f.calls.length, 2);
});
Deno.test("native selection requires explicit source timezone for naive as_of and preserves source spelling", async () => {
  const text = '{"version":"SYNTHETIC-a-v","as_of":"2026-10-14T10:00:00"}';
  const f = await fixture(text);
  await denied(f.prepare, "artifact_time_invalid");
  const g = await fixture(text);
  g.entry.source_timezone = "Asia/Seoul";
  equal((await g.prepare()).load("catalog", "service")!.payload.as_of, "2026-10-14T10:00:00");
});
Deno.test("native selection rejects an oversized later source before fetching an earlier selected source", async () => {
  const f = await fixture();
  (f.registry.entries as NativeObject[]).push({
    ...f.entry,
    kind: "forecast_inputs",
    key: "SYNTHETIC-large",
    bytes: 8193,
  });
  (f.selection.required as NativeObject[]).push({
    kind: "forecast_inputs",
    key: "SYNTHETIC-large",
  });
  await denied(f.prepare, "storage_artifact_too_large");
  equal(f.calls.length, 0);
});
