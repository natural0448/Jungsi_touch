/** Synthetic clock and fake SQL only. No DB, network, or runtime settings. */
import { ApprovedOperatingPolicy } from "../../supabase/functions/_shared/jungsi/application/operating_policy.ts";
import {
  SCORE_INPUT_ROLLOUT_VALID_SQL,
  SupabaseScoreInputRepository,
} from "../../supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts";
import {
  admissionMicros,
  SERVICE_END_UTC_MICROS,
} from "../../supabase/functions/_shared/jungsi/application/service_end_admission.ts";
import { utcInstant, utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { A, nativeFixture } from "../edge/synthetic_score_input_policy.ts";
const assert = (x) => {
  if (!x) throw Error("synthetic assertion");
};
const eq = (a, b) => assert(Object.is(a, b));
const H = "a".repeat(64),
  END = utcInstant("2027-01-07T15:00:00Z"),
  EARLY = utcInstant("2026-12-31T15:00:00Z");
const JAN2 = utcInstant("2027-01-01T15:00:00Z"),
  EXAM = "SYNTHETIC-mock",
  SCOPE = "SYNTHETIC-canonical-season";
function policy(end) {
  const raw = {
    format: "jungsi.score-input-policy/v1",
    status: "approved",
    purpose: "paid_score_input",
    approval_reference_sha256: H,
    version: "SYNTHETIC-policy-v2",
    rollout_id: "SYNTHETIC-rollout",
    calculation_version: "SYNTHETIC-calculation",
    expires_at: utcText(end),
    personal_daily_analysis_limit: "replaced_by_stage_rights",
    initial_saves: 1,
    correction_grants: 1,
    physical: { max_request_calculation_units: 100, max_request_runtime_milliseconds: 10000 },
    preview: { enabled: false, expires_at: utcText(end), allow_subjects: [] },
    stages: [{
      exam_id: EXAM,
      input_scope_id: SCOPE,
      pack_version: "SYNTHETIC-pack.v1",
      academic_year: 2027,
      stage: "mock",
      window: { mode: "policy_lifetime" },
    }],
  };
  return new ApprovedOperatingPolicy(raw, {
    policyVersion: "SYNTHETIC-usage",
    approvalSha256: H,
    expiresAtUtc: end,
    exams: new Map([[EXAM, { packVersion: "SYNTHETIC-pack.v1", academicYear: 2027 }]]),
    registrySha256: "b".repeat(64),
    selectionSha256: "c".repeat(64),
    renewalContext: { format: "SYNTHETIC-budget", ceiling: 100 },
  });
}
function fixture(end, now) {
  const p = policy(end), f = nativeFixture(p);
  let appNow = now, dbNow = now;
  const repository = new SupabaseScoreInputRepository(f.sql, f.platform, p, {
    nowUtc: () => appNow,
  });
  f.pool.rolloutDecision = (params) =>
    utcInstant(String(params[9])) < end && dbNow < end && utcInstant(String(params[10])) === end;
  const stage = p.stage(EXAM, "mock", now < end ? now : end - 1n, false),
    context = { owner: A, stage, previewExempt: false };
  return {
    f,
    p,
    repository,
    context,
    setApp(v) {
      appNow = v;
    },
    setDb(v) {
      dbNow = v;
    },
  };
}
async function fails(work, code) {
  let e;
  try {
    await work();
  } catch (x) {
    e = x;
  }
  eq(e?.http, 503);
  eq(e?.code, code);
}
Deno.test("old January1 policy expires while January8 service admission remains open", async () => {
  eq(END, SERVICE_END_UTC_MICROS);
  eq(admissionMicros(JAN2), "open");
  const f = fixture(EARLY, EARLY - 1n);
  f.setApp(JAN2);
  f.setDb(JAN2);
  await fails(() => f.repository.state(f.context), "score_input_policy_unavailable");
});
Deno.test("renewal endpoint and database clock both enforce January8 boundary", async () => {
  const f = fixture(END, JAN2);
  await f.repository.state(f.context);
  f.setApp(END - 1n);
  f.setDb(END - 1n);
  await f.repository.state(f.context);
  f.setDb(END);
  await fails(() => f.repository.state(f.context), "score_input_transition_pending");
  f.setApp(END);
  eq(admissionMicros(END), "ended");
  await fails(() => f.repository.state(f.context), "score_input_policy_unavailable");
});
Deno.test("missing renewal row and missing relation fail closed without changes", async () => {
  assert(
    SCORE_INPUT_ROLLOUT_VALID_SQL.includes("JOIN jungsi_backend.score_policy_period_renewals"),
  );
  assert(SCORE_INPUT_ROLLOUT_VALID_SQL.includes("statement_timestamp()<p.new_expires_at"));
  const f = fixture(END, JAN2),
    before = [
      f.f.pool.state.profiles.size,
      f.f.pool.state.states.length,
      f.f.pool.state.attempts.length,
    ];
  f.f.pool.rolloutDecision = () => false;
  await fails(() => f.repository.state(f.context), "score_input_transition_pending");
  f.f.pool.rolloutDecision = () => {
    throw Error("synthetic_missing_relation");
  };
  await fails(() => f.repository.state(f.context), "storage_unavailable");
  eq(f.f.pool.state.profiles.size, before[0]);
  eq(f.f.pool.state.states.length, before[1]);
  eq(f.f.pool.state.attempts.length, before[2]);
});
