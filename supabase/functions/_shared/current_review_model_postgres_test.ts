/** Synthetic SQL-port contract tests; PostgreSQL execution, TLS handshake and RLS enforcement are NOT_RUN. */
import {
  createReadModelSqlInfrastructure, READ_MODEL_METADATA_SQL, READ_MODEL_PAGE_SQL,
  REVIEW_MODEL_RELATIONS, REVIEW_MODEL_SCHEMA,
} from "./current_review_model_postgres.ts";
import type { ReadModelSqlOptions, ReadModelSqlSettings } from "./current_review_model_postgres.ts";
import { ANCESTRY, BINDING, bytesHex, encodeRecord, ReadModelError, ROOT, SEAL } from "./current_review_model_codec.ts";
import { currentReviewSha256, parseCurrentReviewQuery } from "./current_admission_review.ts";
import { validateCurrentKey } from "./current_admission_display.ts";
import type { CurrentKey } from "./current_admission_display.ts";
import type { Json } from "./official_history_display.ts";
import { assert, equal, rejects, rejectsSync, SYNTHETIC_BUDGET, SYNTHETIC_HASH } from "./current_review_model_codec_test.ts";
import type { SyntheticObject as Obj } from "./current_review_model_codec_test.ts";
import {
  clone, createSyntheticRuntimeFixture, SYNTHETIC_NOW, SYNTHETIC_REVIEWER,
} from "./current_review_model_validation_test.ts";
import type { SyntheticRuntimeFixture } from "./current_review_model_validation_test.ts";

