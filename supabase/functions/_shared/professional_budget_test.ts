/** Existing shared physical counters and institution-wide quotas, not native concurrency acceptance. */
import { ProfessionalSharedUsage } from "./jungsi/application/professional_usage.ts";
import { PROFESSIONAL_CONTRACT } from "./jungsi/application/professional_contract.generated.ts";
import { SupabaseProfessionalUsageBudgetStore } from "./jungsi/infrastructure/professional_usage_postgres.ts";
import { SupabaseProfessionalUsageAdmission } from "./jungsi/infrastructure/professional_usage_admission.ts";
import { SupabaseUsageBudgetStore } from "./jungsi/infrastructure/usage_postgres.ts";
import { SupabaseProfessionalStore } from "./jungsi/infrastructure/professional_postgres.ts";
import { ProfessionalStudentMetadataCipher } from "./jungsi/infrastructure/professional_crypto.ts";
import { AccessError } from "./jungsi/application/access.ts";
import type { UsageDemand } from "./jungsi/application/usage_budget.ts";
import { utcText } from "./jungsi/domain/time.ts";
import type { NativeObject } from "./jungsi/domain/json_value.ts";
import { budgetSql } from "./professional_budget_support.ts";
import {
  ACTOR,
  assert,
  denied,
  equal,
  EXPIRY,
  fixture,
  HASH,
  OTHER,
} from "./professional_support.ts";
const limits = { leaseSeconds: 10n, runtimeHardLimitSeconds: 1n, clockMarginSeconds: 1n };
Deno.test("professional native repository retains its tenant latch across a request frame", async () => {
  const f = await fixture(),
    db = budgetSql(),
    store = new SupabaseProfessionalStore(
      db.sql,
      new ProfessionalStudentMetadataCipher({
        activeKeyId: "SYNTHETIC-key",
        keys: [{ keyId: "SYNTHETIC-key", bytes: new Uint8Array(32).fill(5) }],
      }, 4096),
      f.clock,
      65536,
    );
  await denied(
    () =>
      store.transaction(f.user(), async () => {
        await store.bindScope(f.authority());
        await store.bindScope(f.authority("SYNTHETIC-other-org"));
      }),
    "professional_storage_unavailable",
    503,
  );
  equal(store.isTransactionActive(), false);
});
function policies() {
  const shared: NativeObject = {
    status: "approved",
    version: "SYNTHETIC-shared-policy",
    expires_at: utcText(EXPIRY),
    dimensions: [
      { kind: "request_window", period_seconds: 60, standard: 100, paid: 100, ceiling: 100 },
      { kind: "calculation_cost", period_seconds: 86400, standard: 100, paid: 100, ceiling: 100 },
      { kind: "concurrent_jobs", period_seconds: 1, standard: 1, paid: 1, ceiling: 1 },
      {
        kind: "result_volume",
        period_seconds: 60,
        standard: 100000,
        paid: 100000,
        ceiling: 100000,
      },
    ],
  };
  const pro: NativeObject = {
    format: "jungsi.professional-usage/v1",
    status: "approved",
    approval_reference_sha256: HASH,
    expires_at: utcText(EXPIRY),
    shared_policy_version: shared.version,
    shared_capacity_tier: "paid",
    organization_window: { period_seconds: 60, requests_per_contracted_student: 2 },
    operations: PROFESSIONAL_CONTRACT.routes.map((r) => ({
      operation: r.id,
      maximum_result_bytes: 1000,
      calculation_units:
        ["pro.score.create", "pro.overall.analyze", "pro.university.analyze", "pro.candidates"]
            .includes(r.id)
          ? 1
          : 0,
    })),
  };
  return { shared, pro };
}
async function configured(requestsPerStudent = 2) {
  const frame = { active: false };
  const f = await fixture(),
    db = budgetSql(),
    shared = new SupabaseProfessionalUsageBudgetStore(db.sql, limits),
    admission = new SupabaseProfessionalUsageAdmission(db.sql, shared, () => frame.active),
    p = policies();
  (p.pro.organization_window as NativeObject).requests_per_contracted_student = requestsPerStudent;
  const usage = new ProfessionalSharedUsage(
      p.pro,
      p.shared,
      admission,
      f.clock,
      HASH,
      async () => {},
    ),
    scope = { authority: f.authority(), student: f.baseStudent };
  const context = { examId: "SYNTHETIC-mock", maximumCalculationUnits: 100n, replay: false };
  return { f, db, shared, admission, p, usage, scope, context, frame };
}
Deno.test("professional settlement reuses the business frame and remains recoverable after rollback", async () => {
  const f = await configured(),
    lease = await f.usage.reserve(f.scope, "pro.score.create", null, f.context);
  f.frame.active = true;
  try {
    await denied(
      () =>
        f.db.sql.requestWrite(ACTOR, async () => {
          await f.usage.finish(f.scope, lease, true, 10n);
          throw new AccessError("professional_storage_unavailable", 503);
        }),
      "professional_storage_unavailable",
      503,
    );
  } finally {
    f.frame.active = false;
  }
  assert([...f.db.leases.values()].some((r) => r[4] === "active"));
  await f.usage.finish(f.scope, lease, false, 0n);
  assert(![...f.db.leases.values()].some((r) => r[4] === "active"));
  equal([...f.db.windows.values()].find((w) => w.capacity === 1n)!.reserved, 0n);
});
Deno.test("professional two teachers consume the same institution request window", async () => {
  const f = await configured(), c = { ...f.scope.authority.contract, studentCapacity: 1 };
  f.scope.authority = { ...f.scope.authority, contract: c };
  const one = await f.usage.reserve(f.scope, "pro.score.create", null, f.context);
  await f.usage.finish(f.scope, one, true, 10n);
  const other = {
    ...f.scope,
    authority: { ...f.scope.authority, user: { ...f.scope.authority.user, subjectId: OTHER } },
  };
  const two = await f.usage.reserve(other, "pro.score.create", null, f.context);
  await f.usage.finish(other, two, true, 10n);
  await denied(
    () => f.usage.reserve(f.scope, "pro.score.create", null, f.context),
    "rate_limit_exceeded",
    429,
  );
  equal(f.db.organizations.size, 1);
  equal([...f.db.organizations.values()][0].used, 2n);
  assert(![...f.db.leases.values()].some((r) => r[4] === "active"));
});
Deno.test("professional and personal requests share the existing global concurrency bucket", async () => {
  const f = await configured(),
    personal = new SupabaseUsageBudgetStore(f.db.sql, limits),
    demands: UsageDemand[] = [
      {
        kind: "request_window",
        scope: "GLOBAL",
        periodSeconds: 60n,
        capacity: 100n,
        ceiling: 100n,
        units: 1n,
      },
      {
        kind: "concurrent_jobs",
        scope: "GLOBAL",
        periodSeconds: 1n,
        capacity: 1n,
        ceiling: 1n,
        units: 1n,
      },
    ];
  const active = await personal.reserve({
    owner: ACTOR,
    operation: "overall.analyze",
    policyVersion: "SYNTHETIC-shared-policy",
    demands,
  });
  assert(active.allowed);
  await denied(
    () => f.usage.reserve(f.scope, "pro.score.create", null, f.context),
    "rate_limit_exceeded",
    429,
  );
  await personal.settle(active.lease, "success", { resultBytes: 0n });
  const accepted = await f.usage.reserve(f.scope, "pro.score.create", null, f.context);
  await f.usage.finish(f.scope, accepted, true, 10n);
  equal(f.db.windows.size, 4);
  assert(f.db.operations.includes("pro.score.create"));
  assert(f.db.operations.includes("overall.analyze"));
});
Deno.test("professional and personal computations share exam/policy/owner cost and replay refunds reservations", async () => {
  const f = await configured(),
    personal = new SupabaseUsageBudgetStore(f.db.sql, limits),
    demands: UsageDemand[] = [
      {
        kind: "request_window",
        scope: "GLOBAL",
        periodSeconds: 60n,
        capacity: 100n,
        ceiling: 100n,
        units: 1n,
      },
      {
        kind: "calculation_cost",
        scope: "SYNTHETIC-mock",
        periodSeconds: 86400n,
        capacity: 100n,
        ceiling: 100n,
        units: 99n,
      },
      {
        kind: "concurrent_jobs",
        scope: "GLOBAL",
        periodSeconds: 1n,
        capacity: 1n,
        ceiling: 1n,
        units: 1n,
      },
    ];
  const active = await personal.reserve({
    owner: ACTOR,
    operation: "overall.analyze",
    policyVersion: "SYNTHETIC-shared-policy",
    demands,
  });
  assert(active.allowed);
  await personal.settle(active.lease, "success", { resultBytes: 0n });
  const lease = await f.usage.reserve(f.scope, "pro.score.create", null, f.context);
  await f.usage.finish(f.scope, lease, true, 10n, true);
  const cost = [...f.db.windows.entries()].find(([key]) => key.includes("calculation_cost"))![1];
  equal(cost.used, 99n);
  equal(cost.reserved, 0n);
  const final = await f.usage.reserve(f.scope, "pro.score.create", null, f.context);
  await f.usage.finish(f.scope, final, true, 10n);
  equal(cost.used, 100n);
  await denied(
    () => f.usage.reserve(f.scope, "pro.score.create", null, f.context),
    "analysis_quota_exceeded",
    429,
  );
});
Deno.test("professional twenty sequential students use real quota adapter without personal distinct-score dimensions", async () => {
  const f = await configured(4);
  for (let i = 0; i < 20; i++) {
    const s = {
      ...f.scope,
      student: { ...f.scope.student, studentId: "SYNTHETIC-budget-student-" + i },
    };
    for (
      const operation of [
        "pro.score.create",
        "pro.overall.analyze",
        "pro.university.analyze",
        "pro.candidates",
      ]
    ) {
      const lease = await f.usage.reserve(s, operation, null, f.context);
      await f.usage.finish(s, lease, true, 10n);
    }
  }
  assert(![...f.db.windows.keys()].some((key) => key.includes("distinct_scores")));
  equal([...f.db.organizations.values()][0].used, 80n);
  equal([...f.db.windows.values()].find((w) => w.capacity === 1n)!.reserved, 0n);
});
Deno.test("professional usage refuses missing policy, missing calculation context and over-physical work", async () => {
  const f = await configured();
  await denied(
    () => f.usage.reserve(f.scope, "pro.score.create", null),
    "professional_policy_unavailable",
    503,
  );
  await denied(
    () =>
      f.usage.reserve(f.scope, "pro.score.create", null, {
        ...f.context,
        maximumCalculationUnits: 0n,
      }),
    "professional_policy_unavailable",
    503,
  );
  equal(f.db.leases.size, 0);
});
Deno.test("professional shared budget rejects administrator exemptions and personal operation aliases", async () => {
  const f = await configured();
  await denied(
    () =>
      f.shared.reserve({
        owner: ACTOR,
        operation: "overall.analyze",
        policyVersion: "SYNTHETIC-shared-policy",
        demands: [],
      }),
    "security_policy_unavailable",
    503,
  );
  await denied(
    () => f.usage.reserve(f.scope, "overall.analyze", null, f.context),
    "professional_policy_unavailable",
    503,
  );
});
