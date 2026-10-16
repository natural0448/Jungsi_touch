import {
  readSessionSnapshot,
  requirePaidSession,
  sessionDto,
  type SessionSnapshot,
} from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import { syncPromise } from "./fixture.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type ApprovedUsagePlan,
  RepositoryUsageReplays,
  SharedRequestBudget,
} from "../../supabase/functions/_shared/jungsi/application/usage_service.ts";
import {
  type BudgetRequest,
  RequestLimitError,
} from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import type { UsageReservationDecision } from "../../supabase/functions/_shared/jungsi/application/usage_budget.ts";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001", NOW = 1700000000000000n;
function request(): BudgetRequest {
  return {
    operation: "overall.analyze",
    session: {
      user: { subjectId: OWNER, expiresAtUtc: NOW + 1000000n },
      evaluatedAtUtc: NOW,
      tier: "standard",
      paidUntilUtc: null,
    },
    body: { scores: "SYNTHETIC" },
    params: {},
    query: {},
    requestKey: "SYNTHETIC-key",
  };
}
function plan(): ApprovedUsagePlan {
  const d = {
    scope: "GLOBAL",
    periodSeconds: 60n,
    capacity: 10n,
    ceiling: 20n,
    units: 1n,
  };
  return {
    status: "approved",
    policyVersion: "SYNTHETIC-policy.v1",
    approvalReferenceSha256: "a".repeat(64),
    owner: OWNER,
    operation: "overall.analyze",
    memberTier: "standard",
    examId: "SYNTHETIC-exam",
    normalizedScoresSha256: "b".repeat(64),
    calculationContextSha256: "c".repeat(64),
    computation: "required",
    demands: [
      { ...d, kind: "request_window" },
      { ...d, kind: "concurrent_jobs", periodSeconds: 1n },
      {
        ...d,
        kind: "result_volume",
        capacity: 10000n,
        ceiling: 20000n,
        units: 1024n,
      },
      { ...d, kind: "calculation_cost", scope: "SYNTHETIC-exam" },
      {
        ...d,
        kind: "distinct_scores",
        scope: "SYNTHETIC-exam",
        fingerprint: "b".repeat(64),
      },
    ],
  };
}
function fixture(
  p: ApprovedUsagePlan | null = plan(),
  options: {
    refuse?: boolean;
    storeFailure?: boolean;
    settleFailure?: boolean;
    replay?: boolean;
  } = {},
) {
  const events: string[] = [];
  let executions = 0;
  const budget = new SharedRequestBudget(
    {
      prepare() {
        return syncPromise(() => {
          events.push("plan");
          return p;
        });
      },
    },
    {
      reserve(r) {
        return syncPromise(() => {
          events.push("reserve");
          if (options.storeFailure) throw new Error("SYNTHETIC-PRIVATE");
          return options.refuse
            ? {
              allowed: false,
              code: "rate_limit_exceeded",
              retryAfterSeconds: 7,
            }
            : {
              allowed: true,
              lease: {
                id: "00000000-0000-0000-0000-000000000002",
                owner: r.owner,
                policyVersion: r.policyVersion,
                createdAtUtc: NOW,
                expiresAtUtc: NOW + 10000000n,
              },
            } as UsageReservationDecision;
        });
      },
      settle(_l, outcome) {
        return syncPromise(() => {
          events.push(outcome);
          if (options.settleFailure) throw new Error("SYNTHETIC-PRIVATE");
        });
      },
    },
    { nowUtc: () => NOW },
    {
      exists() {
        return syncPromise(() => {
          events.push("replay");
          return options.replay === true;
        });
      },
    },
  );
  return {
    budget,
    events,
    work: () =>
      syncPromise(() => {
        executions++;
        events.push("work");
        return { safe: "SYNTHETIC" };
      }),
    executions: () => executions,
  };
}
async function denied(
  run: () => Promise<unknown>,
  code = "security_policy_unavailable",
  http = 503,
) {
  let e: unknown;
  try {
    await run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, http);
  return e;
}
Deno.test("shared budget reserves before business and settles before returning approved result", async () => {
  const f = fixture();
  equal(await f.budget.run(request(), f.work), { safe: "SYNTHETIC" });
  equal(f.events, ["plan", "reserve", "work", "success"]);
});
Deno.test("shared budget missing unapproved tier owner operation or incomplete policies fail before work", async () => {
  const base = plan();
  for (
    const p of [
      null,
      { ...base, status: "draft" },
      { ...base, memberTier: "paid" },
      { ...base, owner: "SYNTHETIC-other" },
      { ...base, operation: "candidates.build" },
      { ...base, demands: base.demands.slice(1) },
    ]
  ) {
    const f = fixture(p as ApprovedUsagePlan | null);
    await denied(() => f.budget.run(request(), f.work));
    equal(f.executions(), 0);
    assert(!f.events.includes("reserve"));
  }
});
Deno.test("shared budget refuses query/profile identifiers as replacement quota scopes", async () => {
  const p = plan();
  const f = fixture({
    ...p,
    demands: p.demands.map((d) => ({
      ...d,
      scope: "SYNTHETIC-rotating-report-id",
    })),
  });
  await denied(() => f.budget.run(request(), f.work));
  equal(f.executions(), 0);
});
Deno.test("shared budget refusal returns typed 429 retry time and cannot execute business", async () => {
  const f = fixture(plan(), { refuse: true }),
    e = await denied(
      () => f.budget.run(request(), f.work),
      "rate_limit_exceeded",
      429,
    );
  assert(e instanceof RequestLimitError);
  equal(e.retryAfterSeconds, 7);
  equal(f.executions(), 0);
});
Deno.test("shared budget store or settlement failure is safe 503 and never an unlimited result", async () => {
  for (const options of [{ storeFailure: true }, { settleFailure: true }]) {
    const f = fixture(plan(), options);
    await denied(() => f.budget.run(request(), f.work));
  }
});
Deno.test("shared budget business conflict is settled as failure with original safe error", async () => {
  const f = fixture();
  await denied(
    () =>
      f.budget.run(request(), () =>
        syncPromise(() => {
          throw new AccessError("revision_conflict", 409);
        })),
    "revision_conflict",
    409,
  );
  equal(f.events, ["plan", "reserve", "failure"]);
});
Deno.test("shared budget zero compute requires actual verified replay and still spends request budget", async () => {
  const p = plan(),
    replay: ApprovedUsagePlan = {
      ...p,
      computation: "idempotent_replay",
      demands: p.demands.map((d) => d.kind === "calculation_cost" ? { ...d, units: 0n } : d),
    };
  const f = fixture(replay, { replay: true });
  await f.budget.run(request(), f.work);
  equal(f.events, ["plan", "replay", "reserve", "work", "success"]);
  const missing = fixture(replay);
  await denied(() => missing.budget.run(request(), missing.work));
  equal(missing.executions(), 0);
  const unsafe = fixture({ ...p, demands: replay.demands });
  await denied(() => unsafe.budget.run(request(), unsafe.work));
});
Deno.test("shared budget normalized fingerprint is bound independently of request key and profile ID", async () => {
  const p = plan(),
    f = fixture({
      ...p,
      demands: p.demands.map((d) =>
        d.kind === "distinct_scores" ? { ...d, fingerprint: "d".repeat(64) } : d
      ),
    });
  await denied(() => f.budget.run(request(), f.work));
});
Deno.test("repository budget replay reads exact owner operation key and native request digest", async () => {
  const repo = new SyntheticNativeRepository(),
    r = request(),
    digest = await nativeJsonSha256([r.body, r.params]);
  await repo.createProfile({
    owner: OWNER,
    scores: { fixture: "SYNTHETIC" },
    confirmed: false,
    nowUtc: NOW,
    key: r.requestKey!,
    digest,
    operation: "score-profile.create",
  });
  const checker = new RepositoryUsageReplays(repo);
  equal(
    await checker.exists({ ...r, operation: "score-profile.create" }),
    true,
  );
  equal(await checker.exists(r), false);
  await denied(
    () =>
      checker.exists({
        ...r,
        operation: "score-profile.create",
        body: { changed: true },
      }),
    "idempotency_conflict",
    409,
  );
});

