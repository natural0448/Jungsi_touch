/** Invented capacities and policy metadata. No real quota approval or DB counters. */
import { RuntimeUsagePolicy } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts";
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
const OWNER = "SYNTHETIC-owner";
async function fixture(change: (policy: NativeObject) => void = () => {}) {
  const source = new SyntheticUniversityData(), scores = source.scores();
  const f = await syntheticRuntimeBinding((d) => {
    d.scope = {
      operations: (d.scope as NativeObject).operations,
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
