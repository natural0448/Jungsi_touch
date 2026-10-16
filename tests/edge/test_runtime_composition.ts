/** Invented bearer, metadata and fetch responses. No network, real TLS, DB or deployment proof. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  NativeRuntimeApi,
  observeRuntimeResponse,
  type RuntimeComposition,
  type SafeRuntimeObservation,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SUBJECT_CONTEXT_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { assert, equal } from "./fixture.ts";
import { syntheticApiPolicies } from "./synthetic_api_contract.ts";
import {
  SYNTHETIC_RUNTIME_NOW,
  SYNTHETIC_RUNTIME_URL,
  syntheticRuntimeBinding,
} from "./synthetic_runtime_binding.ts";

const SUBJECT = "00000000-0000-4000-8000-000000000001";
const policies = syntheticApiPolicies().map((p) => ({ ...p, contract_ref: "SYNTHETIC" }));
function schemas() {
  const text = { type: "string", nullable: false };
  const empty = { type: "object", nullable: false, properties: {}, required: [], optional: [] };
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
  const root = (ref: string) => ({ ref, nullable: false });
  return {
    format: "jungsi.public-response-schemas/v1",
    schemas: { empty, session },
    operations: policies.map((p) => ({
      id: p.id,
      contract_ref: p.contract_ref,
      roots: {
        standard: root(p.id === "session.read" ? "session" : "empty"),
        paid: root(p.id === "session.read" ? "session" : "empty"),
      },
    })),
    auxiliary_roots: { error: root("empty"), readiness: root("empty") },
  };
}
function token(aal: "aal1" | "aal2", exp: bigint) {
  const claims = JSON.stringify({
    sub: SUBJECT,
    iss: SYNTHETIC_RUNTIME_URL + "/auth/v1",
    exp: Number(exp / 1000000n),
    aal,
    role: "admin",
  });
  const payload = btoa(claims).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "e30." + payload + ".SYNTHETIC";
}
function passRow(expiry: string | null): unknown[] {
  const values: unknown[] = [
    true,
    [
      ["id", "int8", "NO"],
      ["user_id", "uuid", "NO"],
      ["starts_at", "timestamptz", "NO"],
      ["ends_at", "timestamptz", "NO"],
      ["note", "text", "YES"],
      ["granted_by", "uuid", "YES"],
      ["revoked_at", "timestamptz", "YES"],
      ["revoked_by", "uuid", "YES"],
      ["created_at", "timestamptz", "NO"],
    ],
    [
      ["jeongsi_passes_period", "c", true, "CHECK (ends_at > starts_at)"],
      [
        "SYNTHETIC_fk",
        "f",
        true,
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE",
      ],
      ["SYNTHETIC_pk", "p", true, "PRIMARY KEY (id)"],
    ],
    [true, false, false, false, true, false, false],
    [
      [
        "jeongsi_passes: select own or admin",
        "r",
        true,
        ["public"],
        "auth.uid() = user_id OR public.is_admin()",
        null,
      ],
      [
        "jeongsi_passes: jungsi backend read",
        "r",
        true,
        ["jungsi_backend_app", "jungsi_backend_owner"],
        "true",
        null,
      ],
    ],
    expiry,
  ];
  for (const index of [1, 2, 3, 4]) values[index] = JSON.stringify(values[index]);
  return values;
}
async function fixture(subjectOnly = false, observe?: RuntimeComposition["observe"]) {
  const binding = await syntheticRuntimeBinding((d) => {
    if (subjectOnly) {
      (d.scope as Record<string, unknown>).operations = [
        "session.read",
        "score-profile.create",
        "overall.analyze",
        "report.read",
        "report.export",
      ];
    }
  });
  const state = {
    now: SYNTHETIC_RUNTIME_NOW,
    role: "admin",
    status: "active",
    profileStatus: 200,
    authStatus: 200,
    expiry: null as string | null,
    expireAfterPass: false,
    usageSchema: false,
    usageNative: undefined as unknown,
    badRole: false,
  };
  const calls = { auth: 0, profile: 0, pass: 0, storage: 0, pool: 0, closed: 0 };
  const statements: { sql: string; parameters: readonly unknown[]; readOnly: boolean }[] = [];
  let expectedToken = "";
  const pool: NativeSqlPool = {
    async transaction(readOnly, work) {
      return await work({
        query(sql, parameters = []) {
          statements.push({ sql, parameters, readOnly });
          if (sql === RUNTIME_ROLE_SQL) {
            return Promise.resolve([[
              state.badRole ? "postgres" : "jungsi_backend_app",
              false,
              false,
              "on",
              readOnly ? "on" : "off",
              false,
              false,
              false,
              "UTC",
            ]]);
          }
          if (sql.includes("WHERE version='005_usage_budget'")) {
            return Promise.resolve([[
              state.usageNative === undefined ? state.usageSchema : state.usageNative,
            ]]);
          }
          if (sql.startsWith("WITH runtime_guard AS MATERIALIZED")) {
            calls.pass++;
            const row = passRow(state.expiry);
            if (state.expireAfterPass) state.now += 10000000n;
            return Promise.resolve([row]);
          }
          if (sql.startsWith("SET LOCAL") || sql === SUBJECT_CONTEXT_SQL) {
            return Promise.resolve([]);
          }
          throw new Error("unexpected_synthetic_sql");
        },
      });
    },
    close() {
      calls.closed++;
      return Promise.resolve();
    },
  };
  const api = new NativeRuntimeApi({
    observe,
    environment: binding.env,
    policies,
    responseSchemas: schemas(),
    clock: { nowUtc: () => state.now },
    createPool: () => {
      calls.pool++;
      return pool;
    },
    fetcher: (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") {
        calls.auth++;
        equal(new Headers(init?.headers).get("Authorization"), "Bearer " + expectedToken);
        equal(
          new Headers(init?.headers).get("apikey"),
          binding.values.SUPABASE_PUBLISHABLE_KEY ?? binding.values.JUNGSI_DISPLAY_PUBLISHABLE_KEY,
        );
        return Promise.resolve(
          Response.json({ id: SUBJECT, user_metadata: { role: "admin" } }, {
            status: state.authStatus,
          }),
        );
      }
      if (url.pathname === "/rest/v1/profiles") {
        calls.profile++;
        equal(new Headers(init?.headers).get("Authorization"), "Bearer " + expectedToken);
        equal(url.searchParams.get("id"), "eq." + SUBJECT);
        equal(url.searchParams.get("select"), "role,status");
        return Promise.resolve(
          Response.json([{ role: state.role, status: state.status }], {
            status: state.profileStatus,
          }),
        );
      }
      calls.storage++;
      throw new Error("unexpected_synthetic_storage");
    },
  });
  function request(path = "/api/v1/me", aal: "aal1" | "aal2" = "aal2", relay = true) {
    expectedToken = token(aal, SYNTHETIC_RUNTIME_NOW + 60000000n);
    return new Request("https://synthetic.invalid" + path, {
      headers: {
        Authorization: "Bearer " + expectedToken,
        ...(relay ? { "X-Jungsi-Relay-Token": binding.values.JUNGSI_RELAY_TOKEN } : {}),
      },
    });
  }
  return { binding, state, calls, statements, pool, api, request };
}
async function error(response: Response, status: number, code?: string) {
  equal(response.status, status);
  const body = await response.json();
  if (code) equal(body.error.code, code);
  assert(!JSON.stringify(body).includes("postgresql:"));
  assert(!JSON.stringify(body).includes("SYNTHETIC"));
  equal(response.headers.get("Cache-Control"), "no-store");
}

Deno.test("runtime composition verifies the same bearer and own active admin aal2 for paid null", async () => {
  const f = await fixture();
  const response = await f.api.fetch(f.request());
  equal(response.status, 200);
  equal(await response.json(), {
    format: "jungsi.session/v1",
    member_tier: "paid",
    entitlement_expires_at: null,
  });
  equal(f.calls, { auth: 1, profile: 1, pass: 1, storage: 0, pool: 1, closed: 0 });
  assert(f.statements.every((q) => q.readOnly));
  await f.api.close();
  equal(f.calls.closed, 1);
});
Deno.test("runtime composition rereads own role and does not accept aal1 or a bearer role claim", async () => {
  const f = await fixture();
  equal((await (await f.api.fetch(f.request())).json()).member_tier, "paid");
  f.state.role = "student";
  equal((await (await f.api.fetch(f.request())).json()).member_tier, "standard");
  f.state.role = "admin";
  equal(
    (await (await f.api.fetch(f.request("/api/v1/me", "aal1"))).json()).member_tier,
    "standard",
  );
  f.state.status = "suspended";
  equal((await (await f.api.fetch(f.request())).json()).member_tier, "standard");
  equal(f.calls.auth, 4);
  equal(f.calls.profile, 4);
  equal(f.calls.pool, 1);
});
Deno.test("runtime composition preserves a real pass expiry even when own profile fails", async () => {
  const f = await fixture();
  f.state.expiry = "2026-10-15T00:00:30.000000Z";
  const first = await f.api.fetch(f.request());
  equal(first.status, 200);
  equal((await first.json()).entitlement_expires_at, "2026-10-15T00:00:30Z");
  f.state.profileStatus = 503;
  const second = await f.api.fetch(f.request());
  equal(second.status, 200);
  equal(await second.json(), {
    format: "jungsi.session/v1",
    member_tier: "paid",
    entitlement_expires_at: "2026-10-15T00:00:30Z",
  });
});
Deno.test("runtime composition does not replace a pass expiring during response with the admin exception", async () => {
  const f = await fixture();
  f.state.expiry = "2026-10-15T00:00:05.000000Z";
  f.state.expireAfterPass = true;
  await error(await f.api.fetch(f.request()), 503, "entitlement_unavailable");
});
Deno.test("runtime composition rejects relay before Auth and rejects Auth before pass SQL", async () => {
  const f = await fixture();
  await error(
    await f.api.fetch(f.request("/api/v1/me", "aal2", false)),
    403,
    "relay_authentication_failed",
  );
  equal(f.calls.auth, 0);
  equal(f.calls.pool, 0);
  f.state.authStatus = 401;
  await error(await f.api.fetch(f.request()), 401, "authentication_required");
  equal(f.calls.auth, 1);
  equal(f.calls.profile, 0);
  equal(f.calls.pass, 0);
  equal(f.calls.pool, 0);
});
Deno.test("runtime composition missing CA fails before pool creation or private data reads", async () => {
  const f = await fixture();
  f.binding.values.JUNGSI_DATABASE_CA = "";
  await error(await f.api.fetch(f.request()), 503);
  equal(f.calls.pool, 0);
  equal(f.calls.storage, 0);
});
Deno.test("runtime composition session needs no data binding while data routes fail closed without it", async () => {
  const f = await fixture();
  f.binding.values.JUNGSI_API_BINDING_JSON = "";
  equal((await f.api.fetch(f.request())).status, 200);
  await error(
    await f.api.fetch(f.request("/api/v1/admission-history")),
    503,
    "security_policy_unavailable",
  );
  equal(f.calls.storage, 0);
});
Deno.test("runtime composition liveness needs no settings and readiness requires relay and usage schema", async () => {
  const f = await fixture();
  const response = await f.api.fetch(new Request("https://synthetic.invalid/health/live"));
  equal(response.status, 200);
  equal((await response.json()).status, "alive");
  equal(f.calls.pool, 0);
  equal(f.calls.auth, 0);
  await error(
    await f.api.fetch(f.request("/health/ready", "aal2", false)),
    403,
    "relay_authentication_failed",
  );
  await error(await f.api.fetch(f.request("/health/ready")), 503, "security_policy_unavailable");
  equal(f.calls.auth, 0);
  equal(f.calls.pass, 0);
  equal(f.calls.storage, 0);
});
Deno.test("runtime usage schema probe is read only without user claims or migrations", async () => {
  const f = await fixture();
  const sql = new SupabaseSqlTransport(f.pool);
  equal(await sql.probeUsageSchema(), false);
  f.state.usageSchema = true;
  equal(await sql.probeUsageSchema(), true);
  assert(f.statements.every((q) => q.readOnly));
  assert(f.statements.every((q) => q.sql.startsWith("SET LOCAL") || q.sql.startsWith("SELECT")));
  assert(!f.statements.some((q) => q.sql === SUBJECT_CONTEXT_SQL));
});
Deno.test("runtime usage schema probe rejects a native string boolean and privileged runtime role", async () => {
  const f = await fixture();
  const sql = new SupabaseSqlTransport(f.pool);
  for (const value of ["true", 1, null]) {
    f.state.usageNative = value;
    let thrown: unknown;
    try {
      await sql.probeUsageSchema();
    } catch (e) {
      thrown = e;
    }
    assert(thrown instanceof AccessError);
    equal(thrown.code, "storage_result_invalid");
  }
  f.state.usageNative = true;
  f.state.badRole = true;
  let thrown: unknown;
  try {
    await sql.probeUsageSchema();
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof AccessError);
  equal(thrown.code, "storage_runtime_role_unverified");
});
Deno.test("runtime composition never leaks CA or DSN when native pool creation fails", async () => {
  const f = await fixture();
  const api = new NativeRuntimeApi({
    environment: f.binding.env,
    policies,
    responseSchemas: schemas(),
    clock: { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    createPool: () => {
      throw new Error(f.binding.values.DATABASE_URL + f.binding.values.JUNGSI_DATABASE_CA);
    },
    fetcher: (input) => {
      const url = new URL(String(input));
      return Promise.resolve(
        url.pathname === "/auth/v1/user"
          ? Response.json({ id: SUBJECT })
          : Response.json([{ role: "admin", status: "active" }]),
      );
    },
  });
  await error(await api.fetch(f.request()), 503);
  equal(utcText(SYNTHETIC_RUNTIME_NOW), "2026-10-15T00:00:00Z");
});

Deno.test("runtime composition accepts explicit existing display aliases with the same verified bearer", async () => {
  const f = await fixture();
  for (
    const [name, alias] of [
      ["DATABASE_URL", "JUNGSI_DISPLAY_DATABASE_URL"],
      ["JUNGSI_DATABASE_CA", "JUNGSI_DISPLAY_DATABASE_CA"],
      ["SUPABASE_PUBLISHABLE_KEY", "JUNGSI_DISPLAY_PUBLISHABLE_KEY"],
      ["SUPABASE_SECRET_KEY", "JUNGSI_DISPLAY_STORAGE_SECRET"],
    ]
  ) {
    f.binding.values[alias] = f.binding.values[name];
    Reflect.deleteProperty(f.binding.values, name);
  }
  const response = await f.api.fetch(f.request());
  equal(response.status, 200);
  equal(await response.json(), {
    format: "jungsi.session/v1",
    member_tier: "paid",
    entitlement_expires_at: null,
  });
  equal(f.calls.auth, 1);
  equal(f.calls.profile, 1);
  equal(f.calls.pass, 1);
  equal(f.calls.storage, 0);
});

Deno.test("runtime composition exposes only safe unselected scope errors after existing relay and paid checks", async () => {
  const f = await fixture(true);
  equal((await f.api.fetch(f.request())).status, 200);
  for (const path of ["/api/v1/admission-history", "/api/v1/offerings/search"]) {
    await error(await f.api.fetch(f.request(path)), 503, "operation_scope_not_approved");
  }
  equal(f.calls.storage, 0);
  assert(
    !f.statements.some((q) =>
      q.sql.includes("usage_budget") || q.sql.includes("admission_results")
    ),
  );
  await error(await f.api.fetch(f.request("/api/v1/offerings/search", "aal1")), 403);
  await error(
    await f.api.fetch(f.request("/api/v1/admission-history", "aal2", false)),
    403,
    "relay_authentication_failed",
  );
  equal(f.calls.storage, 0);
});

Deno.test("safe runtime observation logs only five fields and the actual response request id for relay refusal", async () => {
  const events: SafeRuntimeObservation[] = [],
    f = await fixture(false, (event) => {
      events.push(event);
    });
  const response = await f.api.fetch(f.request("/api/v1/me", "aal2", false));
  const body = await response.clone().json();
  equal(response.status, 403);
  equal(events.length, 1);
  equal(Object.keys(events[0]).sort(), ["code", "operation", "request_id", "stage", "status"]);
  equal(events[0].operation, "session.read");
  equal(events[0].stage, "relay");
  equal(events[0].status, 403);
  equal(events[0].code, "relay_authentication_failed");
  equal(events[0].request_id, body.request_id);
  equal(events[0].request_id, response.headers.get("X-Request-ID"));
  assert(Object.isFrozen(events[0]));
  const text = JSON.stringify(events[0]);
  assert(!text.includes(SUBJECT));
  assert(!text.includes("SYNTHETIC"));
  assert(!text.includes("Bearer"));
});
Deno.test("safe runtime observation identifies native Auth dependency stage without response or secret drift", async () => {
  const events: SafeRuntimeObservation[] = [],
    f = await fixture(false, (event) => {
      events.push(event);
    });
  f.state.authStatus = 503;
  const response = await f.api.fetch(f.request());
  const body = await response.json();
  equal(response.status, 503);
  equal(events.length, 1);
  equal(events[0].stage, "user_session");
  equal(events[0].status, response.status);
  equal(events[0].code, body.error.code);
  equal(response.headers.get("Cache-Control"), "no-store");
  equal(f.calls.pass, 0);
});
Deno.test("safe runtime observation cannot log path query headers or subject from unknown routes", async () => {
  const events: SafeRuntimeObservation[] = [],
    f = await fixture(false, (event) => {
      events.push(event);
    });
  const response = await f.api.fetch(
    f.request("/api/v1/PRIVATE-" + SUBJECT + "?query=SYNTHETIC-private"),
  );
  equal(response.status, 404);
  equal(events.length, 1);
  equal(events[0].operation, null);
  equal(events[0].stage, "route");
  const text = JSON.stringify(events[0]);
  assert(!text.includes(SUBJECT));
  assert(!text.includes("PRIVATE"));
  assert(!text.includes("query"));
});
Deno.test("safe runtime observation preserves existing scoped denial and identifies budget initialization", async () => {
  const events: SafeRuntimeObservation[] = [],
    f = await fixture(true, (event) => {
      events.push(event);
    });
  const response = await f.api.fetch(f.request("/api/v1/admission-history"));
  equal(response.status, 503);
  equal(events.length, 1);
  equal(events[0].operation, "history.search");
  equal(events[0].code, "operation_scope_not_approved");
  equal(events[0].stage, "budget_initialize");
  equal(f.calls.storage, 0);
});
Deno.test("synchronous and rejected-promise observation sinks cannot mask errors or rerun Auth or business", async () => {
  for (const asyncFailure of [false, true]) {
    let observed = 0;
    const f = await fixture(false, () => {
      observed++;
      if (asyncFailure) return Promise.reject(new Error("SYNTHETIC-secret"));
      throw new Error("SYNTHETIC-secret");
    });
    const response = await f.api.fetch(f.request("/api/v1/me", "aal2", false));
    await Promise.resolve();
    equal(response.status, 403);
    equal((await response.json()).error.code, "relay_authentication_failed");
    equal(observed, 1);
    equal(f.calls.auth, 0);
    equal(f.calls.pool, 0);
  }
});
Deno.test("ordinary successful GET does not emit observation data", async () => {
  const events: SafeRuntimeObservation[] = [],
    f = await fixture(false, (event) => {
      events.push(event);
    });
  equal((await f.api.fetch(f.request())).status, 200);
  equal(events.length, 0);
});
Deno.test("created observation never consumes successful private result body", async () => {
  const events: SafeRuntimeObservation[] = [];
  const response = Response.json({ private_score: "SYNTHETIC-private" }, {
    status: 201,
    headers: { "X-Request-ID": "1".repeat(32) },
  });
  const returned = await observeRuntimeResponse(
    (event) => {
      events.push(event);
    },
    response,
    "score-profile.create",
    "complete",
    "2".repeat(32),
  );
  assert(returned === response);
  assert(!response.bodyUsed);
  equal(events.length, 1);
  equal(events[0].status, 201);
  equal(events[0].code, null);
  equal(events[0].stage, "complete");
  assert(!JSON.stringify(events).includes("private_score"));
  assert(!JSON.stringify(events).includes("SYNTHETIC"));
});
Deno.test("observation canonicalizes unknown error codes and ignores extra response fields", async () => {
  const events: SafeRuntimeObservation[] = [];
  const response = Response.json({
    error: { code: "private_secret_code" },
    body: { subject: SUBJECT, key: "SYNTHETIC-secret" },
  }, { status: 503, headers: { "X-Request-ID": "SYNTHETIC-injected" } });
  await observeRuntimeResponse(
    (event) => {
      events.push(event);
    },
    response,
    "overall.analyze",
    "budget_plan",
    "3".repeat(32),
  );
  equal(events[0].code, "backend_dependency_unavailable");
  equal(events[0].request_id, "3".repeat(32));
  assert(!JSON.stringify(events).includes("private_secret"));
  assert(!JSON.stringify(events).includes(SUBJECT));
  assert(!JSON.stringify(events).includes("SYNTHETIC"));
});

Deno.test("safe observation preserves both public 429 codes without quota details", async () => {
  for (const code of ["rate_limit_exceeded", "analysis_quota_exceeded"]) {
    const events: SafeRuntimeObservation[] = [];
    const response = Response.json({ error: { code }, capacity: "SYNTHETIC-private" }, {
      status: 429,
    });
    await observeRuntimeResponse(
      (event) => {
        events.push(event);
      },
      response,
      "overall.analyze",
      "budget_reserve",
      "4".repeat(32),
    );
    equal(events[0].status, 429);
    equal(events[0].code, code);
    assert(!JSON.stringify(events).includes("capacity"));
  }
});
Deno.test("native pool exception observation excludes raw DSN CA stack and request headers", async () => {
  const f = await syntheticRuntimeBinding(), events: SafeRuntimeObservation[] = [];
  const api = new NativeRuntimeApi({
    environment: f.env,
    policies,
    responseSchemas: schemas(),
    observe: (event) => {
      events.push(event);
    },
    clock: { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    createPool: () => {
      throw new Error("postgresql://SYNTHETIC-password SYNTHETIC-CA");
    },
  });
  const response = await api.fetch(
    new Request("https://synthetic.invalid/health/ready", {
      headers: {
        "X-Jungsi-Relay-Token": f.values.JUNGSI_RELAY_TOKEN,
        "Idempotency-Key": "SYNTHETIC-key",
      },
    }),
  );
  equal(response.status, 503);
  equal(events.length, 1);
  equal(events[0].operation, "health.ready");
  equal(events[0].stage, "runtime_pool");
  equal(events[0].code, "backend_dependency_unavailable");
  const text = JSON.stringify(events);
  assert(!text.includes("SYNTHETIC"));
  assert(!text.includes("postgresql"));
  assert(!text.includes("stack"));
  await api.close();
});
Deno.test("concurrent observations keep each operation phase and response request id separate", async () => {
  const events: SafeRuntimeObservation[] = [],
    f = await fixture(false, (event) => {
      events.push(event);
    });
  const [relay, route] = await Promise.all([
    f.api.fetch(f.request("/api/v1/me", "aal2", false)),
    f.api.fetch(f.request("/api/v1/SYNTHETIC-unknown")),
  ]);
  equal(events.length, 2);
  const byId = new Map(events.map((event) => [event.request_id, event]));
  equal(byId.size, 2);
  equal(byId.get(relay.headers.get("X-Request-ID")!)!.stage, "relay");
  equal(byId.get(relay.headers.get("X-Request-ID")!)!.operation, "session.read");
  equal(byId.get(route.headers.get("X-Request-ID")!)!.stage, "route");
  equal(byId.get(route.headers.get("X-Request-ID")!)!.operation, null);
});

Deno.test("observation rejects unregistered operation stage and invalid fallback request id", async () => {
  const events: SafeRuntimeObservation[] = [];
  const response = Response.json({ error: { code: "authentication_required" } }, {
    status: 401,
    headers: { "X-Request-ID": "SYNTHETIC-private-header" },
  });
  await observeRuntimeResponse(
    (event) => {
      events.push(event);
    },
    response,
    "SYNTHETIC-private-operation" as never,
    "SYNTHETIC-private-stage" as never,
    "5".repeat(32),
  );
  equal(events.length, 1);
  equal(events[0].operation, null);
  equal(events[0].stage, "entry");
  equal(events[0].request_id, "5".repeat(32));
  assert(!JSON.stringify(events).includes("SYNTHETIC"));
  const returned = await observeRuntimeResponse(
    (event) => {
      events.push(event);
    },
    response,
    "overall.analyze",
    "budget_plan",
    "SYNTHETIC-private-fallback",
  );
  assert(returned === response);
  equal(events.length, 1);
  assert(!response.bodyUsed);
  for (
    const fallback of [
      { toString: () => "7".repeat(32), private: "SYNTHETIC-private-object" },
      ["8".repeat(32)],
    ]
  ) {
    const rejected = await observeRuntimeResponse(
      (event) => {
        events.push(event);
      },
      response,
      "overall.analyze",
      "budget_plan",
      fallback as never,
    );
    assert(rejected === response);
    equal(events.length, 1);
    assert(!response.bodyUsed);
  }
  const validHeader = Response.json({ error: { code: "authentication_required" } }, {
    status: 401,
    headers: { "X-Request-ID": "6".repeat(32) },
  });
  await observeRuntimeResponse(
    (event) => {
      events.push(event);
    },
    validHeader,
    "health.ready",
    "relay",
    "SYNTHETIC-private-fallback",
  );
  equal(events.length, 2);
  equal(events[1].operation, "health.ready");
  equal(events[1].request_id, "6".repeat(32));
  assert(!JSON.stringify(events).includes("SYNTHETIC"));
});