const SETTINGS: ReadModelSqlSettings = {
  databaseUrl: "postgresql://synthetic-user:synthetic-password@db.synthetic.invalid/synthetic-db",
  databaseCa: "-----BEGIN CERTIFICATE-----\nSYNTHETIC-CERTIFICATE-FIXTURE-NOT-A-CERTIFICATE\n-----END CERTIFICATE-----",
  supabaseUrl: "https://synthetic.invalid", publishableKey: "synthetic-publishable-key-fixture-only",
  storageSecret: "synthetic-storage-credential-fixture-only", descriptorBucket: "synthetic-private-review",
  descriptorPath: "synthetic/descriptor.json", descriptorSha256: SYNTHETIC_HASH, descriptorBytes: 1, budget: SYNTHETIC_BUDGET,
};
function metadataFixture(): Obj[] {
  const source: [string, string][] = [["admission_results_current", "v"], ["admission_result_source_members", "v"],
    ["admission_result_population_links_current", "v"], ["admission_observation_commands", "r"]];
  const rows = [...source.map(([relation, kind]) => ({ schema: "jungsi_data_ingest", relation, kind })),
    ...REVIEW_MODEL_RELATIONS.map((relation) => ({ schema: REVIEW_MODEL_SCHEMA, relation, kind: "r" }))];
  return rows.sort((a, b) => (a.schema + "." + a.relation).localeCompare(b.schema + "." + b.relation)).map((row) => ({
    ...row, columns: [{ name: "synthetic_column", type: "text", not_null: false }],
    reloptions: row.kind === "v" ? ["security_invoker=true", "security_barrier=true"] : null,
    definition: row.kind === "v" ? "SELECT synthetic_value FROM synthetic_fixture" : null,
    rls: row.kind === "r", force: row.kind === "r", owner: false, readable: true, writable: false,
    anon_read: false, authenticated_read: false, triggers: [], policies: [],
    grant_helper: { security_definer: false, owner: false, app_execute: true, anon_execute: false,
      authenticated_execute: false, config: ["search_path=pg_catalog,jungsi_review_read_model"], definition: "synthetic only" },
  }));
}
interface CapturedCall { sql: string; parameters: unknown[] }
interface SqlFixture {
  fixture: SyntheticRuntimeFixture; metadata: Obj[]; role: Obj; calls: CapturedCall[]; events: string[];
  sqlOptions: Obj | null; transactions: string[]; options: ReadModelSqlOptions;
  payload(qLimit?: number, after?: CurrentKey | null): Obj;
}
async function createSqlFixture(count = 2): Promise<SqlFixture> {
  const fixture = await createSyntheticRuntimeFixture(count), metadata = metadataFixture();
  fixture.descriptor.model_metadata_sha256 = await currentReviewSha256(metadata as unknown as Json);
  const calls: CapturedCall[] = [], events: string[] = [], transactions: string[] = [];
  const role: Obj = { current_user: "jungsi_backend_app", rolsuper: false, rolbypassrls: false,
    row_security: "on", read_only: "on", owner_member: false, owner_usage: false, postgres_member: false };
  const result: SqlFixture = { fixture, metadata, role, calls, events, transactions, sqlOptions: null, options: undefined as unknown as ReadModelSqlOptions,
    payload(qLimit = 100, after = null) {
      const d = fixture.descriptor, q = parseCurrentReviewQuery(new URL(`https://synthetic.invalid/?limit=${qLimit}`));
      const raw = fixture.rawPage(q, after);
      return { root_hex: bytesHex(encodeRecord(ROOT, d.root, SYNTHETIC_BUDGET)),
        binding_hex: bytesHex(encodeRecord(BINDING, d.binding, SYNTHETIC_BUDGET)),
        seal_hex: bytesHex(encodeRecord(SEAL, d.seal, SYNTHETIC_BUDGET)),
        ancestry_hex: bytesHex(encodeRecord(ANCESTRY, d.ancestry, SYNTHETIC_BUDGET)),
        admitted: [{ depth: 0, batch_id: d.root.batch_id, manifest_sha256: null,
          root_hex: bytesHex(encodeRecord(ROOT, d.root, SYNTHETIC_BUDGET)) }],
        command_id: (d.binding.source_state as Obj).command_id, payload_sha256: (d.binding.source_state as Obj).payload_sha256,
        grant_not_before: d.approval.issued_at, grant_expires_at: d.approval.expires_at,
        as_of: raw.asOf, observation_count: raw.matchingObservationCount, school_count: raw.matchingSourceSchoolCount, rows: raw.rows };
    } };
  const tx = { async unsafe(sql: string, parameters: unknown[] = []) {
    calls.push({ sql, parameters: clone(parameters) });
    if (sql === READ_MODEL_METADATA_SQL) { events.push("metadata"); return clone(metadata); }
    if (sql === READ_MODEL_PAGE_SQL) { events.push("payload"); return [result.payload(Number(parameters[18]) - 1,
      parameters[16] === null ? null : validateCurrentKey([Number(parameters[16]), "CURRENT_REVIEW", "CANONICAL_OBSERVATIONS", "", String(parameters[17])]))]; }
    if (sql.includes("pg_catalog.pg_roles")) { events.push("role"); return [clone(role)]; }
    if (sql.includes("admission_observation_commands")) { events.push("journal"); return [{ command_id: (fixture.descriptor.binding.source_state as Obj).command_id,
      payload_sha256: (fixture.descriptor.binding.source_state as Obj).payload_sha256 }]; }
    events.push("local-setting"); return [];
  } };
  const sqlFactory: NonNullable<ReadModelSqlOptions["sqlFactory"]> = ((_url: string, sqlOptions: unknown) => {
    result.sqlOptions = sqlOptions as Obj;
    return { async begin(mode: string, fn: (transaction: unknown) => Promise<unknown>) { transactions.push(mode); events.push("begin"); return await fn(tx); } };
  }) as unknown as NonNullable<ReadModelSqlOptions["sqlFactory"]>;
  result.options = { issuerKeys: fixture.authority.issuerKeys, evidenceTrust: fixture.authority.policy,
    resolveEvidenceBatch: async (refs) => refs.map((ref) => { const bytes = fixture.authority.bytes.get(ref.sha256 as string); assert(bytes); return bytes; }),
    sourceState: { async qualifySnapshot(transaction, expected) { assert(transaction === tx as unknown, "freshness must use the same RR transaction");
      events.push("freshness"); return clone(expected); } }, sqlFactory,
    fetcher: (async () => { throw new Error("synthetic network forbidden"); }) as typeof fetch,
    now: () => SYNTHETIC_NOW, environment: "local_verification" };
  return result;
}

Deno.test("RM provider: metadata/freshness then one bounded bulk payload in RR read-only UTC 5s snapshot", async () => {
  const f = await createSqlFixture(140), ports = createReadModelSqlInfrastructure(SETTINGS, f.options);
  const q = parseCurrentReviewQuery(new URL("https://synthetic.invalid/?limit=100"));
  const page = await ports.readPage(f.fixture.descriptor, q, null, SYNTHETIC_REVIEWER);
  equal(f.transactions, ["isolation level repeatable read read only"]);
  equal(f.calls.filter((call) => call.sql === READ_MODEL_PAGE_SQL).length, 1, "page bytes/proofs must be one bulk request");
  assert(f.events.indexOf("role") < f.events.indexOf("metadata"));
  assert(f.events.indexOf("metadata") < f.events.indexOf("freshness"));
  assert(f.events.indexOf("freshness") < f.events.indexOf("payload"), "source/coverage/fence qualification must precede payload SQL");
  assert(f.calls.some((call) => call.sql === "SET LOCAL TIME ZONE 'UTC'"));
  assert(f.calls.some((call) => call.sql === "SET LOCAL statement_timeout='5000ms'"));
  const call = f.calls.find((call) => call.sql === READ_MODEL_PAGE_SQL)!;
  equal(call.parameters.length, 20); equal(call.parameters[18], 101); equal(call.parameters[8], "[2024,2025,2026,2027]");
  equal(call.parameters[19], f.fixture.descriptor.approval.approval_id);
  const metadata = f.calls.find((entry) => entry.sql === READ_MODEL_METADATA_SQL)!;
  assert(typeof metadata.parameters[0] === "string"); equal(JSON.parse(metadata.parameters[0] as string).length, 10);
  equal(page.rows.length, 101); equal(page.matchingObservationCount, "140"); equal(page.matchingSourceSchoolCount, "2");
  equal(page.currentSourceState, f.fixture.descriptor.binding.source_state);
  const ssl = f.sqlOptions!.ssl as Obj; equal(ssl.rejectUnauthorized, true); equal(ssl.ca, SETTINGS.databaseCa);
  equal(f.sqlOptions!.prepare, false); equal(f.sqlOptions!.max, 1); equal(f.sqlOptions!.connect_timeout, 5);
  equal(f.sqlOptions!.fetch_types, false); equal(f.sqlOptions!.debug, false);
});

