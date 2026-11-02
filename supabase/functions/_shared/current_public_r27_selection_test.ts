/** Synthetic only: no network, DB, settings, or actual admission values. */
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
import {
  CurrentPublicR27SelectionService,
  type Own2027NativeQuota,
  type Own2027SelectionKey,
  type Own2027SelectionTrust,
} from "./current_public_r27_selection.ts";
import type {
  CurrentPublicCatalogPort,
  PublicCatalogPublication,
  PublicCatalogRecord,
  PublicPreparedKeyPage,
} from "./current_public_catalog.ts";
import { JsonFloat, type NativeJson } from "./jungsi/domain/native_json.ts";

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

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (!Object.is(actual, expected)) throw new Error("assert_equal_failed");
  },
  deepEqual(actual: unknown, expected: unknown): void {
    if (nativeJsonText(actual, true) !== nativeJsonText(expected, true)) {
      throw new Error("assert_deep_equal_failed");
    }
  },
  ok(value: unknown): void {
    if (!value) throw new Error("assert_truthy_failed");
  },
  async rejects(work: Promise<unknown>, pattern: RegExp): Promise<void> {
    let failure: unknown = null;
    try {
      await work;
    } catch (error) {
      failure = error;
    }
    if (!(failure instanceof Error) || !pattern.test(failure.message)) {
      throw new Error("expected_rejection_missing_or_mismatched");
    }
  },
};
const USER = "00000000-0000-0000-0000-000000000001",
  PUB = "a".repeat(64),
  HEAD = "b".repeat(64),
  OTHER = "c".repeat(64);
