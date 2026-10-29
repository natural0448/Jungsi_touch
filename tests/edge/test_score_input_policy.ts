import { safeFailure } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import {
  canonicalApiPolicies,
  canonicalPublicResponseSchemas,
} from "./public_api_contract_fixture.ts";
const RESPONSE_SCHEMAS = canonicalPublicResponseSchemas();
const SERVICE_SPEC = { operations: canonicalApiPolicies() };
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
/** Invented identities, packs, policies and one-slot SQL harness only. No network/DB or actual P2 replay. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { verifyStageBudgetProof } from "../../supabase/functions/_shared/jungsi/application/operating_policy.ts";
import {
  ProfileReportService,
  reportDto,
} from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import {
  SCORE_CONTENT_REJECTION_CODES,
  ScoreInputService,
} from "../../supabase/functions/_shared/jungsi/application/score_input_service.ts";
import type {
  PaidResultDelivery,
  ScoreInputRepositoryPort,
} from "../../supabase/functions/_shared/jungsi/application/score_input_ports.ts";
import { SharedRequestBudget } from "../../supabase/functions/_shared/jungsi/application/usage_service.ts";
import type { BudgetRequest } from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import {
  readSessionSnapshot,
  type SessionSnapshot,
} from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import { personalResultComponents } from "../../supabase/functions/_shared/jungsi/application/paid_result_components.ts";
import {
  assertScoreInputState,
  consumeScoreInput,
  grantScoreCorrection,
  initialScoreInputState,
  scoreInputBalance,
} from "../../supabase/functions/_shared/jungsi/domain/score_input_rights.ts";
import { ContractError } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  nativeJsonSha256,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
import {
  A,
  B,
  clock,
  denied,
  HASH,
  nativeFixture,
  NOW,
  OneSlotPool,
  policy,
  scores,
  session,
} from "./synthetic_score_input_policy.ts";
Deno.test("stage rights allow initial plus one granted correction and preserve invalid attempt history", () => {
  const first = consumeScoreInput(
    initialScoreInputState(),
    "SYNTHETIC-initial",
    null,
    false,
    "invalid_grade",
  );
  equal(scoreInputBalance(first).effectiveSaveRemaining, 0);
  const grant = grantScoreCorrection(first, "SYNTHETIC-ticket", 1);
  equal(scoreInputBalance(grant).effectiveSaveRemaining, 1);
  const correction = consumeScoreInput(
    grant,
    "SYNTHETIC-correction",
    "SYNTHETIC-profile",
    false,
  );
  equal(scoreInputBalance(correction).effectiveSaveRemaining, 0);
  equal(correction.initialAttemptId, first.initialAttemptId);
  equal(correction.lastOutcome, "accepted");
});
Deno.test("native state refuses a numeric ID and a version-zero fabricated attempt", () => {
  for (
    const mutation of [{
      lastAttemptId: 7,
      lastOutcome: "rejected",
      lastRejectionCode: "invalid_score",
    }, {
      lastAttemptId: "SYNTHETIC-fabricated",
      lastOutcome: "rejected",
      lastRejectionCode: "invalid_score",
    }]
  ) {
    let error: unknown;
    try {
      assertScoreInputState(
        { ...initialScoreInputState(), ...mutation } as never,
      );
    } catch (e) {
      error = e;
    }
    assert(error instanceof ContractError);
  }
});
Deno.test("preview exemption preserves normal initial right and never changes free membership", () => {
  const p = policy((r) => {
    r.preview = {
      enabled: true,
      expires_at: utcText(NOW + 1000000n),
      allow_subjects: [A],
    };
  });
  const free = session(A, false);
  assert(p.previewExempt(free, NOW));
  equal(free.tier, "standard");
  const state = consumeScoreInput(
    initialScoreInputState(),
    "SYNTHETIC-preview",
    "SYNTHETIC-profile",
    true,
  );
  equal(scoreInputBalance(state).initialRemaining, 1);
  equal(state.currentProfileId, "SYNTHETIC-profile");
  assert(!p.previewExempt(free, NOW + 1000000n));
});
Deno.test("stage budget proof is identity-bound, cannot be forged and expires at request runtime", async () => {
  const p = policy(),
    s = session(),
    proof = p.budgetProof(s, "overall.analyze", 2n, NOW);
  assert(
    verifyStageBudgetProof(
      proof,
      { operation: "overall.analyze", session: s },
      HASH,
      NOW,
    ),
  );
  await denied(
    () =>
      Promise.resolve(
        verifyStageBudgetProof(
          { ...proof },
          { operation: "overall.analyze", session: s },
          HASH,
          NOW,
        ),
      ),
    "score_input_policy_unavailable",
    503,
  );
  await denied(
    () =>
      Promise.resolve(
        verifyStageBudgetProof(
          proof,
          { operation: "overall.analyze", session: session(B) },
          HASH,
          NOW,
        ),
      ),
    "score_input_policy_unavailable",
    503,
  );
  await denied(
    () =>
      Promise.resolve(
        verifyStageBudgetProof(
          proof,
          { operation: "overall.analyze", session: s },
          HASH,
          NOW + 10000000n,
        ),
      ),
    "score_input_policy_unavailable",
    503,
  );
});
Deno.test("unapproved CSAT stage and exhausted physical work fail closed", async () => {
  const p = policy();
  await denied(
    () => Promise.resolve(p.stage("SYNTHETIC-mock", "final", NOW)),
    "score_stage_unavailable",
    503,
  );
  await denied(
    () => Promise.resolve(p.budgetProof(session(), "candidates.build", 101n, NOW)),
    "score_input_policy_unavailable",
    503,
  );
});
Deno.test("canonical scope is shared by approved aliases without new input credit", () => {
  const p = policy((r) => {
    (r.stages as NativeObject[]).push({
      ...((r.stages as NativeObject[])[0]),
      exam_id: "SYNTHETIC-alias",
    });
  });
  equal(
    p.stage("SYNTHETIC-mock", "mock", NOW).scopeId,
    p.stage("SYNTHETIC-alias", "mock", NOW).scopeId,
  );
  equal(p.scopeExams("SYNTHETIC-canonical-season", "mock").length, 2);
});
Deno.test("one-slot actual adapter persists a single profile and same-key replay without nested connection", async () => {
  const f = nativeFixture();
  const result = await f.save();
  equal(await f.save(), result);
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
  equal(f.pool.maximum, 1);
  equal(f.pool.state.states.length, 1);
});
Deno.test("distinct concurrent keys serialize on one initial right and preserve one accepted profile", async () => {
  const f = nativeFixture();
  const r = await Promise.allSettled([
    f.save("SYNTHETIC-one"),
    f.save("SYNTHETIC-two"),
  ]);
  equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const failed = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
  assert(failed.reason instanceof AccessError);
  equal(failed.reason.code, "score_input_exhausted");
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
});
for (
  const [label, edit, code] of [["integer999", (s: NativeObject) => {
    (s.korean as NativeObject).standard_score = 999;
  }, "unobserved_standard_score"], ["grade10", (s: NativeObject) => {
    (s.korean as NativeObject).grade = 10;
  }, "invalid_reported_grade"]] as const
) {
  Deno.test(
    "semantic " + label +
      " consumes one attempt and rejection replay consumes none",
    async () => {
      const f = nativeFixture(), v = scores();
      edit(v);
      await denied(() => f.save("SYNTHETIC-reject", v), code, 422);
      equal(f.pool.state.profiles.size, 0);
      equal(f.pool.state.attempts.length, 1);
      await denied(() => f.save("SYNTHETIC-reject", v), code, 422);
      equal(f.pool.state.attempts.length, 1);
      await denied(
        () => f.save("SYNTHETIC-fresh"),
        "score_input_exhausted",
        409,
      );
    },
  );
}
Deno.test("non-integer structural score is not a free semantic probing attempt", async () => {
  const f = nativeFixture(), v = scores();
  (v.korean as NativeObject).standard_score = "999";
  await denied(() => f.save("SYNTHETIC-shape", v), "invalid_integer", 422);
  equal(f.pool.state.attempts.length, 0);
  equal(f.pool.state.profiles.size, 0);
  await f.save("SYNTHETIC-valid");
  equal(f.pool.state.attempts.length, 1);
});
Deno.test("unregistered legacy profile blocks zero-credit initialization and preserves the original", async () => {
  const f = nativeFixture();
  f.pool.state.profiles.set("SYNTHETIC-old", [
    "SYNTHETIC-old",
    A,
    JSON.stringify(scores()),
    true,
    "2026-10-15T00:00:00.000000Z",
  ]);
  await denied(() => f.save(), "score_input_transition_pending", 503);
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.states.length, 0);
});
Deno.test("missing rollout prevents new input without mutating existing storage", async () => {
  const f = nativeFixture();
  f.pool.rolloutReady = false;
  await denied(() => f.save(), "score_input_transition_pending", 503);
  equal(f.pool.state.profiles.size, 0);
});
Deno.test("post-profile projection failure rolls back both profile and input attempt", async () => {
  const f = nativeFixture();
  await denied(
    () =>
      f.repo.accept(A, async () => {
        await f.profile.execute({
          operation: "score-profile.create",
          session: f.verified,
          management: null,
          body: { scores: scores(), confirmed: true },
          query: {},
          params: {},
          requestKey: "SYNTHETIC-projection",
        });
        throw new AccessError("security_policy_unavailable", 503);
      }),
    "security_policy_unavailable",
    503,
  );
  equal(f.pool.state.profiles.size, 0);
  equal(f.pool.state.attempts.length, 0);
  await f.save("SYNTHETIC-retry");
});
Deno.test("one-slot budget settlement failure preserves request frequency and rolls back profile and input right", async () => {
  const f = nativeFixture(),
    r: BudgetRequest = {
      operation: "score-profile.create",
      session: f.verified,
      body: { scores: scores(), confirmed: true },
      params: {},
      query: {},
      requestKey: "SYNTHETIC-settle",
    };
  const budget = new SharedRequestBudget(
    {
      prepare: (request) =>
        Promise.resolve({
          status: "approved",
          policyVersion: "SYNTHETIC-usage",
          approvalReferenceSha256: HASH,
          owner: A,
          operation: r.operation,
          memberTier: "paid",
          examId: "SYNTHETIC-mock",
          normalizedScoresSha256: "b".repeat(64),
          calculationContextSha256: "c".repeat(64),
          computation: "required",
          stageProof: f.p.budgetProof(request.session, r.operation, 2n, NOW),
          demands: (["request_window", "concurrent_jobs", "result_volume"] as const)
            .map((kind) => ({
              kind,
              scope: "GLOBAL",
              periodSeconds: kind === "concurrent_jobs" ? 1n : 60n,
              capacity: 10000n,
              ceiling: 10000n,
              units: kind === "result_volume" ? 1024n : 1n,
            })),
        }),
    },
    {
      reserve: async () => {
        await f.sql.write(A, (tx) => tx.query("SYNTHETIC_RESERVE"));
        return {
          allowed: true,
          lease: {
            id: "SYNTHETIC-lease",
            owner: A,
            policyVersion: "SYNTHETIC-usage",
            createdAtUtc: NOW,
            expiresAtUtc: NOW + 1000000n,
          },
        };
      },
      settle: async () => {
        await f.sql.write(A, (tx) => tx.query("SYNTHETIC_SETTLE"));
        throw new AccessError("security_policy_unavailable", 503);
      },
    },
    clock,
    { exists: () => Promise.resolve(false) },
  );
  const admitted = await budget.admit(r);
  await denied(
    async () => {
      try {
        return await f.repo.accept(
          A,
          () =>
            budget.runAdmitted(admitted, () =>
              f.profile.execute({
                ...r,
                operation: "score-profile.create",
                management: null,
              }), r),
        );
      } catch (error) {
        try {
          await budget.cancel(admitted);
        } catch {
          // A cleanup failure must not hide the original transaction failure.
        }
        throw error;
      }
    },
    "security_policy_unavailable",
    503,
  );
  equal(f.pool.state.profiles.size, 0);
  equal(f.pool.state.attempts.length, 0);
  equal(f.pool.state.usage, 1);
  equal(f.pool.maximum, 1);
});
Deno.test("two request-local forks share one pool without mixing subjects or admitting cross-subject writes", async () => {
  const pool = new OneSlotPool(),
    base = new SupabaseSqlTransport(pool),
    a = base.fork(),
    b = base.fork();
  const result = await Promise.all([
    a.requestWrite(A, async () => {
      await denied(
        () => a.write(B, (tx) => tx.query("SYNTHETIC_CONTEXT")),
        "storage_transaction_context_invalid",
        503,
      );
      return a.read(A, (tx) => tx.query("SYNTHETIC_CONTEXT"));
    }),
    b.requestWrite(B, () => b.read(B, (tx) => tx.query("SYNTHETIC_CONTEXT"))),
  ]);
  equal(result, [[[A]], [[B]]]);
  equal(pool.maximum, 1);
});
Deno.test("a shared base transport cannot acquire request transaction state", async () => {
  await denied(
    () =>
      new SupabaseSqlTransport(new OneSlotPool()).requestWrite(
        A,
        () => Promise.resolve(1),
      ),
    "storage_transaction_context_invalid",
    503,
  );
});
Deno.test("strict workflow denies free input before writes and paid flat overall before debit", async () => {
  const f = nativeFixture();
  await denied(
    () =>
      f.profile.execute({
        operation: "score-profile.create",
        session: session(A, false),
        management: null,
        body: { scores: scores(), confirmed: true },
        query: {},
        params: {},
        requestKey: "SYNTHETIC-free",
      }),
    "paid_required",
    403,
  );
  await denied(
    () =>
      f.profile.execute({
        operation: "overall.analyze",
        session: f.verified,
        management: null,
        body: scores(),
        query: {},
        params: {},
        requestKey: "SYNTHETIC-flat",
      }),
    "profile_required",
    422,
  );
  equal(f.pool.state.profiles.size, 0);
});
Deno.test("a paid workflow without an approved policy never falls back to legacy score input", async () => {
  const f = nativeFixture(),
    service = new ProfileReportService(f.platform, {
      getExamPack: () => Promise.resolve(null),
      getTotalModel: () => Promise.resolve(null),
    }, clock);
  await denied(
    () =>
      service.execute({
        operation: "score-profile.create",
        session: f.verified,
        management: null,
        body: { scores: scores(), confirmed: true },
        query: {},
        params: {},
        requestKey: "SYNTHETIC-no-policy",
      }),
    "score_input_policy_unavailable",
    503,
  );
  equal(f.pool.state.profiles.size, 0);
});
Deno.test("delivery only counts the current operation numerical component, and separates current pass from origin", async () => {
  const delivered: PaidResultDelivery[] = [];
  const repo = {
    recordDelivered: (r: PaidResultDelivery) => {
      delivered.push(r);
      return Promise.resolve();
    },
  } as ScoreInputRepositoryPort;
  const f = nativeFixture(),
    service = new ScoreInputService(repo, f.p, {
      getExamPack: () => Promise.resolve(null),
      getTotalModel: () => Promise.resolve(null),
    }, clock),
    s = Object.freeze({ ...session(), paidPassId: "2" });
  const report: NativeObject = {
    report_id: "SYNTHETIC-report",
    report_version: 1,
    overall: { total_standard_score: 386 },
    analyses: { SYNTHETIC: { converted_score: "500.00" } },
    candidates: {
      status: "pending",
      basic_university_groups: [],
      wildcards: [],
    },
  };
  await service.deliver(s, "candidates.build", report, "a".repeat(32));
  equal(delivered.length, 0);
  await service.deliver(s, "university.analyze", report, "b".repeat(32), [
    "SYNTHETIC",
  ]);
  equal(delivered[0].accessPassId, "2");
  equal(delivered[0].componentKeys, ["analysis:SYNTHETIC"]);
  await service.deliver(
    session(A, false),
    "report.read",
    report,
    "c".repeat(32),
  );
  equal(delivered[1].accessPassId, null);
  equal(delivered[1].operation, "report.read");
});
Deno.test("sample and statistics never record first use; numeric zero is still an actual personal result", async () => {
  equal(personalResultComponents({ overall: { total_standard_score: 0 } }), [
    "overall",
  ]);
  const f = nativeFixture();
  await f.service.deliver(f.verified, "statistics.read", {
    report_id: "SYNTHETIC-r",
    report_version: 1,
    overall: { total_standard_score: 0 },
  }, "a".repeat(32));
  equal(f.pool.state.attempts.length, 0);
  const sample = await f.service.execute({
    operation: "report.sample.read",
    session: session(A, false),
    management: null,
    body: {},
    query: {},
    params: {},
    requestKey: null,
  });
  equal(sample.synthetic, true);
  equal(f.pool.state.profiles.size, 0);
});
Deno.test("closed-stage correction never consumes a grant, even for verified active admin aal2", async () => {
  const p = policy((r) => {
    (r.stages as NativeObject[]).push({
      ...((r.stages as NativeObject[])[0]),
      stage: "provisional",
      window: {
        mode: "official",
        approved: true,
        source_ref: "https://example.invalid/SYNTHETIC-official",
        opens_at: utcText(NOW - 2000000n),
        closes_at: utcText(NOW - 1000000n),
      },
    });
  });
  const admin = await readSessionSnapshot("SYNTHETIC", {
    verifyUserBearer: () =>
      Promise.resolve({
        subjectId: A,
        expiresAtUtc: NOW + 1000000n,
        accountRole: "admin",
        accountStatus: "active",
        assuranceLevel: "aal2",
      }),
  }, {
    readCurrent: () =>
      Promise.resolve({
        authority: "public.jeongsi_passes",
        metadataVerified: true,
        subjectId: A,
        evaluatedAtUtc: NOW,
        paidUntilUtc: null,
        passId: null,
      }),
  }, NOW);
  const f = nativeFixture(p);
  await denied(
    () =>
      f.service.execute({
        operation: "score-input.correction.grant",
        session: admin,
        management: null,
        body: {
          subject_id: B,
          exam_id: "SYNTHETIC-mock",
          stage: "provisional",
          ticket_ref: "SYNTHETIC-ticket",
          expected_version: 1,
          reason_code: "score_correction",
        },
        query: {},
        params: {},
        requestKey: "SYNTHETIC-grant",
      }),
    "score_stage_closed",
    409,
  );
  equal(f.pool.state.states.length, 0);
});

async function overallReport(
  f: ReturnType<typeof nativeFixture>,
  key = "SYNTHETIC-overall",
  verified = f.verified,
): Promise<NativeObject> {
  const saved = await f.save();
  return await f.profile.execute({
    operation: "overall.analyze",
    session: verified,
    management: null,
    body: { profile_id: saved.profile_id },
    query: {},
    params: {},
    requestKey: key,
  });
}
async function adminSnapshot(owner = B): Promise<SessionSnapshot> {
  return await readSessionSnapshot("SYNTHETIC", {
    verifyUserBearer: () =>
      Promise.resolve({
        subjectId: owner,
        expiresAtUtc: NOW + 1000000n,
        accountRole: "admin",
        accountStatus: "active",
        assuranceLevel: "aal2",
      }),
  }, {
    readCurrent: () =>
      Promise.resolve({
        authority: "public.jeongsi_passes",
        metadataVerified: true,
        subjectId: owner,
        evaluatedAtUtc: NOW,
        paidUntilUtc: null,
        passId: null,
      }),
  }, NOW);
}
Deno.test("one admin correction is immutable, replay-safe, and cannot replace the initial profile", async () => {
  const f = nativeFixture(),
    first = await f.save(),
    stage = f.p.stage("SYNTHETIC-mock", "mock", NOW),
    command = {
      actor: B,
      owner: A,
      stage,
      ticketRef: "SYNTHETIC-ticket",
      expectedVersion: 1,
      reasonCode: "score_correction" as const,
      key: "SYNTHETIC-admin-key",
      digest: await nativeJsonSha256({ ticket: "SYNTHETIC-ticket" }),
      nowUtc: NOW,
    };
  const granted = await f.repo.grantCorrection(command);
  equal(granted.state.version, 2);
  equal(await f.repo.grantCorrection(command), granted);
  equal(f.pool.state.corrections.length, 1);
  const second = await f.save("SYNTHETIC-corrected");
  assert(second.profile_id !== first.profile_id);
  equal(f.pool.state.profiles.size, 2);
  assert(f.pool.state.profiles.has(first.profile_id as string));
  equal(f.pool.state.attempts.length, 2);
  await denied(
    () =>
      f.repo.grantCorrection({
        ...command,
        key: "SYNTHETIC-extra",
        ticketRef: "SYNTHETIC-extra-ticket",
        expectedVersion: 3,
      }),
    "score_correction_unavailable",
    409,
  );
  equal(f.pool.state.corrections.length, 1);
  await denied(() => f.save("SYNTHETIC-third"), "score_input_exhausted", 409);
});
Deno.test("a successful profile POST followed by separate overall 503 preserves its accepted input", async () => {
  const f = nativeFixture(), saved = await f.save();
  const failed = new ProfileReportService(
    f.platform,
    {
      getExamPack: () => Promise.resolve(null),
      getTotalModel: () => Promise.resolve(null),
    },
    clock,
    { mode: "rights", workflow: f.service },
  );
  await denied(
    () =>
      failed.execute({
        operation: "overall.analyze",
        session: f.verified,
        management: null,
        body: { profile_id: saved.profile_id },
        query: {},
        params: {},
        requestKey: "SYNTHETIC-analysis-retry",
      }),
    "exam_not_available",
    503,
  );
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
  equal(f.pool.state.states.length, 1);
});
Deno.test("cached overall on a new pass records its access pass while original provenance stays unchanged", async () => {
  const f = nativeFixture(),
    result = await overallReport(f),
    rid = result.report_id as string;
  equal(f.pool.state.origins.length, 1);
  equal(f.pool.state.origins[0].pass, "1");
  equal(f.pool.state.firstUse.size, 0);
  const read = await f.profile.execute({
    operation: "report.read",
    session: session(A, false),
    management: null,
    body: {},
    query: {},
    params: { report_id: rid },
    requestKey: null,
  });
  await f.service.deliver(
    session(A, false),
    "report.read",
    read,
    "a".repeat(32),
  );
  equal(f.pool.state.firstUse.get("1")?.basis, "pending_original_delivery");
  equal(f.pool.state.firstUse.get("1")?.access, "report.read");
  const pass2 = Object.freeze({ ...session(), paidPassId: "2" });
  await f.service.deliver(pass2, "report.read", read, "b".repeat(32));
  assert(!f.pool.state.firstUse.has("2"));
  const cached = await overallReport(f, "SYNTHETIC-overall-new-pass", pass2);
  equal(cached.report_id, rid);
  equal(cached.report_version, 1);
  equal(f.pool.state.revisions.size, 1);
  equal(f.pool.state.origins.length, 1);
  await f.service.deliver(pass2, "overall.analyze", cached, "c".repeat(32));
  equal(f.pool.state.firstUse.get("2")?.basis, "current_paid_operation");
  equal(f.pool.state.origins[0].pass, "1");
  equal(f.pool.state.profiles.size, 1);
});

async function storedSnapshotHttpRegression(): Promise<void> {
  const f = nativeFixture(), original = await overallReport(f);
  const allowed = "SYNTHETIC-allowed", ungranted = "SYNTHETIC-ungranted";
  const assessment = (id: string): NativeObject => ({
    offering_id: id,
    status: "pending",
    reason_code: "offering_analysis_not_requested",
    converted_score: null,
    converted_percentile: null,
    category: "pending",
    advantage: null,
    years: [],
    versions: {},
    eligibility_status: null,
    internal_value: "SYNTHETIC-private",
  });
  const item = {
    selected: true,
    changed_at: null,
    assessment_status: "pending",
    profile_id: original.profile_id,
    catalog_version: null,
    internal_value: "SYNTHETIC-private",
  };
  const saved = await f.platform.writeReport({
    owner: A,
    reportId: original.report_id as string,
    profileId: original.profile_id as string,
    body: {
      overall: original.overall,
      analyses: {
        [allowed]: assessment(allowed),
        [ungranted]: assessment(ungranted),
      },
      candidates: null,
      shortlist: { [allowed]: item, [ungranted]: item },
      analysis_status: {
        status: "pending",
        reason_code: "offering_analysis_not_requested",
      },
    },
    expected: 1,
    nowUtc: NOW,
    operation: "university.analyze",
    key: "SYNTHETIC-snapshot-origin",
    digest: HASH,
    paidOrigin: f.service.origin(f.verified, "university.analyze", [
      "analysis:" + allowed,
    ]),
  });
  const projection = new PublicResponseProjection(
    RESPONSE_SCHEMAS,
    SERVICE_SPEC.operations,
  );
  const relay = "SYNTHETIC-snapshot-relay-" + "x".repeat(32);
  let owner = A, paidUntilUtc: bigint | null = null;
  const stages: string[] = [];
  const ports: ApiHttpPorts = {
    onStage: (stage) => {
      stages.push(stage);
    },
    relay: new RelayBoundary(relay),
    clock,
    sessions: {
      verifyUserBearer: () => Promise.resolve({ subjectId: owner, expiresAtUtc: NOW + 1000000n }),
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) =>
        Promise.resolve({
          authority: "public.jeongsi_passes" as const,
          metadataVerified: true as const,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: paidUntilUtc !== null && paidUntilUtc > evaluatedAtUtc
            ? paidUntilUtc
            : null,
          passId: paidUntilUtc !== null && paidUntilUtc > evaluatedAtUtc ? "1" : null,
        }),
    },
    reports: f.platform,
    authorities: {
      readCurrent: () => {
        throw new Error("Unrequested authority");
      },
    },
    resources: {
      readScope: () => {
        throw new Error("Unrequested resource");
      },
    },
    projection,
    budget: { run: async (_request, work) => await work() },
    business: f.profile,
  };
  const handler = createApiHandler(
    SERVICE_SPEC.operations.map(({ contract_ref: _, ...policy }) => policy),
    ports,
  );
  const url = "https://synthetic.invalid/api/v1/reports/" + saved.report_id;
  const headers = {
    Authorization: "Bearer SYNTHETIC-token",
    "X-Jungsi-Relay-Token": relay,
  };
  for (const until of [null, NOW - 1n]) {
    paidUntilUtc = until;
    for (const suffix of ["", "/print"]) {
      stages.length = 0;
      const response = await handler(new Request(url + suffix, { headers }));
      assert(
        response.status === 200,
        "HTTP " + response.status + " at " + stages.at(-1),
      );
      assert(
        stages.includes("response_projection") &&
          stages.includes("final_projection"),
      );
      const outer = await response.json();
      const report = suffix ? outer.report : outer;
      assert(!Object.hasOwn(report, "analyses"));
      assert(!Object.hasOwn(report, "shortlist"));
      equal(Object.keys(report.read_only_snapshot.analyses), [allowed]);
      equal(Object.keys(report.read_only_snapshot.shortlist), [allowed]);
      equal(report.read_only_snapshot.shortlist[allowed].selected, true);
      assert(!JSON.stringify(report).includes("SYNTHETIC-private"));
      assert(!JSON.stringify(report).includes(ungranted));
    }
    const paidOnly = await handler(
      new Request(url + "/university-results", {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    equal(paidOnly.status, 403);
  }
  owner = B;
  equal((await handler(new Request(url, { headers }))).status, 404);
  owner = A;
  const withoutRelay = await handler(
    new Request(url, { headers: { Authorization: "Bearer SYNTHETIC-token" } }),
  );
  equal(withoutRelay.status, 403);
  paidUntilUtc = NOW + 1000000n;
  const paid = await handler(new Request(url, { headers }));
  equal(paid.status, 200);
  const paidBody = await paid.json();
  assert(Object.hasOwn(paidBody.analyses, allowed));
  assert(Object.hasOwn(paidBody.analyses, ungranted));
  assert(!Object.hasOwn(paidBody, "read_only_snapshot"));
  paidUntilUtc = null;
  const standard = await handler(new Request(url, { headers }));
  const standardBody = await standard.json();
  for (
    const scope of [
      {
        overall: true,
        analysisIds: [],
        candidates: true,
        legacyVerified: false,
      },
      {
        overall: true,
        analysisIds: [],
        candidates: false,
        legacyVerified: true,
      },
    ]
  ) {
    const empty = projection.project(
      "report.read",
      "standard",
      reportDto(session(A, false), saved, scope),
    ) as NativeObject;
    equal((empty.read_only_snapshot as NativeObject).shortlist, {});
    equal((empty.read_only_snapshot as NativeObject).analyses, {});
  }
  const invalidKey = structuredClone(standardBody);
  invalidKey.read_only_snapshot.shortlist["bad key"] =
    invalidKey.read_only_snapshot.shortlist[allowed];
  await denied(
    () =>
      Promise.resolve(
        projection.project("report.read", "standard", invalidKey),
      ),
    "security_policy_unavailable",
    503,
  );
  const invalidValue = structuredClone(standardBody);
  invalidValue.read_only_snapshot.shortlist[allowed].selected = "not-a-boolean";
  await denied(
    () =>
      Promise.resolve(
        projection.project("report.read", "standard", invalidValue),
      ),
    "security_policy_unavailable",
    503,
  );
  equal(f.pool.state.revisions.size, 2);
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.origins.length, 2);
}

Deno.test("first-use write failure is a 503 and own stored read recovers original delivery without score resave", async () => {
  const f = nativeFixture(), result = await overallReport(f);
  f.pool.failDelivery = true;
  await denied(
    () => f.service.deliver(f.verified, "overall.analyze", result, "a".repeat(32)),
    "storage_unavailable",
    503,
  );
  equal(f.pool.state.firstUse.size, 0);
  equal(f.pool.state.revisions.size, 1);
  equal(f.pool.state.profiles.size, 1);
  f.pool.failDelivery = false;
  const read = await f.profile.execute({
    operation: "report.read",
    session: session(A, false),
    management: null,
    body: {},
    query: {},
    params: { report_id: result.report_id as string },
    requestKey: null,
  });
  await f.service.deliver(
    session(A, false),
    "report.read",
    read,
    "b".repeat(32),
  );
  equal(f.pool.state.firstUse.get("1")?.basis, "pending_original_delivery");
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
  await storedSnapshotHttpRegression();
});
Deno.test("many component origins and delivery each use a bounded batch query", async () => {
  const f = nativeFixture(), profile = await f.save();
  const keys = Array.from({ length: 20 }, (_, i) => "analysis:SYNTHETIC-" + i);
  const report = await f.platform.writeReport({
    owner: A,
    reportId: null,
    profileId: profile.profile_id as string,
    body: { overall: { total_standard_score: 26 }, analyses: {} },
    expected: null,
    nowUtc: NOW,
    operation: "university.analyze",
    key: "SYNTHETIC-many",
    digest: HASH,
    paidOrigin: f.service.origin(f.verified, "university.analyze", keys),
  });
  equal(f.pool.state.origins.length, 20);
  equal(
    f.pool.trace.filter((q) => q.sql.startsWith("INSERT INTO jungsi_backend.score_result_origins"))
      .length,
    1,
  );
  const before = f.pool.trace.length;
  await f.repo.recordDelivered({
    owner: A,
    reportId: report.report_id,
    revision: 1,
    operation: "university.analyze",
    accessPassId: "2",
    componentKeys: keys,
    requestId: "a".repeat(32),
    nowUtc: NOW,
    tokenExpiresAtUtc: NOW + 1000000n,
  });
  equal(
    f.pool.trace.slice(before).filter((q) => q.sql.startsWith("WITH origins AS MATERIALIZED"))
      .length,
    1,
  );
  equal(f.pool.state.firstUse.size, 1);
  assert(f.pool.state.firstUse.has("2"));
});
Deno.test("new three API DTOs project through all25 closed bindings with session v1 unchanged", async () => {
  const f = nativeFixture(),
    projection = new PublicResponseProjection(
      RESPONSE_SCHEMAS,
      SERVICE_SPEC.operations,
    );
  equal(SERVICE_SPEC.operations.length, 25);
  const status = await f.service.execute({
    operation: "score-input.status.read",
    session: f.verified,
    management: null,
    body: {},
    query: { exam_id: "SYNTHETIC-mock" },
    params: {},
    requestKey: null,
  });
  const clean = projection.project("score-input.status.read", "paid", {
    ...status,
    owner_id: A,
  }) as NativeObject;
  assert(!Object.hasOwn(clean, "owner_id"));
  equal(clean.initial_remaining, 1);
  const sample = await f.service.execute({
    operation: "report.sample.read",
    session: session(A, false),
    management: null,
    body: {},
    query: {},
    params: {},
    requestKey: null,
  });
  equal(
    (projection.project(
      "report.sample.read",
      "standard",
      sample,
    ) as NativeObject).synthetic,
    true,
  );
  await f.save();
  const correction = await f.service.execute({
    operation: "score-input.correction.grant",
    session: await adminSnapshot(),
    management: null,
    body: {
      subject_id: A,
      exam_id: "SYNTHETIC-mock",
      stage: "mock",
      ticket_ref: "SYNTHETIC-projection-ticket",
      expected_version: 1,
      reason_code: "score_correction",
    },
    query: {},
    params: {},
    requestKey: "SYNTHETIC-projection-grant",
  });
  equal(
    (projection.project(
      "score-input.correction.grant",
      "paid",
      correction,
    ) as NativeObject).granted,
    true,
  );
  equal(
    Object.keys(
      (RESPONSE_SCHEMAS as {
        schemas: { session: { properties: Record<string, unknown> } };
      })
        .schemas.session.properties,
    ),
    [
      "format",
      "member_tier",
      "entitlement_expires_at",
    ],
  );
});
Deno.test("allowlisted unknown/inactive profiles cannot use preview exemption", () => {
  const p = policy((r) => {
    r.preview = {
      enabled: true,
      expires_at: utcText(NOW + 1000000n),
      allow_subjects: [A],
    };
  });
  for (const accountStatus of [undefined, "inactive"]) {
    const s = Object.freeze({
      ...session(),
      user: Object.freeze({ ...session().user, accountStatus }),
    });
    assert(!p.previewExempt(s, NOW));
  }
});

Deno.test("requesting only pending B cannot mark a new pass because stored analysis A has numbers", async () => {
  const delivered: PaidResultDelivery[] = [];
  const repo = {
    recordDelivered: (r: PaidResultDelivery) => {
      delivered.push(r);
      return Promise.resolve();
    },
  } as ScoreInputRepositoryPort;
  const p = policy(),
    service = new ScoreInputService(repo, p, {
      getExamPack: () => Promise.resolve(null),
      getTotalModel: () => Promise.resolve(null),
    }, clock);
  const report: NativeObject = {
    report_id: "SYNTHETIC-r",
    report_version: 1,
    overall: { total_standard_score: 386 },
    analyses: {
      "SYNTHETIC-A": { converted_score: "500.0" },
      "SYNTHETIC-B": { status: "pending", converted_score: null },
    },
  };
  const pass2 = Object.freeze({ ...session(), paidPassId: "2" });
  await service.deliver(pass2, "university.analyze", report, "a".repeat(32), [
    "SYNTHETIC-B",
  ]);
  equal(delivered.length, 0);
  (report.analyses as NativeObject)["SYNTHETIC-B"] = {
    converted_score: "400.0",
  };
  await service.deliver(pass2, "university.analyze", report, "b".repeat(32), [
    "SYNTHETIC-B",
  ]);
  equal(delivered.length, 1);
  equal(delivered[0].componentKeys, ["analysis:SYNTHETIC-B"]);
  equal(delivered[0].accessPassId, "2");
});

Deno.test("all consumable semantic rejections keep HTTP422 rather than becoming a misleading503", async () => {
  for (const code of SCORE_CONTENT_REJECTION_CODES) {
    const response = safeFailure(new AccessError(code, 422), "a".repeat(32));
    equal(response.status, 422);
    equal((await response.json()).error.code, code);
  }
  for (
    const [code, status] of [["score_input_exhausted", 409], [
      "score_stage_closed",
      409,
    ], [
      "profile_required",
      422,
    ], ["score_input_transition_pending", 503]] as const
  ) {
    const response = safeFailure(new AccessError(code, status), "b".repeat(32));
    equal(response.status, status);
    equal((await response.json()).error.code, code);
  }
});
