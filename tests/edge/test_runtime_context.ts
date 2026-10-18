/** Entirely synthetic selected graph. No approved input, network or database operations. */
import type { ApiOperationId } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { VerifiedArtifactCache } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
import { readBasicRuntimeSettings } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
import { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
import {
  SYNTHETIC_RUNTIME_NOW,
  syntheticRuntimeBinding,
  syntheticRuntimePin,
} from "./synthetic_runtime_binding.ts";
async function fixture(
  options: {
    artifactCache?: VerifiedArtifactCache;
    extraSelection?: boolean;
    unapproved?: boolean;
    maxReads?: number;
    operation?: ApiOperationId | null;
    approvedOperations?: ApiOperationId[];
  } = {},
) {
  const catalog = {
    format: "jungsi.catalog-release/v1",
    version: "SYNTHETIC-catalog",
    status: "approved",
    as_of: "2026-10-14T00:00:00Z",
    offerings: [],
    history: [],
  };
  const artifact = await syntheticRuntimePin(nativeJsonText(catalog));
  const entry: NativeObject = {
    kind: "catalog",
    key: "service",
    bucket: "synthetic-private",
    object_key: "SYNTHETIC/catalog.json",
    sha256: artifact.sha256,
    bytes: artifact.bytes.length,
    version: catalog.version,
    status: options.unapproved ? "prepared" : "approved",
    engine_approved: true,
    production_allowed: true,
    archive_only: false,
    source_timezone: "Asia/Seoul",
  };
  const f = await syntheticRuntimeBinding(
    (d) => {
      d.scope = {
        operations: options.approvedOperations ?? ["history.search"],
        artifacts: [{ kind: "catalog", key: "service" }],
      };
      if (options.maxReads) {
        ((d.limits as NativeObject).read as NativeObject).max_requests = options.maxReads;
      }
    },
    () => {},
    (bodies) => {
      bodies.registry = nativeJsonText({ format: "jungsi.data-registry/v1", entries: [entry] });
      bodies.selection = nativeJsonText({
        format: "jungsi.runtime-selection/v1",
        required: [
          { kind: "catalog", key: "service" },
          ...(options.extraSelection ? [{ kind: "exam_pack", key: "SYNTHETIC-extra" }] : []),
        ],
      });
      bodies.usage_policy = nativeJsonText({
        format: "jungsi.runtime-usage-policy/v1",
        status: "approved",
        purpose: "jungsi-api-runtime",
        version: "SYNTHETIC-policy",
        approval_reference_sha256: "a".repeat(64),
        expires_at: "2026-10-15T00:30:00Z",
        exams: [],
        dimensions: [
          "request_window",
          "distinct_scores",
          "calculation_cost",
          "concurrent_jobs",
          "result_volume",
        ]
          .map((kind) => ({
            kind,
            period_seconds: kind === "concurrent_jobs" ? 1 : 60,
            ceiling: 10000,
            standard: 100,
            paid: 100,
          })),
        operations: [{
          operation: "history.search",
          reserved_result_bytes: 512,
          base_units: 0,
          per_offering_units: 0,
        }],
      });
    },
  );
  let now = SYNTHETIC_RUNTIME_NOW;
  const calls: string[] = [];
  let sqlCalls = 0;
  const context = new NativeRuntimeRequest(
    f.env,
    () => readBasicRuntimeSettings(f.env),
    () =>
      new SupabaseSqlTransport({
        transaction() {
          sqlCalls++;
          throw new Error("unexpected_synthetic_sql");
        },
        close() {
          return Promise.resolve();
        },
      }),
    { nowUtc: () => now },
    options.operation === undefined ? "history.search" : options.operation,
    (input, init) => {
      const url = String(input);
      calls.push(url);
      equal(init?.redirect, "error");
      const path = new URL(url).pathname;
      let body: string | Uint8Array<ArrayBuffer>;
      if (path.includes("/bucket/")) {
        body = '{"id":"synthetic-private","public":false,"file_size_limit":65536}';
      } else if (path.endsWith("/catalog.json")) body = artifact.bytes;
      else {
        const name = path.split("/").at(-1)!.replace(".json", "");
        assert(Object.hasOwn(f.body, name));
        body = f.body[name];
      }
      const response = new Response(body);
      Object.defineProperty(response, "url", { value: url });
      return Promise.resolve(response);
    },
    options.artifactCache,
  );
  return {
    context,
    f,
    calls,
    sqlCalls: () => sqlCalls,
    now: (v: bigint) => {
      now = v;
    },
  };
}
async function denied(work: () => Promise<unknown>, code?: string) {
  let thrown: unknown;
  try {
    await work();
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof AccessError);
  equal(thrown.http, 503);
  if (code) equal(thrown.code, code);
}
Deno.test("runtime context composes the pinned catalog and policy with no SQL before a budget reservation", async () => {
  const f = await fixture(), data = await f.context.data(), catalog = await data.getCatalog();
  assert(catalog);
  equal(catalog.version, "SYNTHETIC-catalog");
  equal(f.calls.filter((url) => url.endsWith("/catalog.json")).length, 1);
  equal((await f.context.budget()).policy.version, "SYNTHETIC-policy");
  equal(f.sqlCalls(), 0);
  const calls = f.calls.length;
  await f.context.assertCurrent();
  assert(f.calls.length > calls);
});
Deno.test("runtime context rejects a selected source outside the binding before any artifact GET", async () => {
  const f = await fixture({ extraSelection: true });
  await denied(() => f.context.data(), "security_policy_unavailable");
  equal(f.calls.filter((url) => url.endsWith("/catalog.json")).length, 0);
});
Deno.test("runtime context does not promote a prepared registry entry", async () => {
  const f = await fixture({ unapproved: true });
  await denied(() => f.context.data());
  equal(f.calls.filter((url) => url.endsWith("/catalog.json")).length, 0);
});
Deno.test("runtime context shares the read cap across controls and artifacts", async () => {
  const f = await fixture({ maxReads: 2 });
  await denied(() => f.context.data(), "security_policy_unavailable");
  equal(f.calls.length, 2);
  equal(f.calls.filter((url) => url.endsWith("/catalog.json")).length, 0);
});
Deno.test("runtime context rejects changed current head after a warm provider", async () => {
  const f = await fixture();
  const data = await f.context.data();
  assert(await data.getCatalog());
  f.f.body.head = f.f.body.head.replace('"status":"approved"', '"status":"prepared"');
  await denied(() => f.context.assertCurrent(), "security_policy_unavailable");
  await denied(() => data.getCatalog(), "security_policy_unavailable");
});
Deno.test("runtime context rejects policy expiry before releasing an already built result", async () => {
  const f = await fixture();
  await f.context.data();
  f.now(SYNTHETIC_RUNTIME_NOW + 1800000000n);
  await denied(() => f.context.assertCurrent(), "security_policy_unavailable");
});

Deno.test("runtime context distinguishes a valid binding excluding search without reading controls or SQL", async () => {
  for (const operation of ["history.search", "offerings.search"] as const) {
    const f = await fixture({
      operation,
      approvedOperations: [
        "session.read",
        "score-profile.create",
        "overall.analyze",
        "report.read",
        "report.export",
      ],
    });
    await denied(() => f.context.budget(), "operation_scope_not_approved");
    equal(f.calls.length, 0);
    equal(f.sqlCalls(), 0);
  }
});
Deno.test("runtime context never labels an invalid, expired or unknown binding as merely unselected", async () => {
  for (const mode of ["invalid", "expired", "unknown"] as const) {
    const f = await fixture({ operation: mode === "unknown" ? null : "offerings.search" });
    if (mode === "invalid") f.f.values.JUNGSI_API_BINDING_JSON = "{}";
    if (mode === "expired") f.now(SYNTHETIC_RUNTIME_NOW + 86400000000n);
    await denied(() => f.context.budget(), "security_policy_unavailable");
    equal(f.calls.length, 0);
    equal(f.sqlCalls(), 0);
  }
});
Deno.test("runtime context retains policy failure when an approved operation has no approved cost", async () => {
  const f = await fixture({
    operation: "offerings.search",
    approvedOperations: ["history.search", "offerings.search"],
  });
  await denied(() => f.context.budget(), "security_policy_unavailable");
  assert(f.calls.some((url) => url.endsWith("usage_policy.json")));
  equal(f.sqlCalls(), 0);
});

Deno.test("warm artifact request still reads fresh head and rejects its revocation", async () => {
  const cache = new VerifiedArtifactCache(), first = await fixture({ artifactCache: cache });
  await first.context.data();
  const second = await fixture({ artifactCache: cache });
  await second.context.data();
  equal(second.calls.filter((url) => url.endsWith("/catalog.json")).length, 0);
  second.f.body.head = second.f.body.head.replace('"approved"', '"revoked"');
  await denied(() => second.context.assertCurrent());
  equal(second.sqlCalls(), 0);
});
Deno.test("warm artifact cannot bypass a fresh binding operation scope or expiry", async () => {
  const cache = new VerifiedArtifactCache(), first = await fixture({ artifactCache: cache });
  await first.context.data();
  const limited = await fixture({ artifactCache: cache, maxReads: first.calls.length - 1 });
  await denied(() => limited.context.data());
  const wrong = await fixture({ artifactCache: cache, operation: "offering.read" });
  await denied(() => wrong.context.data(), "operation_scope_not_approved");
  equal(wrong.calls.length, 0);
  const expired = await fixture({ artifactCache: cache });
  expired.now(999999999999999999n);
  await denied(() => expired.context.data());
  equal(expired.calls.length, 0);
});