const clock = { nowUtc: () => 100n };
const pub = (): PublicCatalogPublication => ({
  version: "synthetic-catalog",
  sha256: PUB,
  expiresAtUtc: 1000n,
});
const key = (p = "P1", s = "S1"): Own2027SelectionKey => ({
  academic_year: 2027,
  school_id: s,
  offering_pk: p,
});
type FakeRow = Omit<PublicCatalogRecord, "guide"> & {
  guide: NonNullable<PublicCatalogRecord["guide"]>;
};
function row(p = "P1", s = "S1", quota: NativeJson = 0n): FakeRow {
  return {
    key: [2027, s, p, "", "2027:" + p],
    row: {
      academic_year: 2027,
      school_id: s,
      offering_pk: p,
      offering_id: "2027:" + p,
      active_service: true,
      practical_required: false,
      source_kind: "current_guide",
    },
    guide: {
      academic_year: 2027,
      school_id: s,
      offering_pk: p,
      offering_id: "2027:" + p,
      active_service: true,
      practical_required: false,
      recruitment_link_status: "verified",
      quota_value: quota,
      quota_literal_state: "numeric_literal",
      metadata: { quota_stage: "initial" },
    },
  };
}
type FixtureOptions = {
  noTrust?: boolean;
  wrongSubject?: boolean;
  lookupError?: boolean;
  pageHead?: string;
  rows?: FakeRow[];
  publication?: (n: number) => PublicCatalogPublication;
  binding?: (n: number) => string;
};
function fixture(options: FixtureOptions = {}) {
  const ctl = new AbortController(), events: string[] = [];
  const seen: { lookups: number; binds: number; pubs: number; ids: readonly string[] | null } = {
    lookups: 0,
    binds: 0,
    pubs: 0,
    ids: null,
  };
  const request = {
    operation: "recruitment.read" as const,
    session: {
      user: { subjectId: USER, expiresAtUtc: 900n },
      evaluatedAtUtc: 50n,
      tier: "standard" as const,
      paidUntilUtc: null,
    },
    management: null,
    body: {},
    query: {},
    params: {},
    requestKey: null,
  };
  const boundary: { signal: AbortSignal; admission?: unknown } = {
    signal: ctl.signal,
    admission: Object.freeze({ permit: "synthetic" }),
  };
  const current: CurrentPublicCatalogPort = {
    async publication() {
      await Promise.resolve();
      events.push("pub");
      seen.pubs++;
      return options.publication?.(seen.pubs) ?? pub();
    },
    async lookup(subject, ids, recruitment) {
      await Promise.resolve();
      events.push("lookup");
      seen.lookups++;
      seen.ids = [...ids];
      assert.equal(subject, USER);
      assert.equal(recruitment, true);
      assert.ok(Object.isFrozen(ids));
      if (options.lookupError) throw new Error("synthetic_index_12_prefix_limit");
      return {
        version: "synthetic-catalog",
        head: options.pageHead ?? HEAD,
        asOfUtc: 80n,
        rows: options.rows ?? [row()],
      };
    },
    async search() {
      await Promise.resolve();
      throw Error("unexpected_search");
    },
  };
  const trust: Own2027SelectionTrust = {
    async bind(req, bd, scope, publication) {
      await Promise.resolve();
      events.push("bind");
      seen.binds++;
      assert.equal(req, request);
      assert.equal(bd, boundary);
      assert.ok(Object.isFrozen(scope));
      assert.equal(publication.sha256, PUB);
      return {
        subject_id: options.wrongSubject ? "other" : USER,
        publication_sha256: PUB,
        head_sha256: options.binding?.(seen.binds) ?? HEAD,
      };
    },
  };
  const service = new CurrentPublicR27SelectionService(
    current,
    clock,
    options.noTrust ? undefined : trust,
  );
  return {
    request,
    boundary,
    ctl,
    current,
    trust,
    service,
    events,
    seen,
    run: (ks: readonly Own2027SelectionKey[] = [key()]) =>
      service.selectedOwn2027Guides(request, boundary, ks),
  };
}
function value(q: Own2027NativeQuota): NativeJson {
  assert.equal(q.state, "present");
  if (q.state !== "present") throw new Error("missing_native_value");
  return q.value;
}
Deno.test("own 2027 one lookup, ordered missing HOLD and native zero", async () => {
  const f = fixture(), out = await f.run([key("P1"), key("P2")]);
  assert.equal(f.seen.lookups, 1);
  assert.deepEqual(f.seen.ids, ["2027:P1", "2027:P2"]);
  assert.equal(f.seen.binds, 2);
  assert.equal(out.items[0].status, "HOLD");
  assert.equal(value(out.items[0].quota_native), 0n);
  assert.equal(out.items[0].recruitment?.initial_count, 0n);
  assert.equal(out.items[0].recruitment?.quota_value, 0);
  assert.equal(value(out.items[0].quota_literal_native), "numeric_literal");
  assert.equal(value(out.items[0].quota_stage_native), "initial");
  assert.ok(out.items[0].reasons.includes("CONDITIONAL_SOURCE_UNPROVEN"));
  assert.ok(out.items[0].reasons.includes("NULL_ORIGIN_UNPROVEN"));
  assert.ok(out.items[0].reasons.includes("PRACTICAL_EVIDENCE_UNPROVEN"));
  assert.deepEqual(out.items[1].reasons, ["NOT_RETURNED"]);
});
Deno.test("own 2027 null and absent are distinct and stay HOLD", async () => {
  const n = row("P1", "S1", null);
  n.guide.quota_literal_state = "null";
  const a = row();
  delete a.guide.quota_value;
  const x = (await fixture({ rows: [n] }).run()).items[0],
    y = (await fixture({ rows: [a] }).run()).items[0];
  assert.equal(value(x.quota_native), null);
  assert.equal(y.quota_native.state, "absent");
  assert.equal(x.status, "HOLD");
  assert.equal(y.status, "HOLD");
  assert.equal(x.recruitment?.initial_count, null);
});
Deno.test("own 2027 verified link, school and exact PK", async () => {
  const u = row();
  u.guide.recruitment_link_status = "unqualified";
  const out = await fixture({ rows: [u] }).run();
  assert.equal(out.items[0].status, "HOLD");
  assert.ok(out.items[0].reasons.includes("GUIDE_LINK_UNVERIFIED"));
  assert.equal(out.items[0].recruitment, null);
  const f = fixture({ rows: [row("P1", "S2")] });
  await assert.rejects(f.run(), /current_catalog_identity_conflict/);
  assert.equal(f.seen.lookups, 1);
});
Deno.test("own 2027 changed head or publication fails closed", async () => {
  await assert.rejects(fixture({ pageHead: OTHER }).run(), /current_catalog_state_unapproved/);
  await assert.rejects(
    fixture({ binding: (n) => n === 1 ? HEAD : OTHER }).run(),
    /current_catalog_state_unapproved/,
  );
  await assert.rejects(
    fixture({ publication: (n) => n === 1 ? pub() : { ...pub(), version: "different" } }).run(),
    /current_catalog_state_unapproved/,
  );
});
Deno.test("own 2027 requires server guard, admission, subject and session", async () => {
  const a = fixture({ noTrust: true });
  await assert.rejects(a.run(), /security_policy_unavailable/);
  assert.equal(a.seen.lookups, 0);
  const b = fixture({ wrongSubject: true });
  await assert.rejects(b.run(), /security_policy_unavailable/);
  assert.equal(b.seen.lookups, 0);
  const c = fixture();
  c.request.session.user.expiresAtUtc = 99n;
  await assert.rejects(c.run(), /authentication_required/);
  assert.equal(c.seen.lookups, 0);
  const d = fixture();
  delete d.boundary.admission;
  await assert.rejects(d.run(), /security_policy_unavailable/);
  assert.equal(d.seen.lookups, 0);
  const e = fixture();
  e.boundary.admission = null;
  await assert.rejects(e.run(), /security_policy_unavailable/);
  assert.equal(e.seen.lookups, 0);
});
Deno.test("own 2027 invalid scope and duplicate PK fail before lookup", async () => {
  const f = fixture();
  await assert.rejects(f.run([]), /current_catalog_page_invalid/);
  await assert.rejects(f.run([key("P1"), key("P1", "S2")]), /current_catalog_page_invalid/);
  await assert.rejects(
    f.run(Array.from({ length: 101 }, (_, i) => key("P" + i))),
    /current_catalog_page_invalid/,
  );
  const bad = key();
  let calls = 0;
  Object.defineProperty(bad, "school_id", {
    enumerable: true,
    get() {
      calls++;
      return "S1";
    },
  });
  await assert.rejects(f.run([bad]), /current_catalog_page_invalid/);
  assert.equal(calls, 0);
  assert.equal(f.seen.lookups, 0);
});
Deno.test("own 2027 prefix-limit failure has no per-row fallback", async () => {
  const f = fixture({ lookupError: true });
  await assert.rejects(f.run([key("P1"), key("P2")]), /synthetic_index_12_prefix_limit/);
  assert.equal(f.seen.lookups, 1);
});
Deno.test("own 2027 numeric and textual zero are separate and held", async () => {
  for (const raw of [0, 0n, "0"]) {
    const item = (await fixture({ rows: [row("P1", "S1", raw)] }).run()).items[0],
      actual = value(item.quota_native);
    assert.equal(actual, raw);
    assert.equal(typeof actual, typeof raw);
    assert.equal(item.status, "HOLD");
  }
});
Deno.test("own 2027 guide offering ID cannot contradict requested PK", async () => {
  const bad = row();
  bad.guide.offering_id = "2027:OTHER";
  const f = fixture({ rows: [bad] });
  await assert.rejects(f.run(), /current_catalog_identity_conflict/);
  assert.equal(f.seen.lookups, 1);
});
Deno.test("own 2027 rejects decimal accessors and object coercion", async () => {
  let accessed = 0;
  const fake = Object.create(JsonFloat.prototype);
  Object.defineProperty(fake, "lexeme", {
    enumerable: true,
    get() {
      accessed++;
      return "0.0";
    },
  });
  const a = row();
  a.guide.quota_value = fake;
  await assert.rejects(fixture({ rows: [a] }).run(), /current_catalog_page_invalid/);
  assert.equal(accessed, 0);
  let coerced = 0;
  const b = row();
  b.row.metric_kind = {
    toString() {
      coerced++;
      return "";
    },
  } as unknown as NativeJson;
  await assert.rejects(fixture({ rows: [b] }).run(), /current_catalog_page_invalid/);
  assert.equal(coerced, 0);
  const c = row();
  c.guide.quota_value = new JsonFloat("0.00");
  const item = (await fixture({ rows: [c] }).run()).items[0], v = value(item.quota_native);
  assert.ok(v instanceof JsonFloat);
  if (!(v instanceof JsonFloat)) throw new Error("wrong_decimal_type");
  assert.equal(v.lexeme, "0.00");
  assert.equal(item.status, "HOLD");
});

