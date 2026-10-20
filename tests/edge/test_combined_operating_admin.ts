/** Opt-in policy composition only. No actual activation, migration, Storage or student writes. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  COMBINED_POLICY_CONSUMER_OPERATION_IDS,
  READ_VIEW_CONSUMER_OPERATION_IDS,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { ADMINISTRATOR_DAILY_KINDS } from "../../supabase/functions/_shared/jungsi/application/administrator_usage_policy.ts";
import {
  BUDGET_OPERATIONS,
  type BudgetRequest,
} from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import { readSessionSnapshot } from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import { RuntimeUsagePolicy } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  consumeScoreInput,
  grantScoreCorrection,
  initialScoreInputState,
  scoreInputBalance,
} from "../../supabase/functions/_shared/jungsi/domain/score_input_rights.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import {
  SYNTHETIC_RUNTIME_NOW as NOW,
  syntheticRuntimeBinding,
} from "./synthetic_runtime_binding.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001", EXPIRY = "2026-10-15T00:01:00Z";
function views(): NativeObject {
  return {
    format: "jungsi.read-view-runtime/v1",
    status: "approved",
    snapshot: {
      artifact_kind: "SYNTHETIC-head",
      lineage: "SYNTHETIC-lineage",
      minimum_sequence: 1,
      scope_sha256: "a".repeat(64),
      normalization_rules_version: "SYNTHETIC-norm",
      normalization_rules_sha256: "b".repeat(64),
      selection_rules_version: "SYNTHETIC-selection",
      selection_rules_sha256: "c".repeat(64),
      publisher_references: ["SYNTHETIC-publisher"],
      reviewer_references: ["SYNTHETIC-reviewer"],
      object_prefix: "SYNTHETIC/snapshot/",
      max_metadata_bytes: 8192,
      max_gzip_bytes: 8192,
      max_decoded_bytes: 32768,
      max_rows: 8,
      max_parts: 4,
      max_depth: 32,
      max_in_memory_bytes: 600000,
      expires_at: "2026-10-15T00:30:00Z",
    },
    report_locator: { cursor_lifetime_seconds: 60, max_cursor_characters: 4096 },
  };
}
async function fixture(
  change: (r: NativeObject) => void = () => {},
  changeBinding: (r: NativeObject) => void = () => {},
) {
  const f = await syntheticRuntimeBinding((d) => {
    d.format = "jungsi.edge-api-binding/v3";
    d.scope = {
      operations: [...COMBINED_POLICY_CONSUMER_OPERATION_IDS],
      artifacts: [{ kind: "catalog", key: "service" }, {
        kind: "exam_pack",
        key: "SYNTHETIC-mock",
      }],
    };
    d.read_views = views();
    ((d.limits as NativeObject).read as NativeObject).max_bytes = 1048576;
    changeBinding(d);
  });
  const binding = await f.load(),
    body: NativeObject = {
      format: "jungsi.runtime-usage-policy/v4",
      status: "approved",
      purpose: "jungsi-api-runtime",
      version: "SYNTHETIC-existing-counter",
      policy_revision: "SYNTHETIC-combined-revision",
      approval_reference_sha256: binding.approvalReferenceSha256,
      expires_at: EXPIRY,
      exams: [{
        exam_id: "SYNTHETIC-mock",
        pack_version: "SYNTHETIC-pack.v1",
        academic_year: 2027,
        eligible_offering_count: 1,
      }],
      dimensions: [...ADMINISTRATOR_DAILY_KINDS, "concurrent_jobs"].map((kind) => ({
        kind,
        period_seconds: kind === "concurrent_jobs" ? 1 : 86400,
        standard: 1000,
        paid: 2000,
        ceiling: 3000,
      })),
      operations: BUDGET_OPERATIONS.map((operation) => ({
        operation,
        reserved_result_bytes: 128,
        base_units: 1,
        per_offering_units: 1,
      })),
      operating_policy: {
        format: "jungsi.score-input-policy/v1",
        status: "approved",
        purpose: "paid_score_input",
        approval_reference_sha256: binding.approvalReferenceSha256,
        version: "SYNTHETIC-input-v2",
        rollout_id: "SYNTHETIC-rollout",
        calculation_version: "SYNTHETIC-calc",
        expires_at: EXPIRY,
        personal_daily_analysis_limit: "replaced_by_stage_rights",
        initial_saves: 1,
        correction_grants: 1,
        physical: { max_request_calculation_units: 100, max_request_runtime_milliseconds: 10000 },
        preview: { enabled: false, expires_at: EXPIRY, allow_subjects: [] },
        stages: [{
          exam_id: "SYNTHETIC-mock",
          input_scope_id: "SYNTHETIC-season",
          pack_version: "SYNTHETIC-pack.v1",
          academic_year: 2027,
          stage: "mock",
          window: { mode: "policy_lifetime" },
        }],
      },
      administrator_policy: {
        format: "jungsi.administrator-usage-policy/v1",
        status: "approved",
        purpose: "administrator_verification",
        approval_reference_sha256: binding.approvalReferenceSha256,
        expires_at: EXPIRY,
        daily_dimensions: [...ADMINISTRATOR_DAILY_KINDS],
      },
    };
  change(body);
  const make = (value = body, mode: "rights" | "legacy_synthetic" = "rights") =>
    new RuntimeUsagePolicy(
      new TextEncoder().encode(nativeJsonText(value)),
      binding,
      new SyntheticNativeRepository(),
      { nowUtc: () => NOW },
      { exists: () => Promise.resolve(false) },
      mode,
    );
  return { f, binding, body, make };
}
async function actor(role = "admin", aal: "aal1" | "aal2" = "aal2", status = "active") {
  return await readSessionSnapshot("SYNTHETIC", {
    verifyUserBearer: () =>
      Promise.resolve({
        subjectId: OWNER,
        expiresAtUtc: NOW + 120000000n,
        accountRole: role,
        accountStatus: status,
        assuranceLevel: aal,
      }),
  }, {
    readCurrent: () =>
      Promise.resolve({
        authority: "public.jeongsi_passes" as const,
        metadataVerified: true as const,
        subjectId: OWNER,
        evaluatedAtUtc: NOW,
        paidUntilUtc: NOW + 90000000n,
        passId: "1",
      }),
  }, NOW);
}
async function denied(work: () => unknown) {
  let failure: unknown;
  try {
    await work();
  } catch (e) {
    failure = e;
  }
  assert(failure instanceof AccessError);
  equal(failure.http, 503);
}
function request(session: Awaited<ReturnType<typeof actor>>): BudgetRequest {
  return {
    operation: "history.search",
    session,
    body: {},
    query: {},
    params: {},
    requestKey: null,
  };
}
Deno.test("combined v4 requires the separate exact20 binding generation", async () => {
  const f = await fixture();
  equal(f.binding.consumerGeneration, "operating-admin-20");
  equal(f.binding.operations.length, 20);
  const p = f.make();
  assert(p.operating);
  equal(p.version, "SYNTHETIC-existing-counter");
  equal(p.policyRevision, "SYNTHETIC-combined-revision");
});
Deno.test("combined binding rejects17 missing policy operation and duplicate scopes", async () => {
  for (
    const operations of [
      [...READ_VIEW_CONSUMER_OPERATION_IDS],
      COMBINED_POLICY_CONSUMER_OPERATION_IDS.slice(1),
      [...COMBINED_POLICY_CONSUMER_OPERATION_IDS, COMBINED_POLICY_CONSUMER_OPERATION_IDS[0]],
    ]
  ) {
    await denied(() =>
      fixture(() => {}, (d) => {
        (d.scope as NativeObject).operations = operations;
      })
    );
  }
});
Deno.test("read17 format cannot silently accept the combined20 scope", async () => {
  await denied(() =>
    fixture(() => {}, (d) => {
      d.format = "jungsi.edge-api-binding/v2";
    })
  );
});
Deno.test("combined binding refuses v1 v2 and admin-only v3 usage downgrade", async () => {
  for (
    const format of [
      "jungsi.runtime-usage-policy/v1",
      "jungsi.runtime-usage-policy/v2",
      "jungsi.runtime-usage-policy/v3",
    ]
  ) {
    const f = await fixture((r) => {
      r.format = format;
      if (!format.endsWith("v2")) delete r.operating_policy;
      if (!format.endsWith("v3")) {
        delete r.administrator_policy;
        delete r.policy_revision;
      }
    });
    await denied(() => f.make());
  }
});
Deno.test("combined v4 cannot enable legacy_synthetic save fallback", async () => {
  const f = await fixture();
  await denied(() => f.make(f.body, "legacy_synthetic"));
});
Deno.test("combined v4 requires both approved policies and a separate revision", async () => {
  for (const missing of ["operating_policy", "administrator_policy", "policy_revision"]) {
    const f = await fixture((r) => {
      delete r[missing];
    });
    await denied(() => f.make());
  }
});
Deno.test("combined v4 rejects authority mismatch on either existing policy", async () => {
  for (const name of ["operating_policy", "administrator_policy"]) {
    const f = await fixture((r) => {
      (r[name] as NativeObject).approval_reference_sha256 = "f".repeat(64);
    });
    await denied(() => f.make());
  }
});
Deno.test("combined fresh admin daily exemption retains global concurrent demand", async () => {
  const f = await fixture(), p = f.make(), plan = await p.prepare(request(await actor()));
  assert(plan.administratorProof);
  equal(plan.demands.map((x) => x.kind), ["concurrent_jobs"]);
  assert(plan.maximumResultBytes === 128n);
  assert(p.operating);
});
Deno.test("combined paid aal1 inactive or nonadmin gets ordinary read counters", async () => {
  const f = await fixture();
  for (
    const args of [["admin", "aal1", "active"], ["admin", "aal2", "inactive"], [
      "user",
      "aal2",
      "active",
    ]] as const
  ) {
    const p = await f.make().prepare(request(await actor(...args)));
    assert(!p.administratorProof);
    assert(p.demands.some((x) => x.kind === "request_window"));
    assert(p.demands.some((x) => x.kind === "result_volume"));
    assert(p.demands.some((x) => x.kind === "concurrent_jobs"));
  }
});
Deno.test("combined admin budget proof never enables input preview or extra correction", async () => {
  const f = await fixture(), p = f.make(), s = await actor();
  assert((await p.prepare(request(s))).administratorProof);
  const context = p.operating!.context(s, "SYNTHETIC-mock", "mock", NOW);
  assert(!context.previewExempt);
  let state = consumeScoreInput(
    initialScoreInputState(),
    "SYNTHETIC-first",
    "SYNTHETIC-profile-1",
    context.previewExempt,
  );
  equal(scoreInputBalance(state).initialRemaining, 0);
  let deniedSecond = false;
  try {
    consumeScoreInput(state, "SYNTHETIC-second", "SYNTHETIC-profile-2", context.previewExempt);
  } catch {
    deniedSecond = true;
  }
  assert(deniedSecond);
  state = grantScoreCorrection(state, "SYNTHETIC-grant", state.version);
  state = consumeScoreInput(
    state,
    "SYNTHETIC-correction",
    "SYNTHETIC-profile-2",
    context.previewExempt,
  );
  equal(scoreInputBalance(state).effectiveSaveRemaining, 0);
  let deniedGrant = false;
  try {
    grantScoreCorrection(state, "SYNTHETIC-grant-again", state.version);
  } catch {
    deniedGrant = true;
  }
  assert(deniedGrant);
});
Deno.test("combined policy preserves counter identity and v2 operating policy bytes", async () => {
  const f = await fixture(), before = nativeJsonText(f.body.operating_policy);
  const revised = cloneNativeJson(f.body);
  revised.policy_revision = "SYNTHETIC-next-revision";
  const p = f.make(revised);
  equal(p.version, f.make().version);
  equal(nativeJsonText(revised.dimensions), nativeJsonText(f.body.dimensions));
  equal(nativeJsonText(revised.operating_policy), before);
  assert(p.operating);
});
Deno.test("combined preview rules and request physical bounds cannot be widened by daily exemption", async () => {
  const f = await fixture(), p = f.make(), s = await actor();
  await denied(() => p.operating!.budgetProof(s, "overall.analyze", 101n, NOW));
  assert(p.operating!.budgetProof(s, "overall.analyze", 100n, NOW));
});
