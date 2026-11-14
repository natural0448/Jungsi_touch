/** Synthetic in-memory SQL transport; executes no real DB or Storage. */
import { type GuideSearchAuthority } from "./current_2027_guide_search_review_only.ts";
import { createP1DirectGuideComposition } from "./current_2027_guide_direct_review_only.ts";
import {
  type CurrentPagePins,
  HistoryCurrentPageService,
} from "./jungsi/application/history_current_page.ts";
/** Positional SQL adapter tests: synthetic rows only, native transaction guards retained. */
import { nativeJsonSha256 } from "./jungsi/domain/json_value.ts";
import { utcInstant } from "./jungsi/domain/time.ts";
import {
  type NativeSqlPool,
  type NativeSqlTransaction,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "./jungsi/infrastructure/transaction_sql.ts";
import {
  buildCurrentPublicP1DirectOfferingsSql,
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
  CURRENT_PUBLIC_METADATA_SEEDS,
  CURRENT_PUBLIC_METADATA_SQL,
  CURRENT_PUBLIC_OFFERINGS_SQL,
  CurrentPublicCatalogSql,
  type PublicCatalogDescriptor,
} from "./current_public_catalog_sql.ts";
import { type PublicCatalogRecord, type PublicPreparedKeyPage } from "./current_public_catalog.ts";
function assert(x: unknown, message = "assertion_failed"): asserts x {
  if (!x) throw new Error(message);
}
const NOW = utcInstant("2026-10-19T00:00:00Z"),
  SUBJECT = "00000000-0000-0000-0000-000000000001";
async function setup() {
  const syntheticDefinitions: Record<string, string> = {
    admission_results_effective: "SELECT * FROM jungsi_data_ingest.admission_results",
    admission_results_source_current:
      "SELECT * FROM jungsi_data_ingest.admission_observation_registry, jungsi_data_ingest.admission_results_effective",
    admission_results_current:
      "SELECT * FROM jungsi_data_ingest.admission_results_source_current, jungsi_data_ingest.admission_observation_registry",
  };
  const names = [
    ...new Set([
      ...CURRENT_PUBLIC_METADATA_SEEDS.map((x) => x.split(".")[1]),
      ...Object.keys(syntheticDefinitions),
    ]),
  ].sort();
  const metadata = names.map((relation) => {
    const view = !!syntheticDefinitions[relation] ||
      relation.includes("current");
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
      definition: syntheticDefinitions[relation] ?? (view ? "SELECT 1" : null),
      columns: [],
    };
  });
  const commandHash = await nativeJsonSha256([]),
    admissionHead = {
      command_id: "SYNTHETIC-COMMAND",
      payload_sha256: "c".repeat(64),
    };
  const descriptor: PublicCatalogDescriptor = {
    format: "jungsi.current-public-catalog-publication/v2",
    version: "SYNTHETIC",
    issued_at: "2026-10-18T00:00:00Z",
    expires_at: "2026-10-20T00:00:00Z",
    approval_reference_sha256: "a".repeat(64),
    consumer_binding_sha256: "b".repeat(64),
    metadata_sha256: await nativeJsonSha256(metadata),
    operations: [
      "history.search",
      "offerings.search",
      "offering.read",
      "recruitment.read",
    ],
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
    guide_command_state: Object.fromEntries(
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map(
        (n) => [n, { count: 0, sha256: commandHash }],
      ),
    ),
    key_index: {
      object_key: "SYNTHETIC/keys.json",
      bytes: 100,
      sha256: "d".repeat(64),
    },
    coverage_receipt_sha256: "e".repeat(64),
    admission_head: admissionHead,
  };
  const guide = {
    release_id: "SYNTHETIC-RELEASE",
    academic_year: 2027,
    school_id: "SYNTHETIC-SCHOOL",
    offering_pk: "SYNTHETIC-PK",
    offering_id: "2027:SYNTHETIC-PK",
    source_kind: "current_guide",
    university: "Synthetic University",
    department: "Synthetic Department",
    track: "Synthetic Track",
    recruit_group: "A",
    campus: "Synthetic Campus",
    location: "Synthetic Region",
    active_service: true,
    practical_required: false,
  };
  const record: PublicCatalogRecord = {
    key: [2027, "SYNTHETIC-SCHOOL", "SYNTHETIC-PK", "", "2027:SYNTHETIC-PK"],
    row: { ...guide, row_fingerprint: "f".repeat(64) },
    guide,
  };
  const selected: PublicPreparedKeyPage = {
    keys: [{
      key: record.key,
      sourceKind: "guide",
      guide: null,
      nativeOfferingId: "SYNTHETIC-PK",
      expectedFingerprint: "f".repeat(64),
    }],
    nextAfter: null,
    admissionHead,
    coverage: "all_eligible_current_db_observations_at_head",
    indexSha256: "d".repeat(64),
  };
  const state = {
    head: { ...admissionHead, recorded_at: "2026-10-18T00:00:00Z" },
    rows: [record],
    writes: 0,
    business: 0,
    selects: 0,
    admitted: false,
    transactions: 0,
    configured: [] as string[],
    parameters: [] as readonly unknown[],
  };
  const tx: NativeSqlTransaction = {
    query: async (statement, parameters = []) => {
      await Promise.resolve(); // Keep fake SQL asynchronous like the native driver.
      if (statement.startsWith("SET LOCAL")) {
        state.configured.push(statement);
        return [];
      }
      if (statement.startsWith("SELECT set_config")) {
        return [[SUBJECT, "SYNTHETIC-CLAIMS"]];
      }
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
        return metadata.map(
          (m) => [
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
          ],
        );
      }
      if (statement === CURRENT_PUBLIC_GUIDE_COMMAND_SQL) {
        return CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((n) => [n, "[]"]);
      }
      state.business++;
      assert(statement.includes("guide_offerings_native_minimum3_current_v4"));
      state.parameters = parameters;
      assert(statement === buildCurrentPublicP1DirectOfferingsSql());
      assert(!statement.includes("public_registered_headers"));
      return [[
        JSON.stringify({ admission: state.head }),
        "2026-10-19T00:00:00Z",
        JSON.stringify(state.rows),
      ]];
    },
  };
  const pool: NativeSqlPool = {
    transaction: async <T>(
      readOnly: boolean,
      work: (tx: NativeSqlTransaction) => Promise<T>,
    ) => {
      assert(state.admitted);
      state.transactions++;
      if (!readOnly) state.writes++;
      assert(readOnly);
      return await work(tx);
    },
    close: () => Promise.resolve(),
  };
  const port = new CurrentPublicCatalogSql(
    new SupabaseSqlTransport(pool),
    () =>
      Promise.resolve({
        descriptor,
        publication: {
          version: "SYNTHETIC",
          sha256: "a".repeat(64),
          expiresAtUtc: NOW + 3_600_000_000n,
        },
      }),
    { nowUtc: () => NOW },
    {
      select: (kind, q) => {
        assert(kind === "offerings" && q.academic_year === 2027 && q.limit === 10);
        state.selects++;
        return Promise.resolve(selected);
      },
      resolve: () => Promise.reject(new Error("N+1 lookup")),
    },
  );
  return { port, record, state, selected, descriptor };
}

