import { syncPromise } from "./fixture.ts";
/** Budget protocol and native types with explicit SQL mocks. Not native concurrency acceptance. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type {
  UsageDemand,
  UsageLease,
  UsageReservationRequest,
} from "../../supabase/functions/_shared/jungsi/application/usage_budget.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import {
  SupabaseUsageBudgetStore,
  USAGE_ACTIVE_EXPIRY_SQL,
  USAGE_EXPIRED_SQL,
  USAGE_IDENTITY_INSERT_SQL,
  USAGE_IDENTITY_READ_SQL,
  USAGE_LEASE_FINISH_SQL,
  USAGE_LEASE_INSERT_SQL,
  USAGE_LEASE_READ_SQL,
  USAGE_LOCK_SQL,
  USAGE_NOW_SQL,
  USAGE_VERSION_SQL,
  USAGE_WINDOW_CHANGE_SQL,
  USAGE_WINDOW_INSERT_SQL,
  USAGE_WINDOW_READ_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/usage_postgres.ts";
import { utcInstant, utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  NOW = utcInstant("2026-10-14T00:00:30Z"),
  POLICY = "SYNTHETIC-policy.v1";
const HELD = JSON.stringify([{
  kind: "calculation_cost",
  scope: "SYNTHETIC-exam",
  period_seconds: "60",
  window_start: "2026-10-14T00:00:00Z",
  units: "2",
}]);
function raw(t: bigint) {
  const s = utcText(t);
  return s.includes(".") ? s : s.replace("Z", ".000000Z");
}
function demands(): UsageDemand[] {
  return [{
    kind: "request_window",
    scope: "GLOBAL",
    periodSeconds: 60n,
    capacity: 4n,
    ceiling: 8n,
    units: 1n,
  }, {
    kind: "calculation_cost",
    scope: "SYNTHETIC-exam",
    periodSeconds: 60n,
    capacity: 5n,
    ceiling: 10n,
    units: 2n,
  }];
}
function input(d = demands()): UsageReservationRequest {
  return { owner: OWNER, operation: "overall.analyze", policyVersion: POLICY, demands: d };
}
function fixture(
  options: {
    used?: Record<string, string>;
    reserved?: Record<string, string>;
    version?: boolean;
    identity?: unknown;
    counter?: unknown;
    stale?: unknown[][];
    leaseState?: string;
    settledBytes?: string;
    leaseBody?: unknown;
    dependencyFailure?: boolean;
    activeExpiry?: bigint;
    longLease?: boolean;
  } = {},
) {
  const calls: { s: string; p: readonly unknown[] }[] = [], events: string[] = [];
  let now = NOW, lease: UsageLease | null = null;
  const windows = new Map<string, { ceiling: string; end: string }>();
  const pool: NativeSqlPool = {
    async transaction(readOnly, work) {
      assert(!readOnly);
      try {
        const value = await work({
          query(s, p = []) {
            return syncPromise(() => {
              calls.push({ s, p });
              if (s === RUNTIME_ROLE_SQL) {
                return [[
                  "jungsi_backend_app",
                  false,
                  false,
                  "on",
                  "off",
                  false,
                  false,
                  false,
                  "UTC",
                ]];
              }
              if (s === USAGE_VERSION_SQL) return [[options.version !== false]];
              if (s === USAGE_NOW_SQL) return [[raw(now)]];
              if (s === USAGE_EXPIRED_SQL) return options.stale ?? [];
              if (s === USAGE_WINDOW_INSERT_SQL) {
                windows.set(String(p[3]), {
                  ceiling: String(p[7]),
                  end: raw(utcInstant(String(p[6]))),
                });
                return [];
              }
              if (s === USAGE_WINDOW_READ_SQL) {
                const kind = String(p[3]), w = windows.get(kind)!;
                return [[
                  options.counter ?? w.ceiling,
                  options.used?.[kind] ?? "0",
                  options.reserved?.[kind] ?? "0",
                  w.end,
                ]];
              }
              if (s === USAGE_WINDOW_CHANGE_SQL) {
                if (options.dependencyFailure) throw new Error("SYNTHETIC-PRIVATE-DB");
                return [["0"]];
              }
              if (s === USAGE_IDENTITY_READ_SQL) return [[options.identity ?? false]];
              if (s === USAGE_ACTIVE_EXPIRY_SQL) {
                return [[
                  options.activeExpiry ? raw(options.activeExpiry) : null,
                ]];
              }
              if (s === USAGE_LEASE_INSERT_SQL) {
                if (p[4] === "active") {
                  lease = {
                    id: String(p[0]),
                    owner: String(p[1]),
                    policyVersion: String(p[2]),
                    createdAtUtc: utcInstant(String(p[5])),
                    expiresAtUtc: utcInstant(String(p[6])),
                  };
                }
                return [];
              }
              if (s === USAGE_LEASE_READ_SQL) {
                assert(lease);
                return [[
                  options.leaseState ?? "active",
                  options.leaseBody ?? HELD,
                  raw(lease.createdAtUtc),
                  raw(lease.expiresAtUtc),
                  ["success", "failure"].includes(options.leaseState ?? "")
                    ? options.settledBytes ?? "0"
                    : null,
                ]];
              }
              if (s === USAGE_LEASE_FINISH_SQL) return [[p[0]]];
              return [];
            });
          },
        });
        events.push("commit");
        return value;
      } catch (e) {
        events.push("rollback");
        throw e;
      }
    },
    async close() {},
  };
  const sql = new SupabaseSqlTransport(pool),
    store = new SupabaseUsageBudgetStore(
      sql,
      options.longLease
        ? { leaseSeconds: 460n, runtimeHardLimitSeconds: 400n, clockMarginSeconds: 30n }
        : { leaseSeconds: 30n, runtimeHardLimitSeconds: 20n, clockMarginSeconds: 5n },
    );
  return { store, sql, calls, events, now: (v: bigint) => now = v, lease: () => lease };
}
async function denied(run: () => Promise<unknown>) {
  let e: unknown;
  try {
    await run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, "security_policy_unavailable");
  equal(e.http, 503);
}
/** 조회 작업은 60초까지만, 분석·쓰기는 승인된 임대 그대로. */
async function readLeaseCase() {
  const cases = [
    ["recruitment.read", 60n],
    ["report.read", 60n],
    ["offerings.search", 60n],
    ["report.list-own", 60n],
    ["overall.analyze", 460n],
    ["university.analyze", 460n],
    ["candidates.build", 460n],
    ["shortlist.update", 460n],
  ] as const;
  for (const [operation, want] of cases) {
    const f = fixture({ longLease: true }),
      r = await f.store.reserve({ ...input(), operation });
    assert(r.allowed);
    assert(r.lease.expiresAtUtc === NOW + want * 1000000n, operation);
  }
  // 승인된 임대가 이미 60초보다 짧으면 조회도 그 값을 넘지 않는다
  const short = fixture(),
    r = await short.store.reserve({ ...input(), operation: "report.read" });
  assert(r.allowed);
  assert(r.lease.expiresAtUtc === NOW + 30000000n);
}
Deno.test("budget shared reservation locks stable owner policy before counters and reserves compute", async () => {
  const f = fixture(), r = await f.store.reserve(input());
  assert(r.allowed);
  equal(r.lease.owner, OWNER);
  assert(r.lease.createdAtUtc === NOW);
  assert(r.lease.expiresAtUtc === NOW + 30000000n);
  const lock = f.calls.findIndex((c) => c.s === USAGE_LOCK_SQL),
    read = f.calls.findIndex((c) => c.s === USAGE_WINDOW_READ_SQL);
  assert(lock < read);
  const changes = f.calls.filter((c) => c.s === USAGE_WINDOW_CHANGE_SQL);
  equal(changes.map((c) => c.p.slice(6)), [["1", "0"], ["0", "2"]]);
  equal(f.events, ["commit"]);
  const saved = f.calls.find((c) => c.s === USAGE_LEASE_INSERT_SQL)!;
  equal(saved.p[4], "active");
  assert(!String(saved.p[8]).includes("scores"));
  await readLeaseCase();
});
Deno.test("budget refused compute commits request charge and denied receipt without reserving compute", async () => {
  const f = fixture({ used: { calculation_cost: "4" } }), r = await f.store.reserve(input());
  assert(!r.allowed);
  equal(r.code, "analysis_quota_exceeded");
  equal(r.retryAfterSeconds, 30);
  const changes = f.calls.filter((c) => c.s === USAGE_WINDOW_CHANGE_SQL);
  equal(changes.length, 1);
  equal(changes[0].p.slice(6), ["1", "0"]);
  equal(f.calls.find((c) => c.s === USAGE_LEASE_INSERT_SQL)!.p[4], "denied");
  equal(f.events, ["commit"]);
});
Deno.test("budget exhausted request window returns rate limit without resetting existing count", async () => {
  const f = fixture({ used: { request_window: "4" } }), r = await f.store.reserve(input());
  assert(!r.allowed);
  equal(r.code, "rate_limit_exceeded");
  equal(f.calls.filter((c) => c.s === USAGE_WINDOW_CHANGE_SQL).length, 0);
});
Deno.test("budget tier upgrade retains prior counts under stable approved ceiling", async () => {
  const f = fixture({ used: { request_window: "4" } }), d = demands();
  d[0] = { ...d[0], capacity: 8n };
  const r = await f.store.reserve(input(d));
  assert(r.allowed);
  equal(f.calls.find((c) => c.s === USAGE_WINDOW_INSERT_SQL)!.p[7], "8");
  const g = fixture({ used: { request_window: "6" } }), r2 = await g.store.reserve(input());
  assert(!r2.allowed);
  equal(r2.code, "rate_limit_exceeded");
});
Deno.test("budget known zero capacity denies and unknown native values cannot mean unlimited", async () => {
  const f = fixture(), d = demands();
  d[0] = { ...d[0], capacity: 0n };
  const r = await f.store.reserve(input(d));
  assert(!r.allowed);
  for (const value of [null, 0, 0.0, "0", false]) {
    const g = fixture(), bad = demands();
    bad[0] = { ...bad[0], capacity: value } as unknown as UsageDemand;
    await denied(() => g.store.reserve(input(bad)));
    equal(g.calls, []);
  }
});
Deno.test("budget native counters policy ceiling and migration version are mandatory", async () => {
  for (const options of [{ counter: 8 }, { counter: "9" }, { version: false }]) {
    const f = fixture(options);
    await denied(() => f.store.reserve(input()));
    assert(!f.calls.some((c) => c.s === USAGE_LEASE_INSERT_SQL));
  }
});
Deno.test("budget existing normalized score fingerprint does not consume a second distinct score", async () => {
  const f = fixture({ identity: true }),
    d = [demands()[0], {
      kind: "distinct_scores" as const,
      scope: "SYNTHETIC-exam",
      periodSeconds: 60n,
      capacity: 2n,
      ceiling: 4n,
      units: 1n,
      fingerprint: "a".repeat(64),
    }];
  const r = await f.store.reserve(input(d));
  assert(r.allowed);
  assert(!f.calls.some((c) => c.s === USAGE_IDENTITY_INSERT_SQL));
  equal(f.calls.filter((c) => c.s === USAGE_WINDOW_CHANGE_SQL).length, 1);
});
Deno.test("budget new distinct score identity is charged and inserted atomically", async () => {
  const f = fixture(),
    d = [demands()[0], {
      kind: "distinct_scores" as const,
      scope: "SYNTHETIC-exam",
      periodSeconds: 60n,
      capacity: 2n,
      ceiling: 4n,
      units: 1n,
      fingerprint: "a".repeat(64),
    }];
  const r = await f.store.reserve(input(d));
  assert(r.allowed);
  equal(f.calls.filter((c) => c.s === USAGE_IDENTITY_INSERT_SQL).length, 1);
  equal(f.events, ["commit"]);
});
Deno.test("budget concurrency retry uses the current active lease without exposing capacities", async () => {
  const f = fixture({ reserved: { concurrent_jobs: "1" }, activeExpiry: NOW + 7000000n }),
    d = [demands()[0], {
      kind: "concurrent_jobs" as const,
      scope: "GLOBAL",
      periodSeconds: 1n,
      capacity: 1n,
      ceiling: 2n,
      units: 1n,
    }];
  const r = await f.store.reserve(input(d));
  assert(!r.allowed);
  equal(r.code, "rate_limit_exceeded");
  equal(r.retryAfterSeconds, 7);
});
Deno.test("budget success and failure conservatively consume held calculation charges", async () => {
  for (const outcome of ["success", "failure"] as const) {
    const f = fixture(), r = await f.store.reserve(input());
    assert(r.allowed);
    const start = f.calls.length;
    await f.store.settle(r.lease, outcome);
    const changes = f.calls.slice(start).filter((c) => c.s === USAGE_WINDOW_CHANGE_SQL);
    equal(changes.length, 1);
    equal(changes[0].p.slice(6), ["2", "-2"]);
    equal(f.calls.filter((c) => c.s === USAGE_LEASE_FINISH_SQL).at(-1)!.p[3], outcome);
  }
});
Deno.test("budget settlement is idempotent for an already recorded outcome", async () => {
  const f = fixture({ leaseState: "success" }), r = await f.store.reserve(input());
  assert(r.allowed);
  const start = f.calls.length;
  await f.store.settle(r.lease, "success");
  equal(f.calls.slice(start).filter((c) => c.s === USAGE_WINDOW_CHANGE_SQL).length, 0);
});
Deno.test("budget expired prior workers consume holds before new counters are evaluated", async () => {
  const stale = "00000000-0000-0000-0000-000000000003", f = fixture({ stale: [[stale, HELD]] });
  await f.store.reserve(input());
  const finish = f.calls.findIndex((c) => c.s === USAGE_LEASE_FINISH_SQL),
    read = f.calls.findIndex((c) => c.s === USAGE_WINDOW_READ_SQL);
  assert(finish < read);
  equal(f.calls[finish].p[3], "expired");
});
Deno.test("budget parsed-object held state expiry and database exceptions fail closed", async () => {
  const f = fixture({ leaseBody: [] }), r = await f.store.reserve(input());
  assert(r.allowed);
  await denied(() => f.store.settle(r.lease, "success"));
  const g = fixture(), s = await g.store.reserve(input());
  assert(s.allowed);
  g.now(NOW + 40000000n);
  await denied(() => g.store.settle(s.lease, "success"));
  const h = fixture({ dependencyFailure: true });
  await denied(() => h.store.reserve(input()));
  equal(h.events, ["rollback"]);
});
Deno.test("budget duplicate demands missing request limits and short leases cannot compose", async () => {
  const f = fixture();
  await denied(() => f.store.reserve(input([demands()[0], demands()[0]])));
  await denied(() => f.store.reserve(input([demands()[1]])));
  equal(f.calls, []);
  let e: unknown;
  try {
    new SupabaseUsageBudgetStore(f.sql, {
      leaseSeconds: 25n,
      runtimeHardLimitSeconds: 20n,
      clockMarginSeconds: 5n,
    });
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, "security_policy_unavailable");
});

