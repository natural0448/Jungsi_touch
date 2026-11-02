/** Synthetic error boundary, HTTP admission and observation checks; no runtime I/O. */
import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import {
  RelayBoundary,
  safeFailure,
} from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import {
  observeRuntimeResponse,
  type SafeRuntimeObservation,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import { assert, equal, syncPromise } from "./fixture.ts";
import { syntheticApiPolicies } from "./synthetic_api_contract.ts";

const CODE = "overall_model_refresh_pending";
const RELAY = "SYNTHETIC-RELAY-ONLY-" + "x".repeat(32);
const SUBJECT = "00000000-0000-0000-0000-000000000001";
const NOW = 1700000000000000n;
const PATH = "/api/v1/overall-reports";
const PAYLOAD = JSON.stringify({
  profile_id: "SYNTHETIC-profile",
  report_id: "SYNTHETIC-report",
  expected_version: 1,
});

function fixture(options: { authenticated?: boolean; paid?: boolean; failBudget?: boolean } = {}) {
  const calls = { auth: 0, passes: 0, budget: 0, business: 0 };
  const executions: ApiExecution[] = [];
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(RELAY),
    clock: { nowUtc: () => NOW },
    sessions: {
      verifyUserBearer: (token) =>
        syncPromise(() => {
          calls.auth++;
          equal(token, "SYNTHETIC-user-token");
          return options.authenticated === false ? null : {
            subjectId: SUBJECT,
            expiresAtUtc: NOW + 1000000n,
            assuranceLevel: "aal2",
            accountStatus: "active",
          };
        }),
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) =>
        syncPromise(() => {
          calls.passes++;
          return {
            authority: "public.jeongsi_passes",
            metadataVerified: true,
            subjectId,
            evaluatedAtUtc,
            paidUntilUtc: options.paid === false ? null : NOW + 500000n,
          };
        }),
    },
    reports: { lookupAccess: () => Promise.reject(new Error("unexpected report lookup")) },
    authorities: { readCurrent: () => Promise.reject(new Error("unexpected authority lookup")) },
    resources: { readScope: () => Promise.reject(new Error("unexpected resource lookup")) },
    projection: new PublicResponseProjection(schemas, schemas.operations),
    budget: {
      async run(_request, work) {
        calls.budget++;
        if (options.failBudget) throw new AccessError("security_policy_unavailable", 503);
        return await work();
      },
    },
    business: {
      execute: (request) =>
        syncPromise(() => {
          calls.business++;
          executions.push(request);
          throw new AccessError(CODE, 503);
        }),
    },
  };
  return { handler: createApiHandler(syntheticApiPolicies(), ports), calls, executions };
}

function request(extra: Record<string, string> = {}) {
  return new Request("https://synthetic.invalid" + PATH, {
    method: "POST",
    headers: {
      Authorization: "Bearer SYNTHETIC-user-token",
      "X-Jungsi-Relay-Token": RELAY,
      "Idempotency-Key": "SYNTHETIC-refresh-key",
      ...extra,
    },
    body: PAYLOAD,
  });
}

async function safeError(response: Response, status: number, code: string) {
  equal(response.status, status);
  equal(response.headers.get("Cache-Control"), "no-store");
  equal((await response.json()).error.code, code);
}

Deno.test("overall refresh pending is public only with 503 and remains a closed no-store error", async () => {
  const requestId = "a".repeat(32), response = safeFailure(new AccessError(CODE, 503), requestId);
  equal(response.status, 503);
  equal(response.headers.get("Cache-Control"), "no-store");
  equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  equal(response.headers.get("X-Request-ID"), requestId);
  equal(response.headers.get("Retry-After"), null);
  const body = await response.json();
  equal(body, { status: "error", error: { code: CODE }, request_id: requestId });
  equal(new PublicResponseProjection(schemas, schemas.operations).auxiliary("error", body), body);

  for (const status of [400, 401, 403, 404, 405, 409, 413, 422, 429, 500]) {
    await safeError(
      safeFailure(new AccessError(CODE, status), requestId),
      503,
      "backend_dependency_unavailable",
    );
  }
  await safeError(
    safeFailure({ code: CODE, http: 503 }, requestId),
    503,
    "backend_dependency_unavailable",
  );
  await safeError(
    safeFailure(new AccessError("SYNTHETIC-PRIVATE-DETAIL", 503), requestId),
    503,
    "backend_dependency_unavailable",
  );
});

Deno.test("HTTP pending overall refresh preserves relay, membership and shared budget boundaries", async () => {
  const f = fixture(), response = await f.handler(request());
  equal(response.status, 503);
  equal(response.headers.get("Cache-Control"), "no-store");
  equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  const requestId = response.headers.get("X-Request-ID");
  assert(requestId !== null && /^[a-f0-9]{32}$/.test(requestId));
  equal(await response.json(), { status: "error", error: { code: CODE }, request_id: requestId });
  equal([f.calls.auth, f.calls.passes, f.calls.budget, f.calls.business], [1, 1, 1, 1]);
  equal(f.executions[0].requestKey, "SYNTHETIC-refresh-key");

  const relay = fixture();
  await safeError(
    await relay.handler(request({ "X-Jungsi-Relay-Token": "wrong" })),
    403,
    "relay_authentication_failed",
  );
  equal([relay.calls.auth, relay.calls.budget, relay.calls.business], [0, 0, 0]);

  const unauthenticated = fixture({ authenticated: false });
  await safeError(await unauthenticated.handler(request()), 401, "authentication_required");
  equal([unauthenticated.calls.budget, unauthenticated.calls.business], [0, 0]);

  const standard = fixture({ paid: false });
  await safeError(await standard.handler(request()), 403, "paid_required");
  equal([standard.calls.budget, standard.calls.business], [0, 0]);

  const budget = fixture({ failBudget: true });
  await safeError(await budget.handler(request()), 503, "security_policy_unavailable");
  equal([budget.calls.budget, budget.calls.business], [1, 0]);
});

Deno.test("runtime observation retains pending refresh code only for 503", async () => {
  for (const status of [503, 403]) {
    const events: SafeRuntimeObservation[] = [];
    const response = Response.json({
      error: { code: CODE },
      private_detail: "SYNTHETIC-secret",
    }, { status, headers: { "X-Request-ID": "5".repeat(32) } });
    const returned = await observeRuntimeResponse(
      (event) => {
        events.push(event);
      },
      response,
      "overall.analyze",
      "business",
      "6".repeat(32),
    );
    assert(returned === response);
    assert(!response.bodyUsed);
    equal(events.length, 1);
    equal(events[0].code, status === 503 ? CODE : "backend_dependency_unavailable");
    assert(!JSON.stringify(events).includes("private_detail"));
    assert(!JSON.stringify(events).includes("SYNTHETIC"));
  }
});
