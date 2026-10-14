/** Invented identities/rows only. No real JWT, Auth, database, Storage, or business writes. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  authorizeManagement,
  MANAGEMENT_OPERATIONS,
  requireManagementUniversity,
} from "../../supabase/functions/_shared/jungsi/application/management_access.ts";
import type {
  ForecastAuthorityPort,
  VerifiedUser,
} from "../../supabase/functions/_shared/jungsi/application/ports.ts";
import {
  readSessionSnapshot,
  requirePaidSession,
  sessionDto,
} from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import {
  bearerSha256,
  BoundVerifiedSessionProvider,
  type NativeSessionVerificationPort,
  type OwnProfileVerificationPort,
} from "../../supabase/functions/_shared/jungsi/infrastructure/verified_session.ts";
import {
  PASS_STATE_SQL,
  PublicJeongsiPassesReader,
  type ReadonlyPassSqlPort,
} from "../../supabase/functions/_shared/jungsi/infrastructure/public_passes.ts";
import {
  createSyntheticManagementGuard,
  createSyntheticSessionReadHandler,
  managementRoute,
} from "../../supabase/functions/_shared/jungsi/infrastructure/session_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { utcInstant, utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { calculateSyntheticOffering } from "../../supabase/functions/_shared/jungsi/application/research_offering.ts";
import { assert, equal, syntheticFixture } from "./fixture.ts";
const SUBJECT = "00000000-0000-4000-8000-000000000001",
  OTHER = "00000000-0000-4000-8000-000000000002";
const NOW = utcInstant("2026-10-14T00:00:00.000000Z"),
  TOKEN = "SYNTHETIC-VERIFIED-SESSION",
  RELAY = "SYNTHETIC-RELAY-ONLY-FOR-LOCAL-TEST-0001";
function sqlTime(t: bigint): string {
  const s = utcText(t);
  return s.includes(".") ? s : s.replace("Z", ".000000Z");
}
function schema(expiry: string | null): unknown[] {
  return [
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
}
function fixture() {
  const state = {
    aal: "aal1" as "aal1" | "aal2" | null,
    status: "active" as string | null,
    expiry: null as bigint | null,
    now: NOW,
    completeAt: NOW,
    clockCalls: 0,
    authFailure: false,
    authInvalid: false,
    wrongDigest: false,
    profileFailure: false,
    wrongProfile: false,
    sqlFailure: false,
    authExpiry: NOW + 9999999999n,
    edit: false,
    approve: false,
    editSchools: [] as string[],
    approveSchools: [] as string[],
    resourceSchool: "SYNTHETIC-U1",
    resourceIdMismatch: false,
    authoritySubject: SUBJECT,
    authorityTime: NOW,
    metadata: null as unknown[] | null,
  };
  const calls: string[] = [], parameters: readonly unknown[][] = [];
  const capturedParameters: unknown[][] = [];
  const auth: NativeSessionVerificationPort = {
    verifyExactBearer: async (token, now) => {
      calls.push("verified_auth");
      equal(token, TOKEN);
      assert(now === NOW);
      if (state.authFailure) throw new Error("SYNTHETIC private auth detail");
      if (state.authInvalid) return null;
      return {
        verification: "supabase_auth_getUser_exact_bearer",
        bearerSha256: state.wrongDigest ? "0".repeat(64) : await bearerSha256(token),
        subjectId: SUBJECT,
        expiresAtUtc: state.authExpiry,
        assuranceLevel: state.aal,
      };
    },
  };
  const profiles: OwnProfileVerificationPort = {
    readOwnStatus: async (token, subject) => {
      calls.push("own_profile");
      equal([token, subject], [TOKEN, SUBJECT]);
      if (state.profileFailure) throw new Error("SYNTHETIC profile unavailable");
      return {
        verification: "own_profile_same_bearer_publishable_RLS",
        bearerSha256: await bearerSha256(token),
        subjectId: state.wrongProfile ? OTHER : subject,
        status: state.status,
      };
    },
  };
  const sql: ReadonlyPassSqlPort = {
    readOnlyOne: (statement, args) => {
      calls.push("public_pass_query");
      equal(statement, PASS_STATE_SQL);
      capturedParameters.push([...args]);
      equal(args, ["jungsi_backend_app", SUBJECT, utcText(NOW), utcText(NOW)]);
      if (state.sqlFailure) throw new Error("SYNTHETIC SQL internal detail");
      return Promise.resolve(
        state.metadata ?? schema(state.expiry === null ? null : sqlTime(state.expiry)),
      );
    },
  };
  const sessions = new BoundVerifiedSessionProvider(auth, profiles),
    passes = new PublicJeongsiPassesReader(sql);
  const authorities: ForecastAuthorityPort = {
    readCurrent: (subject, now) => {
      calls.push("forecast_authority");
      equal(subject, SUBJECT);
      assert(now === NOW);
      return Promise.resolve({
        authority: "jungsi_backend.forecast_authorities",
        subjectId: state.authoritySubject,
        evaluatedAtUtc: state.authorityTime,
        edit: state.edit,
        approve: state.approve,
        editUniversityIds: [...state.editSchools],
        approveUniversityIds: [...state.approveSchools],
        universityIds: [...new Set([...state.editSchools, ...state.approveSchools])],
      });
    },
  };
  const ports = {
    sessions,
    passes,
    authorities,
    clock: { nowUtc: () => state.clockCalls++ === 0 ? state.now : state.completeAt },
    relay: new RelayBoundary(RELAY),
    resources: {
      readScope: (kind: "offering" | "draft", id: string, subject: string) => {
        calls.push("resource_scope");
        equal(subject, SUBJECT);
        return Promise.resolve({
          kind,
          id: state.resourceIdMismatch ? "SYNTHETIC-WRONG" : id,
          universityId: state.resourceSchool,
        });
      },
    },
  };
  return { state, calls, parameters, capturedParameters, ports };
}
function request(path = "/api/v1/me", method = "GET", body?: string): Request {
  return new Request("https://synthetic.invalid" + path, {
    method,
    headers: { "Authorization": "Bearer " + TOKEN, "X-Jungsi-Relay-Token": RELAY },
    ...(body === undefined ? {} : { body }),
  });
}
async function failure(run: () => Promise<unknown>, code: string, http: number) {
  try {
    await run();
  } catch (e) {
    assert(e instanceof AccessError);
    equal([e.code, e.http], [code, http]);
    return;
  }
  throw new Error("expected " + code);
}
function staff(f: ReturnType<typeof fixture>, edit = true, approve = true) {
  f.state.aal = "aal2";
  f.state.edit = edit;
  f.state.approve = approve;
  f.state.editSchools = edit ? ["SYNTHETIC-U1"] : [];
  f.state.approveSchools = approve ? ["SYNTHETIC-U1"] : [];
}
const routes: readonly [string, string, string][] = [
  ["forecast.capabilities", "GET", "/api/v1/forecast-capabilities"],
  ["forecast.list", "GET", "/api/v1/forecast-drafts"],
  ["forecast.create", "POST", "/api/v1/offerings/SYNTHETIC-O/forecast-drafts"],
  ["forecast.read", "GET", "/api/v1/forecast-drafts/SYNTHETIC-D"],
  ["forecast.adjust", "POST", "/api/v1/forecast-drafts/SYNTHETIC-D/adjustments"],
  ["forecast.validate", "POST", "/api/v1/forecast-drafts/SYNTHETIC-D/validations"],
  ["forecast.approve", "POST", "/api/v1/forecast-drafts/SYNTHETIC-D/approvals"],
  ["forecast.publish", "POST", "/api/v1/forecast-drafts/SYNTHETIC-D/publications"],
];
Deno.test("standard session permits aal1 and unknown own profile without leaking identity", async () => {
  const f = fixture();
  f.state.status = null;
  const response = await createSyntheticSessionReadHandler(f.ports)(request());
  equal(response.status, 200);
  equal(await response.json(), {
    format: "jungsi.session/v1",
    member_tier: "standard",
    entitlement_expires_at: null,
  });
  assert(response.headers.get("cache-control")?.includes("no-store"));
  equal(f.calls, ["verified_auth", "own_profile", "public_pass_query"]);
});
Deno.test("paid session binds one public query to matching UTC microsecond expiry", async () => {
  const f = fixture();
  f.state.expiry = NOW + 1000001n;
  const response = await createSyntheticSessionReadHandler(f.ports)(request());
  equal(response.status, 200);
  equal(await response.json(), {
    format: "jungsi.session/v1",
    member_tier: "paid",
    entitlement_expires_at: "2026-10-14T00:00:01.000001Z",
  });
  equal(f.capturedParameters.length, 1);
});
Deno.test("current public failure never falls back or downgrades to standard", async () => {
  const f = fixture();
  f.state.sqlFailure = true;
  const response = await createSyntheticSessionReadHandler(f.ports)(request());
  equal(response.status, 503);
  const body = await response.text();
  assert(body.includes("entitlement_unavailable"));
  assert(!body.includes("internal detail"));
});
Deno.test("revocation is visible on next request without any cross-request cache", async () => {
  const f = fixture();
  f.state.expiry = NOW + 1000000n;
  const handler = createSyntheticSessionReadHandler(f.ports);
  equal((await (await handler(request())).json()).member_tier, "paid");
  f.state.expiry = null;
  f.state.clockCalls = 0;
  equal((await (await handler(request())).json()).member_tier, "standard");
  equal(f.calls.filter((x) => x === "public_pass_query").length, 2);
});
Deno.test("expired native session is rejected before public pass query", async () => {
  const f = fixture();
  f.state.authExpiry = NOW;
  equal((await createSyntheticSessionReadHandler(f.ports)(request())).status, 401);
  assert(!f.calls.includes("public_pass_query"));
});
Deno.test("native verification failure is safe 503 with no pass query", async () => {
  const f = fixture();
  f.state.authFailure = true;
  const r = await createSyntheticSessionReadHandler(f.ports)(request());
  equal(r.status, 503);
  assert(!(await r.text()).includes("private auth"));
  assert(!f.calls.includes("public_pass_query"));
});
Deno.test("bearer digest mismatch cannot bind another verified token", async () => {
  const f = fixture();
  f.state.wrongDigest = true;
  equal((await createSyntheticSessionReadHandler(f.ports)(request())).status, 401);
  equal(f.calls, ["verified_auth"]);
});
Deno.test("unknown or mismatched own profile does not break student session", async () => {
  for (const key of ["profileFailure", "wrongProfile"] as const) {
    const f = fixture();
    f.state[key] = true;
    equal((await createSyntheticSessionReadHandler(f.ports)(request())).status, 200);
  }
});
Deno.test("relay rejection precedes native auth and all repositories", async () => {
  const f = fixture(), r = request();
  r.headers.set("X-Jungsi-Relay-Token", RELAY + "x");
  equal((await createSyntheticSessionReadHandler(f.ports)(r)).status, 403);
  equal(f.calls, []);
});
Deno.test("API keys and duplicate bearer headers cannot become user sessions", async () => {
  for (const token of ["sb_publishable_SYNTHETIC", "sb_secret_SYNTHETIC", TOKEN + "," + TOKEN]) {
    const f = fixture(), r = request();
    r.headers.set("Authorization", "Bearer " + token);
    equal((await createSyntheticSessionReadHandler(f.ports)(r)).status, 401);
    equal(f.calls, []);
  }
});
Deno.test("client role aal and status headers do not grant paid membership", async () => {
  const f = fixture(), r = request();
  r.headers.set("X-Role", "admin");
  r.headers.set("X-Aal", "aal2");
  r.headers.set("X-Status", "active");
  r.headers.set("Content-Type", "application/json");
  const response = await createSyntheticSessionReadHandler(f.ports)(r);
  equal(response.status, 200);
  equal((await response.json()).member_tier, "standard");
});
Deno.test("me rejects unregistered query and method with closed safe errors", async () => {
  const f = fixture();
  equal(
    (await createSyntheticSessionReadHandler(f.ports)(request("/api/v1/me?paid=true"))).status,
    400,
  );
  const g = fixture();
  equal(
    (await createSyntheticSessionReadHandler(g.ports)(request("/api/v1/me", "POST", "{}"))).status,
    405,
  );
});
Deno.test("paid expiry during response projection does not emit stale paid DTO", async () => {
  const f = fixture();
  f.state.expiry = NOW + 1n;
  f.state.completeAt = NOW + 1n;
  equal((await createSyntheticSessionReadHandler(f.ports)(request())).status, 503);
  equal(f.capturedParameters.length, 1);
});
Deno.test("JWT expiry during response projection is authentication_required", async () => {
  const f = fixture();
  f.state.authExpiry = NOW + 1n;
  f.state.completeAt = NOW + 1n;
  equal((await createSyntheticSessionReadHandler(f.ports)(request())).status, 401);
});
Deno.test("standard session cannot satisfy a paid student operation", async () => {
  const f = fixture(),
    selected = await readSessionSnapshot(TOKEN, f.ports.sessions, f.ports.passes, NOW);
  await failure(() => Promise.resolve(requirePaidSession(selected, NOW)), "paid_required", 403);
});
Deno.test("paid aal1 unknown profile keeps successful conversion and individual pending states", async () => {
  const f = fixture();
  f.state.aal = "aal1";
  f.state.status = null;
  f.state.expiry = NOW + 1000000n;
  const selected = await readSessionSnapshot(TOKEN, f.ports.sessions, f.ports.passes, NOW);
  requirePaidSession(selected, NOW);
  const input = syntheticFixture(),
    before = JSON.stringify(input),
    result = calculateSyntheticOffering({ read: () => input });
  equal(result.convertedScore, "17.00");
  equal([
    result.scoringStatus,
    result.percentileStatus,
    result.judgmentStatus,
    result.productionReady,
  ], ["ready", "pending", "pending", false]);
  equal(JSON.stringify(input), before);
  assert(!f.calls.includes("forecast_authority"));
});
for (const [operation, method, path] of routes) {
  Deno.test("management active aal2 existing role accepted: " + operation, async () => {
    const f = fixture();
    staff(f);
    const decision = await createSyntheticManagementGuard(f.ports)(
      request(path, method, method === "POST" ? "{" : undefined),
    );
    equal(decision.operation, operation);
    equal(decision.capabilities, ["editor", "approver"]);
    equal(f.calls.filter((x) => x === "public_pass_query").length, 1);
  });
  Deno.test("management verified aal1 rejected before target read: " + operation, async () => {
    const f = fixture();
    staff(f);
    f.state.aal = "aal1";
    const r = request(
      path,
      method,
      method === "POST" ? '{"aal":"aal2","role":"admin","status":"active"}' : undefined,
    );
    r.headers.set("X-Aal", "aal2");
    await failure(() => createSyntheticManagementGuard(f.ports)(r), "management_mfa_required", 403);
    assert(!f.calls.includes("resource_scope"));
  });
  Deno.test("management unknown own state rejected: " + operation, async () => {
    const f = fixture();
    staff(f);
    f.state.status = null;
    await failure(
      () => createSyntheticManagementGuard(f.ports)(request(path, method)),
      "management_account_state_unverified",
      503,
    );
    assert(!f.calls.includes("resource_scope"));
  });
  Deno.test("management inactive own state rejected: " + operation, async () => {
    const f = fixture();
    staff(f);
    f.state.status = "suspended";
    await failure(
      () => createSyntheticManagementGuard(f.ports)(request(path, method)),
      "management_account_inactive",
      403,
    );
    assert(!f.calls.includes("resource_scope"));
  });
}
Deno.test("nonstaff capabilities remain empty without MFA or known account status", async () => {
  const f = fixture();
  f.state.aal = null;
  f.state.status = null;
  const decision = await createSyntheticManagementGuard(f.ports)(
    request("/api/v1/forecast-capabilities"),
  );
  equal(decision.capabilities, []);
  equal(decision.universityIds, []);
});
Deno.test("aal2 active alone does not grant edit approve or paid exceptions", async () => {
  const f = fixture();
  f.state.aal = "aal2";
  await failure(
    () =>
      createSyntheticManagementGuard(f.ports)(
        request("/api/v1/offerings/SYNTHETIC-O/forecast-drafts", "POST", "{"),
      ),
    "forecast_forbidden",
    403,
  );
  const g = fixture();
  g.state.aal = "aal2";
  const selected = await readSessionSnapshot(TOKEN, g.ports.sessions, g.ports.passes, NOW);
  await failure(() => Promise.resolve(requirePaidSession(selected, NOW)), "paid_required", 403);
});
Deno.test("edit and approve school scopes cannot substitute for each other", async () => {
  const f = fixture();
  staff(f);
  f.state.approveSchools = ["SYNTHETIC-U2"];
  f.state.resourceSchool = "SYNTHETIC-U1";
  await failure(
    () =>
      createSyntheticManagementGuard(f.ports)(
        request("/api/v1/forecast-drafts/SYNTHETIC-D/approvals", "POST"),
      ),
    "forecast_not_found",
    404,
  );
  const g = fixture();
  staff(g);
  g.state.editSchools = ["SYNTHETIC-U2"];
  await failure(
    () =>
      createSyntheticManagementGuard(g.ports)(
        request("/api/v1/forecast-drafts/SYNTHETIC-D/validations", "POST"),
      ),
    "forecast_not_found",
    404,
  );
});
Deno.test("read/list permit approver scope but create still requires editor", async () => {
  const f = fixture();
  staff(f, false, true);
  equal(
    (await createSyntheticManagementGuard(f.ports)(request("/api/v1/forecast-drafts/SYNTHETIC-D")))
      .operation,
    "forecast.read",
  );
  const g = fixture();
  staff(g, false, true);
  await failure(
    () =>
      createSyntheticManagementGuard(g.ports)(
        request("/api/v1/offerings/SYNTHETIC-O/forecast-drafts", "POST"),
      ),
    "forecast_forbidden",
    403,
  );
});
Deno.test("editor cannot approve or publish", async () => {
  for (const action of ["approvals", "publications"]) {
    const f = fixture();
    staff(f, true, false);
    await failure(
      () =>
        createSyntheticManagementGuard(f.ports)(
          request("/api/v1/forecast-drafts/SYNTHETIC-D/" + action, "POST"),
        ),
      "forecast_forbidden",
      403,
    );
  }
});
Deno.test("server resource identity mismatch is not accepted from path or body", async () => {
  const f = fixture();
  staff(f);
  f.state.resourceIdMismatch = true;
  await failure(
    () => createSyntheticManagementGuard(f.ports)(request("/api/v1/forecast-drafts/SYNTHETIC-D")),
    "invalid_repository_result",
    503,
  );
});
Deno.test("foreign school is hidden as not found even with aal2 active role", async () => {
  const f = fixture();
  staff(f);
  f.state.resourceSchool = "SYNTHETIC-OTHER-U";
  await failure(
    () => createSyntheticManagementGuard(f.ports)(request("/api/v1/forecast-drafts/SYNTHETIC-D")),
    "forecast_not_found",
    404,
  );
});
Deno.test("authority subject/time mismatch fails closed", async () => {
  for (const key of ["authoritySubject", "authorityTime"] as const) {
    const f = fixture();
    staff(f);
    if (key === "authoritySubject") f.state.authoritySubject = OTHER;
    else f.state.authorityTime = NOW - 1n;
    await failure(
      () => createSyntheticManagementGuard(f.ports)(request("/api/v1/forecast-capabilities")),
      "invalid_repository_result",
      503,
    );
  }
});
Deno.test("list filtering never widens the authorized school set", async () => {
  const f = fixture();
  staff(f);
  equal(
    (await createSyntheticManagementGuard(f.ports)(
      request("/api/v1/forecast-drafts?university_id=SYNTHETIC-U2"),
    )).universityIds,
    [],
  );
});
Deno.test("public forecast read is not a management route", () => {
  let failed = false;
  try {
    managementRoute(request("/api/v1/offerings/SYNTHETIC-O/forecast"));
  } catch (e) {
    assert(e instanceof AccessError);
    equal(e.code, "route_not_found");
    failed = true;
  }
  assert(failed);
});
Deno.test("all eight operations are covered once by exact route mapping", () => {
  equal(routes.map((r) => r[0]), [...MANAGEMENT_OPERATIONS]);
  for (const [operation, method, path] of routes) {
    equal(managementRoute(request(path, method)).operation, operation);
  }
});
Deno.test("SQL uses one bounded metadata/current pass query and exact period predicates", () => {
  assert(PASS_STATE_SQL.startsWith("SELECT"));
  assert(!PASS_STATE_SQL.includes(";"));
  for (
    const part of [
      "max(ends_at)",
      "public.jeongsi_passes",
      "user_id=$2",
      "revoked_at IS NULL",
      "starts_at<=$3",
      "ends_at>$4",
      "meta_columns.rows",
      "meta_policies.rows",
    ]
  ) assert(PASS_STATE_SQL.includes(part), part);
  assert(!PASS_STATE_SQL.includes("jungsi_backend.entitlements"));
});
for (
  const [label, mutate, code] of [
    ["writer role", (r: unknown[]) => {
      (r[3] as unknown[])[5] = true;
    }, "entitlement_runtime_role_unverified"],
    ["bypass role", (r: unknown[]) => {
      (r[3] as unknown[])[2] = true;
    }, "entitlement_runtime_role_unverified"],
    ["string boolean", (r: unknown[]) => {
      (r[3] as unknown[])[0] = "true";
    }, "entitlement_runtime_role_unverified"],
    ["missing relation", (r: unknown[]) => {
      r[0] = false;
    }, "entitlement_schema_unverified"],
    ["extra column", (r: unknown[]) => {
      (r[1] as unknown[]).push(["status", "text", "YES"]);
    }, "entitlement_schema_unverified"],
    ["duplicate column", (r: unknown[]) => {
      (r[1] as unknown[])[1] = (r[1] as unknown[])[0];
    }, "entitlement_schema_unverified"],
    ["unvalidated period", (r: unknown[]) => {
      (r[2] as unknown[][])[0][2] = false;
    }, "entitlement_schema_unverified"],
    ["wrong policy", (r: unknown[]) => {
      (r[4] as unknown[][])[1][4] = "false";
    }, "entitlement_rls_unverified"],
    ["native Date instead of exact text", (r: unknown[]) => {
      r[5] = new Date(0);
    }, "entitlement_result_invalid"],
    ["expired aggregate", (r: unknown[]) => {
      r[5] = sqlTime(NOW);
    }, "entitlement_result_invalid"],
  ] as const
) {
  Deno.test("public pass metadata/result refusal: " + label, async () => {
    const f = fixture();
    f.state.metadata = schema(sqlTime(NOW + 1000000n));
    mutate(f.state.metadata);
    const response = await createSyntheticSessionReadHandler(f.ports)(request());
    equal(response.status, 503);
    equal((await response.json()).error.code, code);
    equal(f.capturedParameters.length, 1);
  });
}
Deno.test("pass snapshot identity/time/native type mismatch is rejected", async () => {
  for (const variant of ["subject", "time", "type", "authority"]) {
    const f = fixture();
    const state = {
      authority: "public.jeongsi_passes" as const,
      metadataVerified: true as const,
      subjectId: SUBJECT,
      evaluatedAtUtc: NOW,
      paidUntilUtc: null as bigint | null,
    };
    if (variant === "subject") state.subjectId = OTHER;
    if (variant === "time") state.evaluatedAtUtc = NOW - 1n;
    const bad = variant === "type"
      ? { ...state, paidUntilUtc: "1" }
      : variant === "authority"
      ? { ...state, authority: "jungsi_backend.entitlements" }
      : state;
    await failure(
      () =>
        readSessionSnapshot(TOKEN, f.ports.sessions, {
          readCurrent: () => Promise.resolve(bad as never),
        }, NOW),
      "entitlement_unavailable",
      503,
    );
  }
});
Deno.test("malformed server verified fields never become trusted session metadata", async () => {
  const f = fixture();
  const user = {
    subjectId: SUBJECT,
    expiresAtUtc: NOW + 100n,
    assuranceLevel: "aal3",
    accountStatus: "active",
  };
  await failure(
    () =>
      readSessionSnapshot(
        TOKEN,
        { verifyUserBearer: () => Promise.resolve(user as never) },
        f.ports.passes,
        NOW,
      ),
    "authentication_required",
    401,
  );
});
Deno.test("management empty authority does not accept client profile-admin fields", async () => {
  const f = fixture();
  const r = request("/api/v1/forecast-drafts", "GET");
  r.headers.set("X-Profile-Admin", "true");
  r.headers.set("X-Role", "approver");
  await failure(() => createSyntheticManagementGuard(f.ports)(r), "forecast_forbidden", 403);
});
Deno.test("school permission helper rejects an unlisted server scope", async () => {
  const user: VerifiedUser = {
    subjectId: SUBJECT,
    expiresAtUtc: NOW + 1000n,
    assuranceLevel: "aal2",
    accountStatus: "active",
  };
  const f = fixture();
  staff(f);
  const decision = await authorizeManagement(user, f.ports.authorities, NOW, "forecast.publish");
  await failure(
    () => Promise.resolve(requireManagementUniversity(decision, "SYNTHETIC-U2")),
    "forecast_not_found",
    404,
  );
});
Deno.test("session DTO refuses clock rollback without repeating the pass read", async () => {
  const f = fixture(), s = await readSessionSnapshot(TOKEN, f.ports.sessions, f.ports.passes, NOW);
  await failure(
    () => Promise.resolve(sessionDto(s, NOW - 1n)),
    "backend_dependency_unavailable",
    503,
  );
  equal(f.capturedParameters.length, 1);
});

Deno.test("native expiry outside UTC datetime range is not accepted", async () => {
  const f = fixture();
  f.state.authExpiry = 10n ** 30n;
  equal((await createSyntheticSessionReadHandler(f.ports)(request())).status, 401);
  assert(!f.calls.includes("own_profile"));
  assert(!f.calls.includes("public_pass_query"));
});
Deno.test("trusted session port also enforces supported UTC expiry range", async () => {
  const f = fixture();
  await failure(
    () =>
      readSessionSnapshot(
        TOKEN,
        {
          verifyUserBearer: () =>
            Promise.resolve({
              subjectId: SUBJECT,
              expiresAtUtc: 10n ** 30n,
              assuranceLevel: "aal2",
              accountStatus: "active",
            }),
        },
        f.ports.passes,
        NOW,
      ),
    "authentication_required",
    401,
  );
  assert(!f.calls.includes("public_pass_query"));
});
