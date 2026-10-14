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
