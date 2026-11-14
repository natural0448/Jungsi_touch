/** Synthetic Storage only: no real data, credentials, head or runtime approval. */
import {
  type StorageArtifactSettings,
  SupabaseArtifactClient,
} from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
const ORIGIN = "https://abcdefghijklmnopqrst.supabase.co";
const settings: StorageArtifactSettings = {
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
const encoder = new TextEncoder();
async function hash(raw: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(raw)))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
function response(
  url: string,
  body: string | Uint8Array | ReadableStream<Uint8Array>,
  headers?: Record<string, string>,
): Response {
  const result = new Response(
    typeof body === "string" ? body : body instanceof Uint8Array ? Uint8Array.from(body) : body,
    { headers },
  );
  Object.defineProperty(result, "url", { value: url });
  return result;
}
async function setup() {
  const bytes = encoder.encode('{"version":"SYNTHETIC-v","data":{"n":9007199254740993}}');
  const entry: NativeObject = {
    reference_context: {
      academic_year: 2027,
      exam_id: "exam",
      exam_type: "september_mock",
      model_version: "model",
      offering_ids: ["2027:1"],
      profile_sha256: "c".repeat(64),
      reference_curve_id: "curve",
      resolved_model_scenario: "base",
      rule_version: "rule",
      score_scale_id: "axis",
      source_pack_version: "pack",
      source_scenario_field_present: false,
      source_scenario_value: null,
      weight_encoding: "synthetic",
    },
    reference_evidence: Object.fromEntries(
      [
        "binder_sha256",
        "definition_sha256",
        "independent_sha256",
        "shared_proof_sha256",
        "source_cdf_sha256",
        "source_csv_sha256",
      ].map((k) => [k, "d".repeat(64)]),
    ),
    kind: "reference_tail",
    bucket: settings.bucket,
    object_key: "SYNTHETIC/tail.json",
    bytes: bytes.length,
    sha256: await hash(bytes),
    version: "SYNTHETIC-v",
    status: "approved_reference",
    approval_scope: "same_exam_mathematical_reference",
    engine_approved: false,
    production_allowed: false,
    archive_only: false,
    source_review_sha256: "a".repeat(64),
    independent_review_sha256: "b".repeat(64),
  };
  const state = { bucket: 0, object: 0, physicalAbort: 0, physicalCancel: 0 };
  let mode = "ok", bucketPublic = false;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), signal = init?.signal;
    if (url.includes("/bucket/")) {
      state.bucket++;
      return response(
        url,
        JSON.stringify({ id: settings.bucket, public: bucketPublic, file_size_limit: 8192 }),
      );
    }
    state.object++;
    if (mode === "pending-fetch") {
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          state.physicalAbort++;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }
    if (mode === "pending-stream") {
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          state.physicalCancel++;
        },
      });
      return response(url, stream);
    }
    return response(url, bytes);
  }) as typeof fetch;
  return {
    bytes,
    entry,
    state,
    client: new SupabaseArtifactClient(settings, fetcher),
    mode: (x: string) => {
      mode = x;
    },
    public: (x: boolean) => {
      bucketPublic = x;
    },
  };
}
async function denied(run: () => unknown, expected: string) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, expected);
}
Deno.test("reference tail bytes preserve exact payload and use existing bounded storage fetch", async () => {
  const f = await setup(), signal = new AbortController().signal;
  const raw = await f.client.referenceTailBytes(f.entry, signal);
  equal([...raw], [...f.bytes]);
  equal(f.state.bucket, 1);
  equal(f.state.object, 1);
});
Deno.test("reference tail metadata rejects promotion, missing review, archive and bad scope", async () => {
  const f = await setup();
  const patches: NativeObject[] = [
    { kind: "percentile" },
    { status: "approved" },
    { approval_scope: "production" },
    { engine_approved: true },
    { production_allowed: true },
    { archive_only: true },
    { source_review_sha256: "x" },
  ];
  for (const patch of patches) {
    await denied(
      () => f.client.referenceTailBytes({ ...f.entry, ...patch }, new AbortController().signal),
      patch.archive_only === true ? "storage_archive_only" : "artifact_not_approved",
    );
  }
  equal(f.state.bucket, 0);
  equal(f.state.object, 0);
});
Deno.test("reference tail enforces length configured limit and private bucket; binder verifies hash and version", async () => {
  const f = await setup();
  await denied(
    () =>
      f.client.referenceTailBytes(
        { ...f.entry, bytes: (f.entry.bytes as number) + 1 },
        new AbortController().signal,
      ),
    "storage_size_mismatch",
  );
  await denied(
    () => f.client.referenceTailBytes({ ...f.entry, bytes: 4097 }, new AbortController().signal),
    "storage_artifact_too_large",
  );
  const f2 = await setup();
  f2.public(true);
  await denied(
    () => f2.client.referenceTailBytes(f2.entry, new AbortController().signal),
    "storage_bucket_not_private",
  );
});
Deno.test("aborted request performs no Storage access", async () => {
  const f = await setup(), c = new AbortController();
  c.abort();
  await denied(() => f.client.referenceTailBytes(f.entry, c.signal), "storage_unavailable");
  equal(f.state.bucket, 0);
  equal(f.state.object, 0);
});
Deno.test("scope abort reaches pending physical fetch before the operation settles", async () => {
  const f = await setup(), c = new AbortController();
  f.mode("pending-fetch");
  const pending = f.client.referenceTailBytes(f.entry, c.signal);
  while (f.state.object === 0) await Promise.resolve();
  c.abort();
  await denied(() => pending, "storage_unavailable");
  equal(f.state.physicalAbort, 1);
});
Deno.test("scope abort cancels and awaits an already-open response stream", async () => {
  const f = await setup(), c = new AbortController();
  f.mode("pending-stream");
  const pending = f.client.referenceTailBytes(f.entry, c.signal);
  while (f.state.object === 0) await Promise.resolve();
  await Promise.resolve();
  c.abort();
  await denied(() => pending, "storage_unavailable");
  equal(f.state.physicalCancel, 1);
});
Deno.test("completed bucket metadata can be reused across live signals", async () => {
  const f = await setup(), a = new AbortController(), b = new AbortController();
  await f.client.referenceTailBytes(f.entry, a.signal);
  await f.client.referenceTailBytes(f.entry, a.signal);
  equal(f.state.bucket, 1);
  await f.client.referenceTailBytes(f.entry, b.signal);
  equal(f.state.bucket, 1);
  equal(f.state.object, 3);
});
Deno.test("selected metadata recognizes reference-only tail without making it production approved", async () => {
  const f = await setup();
  await f.client.assertSelectedMetadata([f.entry]);
  equal(f.state.bucket, 1);
  await denied(() => f.client.artifact(f.entry), "artifact_not_approved");
});

Deno.test("compatibility receipt is reference-only and validates original bytes", async () => {
  const f = await setup(),
    c = new AbortController(),
    entry: NativeObject = { ...f.entry, kind: "reference_compatibility" };
  const receipt = await f.client.referenceCompatibilityArtifact(entry, c.signal);
  equal(receipt.verifiedSha256, entry.sha256);
  equal(receipt.verifiedBytes, f.bytes.length);
  await denied(
    () => f.client.referenceCompatibilityArtifact({ ...entry, production_allowed: true }, c.signal),
    "artifact_not_approved",
  );
  await denied(
    () => f.client.referenceCompatibilityArtifact({ ...entry, sha256: "c".repeat(64) }, c.signal),
    "storage_hash_mismatch",
  );
});
Deno.test("compatibility receipt physical fetch observes scope cancellation", async () => {
  const f = await setup(), c = new AbortController();
  f.mode("pending-fetch");
  const pending = f.client.referenceCompatibilityArtifact({
    ...f.entry,
    kind: "reference_compatibility",
  }, c.signal);
  while (f.state.object === 0) await Promise.resolve();
  c.abort();
  await denied(() => pending, "storage_unavailable");
  equal(f.state.physicalAbort, 1);
});
