/** Positional SQL adapter tests: synthetic rows only, native transaction guards retained. */
import { AccessError } from "./jungsi/application/access.ts";
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
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
import {
  parsePublicCatalogQuery,
  type PublicCatalogRecord,
  type PublicPreparedKeyPage,
} from "./current_public_catalog.ts";
function assert(x: unknown, message = "assertion_failed"): asserts x {
  if (!x) throw new Error(message);
}
function equal(a: unknown, b: unknown): void {
  assert(nativeJsonText(a, true) === nativeJsonText(b, true), "not_equal");
}
async function denied(
  run: () => Promise<unknown>,
  code: string,
  http: number,
): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal([error.code, error.http], [code, http]);
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
  const record: PublicCatalogRecord = {
    key: [
      2024,
      "SYNTHETIC-SCHOOL",
      "SYNTHETIC-PK",
      "SYNTHETIC-METRIC",
      "SYNTHETIC-OBS",
    ],
    row: {
      academic_year: 2024,
      school_id: "SYNTHETIC-SCHOOL",
      offering_pk: "SYNTHETIC-PK",
      metric_kind: "SYNTHETIC-METRIC",
      canonical_result_id: "SYNTHETIC-OBS",
      active_service: true,
      row_fingerprint: "f".repeat(64),
      metric_value_literal: "0",
      metric_value_json_type: "integer",
      metric_value_numeric: "0",
      curation_fields: {},
      source_location: {},
    },
    guide: null,
  };
  const selected: PublicPreparedKeyPage = {
    keys: [{
      key: record.key,
      sourceKind: "admission",
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
      if (!readOnly) state.writes++;
      assert(readOnly);
      return await work(tx);
    },
    close: async () => {},
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
    { select: () => Promise.resolve(selected), resolve: () => Promise.resolve(selected) },
  );
  return { port, record, state, selected, descriptor };
}
Deno.test("prepared SQL uses one bounded value query under original UTC RLS read-only 5-second guard", async () => {
  const f = await setup(),
    page = await f.port.search(
      SUBJECT,
      "history",
      parsePublicCatalogQuery({ limit: "100" }),
      null,
    );
  equal(page.rows, [f.record]);
  equal(f.state.business, 1);
  equal(f.state.writes, 0);
  assert(f.state.configured.includes("SET LOCAL statement_timeout='5000ms'"));
  const parameter = f.state.parameters[0];
  assert(typeof parameter === "string");
  assert(!parameter.includes("metric_value"));
  equal(JSON.parse(parameter).length, 1);
});
Deno.test("prepared SQL rejects a missing or substituted current observation instead of silently omitting it", async () => {
  for (const variant of ["missing", "substituted"]) {
    const f = await setup();
    if (variant === "missing") f.state.rows = [];
    else {f.record.key = [
        2024,
        "SYNTHETIC-SCHOOL",
        "SYNTHETIC-PK",
        "SYNTHETIC-METRIC",
        "SYNTHETIC-OTHER",
      ];}
    await denied(
      () => f.port.search(SUBJECT, "history", parsePublicCatalogQuery({}), null),
      "current_catalog_state_unapproved",
      503,
    );
  }
});
Deno.test("prepared SQL source-head drift returns 503 first and 409 for an existing cursor", async () => {
  for (const resumed of [false, true]) {
    const f = await setup();
    f.state.head.command_id = "SYNTHETIC-OTHER";
    await denied(
      () =>
        f.port.search(
          SUBJECT,
          "history",
          parsePublicCatalogQuery({}),
          resumed ? [2024, "", "", "", ""] : null,
        ),
      resumed ? "cursor_version_mismatch" : "current_catalog_state_unapproved",
      resumed ? 409 : 503,
    );
  }
});
Deno.test("prepared SQL rejects changed original fingerprints even if the key still exists", async () => {
  const f = await setup();
  f.record.row.row_fingerprint = "0".repeat(64);
  await denied(
    () => f.port.search(SUBJECT, "history", parsePublicCatalogQuery({}), null),
    "current_catalog_state_unapproved",
    503,
  );
});
Deno.test("prepared SQL checks pinned schema and guide command state before any value query", async () => {
  const f = await setup();
  f.descriptor.metadata_sha256 = "0".repeat(64);
  await denied(
    () => f.port.search(SUBJECT, "history", parsePublicCatalogQuery({}), null),
    "current_catalog_state_unapproved",
    503,
  );
  equal(f.state.business, 0);
});
Deno.test("prepared SQL retains sparse metadata continuation instead of returning a false end", async () => {
  const f = await setup();
  f.state.rows = [];
  f.selected.keys = [];
  f.selected.nextAfter = [
    2024,
    "SYNTHETIC-SCHOOL",
    "SYNTHETIC-PK",
    "SYNTHETIC-METRIC",
    "SYNTHETIC-OBS",
  ];
  const page = await f.port.search(
    SUBJECT,
    "history",
    parsePublicCatalogQuery({}),
    null,
  );
  equal(page.rows, []);
  equal(page.nextAfter, f.selected.nextAfter);
});