async function trustedBudgetSession(options: {
  owner?: string;
  role?: string;
  status?: string;
  aal?: "aal1" | "aal2";
  expiry?: bigint;
} = {}): Promise<SessionSnapshot> {
  const owner = options.owner ?? OWNER;
  return await readSessionSnapshot("SYNTHETIC-budget-token", {
    verifyUserBearer: () =>
      Promise.resolve({
        subjectId: owner,
        expiresAtUtc: options.expiry ?? NOW + 1000000n,
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
        paidUntilUtc: null,
      }),
  }, NOW);
}
function sessionIdentityBudget(
  inspect: (protectedRequest: BudgetRequest) => void = () => {},
  now = NOW,
) {
  const owners: string[] = [];
  let planned = 0, worked = 0, settled = 0;
  const budget = new SharedRequestBudget(
    {
      prepare: (r) =>
        syncPromise(() => {
          planned++;
          inspect(r);
          sessionDto(r.session, now);
          return { ...plan(), owner: r.session.user.subjectId, memberTier: r.session.tier };
        }),
    },
    {
      reserve: (r) => {
        owners.push(r.owner);
        return Promise.resolve({
          allowed: true as const,
          lease: {
            id: "SYNTHETIC-lease",
            owner: r.owner,
            policyVersion: r.policyVersion,
            createdAtUtc: now,
            expiresAtUtc: now + 10000000n,
          },
        });
      },
      settle: () => {
        settled++;
        return Promise.resolve();
      },
    },
    { nowUtc: () => now },
    { exists: () => Promise.resolve(false) },
  );
  return {
    budget,
    owners,
    counts: () => ({ planned, worked, settled }),
    work: () => {
      worked++;
      return Promise.resolve({ ok: true });
    },
  };
}
Deno.test("shared budget retains verified frozen admin identity and blocks planner authorization mutation", async () => {
  const session = await trustedBudgetSession(), r = { ...request(), session };
  const f = sessionIdentityBudget((protectedRequest) => {
    assert(protectedRequest.session === session);
    assert(protectedRequest.session.user === session.user);
    assert(Object.isFrozen(protectedRequest.session));
    assert(Object.isFrozen(protectedRequest.session.user));
    equal(Reflect.set(protectedRequest.session, "tier", "standard"), false);
    equal(Reflect.set(protectedRequest.session, "paidUntilUtc", NOW + 1n), false);
    equal(Reflect.set(protectedRequest.session.user, "subjectId", "SYNTHETIC-other"), false);
    equal(Reflect.set(protectedRequest.session.user, "accountRole", "user"), false);
  });
  equal(await f.budget.run(r, f.work), { ok: true });
  equal(f.owners, [OWNER]);
  equal(f.counts(), { planned: 1, worked: 1, settled: 1 });
  equal(sessionDto(session, NOW).member_tier, "paid");
});
Deno.test("shared budget keeps body query params copies and clones every mutable authorization shape", async () => {
  for (const frozenSession of [false, true]) {
    for (const frozenUser of [false, true]) {
      const original = request(), user = { ...original.session.user };
      if (frozenUser) Object.freeze(user);
      const session = { ...original.session, user };
      if (frozenSession) Object.freeze(session);
      const body = { scores: { marker: "SYNTHETIC-original" } },
        query = { key: "SYNTHETIC-query" },
        params = { report_id: "SYNTHETIC-report" };
      const r = { ...original, session, body, query, params };
      const f = sessionIdentityBudget((p) => {
        equal(p.session === session, frozenSession && frozenUser);
        equal(p.session.user === user, frozenSession && frozenUser);
        assert(Object.isFrozen(p.session) && Object.isFrozen(p.session.user));
        equal(Reflect.set(p.session, "tier", "paid"), false);
        equal(Reflect.set(p.session.user, "subjectId", "SYNTHETIC-other"), false);
        assert(p.query !== query && p.params !== params && p.body !== body);
        assert(Object.isFrozen(p.query) && Object.isFrozen(p.params));
        equal(Reflect.set(p.query, "key", "SYNTHETIC-mutated"), false);
        equal(Reflect.set(p.params, "report_id", "SYNTHETIC-mutated"), false);
        const copied = p.body as { scores: { marker: string } };
        assert(copied.scores !== body.scores);
        copied.scores.marker = "SYNTHETIC-private-copy";
      });
      await f.budget.run(r, f.work);
      equal(body.scores.marker, "SYNTHETIC-original");
      equal(query.key, "SYNTHETIC-query");
      equal(params.report_id, "SYNTHETIC-report");
      equal(session.tier, "standard");
      equal(session.user.subjectId, OWNER);
      equal(f.counts(), { planned: 1, worked: 1, settled: 1 });
    }
  }
});
Deno.test("shared budget rejects copied admin brands and keeps verified owners isolated", async () => {
  const first = await trustedBudgetSession(),
    second = await trustedBudgetSession({ owner: "00000000-0000-0000-0000-000000000002" }),
    f = sessionIdentityBudget();
  for (const session of [first, second]) {
    await f.budget.run({ ...request(), session }, f.work);
  }
  equal(f.owners, [first.user.subjectId, second.user.subjectId]);
  for (
    const session of [
      Object.freeze({ ...first }),
      Object.freeze({ ...first, user: Object.freeze({ ...first.user }) }),
      Object.freeze({ ...first, user: second.user }),
    ]
  ) {
    await denied(() => f.budget.run({ ...request(), session }, f.work), "entitlement_unavailable");
  }
  equal(f.counts(), { planned: 2, worked: 2, settled: 2 });
  equal(f.owners.length, 2);
});
Deno.test("shared budget keeps expiry inactive aal1 and role qualification boundaries", async () => {
  const expired = await trustedBudgetSession({ expiry: NOW + 1n }),
    expiredBudget = sessionIdentityBudget(() => {}, NOW + 1n);
  await denied(
    () => expiredBudget.budget.run({ ...request(), session: expired }, expiredBudget.work),
    "authentication_required",
    401,
  );
  equal(expiredBudget.counts(), { planned: 0, worked: 0, settled: 0 });
  for (const options of [{ status: "inactive" }, { aal: "aal1" as const }, { role: "user" }]) {
    const session = await trustedBudgetSession(options), f = sessionIdentityBudget();
    equal(session.tier, "standard");
    await denied(() => syncPromise(() => requirePaidSession(session, NOW)), "paid_required", 403);
    const forged = Object.freeze({
      ...session,
      tier: "paid" as const,
      paidUntilUtc: null,
      adminOrigin: "verified_own_profile_active_admin_aal2" as const,
    });
    await denied(
      () => f.budget.run({ ...request(), session: forged }, f.work),
      "entitlement_unavailable",
    );
    equal(f.counts(), { planned: 0, worked: 0, settled: 0 });
  }
});
