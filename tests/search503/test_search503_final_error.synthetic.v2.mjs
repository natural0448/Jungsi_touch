/** REVIEW ONLY: fake sessions, errors and store; no DB, network or actual request data. */
import assert from "node:assert/strict";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { SharedRequestBudget } from "../../supabase/functions/_shared/jungsi/application/usage_service.ts";
import { safeFailure } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { SearchDiagnostic } from "../../supabase/functions/_shared/search_failure_diagnostic.ts";
import { SearchFailureCorrelation as Candidate } from "../../supabase/functions/_shared/jungsi/infrastructure/search503_correlation.ts";

const ID = "a".repeat(32), OTHER_ID = "b".repeat(32);
const OWNER = "00000000-0000-0000-0000-000000000001";
const NOW = 1700000000000000n;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const event = Object.freeze({
  event: "current_public_search_failure_v1",
  operation: "offerings.search",
  phase: "catalog_read",
  failure: "state_unapproved",
});

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await wait(5);
  }
  throw new Error("SYNTHETIC_EVENT_WAIT_TIMEOUT");
}
function makeResponse(body, id = ID, status = 503) {
  return Response.json(body, { status, headers: { "X-Request-ID": id } });
}
function envelope(code, id = ID) {
  return { status: "error", error: { code }, request_id: id };
}
function syntheticRequest() {
  return {
    operation: "offerings.search",
    session: {
      user: { subjectId: OWNER, expiresAtUtc: NOW + 10000000n },
      evaluatedAtUtc: NOW,
      tier: "paid",
      paidUntilUtc: NOW + 10000000n,
    },
    body: null,
    params: {},
    query: {},
    requestKey: null,
  };
}
function syntheticPlan() {
  const d = { scope: "GLOBAL", periodSeconds: 60n, capacity: 10n, ceiling: 20n, units: 1n };
  return {
    status: "approved",
    policyVersion: "synthetic-policy",
    approvalReferenceSha256: "a".repeat(64),
    owner: OWNER,
    operation: "offerings.search",
    memberTier: "paid",
    examId: null,
    normalizedScoresSha256: null,
    calculationContextSha256: null,
    computation: "required",
    demands: [
      { ...d, kind: "request_window" },
      { ...d, kind: "concurrent_jobs", periodSeconds: 1n },
      { ...d, kind: "result_volume", capacity: 1000n, ceiling: 2000n },
    ],
  };
}
/** Actual SharedRequestBudget and SearchDiagnostic, with synthetic ports and envelope. */
async function budgetCase(Correlation, failSettlement, catalogCode) {
  const seen = [], outcomes = [];
  const correlation = new Correlation((value) => seen.push(value));
  const trace = new SearchDiagnostic(correlation.capture);
  const budget = new SharedRequestBudget(
    { prepare: () => Promise.resolve(syntheticPlan()) },
    {
      reserve: (request) =>
        Promise.resolve({
          allowed: true,
          lease: {
            id: "00000000-0000-0000-0000-000000000002",
            owner: request.owner,
            policyVersion: request.policyVersion,
            createdAtUtc: NOW,
            expiresAtUtc: NOW + 10000000n,
          },
        }),
      settle: (_lease, outcome) => {
        outcomes.push(outcome);
        return failSettlement
          ? Promise.reject(new Error("SYNTHETIC_PRIVATE_STORE_FAILURE"))
          : Promise.resolve();
      },
    },
    { nowUtc: () => NOW },
    { exists: () => Promise.resolve(false) },
  );
  let finalError;
  try {
    await budget.run(
      syntheticRequest(),
      () =>
        trace.operation(
          "offerings.search",
          () =>
            trace.capture("catalog_read", () => Promise.reject(new AccessError(catalogCode, 503))),
        ),
    );
    throw new Error("SYNTHETIC_EXPECTED_FAILURE");
  } catch (error) {
    finalError = error;
  }
  assert.ok(finalError instanceof AccessError);
  assert.deepEqual(outcomes, ["failure"]);
  const response = safeFailure(finalError, ID);
  const bytesBefore = await response.clone().text();
  correlation.finish(response);
  await until(() => seen.length === 1);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("X-Request-ID"), ID);
  assert.equal(await response.text(), bytesBefore);
  return { seen, body: JSON.parse(bytesBefore) };
}

