/** Synthetic in-memory SQL transport; executes no real DB or Storage. */
import {
  createGuideSearchPageComposition,
  type GuideSearchAuthority,
} from "./current_2027_guide_search_review_only.ts";
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
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
  CURRENT_PUBLIC_METADATA_SEEDS,
  CURRENT_PUBLIC_METADATA_SQL,
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
      assert(statement.includes("public_bounded_physical"));
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

Deno.test("v8 uses the actual CurrentPublicCatalogSql search over a synthetic transaction", async () => {
  const f = await setup();
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
        query.limit === 10 && before === null && scanned.length === 1 && next === null &&
          head === catalogHead,
      );
      return Promise.resolve();
    },
    classifyGuideProjections: (_ctx, claims) =>
      Promise.resolve(claims.map((claim) => {
        assert(claim.rowFingerprint === "f".repeat(64));
        assert(claim.offering.university_name === "Synthetic University");
        return { target: claim.target, decision: "VERIFIED" as const };
      })),
    classifyGuideMembership: (_ctx, keys) =>
      Promise.resolve(keys.map((target) => ({ target, decision: "VERIFIED" as const }))),
    classifyTargets: (_ctx, keys) =>
      Promise.resolve(keys.map((target) => ({
        target,
        decision: "INCLUDE" as const,
        quota: {
          value: null,
          status: "pending_value_missing" as const,
          stage: "unknown" as const,
          unit: null,
          condition: "unknown" as const,
          condition_text: null,
          source_url: null,
          source_as_of: null,
        },
      }))),
    confirmExclusions: () => Promise.resolve([]),
    verifyRelations: () => Promise.resolve([]),
  };
  const clock = { nowUtc: () => NOW };
  const composition = createGuideSearchPageComposition(f.port, authority, {
    decode: () => {
      throw new Error("unexpected decode");
    },
    encode: () => {
      throw new Error("unexpected encode");
    },
  }, clock);
  const service = new HistoryCurrentPageService(
    {
      authority: composition.authority,
      offerings: composition.offerings,
      histories: { read: (_ctx, keys) => Promise.resolve({ claims: [], complete_targets: keys }) },
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
  const offering = items[0].offering as Record<string, unknown>;
  const recruitment = items[0].recruitment as Record<string, unknown>;
  assert(items.length === 1 && offering.offering_id === "2027:SYNTHETIC-PK");
  assert(recruitment.value === null && recruitment.status === "pending_value_missing");
  assert(
    f.state.admitted && f.state.selects === 1 && f.state.business === 1 &&
      f.state.transactions === 1,
  );
  assert(f.state.writes === 0);
});
