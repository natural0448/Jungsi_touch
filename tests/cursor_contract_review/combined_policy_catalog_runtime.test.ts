/** Synthetic wire fixture: no actual DB, Storage, network, or credentials. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { syntheticApiPolicies } from "../edge/synthetic_api_contract.ts";
import { COMBINED_POLICY_CONSUMER_OPERATION_IDS } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import {
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import type { ApprovedRuntimeBinding } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
import {
  type NativeSqlPool,
  type NativeSqlTransaction,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { createCombinedPolicyCatalogService as originalFactory } from "./combined_policy_catalog_runtime.original.ts";
import { createCombinedPolicyCatalogService as scopedFactory } from "../../supabase/functions/_shared/combined_policy_catalog_runtime.ts";
import {
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
  CURRENT_PUBLIC_METADATA_SEEDS,
  CURRENT_PUBLIC_METADATA_SQL,
  type PublicCatalogDescriptor,
} from "../../supabase/functions/_shared/current_public_catalog_sql.ts";
import {
  prepareCurrentPublicKeyIndexV3,
  type PublicKeyIndexEntry,
  publicKeyRawHash,
} from "../../supabase/functions/_shared/current_public_key_index.ts";
import type { PublicCatalogRecord } from "../../supabase/functions/_shared/current_public_catalog.ts";

const NOW = utcInstant("2026-10-19T00:00:00Z"), USER = "00000000-0000-0000-0000-000000000001";
const H = (c: string) => c.repeat(64);
function assert(x: unknown, message = "assertion"): asserts x {
  if (!x) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  if (nativeJsonText(a, true) !== nativeJsonText(b, true)) throw new Error("not_equal");
}
async function denied(work: () => Promise<unknown>, code: string, http: number) {
  try {
    await work();
  } catch (error) {
    assert(error instanceof AccessError);
    equal([error.code, error.http], [code, http]);
    return;
  }
  throw new Error("expected_denial");
}
function request(
  op: ApiExecution["operation"],
  query: Record<string, string> = {},
  paid = true,
): ApiExecution {
  return {
    operation: op,
    session: {
      user: { subjectId: USER, expiresAtUtc: NOW + 100_000_000n },
      evaluatedAtUtc: NOW,
      tier: paid ? "paid" : "standard",
      paidUntilUtc: paid ? NOW + 100_000_000n : null,
    },
    management: null,
    body: {},
    query,
    params: { offering_id: "2027:SYN-PK-1" },
    requestKey: null,
  };
}
function guide(n: number): PublicCatalogRecord {
  const pk = `SYN-PK-${n}`, id = `2027:${pk}`;
  const row: NativeObject = {
    academic_year: 2027,
    school_id: "SYN-SCHOOL",
    offering_pk: pk,
    offering_id: id,
    source_kind: "current_guide",
    active_service: true,
    practical_required: false,
    university: "Synthetic University",
    department: "Synthetic Department",
    track: null,
    recruit_group: "가",
    quota_value: n === 1 ? null : 0,
    location: null,
    campus: null,
    wildcard_group: null,
    recruitment_link_status: "verified",
    metadata: { practical_required: false, participation_conditions_status: "verified" },
  };
  return { key: [2027, "SYN-SCHOOL", pk, "", id], row, guide: { ...row } };
}
function history(): PublicCatalogRecord {
  const row: NativeObject = {
    academic_year: 2026,
    school_id: "SYN-SCHOOL",
    offering_pk: "SYN-OLD",
    canonical_result_id: "SYN-OBS",
    metric_kind: "SYN-METRIC",
    active_service: true,
    university: "Synthetic University",
    department: "Synthetic Department",
    track: null,
    recruit_group: "가",
    row_fingerprint: H("f"),
    metric_value_literal: null,
    metric_value_json_type: null,
    metric_value_numeric: null,
    curation_fields: {},
    source_location: {},
  };
  return { key: [2026, "SYN-SCHOOL", "SYN-OLD", "SYN-METRIC", "SYN-OBS"], row, guide: null };
}
function entry(record: PublicCatalogRecord, kind: "guide" | "admission"): PublicKeyIndexEntry {
  return {
    key: record.key,
    sourceKind: kind,
    guide: null,
    nativeOfferingId: `${record.key[0]}:${record.key[2]}`,
    expectedFingerprint: kind === "guide" ? null : H("f"),
    search: {
      university: "synthetic university",
      department: "synthetic department",
      region: "",
      group: "가",
    },
  };
}
async function setup() {
  const defs: Record<string, string> = {
    admission_results_effective: "SELECT * FROM jungsi_data_ingest.admission_results",
    admission_results_source_current:
      "SELECT * FROM jungsi_data_ingest.admission_observation_registry, jungsi_data_ingest.admission_results_effective",
    admission_results_current:
      "SELECT * FROM jungsi_data_ingest.admission_results_source_current, jungsi_data_ingest.admission_observation_registry",
  };
  const names = [
    ...new Set([
      ...CURRENT_PUBLIC_METADATA_SEEDS.map((x) => x.split(".")[1]),
      ...Object.keys(defs),
    ]),
  ].sort();
  const metadata = names.map((relation) => {
    const view = !!defs[relation] || relation.includes("current");
    return {
      schema: "jungsi_data_ingest",
      relation,
      kind: view ? "v" : "r",
      rls: !view,
      force: !view,
      reloptions: view ? ["security_invoker=true"] : null,
      owner: false,
      readable: true,
      writable: false,
      anon_read: false,
      authenticated_read: false,
      definition: defs[relation] ?? (view ? "SELECT 1" : null),
      columns: [],
    };
  });
  const metaSha = await nativeJsonSha256(metadata), empty = await nativeJsonSha256([]);
  const commands = Object.fromEntries(
    CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((n) => [n, { count: 0, sha256: empty }]),
  );
  const head = { command_id: "SYN-COMMAND", payload_sha256: H("c") };
  const rows = [history(), guide(1), guide(2), guide(3)],
    historyEntries = [entry(rows[0], "admission")];
  const offerings = rows.slice(1).map((r) => entry(r, "guide")),
    lookups = [...historyEntries, ...offerings];
  const coverage = {
    scope: "all_eligible_current_db_observations_at_head" as const,
    review_receipt_sha256: H("e"),
    snapshot_sha256: await nativeJsonSha256({ history: historyEntries, offerings, lookups }),
    history_rows: historyEntries.length,
  };
  const prepared = await prepareCurrentPublicKeyIndexV3({
    history: historyEntries,
    offerings,
    lookups,
    metadataSha256: metaSha,
    guideCommandStateSha256: await nativeJsonSha256(commands),
    admissionHead: head,
    coverage,
    objectPrefix: "synthetic/keys/",
  });
  const descriptor: PublicCatalogDescriptor = {
    format: "jungsi.current-public-catalog-publication/v2",
    version: "SYN-V1",
    issued_at: "2026-10-18T00:00:00Z",
    expires_at: "2026-10-20T00:00:00Z",
    approval_reference_sha256: H("a"),
    consumer_binding_sha256: H("b"),
    metadata_sha256: metaSha,
    operations: ["history.search", "offerings.search", "offering.read", "recruitment.read"],
    source_views: {
      admissions: "jungsi_data_ingest.admission_results_current",
      offerings: "jungsi_data_ingest.guide_offerings_native_minimum3_current_v4",
      relations: "jungsi_data_ingest.guide_relations_native_minimum3_current_v4",
    },
    general_publication_allowed: true,
    nationwide_current: true,
    active_service_only: true,
    incomplete_metadata: "hold_per_observation",
    order: "academic_year_school_offering_metric_canonical_C",
    counts: "unknown",
    engine_activation: false,
    max_page_rows: 101,
    guide_command_state: commands,
    key_index: prepared.root,
    coverage_receipt_sha256: coverage.review_receipt_sha256,
    admission_head: head,
  };
  const state = {
    now: NOW,
    requests: 0,
    writes: 0,
    sql: 0,
    binding: 0,
    env: 0,
    failFetch: false,
    events: [] as unknown[],
  };
  const fakeFetch: typeof fetch = async (input) => {
    await Promise.resolve();
    state.requests++;
    const url = String(input);
    if (state.failFetch) return new Response(null, { status: 500 });
    let bytes: Uint8Array;
    if (url.includes("/bucket/")) {
      bytes = new TextEncoder().encode(
        JSON.stringify({ id: "synthetic-private", public: false, file_size_limit: 524288 }),
      );
    } else {
      const marker = "/object/authenticated/synthetic-private/", at = url.indexOf(marker);
      assert(at >= 0);
      const key = url.slice(at + marker.length).split("/").map(decodeURIComponent).join("/");
      const found = prepared.objects.get(key);
      assert(found);
      bytes = found;
    }
    const response = new Response(new Uint8Array(bytes).buffer, { status: 200 });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const tx: NativeSqlTransaction = {
    query: async (statement, parameters = []) => {
      await Promise.resolve();
      if (statement.startsWith("SET LOCAL")) return [];
      if (statement.startsWith("SELECT set_config")) return [[USER, "SYN-CLAIMS"]];
      if (statement === RUNTIME_ROLE_SQL) {
        return [[
          "jungsi_backend_app",
          false,
          false,
          "on",
          "on",
          false,
          false,
          false,
          "UTC",
        ]];
      }
      if (statement === CURRENT_PUBLIC_METADATA_SQL) {
        return metadata.map((
          m,
        ) => [
          m.schema,
          m.relation,
          m.kind,
          m.rls,
          m.force,
          m.reloptions === null ? null : JSON.stringify(m.reloptions),
          m.owner,
          m.readable,
          m.writable,
          m.anon_read,
          m.authenticated_read,
          m.definition,
          JSON.stringify(m.columns),
        ]);
      }
      if (
        statement === CURRENT_PUBLIC_GUIDE_COMMAND_SQL
      ) return CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((n) => [n, "[]"]);
      state.sql++;
      assert(statement.includes("public_bounded_physical"));
      assert(typeof parameters[0] === "string");
      const selected = JSON.parse(parameters[0]) as Array<{ key: unknown }>;
      const keys = new Set(selected.map((v) => JSON.stringify(v.key)));
      const result = rows.filter((r) => keys.has(JSON.stringify(r.key)));
      return [[
        JSON.stringify({ admission: { ...head, recorded_at: "2026-10-18T00:00:00Z" } }),
        "2026-10-19T00:00:00Z",
        JSON.stringify(result),
      ]];
    },
  };
  const pool: NativeSqlPool = {
    transaction: async <T>(readOnly: boolean, work: (x: NativeSqlTransaction) => Promise<T>) => {
      if (!readOnly) state.writes++;
      assert(readOnly);
      return await work(tx);
    },
    close: () => Promise.resolve(),
  };
  const binding = {
    descriptorSha256: H("b"),
    scopeSha256: H("9"),
    expiresAtUtc: NOW + 30_000_000_000n,
    consumerGeneration: "operating-admin-20",
    operations: [...COMBINED_POLICY_CONSUMER_OPERATION_IDS],
    readViews: {},
    projectUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    storage: {
      bucket: "synthetic-private",
      objectPrefix: "synthetic/keys/",
      secretKey: "sb_secret_SYNTHETIC_NOT_REAL",
      limits: {
        maxArtifactBytes: 524288,
        maxBucketBytes: 524288,
        maxMetadataBytes: 1024,
        requestTimeoutMs: 5000,
      },
    },
  } as unknown as ApprovedRuntimeBinding;
  const data = {
      getCatalog: () => Promise.resolve(null),
      getExamPack: () => Promise.reject(new Error("score map must remain disabled")),
      getConversion: () => Promise.reject(new Error("score map must remain disabled")),
    },
    clock = { nowUtc: () => state.now };
  const make = async (d: PublicCatalogDescriptor, original = false) => {
    const raw = nativeJsonText(d, true),
      sha = await publicKeyRawHash(new TextEncoder().encode(raw));
    const env = {
      get: (name: string) => {
        state.env++;
        return name === "JUNGSI_DISPLAY_CURSOR_KEY_HEX"
          ? "07".repeat(32)
          : name === "JUNGSI_CURRENT_PUBLIC_CATALOG_BINDING"
          ? raw
          : name === "JUNGSI_CURRENT_PUBLIC_CATALOG_BINDING_SHA256"
          ? sha
          : undefined;
      },
    };
    const context = {
      binding: () => {
        state.binding++;
        return Promise.resolve(binding);
      },
      controls: () => Promise.resolve({ fetcher: fakeFetch }),
      searchDiagnostic: (event: unknown) => {
        state.events.push(event);
      },
    };
    const factory = original ? originalFactory : scopedFactory;
    return factory(data, clock, () => new SupabaseSqlTransport(pool), env, context);
  };
  return { descriptor, state, make };
}
const ids = (v: NativeObject) => (v.items as NativeObject[]).map((r) => r.offering_id);

Deno.test("actual combined factory composes verified descriptor, index and SQL wire for two 2027 pages", async () => {
  const f = await setup(), firstService = await f.make(f.descriptor);
  const first = await firstService.execute(
    request("offerings.search", { academic_year: "2027", limit: "1" }),
  );
  assert(typeof first.next_cursor === "string");
  assert(!Object.hasOwn(first, "my_score_state"));
  for (const item of first.items as NativeObject[]) assert(!Object.hasOwn(item, "my_score"));
  equal(ids(first), ["2027:SYN-PK-1"]);
  const newer = { ...f.descriptor, version: "SYN-V2", issued_at: "2026-10-18T12:00:00Z" };
  const next = await (await f.make(newer)).execute(
    request("offerings.search", { academic_year: "2027", limit: "2", cursor: first.next_cursor }),
  );
  equal(ids(next), ["2027:SYN-PK-2", "2027:SYN-PK-3"]);
  equal(next.next_cursor, null);
  equal(f.state.writes, 0);
});
Deno.test("legacy-issued cursor keeps the previous behavior and changed range is rejected", async () => {
  const f = await setup(), old = await f.make(f.descriptor, true);
  const first = await old.execute(
    request("offerings.search", { academic_year: "2027", limit: "1" }),
  );
  assert(typeof first.next_cursor === "string");
  const newer = { ...f.descriptor, version: "SYN-V2" };
  const service = await f.make(newer);
  await denied(
    () =>
      service.execute(
        request("offerings.search", { academic_year: "2027", cursor: first.next_cursor as string }),
      ),
    "cursor_version_mismatch",
    409,
  );
});
Deno.test("history search uses the same approved factory and returns the synthetic 2026 observation", async () => {
  const f = await setup(), service = await f.make(f.descriptor);
  const result = await service.execute(request("history.search", { academic_year: "2026" }, false));
  equal((result.items as NativeObject[]).length, 1);
  equal(f.state.writes, 0);
});
Deno.test("non-search offering reads and prepareSelection remain on the existing service", async () => {
  const f = await setup(),
    current = await f.make(f.descriptor),
    old = await f.make(f.descriptor, true);
  equal(
    await current.execute(request("offering.read")),
    await old.execute(request("offering.read")),
  );
  const selected = {
    ...request("university.analyze"),
    body: { expected_version: 1, offering_ids: ["2027:SYN-PK-1"] },
  };
  current.prepareSelection(selected);
  const catalog = await current.catalog();
  assert(catalog);
  equal(catalog.offerings.length, 1);
  equal(catalog.offerings[0].offering_id, "2027:SYN-PK-1");
});
Deno.test("existing diagnostic emits the original failure phase and unauthorized search avoids IO", async () => {
  const f = await setup(), unauthorized = await f.make(f.descriptor);
  await denied(
    () => unauthorized.execute(request("offerings.search", {}, false)),
    "paid_required",
    403,
  );
  equal([f.state.requests, f.state.sql, f.state.env], [0, 0, 0]);
  f.state.failFetch = true;
  await denied(
    () => (f.make(f.descriptor).then((service) => service.execute(request("offerings.search")))),
    "current_catalog_key_index_unapproved",
    503,
  );
  assert(f.state.events.length === 1);
  const e = f.state.events[0] as Record<string, unknown>;
  equal([e.operation, e.phase, e.failure], [
    "offerings.search",
    "index_select",
    "index_unapproved",
  ]);
});

Deno.test("overlapping searches preserve independent original expiry caps", async () => {
  const f = await setup();
  const early = { ...f.descriptor, expires_at: "2026-10-19T00:00:10Z" };
  const later = { ...f.descriptor, expires_at: "2026-10-19T00:00:20Z" };
  const a = await (await f.make(early)).execute(
    request("offerings.search", { academic_year: "2027", limit: "1" }),
  );
  const b = await (await f.make(later)).execute(
    request("offerings.search", { academic_year: "2027", limit: "1" }),
  );
  assert(typeof a.next_cursor === "string" && typeof b.next_cursor === "string");
  const service = await f.make(later);
  const [ra, rb] = await Promise.all([
    service.execute(
      request("offerings.search", { academic_year: "2027", limit: "1", cursor: a.next_cursor }),
    ),
    service.execute(
      request("offerings.search", { academic_year: "2027", limit: "1", cursor: b.next_cursor }),
    ),
  ]);
  assert(typeof ra.next_cursor === "string" && typeof rb.next_cursor === "string");
  equal(ids(ra), ["2027:SYN-PK-2"]);
  equal(ids(rb), ["2027:SYN-PK-2"]);
  f.state.now = NOW + 11_000_000n;
  await denied(
    () =>
      service.execute(
        request("offerings.search", { academic_year: "2027", cursor: ra.next_cursor as string }),
      ),
    "invalid_cursor",
    400,
  );
  const page = await service.execute(
    request("offerings.search", { academic_year: "2027", cursor: rb.next_cursor as string }),
  );
  equal(ids(page), ["2027:SYN-PK-3"]);
});
Deno.test("HTTP relay and existing budget wrap the scoped factory search", async () => {
  const f = await setup(), service = await f.make(f.descriptor);
  const relay = "SYNTHETIC-RELAY-ONLY-" + "x".repeat(32), calls = { budget: 0, business: 0 };
  const ports = {
    relay: new RelayBoundary(relay),
    clock: { nowUtc: () => NOW },
    sessions: {
      verifyUserBearer: () =>
        Promise.resolve({ subjectId: USER, expiresAtUtc: NOW + 100_000_000n }),
    },
    passes: {
      readCurrent: (subjectId: string, evaluatedAtUtc: bigint) =>
        Promise.resolve({
          authority: "public.jeongsi_passes",
          metadataVerified: true,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: NOW + 100_000_000n,
        }),
    },
    reports: { lookupAccess: () => Promise.resolve(null) },
    authorities: { readCurrent: () => Promise.reject(new Error("unexpected")) },
    resources: { readScope: () => Promise.reject(new Error("unexpected")) },
    projection: { project: (_op: unknown, _tier: unknown, value: unknown) => value },
    budget: {
      run: async <T>(_req: unknown, work: (admission?: unknown) => Promise<T>): Promise<T> => {
        calls.budget++;
        return await work(Object.freeze({ synthetic: true }));
      },
    },
    business: {
      execute: (r: ApiExecution, boundary: { signal: AbortSignal; admission?: unknown }) => {
        calls.business++;
        assert(boundary.signal instanceof AbortSignal && boundary.admission !== undefined);
        return service.execute(r);
      },
    },
  } as unknown as ApiHttpPorts;
  const handler = createApiHandler(syntheticApiPolicies(), ports);
  const url = "https://synthetic.invalid/api/v1/offerings/search?academic_year=2027&limit=1";
  const withoutRelay = await handler(
    new Request(url, { headers: { authorization: "Bearer SYNTHETIC-user" } }),
  );
  equal(withoutRelay.status, 403);
  equal([calls.budget, calls.business, f.state.sql], [0, 0, 0]);
  const response = await handler(
    new Request(url, {
      headers: { authorization: "Bearer SYNTHETIC-user", "X-Jungsi-Relay-Token": relay },
    }),
  );
  equal(response.status, 200);
  equal([calls.budget, calls.business], [1, 1]);
  const result = await response.json();
  equal(result.items[0].offering_id, "2027:SYN-PK-1");
});
