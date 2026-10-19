import { readSessionSnapshot } from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
/** Invented capacities and policy metadata. No real quota approval or DB counters. */
import {
  RuntimeRequestBudget,
  RuntimeUsagePolicy,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts";
import {
  BUDGET_OPERATIONS,
  type BudgetRequest,
} from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { SyntheticUniversityData } from "./synthetic_university.ts";
import { SYNTHETIC_RUNTIME_NOW, syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { assert, equal } from "./fixture.ts";
import type { UsageBudgetStorePort } from "../../supabase/functions/_shared/jungsi/application/usage_budget.ts";
import type { SupabaseRuntimeControls } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
const OWNER = "SYNTHETIC-owner";
async function fixture(change: (policy: NativeObject) => void = () => {}, operations?: string[]) {
  const source = new SyntheticUniversityData(), scores = source.scores();
  const f = await syntheticRuntimeBinding((d) => {
    d.scope = {
      operations: operations ?? (d.scope as NativeObject).operations,
      artifacts: [{ kind: "exam_pack", key: scores.exam_id }, {
        kind: "catalog",
        key: "service",
      }],
    };
  });
  const binding = await f.load(),
    repository = new SyntheticNativeRepository();
  const policy: NativeObject = {
    format: "jungsi.runtime-usage-policy/v1",
    status: "approved",
    purpose: "jungsi-api-runtime",
    version: "SYNTHETIC-usage-v1",
    approval_reference_sha256: binding.approvalReferenceSha256,
    expires_at: "2026-10-15T01:00:00Z",
    exams: [{
      exam_id: scores.exam_id,
      pack_version: scores.pack_version,
      academic_year: 2027,
      eligible_offering_count: 7,
    }],
    dimensions: [
      "request_window",
      "distinct_scores",
      "calculation_cost",
      "concurrent_jobs",
      "result_volume",
    ].map((kind) => ({
      kind,
      period_seconds: kind === "concurrent_jobs" ? 1 : 60,
      ceiling: 10000,
      standard: 1000,
      paid: 2000,
    })),
    operations: BUDGET_OPERATIONS.map((operation) => ({
      operation,
      reserved_result_bytes: 512,
      base_units: [
          "score-profile.create",
          "overall.analyze",
          "university.analyze",
          "candidates.build",
        ].includes(operation)
        ? 2
        : 0,
      per_offering_units: 3,
    })),
  };
  change(policy);
  let replay = false;
  const planner = () =>
    new RuntimeUsagePolicy(
      new TextEncoder().encode(nativeJsonText(policy)),
      binding,
      repository,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      {
        exists() {
          return Promise.resolve(replay);
        },
      },
      "legacy_synthetic",
    );
  function request(
    operation = "overall.analyze",
    body: NativeObject = scores,
  ): BudgetRequest {
    return {
      operation,
      session: {
        user: {
          subjectId: OWNER,
          expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 3600000000n,
          assuranceLevel: "aal1",
          accountStatus: "active",
        },
        evaluatedAtUtc: SYNTHETIC_RUNTIME_NOW,
        tier: "paid",
        paidUntilUtc: SYNTHETIC_RUNTIME_NOW + 1800000000n,
      },
      body,
      params: {},
      query: {},
      requestKey: "SYNTHETIC-key",
    };
  }
  return {
    planner,
    policy,
    binding,
    repository,
    scores,
    request,
    replay: () => {
      replay = true;
    },
  };
}
async function denied(run: () => unknown, http: number) {
  let error: unknown;
  try {
    await run();
  } catch (value) {
    error = value;
  }
  assert(error instanceof AccessError);
  equal(error.http, http);
}
Deno.test("runtime budget requires a policy version and explicit approved purpose and dimensions", async () => {
  for (
    const change of [(p: NativeObject) => {
      delete p.version;
    }, (p: NativeObject) => {
      p.status = "prepared";
    }, (p: NativeObject) => {
      p.purpose = "legacy-review";
    }, (p: NativeObject) => {
      p.dimensions = [];
    }]
  ) {
    const f = await fixture(change);
    await denied(f.planner, 503);
  }
});
Deno.test("runtime budget emits all required dimensions with a global concurrency sentinel", async () => {
  const f = await fixture(), plan = await f.planner().prepare(f.request());
  equal(plan.owner, OWNER);
  equal(plan.examId, f.scores.exam_id);
  equal(plan.demands.length, 5);
  const concurrency = plan.demands.find((d) => d.kind === "concurrent_jobs")!;
  equal(concurrency.scope, "GLOBAL");
  equal(concurrency.periodSeconds.toString(), "1");
  equal(
    plan.demands.find((d) => d.kind === "calculation_cost")!.units.toString(),
    "2",
  );
});
Deno.test("runtime budget rejects unregistered exam and changed pack instead of rotating counter scopes", async () => {
  const patches: NativeObject[] = [{ exam_id: "SYNTHETIC-forged" }, {
    pack_version: "SYNTHETIC-forged",
  }];
  for (const patch of patches) {
    const f = await fixture();
    await denied(
      () =>
        f.planner().prepare(
          f.request("overall.analyze", { ...f.scores, ...patch }),
        ),
      422,
    );
  }
});
Deno.test("runtime budget resolves owner profiles and keeps fingerprints across profile ID rotation", async () => {
  const f = await fixture();
  f.repository.profiles.set("SYNTHETIC-p1", {
    profile_id: "SYNTHETIC-p1",
    owner_id: OWNER,
    scores: f.scores,
    confirmed: true,
    created_at: "2026-10-15T00:00:00Z",
  });
  f.repository.profiles.set("SYNTHETIC-p2", {
    profile_id: "SYNTHETIC-p2",
    owner_id: OWNER,
    scores: cloneNativeJson(f.scores),
    confirmed: true,
    created_at: "2026-10-15T00:00:00Z",
  });
  const planner = f.planner(),
    first = await planner.prepare(
      f.request("overall.analyze", { profile_id: "SYNTHETIC-p1" }),
    );
  const second = await planner.prepare(
    f.request("overall.analyze", { profile_id: "SYNTHETIC-p2" }),
  );
  equal(first.normalizedScoresSha256, second.normalizedScoresSha256);
  equal(
    first.demands.find((d) => d.kind === "distinct_scores")!.fingerprint,
    second.demands.find((d) => d.kind === "distinct_scores")!.fingerprint,
  );
  await denied(
    () =>
      planner.prepare(
        f.request("overall.analyze", { profile_id: "SYNTHETIC-other" }),
      ),
    404,
  );
});
Deno.test("runtime budget read operations keep request concurrency and result limits", async () => {
  const f = await fixture(),
    plan = await f.planner().prepare(f.request("history.search", {}));
  equal(plan.examId, null);
  equal(plan.demands.map((d) => d.kind), [
    "request_window",
    "concurrent_jobs",
    "result_volume",
  ]);
  equal(
    plan.demands.find((d) => d.kind === "result_volume")!.units.toString(),
    "512",
  );
});
Deno.test("runtime budget preserves zero compute only for the verified replay port", async () => {
  const f = await fixture(), planner = f.planner();
  equal((await planner.prepare(f.request())).computation, "required");
  f.replay();
  const saved = await planner.prepare(f.request());
  equal(saved.computation, "idempotent_replay");
  equal(
    saved.demands.find((d) => d.kind === "calculation_cost")!.units.toString(),
    "0",
  );
});
Deno.test("runtime budget refuses boolean decimal exponent capacities and inconsistent tier ceilings", async () => {
  for (const value of [true, null, new JsonFloat("1000e0"), 10001]) {
    const f = await fixture((p) => {
      (p.dimensions as NativeObject[])[0].standard = value;
    });
    await denied(f.planner, 503);
  }
});
Deno.test("runtime budget malformed request body stays 422 and cannot become an approved plan", async () => {
  const f = await fixture();
  await denied(() => f.planner().prepare({ ...f.request(), body: null }), 422);
});

Deno.test("runtime budget invalid server policy exam identifiers remain a dependency failure", async () => {
  for (const field of ["exam_id", "pack_version"]) {
    const f = await fixture((p) => {
      (p.exams as NativeObject[])[0][field] = "SYNTHETIC invalid";
    });
    await denied(() => f.planner(), 503);
  }
});

Deno.test("runtime subject-only budget preserves absent and null unused offering counts", async () => {
  for (const present of [false, true]) {
    const f = await fixture((p) => {
      const exam = (p.exams as NativeObject[])[0];
      if (present) exam.eligible_offering_count = null;
      else Reflect.deleteProperty(exam, "eligible_offering_count");
    }, ["score-profile.create", "overall.analyze", "report.read"]);
    const policy = f.planner(), exam = policy.exams.get(f.scores.exam_id as string)!;
    equal(Object.hasOwn(exam, "eligibleOfferingCount"), present);
    equal(exam.eligibleOfferingCount, present ? null : undefined);
    const plan = await policy.prepare(f.request());
    assert(plan.demands.some((d) => d.kind === "calculation_cost" && d.units > 0n));
    await denied(() => policy.prepare(f.request("candidates.build")), 503);
  }
});
Deno.test("runtime candidate-enabled budget still requires a verified native offering count", async () => {
  for (const present of [false, true]) {
    const f = await fixture((p) => {
      const exam = (p.exams as NativeObject[])[0];
      if (present) exam.eligible_offering_count = null;
      else Reflect.deleteProperty(exam, "eligible_offering_count");
    });
    await denied(() => f.planner(), 503);
  }
});

Deno.test("runtime subject-only budget still rejects non-native unused count values", async () => {
  for (const value of [true, "0", new JsonFloat("0.0")]) {
    const f = await fixture((p) => {
      (p.exams as NativeObject[])[0].eligible_offering_count = value;
    }, ["overall.analyze"]);
    await denied(() => f.planner(), 503);
  }
});

async function observedBudgetFixture(failSettle = false) {
  const f = await fixture();
  const calls = { reserve: 0, settle: 0, current: 0, work: 0 };
  const store: UsageBudgetStorePort = {
    reserve(request) {
      calls.reserve++;
      return Promise.resolve({
        allowed: true,
        lease: {
          id: "SYNTHETIC-lease",
          owner: request.owner,
          policyVersion: request.policyVersion,
          createdAtUtc: SYNTHETIC_RUNTIME_NOW,
          expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 10000000n,
        },
      });
    },
    settle() {
      calls.settle++;
      return failSettle
        ? Promise.reject(new Error("SYNTHETIC-private-database-error"))
        : Promise.resolve();
    },
  };
  const controls = {
    current() {
      calls.current++;
      return Promise.resolve();
    },
  } as unknown as SupabaseRuntimeControls;
  const budget = new RuntimeRequestBudget(f.planner(), store, {
    nowUtc: () => SYNTHETIC_RUNTIME_NOW,
  }, {
    exists() {
      return Promise.resolve(false);
    },
  }, controls);
  return { f, calls, budget };
}
Deno.test("observed runtime budget preserves one reserve work settle and phase order", async () => {
  const { f, calls, budget } = await observedBudgetFixture(), stages: string[] = [];
  const value = await budget.run(f.request(), () => {
    calls.work++;
    return Promise.resolve({ ok: true });
  }, (stage) => {
    stages.push(stage);
  });
  equal(value, { ok: true });
  equal(calls.reserve, 1);
  equal(calls.settle, 1);
  equal(calls.work, 1);
  equal(calls.current, 4);
  equal(stages, [
    "budget_current",
    "budget_plan",
    "budget_reserve",
    "budget_business_current",
    "budget_business",
    "budget_business_current",
    "budget_settle_success",
    "budget_final_current",
  ]);
});
Deno.test("throwing or asynchronously rejected phase observers preserve work and pre-reserve rejection", async () => {
  for (const asyncFailure of [false, true]) {
    for (const invalidExam of [false, true]) {
      const { f, calls, budget } = await observedBudgetFixture();
      const body = cloneNativeJson(f.scores);
      if (invalidExam) body.exam_id = "SYNTHETIC-wrong-exam";
      let thrown: unknown;
      try {
        await budget.run(f.request("overall.analyze", body), () => {
          calls.work++;
          return Promise.resolve({});
        }, () => {
          if (asyncFailure) {
            return Promise.reject(new Error("SYNTHETIC-observer-failure")) as unknown as void;
          }
          throw new Error("SYNTHETIC-observer-failure");
        });
      } catch (e) {
        thrown = e;
      }
      await Promise.resolve();
      equal(calls.reserve, invalidExam ? 0 : 1);
      equal(calls.settle, invalidExam ? 0 : 1);
      equal(calls.work, invalidExam ? 0 : 1);
      if (invalidExam) {
        assert(thrown instanceof AccessError);
        equal(thrown.http, 422);
        equal(thrown.code, "exam_not_available");
      } else equal(thrown, undefined);
    }
  }
});
Deno.test("successful failure settlement restores the original business failure phase and code", async () => {
  const { f, calls, budget } = await observedBudgetFixture();
  let current = "entry", thrown: unknown;
  try {
    await budget.run(f.request(), () => {
      calls.work++;
      current = "profile_store";
      return Promise.reject(new AccessError("invalid_request", 422));
    }, (stage) => {
      const before = current;
      current = stage;
      return () => {
        current = before;
        return Promise.reject(new Error("SYNTHETIC-restore-observer")) as unknown as void;
      };
    });
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof AccessError);
  equal(thrown.http, 422);
  equal(thrown.code, "invalid_request");
  equal(current, "profile_store");
  equal(calls.work, 1);
  equal(calls.reserve, 1);
  equal(calls.settle, 1);
});
Deno.test("failed settlement stays distinct after successful or failed business and never repeats it", async () => {
  for (const workFails of [false, true]) {
    const { f, calls, budget } = await observedBudgetFixture(true);
    let current = "entry", thrown: unknown;
    try {
      await budget.run(f.request(), () => {
        calls.work++;
        current = "profile_after_store";
        return workFails
          ? Promise.reject(new AccessError("invalid_request", 422))
          : Promise.resolve({});
      }, (stage) => {
        const before = current;
        current = stage;
        return () => {
          current = before;
        };
      });
    } catch (e) {
      thrown = e;
    }
    assert(thrown instanceof AccessError);
    equal(thrown.http, 503);
    equal(thrown.code, "security_policy_unavailable");
    equal(current, workFails ? "budget_settle_failure" : "budget_settle_success");
    equal(calls.work, 1);
    equal(calls.reserve, 1);
    equal(calls.settle, 1);
  }
});

async function runtimeTrustedSession(kind: "standard" | "paid" | "admin_null" | "admin_paid") {
  const admin = kind.startsWith("admin"), paid = kind === "paid" || kind === "admin_paid";
  return await readSessionSnapshot("SYNTHETIC-runtime-token", {
    verifyUserBearer: () =>
      Promise.resolve({
        subjectId: OWNER,
        expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 3600000000n,
        accountRole: admin ? "admin" : "user",
        accountStatus: "active",
        assuranceLevel: admin ? "aal2" as const : "aal1" as const,
      }),
  }, {
    readCurrent: () =>
      Promise.resolve({
        authority: "public.jeongsi_passes" as const,
        metadataVerified: true as const,
        subjectId: OWNER,
        evaluatedAtUtc: SYNTHETIC_RUNTIME_NOW,
        paidUntilUtc: paid ? SYNTHETIC_RUNTIME_NOW + 1800000000n : null,
      }),
  }, SYNTHETIC_RUNTIME_NOW);
}
Deno.test("runtime approved plan supports verified admin without a pass and standard explicit paid controls", async () => {
  for (const kind of ["standard", "paid", "admin_null", "admin_paid"] as const) {
    const f = await fixture(),
      session = await runtimeTrustedSession(kind),
      r = { ...f.request("score-profile.create", { scores: f.scores, confirmed: true }), session };
    let reserved = 0, worked = 0, settled = 0;
    const store: UsageBudgetStorePort = {
      reserve: (value) => {
        reserved++;
        equal(value.owner, session.user.subjectId);
        equal(value.demands.length, 5);
        assert(
          value.demands.every((d) =>
            [d.capacity, d.ceiling, d.units, d.periodSeconds].every((v) => typeof v === "bigint")
          ),
        );
        return Promise.resolve({
          allowed: true as const,
          lease: {
            id: "SYNTHETIC-runtime-lease",
            owner: value.owner,
            policyVersion: value.policyVersion,
            createdAtUtc: SYNTHETIC_RUNTIME_NOW,
            expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 10000000n,
          },
        });
      },
      settle: () => {
        settled++;
        return Promise.resolve();
      },
    };
    const budget = new RuntimeRequestBudget(
      f.planner(),
      store,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      { exists: () => Promise.resolve(false) },
      { current: () => Promise.resolve() } as unknown as SupabaseRuntimeControls,
    );
    equal(
      await budget.run(r, () => {
        worked++;
        return Promise.resolve({ ok: true });
      }),
      { ok: true },
    );
    equal([reserved, worked, settled], [1, 1, 1]);
  }
});
Deno.test("runtime budget never mints admin trust for mutable or frozen copied sessions", async () => {
  const f = await fixture(), trusted = await runtimeTrustedSession("admin_null");
  for (
    const session of [
      { ...trusted, user: { ...trusted.user } },
      Object.freeze({ ...trusted }),
      Object.freeze({ ...trusted, user: Object.freeze({ ...trusted.user }) }),
    ]
  ) {
    let reserved = 0, worked = 0, settled = 0;
    const store: UsageBudgetStorePort = {
      reserve: () => {
        reserved++;
        return Promise.reject(new Error("SYNTHETIC-unexpected-reserve"));
      },
      settle: () => {
        settled++;
        return Promise.resolve();
      },
    };
    const budget = new RuntimeRequestBudget(
      f.planner(),
      store,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      { exists: () => Promise.resolve(false) },
      { current: () => Promise.resolve() } as unknown as SupabaseRuntimeControls,
    );
    await denied(
      () =>
        budget.run({ ...f.request("score-profile.create", { scores: f.scores }), session }, () => {
          worked++;
          return Promise.resolve({ ok: true });
        }),
      503,
    );
    equal([reserved, worked, settled], [0, 0, 0]);
  }
});
