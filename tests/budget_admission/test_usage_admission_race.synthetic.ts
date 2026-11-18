import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type ApprovedUsagePlan,
  SharedRequestBudget,
} from "../../supabase/functions/_shared/jungsi/application/usage_service.ts";
import type { BudgetRequest } from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import type { UsageReservationDecision } from "../../supabase/functions/_shared/jungsi/application/usage_budget.ts";
import { assert, equal, syncPromise } from "../edge/fixture.ts";
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
    settleHook?: (outcome: "success" | "failure") => Promise<void>;
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
          return options.settleHook?.(outcome);
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

Deno.test("running admission cannot be cancelled before physical work finishes", async () => {
  const f = fixture(), r = request(), admission = await f.budget.admit(r);
  let start!: () => void, resume!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const running = f.budget.runAdmitted(admission, async () => {
    start();
    await held;
    return { safe: "SYNTHETIC" };
  }, r);
  await started;
  let error: unknown;
  try {
    await f.budget.cancel(admission);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof AccessError);
  equal(error.http, 503);
  equal(f.events, ["plan", "reserve"]);
  resume();
  await running;
  equal(f.events, ["plan", "reserve", "success"]);
});
Deno.test("concurrent cancellations share one failure settlement", async () => {
  const f = fixture(), r = request(), admission = await f.budget.admit(r);
  await Promise.all([f.budget.cancel(admission), f.budget.cancel(admission)]);
  await f.budget.cancel(admission);
  equal(f.events, ["plan", "reserve", "failure"]);
  let error: unknown;
  try {
    await f.budget.runAdmitted(admission, f.work, r);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof AccessError);
  equal(error.http, 503);
  equal(f.executions(), 0);
});
Deno.test("post-rollback cleanup may settle a completed failure again", async () => {
  const f = fixture(), r = request(), admission = await f.budget.admit(r);
  let error: unknown;
  try {
    await f.budget.runAdmitted(
      admission,
      () => Promise.reject(new AccessError("revision_conflict", 409)),
      r,
    );
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof AccessError);
  equal(error.http, 409);
  // The first settlement may have been rolled back with the surrounding input transaction.
  await f.budget.cancel(admission);
  equal(f.events, ["plan", "reserve", "failure", "failure"]);
});
Deno.test("failed settlement remains eligible for rollback cleanup", async () => {
  const f = fixture(plan(), { settleFailure: true }),
    r = request(),
    admission = await f.budget.admit(r);
  let first: unknown, second: unknown;
  try {
    await f.budget.runAdmitted(admission, f.work, r);
  } catch (caught) {
    first = caught;
  }
  try {
    await f.budget.cancel(admission);
  } catch (caught) {
    second = caught;
  }
  assert(first instanceof AccessError && second instanceof AccessError);
  equal([first.http, second.http], [503, 503]);
  equal(f.events, ["plan", "reserve", "work", "success", "failure"]);
});
Deno.test("concurrent cancellation shares delayed store failure and a later cleanup can retry", async () => {
  let release!: () => void, attempts = 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(plan(), {
    settleHook: async () => {
      attempts++;
      if (attempts === 1) {
        await held;
        throw new Error("SYNTHETIC-STORE-FAILURE");
      }
    },
  });
  const r = request(), admission = await f.budget.admit(r);
  const first = f.budget.cancel(admission), second = f.budget.cancel(admission);
  equal(attempts, 1);
  release();
  const failures = await Promise.allSettled([first, second]);
  for (const failure of failures) {
    assert(failure.status === "rejected");
    assert(failure.reason instanceof AccessError);
    equal(failure.reason.http, 503);
  }
  equal(f.events, ["plan", "reserve", "failure"]);
  await f.budget.cancel(admission);
  equal(attempts, 2);
  equal(f.events, ["plan", "reserve", "failure", "failure"]);
});
Deno.test("rolled-back successful settlement is compensated after the outer transaction", async () => {
  let durable = "active", staged: string | null = null, outerActive = true;
  const f = fixture(plan(), {
    settleHook: (outcome) => {
      if (outerActive) staged = outcome;
      else durable = outcome;
      return Promise.resolve();
    },
  });
  const r = request(), admission = await f.budget.admit(r);
  await f.budget.runAdmitted(admission, f.work, r);
  equal(staged, "success");
  equal(durable, "active");
  // Synthetic outer transaction rollback: provisional success is lost.
  staged = null;
  outerActive = false;
  await f.budget.cancel(admission);
  equal(durable, "failure");
  equal(f.events, ["plan", "reserve", "work", "success", "failure"]);
});
