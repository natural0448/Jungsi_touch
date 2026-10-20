/** Synthetic policy, verified-session and SQL protocol tests. No live limits or DB writes. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  ADMINISTRATOR_DAILY_KINDS,
  ApprovedAdministratorUsagePolicy,
  verifyAdministratorUsageProof,
} from "../../supabase/functions/_shared/jungsi/application/administrator_usage_policy.ts";
import {
  readSessionSnapshot,
  type SessionSnapshot,
} from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import {
  type ApprovedUsagePlan,
  SharedRequestBudget,
} from "../../supabase/functions/_shared/jungsi/application/usage_service.ts";
import type { BudgetRequest } from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import type {
  BudgetKind,
  UsageBudgetStorePort,
  UsageDemand,
  UsageReservationRequest,
} from "../../supabase/functions/_shared/jungsi/application/usage_budget.ts";
import { RuntimeUsagePolicy } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts";
import {
  SupabaseUsageBudgetStore,
  USAGE_EXPIRED_SQL,
  USAGE_LEASE_INSERT_SQL,
  USAGE_LOCK_SQL,
  USAGE_NOW_SQL,
  USAGE_VERSION_SQL,
  USAGE_WINDOW_CHANGE_SQL,
  USAGE_WINDOW_INSERT_SQL,
  USAGE_WINDOW_READ_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/usage_postgres.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SUBJECT_CONTEXT_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import {
  SYNTHETIC_RUNTIME_NOW as NOW,
  syntheticRuntimeBinding,
} from "./synthetic_runtime_binding.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  HASH = "a".repeat(64),
  VERSION = "SYNTHETIC-counter-v1";
const periods = new Map<BudgetKind, bigint>([
  ...ADMINISTRATOR_DAILY_KINDS.map((k) => [k, 86400n] as const),
  ["concurrent_jobs", 1n],
]);
const physical = {
  calculationUnits: 3n,
  maximumCalculationUnits: 10n,
  maximumResultBytes: 64n,
};
function raw(): NativeObject {
  return {
    format: "jungsi.administrator-usage-policy/v1",
    status: "approved",
    purpose: "administrator_verification",
    approval_reference_sha256: HASH,
    expires_at: "2026-10-15T00:01:00Z",
    daily_dimensions: [...ADMINISTRATOR_DAILY_KINDS],
  };
}
function policy(value = raw()) {
  return new ApprovedAdministratorUsagePolicy(value, {
    approvalSha256: HASH,
    policyVersion: VERSION,
    expiresAtUtc: NOW + 60000000n,
    requestRuntimeMicroseconds: 20000000n,
  });
}
async function session(
  options: {
    role?: string;
    status?: string;
    aal?: "aal1" | "aal2";
    paid?: boolean;
    owner?: string;
  } = {},
): Promise<SessionSnapshot> {
  const owner = options.owner ?? OWNER;
  return await readSessionSnapshot("SYNTHETIC", {
    verifyUserBearer: () =>
      Promise.resolve({
        subjectId: owner,
        expiresAtUtc: NOW + 120000000n,
        accountRole: options.role ?? "admin",
        accountStatus: options.status ?? "active",
        assuranceLevel: options.aal ?? "aal2",
      }),
  }, {
    readCurrent: () =>
      Promise.resolve({
        authority: "public.jeongsi_passes" as const,
        metadataVerified: true as const,
        subjectId: owner,
        evaluatedAtUtc: NOW,
        paidUntilUtc: options.paid ? NOW + 90000000n : null,
      }),
  }, NOW);
}
function request(s: SessionSnapshot): BudgetRequest {
  return {
    operation: "history.search",
    session: s,
    body: {},
    params: {},
    query: {},
    requestKey: null,
  };
}
Deno.test("admin policy snapshots its verified binding before caller mutation", async () => {
  const binding = {
    approvalSha256: HASH,
    policyVersion: VERSION,
    expiresAtUtc: NOW + 60000000n,
    requestRuntimeMicroseconds: 20000000n,
  };
  const p = new ApprovedAdministratorUsagePolicy(raw(), binding);
  binding.policyVersion = "SYNTHETIC-forged";
  binding.approvalSha256 = "b".repeat(64);
  binding.requestRuntimeMicroseconds = 90000000n;
  const proof = p.issue(request(await session()), periods, physical, NOW)!;
  equal(proof.policyVersion, VERSION);
  equal(proof.approvalSha256, HASH);
  assert(proof.deadlineUtc === NOW + 20000000n);
});
Deno.test("expired administrator exception leaves ordinary paid base admission unchanged", async () => {
  const value = raw();
  value.expires_at = "2026-10-15T00:00:01Z";
  const p = policy(value), later = NOW + 1000000n;
  for (const paid of [false, true]) {
    assert(
      p.issue(request(await session({ role: "user", paid })), periods, physical, later) ===
        undefined,
    );
  }
  const requestWithAdmin = request(await session());
  await denied(() => p.issue(requestWithAdmin, periods, physical, later));
});
async function denied(
  work: () => unknown | Promise<unknown>,
  code = "security_policy_unavailable",
) {
  let error: unknown;
  try {
    await work();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
}
const concurrency: UsageDemand = {
  kind: "concurrent_jobs",
  scope: "GLOBAL",
  periodSeconds: 1n,
  units: 1n,
  capacity: 2n,
  ceiling: 3n,
};
function plan(r: BudgetRequest): ApprovedUsagePlan {
  const proof = policy().issue(r, periods, physical, NOW);
  assert(proof);
  return {
    status: "approved",
    owner: OWNER,
    operation: r.operation,
    policyVersion: VERSION,
    approvalReferenceSha256: HASH,
    memberTier: r.session.tier,
    examId: null,
    normalizedScoresSha256: null,
    calculationContextSha256: null,
    computation: "required",
    demands: [concurrency],
    administratorProof: proof,
    maximumResultBytes: physical.maximumResultBytes,
  };
}
function shared(
  r: BudgetRequest,
  options: {
    failSettle?: boolean;
    measure?: bigint;
    mutate?: (p: ApprovedUsagePlan) => ApprovedUsagePlan;
  } = {},
) {
  let now = NOW, workCount = 0;
  const events: string[] = [],
    settlements: unknown[] = [],
    reserves: UsageReservationRequest[] = [];
  const store: UsageBudgetStorePort = {
    reserve: (input) => {
      reserves.push(input);
      events.push("reserve");
      return Promise.resolve({
        allowed: true as const,
        lease: {
          id: "SYNTHETIC-lease",
          owner: OWNER,
          policyVersion: VERSION,
          createdAtUtc: now,
          expiresAtUtc: NOW + 30000000n,
        },
      });
    },
    settle: (_lease, outcome, usage) => {
      events.push("settle:" + outcome);
      settlements.push(usage?.resultBytes);
      return options.failSettle ? Promise.reject(new Error("SYNTHETIC")) : Promise.resolve();
    },
  };
  const budget = new SharedRequestBudget(
    {
      prepare: (input) => Promise.resolve(options.mutate?.(plan(input)) ?? plan(input)),
    },
    store,
    { nowUtc: () => now },
    { exists: () => Promise.resolve(false) },
    options.measure === undefined ? undefined : () => Promise.resolve(options.measure!),
  );
  return {
    budget,
    events,
    reserves,
    settlements,
    setNow: (value: bigint) => now = value,
    workCount: () => workCount,
    run: (value: unknown = { ok: true }) =>
      budget.run(r, () => {
        workCount++;
        events.push("work");
        return Promise.resolve(value);
      }),
  };
}
Deno.test("admin exemption proof requires a factory verified active aal2 administrator", async () => {
  const p = policy(), good = request(await session());
  assert(p.issue(good, periods, physical, NOW));
  for (
    const option of [{ role: "user", paid: true }, { status: "inactive" }, {
      aal: "aal1" as const,
    }]
  ) {
    assert(
      p.issue(request(await session(option)), periods, physical, NOW) ===
        undefined,
    );
  }
  const copied = Object.freeze({ ...good.session });
  await denied(
    () => p.issue(request(copied), periods, physical, NOW),
    "entitlement_unavailable",
  );
});
Deno.test("admin exemption policy rejects missing dimensions unknown fields purpose and approval", async () => {
  for (
    const change of [(r: NativeObject) => {
      r.daily_dimensions = [];
    }, (r: NativeObject) => {
      r.daily_dimensions = [...ADMINISTRATOR_DAILY_KINDS, "concurrent_jobs"];
    }, (r: NativeObject) => {
      r.purpose = "other";
    }, (r: NativeObject) => {
      r.approval_reference_sha256 = "b".repeat(64);
    }, (r: NativeObject) => {
      r.extra = true;
    }]
  ) {
    const value = raw();
    change(value);
    await denied(() => policy(value));
  }
});
Deno.test("admin exemption retains short periods and never exempts shared concurrency", async () => {
  const p = policy().issue(
    request(await session()),
    new Map([...periods, ["request_window", 60n], ["result_volume", 60n]]),
    physical,
    NOW,
  );
  assert(p);
  equal(p.exemptKinds, ["distinct_scores", "calculation_cost"]);
  assert(Object.isFrozen(p) && Object.isFrozen(p.exemptKinds));
});
Deno.test("admin proof binds owner operation session approval counter version and deadline", async () => {
  const r = request(await session()),
    p = policy().issue(r, periods, physical, NOW)!;
  const expected = {
    owner: OWNER,
    operation: r.operation,
    policyVersion: VERSION,
    session: r.session,
    approvalSha256: HASH,
  };
  equal(verifyAdministratorUsageProof(p, expected, NOW), [
    ...ADMINISTRATOR_DAILY_KINDS,
  ]);
  for (
    const patched of [
      { owner: "00000000-0000-0000-0000-000000000002" },
      { operation: "report.read" },
      { policyVersion: "SYNTHETIC-reset" },
      { session: await session() },
      { approvalSha256: "b".repeat(64) },
    ]
  ) {
    await denied(() => verifyAdministratorUsageProof(p, { ...expected, ...patched }, NOW));
  }
  await denied(() => verifyAdministratorUsageProof({ ...p }, expected, NOW));
  await denied(() => verifyAdministratorUsageProof(p, expected, NOW - 1n));
  await denied(() => verifyAdministratorUsageProof(p, expected, NOW + 20000000n));
});
Deno.test("admin proof retains finite per-request physical calculation and result caps", async () => {
  const r = request(await session());
  for (
    const patch of [{ calculationUnits: 11n }, { maximumResultBytes: 0n }, {
      maximumCalculationUnits: -1n,
    }]
  ) {
    await denied(() => policy().issue(r, periods, { ...physical, ...patch }, NOW));
  }
});
Deno.test("admin shared reservation omits daily counters and preserves the existing global demand", async () => {
  const r = request(await session()), f = shared(r);
  equal(await f.run(), { ok: true });
  equal(f.events, ["reserve", "work", "settle:success"]);
  equal(f.reserves[0].policyVersion, VERSION);
  equal(nativeJsonText(f.reserves[0].demands), nativeJsonText([concurrency]));
  assert(f.reserves[0].administratorProof);
});
Deno.test("admin shared admission rejects missing concurrency and forged proof before reserve", async () => {
  for (
    const mutate of [
      (p: ApprovedUsagePlan) => ({ ...p, demands: [] }),
      (p: ApprovedUsagePlan) => ({
        ...p,
        administratorProof: { ...p.administratorProof! },
      }),
      (p: ApprovedUsagePlan) => ({ ...p, maximumResultBytes: 65n }),
    ]
  ) {
    const r = request(await session()), f = shared(r, { mutate });
    await denied(() => f.run());
    equal(f.reserves.length, 0);
    equal(f.workCount(), 0);
  }
});
Deno.test("admin physical result overflow settles failure and never returns the body", async () => {
  const r = request(await session()), f = shared(r);
  await denied(() => f.run({ value: "x".repeat(64) }));
  equal(f.events, ["reserve", "work", "settle:failure"]);
});
Deno.test("admin representation measurement preserves an independent physical result bound", async () => {
  const r = request(await session()), pass = shared(r, { measure: 32n });
  await pass.run({ value: "x".repeat(128) });
  assert(pass.settlements[0] === 32n);
  const fail = shared(r, { measure: 65n });
  await denied(() => fail.run());
  equal(fail.events.at(-1), "settle:failure");
});
Deno.test("admin proof expiring before work still releases the admitted shared lease", async () => {
  const r = request(await session()),
    f = shared(r),
    admission = await f.budget.admit(r);
  f.setNow(NOW + 20000000n);
  await denied(() => f.budget.runAdmitted(admission, () => Promise.resolve({ ok: true })));
  equal(f.events, ["reserve", "settle:failure"]);
});
Deno.test("admin proof expiring during work releases lease and returns no result", async () => {
  const r = request(await session()),
    f = shared(r),
    admission = await f.budget.admit(r);
  await denied(() =>
    f.budget.runAdmitted(admission, () => {
      f.setNow(NOW + 20000000n);
      return Promise.resolve({ ok: true });
    })
  );
  equal(f.events, ["reserve", "settle:failure"]);
});
Deno.test("admin settlement failure is a safe error after a single business execution", async () => {
  const r = request(await session()), f = shared(r, { failSettle: true });
  await denied(() => f.run());
  equal(f.workCount(), 1);
  equal(f.events, ["reserve", "work", "settle:success"]);
});
Deno.test("admin cancellation remains possible after proof deadline without a new admission", async () => {
  const r = request(await session()),
    f = shared(r),
    admission = await f.budget.admit(r);
  f.setNow(NOW + 20000000n);
  await f.budget.cancel(admission);
  await f.budget.cancel(admission);
  equal(f.events, ["reserve", "settle:failure"]);
});
function sqlStore(now: bigint, used = 0n) {
  const calls: { s: string; p: readonly unknown[] }[] = [],
    events: string[] = [];
  let end = "";
  const pool: NativeSqlPool = {
    async transaction(_ro, work) {
      try {
        const result = await work({
          query: (s, p = []) => {
            calls.push({ s, p });
            if (s.startsWith("SET LOCAL ") || s === SUBJECT_CONTEXT_SQL) return Promise.resolve([]);
            if (s === RUNTIME_ROLE_SQL) {
              return Promise.resolve([[
                "jungsi_backend_app",
                false,
                false,
                "on",
                "off",
                false,
                false,
                false,
                "UTC",
              ]]);
            }
            if (s === USAGE_VERSION_SQL) return Promise.resolve([[true]]);
            if (s === USAGE_NOW_SQL) {
              return Promise.resolve([[
                utcText(now).replace(/(?<!\.[0-9]{6})Z$/, ".000000Z"),
              ]]);
            }
            if (s === USAGE_EXPIRED_SQL || s === USAGE_LOCK_SQL) {
              return Promise.resolve([]);
            }
            if (s === USAGE_WINDOW_INSERT_SQL) {
              end = String(p[6]);
              return Promise.resolve([]);
            }
            if (s === USAGE_WINDOW_READ_SQL) {
              return Promise.resolve([[
                "3",
                String(used),
                "0",
                end.replace(/(?<!\.[0-9]{6})Z$/, ".000000Z"),
              ]]);
            }
            if (s === USAGE_WINDOW_CHANGE_SQL) return Promise.resolve([["0"]]);
            if (s === USAGE_LEASE_INSERT_SQL) return Promise.resolve([]);
            throw new Error("unexpected SQL");
          },
        });
        events.push("commit");
        return result;
      } catch (e) {
        events.push("rollback");
        throw e;
      }
    },
    close: () => Promise.resolve(),
  };
  return {
    calls,
    events,
    store: new SupabaseUsageBudgetStore(new SupabaseSqlTransport(pool), {
      leaseSeconds: 30n,
      runtimeHardLimitSeconds: 20n,
      clockMarginSeconds: 5n,
    }),
  };
}
Deno.test("admin SQL reservation keeps the same counter key and validates proof at database time", async () => {
  const r = request(await session()),
    p = plan(r),
    input = {
      owner: OWNER,
      operation: r.operation,
      policyVersion: VERSION,
      demands: p.demands,
      administratorProof: p.administratorProof,
    };
  const good = sqlStore(NOW), decision = await good.store.reserve(input);
  assert(decision.allowed);
  const insertion = good.calls.find((x) => x.s === USAGE_WINDOW_INSERT_SQL)!;
  equal(insertion.p.slice(0, 5), [
    OWNER,
    VERSION,
    "GLOBAL",
    "concurrent_jobs",
    "1",
  ]);
  const expired = sqlStore(NOW + 20000000n);
  await denied(() => expired.store.reserve(input));
  equal(expired.events, ["rollback"]);
  assert(!expired.calls.some((x) => x.s === USAGE_WINDOW_INSERT_SQL));
});
Deno.test("admin SQL cannot omit global concurrency or waive an ordinary request window", async () => {
  const r = request(await session()),
    p = plan(r),
    input = {
      owner: OWNER,
      operation: r.operation,
      policyVersion: VERSION,
      demands: [concurrency],
      administratorProof: p.administratorProof,
    };
  for (
    const invalid of [{ ...input, administratorProof: undefined }, {
      ...input,
      demands: [],
    }, { ...input, administratorProof: { ...p.administratorProof! } }]
  ) {
    const f = sqlStore(NOW);
    await denied(() => f.store.reserve(invalid));
    equal(f.calls.length, 0);
  }
  const retainedDaily = {
    ...concurrency,
    kind: "request_window" as const,
    periodSeconds: 86400n,
  };
  await denied(() =>
    sqlStore(NOW).store.reserve({
      ...input,
      demands: [concurrency, retainedDaily],
    })
  );
});
Deno.test("admin v3 policy leaves ordinary and paid counter plans byte-equivalent to v1", async () => {
  const f = await syntheticRuntimeBinding((d) => {
      d.scope = {
        operations: ["history.search"],
        artifacts: [{ kind: "catalog", key: "service" }],
      };
    }),
    binding = await f.load();
  const base: NativeObject = {
    format: "jungsi.runtime-usage-policy/v1",
    status: "approved",
    purpose: "jungsi-api-runtime",
    version: VERSION,
    approval_reference_sha256: HASH,
    expires_at: "2026-10-15T00:01:00Z",
    exams: [],
    dimensions: [...periods].map(([kind, period]) => ({
      kind,
      period_seconds: period,
      standard: 2,
      paid: 3,
      ceiling: 3,
    })),
    operations: [{
      operation: "history.search",
      reserved_result_bytes: 2,
      base_units: 0,
      per_offering_units: 0,
    }],
  };
  const revised: NativeObject = {
    ...cloneNativeJson(base),
    format: "jungsi.runtime-usage-policy/v3",
    policy_revision: "SYNTHETIC-admin-v1",
    administrator_policy: raw(),
  };
  const make = (value: NativeObject) =>
    new RuntimeUsagePolicy(
      new TextEncoder().encode(nativeJsonText(value)),
      binding,
      new SyntheticNativeRepository(),
      { nowUtc: () => NOW },
      { exists: () => Promise.resolve(false) },
    );
  for (const paid of [false, true]) {
    const r = request(await session({ role: "user", paid }));
    equal(
      nativeJsonText(await make(revised).prepare(r)),
      nativeJsonText(await make(base).prepare(r)),
    );
  }
  const p = await make(revised).prepare(request(await session()));
  assert(p.administratorProof);
  equal(p.demands.map((d) => d.kind), ["concurrent_jobs"]);
  equal(p.policyVersion, VERSION);
  assert(make(revised).operating === null);
  const broken = { ...revised, operating_policy: {} };
  await denied(() => make(broken));
});
