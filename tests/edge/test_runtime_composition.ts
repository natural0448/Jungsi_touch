/** Invented bearer, metadata and fetch responses. No network, real TLS, DB or deployment proof. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { NativeRuntimeApi } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
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
async function fixture() {
  const binding = await syntheticRuntimeBinding();
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
        equal(new Headers(init?.headers).get("apikey"), binding.values.SUPABASE_PUBLISHABLE_KEY);
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
