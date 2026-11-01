/** In-memory synthetic checks only; no PostgreSQL or operational state is used. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { ApprovedOperatingPolicy } from "../../supabase/functions/_shared/jungsi/application/operating_policy.ts";
import { ADMINISTRATOR_DAILY_KINDS } from "../../supabase/functions/_shared/jungsi/application/administrator_usage_policy.ts";
import { COMBINED_POLICY_CONSUMER_OPERATION_IDS } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { BUDGET_OPERATIONS } from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  buildPeriodRenewalContext,
  RuntimeUsagePolicy,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts";
import type { ApprovedRuntimeBinding } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
import { scoreInputBalance } from "../../supabase/functions/_shared/jungsi/domain/score_input_rights.ts";
import { utcInstant, utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import {
  SCORE_INPUT_ROLLOUT_VALID_SQL,
  SCORE_INPUT_UNMAPPED_PROFILE_SQL,
  SupabaseScoreInputRepository,
} from "../../supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts";
import {
  OWN_REPORT_LIST_SQL,
  OWN_REPORT_SCOPE_GUARD_SQL,
  SupabaseOwnReportList,
} from "../../supabase/functions/_shared/jungsi/infrastructure/own_report_list_postgres.ts";
import type { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
import { A, nativeFixture, NOW, scores } from "./synthetic_score_input_policy.ts";
import { syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";

const OLD_HASH = "a".repeat(64), NEW_HASH = "b".repeat(64);
const OLD_END = utcInstant("2026-11-22T00:00:00Z");
const NEW_END = utcInstant("2026-12-31T15:00:00Z");
const EXAM = "SYNTHETIC-mock", SCOPE = "SYNTHETIC-canonical-season";
const ROLLOUT = "SYNTHETIC-rollout", VERSION = "SYNTHETIC-policy-v2";

type Options = {
  change?: (raw: NativeObject) => void;
  usageVersion?: string;
  registryHash?: string;
  selectionHash?: string;
  extraExam?: boolean;
  budgetCeiling?: number;
  noRenewalContext?: boolean;
};
function makePolicy(approval: string, expiresAt: bigint, options: Options = {}) {
  const raw: NativeObject = {
    format: "jungsi.score-input-policy/v1",
    status: "approved",
    purpose: "paid_score_input",
    approval_reference_sha256: approval,
    version: VERSION,
    rollout_id: ROLLOUT,
    calculation_version: "SYNTHETIC-calculation",
    expires_at: utcText(expiresAt),
    personal_daily_analysis_limit: "replaced_by_stage_rights",
    initial_saves: 1,
    correction_grants: 1,
    physical: { max_request_calculation_units: 100, max_request_runtime_milliseconds: 10000 },
    preview: { enabled: false, expires_at: utcText(expiresAt), allow_subjects: [] },
    stages: [{
      exam_id: EXAM,
      input_scope_id: SCOPE,
      pack_version: "SYNTHETIC-pack.v1",
      academic_year: 2027,
      stage: "mock",
      window: { mode: "policy_lifetime" },
    }, {
      exam_id: EXAM,
      input_scope_id: SCOPE,
      pack_version: "SYNTHETIC-pack.v1",
      academic_year: 2027,
      stage: "provisional",
      window: {
        mode: "official",
        approved: true,
        source_ref: "https://example.invalid/SYNTHETIC-official",
        opens_at: utcText(NOW - 1000000n),
        closes_at: utcText(NOW + 1000000000n),
      },
    }],
  };
  options.change?.(raw);
  const exams = new Map<string, { packVersion: string; academicYear: number }>([
    [EXAM, { packVersion: "SYNTHETIC-pack.v1", academicYear: 2027 }],
  ]);
  if (options.extraExam) {
    exams.set("SYNTHETIC-extra", { packVersion: "SYNTHETIC-pack.v1", academicYear: 2027 });
  }
  return new ApprovedOperatingPolicy(raw, {
    policyVersion: options.usageVersion ?? "SYNTHETIC-usage",
    approvalSha256: approval,
    expiresAtUtc: expiresAt,
    exams,
    registrySha256: options.registryHash ?? "c".repeat(64),
    selectionSha256: options.selectionHash ?? "d".repeat(64),
    ...(options.noRenewalContext ? {} : {
      renewalContext: { format: "SYNTHETIC-budget", ceiling: options.budgetCeiling ?? 100 },
    }),
  });
}
async function renewalHash(policy: ApprovedOperatingPolicy): Promise<string> {
  const value = await policy.renewalSemanticsSha256();
  assert(typeof value === "string");
  return value;
}

type Renewal = {
  rollout: string;
  version: string;
  previous: string;
  next: string;
  semantics: string;
  previousEnd: bigint;
  effective: bigint;
  end: bigint;
  status: string;
};
function rolloutDecision(row: Renewal | null, dbNow = NOW, originalValidated = true) {
  return (params: readonly unknown[]): boolean => {
    const [rollout, version, approval] = params;
    if (!originalValidated || rollout !== ROLLOUT || version !== VERSION || !row) return false;
    const at = utcInstant(String(params[9])), policyEnd = utcInstant(String(params[10]));
    if (
      row.rollout !== rollout || row.version !== version || row.previous !== OLD_HASH ||
      row.semantics !== params[11] || row.status !== "validated"
    ) return false;
    if (approval === OLD_HASH) {
      return row.previousEnd === policyEnd && at < row.previousEnd && dbNow < row.previousEnd;
    }
    return row.next === approval && row.end === policyEnd && row.effective <= at &&
      at < row.end && row.effective <= dbNow && dbNow < row.end;
  };
}
function records(pool: ReturnType<typeof nativeFixture>["pool"]): string {
  const s = pool.state;
  return JSON.stringify({
    profiles: [...s.profiles],
    states: s.states,
    attempts: s.attempts,
    links: s.legacyLinks,
    corrections: s.corrections,
    firstUse: [...s.firstUse],
    reports: [...s.reports],
    revisions: [...s.revisions],
    origins: s.origins,
    usage: s.usage,
  });
}
async function deniedTransition(work: () => Promise<unknown>) {
  let error: unknown;
  try {
    await work();
  } catch (value) {
    error = value;
  }
  assert(error instanceof AccessError);
  equal(error.code, "score_input_transition_pending");
  equal(error.http, 503);
}
async function fixtureWithHistory() {
  const old = makePolicy(OLD_HASH, OLD_END), renewed = makePolicy(NEW_HASH, NEW_END);
  const initial = nativeFixture(old);
  await initial.save("SYNTHETIC-old-save");
  initial.pool.state.profiles.set("SYNTHETIC-legacy", [
    "SYNTHETIC-legacy",
    A,
    JSON.stringify(scores()),
    true,
    "2026-10-14T00:00:00.000000Z",
  ]);
  initial.pool.state.legacyLinks.push({
    profileId: "SYNTHETIC-legacy",
    owner: A,
    scope: SCOPE,
    stage: "mock",
    rollout: ROLLOUT,
  });
  const next = nativeFixture(renewed, initial.pool);
  const context = renewed.context(next.verified, EXAM, "mock", NOW, false);
  const row: Renewal = {
    rollout: ROLLOUT,
    version: VERSION,
    previous: OLD_HASH,
    next: NEW_HASH,
    semantics: await renewalHash(renewed),
    previousEnd: OLD_END,
    effective: NOW - 1000n,
    end: NEW_END,
    status: "validated",
  };
  return { old, renewed, initial, next, context, row };
}

Deno.test("renewal fingerprint excludes only approved expiry and reference while binding rights and counter context", async () => {
  const old = makePolicy(OLD_HASH, OLD_END), current = makePolicy(NEW_HASH, NEW_END);
  const expected = await renewalHash(old);
  equal(await renewalHash(current), expected);
  const different = [
    makePolicy(NEW_HASH, NEW_END, {
      change: (raw) => ((raw.stages as NativeObject[])[0].input_scope_id = "SYNTHETIC-other"),
    }),
    makePolicy(NEW_HASH, NEW_END, {
      change: (raw) => ((raw.physical as NativeObject).max_request_calculation_units = 101),
    }),
    makePolicy(NEW_HASH, NEW_END, {
      change: (
        raw,
      ) => (((raw.stages as NativeObject[])[1].window as NativeObject).closes_at = utcText(
        NOW + 900000000n,
      )),
    }),
    makePolicy(NEW_HASH, NEW_END, { usageVersion: "SYNTHETIC-other-usage" }),
    makePolicy(NEW_HASH, NEW_END, { registryHash: "e".repeat(64) }),
    makePolicy(NEW_HASH, NEW_END, { selectionHash: "f".repeat(64) }),
    makePolicy(NEW_HASH, NEW_END, { extraExam: true }),
    makePolicy(NEW_HASH, NEW_END, { budgetCeiling: 101 }),
    makePolicy(NEW_HASH, NEW_END, {
      change: (raw) => ((raw.preview as NativeObject).expires_at = utcText(NEW_END - 1n)),
    }),
    makePolicy(NEW_HASH, NEW_END, {
      change: (raw) => ((raw.preview as NativeObject).enabled = true),
    }),
    makePolicy(NEW_HASH, NEW_END, {
      change: (raw) => ((raw.preview as NativeObject).allow_subjects = [A]),
    }),
  ];
  for (const changed of different) assert(await renewalHash(changed) !== expected);
});

Deno.test("renewed input guard preserves existing state attempts legacy and first-use records", async () => {
  const f = await fixtureWithHistory();
  const before = records(f.next.pool);
  f.next.pool.rolloutDecision = rolloutDecision(f.row);
  const state = await f.next.repo.state(f.context);
  equal(scoreInputBalance(state).initialUsed, 1);
  assert(typeof state.currentProfileId === "string");
  equal(records(f.next.pool), before);
  const call = f.next.pool.trace.filter((x) =>
    x.sql.startsWith("SELECT EXISTS(SELECT 1 FROM jungsi_backend.score_policy_rollouts")
  ).at(-1)!;
  equal(call.parameters[0], ROLLOUT);
  equal(call.parameters[1], VERSION);
  equal(call.parameters[2], NEW_HASH);
  equal(call.parameters[9], utcText(NOW));
  equal(call.parameters[10], utcText(NEW_END));
  equal(call.parameters[11], f.row.semantics);
  assert(call.sql.includes(SCORE_INPUT_ROLLOUT_VALID_SQL));
  assert(call.sql.includes(SCORE_INPUT_UNMAPPED_PROFILE_SQL));
});

Deno.test("renewal rejects absent mismatched unvalidated premature or expired references without changing records", async () => {
  const f = await fixtureWithHistory(), before = records(f.next.pool);
  const bad: (Renewal | null)[] = [
    null,
    { ...f.row, rollout: "SYNTHETIC-other" },
    { ...f.row, version: "SYNTHETIC-other" },
    { ...f.row, previous: "f".repeat(64) },
    { ...f.row, next: "e".repeat(64) },
    { ...f.row, semantics: "f".repeat(64) },
    { ...f.row, end: NEW_END - 1n },
    { ...f.row, status: "draft" },
    { ...f.row, effective: NOW + 1n },
  ];
  for (const row of bad) {
    f.next.pool.rolloutDecision = rolloutDecision(row);
    await deniedTransition(() => f.next.repo.state(f.context));
    equal(records(f.next.pool), before);
  }
  f.next.pool.rolloutDecision = rolloutDecision(f.row, NEW_END);
  await deniedTransition(() => f.next.repo.state(f.context));
  f.next.pool.rolloutDecision = rolloutDecision(f.row, NOW, false);
  await deniedTransition(() => f.next.repo.state(f.context));
  equal(records(f.next.pool), before);
  const expired = new SupabaseScoreInputRepository(f.next.sql, f.next.platform, f.renewed, {
    nowUtc: () => NEW_END,
  });
  let failure: unknown;
  try {
    await expired.state(f.context);
  } catch (value) {
    failure = value;
  }
  assert(failure instanceof AccessError);
  equal(failure.code, "score_input_policy_unavailable");
  equal(records(f.next.pool), before);
});

Deno.test("renewal never turns a legacy-only profile without state into a fresh right", async () => {
  const renewed = makePolicy(NEW_HASH, NEW_END), f = nativeFixture(renewed);
  const row: Renewal = {
    rollout: ROLLOUT,
    version: VERSION,
    previous: OLD_HASH,
    next: NEW_HASH,
    semantics: await renewalHash(renewed),
    previousEnd: OLD_END,
    effective: NOW - 1000n,
    end: NEW_END,
    status: "validated",
  };
  f.pool.state.profiles.set("SYNTHETIC-orphan", [
    "SYNTHETIC-orphan",
    A,
    JSON.stringify(scores()),
    true,
    "2026-10-14T00:00:00.000000Z",
  ]);
  f.pool.state.legacyLinks.push({
    profileId: "SYNTHETIC-orphan",
    owner: A,
    scope: SCOPE,
    stage: "mock",
    rollout: ROLLOUT,
  });
  f.pool.rolloutDecision = rolloutDecision(row);
  const before = records(f.pool), context = renewed.context(f.verified, EXAM, "mock", NOW, false);
  await deniedTransition(() => f.repo.state(context));
  equal(records(f.pool), before);
});

Deno.test("own report guard uses the same renewal tuple and leaves unverified current status null", async () => {
  const policy = makePolicy(NEW_HASH, NEW_END);
  const row: Renewal = {
    rollout: ROLLOUT,
    version: VERSION,
    previous: OLD_HASH,
    next: NEW_HASH,
    semantics: await renewalHash(policy),
    previousEnd: OLD_END,
    effective: NOW - 1000n,
    end: NEW_END,
    status: "validated",
  };
  const report = [
    "SYNTHETIC-report",
    A,
    A,
    EXAM,
    "2",
    "2026-10-14T23:59:59.999999Z",
    "mock",
    true,
    true,
    SCOPE,
    EXAM,
    EXAM,
    "repeatable read",
  ];
  let selected: Renewal | null = row;
  const calls: { sql: string; args: readonly unknown[] }[] = [];
  const transport = {
    read: async (
      _owner: string,
      work: (
        tx: { query: (sql: string, args: readonly unknown[]) => Promise<unknown[][]> },
      ) => unknown,
    ) =>
      await work({
        query: (sql, args) => {
          calls.push({ sql, args });
          if (sql === OWN_REPORT_LIST_SQL) return Promise.resolve([report]);
          assert(sql === OWN_REPORT_SCOPE_GUARD_SQL);
          const scopes = JSON.parse(args[1] as string) as {
            input_scope: string;
            stage: string;
            rollout_id: string;
            policy_version: string;
            approval_sha256: string;
          }[];
          const s = scopes[0];
          const syntheticParameters = [
            s.rollout_id,
            s.policy_version,
            s.approval_sha256,
            null,
            null,
            null,
            null,
            null,
            null,
            args[2],
            args[3],
            args[4],
          ];
          return Promise.resolve([[
            s.input_scope,
            s.stage,
            rolloutDecision(selected)(syntheticParameters),
            true,
          ]]);
        },
      }),
  } as unknown as SupabaseSqlTransport;
  const port = new SupabaseOwnReportList(transport, policy, { nowUtc: () => NOW });
  const request = { owner: A, examId: EXAM, asOfUtc: NOW, after: null, take: 11 };
  equal((await port.read(request))[0].isCurrent, true);
  const guard = calls.find((c) => c.sql === OWN_REPORT_SCOPE_GUARD_SQL)!;
  equal(guard.args[2], utcText(NOW));
  equal(guard.args[3], utcText(NEW_END));
  equal(guard.args[4], row.semantics);
  assert(guard.sql.includes(SCORE_INPUT_ROLLOUT_VALID_SQL));
  selected = { ...row, previous: "f".repeat(64) };
  equal((await port.read(request))[0].isCurrent, null);
});

Deno.test("rollout and legacy guards retain exact old bindings and both expiration clocks", async () => {
  for (
    const item of [
      "r.rollout_id=g.rollout_id",
      "r.policy_version=g.policy_version",
      "r.status='validated'",
      "r.approval_sha256=g.approval_sha256",
      "p.previous_expires_at=g.policy_expires_at",
      "g.evaluated_at<p.previous_expires_at",
      "statement_timestamp()<p.previous_expires_at",
      "p.previous_approval_sha256=r.approval_sha256",
      "p.new_approval_sha256=g.approval_sha256",
      "p.policy_semantics_sha256=g.policy_semantics_sha256",
      "p.new_expires_at=g.policy_expires_at",
      "p.status='validated'",
      "p.effective_at<=g.evaluated_at",
      "g.evaluated_at<p.new_expires_at",
      "p.effective_at<=statement_timestamp()",
      "statement_timestamp()<p.new_expires_at",
    ]
  ) assert(SCORE_INPUT_ROLLOUT_VALID_SQL.includes(item));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(SCORE_INPUT_UNMAPPED_PROFILE_SQL),
  );
  equal(
    Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join(""),
    "dc6a3613db7b3a25c07a909c364dccaf7c0c0e8069e26ca99ff501b994e3a16d",
  );
});

Deno.test("old and new approvals require exact prior expiry and complete renewal context", async () => {
  const f = await fixtureWithHistory(), before = records(f.initial.pool);
  const existing = nativeFixture(f.old, f.initial.pool);
  const originalContext = f.old.context(existing.verified, EXAM, "mock", NOW, false);
  existing.pool.rolloutDecision = rolloutDecision(null);
  await deniedTransition(() => existing.repo.state(originalContext));
  existing.pool.rolloutDecision = rolloutDecision(f.row);
  equal(scoreInputBalance(await existing.repo.state(originalContext)).initialUsed, 1);
  existing.pool.rolloutDecision = rolloutDecision(f.row, OLD_END);
  await deniedTransition(() => existing.repo.state(originalContext));
  const unauthorizedExtension = makePolicy(OLD_HASH, NEW_END);
  const altered = nativeFixture(unauthorizedExtension, f.initial.pool);
  altered.pool.rolloutDecision = rolloutDecision(f.row);
  await deniedTransition(() =>
    altered.repo.state(unauthorizedExtension.context(altered.verified, EXAM, "mock", NOW, false))
  );
  const originalMissing = makePolicy(OLD_HASH, OLD_END, { noRenewalContext: true });
  equal(await originalMissing.renewalSemanticsSha256(), null);
  const missingOld = nativeFixture(originalMissing, f.initial.pool);
  missingOld.pool.rolloutDecision = rolloutDecision(f.row);
  await deniedTransition(() =>
    missingOld.repo.state(originalMissing.context(missingOld.verified, EXAM, "mock", NOW, false))
  );
  const missing = makePolicy(NEW_HASH, NEW_END, { noRenewalContext: true });
  equal(await missing.renewalSemanticsSha256(), null);
  const next = nativeFixture(missing, f.initial.pool);
  next.pool.rolloutDecision = rolloutDecision(f.row);
  await deniedTransition(() =>
    next.repo.state(missing.context(next.verified, EXAM, "mock", NOW, false))
  );
  equal(records(next.pool), before);
});

Deno.test("runtime renewal context binds budgets limits scope and never includes storage credentials", async () => {
  const binding = {
    projectUrl: "https://synthetic.invalid",
    scopeSha256: "1".repeat(64),
    expiresAtUtc: OLD_END,
    consumerGeneration: "member-json-22",
    operations: ["score-profile.create"],
    artifacts: [{ kind: "exam_pack", key: EXAM }],
    references: {
      registry: { objectKey: "SYNTHETIC/registry", bytes: 10, sha256: "c".repeat(64) },
      selection: { objectKey: "SYNTHETIC/selection", bytes: 11, sha256: "d".repeat(64) },
    },
    storage: {
      bucket: "synthetic",
      objectPrefix: "SYNTHETIC/",
      secretKey: "SYNTHETIC-SECRET-NOT-IN-CONTEXT",
      limits: {
        maxArtifactBytes: 10,
        maxBucketBytes: 20,
        maxMetadataBytes: 5,
        requestTimeoutMs: 8,
      },
    },
    readLimits: { maxRequests: 3, maxBytes: 10 },
    repositoryLimits: { maxRecordBytes: 12, maxForecastRows: 3, maxBatchIds: 4 },
    usageStoreLimits: { leaseSeconds: 20n, runtimeHardLimitSeconds: 10n, clockMarginSeconds: 1n },
    memberJson: { prefix: "SYNTHETIC/member/", maxItems: 3, maxObjectBytes: 8 },
    readViews: {
      cursorLifetimeMicroseconds: 60000000n,
      maxCursorCharacters: 4096,
      snapshot: {
        artifactKind: "SYNTHETIC-head",
        lineage: "SYNTHETIC-lineage",
        minimumSequence: 1n,
        scopeSha256: "3".repeat(64),
        normalizationRulesVersion: "SYNTHETIC-norm",
        normalizationRulesSha256: "4".repeat(64),
        selectionRulesVersion: "SYNTHETIC-selection",
        selectionRulesSha256: "5".repeat(64),
        publisherReferences: ["SYNTHETIC-publisher"],
        reviewerReferences: ["SYNTHETIC-reviewer"],
        objectPrefix: "SYNTHETIC/snapshot/",
        maxMetadataBytes: 8192,
        maxGzipBytes: 8192,
        maxDecodedBytes: 32768,
        maxRows: 8,
        maxParts: 4,
        maxDepth: 32,
        maxInMemoryBytes: 600000,
        expiresAtUtc: OLD_END,
      },
    },
  } as unknown as ApprovedRuntimeBinding;
  const budget = (approval: string, expiry: bigint): NativeObject => ({
    format: "SYNTHETIC-usage",
    version: "SYNTHETIC-counter",
    approval_reference_sha256: approval,
    expires_at: utcText(expiry),
    dimensions: [{ kind: "request_window", ceiling: 100, paid: 20, period_seconds: 60 }],
    nested_probe: { expires_at: utcText(OLD_END) },
    operations: [{ operation: "score-profile.create", base_units: 1 }],
    exams: [{ exam_id: EXAM, pack_version: "SYNTHETIC-pack.v1", academic_year: 2027 }],
    operating_policy: {
      approval_reference_sha256: approval,
      expires_at: utcText(expiry),
      preview: { enabled: false, expires_at: utcText(expiry), allow_subjects: [] },
      scope: SCOPE,
    },
    administrator_policy: {
      approval_reference_sha256: approval,
      expires_at: utcText(expiry),
      limit: 3,
    },
  });
  const old = budget(OLD_HASH, OLD_END), current = budget(NEW_HASH, NEW_END);
  const view = binding.readViews!;
  const newBinding = {
    ...binding,
    expiresAtUtc: NEW_END,
    readViews: { ...view, snapshot: { ...view.snapshot, expiresAtUtc: NEW_END } },
  };
  const oldContext = buildPeriodRenewalContext(old, binding);
  const expected = await nativeJsonSha256(oldContext);
  equal(await nativeJsonSha256(buildPeriodRenewalContext(current, newBinding)), expected);
  assert(!nativeJsonText(oldContext).includes("SYNTHETIC-SECRET-NOT-IN-CONTEXT"));
  equal(old.approval_reference_sha256, OLD_HASH);
  const changedBudget = cloneNativeJson(current);
  (changedBudget.dimensions as NativeObject[])[0].ceiling = 101;
  assert(await nativeJsonSha256(buildPeriodRenewalContext(changedBudget, newBinding)) !== expected);
  const changedAdmin = cloneNativeJson(current);
  (changedAdmin.administrator_policy as NativeObject).expires_at = utcText(NEW_END - 1n);
  assert(await nativeJsonSha256(buildPeriodRenewalContext(changedAdmin, newBinding)) !== expected);
  const changedNested = cloneNativeJson(current);
  (changedNested.nested_probe as NativeObject).expires_at = utcText(NEW_END);
  assert(await nativeJsonSha256(buildPeriodRenewalContext(changedNested, newBinding)) !== expected);
  const changedBindingExpiry = { ...newBinding, expiresAtUtc: NEW_END - 1n };
  assert(
    await nativeJsonSha256(buildPeriodRenewalContext(current, changedBindingExpiry)) !== expected,
  );
  const changedSnapshotExpiry = {
    ...newBinding,
    readViews: {
      ...newBinding.readViews,
      snapshot: { ...newBinding.readViews.snapshot, expiresAtUtc: NEW_END - 1n },
    },
  };
  assert(
    await nativeJsonSha256(buildPeriodRenewalContext(current, changedSnapshotExpiry)) !== expected,
  );
  for (const path of ["usage", "operating", "preview"]) {
    const changed = cloneNativeJson(current);
    if (path === "usage") changed.expires_at = utcText(NEW_END - 1n);
    if (path === "operating") {
      (changed.operating_policy as NativeObject).expires_at = utcText(NEW_END - 1n);
    }
    if (path === "preview") {
      ((changed.operating_policy as NativeObject).preview as NativeObject).expires_at = utcText(
        NEW_END - 1n,
      );
    }
    assert(await nativeJsonSha256(buildPeriodRenewalContext(changed, newBinding)) !== expected);
  }
  const oldOffset = cloneNativeJson(old), newOffset = cloneNativeJson(current);
  (oldOffset.administrator_policy as NativeObject).expires_at = utcText(OLD_END - 1n);
  (newOffset.administrator_policy as NativeObject).expires_at = utcText(NEW_END - 1n);
  equal(
    await nativeJsonSha256(buildPeriodRenewalContext(oldOffset, binding)),
    await nativeJsonSha256(buildPeriodRenewalContext(newOffset, newBinding)),
  );
  const changedSnapshotLimit = {
    ...newBinding,
    readViews: {
      ...newBinding.readViews,
      snapshot: { ...newBinding.readViews.snapshot, maxRows: 9 },
    },
  };
  assert(
    await nativeJsonSha256(buildPeriodRenewalContext(current, changedSnapshotLimit)) !== expected,
  );
  const changedCursor = {
    ...newBinding,
    readViews: {
      ...newBinding.readViews,
      cursorLifetimeMicroseconds: view.cursorLifetimeMicroseconds + 1n,
    },
  };
  assert(await nativeJsonSha256(buildPeriodRenewalContext(current, changedCursor)) !== expected);
  const changedRegistry = {
    ...newBinding,
    references: {
      ...newBinding.references,
      registry: { ...newBinding.references.registry, objectKey: "SYNTHETIC/other" },
    },
  };
  assert(await nativeJsonSha256(buildPeriodRenewalContext(current, changedRegistry)) !== expected);
  const changedRead = { ...newBinding, readLimits: { ...newBinding.readLimits, maxBytes: 11 } };
  assert(await nativeJsonSha256(buildPeriodRenewalContext(current, changedRead)) !== expected);
  const changedLease = {
    ...newBinding,
    usageStoreLimits: { ...binding.usageStoreLimits, leaseSeconds: 21n },
  };
  assert(await nativeJsonSha256(buildPeriodRenewalContext(current, changedLease)) !== expected);
  const changedScope = { ...newBinding, scopeSha256: "2".repeat(64) };
  assert(await nativeJsonSha256(buildPeriodRenewalContext(current, changedScope)) !== expected);
});

Deno.test("complete synthetic runtime policies bind the approved synchronized renewal", async () => {
  async function fixture(approval: string, expiry: bigint) {
    const f = await syntheticRuntimeBinding((d) => {
      d.format = "jungsi.edge-api-binding/v3";
      d.approval_reference_sha256 = approval;
      d.expires_at = utcText(expiry);
      d.scope = {
        operations: [...COMBINED_POLICY_CONSUMER_OPERATION_IDS],
        artifacts: [{ kind: "catalog", key: "service" }, { kind: "exam_pack", key: EXAM }],
      };
      d.read_views = {
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
          expires_at: utcText(expiry),
        },
        report_locator: { cursor_lifetime_seconds: 60, max_cursor_characters: 4096 },
      };
      ((d.limits as NativeObject).read as NativeObject).max_bytes = 1048576;
    });
    const binding = await f.load();
    const body: NativeObject = {
      format: "jungsi.runtime-usage-policy/v4",
      status: "approved",
      purpose: "jungsi-api-runtime",
      version: "SYNTHETIC-existing-counter",
      policy_revision: "SYNTHETIC-combined-revision",
      approval_reference_sha256: approval,
      expires_at: utcText(expiry),
      exams: [{
        exam_id: EXAM,
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
        approval_reference_sha256: approval,
        version: VERSION,
        rollout_id: ROLLOUT,
        calculation_version: "SYNTHETIC-calc",
        expires_at: utcText(expiry),
        personal_daily_analysis_limit: "replaced_by_stage_rights",
        initial_saves: 1,
        correction_grants: 1,
        physical: { max_request_calculation_units: 100, max_request_runtime_milliseconds: 10000 },
        preview: { enabled: false, expires_at: utcText(expiry), allow_subjects: [] },
        stages: [{
          exam_id: EXAM,
          input_scope_id: SCOPE,
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
        approval_reference_sha256: approval,
        expires_at: utcText(expiry),
        daily_dimensions: [...ADMINISTRATOR_DAILY_KINDS],
      },
    };
    const make = (value = body) =>
      new RuntimeUsagePolicy(
        new TextEncoder().encode(nativeJsonText(value)),
        binding,
        new SyntheticNativeRepository(),
        { nowUtc: () => NOW },
        { exists: () => Promise.resolve(false) },
        "rights",
      );
    return { body, make };
  }
  const old = await fixture(OLD_HASH, OLD_END), renewed = await fixture(NEW_HASH, NEW_END);
  const expected = await renewalHash(old.make().operating!);
  equal(await renewalHash(renewed.make().operating!), expected);
  const previewChanged = cloneNativeJson(renewed.body);
  ((previewChanged.operating_policy as NativeObject).preview as NativeObject).expires_at = utcText(
    NEW_END - 1n,
  );
  assert(await renewalHash(renewed.make(previewChanged).operating!) !== expected);
  const administratorChanged = cloneNativeJson(renewed.body);
  (administratorChanged.administrator_policy as NativeObject).expires_at = utcText(NEW_END - 1n);
  assert(await renewalHash(renewed.make(administratorChanged).operating!) !== expected);
});
