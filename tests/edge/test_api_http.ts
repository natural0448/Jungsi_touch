import { syncPromise } from "./fixture.ts";
/** HTTP routing/security with explicit fake business and budget ports, not 22 business acceptance. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  BUDGET_OPERATIONS,
  RequestLimitError,
} from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { createSupabaseApiIngress } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_api_ingress.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { assert, equal } from "./fixture.ts";
import { syntheticApiPolicies } from "./synthetic_api_contract.ts";
Deno.test("Supabase function prefix reaches the existing authenticated API without bypassing relay", async () => {
  const f = fixture();
  const ingress = createSupabaseApiIngress(f.handler);
  equal((await ingress(request("/jungsi-api/api/v1/me"))).status, 200);
  const missingRelay = request("/jungsi-api/api/v1/me");
  missingRelay.headers.delete("X-Jungsi-Relay-Token");
  const response = await ingress(missingRelay);
  equal(response.status, 403);
});
Deno.test("HTTP declared forecast business errors retain safe status while unknown typed codes stay closed", async () => {
  for (
    const [code, status] of [
      ["forecast_independent_approver_required", 403],
      ["forecast_validation_stale", 409],
      ["forecast_policy_invalid", 422],
      ["forecast_release_invalid", 503],
    ] as const
  ) {
    const f = fixture({ staff: true, aal: "aal2" });
    f.businessFailure(new AccessError(code, status));
    await error(
      await f.handler(
        request("/api/v1/forecast-drafts/SYNTHETIC-id/approvals", "POST", "{}"),
      ),
      code,
      status,
    );
  }
  const f = fixture({ staff: true, aal: "aal2" });
  f.businessFailure(new AccessError("forecast_not_a_declared_code", 403));
  await error(
    await f.handler(
      request("/api/v1/forecast-drafts/SYNTHETIC-id/approvals", "POST", "{}"),
    ),
    "backend_dependency_unavailable",
    503,
  );
});
Deno.test("every HTTP write rejects extra query after authorization and before any budget cache hit", async () => {
  for (const p of syntheticApiPolicies().filter((p) => p.method !== "GET")) {
    const f = fixture({
      staff: true,
      aal: "aal2",
      admin: p.id === "score-input.correction.grant",
    });
    f.ports.budget.run = <
      T,
    >() =>
      syncPromise(
        () => ({
          operation: p.id,
          items: [{ shown: "SYNTHETIC-cache" }],
        } as unknown as T),
      );
    const path = p.path.replace(/\{[^}]+\}/g, "SYNTHETIC-id") +
      "?unexpected=SYNTHETIC";
    await error(
      await f.handler(request(path, p.method, "{}")),
      "invalid_request",
      422,
    );
    equal(f.calls.business, 0);
    equal(f.calls.budget, 0);
    assert(f.calls.auth > 0);
  }
});
const OWNER = "00000000-0000-0000-0000-000000000001", NOW = 1700000000000000n;
const RELAY = "SYNTHETIC-RELAY-ONLY-" + "x".repeat(32),
  PRIVATE = "SYNTHETIC-PRIVATE-DO-NOT-EXPOSE";
function projection() {
  const text = { type: "string", nullable: false };
  const leaf = {
    type: "object",
    nullable: false,
    properties: { shown: text },
    required: ["shown"],
    optional: [],
  };
  const result = {
    type: "object",
    nullable: false,
    properties: {
      operation: text,
      items: {
        type: "array",
        nullable: false,
        items: { ref: "leaf", nullable: false },
      },
    },
    required: ["operation", "items"],
    optional: [],
  };
  const paid = {
    ...result,
    properties: { ...result.properties, premium: text },
    optional: ["premium"],
  };
  const session = {
    type: "object",
    nullable: false,
    properties: {
      format: text,
      member_tier: text,
      entitlement_expires_at: { type: "string", nullable: true },
    },
    required: ["format", "member_tier", "entitlement_expires_at"],
    optional: [],
  };
  const expected = syntheticApiPolicies().map((p) => ({
    id: p.id,
    contract_ref: "SYNTHETIC",
  }));
  const root = (name: string) => ({ ref: name, nullable: false });
  return new PublicResponseProjection({
    format: "jungsi.public-response-schemas/v1",
    schemas: { leaf, result, paid, session },
    operations: expected.map((p) => ({
      ...p,
      roots: {
        standard: root(p.id === "session.read" ? "session" : "result"),
        paid: root(p.id === "session.read" ? "session" : "paid"),
      },
    })),
    auxiliary_roots: { error: root("result"), readiness: root("result") },
  }, expected);
}
function fixture(
  options: {
    paid?: boolean;
    authenticated?: boolean;
    confirmed?: boolean;
    own?: boolean;
    aal?: "aal1" | "aal2";
    staff?: boolean;
    admin?: boolean;
  } = {},
) {
  const calls = {
    auth: 0,
    passes: 0,
    owner: 0,
    authority: 0,
    scope: 0,
    budget: 0,
    business: 0,
  };
  const executions: ApiExecution[] = [], events: string[] = [];
  let clock = NOW;
  let budgetFailure: unknown = null,
    businessFailure: unknown = null,
    expire = false;
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(RELAY),
    clock: { nowUtc: () => clock },
    sessions: {
      verifyUserBearer(token) {
        return syncPromise(() => {
          calls.auth++;
          equal(token, "SYNTHETIC-user-token");
          return options.authenticated === false ? null : {
            subjectId: OWNER,
            expiresAtUtc: NOW + 1000000n,
            assuranceLevel: options.aal ?? "aal2",
            accountStatus: "active",
            ...(options.admin ? { accountRole: "admin" } : {}),
          };
        });
      },
    },
    passes: {
      readCurrent(subjectId, evaluatedAtUtc) {
        return syncPromise(() => {
          calls.passes++;
          return {
            authority: "public.jeongsi_passes",
            metadataVerified: true,
            subjectId,
            evaluatedAtUtc,
            paidUntilUtc: options.paid === false ? null : NOW + 500000n,
          };
        });
      },
    },
    reports: {
      lookupAccess(owner) {
        return syncPromise(() => {
          calls.owner++;
          equal(owner, OWNER);
          return options.own === false
            ? null
            : { ownerId: OWNER, confirmed: options.confirmed !== false };
        });
      },
    },
    authorities: {
      readCurrent(subjectId, evaluatedAtUtc) {
        return syncPromise(() => {
          calls.authority++;
          const staff = options.staff !== false,
            ids = staff ? ["SYNTHETIC-university"] : [];
          return {
            authority: "jungsi_backend.forecast_authorities",
            subjectId,
            evaluatedAtUtc,
            edit: staff,
            approve: staff,
            universityIds: ids,
            editUniversityIds: ids,
            approveUniversityIds: ids,
          };
        });
      },
    },
    resources: {
      readScope(kind, id, subject) {
        return syncPromise(() => {
          calls.scope++;
          equal(subject, OWNER);
          return { kind, id, universityId: "SYNTHETIC-university" };
        });
      },
    },
    projection: projection(),
    budget: {
      async run(r, work) {
        calls.budget++;
        equal(r.session.user.subjectId, OWNER);
        events.push("budget-before");
        if (budgetFailure) throw budgetFailure;
        const value = await work();
        events.push("budget-after");
        return value;
      },
    },
    business: {
      execute(r) {
        return syncPromise(() => {
          calls.business++;
          executions.push(r);
          events.push("business");
          if (businessFailure) throw businessFailure;
          if (expire) clock = NOW + 2000000n;
          return {
            operation: r.operation,
            items: [{ shown: "SYNTHETIC-visible", curve: PRIVATE }],
            premium: "SYNTHETIC-paid",
            private_object: { credential: PRIVATE },
          };
        });
      },
    },
  };
  return {
    ports,
    calls,
    executions,
    events,
    handler: createApiHandler(syntheticApiPolicies(), ports),
    budgetFailure: (v: unknown) => budgetFailure = v,
    businessFailure: (v: unknown) => businessFailure = v,
    expire: () => expire = true,
  };
}
function request(
  path: string,
  method = "GET",
  body: BodyInit | null = null,
  extra: Record<string, string> = {},
) {
  return new Request("https://synthetic.invalid" + path, {
    method,
    headers: {
      Authorization: "Bearer SYNTHETIC-user-token",
      "X-Jungsi-Relay-Token": RELAY,
      ...extra,
    },
    body,
  });
}
async function error(response: Response, code: string, status: number) {
  equal(response.status, status);
  const data = await response.json();
  equal(data.error.code, code);
  assert(!JSON.stringify(data).includes(PRIVATE));
  equal(response.headers.get("Cache-Control"), "no-store");
}
for (const policy of syntheticApiPolicies()) {
  Deno.test("HTTP transport dispatch and closed DTO " + policy.id, async () => {
    const f = fixture({ admin: policy.id === "score-input.correction.grant" }),
      path = policy.path.replace(/\{[a-z_]+\}/g, "SYNTHETIC-id"),
      r = await f.handler(
        request(path, policy.method, policy.method === "GET" ? null : "{}", {
          "Idempotency-Key": "SYNTHETIC-key",
        }),
      );
    equal(
      r.status,
      ["score-profile.create", "overall.analyze"].includes(policy.id) ? 201 : 200,
    );
    const text = await r.text();
    assert(!text.includes(PRIVATE));
    const data = JSON.parse(text);
    if (policy.id === "session.read") {
      equal(Object.keys(data).sort(), [
        "entitlement_expires_at",
        "format",
        "member_tier",
      ]);
      equal(f.calls.business, 0);
    } else {
      equal(data.operation, policy.id);
      equal(data.items, [{ shown: "SYNTHETIC-visible" }]);
      equal(f.executions[0].requestKey, "SYNTHETIC-key");
    }
    equal(
      f.calls.budget,
      BUDGET_OPERATIONS.includes(policy.id as typeof BUDGET_OPERATIONS[number]) ? 1 : 0,
    );
    if (f.calls.budget) {
      equal(f.events, ["budget-before", "business", "budget-after"]);
    }
    equal(f.calls.auth, 1);
    equal(f.calls.passes, 1);
    assert(r.headers.get("Cache-Control")!.includes("no-store"));
  });
}
Deno.test("HTTP static search route wins over offering parameter", async () => {
  const f = fixture();
  const r = await f.handler(request("/api/v1/offerings/search"));
  equal(r.status, 200);
  equal(f.executions[0].operation, "offerings.search");
  equal(f.executions[0].params, {});
});
Deno.test("HTTP relay authentication precedes user body query and work", async () => {
  const f = fixture(),
    req = request("/api/v1/overall-reports?x=1&x=2", "POST", "invalid", {
      "X-Jungsi-Relay-Token": "wrong",
    });
  await error(await f.handler(req), "relay_authentication_failed", 403);
  equal(req.bodyUsed, false);
  equal(f.calls.auth, 0);
  equal(f.calls.budget, 0);
  equal(f.calls.business, 0);
});
Deno.test("HTTP provider rejection becomes public 401 before passes and malformed input", async () => {
  const f = fixture({ authenticated: false }),
    req = request("/api/v1/overall-reports?x=1&x=2", "POST", "invalid");
  await error(await f.handler(req), "authentication_required", 401);
  equal(req.bodyUsed, false);
  equal(f.calls.passes, 0);
  equal(f.calls.budget, 0);
});
Deno.test("HTTP free user paid guard runs before body and report lookup", async () => {
  const f = fixture({ paid: false }),
    req = request("/api/v1/reports/SYNTHETIC-id/candidates", "POST", "invalid");
  await error(await f.handler(req), "paid_required", 403);
  equal(req.bodyUsed, false);
  equal(f.calls.owner, 0);
  equal(f.calls.budget, 0);
});
Deno.test("HTTP other owner and missing confirmation reject before body replay and work", async () => {
  for (
    const [options, code, status] of [
      [{ own: false }, "report_not_found", 404],
      [{ confirmed: false }, "score_confirmation_required", 409],
    ] as const
  ) {
    const f = fixture(options),
      req = request(
        "/api/v1/reports/SYNTHETIC-id/candidates",
        "POST",
        "invalid",
      );
    await error(await f.handler(req), code, status);
    equal(req.bodyUsed, false);
    equal(f.calls.budget, 0);
    equal(f.calls.business, 0);
  }
});
Deno.test("HTTP management MFA rejects before resource body or business work", async () => {
  const f = fixture({ aal: "aal1" }),
    req = request(
      "/api/v1/forecast-drafts/SYNTHETIC-id/adjustments",
      "POST",
      "invalid",
    );
  await error(await f.handler(req), "management_mfa_required", 403);
  equal(req.bodyUsed, false);
  equal(f.calls.scope, 0);
  equal(f.calls.business, 0);
});
Deno.test("HTTP duplicate query invalid UTF8 JSON and duplicate keys return existing 422 envelope", async () => {
  const f = fixture();
  await error(
    await f.handler(request("/api/v1/offerings/search?group=a&group=b")),
    "duplicate_query_field",
    422,
  );
  for (
    const data of ["not-json", '{"a":2,"a":2.0}', new Uint8Array([255, 254])]
  ) {
    await error(
      await f.handler(request("/api/v1/overall-reports", "POST", data)),
      "invalid_json",
      422,
    );
  }
  equal(f.calls.business, 0);
  equal(f.calls.budget, 0);
});
Deno.test("HTTP native input keeps decimal and integer distinct for business validation", async () => {
  const f = fixture();
  equal(
    (await f.handler(
      request("/api/v1/overall-reports", "POST", '{"i":2,"f":2.0,"a":[[]]}'),
    )).status,
    201,
  );
  const b = f.executions[0].body as Record<string, unknown>;
  equal(b.i, 2);
  assert(b.f instanceof JsonFloat);
  equal(b.f.lexeme, "2.0");
  equal(b.a, [[]]);
});
Deno.test("HTTP input body limit counts actual UTF8 bytes and refuses false declared sizes", async () => {
  const f = fixture();
  await error(
    await f.handler(
      request(
        "/api/v1/overall-reports",
        "POST",
        JSON.stringify("가".repeat(70000)),
      ),
    ),
    "request_too_large",
    413,
  );
  await error(
    await f.handler(
      request("/api/v1/overall-reports", "POST", "{}", {
        "Content-Length": "200001",
      }),
    ),
    "request_too_large",
    413,
  );
  equal(f.calls.business, 0);
  equal(f.calls.budget, 0);
});
Deno.test("HTTP normal result projection removes paid fields for standard own report", async () => {
  const f = fixture({ paid: false }),
    r = await f.handler(request("/api/v1/reports/SYNTHETIC-id"));
  equal(r.status, 200);
  assert(!Object.hasOwn(await r.json(), "premium"));
});
Deno.test("HTTP missing shared policy fails closed before business execution", async () => {
  const f = fixture();
  f.budgetFailure(new AccessError("security_policy_unavailable", 503));
  await error(
    await f.handler(request("/api/v1/overall-reports", "POST", "{}")),
    "security_policy_unavailable",
    503,
  );
  equal(f.calls.business, 0);
});
Deno.test("HTTP quota 429 has safe envelope Retry-After and no private limit details", async () => {
  const f = fixture();
  f.budgetFailure(new RequestLimitError("analysis_quota_exceeded", 7));
  const r = await f.handler(request("/api/v1/overall-reports", "POST", "{}"));
  equal(r.headers.get("Retry-After"), "7");
  await error(r, "analysis_quota_exceeded", 429);
  equal(f.calls.business, 0);
});
Deno.test("HTTP quota errors without a valid retry time remain closed as safe 503", async () => {
  const f = fixture();
  f.budgetFailure(new AccessError("rate_limit_exceeded", 429));
  await error(
    await f.handler(request("/api/v1/overall-reports", "POST", "{}")),
    "backend_dependency_unavailable",
    503,
  );
});
Deno.test("HTTP unapproved exception text is never public", async () => {
  const f = fixture();
  f.businessFailure(new Error(PRIVATE));
  await error(
    await f.handler(request("/api/v1/overall-reports", "POST", "{}")),
    "backend_dependency_unavailable",
    503,
  );
});
Deno.test("HTTP expiry at response time suppresses business DTO", async () => {
  const f = fixture();
  f.expire();
  await error(
    await f.handler(request("/api/v1/reports/SYNTHETIC-id")),
    "authentication_required",
    401,
  );
});
Deno.test("HTTP expiry during budget settlement cannot release a previously valid DTO", async () => {
  const f = fixture();
  f.ports.budget.run = async (_r, work) => {
    const result = await work();
    f.ports.clock.nowUtc = () => NOW + 2000000n;
    return result;
  };
  await error(
    await f.handler(request("/api/v1/reports/SYNTHETIC-id")),
    "authentication_required",
    401,
  );
});
Deno.test("HTTP budget cache results still pass final recursive public projection", async () => {
  const f = fixture();
  f.ports.budget.run = <
    T,
  >() =>
    syncPromise(() => ({
      operation: "report.read",
      items: [{ shown: "SYNTHETIC-cache", curve: PRIVATE }],
      private_object: { secret: PRIVATE },
    } as unknown as T));
  const r = await f.handler(request("/api/v1/reports/SYNTHETIC-id"));
  equal(r.status, 200);
  const text = await r.text();
  assert(!text.includes(PRIVATE));
  equal(JSON.parse(text), {
    operation: "report.read",
    items: [{ shown: "SYNTHETIC-cache" }],
  });
  equal(f.calls.business, 0);
});
Deno.test("HTTP method and unknown paths are safe and do not touch authentication", async () => {
  const f = fixture();
  await error(
    await f.handler(request("/api/v1/me", "POST", "{}")),
    "method_not_allowed",
    405,
  );
  await error(
    await f.handler(request("/api/v1/unknown")),
    "route_not_found",
    404,
  );
  equal(f.calls.auth, 0);
});
Deno.test("HTTP incomplete route inventory and absent budget cannot compose", () => {
  const f = fixture();
  let e: unknown;
  try {
    createApiHandler(syntheticApiPolicies().slice(1), f.ports);
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  e = null;
  try {
    createApiHandler(
      syntheticApiPolicies(),
      { ...f.ports, budget: null } as unknown as ApiHttpPorts,
    );
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
});