Deno.test("RM provider: source qualification failure or changed dependency state denies before payload SQL", async () => {
  for (const mode of ["throw", "wrong-state"]) {
    const f = await createSqlFixture();
    f.options.sourceState = { async qualifySnapshot(_tx, expected) { f.events.push("freshness-denied");
      if (mode === "throw") throw new ReadModelError("current_review_model_state_unapproved");
      return { ...clone(expected), completeness_state_sha256: "ee".repeat(32) }; } };
    const ports = createReadModelSqlInfrastructure(SETTINGS, f.options);
    await rejects(() => ports.readPage(f.fixture.descriptor, parseCurrentReviewQuery(new URL("https://synthetic.invalid/")), null, SYNTHETIC_REVIEWER));
    equal(f.calls.filter((call) => call.sql === READ_MODEL_PAGE_SQL).length, 0, "no count/data payload is read before fresh qualification");
  }
});

Deno.test("RM provider: app role, no owner/bypass/write/public access, forced RLS and metadata pin are mandatory", async () => {
  for (const mutate of [
    (f: SqlFixture) => { f.role.rolsuper = true; }, (f: SqlFixture) => { f.role.rolbypassrls = true; },
    (f: SqlFixture) => { f.role.owner_member = true; }, (f: SqlFixture) => { f.role.owner_usage = true; },
    (f: SqlFixture) => { f.role.postgres_member = true; }, (f: SqlFixture) => { f.role.read_only = "off"; },
    (f: SqlFixture) => { f.metadata[0].writable = true; }, (f: SqlFixture) => { f.metadata[0].anon_read = true; },
    (f: SqlFixture) => { f.metadata[0].authenticated_read = true; },
    (f: SqlFixture) => { (f.metadata[0].grant_helper as Obj).security_definer = true; },
    (f: SqlFixture) => { (f.metadata[0].grant_helper as Obj).anon_execute = true; },
    (f: SqlFixture) => { f.metadata.find((m) => m.kind === "r")!.force = false; },
    (f: SqlFixture) => { f.metadata.find((m) => m.kind === "v")!.reloptions = ["security_invoker=true"]; },
    (f: SqlFixture) => { f.metadata[0].triggers = [{ name: "synthetic-unpinned-trigger" }]; },
  ]) {
    const f = await createSqlFixture(); mutate(f); const ports = createReadModelSqlInfrastructure(SETTINGS, f.options);
    await rejects(() => ports.readPage(f.fixture.descriptor, parseCurrentReviewQuery(new URL("https://synthetic.invalid/")), null, SYNTHETIC_REVIEWER));
    equal(f.calls.filter((call) => call.sql === READ_MODEL_PAGE_SQL).length, 0);
  }
});

Deno.test("RM provider: JSON text params, opaque keyset and bounded limit40+1; permissions deny before transaction", async () => {
  const f = await createSqlFixture(), ports = createReadModelSqlInfrastructure(SETTINGS, f.options);
  const after = validateCurrentKey([2027, "CURRENT_REVIEW", "CANONICAL_OBSERVATIONS", "", "synthetic-canonical-001"]);
  const q = parseCurrentReviewQuery(new URL("https://synthetic.invalid/?limit=40&university_q=ABC&department_q=SYNTHETIC"));
  await ports.readPage(f.fixture.descriptor, q, after, SYNTHETIC_REVIEWER);
  const params = f.calls.find((call) => call.sql === READ_MODEL_PAGE_SQL)!.parameters;
  equal(params[10], "abc"); equal(params[11], "synthetic"); equal(params[16], 2027); equal(params[17], "synthetic-canonical-001"); equal(params[18], 41);
  const before = f.transactions.length;
  await rejects(() => ports.readPage(f.fixture.descriptor, { ...q, limit: 101 }, null, SYNTHETIC_REVIEWER));
  await rejects(() => ports.readPage(f.fixture.descriptor, q, null, "00000000-0000-4000-8000-000000000999"));
  equal(f.transactions.length, before);
  rejectsSync(() => createReadModelSqlInfrastructure(SETTINGS, { ...f.options, sourceState: undefined } as unknown as ReadModelSqlOptions));
  rejectsSync(() => createReadModelSqlInfrastructure({ ...SETTINGS, databaseCa: "synthetic-no-ca" }, f.options));
});