Deno.test("direct view P1 uses real SQL adapter with synthetic transaction and no key index", async () => {
  const f = await setup();
  // A false raw practical flag is not review evidence. The first target remains
  // HOLD; the second represents an independently rebound existing O result.
  const second: PublicCatalogRecord = {
    key: [2027, "SYNTHETIC-SCHOOL", "SYNTHETIC-PK-2", "", "2027:SYNTHETIC-PK-2"],
    row: {
      ...f.record.row,
      release_id: "SYNTHETIC-RELEASE-2",
      offering_pk: "SYNTHETIC-PK-2",
      offering_id: "2027:SYNTHETIC-PK-2",
      quota_value: 0,
      quota_literal_state: "numeric_literal",
      metadata: {
        quota_stage: "initial",
        source_url: "https://university.example/guide",
        source_as_of: "2026-10-01",
      },
    },
    guide: {
      ...f.record.guide!,
      release_id: "SYNTHETIC-RELEASE-2",
      offering_pk: "SYNTHETIC-PK-2",
      offering_id: "2027:SYNTHETIC-PK-2",
    },
  };
  f.state.rows = [f.record, second];
  const catalogHead = await nativeJsonSha256({
    metadata: f.descriptor.metadata_sha256,
    guide_commands: f.descriptor.guide_command_state,
    head: { admission: f.state.head },
  });
  const pins: CurrentPagePins = {
    subject: SUBJECT,
    snapshot_id: "synthetic-snapshot",
    snapshot_publication_sha256: "1".repeat(64),
    snapshot_source_head_sha256: "2".repeat(64),
    snapshot_scope_sha256: "3".repeat(64),
    guide_publication_sha256: "a".repeat(64),
    guide_head_sha256: "4".repeat(64),
    decision_scope_sha256: "5".repeat(64),
    expires_at_utc: NOW + 1_000_000_000n,
  };
  assert(catalogHead !== pins.guide_head_sha256);
  const authority: GuideSearchAuthority = {
    authorizeBeforeBegin: () => {
      f.state.admitted = true;
    },
    authorizeBeforeIO: () => {},
    begin: () => Promise.resolve(pins),
    assertCurrent: () => Promise.resolve(),
    assertCatalogBinding: (_ctx, pub, actual) => {
      assert(pub === pins.guide_publication_sha256 && actual === catalogHead);
    },
    assertScanCoverage: (_ctx, query, before, scanned, next, head) => {
      assert(
        query.limit === 10 && before === null && scanned.length === 2 && next === null &&
          head === catalogHead,
      );
      return Promise.resolve();
    },
    verifyGuideScope: (_ctx, claims) =>
      Promise.resolve(claims.map(({ target }) => ({
        target,
        enrollment: "CONFIRMED" as const,
        practical: "NON_PRACTICAL" as const,
      }))),
    classifyGuideProjections: (_ctx, claims) =>
      Promise.resolve(claims.map((claim) => {
        assert(claim.rowFingerprint === "f".repeat(64));
        assert(claim.offering.university_name === "Synthetic University");
        assert(claim.rawQuota.conditionText.state === "missing");
        if (claim.target.offering_pk === "SYNTHETIC-PK-2") {
          assert(claim.rawQuota.value.state === "present" && claim.rawQuota.value.value === 0);
          assert(
            claim.rawQuota.stage.state === "present" && claim.rawQuota.stage.value === "initial",
          );
        }
        return { target: claim.target, decision: "VERIFIED" as const };
      })),
    classifyGuideMembership: (_ctx, keys) =>
      Promise.resolve(keys.map((target) => ({ target, decision: "VERIFIED" as const }))),
    classifyTargets: (_ctx, keys) =>
      Promise.resolve(
        keys.map((target) =>
          target.offering_pk === "SYNTHETIC-PK"
            ? ({ target, decision: "HOLD" as const, quota: null })
            : ({
              target,
              decision: "INCLUDE" as const,
              quota: {
                value: 0,
                status: "verified_official" as const,
                stage: "initial" as const,
                unit: "명",
                condition: "unknown" as const,
                condition_text: null,
                source_url: "https://university.example/guide",
                source_as_of: "2026-10-01",
              },
            })
        ),
      ),
    confirmExclusions: () => Promise.resolve([]),
    verifyRelations: () => Promise.resolve([]),
  };
  const clock = { nowUtc: () => NOW };
  const composition = createP1DirectGuideComposition(
    f.port,
    authority,
    {
      decode: () => {
        throw new Error("unexpected decode");
      },
      encode: () => {
        throw new Error("unexpected encode");
      },
    },
    clock,
    {
      authorizeBeforeBegin: () => {
        f.state.admitted = true;
      },
      authorizeBeforeIO: (_ctx, query) => {
        assert(query.academic_year === 2027 && query.limit === 10);
      },
    },
  );
  const service = new HistoryCurrentPageService(
    {
      authority: composition.authority,
      offerings: composition.offerings,
      histories: { read: (_ctx, keys) => Promise.resolve({ claims: [], complete_targets: keys }) },
      recruitment_evidence: {
        verify: (_ctx, decisions) =>
          Promise.resolve(decisions.map(({ target }) => ({
            target,
            finality: "pending" as const,
            carryover_status: "unresolved" as const,
          }))),
      },
      cursors: {
        open: () => Promise.reject(new Error("unexpected")),
        seal: () => Promise.reject(new Error("unexpected")),
      },
    },
    clock,
    {
      max_cursor_chars: 512,
      max_position_chars: 256,
      max_text_chars: 256,
      max_history_claims: 500,
      max_metrics_per_claim: 20,
      max_result_bytes: 1000000,
    },
  );
  const result = await service.execute({
    operation: "history.current-page",
    session: {
      user: { subjectId: SUBJECT, expiresAtUtc: NOW + 2_000_000_000n },
      evaluatedAtUtc: NOW,
      tier: "standard",
      paidUntilUtc: null,
    },
    query: { limit: "10" },
  }, { signal: new AbortController().signal, admission: Object.freeze({ synthetic: true }) });
  const items = result.items as Array<Record<string, unknown>>;
  const offering = items[1].offering as Record<string, unknown>;
  const recruitment = items[1].recruitment as Record<string, unknown>;
  assert(items.length === 2 && items[0].status === "pending" && items[0].offering === null);
  assert(offering.offering_id === "2027:SYNTHETIC-PK-2");
  assert(recruitment.value === 0 && recruitment.stage === "initial");
  assert(recruitment.carryover_status === "unresolved" && recruitment.condition_text === null);
  const source = recruitment.source_quota as Record<string, unknown>;
  assert(
    source.quota_value === 0 && source.quota_literal_state === "numeric_literal" &&
      source.quota_stage === "initial",
  );
  assert(!Object.hasOwn(source, "quota_condition_text"));
  assert(
    f.state.admitted && f.state.selects === 0 && f.state.business === 1 &&
      f.state.transactions === 1,
  );
  assert(f.state.writes === 0);
  assert(f.state.parameters[0] === 2027 && f.state.parameters[10] === 11);
  assert(!buildCurrentPublicP1DirectOfferingsSql().includes("IS DISTINCT FROM 'true'::jsonb"));
  assert(buildCurrentPublicP1DirectOfferingsSql().includes("'row_fingerprint',g.row_sha256"));
});

