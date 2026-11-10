/** Existing SQL contracts with invented rows; no actual account or database writes. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { nativeJsonText } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import {
  AUDIT_INSERT_SQL,
  PROFILE_INSERT_SQL,
  PROFILE_READ_SQL,
  REPORT_ACCESS_SQL,
  REPORT_INSERT_SQL,
  REPORT_READ_SQL,
  REPORT_REVISION_SQL,
  REPORT_UPDATE_SQL,
  REQUEST_INSERT_SQL,
  REQUEST_LOCK_SQL,
  REQUEST_REPLAY_SQL,
  REVISION_INSERT_SQL,
  SupabasePlatformRepository,
} from "../../supabase/functions/_shared/jungsi/infrastructure/platform_postgres.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";

Deno.test("new profile JSONB write uses derived decimals consistently for result and replay", async () => {
  const raw = { n: new JsonFloat("1e3"), z: new JsonFloat("-0e0"), i: 1 };
  const f = fixture();
  const created = await f.repo.createProfile({
    owner: OWNER,
    scores: raw,
    confirmed: false,
    nowUtc: utcInstant(NOW),
    key: "SYNTHETIC-exponent-profile",
    digest: DIGEST,
  });
  equal(f.calls.find((c) => c.s === PROFILE_INSERT_SQL)!.p[2], '{"n":1000.0,"z":0.0,"i":1}');
  assert(created.scores.n instanceof JsonFloat);
  equal(created.scores.n.lexeme, "1000.0");
  equal(raw.n.lexeme, "1e3");
  const replayText = f.calls.find((c) => c.s === REQUEST_INSERT_SQL)!.p[4];
  assert(typeof replayText === "string");
  assert(replayText.includes('"n":1000.0'));
  const g = fixture((s) => s === REQUEST_REPLAY_SQL ? [[DIGEST, replayText]] : []);
  const replay = await g.repo.replay(
    OWNER,
    "score-profile.create",
    "SYNTHETIC-exponent-profile",
    DIGEST,
  );
  assert(replay && "scores" in replay);
  equal(nativeJsonText(replay.scores), nativeJsonText(created.scores));
  equal(g.mutations().length, 0);
});
Deno.test("new report revision stores float type before JSONB and returns derived value", async () => {
  const f = fixture((s) => s.startsWith("SELECT profile_id FROM") ? [["SYNTHETIC-profile"]] : []);
  const body = { ...storedReport().body, synthetic_decimal: new JsonFloat("1e0") };
  const created = await f.repo.writeReport(write({
    reportId: null,
    expected: null,
    body,
    key: "SYNTHETIC-exponent-report",
  }));
  assert(created.body.synthetic_decimal instanceof JsonFloat);
  equal(created.body.synthetic_decimal.lexeme, "1.0");
  equal(body.synthetic_decimal.lexeme, "1e0");
  const insert = f.calls.find((c) => c.s === REVISION_INSERT_SQL)!.p[4];
  assert(typeof insert === "string" && insert.includes('"synthetic_decimal":1.0'));
});

const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002";
const NOW = "2026-10-14T00:00:00.123456Z", DIGEST = "a".repeat(64);
const MUTATIONS = [
  PROFILE_INSERT_SQL,
  REPORT_INSERT_SQL,
  REPORT_UPDATE_SQL,
  REVISION_INSERT_SQL,
  REQUEST_INSERT_SQL,
  AUDIT_INSERT_SQL,
];
type Handler = (s: string, p: readonly unknown[]) => unknown[][] | Promise<unknown[][]>;
function fixture(handle: Handler = () => []) {
  const calls: { s: string; p: readonly unknown[] }[] = [],
    modes: boolean[] = [],
    events: string[] = [];
  let id = 0;
  const pool: NativeSqlPool = {
    async transaction(readOnly, work) {
      modes.push(readOnly);
      try {
        const r = await work({
          async query(s, p = []) {
            calls.push({ s, p });
            if (s === RUNTIME_ROLE_SQL) {
              return [[
                "jungsi_backend_app",
                false,
                false,
                "on",
                readOnly ? "on" : "off",
                false,
                false,
                false,
                "UTC",
              ]];
            }
            return await handle(s, p);
          },
        });
        events.push("commit");
        return r;
      } catch (e) {
        events.push("rollback");
        throw e;
      }
    },
    async close() {},
  };
  const repo = new SupabasePlatformRepository(new SupabaseSqlTransport(pool), {
    maxRecordBytes: 100000,
  }, () => String(++id).padStart(32, "0"));
  return {
    repo,
    calls,
    modes,
    events,
    mutations: () => calls.filter((c) => MUTATIONS.includes(c.s)),
  };
}
function storedProfile(owner = OWNER) {
  return {
    profile_id: "SYNTHETIC-profile",
    owner_id: owner,
    scores: { nested: [2, new JsonFloat("2.0")] },
    confirmed: true,
    created_at: NOW,
  };
}
function storedReport(owner = OWNER) {
  return {
    report_id: "SYNTHETIC-report",
    owner_id: owner,
    profile_id: "SYNTHETIC-profile",
    revision: 2,
    body: {
      overall: { total: 26 },
      analyses: {},
      shortlist: {},
      candidates: null,
      analysis_status: { status: "pending" },
    },
    updated_at: NOW,
  };
}
function rowReport(owner = OWNER) {
  const r = storedReport(owner);
  return [r.report_id, r.owner_id, r.profile_id, "2", nativeJsonText(r.body), NOW];
}
function write(overrides: Record<string, unknown> = {}) {
  return {
    owner: OWNER,
    reportId: "SYNTHETIC-report",
    profileId: "SYNTHETIC-profile",
    body: storedReport().body,
    expected: 2,
    nowUtc: utcInstant(NOW),
    operation: "overall.analyze" as const,
    key: "SYNTHETIC-key",
    digest: DIGEST,
    ...overrides,
  };
}
async function denied(run: () => Promise<unknown>, code: string, http = 503) {
  let e: unknown;
  try {
    await run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, http);
}
Deno.test("SQL profile read binds owner and preserves nested native types from text", async () => {
  const f = fixture((s) =>
    s === PROFILE_READ_SQL
      ? [["SYNTHETIC-profile", OWNER, '{"nested":[2,2.0,null,[]]}', true, NOW]]
      : []
  );
  const r = await f.repo.getProfile(OWNER, "SYNTHETIC-profile");
  assert(r);
  equal(r.created_at, NOW);
  const x = r.scores.nested as unknown[];
  equal(x[0], 2);
  assert(x[1] instanceof JsonFloat);
  equal(x.slice(2), [null, []]);
  equal(f.calls.find((c) => c.s === PROFILE_READ_SQL)!.p, ["SYNTHETIC-profile", OWNER]);
  equal(f.modes, [true]);
  assert(PROFILE_READ_SQL.includes("scores::text"));
});
Deno.test("SQL profile and report cross-owner rows close safely", async () => {
  const f = fixture((s) =>
    s === PROFILE_READ_SQL
      ? [["SYNTHETIC-profile", OTHER, "{}", true, NOW]]
      : s === REPORT_READ_SQL
      ? [rowReport(OTHER)]
      : []
  );
  await denied(() => f.repo.getProfile(OWNER, "SYNTHETIC-profile"), "storage_result_invalid");
  await denied(() => f.repo.getReport(OWNER, "SYNTHETIC-report"), "storage_result_invalid");
});
Deno.test("SQL JSON pre-parsed and duplicate-key rows cannot pass as native source", async () => {
  for (const value of [{ score: 2 }, '{"score":2,"score":2.0}']) {
    const f = fixture((s) =>
      s === PROFILE_READ_SQL ? [["SYNTHETIC-profile", OWNER, value, true, NOW]] : []
    );
    await denied(() => f.repo.getProfile(OWNER, "SYNTHETIC-profile"), "storage_result_invalid");
  }
});
Deno.test("SQL profile create locks before replay and appends request plus audit", async () => {
  const f = fixture(), scores = { nested: [2, new JsonFloat("2.0")] };
  const r = await f.repo.createProfile({
    owner: OWNER,
    scores,
    confirmed: false,
    nowUtc: utcInstant(NOW),
    key: "SYNTHETIC-key",
    digest: DIGEST,
  });
  assert(r.profile_id.startsWith("profile-"));
  equal(r.created_at, NOW);
  const lock = f.calls.findIndex((c) => c.s === REQUEST_LOCK_SQL),
    replay = f.calls.findIndex((c) => c.s === REQUEST_REPLAY_SQL);
  assert(lock < replay);
  equal(f.mutations().map((c) => c.s), [PROFILE_INSERT_SQL, REQUEST_INSERT_SQL, AUDIT_INSERT_SQL]);
  const text = f.calls.find((c) => c.s === PROFILE_INSERT_SQL)!.p[2];
  equal(text, '{"nested":[2,2.0]}');
  scores.nested[0] = 9;
  equal((r.scores.nested as unknown[])[0], 2);
  equal(f.events, ["commit"]);
  equal(f.modes, [false]);
});
Deno.test("SQL same request returns saved profile without duplicate writes", async () => {
  const f = fixture((s) =>
    s === REQUEST_REPLAY_SQL ? [[DIGEST, nativeJsonText(storedProfile())]] : []
  );
  const r = await f.repo.createProfile({
    owner: OWNER,
    scores: {},
    confirmed: true,
    nowUtc: utcInstant(NOW),
    key: "SYNTHETIC-key",
    digest: DIGEST,
  });
  equal(r.profile_id, "SYNTHETIC-profile");
  equal(f.mutations(), []);
});
Deno.test("SQL reused request key with different body is a conflict after lock", async () => {
  const f = fixture((s) =>
    s === REQUEST_REPLAY_SQL ? [["b".repeat(64), nativeJsonText(storedProfile())]] : []
  );
  await denied(
    () =>
      f.repo.createProfile({
        owner: OWNER,
        scores: {},
        confirmed: true,
        nowUtc: utcInstant(NOW),
        key: "SYNTHETIC-key",
        digest: DIGEST,
      }),
    "idempotency_conflict",
    409,
  );
  equal(f.mutations(), []);
  equal(f.events, ["rollback"]);
});
Deno.test("SQL saved replay remains owner bound and validates result structure", async () => {
  const f = fixture((s) =>
    s === REQUEST_REPLAY_SQL ? [[DIGEST, nativeJsonText(storedProfile(OTHER))]] : []
  );
  await denied(
    () => f.repo.replay(OWNER, "score-profile.create", "SYNTHETIC-key", DIGEST),
    "storage_result_invalid",
  );
});
Deno.test("SQL report access returns only verified own confirmation and no scores", async () => {
  const f = fixture((s, p) =>
    s === REPORT_ACCESS_SQL ? (equal(p, ["SYNTHETIC-report", OWNER]), [[OWNER, false]]) : []
  );
  equal(await f.repo.lookupAccess(OWNER, "SYNTHETIC-report"), { ownerId: OWNER, confirmed: false });
  assert(REPORT_ACCESS_SQL.includes("r.owner_id=$2"));
});
function exists(s: string) {
  return s.startsWith("SELECT profile_id FROM jungsi_backend.profiles")
    ? [["SYNTHETIC-profile"]]
    : s === REPORT_REVISION_SQL
    ? [["2"]]
    : [];
}
Deno.test("SQL new report uses owned immutable profile and appends first revision", async () => {
  const f = fixture(exists),
    r = await f.repo.writeReport(write({ reportId: null, expected: null }));
  equal(r.revision, 1);
  assert(r.report_id.startsWith("report-"));
  equal(f.mutations().map((c) => c.s), [
    REPORT_INSERT_SQL,
    REVISION_INSERT_SQL,
    REQUEST_INSERT_SQL,
    AUDIT_INSERT_SQL,
  ]);
  const body = f.calls.find((c) => c.s === REVISION_INSERT_SQL)!;
  equal(body.p[1], OWNER);
  equal(body.p[3], "1");
  equal(body.p[5], NOW);
});
Deno.test("SQL update uses FOR UPDATE version and explicit owner then appends revision", async () => {
  const f = fixture((s) => s === REPORT_READ_SQL ? [rowReport()] : exists(s)),
    r = await f.repo.writeReport(write());
  equal(r.revision, 3);
  equal(f.calls.find((c) => c.s === REPORT_REVISION_SQL)!.p, ["SYNTHETIC-report", OWNER]);
  equal(f.calls.find((c) => c.s === REPORT_UPDATE_SQL)!.p, [
    "3",
    "SYNTHETIC-profile",
    NOW,
    "SYNTHETIC-report",
    OWNER,
  ]);
  equal(f.mutations().map((c) => c.s), [
    REPORT_UPDATE_SQL,
    REVISION_INSERT_SQL,
    REQUEST_INSERT_SQL,
    AUDIT_INSERT_SQL,
  ]);
});
Deno.test("SQL revision conflict cannot append data audit or replay receipt", async () => {
  const f = fixture(exists);
  await denied(() => f.repo.writeReport(write({ expected: 1 })), "revision_conflict", 409);
  equal(f.mutations(), []);
  equal(f.events, ["rollback"]);
});
Deno.test("SQL missing owned profile and report retain distinct safe 404", async () => {
  const f = fixture();
  await denied(() => f.repo.writeReport(write()), "profile_not_found", 404);
  equal(f.mutations(), []);
  const g = fixture((s) => s.startsWith("SELECT profile_id") ? [["SYNTHETIC-profile"]] : []);
  await denied(() => g.repo.writeReport(write()), "report_not_found", 404);
  equal(g.mutations(), []);
});
Deno.test("SQL no-op selection preserves revision timestamp body and appends only receipt audit", async () => {
  const f = fixture((s) => s === REPORT_READ_SQL ? [rowReport()] : exists(s));
  const r = await f.repo.writeReport(write({ noOp: true, body: { ignored: true } }));
  equal(r.revision, 2);
  equal(r.updated_at, NOW);
  assert(!Object.hasOwn(r.body, "ignored"));
  equal(f.mutations().map((c) => c.s), [REQUEST_INSERT_SQL, AUDIT_INSERT_SQL]);
});
Deno.test("SQL report retry uses saved report before profile and revision reads", async () => {
  const f = fixture((s) =>
    s === REQUEST_REPLAY_SQL ? [[DIGEST, nativeJsonText(storedReport())]] : []
  );
  const r = await f.repo.writeReport(write());
  equal(r.revision, 2);
  equal(f.mutations(), []);
  assert(!f.calls.some((c) => c.s === REPORT_REVISION_SQL));
});
Deno.test("SQL dependency error rolls back request and exposes no driver message", async () => {
  const f = fixture((s) => {
    if (s === REQUEST_INSERT_SQL) throw new Error("SYNTHETIC-PRIVATE-CREDENTIAL");
    return [];
  });
  await denied(
    () =>
      f.repo.createProfile({
        owner: OWNER,
        scores: {},
        confirmed: false,
        nowUtc: utcInstant(NOW),
        key: "SYNTHETIC-key",
        digest: DIGEST,
      }),
    "storage_unavailable",
  );
  equal(f.events, ["rollback"]);
});
Deno.test("SQL record budgets and identifiers must be configured and never default unlimited", async () => {
  const f = fixture();
  await denied(() => f.repo.getReport(OWNER, "bad value"), "invalid_identifier", 422);
  equal(f.calls, []);
  await denied(
    () => f.repo.replay(OWNER, "unknown", "SYNTHETIC-key", DIGEST),
    "storage_parameters_invalid",
  );
  let e: unknown;
  try {
    new SupabasePlatformRepository({} as SupabaseSqlTransport, { maxRecordBytes: NaN });
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, "storage_configuration_invalid");
});
