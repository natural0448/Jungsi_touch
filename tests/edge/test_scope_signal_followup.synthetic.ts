import { runtimeAnalysisDataPort } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import { NativeSourceSelection } from "../../supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts";
import { NativeDataProvider } from "../../supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  RuntimeReadBudget,
  SupabaseRuntimeControls,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { SupabaseArtifactClient } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { SYNTHETIC_RUNTIME_NOW, syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { assert, equal, withMonotonic } from "./fixture.ts";

async function setup() {
  const fixture = await syntheticRuntimeBinding(), binding = await fixture.load();
  return { fixture, binding, budget: new RuntimeReadBudget(binding.readLimits) };
}
function response(url: string, body: string): Response {
  const result = new Response(body);
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function bucket(): string {
  return '{"id":"synthetic-private","public":false,"file_size_limit":65536}';
}
async function rejected(work: Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await work;
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.http, 503);
}
Deno.test("scope abort reaches the actual head bucket and head object fetch", async () => {
  for (const phase of ["bucket", "head"]) {
    const x = await setup();
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (phase === "head" && url.includes("/bucket/")) {
        return Promise.resolve(response(url, bucket()));
      }
      started();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(new Error("SYNTHETIC abort")), {
          once: true,
        });
        if (signal.aborted) reject(new Error("SYNTHETIC abort"));
      });
    }) as typeof fetch;
    const controls = new SupabaseRuntimeControls(
      x.binding,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      x.budget,
      fetcher,
    );
    const scope = new AbortController();
    const work = controls.current(scope.signal);
    await begun;
    scope.abort();
    await rejected(work);
    equal(x.budget.snapshot().physicalRequests, phase === "bucket" ? 1 : 2);
  }
});
Deno.test("in-flight head reads with different signals do not cancel each other and completed head is reused", () =>
  withMonotonic(() => 1000, async () => {
    const x = await setup();
    let first!: () => void;
    const started = new Promise<void>((resolve) => {
      first = resolve;
    });
    let calls = 0;
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls++;
      if (calls === 1) {
        first();
        return new Promise<Response>((_resolve, reject) => {
          const signal = init!.signal!;
          signal.addEventListener("abort", () => reject(new Error("SYNTHETIC abort")), {
            once: true,
          });
        });
      }
      return Promise.resolve(
        response(url, url.includes("/bucket/") ? bucket() : x.fixture.body.head),
      );
    }) as typeof fetch;
    const controls = new SupabaseRuntimeControls(
      x.binding,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      x.budget,
      fetcher,
    );
    const a = new AbortController(), b = new AbortController();
    const firstWork = controls.current(a.signal);
    await started;
    const second = await controls.current(b.signal);
    assert(second.status === "approved");
    a.abort();
    await rejected(firstWork);
    await controls.current(new AbortController().signal);
    equal(calls, 3);
  }));
async function referenceEntry() {
  const payload = '{"version":"SYNTHETIC"}';
  const bytes = new TextEncoder().encode(payload);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
  return {
    payload,
    entry: {
      kind: "reference_conversion",
      key: "SYNTHETIC-rule",
      bucket: "synthetic-private",
      object_key: "SYNTHETIC/rule.json",
      bytes: bytes.length,
      sha256: sha,
      version: "SYNTHETIC",
      status: "approved_reference",
      archive_only: false,
      engine_approved: false,
      production_allowed: false,
      approval_scope: "same_exam_mathematical_reference",
      source_review_sha256: "a".repeat(64),
      independent_review_sha256: "b".repeat(64),
      reference_context: {
        academic_year: 2027,
        exam_id: "SYNTHETIC-exam",
        exam_type: "september_mock",
        source_pack_version: "SYNTHETIC-pack",
        rule_version: "SYNTHETIC-rule",
        score_scale_id: "SYNTHETIC-axis",
        offering_ids: ["SYNTHETIC-o"],
      },
    },
  };
}
Deno.test("reference calculation passes scope abort to bucket and selected object fetch", async () => {
  for (const phase of ["bucket", "object"]) {
    const x = await setup(), r = await referenceEntry();
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (phase === "object" && url.includes("/bucket/")) {
        return Promise.resolve(response(url, bucket()));
      }
      started();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(new Error("SYNTHETIC abort")), {
          once: true,
        });
        if (signal.aborted) reject(new Error("SYNTHETIC abort"));
      });
    }) as typeof fetch;
    const client = new SupabaseArtifactClient({
      projectUrl: x.binding.projectUrl,
      ...x.binding.storage,
    }, x.budget.fetch(fetcher));
    const scope = new AbortController(),
      work = client.referenceCalculationArtifact(r.entry, scope.signal);
    await begun;
    scope.abort();
    await rejected(work);
    equal(x.budget.snapshot().physicalRequests, phase === "bucket" ? 1 : 2);
  }
});
Deno.test("reference bucket pending signals are isolated while completed metadata stays cached", () =>
  withMonotonic(() => 1000, async () => {
    const x = await setup(), r = await referenceEntry();
    let first!: () => void;
    const begun = new Promise<void>((resolve) => {
      first = resolve;
    });
    let calls = 0;
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls++;
      if (calls === 1) {
        first();
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("SYNTHETIC abort")), {
            once: true,
          });
        });
      }
      return Promise.resolve(response(url, url.includes("/bucket/") ? bucket() : r.payload));
    }) as typeof fetch;
    const client = new SupabaseArtifactClient({
      projectUrl: x.binding.projectUrl,
      ...x.binding.storage,
    }, x.budget.fetch(fetcher));
    const a = new AbortController(), b = new AbortController();
    const firstWork = client.referenceCalculationArtifact(r.entry, a.signal);
    await begun;
    const result = await client.referenceCalculationArtifact(r.entry, b.signal);
    equal(result.payload.version, "SYNTHETIC");
    a.abort();
    await rejected(firstWork);
    await client.referenceCalculationArtifact(r.entry, new AbortController().signal);
    equal(calls, 4);
  }));