Deno.test("direct query requires physical access proof before any SQL transaction", async () => {
  const f = await setup();
  const context = {
    execution: { operation: "history.current-page", session: { user: { subjectId: SUBJECT } } },
    boundary: { signal: new AbortController().signal, admission: {} },
  } as unknown as import("./jungsi/application/history_current_page.ts").CurrentPagePortContext;
  const q = {
    academic_year: 2027,
    university_q: "",
    department_q: "",
    region: "",
    group: "",
    limit: 10,
    cursor: null,
  };
  for (
    const guard of [null, {
      authorizeBeforeBegin: () => {},
      authorizeBeforeIO: () => {
        throw new Error("no verified physical access");
      },
    }, {
      authorizeBeforeBegin: () => {},
      authorizeBeforeIO: () => false as unknown as void,
    }]
  ) {
    let rejected = false;
    try {
      await f.port.searchDirect2027Offerings(context, q, null, guard);
    } catch {
      rejected = true;
    }
    assert(rejected && f.state.transactions === 0 && f.state.selects === 0);
  }
});

Deno.test("direct query binds exact keyset and 101 maximum parameters", async () => {
  const f = await setup();
  f.state.admitted = true;
  const context = {
    execution: { operation: "history.current-page", session: { user: { subjectId: SUBJECT } } },
    boundary: { signal: new AbortController().signal, admission: {} },
  } as unknown as import("./jungsi/application/history_current_page.ts").CurrentPagePortContext;
  const q = {
    academic_year: 2027,
    university_q: "",
    department_q: "",
    region: "",
    group: "",
    limit: 100,
    cursor: null,
  };
  const before: [number, string, string, string, string] = [
    2027,
    "SYNTHETIC-SCHOOL",
    "A",
    "",
    "2027:A",
  ];
  const guard = { authorizeBeforeBegin: () => {}, authorizeBeforeIO: () => {} };
  await f.port.searchDirect2027Offerings(context, q, before, guard);
  assert(f.state.selects === 0 && f.state.business === 1 && f.state.parameters.length === 11);
  assert(f.state.parameters[0] === 2027 && f.state.parameters[5] === 2027);
  assert(f.state.parameters[6] === "SYNTHETIC-SCHOOL" && f.state.parameters[7] === "A");
  assert(f.state.parameters[10] === 101);
});