Deno.test("RM SQL: latest correction/retract resolution precedes filters and same-snapshot exact counts", () => {
  const latest = READ_MODEL_PAGE_SQL.indexOf("latest AS MATERIALIZED"), filtered = READ_MODEL_PAGE_SQL.indexOf("filtered AS MATERIALIZED");
  const counts = READ_MODEL_PAGE_SQL.indexOf("counts AS"), keys = READ_MODEL_PAGE_SQL.indexOf("page_keys AS MATERIALIZED"), payload = READ_MODEL_PAGE_SQL.indexOf("payload AS");
  assert(latest >= 0 && latest < filtered && filtered < counts && counts < keys && keys < payload);
  const latestClause = READ_MODEL_PAGE_SQL.slice(latest, filtered);
  const distinctExpression = latestClause.match(/DISTINCT ON\s*\(([^)]+)\)/)?.[1].trim();
  const firstOrderExpression = latestClause.match(/ORDER BY\s*([^,]+),\s*a\.depth/)?.[1].trim();
  equal(distinctExpression, 'c.canonical_result_id COLLATE "C"', "canonical identity needs deterministic binary collation");
  equal(firstOrderExpression, distinctExpression, "DISTINCT ON and the first ORDER BY expression must match exactly");
  assert(!latestClause.includes("c.operation='upsert'"), "retract must participate before filtering");
  assert(!/\$1[0-6]::/.test(latestClause), "corrected filters must not select an older ancestor row");
  const filteredClause = READ_MODEL_PAGE_SQL.slice(filtered, counts);
  assert(filteredClause.includes("FROM latest v WHERE v.operation='upsert'"));
  const countClause = READ_MODEL_PAGE_SQL.slice(counts, keys);
  assert(countClause.includes("count(*)::text")); assert(countClause.includes("count(DISTINCT (school_id,university_code))::text"));
  assert(countClause.includes("FROM filtered")); assert(READ_MODEL_PAGE_SQL.slice(keys, payload).includes("LIMIT $19::integer"));
  assert(READ_MODEL_PAGE_SQL.includes("l.depth BETWEEN 0 AND 4"));
  for (const relation of ["admission_results_current", "admission_result_source_members", "admission_result_population_links_current"]) {
    assert(!READ_MODEL_PAGE_SQL.includes(relation), "payload path must not read raw source/member/population rows");
  }
  assert(READ_MODEL_PAGE_SQL.includes("transaction_timestamp()"));
});

Deno.test("RM provider auth: verified user identity and token expiry are required; malformed/dependency errors remain safe", async () => {
  const f = await createSqlFixture(); let fetches = 0;
  const claims = btoa(JSON.stringify({ sub: SYNTHETIC_REVIEWER, exp: SYNTHETIC_NOW / 1000 + 600 })).replaceAll("=", "");
  const token = `synthetic-header.${claims}.synthetic-signature`;
  f.options.fetcher = (async (url, init) => { fetches++; equal(String(url), "https://synthetic.invalid/auth/v1/user");
    equal(init?.redirect, "error"); return new Response(JSON.stringify({ id: SYNTHETIC_REVIEWER }), { status: 200 }); }) as typeof fetch;
  const ports = createReadModelSqlInfrastructure(SETTINGS, f.options);
  equal(await ports.verifySession(token, SYNTHETIC_NOW), { subjectId: SYNTHETIC_REVIEWER, expiresAt: SYNTHETIC_NOW + 600_000 });
  equal(await ports.verifySession("synthetic-not-a-jwt", SYNTHETIC_NOW), null); equal(fetches, 2);
  const denied = await createSqlFixture(); denied.options.fetcher = (async () => new Response("synthetic-denied", { status: 401 })) as typeof fetch;
  equal(await createReadModelSqlInfrastructure(SETTINGS, denied.options).verifySession(token, SYNTHETIC_NOW), null);
  const tooLarge = await createSqlFixture(); tooLarge.options.fetcher = (async () => new Response("x".repeat(65_537))) as typeof fetch;
  await rejects(() => createReadModelSqlInfrastructure(SETTINGS, tooLarge.options).verifySession(token, SYNTHETIC_NOW));
  equal(f.transactions.length, 0, "Auth contract fixtures must not open SQL transactions");
});