Deno.test("real shared budget masks prior catalog failure when failure settlement fails", async () => {
  const candidate = await budgetCase(Candidate, true, "current_catalog_state_unapproved");
  assert.equal(candidate.body.error.code, "security_policy_unavailable");
  assert.equal(candidate.seen[0].failure, "state_unapproved");
  assert.equal(candidate.seen[0].event, "current_public_search_failure_v2");
  assert.equal(candidate.seen[0].final_error_class, "security_policy_unavailable");
  assert.deepEqual(Object.keys(candidate.seen[0]).sort(), [
    "event",
    "failure",
    "final_error_class",
    "operation",
    "phase",
    "request_id",
  ]);
});
Deno.test("successful failure settlement preserves an allowlisted original error", async () => {
  const result = await budgetCase(Candidate, false, "operation_scope_not_approved");
  assert.equal(result.body.error.code, "operation_scope_not_approved");
  assert.equal(result.seen[0].failure, "operation_scope_unapproved");
  assert.equal(result.seen[0].final_error_class, "operation_scope_not_approved");
});
Deno.test("masking an unsupported internal code remains distinguishable from error identity", async () => {
  const result = await budgetCase(Candidate, false, "current_catalog_state_unapproved");
  assert.equal(result.body.error.code, "backend_dependency_unavailable");
  assert.equal(result.seen[0].failure, "state_unapproved");
  assert.equal(result.seen[0].final_error_class, "backend_dependency_unavailable");
});
Deno.test("other public codes and response fields never appear in fixed output", async () => {
  const seen = [], c = new Candidate((x) => seen.push(x));
  const r = makeResponse({ ...envelope("synthetic_private_marker"), extra: "synthetic_secret" });
  const original = await r.clone().text();
  c.capture(event);
  c.finish(r);
  await until(() => seen.length === 1);
  assert.equal(seen[0].final_error_class, "other");
  const emitted = JSON.stringify(seen[0]);
  assert.equal(emitted.includes("synthetic_private_marker"), false);
  assert.equal(emitted.includes("synthetic_secret"), false);
  assert.equal(await r.text(), original);
});
Deno.test("missing or invalid final error, mismatched ID and 403 produce no event", async () => {
  const responses = [
    makeResponse({ status: "error", request_id: ID }),
    makeResponse(envelope("synthetic.secret")),
    makeResponse(envelope("security_policy_unavailable", OTHER_ID)),
    makeResponse(envelope("service_ended"), ID, 403),
  ];
  const seen = [];
  for (const response of responses) {
    const c = new Candidate((x) => seen.push(x));
    c.capture(event);
    c.finish(response);
    assert.ok((await response.text()).length > 0);
  }
  await wait(30);
  assert.deepEqual(seen, []);
});
Deno.test("250ms diagnostic clone timeout loses event without altering original response", async () => {
  let controller;
  const body = JSON.stringify(envelope("security_policy_unavailable"));
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      c.enqueue(new TextEncoder().encode(body.slice(0, 1)));
    },
  });
  const response = new Response(stream, { status: 503, headers: { "X-Request-ID": ID } });
  const seen = [], c = new Candidate((x) => seen.push(x));
  c.capture(event);
  c.finish(response);
  await wait(320);
  controller.enqueue(new TextEncoder().encode(body.slice(1)));
  controller.close();
  assert.equal(await response.text(), body);
  await wait(20);
  assert.deepEqual(seen, []);
});
Deno.test("concurrent requests keep final classification and request IDs isolated", async () => {
  const seen = [];
  const a = new Candidate((x) => seen.push(x)), b = new Candidate((x) => seen.push(x));
  a.capture(event);
  b.capture({ ...event, failure: "transport_unavailable" });
  a.finish(makeResponse(envelope("security_policy_unavailable")));
  b.finish(makeResponse(envelope("backend_dependency_unavailable", OTHER_ID), OTHER_ID));
  await until(() => seen.length === 2);
  assert.equal(
    seen.find((x) => x.request_id === ID).final_error_class,
    "security_policy_unavailable",
  );
  assert.equal(
    seen.find((x) => x.request_id === OTHER_ID).final_error_class,
    "backend_dependency_unavailable",
  );
  assert.equal(seen.find((x) => x.request_id === OTHER_ID).failure, "transport_unavailable");
});
Deno.test("throwing or pending sink cannot change the synthetic response", async () => {
  for (
    const sink of [
      () => {
        throw new Error("SYNTHETIC_PRIVATE_SINK");
      },
      () => Promise.reject(new Error("SYNTHETIC_PRIVATE_SINK")),
      () => new Promise(() => {}),
    ]
  ) {
    const response = makeResponse(envelope("security_policy_unavailable"));
    const before = await response.clone().text();
    const c = new Candidate(sink);
    c.capture(event);
    assert.equal(c.finish(response), undefined);
    assert.equal(await response.text(), before);
    await wait(10);
  }
});