Deno.test("direct query rejects accessor cursors without invoking getters or SQL", async () => {
  const f = await setup();
  const context = {
    execution: { operation: "history.current-page", session: { user: { subjectId: SUBJECT } } },
    boundary: { signal: new AbortController().signal, admission: {} },
  } as unknown as import("./jungsi/application/history_current_page.ts").CurrentPagePortContext;
  const q = {
    academic_year: 2027,
    university_q: "",
    department_q: "",
    region: "",
    group: "",
    limit: 10,
    cursor: null,
  };
  const before: [number, string, string, string, string] = [
    2027,
    "SYNTHETIC-SCHOOL",
    "A",
    "",
    "2027:A",
  ];
  let invoked = false;
  Object.defineProperty(before, "2", {
    get: () => {
      invoked = true;
      return "A";
    },
  });
  const guard = { authorizeBeforeBegin: () => {}, authorizeBeforeIO: () => {} };
  let rejected = false;
  try {
    await f.port.searchDirect2027Offerings(context, q, before, guard);
  } catch {
    rejected = true;
  }
  assert(rejected && !invoked && f.state.transactions === 0);
});

Deno.test("invalid future base SQL fails only when the optional direct builder is invoked", async () => {
  const original = CURRENT_PUBLIC_OFFERINGS_SQL;
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(original))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  assert(hash === "bb8bb610607a578930aee5564153db574f1b9f098c01a3164bbc27da7d8d7b80");
  let rejected = false;
  try {
    buildCurrentPublicP1DirectOfferingsSql("future incompatible SQL");
  } catch {
    rejected = true;
  }
  assert(rejected && CURRENT_PUBLIC_OFFERINGS_SQL === original);
  assert(original.includes("guide_offerings_native_minimum3_current_v4"));
});