Deno.test("own 2027 connects existing catalog SQL to synthetic native wire", async () => {
  const now = utcInstant("2026-10-19T00:00:00Z");
  const address = "2027:SYNTHETIC-PK";
  const school = "SYNTHETIC-SCHOOL";
  const pk = "SYNTHETIC-PK";
  const definitions: Record<string, string> = {
    admission_results_effective: "SELECT * FROM jungsi_data_ingest.admission_results",
    admission_results_source_current:
      "SELECT * FROM jungsi_data_ingest.admission_observation_registry, jungsi_data_ingest.admission_results_effective",
    admission_results_current:
      "SELECT * FROM jungsi_data_ingest.admission_results_source_current, jungsi_data_ingest.admission_observation_registry",
  };
  const names = [
    ...new Set([
      ...CURRENT_PUBLIC_METADATA_SEEDS.map((x) => x.split(".")[1]),
      ...Object.keys(definitions),
    ]),
  ].sort();
  const metadata = names.map((relation) => {
    const view = !!definitions[relation] || relation.includes("current");
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
      definition: definitions[relation] ?? (view ? "SELECT 1" : null),
      columns: [],
    };
  });
  const commandHash = await nativeJsonSha256([]);
  const admissionHead = { command_id: "SYNTHETIC-COMMAND", payload_sha256: "c".repeat(64) };
  const descriptor: PublicCatalogDescriptor = {
    format: "jungsi.current-public-catalog-publication/v2",
    version: "SYNTHETIC",
    issued_at: "2026-10-18T00:00:00Z",
    expires_at: "2026-10-20T00:00:00Z",
    approval_reference_sha256: PUB,
    consumer_binding_sha256: "b".repeat(64),
    metadata_sha256: await nativeJsonSha256(metadata),
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
    guide_command_state: Object.fromEntries(
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((n) => [n, { count: 0, sha256: commandHash }]),
    ),
    key_index: { object_key: "SYNTHETIC/keys.json", bytes: 100, sha256: "d".repeat(64) },
    coverage_receipt_sha256: "e".repeat(64),
    admission_head: admissionHead,
  };
  const guide = {
    release_id: "SYNTHETIC-RELEASE",
    academic_year: 2027,
    school_id: school,
    offering_pk: pk,
    offering_id: address,
    university_code: school,
    university: "SYNTHETIC-UNIVERSITY",
    department: "SYNTHETIC-DEPARTMENT",
    track: "SYNTHETIC-TRACK",
    recruit_group: "SYNTHETIC-GROUP",
    location: null,
    campus: null,
    wildcard_group: null,
    quota_value: 0,
    quota_literal_state: "numeric_literal",
    metadata: {
      quota_stage: "initial",
      source_url: null,
      source_as_of: null,
      deadline: null,
      practical_required: false,
      participation_conditions_status: "unverified",
      active_service: true,
      campus: null,
      wildcard_group: null,
    },
    active_service: true,
    practical_required: false,
    source_kind: "current_guide",
    recruitment_link_status: "verified",
  };
  const sqlRecord: PublicCatalogRecord = {
    key: [2027, school, pk, "", address],
    row: { ...guide, lookup_requested_id: address },
    guide: { ...guide },
  };
  const selected: PublicPreparedKeyPage = {
    keys: [{
      key: sqlRecord.key,
      sourceKind: "guide",
      guide: null,
      nativeOfferingId: address,
      expectedFingerprint: null,
    }],
    nextAfter: null,
    admissionHead,
    coverage: "all_eligible_current_db_observations_at_head",
    indexSha256: "d".repeat(64),
  };
  const state = {
    head: { ...admissionHead, recorded_at: "2026-10-18T00:00:00Z" },
    writes: 0,
    businessQueries: 0,
    resolves: 0,
    configured: [] as string[],
  };
  const tx: NativeSqlTransaction = {
    query: async (statement, parameters = []) => {
      await Promise.resolve();
      if (statement.startsWith("SET LOCAL")) {
        state.configured.push(statement);
        return [];
      }
      if (statement.startsWith("SELECT set_config")) return [[USER, "SYNTHETIC-CLAIMS"]];
      if (statement === RUNTIME_ROLE_SQL) {
        return [["jungsi_backend_app", false, false, "on", "on", false, false, false, "UTC"]];
      }
      if (statement === CURRENT_PUBLIC_METADATA_SQL) {
        return metadata.map((m) => [
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
      if (statement === CURRENT_PUBLIC_GUIDE_COMMAND_SQL) {
        return CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((n) => [n, "[]"]);
      }
      state.businessQueries++;
      assert.ok(statement.includes("public_bounded_physical"));
      assert.ok(!statement.includes("public_registered_headers"));
      assert.ok(typeof parameters[0] === "string");
      return [[
        JSON.stringify({ admission: state.head }),
        "2026-10-19T00:00:00Z",
        JSON.stringify([sqlRecord]),
      ]];
    },
  };
  const pool: NativeSqlPool = {
    transaction: async <T>(readOnly: boolean, work: (tx: NativeSqlTransaction) => Promise<T>) => {
      if (!readOnly) state.writes++;
      assert.equal(readOnly, true);
      return await work(tx);
    },
    close: () => Promise.resolve(),
  };
  const port = new CurrentPublicCatalogSql(
    new SupabaseSqlTransport(pool),
    () =>
      Promise.resolve({
        descriptor,
        publication: { version: "SYNTHETIC", sha256: PUB, expiresAtUtc: now + 3_600_000_000n },
      }),
    { nowUtc: () => now },
    {
      select: () => Promise.reject(new Error("unexpected_search")),
      resolve: (ids, recruitment) => {
        state.resolves++;
        assert.deepEqual(ids, [address]);
        assert.equal(recruitment, true);
        return Promise.resolve(selected);
      },
    },
  );
  const expectedHead = await nativeJsonSha256({
    metadata: descriptor.metadata_sha256,
    guide_commands: descriptor.guide_command_state,
    head: { admission: state.head },
  });
  const f = fixture({ binding: () => expectedHead });
  f.request.session.user.expiresAtUtc = now + 1_000_000n;
  f.request.session.evaluatedAtUtc = now;
  let lookups = 0;
  const current: CurrentPublicCatalogPort = {
    publication: () => port.publication(),
    search: port.search.bind(port),
    lookup: (subject, ids, recruitment) => {
      lookups++;
      return port.lookup(subject, ids, recruitment);
    },
  };
  const service = new CurrentPublicR27SelectionService(current, { nowUtc: () => now }, f.trust);
  const out = await service.selectedOwn2027Guides(
    f.request,
    f.boundary,
    [{ academic_year: 2027, school_id: school, offering_pk: pk }],
  );
  assert.equal(lookups, 1);
  assert.equal(state.resolves, 1);
  assert.equal(state.businessQueries, 1);
  assert.equal(state.writes, 0);
  assert.equal(f.seen.binds, 2);
  assert.ok(state.configured.includes("SET LOCAL statement_timeout='5000ms'"));
  assert.equal(out.head_sha256, expectedHead);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].status, "HOLD");
  assert.equal(value(out.items[0].quota_native), 0);
  assert.equal(out.items[0].recruitment?.initial_count, 0);
  assert.ok(out.items[0].reasons.includes("NULL_ORIGIN_UNPROVEN"));
});
