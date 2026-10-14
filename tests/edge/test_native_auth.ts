/** Invented JWTs and fetch responses; no credentials or network calls. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { SupabaseNativeAuth } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_auth.ts";
import {
  bearerSha256,
  BoundVerifiedSessionProvider,
} from "../../supabase/functions/_shared/jungsi/infrastructure/verified_session.ts";
import { assert, equal, syncPromise } from "./fixture.ts";
import {
  readSessionSnapshot,
  requirePaidSession,
  sessionDto,
  type SessionSnapshot,
} from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import { authorizeReport } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { authorizeManagement } from "../../supabase/functions/_shared/jungsi/application/management_access.ts";

const UID = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const NOW = 1700000000000000n;
const CONFIG = { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" };
function token(raw: string | Record<string, unknown> = { sub: UID, exp: 1700000060, aal: "aal2" }) {
  const text = typeof raw === "string"
    ? raw
    : JSON.stringify({ iss: CONFIG.url + "/auth/v1", ...raw });
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "e30." + payload + ".SYNTHETIC";
}
function port(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetcher: typeof fetch = (input, init) => Promise.resolve(fn(String(input), init ?? {}));
  return new SupabaseNativeAuth(CONFIG, fetcher);
}
async function unavailable(run: () => Promise<unknown>) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, "auth_unavailable");
  equal(error.http, 503);
}
Deno.test("native Auth verifies exact bearer remotely before using claims", async () => {
  const bearer = token();
  const p = port((url, init) => {
    equal(url, CONFIG.url + "/auth/v1/user");
    equal(init.method, "GET");
    equal(new Headers(init.headers).get("Authorization"), "Bearer " + bearer);
    equal(new Headers(init.headers).get("apikey"), CONFIG.publishableKey);
    equal(init.redirect, "error");
    assert(init.signal instanceof AbortSignal);
    return Response.json({ id: UID, user_metadata: { paid: false, role: "admin" } });
  });
  const verified = await p.verifyExactBearer(bearer, NOW);
  assert(verified);
  equal(verified.subjectId, UID);
  assert(verified.expiresAtUtc === 1700000060000000n);
  equal(verified.assuranceLevel, "aal2");
  equal(verified.bearerSha256, await bearerSha256(bearer));
});
Deno.test("native Auth rejection never decodes or trusts forged claims", async () => {
  for (const status of [400, 401, 403]) {
    const p = port(() => new Response("not a user", { status }));
    equal(await p.verifyExactBearer("a.a.a", NOW), null);
  }
});
Deno.test("native Auth does not accept a different server subject", async () => {
  const p = port(() => Response.json({ id: OTHER }));
  equal(await p.verifyExactBearer(token(), NOW), null);
});
Deno.test("native Auth expires exactly at the UTC boundary", async () => {
  const p = port(() => Response.json({ id: UID }));
  equal(await p.verifyExactBearer(token({ sub: UID, exp: 1700000000 }), NOW), null);
  assert(await p.verifyExactBearer(token({ sub: UID, exp: 1700000000 }), NOW - 1n));
});
Deno.test("native Auth preserves missing and valid AAL without client role claims", async () => {
  const p = port(() => Response.json({ id: UID }));
  for (const aal of [null, "aal1", "aal2"] as const) {
    const verified = await p.verifyExactBearer(token({ sub: UID, exp: 1700000060, aal }), NOW);
    assert(verified);
    equal(verified.assuranceLevel, aal);
  }
});
Deno.test("native Auth rejects unsupported or native-type-invalid AAL", async () => {
  const p = port(() => Response.json({ id: UID }));
  for (const aal of [true, 2, {}, "aal3", "", ["aal2"]]) {
    equal(await p.verifyExactBearer(token({ sub: UID, exp: 1700000060, aal }), NOW), null);
  }
});
Deno.test("native Auth rejects float string unsafe and out-of-calendar expiry", async () => {
  const p = port(() => Response.json({ id: UID }));
  for (const exp of ["1700000060.0", '"1700000060"', "true", "9007199254740993", "253402300800"]) {
    equal(
      await p.verifyExactBearer(
        token(`{"iss":"${CONFIG.url}/auth/v1","sub":"${UID}","exp":${exp}}`),
        NOW,
      ),
      null,
    );
  }
});
Deno.test("native Auth rejects duplicate claim keys", async () => {
  const p = port(() => Response.json({ id: UID }));
  equal(
    await p.verifyExactBearer(
      token(`{"iss":"${CONFIG.url}/auth/v1","sub":"${UID}","exp":1700000060,"exp":1700000061}`),
      NOW,
    ),
    null,
  );
});
Deno.test("native Auth rejects invalid getUser identity", async () => {
  for (const user of [{ id: "client-name" }, { id: 1 }, [], null]) {
    equal(await port(() => Response.json(user)).verifyExactBearer(token(), NOW), null);
  }
});
Deno.test("native Auth dependency failures stay safe 503", async () => {
  await unavailable(() =>
    port(() => new Response("SYNTHETIC-PRIVATE", { status: 500 })).verifyExactBearer(token(), NOW)
  );
  await unavailable(() =>
    port(() => {
      throw new Error("SYNTHETIC-PRIVATE");
    }).verifyExactBearer(token(), NOW)
  );
  await unavailable(() => port(() => new Response("{")).verifyExactBearer(token(), NOW));
});
Deno.test("native Auth duplicate response fields are dependency failure", async () => {
  await unavailable(() =>
    port(() => new Response(`{"id":"${UID}","id":"${OTHER}"}`)).verifyExactBearer(token(), NOW)
  );
});
Deno.test("native Auth enforces response byte and UTF8 bounds", async () => {
  await unavailable(() =>
    port(() => new Response("x", { headers: { "content-length": "65537" } })).verifyExactBearer(
      token(),
      NOW,
    )
  );
  await unavailable(() =>
    port(() => new Response("x".repeat(65537))).verifyExactBearer(token(), NOW)
  );
  await unavailable(() =>
    port(() => new Response(new Uint8Array([255]))).verifyExactBearer(token(), NOW)
  );
});
Deno.test("native profile uses only same bearer publishable key own id status and one row", async () => {
  const bearer = token();
  const p = port((url, init) => {
    const target = new URL(url);
    equal(target.origin, CONFIG.url);
    equal(target.pathname, "/rest/v1/profiles");
    equal([...target.searchParams], [["select", "role,status"], ["id", "eq." + UID], [
      "limit",
      "1",
    ]]);
    equal(new Headers(init.headers).get("Authorization"), "Bearer " + bearer);
    equal(new Headers(init.headers).get("apikey"), CONFIG.publishableKey);
    return Response.json([{ status: "active", role: "admin" }]);
  });
  const own = await p.readOwnStatus(bearer, UID);
  assert(own);
  equal(own.subjectId, UID);
  equal(own.status, "active");
  equal(own.role, "admin");
  equal(own.bearerSha256, await bearerSha256(bearer));
});

function adminFixture(
  options: {
    role?: unknown;
    status?: unknown;
    aal?: "aal1" | "aal2";
    paidUntil?: bigint | null;
    profileUnavailable?: boolean;
  } = {},
) {
  let role: unknown = Object.hasOwn(options, "role") ? options.role : "admin",
    status: unknown = Object.hasOwn(options, "status") ? options.status : "active";
  const calls: string[] = [],
    bearer = token({ sub: UID, exp: 1700000060, aal: options.aal ?? "aal2", role: "admin" });
  const native = port((url) => {
    const target = new URL(url);
    calls.push(target.pathname);
    if (target.pathname === "/auth/v1/user") {
      return Response.json({ id: UID, user_metadata: { role: "admin", paid: true } });
    }
    equal(target.searchParams.get("select"), "role,status");
    equal(target.searchParams.get("id"), "eq." + UID);
    return options.profileUnavailable
      ? new Response("unavailable", { status: 503 })
      : Response.json([{ role, status }]);
  });
  const sessions = new BoundVerifiedSessionProvider(native, native);
  const passes = {
    readCurrent: (subjectId: string, evaluatedAtUtc: bigint) =>
      syncPromise(() => ({
        authority: "public.jeongsi_passes" as const,
        metadataVerified: true as const,
        subjectId,
        evaluatedAtUtc,
        paidUntilUtc: options.paidUntil ?? null,
      })),
  };
  return {
    sessions,
    passes,
    bearer,
    calls,
    changeProfile(nextRole: unknown, nextStatus: unknown) {
      role = nextRole;
      status = nextStatus;
    },
    read: () => readSessionSnapshot(bearer, sessions, passes, NOW),
  };
}
async function adminRefused(work: () => unknown, code: string, http: number) {
  let failure: unknown;
  try {
    await work();
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof AccessError);
  equal(failure.code, code);
  equal(failure.http, http);
}
Deno.test("verified active own-profile aal2 admin receives only the three-field paid-null exception", async () => {
  const f = adminFixture(), snapshot = await f.read();
  equal(sessionDto(snapshot, NOW), {
    format: "jungsi.session/v1",
    member_tier: "paid",
    entitlement_expires_at: null,
  });
  requirePaidSession(snapshot, NOW);
  equal(f.calls.filter((path) => path === "/rest/v1/profiles").length, 1);
});
Deno.test("verified admin with a real active pass retains its original expiry", async () => {
  const snapshot = await adminFixture({ paidUntil: NOW + 1234567n }).read();
  equal(sessionDto(snapshot, NOW).entitlement_expires_at, "2023-11-14T22:13:21.234567Z");
});
Deno.test("aal1 inactive ordinary editor and approver profiles never gain the admin exception", async () => {
  for (
    const options of [
      { aal: "aal1" as const },
      { status: "inactive" },
      { status: null },
      { role: "student" },
      { role: "editor" },
      { role: "approver" },
      { role: 1 },
      { role: "admin " },
      { role: null },
      { role: undefined },
    ]
  ) {
    const snapshot = await adminFixture(options).read();
    equal(sessionDto(snapshot, NOW).member_tier, "standard");
    await adminRefused(() => requirePaidSession(snapshot, NOW), "paid_required", 403);
  }
});
Deno.test("profile failures and wrong-subject or wrong-bearer profile receipts preserve an ordinary paid pass", async () => {
  const f = adminFixture({ profileUnavailable: true, paidUntil: NOW + 1000000n });
  equal(sessionDto(await f.read(), NOW).entitlement_expires_at, "2023-11-14T22:13:21Z");
  equal(
    sessionDto(await adminFixture({ profileUnavailable: true }).read(), NOW).member_tier,
    "standard",
  );
  for (const mismatch of ["subject", "bearer"]) {
    const native = port(() => Response.json({ id: UID }));
    const digest = await bearerSha256(f.bearer);
    const profiles = {
      readOwnStatus: () =>
        syncPromise(() => ({
          verification: "own_profile_same_bearer_publishable_RLS" as const,
          bearerSha256: mismatch === "bearer" ? "wrong" : digest,
          subjectId: mismatch === "subject" ? OTHER : UID,
          status: "active",
          role: "admin",
        })),
    };
    const snapshot = await readSessionSnapshot(
      f.bearer,
      new BoundVerifiedSessionProvider(native, profiles),
      f.passes,
      NOW,
    );
    equal(snapshot.user.accountRole, null);
    equal(sessionDto(snapshot, NOW).member_tier, "paid");
    assert(sessionDto(snapshot, NOW).entitlement_expires_at !== null);
  }
});
Deno.test("the same JWT is re-evaluated after administrator demotion or deactivation on the next request", async () => {
  const f = adminFixture();
  equal(sessionDto(await f.read(), NOW).member_tier, "paid");
  f.changeProfile("student", "active");
  equal(sessionDto(await f.read(), NOW).member_tier, "standard");
  f.changeProfile("admin", "inactive");
  equal(sessionDto(await f.read(), NOW).member_tier, "standard");
  equal(f.calls.filter((path) => path === "/rest/v1/profiles").length, 3);
  equal(f.calls.filter((path) => path === "/auth/v1/user").length, 3);
});
Deno.test("paid-null without this request's verified admin origin remains a 503 even with copied role fields", async () => {
  const original = await adminFixture().read();
  const copied: SessionSnapshot = { ...original };
  await adminRefused(() => sessionDto(copied, NOW), "entitlement_unavailable", 503);
  await adminRefused(
    () => sessionDto({ ...copied, adminOrigin: undefined }, NOW),
    "entitlement_unavailable",
    503,
  );
  await adminRefused(() => sessionDto(original, NOW + 60000000n), "authentication_required", 401);
});
Deno.test("verified admin origin never converts an unavailable or wrong-subject pass lookup into success", async () => {
  const f = adminFixture();
  await adminRefused(
    () =>
      readSessionSnapshot(f.bearer, f.sessions, {
        readCurrent: () => Promise.reject(new Error("SYNTHETIC")),
      }, NOW),
    "entitlement_unavailable",
    503,
  );
  await adminRefused(
    () =>
      readSessionSnapshot(f.bearer, f.sessions, {
        readCurrent: () =>
          syncPromise(() => ({
            authority: "public.jeongsi_passes" as const,
            metadataVerified: true as const,
            subjectId: OTHER,
            evaluatedAtUtc: NOW,
            paidUntilUtc: null,
          })),
      }, NOW),
    "entitlement_unavailable",
    503,
  );
});
Deno.test("administrator paid access still rejects another owner's report", async () => {
  const snapshot = await adminFixture().read();
  await adminRefused(
    () =>
      authorizeReport(snapshot.user, "SYNTHETIC-report", {
        find: () => syncPromise(() => ({ ownerId: OTHER, confirmed: true })),
      }, true),
    "report_not_found",
    404,
  );
});
Deno.test("administrator membership exception does not grant forecast edit or approval authority", async () => {
  const snapshot = await adminFixture().read();
  const authorities = {
    readCurrent: (subjectId: string, evaluatedAtUtc: bigint) =>
      syncPromise(() => ({
        authority: "jungsi_backend.forecast_authorities" as const,
        subjectId,
        evaluatedAtUtc,
        edit: false,
        approve: false,
        universityIds: [],
        editUniversityIds: [],
        approveUniversityIds: [],
      })),
  };
  for (const operation of ["forecast.create", "forecast.approve"] as const) {
    await adminRefused(
      () => authorizeManagement(snapshot.user, authorities, NOW, operation),
      "forecast_forbidden",
      403,
    );
  }
});
Deno.test("native profile closes unknown malformed duplicate or oversized status", async () => {
  for (
    const rows of [
      [],
      [{ status: "active" }, { status: "active" }],
      [{ status: "" }],
      [{ status: null }],
      [{ status: 1 }],
      [{ status: "active", id: UID }],
    ]
  ) {
    equal(await port(() => Response.json(rows)).readOwnStatus(token(), UID), null);
  }
  equal(
    await port(() => new Response('[{"status":"active","status":"inactive"}]')).readOwnStatus(
      token(),
      UID,
    ),
    null,
  );
  equal(await port(() => new Response("x".repeat(2049))).readOwnStatus(token(), UID), null);
});
Deno.test("native profile failure leaves verified student auth intact and management state unknown", async () => {
  const p = port((url) =>
    url.endsWith("/auth/v1/user")
      ? Response.json({ id: UID })
      : new Response("unavailable", { status: 503 })
  );
  const user = await new BoundVerifiedSessionProvider(p, p).verifyUserBearer(token(), NOW);
  assert(user);
  equal(user.subjectId, UID);
  equal(user.accountStatus, null);
});
Deno.test("native Auth never sends an API key or malformed bearer as user identity", async () => {
  let calls = 0;
  const p = port(() => {
    calls++;
    return Response.json({ id: UID });
  });
  for (
    const bearer of [
      "",
      "x y",
      "x,y",
      "sb_publishable_SYNTHETIC",
      "sb_secret_SYNTHETIC",
      "x".repeat(16385),
    ]
  ) {
    equal(await p.verifyExactBearer(bearer, NOW), null);
  }
  equal(calls, 0);
});
Deno.test("native Auth configuration rejects non-Supabase origins redirects and privileged API keys", () => {
  for (
    const config of [
      { ...CONFIG, url: "http://synthetic.supabase.co" },
      { ...CONFIG, url: "https://synthetic.supabase.co/another" },
      { ...CONFIG, url: "https://synthetic.supabase.co?redirect=example.com" },
      { ...CONFIG, url: "https://example.com" },
      { ...CONFIG, publishableKey: "sb_secret_SYNTHETIC" },
      { ...CONFIG, publishableKey: token({ role: "service_role" }) },
    ]
  ) {
    let error: unknown;
    try {
      new SupabaseNativeAuth(config);
    } catch (e) {
      error = e;
    }
    assert(error instanceof AccessError);
    equal(error.code, "auth_configuration_invalid");
  }
});

Deno.test("native Auth requires the exact configured Supabase issuer after remote getUser", async () => {
  const p = port(() => Response.json({ id: UID }));
  for (
    const iss of [
      undefined,
      null,
      2,
      "https://other.supabase.co/auth/v1",
      CONFIG.url + "/auth/v1/",
      CONFIG.url,
    ]
  ) {
    equal(await p.verifyExactBearer(token({ sub: UID, exp: 1700000060, iss }), NOW), null);
  }
  assert(
    await p.verifyExactBearer(
      token({ sub: UID, exp: 1700000060, iss: CONFIG.url + "/auth/v1" }),
      NOW,
    ),
  );
});

Deno.test("native Auth legacy anon key cannot name a different project", () => {
  let error: unknown;
  try {
    new SupabaseNativeAuth({
      ...CONFIG,
      publishableKey: token({ role: "anon", ref: "SYNTHETIC-other" }),
    });
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, "auth_configuration_invalid");
});