async function pinnedDocument(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
  return { bytes, sha256, maxBytes: 65536 };
}
Deno.test("reference selection isolates in-flight signals and reuses completed verified payload", async () => {
  const x = await setup(), r = await referenceEntry();
  const registry = await pinnedDocument({ format: "jungsi.data-registry/v1", entries: [r.entry] });
  const selected = await pinnedDocument({
    format: "jungsi.runtime-selection/v1",
    required: [{ kind: "reference_conversion", key: "SYNTHETIC-rule" }],
  });
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  let objects = 0;
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/bucket/")) return Promise.resolve(response(url, bucket()));
    if (++objects === 1) {
      started();
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("SYNTHETIC abort")), {
          once: true,
        });
      });
    }
    return Promise.resolve(response(url, r.payload));
  }) as typeof fetch;
  const client = new SupabaseArtifactClient({
    projectUrl: x.binding.projectUrl,
    ...x.binding.storage,
  }, x.budget.fetch(fetcher));
  const selection = await NativeSourceSelection.prepare(client, registry, selected);
  const a = new AbortController(), b = new AbortController();
  const first = selection.loadReference("SYNTHETIC-rule", a.signal);
  await begun;
  const second = await selection.loadReference("SYNTHETIC-rule", b.signal);
  assert(second);
  a.abort();
  await rejected(first);
  assert(await selection.loadReference("SYNTHETIC-rule", new AbortController().signal));
  equal(objects, 2);
});
Deno.test("reference provider forwards scope to head and on-demand rule read", async () => {
  const x = await setup(), r = await referenceEntry();
  const registry = await pinnedDocument({ format: "jungsi.data-registry/v1", entries: [r.entry] });
  const selected = await pinnedDocument({
    format: "jungsi.runtime-selection/v1",
    required: [{ kind: "reference_conversion", key: "SYNTHETIC-rule" }],
  });
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/bucket/")) return Promise.resolve(response(url, bucket()));
    started();
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("SYNTHETIC abort")), {
        once: true,
      });
    });
  }) as typeof fetch;
  const client = new SupabaseArtifactClient({
    projectUrl: x.binding.projectUrl,
    ...x.binding.storage,
  }, x.budget.fetch(fetcher));
  const selection = await NativeSourceSelection.prepare(client, registry, selected);
  let seenSignal: AbortSignal | undefined;
  const data = new NativeDataProvider(selection, {
    heads: {
      current(signal) {
        seenSignal = signal;
        return Promise.resolve({
          status: "approved",
          registrySha256: selection.registryHash,
          selectionSha256: selection.selectionHash,
          approvalReferenceSha256: "a".repeat(64),
          expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 1000000n,
        });
      },
    },
    clock: { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    approvalReferenceSha256: "a".repeat(64),
    expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 1000000n,
  });
  const scope = new AbortController();
  const work = data.getReference("SYNTHETIC-o", scope.signal);
  await begun;
  equal(seenSignal, scope.signal);
  scope.abort();
  await rejected(work);
});

Deno.test("four prefetch workers share scope signal and all drain before abort returns", async () => {
  const parent = new AbortController(), scope = new AbortController();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const four = new Promise<void>((resolve) => {
    started = resolve;
  });
  const signals: AbortSignal[] = [];
  const source = {
    async select(_id: string, signal?: AbortSignal) {
      assert(signal);
      signals.push(signal);
      if (signals.length === 4) started();
      await gate;
      throw new Error("SYNTHETIC transport stopped");
    },
    read: () => Promise.resolve(new Uint8Array()),
    assertCurrent: () => Promise.resolve(),
    assertCompatible: () => Promise.resolve(),
  };
  const provider = { referenceTailAuthority: () => source } as unknown as NativeDataProvider;
  const data = runtimeAnalysisDataPort(
    { data: () => Promise.resolve(provider) },
    async (_stage, work) => await work(),
    parent.signal,
  );
  let done = false;
  const pending = data.prefetchReferenceTails!([
    "SYNTHETIC-a",
    "SYNTHETIC-b",
    "SYNTHETIC-c",
    "SYNTHETIC-d",
    "SYNTHETIC-e",
    "SYNTHETIC-f",
  ], scope.signal).then(() => {
    done = true;
  }, () => {
    done = true;
  });
  await four;
  equal(signals.length, 4);
  assert(signals.every((signal) => signal === signals[0]));
  scope.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(signals.every((signal) => signal.aborted));
  assert(!done);
  equal(signals.length, 4);
  release();
  await pending;
  assert(done);
  equal(signals.length, 4);
  assert(!parent.signal.aborted);
});
