/** Invented bearer, metadata and fetch responses. No network, real TLS, DB or deployment proof. */
import {
  NativeRuntimeApi,
  type RuntimeComposition,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SUBJECT_CONTEXT_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "../edge/fixture.ts";
import { syntheticApiPolicies } from "../edge/synthetic_api_contract.ts";
import {
  SYNTHETIC_RUNTIME_NOW,
  SYNTHETIC_RUNTIME_URL,
  syntheticRuntimeBinding,
} from "../edge/synthetic_runtime_binding.ts";

const SUBJECT = "00000000-0000-4000-8000-000000000001";
const policies = syntheticApiPolicies().map((p) => ({
  ...p,
  contract_ref: "SYNTHETIC",
}));
function schemas() {
  const text = { type: "string", nullable: false };
  const empty = {
    type: "object",
    nullable: false,
    properties: {},
    required: [],
    optional: [],
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
  const payload = btoa(claims).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
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
    expiry === null ? null : "1",
  ];
  for (const index of [1, 2, 3, 4]) {
    values[index] = JSON.stringify(values[index]);
  }
  return values;
}
async function fixture(
  subjectOnly = false,
  observe?: RuntimeComposition["observe"],
  observeAuth?: RuntimeComposition["observeAuth"],
) {
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
  const calls = {
    auth: 0,
    profile: 0,
    pass: 0,
    storage: 0,
    pool: 0,
    closed: 0,
  };
  const statements: {
    sql: string;
    parameters: readonly unknown[];
    readOnly: boolean;
  }[] = [];
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
              state.usageNative === undefined
                ? state.usageSchema
                : state.usageNative,
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
    observeAuth,
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
        equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer " + expectedToken,
        );
        equal(
          new Headers(init?.headers).get("apikey"),
          binding.values.SUPABASE_PUBLISHABLE_KEY ??
            binding.values.JUNGSI_DISPLAY_PUBLISHABLE_KEY,
        );
        return Promise.resolve(
          Response.json({ id: SUBJECT, user_metadata: { role: "admin" } }, {
            status: state.authStatus,
          }),
        );
      }
      if (url.pathname === "/rest/v1/profiles") {
        calls.profile++;
        equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer " + expectedToken,
        );
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
  function request(
    path = "/api/v1/me",
    aal: "aal1" | "aal2" = "aal2",
    relay = true,
  ) {
    expectedToken = token(aal, SYNTHETIC_RUNTIME_NOW + 60000000n);
    return new Request("https://synthetic.invalid" + path, {
      headers: {
        Authorization: "Bearer " + expectedToken,
        ...(relay
          ? { "X-Jungsi-Relay-Token": binding.values.JUNGSI_RELAY_TOKEN }
          : {}),
      },
    });
  }
  return { binding, state, calls, statements, pool, api, request };
}

Deno.test("runtime emits one bounded profile diagnostic without credentials or account identity", async () => {
  const events: unknown[] = [];
  const f = await fixture(false, undefined, (event) => {
    events.push(event);
  });
  const response = await f.api.fetch(f.request());
  equal(response.status, 200);
  equal((await response.json()).member_tier, "paid");
  equal(events.length, 1);
  const event = events[0] as Record<string, unknown>;
  equal(Object.keys(event).sort(), [
    "admin_exception_reason",
    "elapsed_ms",
    "http_status",
    "kind",
    "outcome",
    "request_id",
    "row_count",
  ]);
  equal([
    event.kind,
    event.outcome,
    event.http_status,
    event.row_count,
    event.admin_exception_reason,
  ], ["profile_lookup", "ok", 200, 1, "admin_allowed"]);
  assert(
    typeof event.request_id === "string" &&
      /^[a-f0-9]{32}$/.test(event.request_id),
  );
  const raw = JSON.stringify(event);
  assert(
    !raw.includes(SUBJECT) && !raw.includes("SYNTHETIC") &&
      !raw.includes("Bearer") && !raw.includes("active"),
  );
});
Deno.test("runtime safely reports failed profile lookup while retaining existing standard behavior", async () => {
  const events: Record<string, unknown>[] = [];
  const f = await fixture(false, undefined, (event) => {
    events.push(event as unknown as Record<string, unknown>);
  });
  f.state.profileStatus = 503;
  const response = await f.api.fetch(f.request());
  equal(response.status, 200);
  equal((await response.json()).member_tier, "standard");
  equal(events.length, 1);
  equal([
    events[0].outcome,
    events[0].http_status,
    events[0].row_count,
    events[0].admin_exception_reason,
  ], ["http_status", 503, null, "profile_unavailable"]);
});
Deno.test("runtime diagnostic sink failure never changes session response", async () => {
  const f = await fixture(false, undefined, () => {
    throw new Error("SYNTHETIC_PRIVATE");
  });
  const response = await f.api.fetch(f.request());
  equal(response.status, 200);
  equal((await response.json()).member_tier, "paid");
});
