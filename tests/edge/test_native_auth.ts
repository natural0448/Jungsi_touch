/** Invented JWTs and fetch responses; no credentials or network calls. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { SupabaseNativeAuth } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_auth.ts";
import {
  bearerSha256,
  BoundVerifiedSessionProvider,
} from "../../supabase/functions/_shared/jungsi/infrastructure/verified_session.ts";
import { assert, equal } from "./fixture.ts";

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
    equal([...target.searchParams], [["select", "status"], ["id", "eq." + UID], ["limit", "1"]]);
    equal(new Headers(init.headers).get("Authorization"), "Bearer " + bearer);
    equal(new Headers(init.headers).get("apikey"), CONFIG.publishableKey);
    return Response.json([{ status: "active" }]);
  });
  const own = await p.readOwnStatus(bearer, UID);
  assert(own);
  equal(own.subjectId, UID);
  equal(own.status, "active");
  equal(own.bearerSha256, await bearerSha256(bearer));
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