Deno.test("budget response volume consumes actual UTF8 bytes and releases unused reservation", async () => {
  const held = JSON.stringify([{
    kind: "result_volume",
    scope: "GLOBAL",
    period_seconds: "60",
    window_start: "2026-10-14T00:00:00Z",
    units: "1000",
  }]);
  const d = [demands()[0], {
    kind: "result_volume" as const,
    scope: "GLOBAL",
    periodSeconds: 60n,
    capacity: 2000n,
    ceiling: 4000n,
    units: 1000n,
  }];
  for (const outcome of ["success", "failure"] as const) {
    const f = fixture({ leaseBody: held }), r = await f.store.reserve(input(d));
    assert(r.allowed);
    const start = f.calls.length;
    await f.store.settle(
      r.lease,
      outcome,
      outcome === "success" ? { resultBytes: 100n } : undefined,
    );
    equal(
      f.calls.slice(start).filter((c) => c.s === USAGE_WINDOW_CHANGE_SQL).map((c) => c.p.slice(6)),
      [[outcome === "success" ? "100" : "0", "-1000"]],
    );
  }
  const oversized = fixture({ leaseBody: held }), r = await oversized.store.reserve(input(d));
  assert(r.allowed);
  await denied(() => oversized.store.settle(r.lease, "success", { resultBytes: 1001n }));
});
Deno.test("budget repeated settlement with changed actual bytes is rejected", async () => {
  const f = fixture({ leaseState: "success", settledBytes: "100" }),
    r = await f.store.reserve(input());
  assert(r.allowed);
  await f.store.settle(r.lease, "success", { resultBytes: 100n });
  await denied(() => f.store.settle(r.lease, "success", { resultBytes: 101n }));
});

Deno.test("budget active concurrency counter does not reset at minute or daily boundaries", async () => {
  const f = fixture(),
    d = [demands()[0], {
      kind: "concurrent_jobs" as const,
      scope: "GLOBAL",
      periodSeconds: 1n,
      capacity: 2n,
      ceiling: 2n,
      units: 1n,
    }];
  assert((await f.store.reserve(input(d))).allowed);
  f.now(NOW + 86490000000n);
  assert((await f.store.reserve(input(d))).allowed);
  const calls = f.calls.filter((c) =>
    c.s === USAGE_WINDOW_INSERT_SQL && c.p[3] === "concurrent_jobs"
  );
  equal(calls.length, 2);
  equal(calls[0].p.slice(0, 7), calls[1].p.slice(0, 7));
  equal(calls[0].p[5], "1970-01-01T00:00:00Z");
  equal(calls[0].p[6], "9999-12-31T23:59:59.999999Z");
});
