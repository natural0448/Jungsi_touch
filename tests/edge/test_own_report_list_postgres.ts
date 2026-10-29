import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { ApprovedOperatingPolicy } from "../../supabase/functions/_shared/jungsi/application/operating_policy.ts";
import {
  OWN_REPORT_LIST_SQL,
  OWN_REPORT_LIST_UNVERIFIED_SQL,
  OWN_REPORT_SCOPE_GUARD_SQL,
  SupabaseOwnReportList,
} from "../../supabase/functions/_shared/jungsi/infrastructure/own_report_list_postgres.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002",
  NOW = 1700000000000000n,
  EXAM = "SYNTHETIC-exam",
  ALIAS = "SYNTHETIC-alias",
  SCOPE = "SYNTHETIC-season",
  HASH = "a".repeat(64),
  EXPIRY = NOW + 3600000000n;
function policy(): ApprovedOperatingPolicy {
  const window = {
    mode: "official",
    approved: true,
    source_ref: "https://example.org/synthetic",
    opens_at: utcText(NOW - 1000000n),
    closes_at: utcText(EXPIRY),
  };
  const raw: NativeObject = {
    format: "jungsi.score-input-policy/v1",
    status: "approved",
    purpose: "paid_score_input",
    approval_reference_sha256: HASH,
    version: "SYNTHETIC-policy",
    rollout_id: "SYNTHETIC-rollout",
    calculation_version: "SYNTHETIC-calculation",
    expires_at: utcText(EXPIRY),
    personal_daily_analysis_limit: "replaced_by_stage_rights",
    initial_saves: 1,
    correction_grants: 1,
    physical: { max_request_calculation_units: 100, max_request_runtime_milliseconds: 10000 },
    preview: { enabled: false, expires_at: utcText(EXPIRY), allow_subjects: [] },
    stages: [
      {
        exam_id: EXAM,
        input_scope_id: SCOPE,
        pack_version: "SYNTHETIC-pack",
        academic_year: 2027,
        stage: "provisional",
        window,
      },
      {
        exam_id: ALIAS,
        input_scope_id: SCOPE,
        pack_version: "SYNTHETIC-pack",
        academic_year: 2027,
        stage: "provisional",
        window,
      },
      {
        exam_id: EXAM,
        input_scope_id: SCOPE,
        pack_version: "SYNTHETIC-pack",
        academic_year: 2027,
        stage: "final",
        window,
      },
    ],
  };
  return new ApprovedOperatingPolicy(raw, {
    policyVersion: "SYNTHETIC-usage",
    approvalSha256: HASH,
    expiresAtUtc: EXPIRY,
    exams: new Map(
      [EXAM, ALIAS].map((id) => [id, { packVersion: "SYNTHETIC-pack", academicYear: 2027 }]),
    ),
    registrySha256: "b".repeat(64),
    selectionSha256: "c".repeat(64),
  });
}
type ScopeRequest = {
  input_scope: string;
  stage: string;
  exam_ids: string[];
  rollout_id: string;
  policy_version: string;
  approval_sha256: string;
  stage_mappings: { exam_id: string; input_scope: string; stage: string }[];
};
function fixture(
  rows: unknown[][],
  options: {
    policy?: ApprovedOperatingPolicy | null;
    now?: bigint;
    guards?: (scopes: ScopeRequest[]) => unknown[][];
  } = {},
) {
  const calls: { owner: string; sql: string; args: readonly unknown[] }[] = [];
  const sql = {
    read: async (
      owner: string,
      work: (
        tx: { query: (s: string, a: readonly unknown[]) => Promise<unknown[][]> },
      ) => Promise<unknown>,
    ) =>
      await work({
        query: (statement, args) => {
          calls.push({ owner, sql: statement, args });
          if (statement === OWN_REPORT_SCOPE_GUARD_SQL) {
            const scopes = JSON.parse(args[1] as string) as ScopeRequest[];
            return Promise.resolve(
              options.guards?.(scopes) ?? scopes.map((s) => [s.input_scope, s.stage, true, true]),
            );
          }
          return Promise.resolve(rows);
        },
      }),
  } as unknown as SupabaseSqlTransport;
  return {
    port: new SupabaseOwnReportList(sql, options.policy === undefined ? policy() : options.policy, {
      nowUtc: () => options.now ?? NOW,
    }),
    calls,
  };
}
const report = (overrides: Record<number, unknown> = {}): unknown[] => {
  const data: unknown[] = [
    "SYNTHETIC-report",
    OWNER,
    OWNER,
    EXAM,
    "2",
    "2023-11-14T22:13:19.999999Z",
    "provisional",
    true,
    true,
    SCOPE,
    EXAM,
    EXAM,
    "repeatable read",
  ];
  for (const [index, value] of Object.entries(overrides)) data[Number(index)] = value;
  return data;
};
const request = { owner: OWNER, examId: EXAM, asOfUtc: NOW, after: null, take: 11 };
async function denied(work: () => Promise<unknown>, code: string) {
  let rejected = false;
  try {
    await work();
  } catch (error) {
    assert(error instanceof AccessError);
    equal(error.code, code);
    rejected = true;
  }
  assert(rejected);
}
Deno.test("own report SQL bounds the owner page and validates policy and legacy transition in one batch", async () => {
  const f = fixture([report()]);
  const rows = await f.port.read(request);
  equal(rows[0].revision, 2);
  equal(rows[0].stage, "provisional");
  equal(rows[0].isCurrent, true);
  assert(rows[0].updatedAtUtc === NOW - 1n);
  equal(f.calls.length, 2);
  equal(f.calls[0].owner, OWNER);
  equal(f.calls[0].sql, OWN_REPORT_LIST_SQL);
  equal(f.calls[0].args, [OWNER, EXAM, "2023-11-14T22:13:20Z", null, null, 11]);
  equal(f.calls[1].sql, OWN_REPORT_SCOPE_GUARD_SQL);
  const scopes = JSON.parse(f.calls[1].args[1] as string) as ScopeRequest[];
  equal(scopes.length, 1);
  equal(scopes[0], {
    input_scope: SCOPE,
    stage: "provisional",
    rollout_id: "SYNTHETIC-rollout",
    policy_version: "SYNTHETIC-policy",
    approval_sha256: HASH,
    exam_ids: [EXAM, ALIAS],
    stage_mappings: [
      { exam_id: EXAM, input_scope: SCOPE, stage: "provisional" },
      { exam_id: EXAM, input_scope: SCOPE, stage: "final" },
      { exam_id: ALIAS, input_scope: SCOPE, stage: "provisional" },
    ],
  });
  equal(f.calls[1].args[0], OWNER);
  assert(OWN_REPORT_LIST_SQL.includes("r.owner_id=$1 AND p.owner_id=$1"));
  assert(OWN_REPORT_LIST_SQL.includes("LIMIT $6"));
  assert(OWN_REPORT_LIST_SQL.includes('r.report_id COLLATE "C" DESC'));
  assert(OWN_REPORT_LIST_SQL.includes('$5::text COLLATE "C"'));
  assert(!/COUNT\s*\(|body::|scores::|SELECT\s+\*/i.test(OWN_REPORT_LIST_SQL));
  assert(OWN_REPORT_SCOPE_GUARD_SQL.includes("r.approval_sha256=g.approval_sha256"));
  assert(OWN_REPORT_SCOPE_GUARD_SQL.includes("l.rollout_id<>g.rollout_id"));
  assert(OWN_REPORT_SCOPE_GUARD_SQL.includes("p.owner_id=g.owner_id"));
});
Deno.test("own report SQL rejects foreign result owner and invalid bounded request", async () => {
  for (const kind of ["foreign", "too_many", "bad_take"]) {
    const data = kind === "too_many"
      ? Array.from({ length: 3 }, () => report())
      : [report({ 2: OTHER })];
    const f = fixture(data);
    await denied(
      () => f.port.read({ ...request, examId: null, take: kind === "bad_take" ? 22 : 2 }),
      "storage_result_invalid",
    );
    if (kind === "bad_take") equal(f.calls.length, 0);
  }
});
Deno.test("own report SQL preserves a missing legacy exam and stage as unknown", async () => {
  const f = fixture([
    report({
      0: "SYNTHETIC-legacy",
      3: null,
      4: "1",
      6: null,
      7: null,
      9: null,
      10: null,
      11: null,
    }),
  ]);
  const rows = await f.port.read({ ...request, examId: null });
  equal([rows[0].examId, rows[0].stage, rows[0].isCurrent], [null, null, null]);
  equal(f.calls.length, 1);
});
Deno.test("own report SQL rejects conflicting or invalid input-stage evidence", async () => {
  for (
    const changes of [{ 6: "final", 8: false }, { 6: "bad-stage" }, { 6: null, 7: true }, {
      6: "final",
      9: null,
    }, { 6: null, 7: null, 9: null, 10: EXAM }]
  ) {
    const f = fixture([report(changes)]);
    await denied(() => f.port.read(request), "storage_result_invalid");
  }
});
Deno.test("own report list shares one guard across aliases and separates stages", async () => {
  const f = fixture([
    report({ 0: "SYNTHETIC-a", 3: EXAM, 10: EXAM, 11: EXAM }),
    report({ 0: "SYNTHETIC-b", 3: ALIAS, 7: false, 10: ALIAS, 11: EXAM }),
    report({ 0: "SYNTHETIC-c", 6: "final", 7: true }),
  ], {
    guards: (scopes) => [...scopes].reverse().map((s) => [s.input_scope, s.stage, true, true]),
  });
  const rows = await f.port.read({ ...request, examId: null });
  equal(rows.map((r) => [r.stage, r.isCurrent]), [["provisional", true], ["provisional", null], [
    "final",
    true,
  ]]);
  equal(f.calls.length, 2);
  const scopes = JSON.parse(f.calls[1].args[1] as string) as ScopeRequest[];
  equal(scopes.length, 2);
  equal(scopes.map((s) => [s.stage, s.exam_ids]), [["provisional", [EXAM, ALIAS]], ["final", [
    EXAM,
  ]]]);
});
Deno.test("rollout or unmapped legacy profile failures leave current status unknown", async () => {
  for (const guard of [[false, true], [true, false]]) {
    const f = fixture([report()], {
      guards: (scopes) => scopes.map((s) => [s.input_scope, s.stage, ...guard]),
    });
    const rows = await f.port.read(request);
    equal([rows[0].stage, rows[0].isCurrent], ["provisional", null]);
    equal(f.calls.length, 2);
  }
});
Deno.test("missing policy preserves listing without accessing transition tables", async () => {
  const f = fixture([report({ 6: null, 7: null, 9: null, 10: null, 11: null, 12: null })], {
    policy: null,
  });
  const rows = await f.port.read(request);
  equal([rows[0].stage, rows[0].isCurrent], [null, null]);
  equal(f.calls.length, 1);
  equal(f.calls[0].sql, OWN_REPORT_LIST_UNVERIFIED_SQL);
  assert(!/score_input_|score_policy_rollouts/.test(OWN_REPORT_LIST_UNVERIFIED_SQL));
});
Deno.test("two-query stage check requires one fixed read snapshot", async () => {
  for (const isolation of ["read committed", "read uncommitted", "invalid", null]) {
    const f = fixture([report({ 12: isolation })]);
    await denied(() => f.port.read(request), "storage_result_invalid");
    equal(f.calls.length, 1);
  }
  for (const isolation of ["repeatable read", "serializable"]) {
    const f = fixture([report({ 12: isolation })]);
    equal((await f.port.read(request))[0].isCurrent, true);
    equal(f.calls.length, 2);
  }
  const empty = fixture([]);
  equal(await empty.port.read(request), []);
  equal(empty.calls.length, 1);
  const inactive = fixture([report({ 6: null, 7: null, 9: null, 10: null, 11: null, 12: null })], {
    policy: null,
  });
  equal((await inactive.port.read(request))[0].isCurrent, null);
  equal(inactive.calls.length, 1);
});
Deno.test("policy expiration fails closed and stale or unauthorized scopes are unknown", async () => {
  const expired = fixture([report()], { now: EXPIRY });
  await denied(() => expired.port.read(request), "score_input_policy_unavailable");
  equal(expired.calls.length, 0);
  for (
    const changes of [
      { 9: "SYNTHETIC-old-scope" },
      { 10: "SYNTHETIC-unapproved-exam" },
      { 10: ALIAS },
      { 11: ALIAS },
      {
        6: "mock",
      },
      { 3: null },
    ]
  ) {
    const f = fixture([report(changes)]);
    const rows = await f.port.read({ ...request, examId: changes[3] === null ? null : EXAM });
    equal(rows[0].isCurrent, null);
    equal(f.calls.length, 1);
  }
});
Deno.test("missing, duplicate or malformed batched guard results fail closed", async () => {
  for (
    const guards of [
      () => [],
      (scopes: ScopeRequest[]) => [[scopes[0].input_scope, scopes[0].stage, "true", true]],
      (scopes: ScopeRequest[]) => [["SYNTHETIC-other-scope", scopes[0].stage, true, true]],
    ]
  ) {
    const f = fixture([report()], { guards });
    await denied(() => f.port.read(request), "storage_result_invalid");
  }
  const duplicated = fixture([report(), report({ 0: "SYNTHETIC-final", 6: "final" })], {
    guards: (scopes) => [
      [scopes[0].input_scope, scopes[0].stage, true, true],
      [scopes[0].input_scope, scopes[0].stage, true, true],
    ],
  });
  await denied(() => duplicated.port.read(request), "storage_result_invalid");
});
Deno.test("an oversize complete alias set stays unknown without a truncated guard", async () => {
  const value = policy();
  const aliasHeavy = Object.create(value) as ApprovedOperatingPolicy;
  Object.defineProperty(aliasHeavy, "scopeExams", {
    value: () => Array.from({ length: 257 }, (_, i) => `SYNTHETIC-${i}`),
  });
  const f = fixture([report()], { policy: aliasHeavy });
  const rows = await f.port.read(request);
  equal(rows[0].isCurrent, null);
  equal(f.calls.length, 1);
});
