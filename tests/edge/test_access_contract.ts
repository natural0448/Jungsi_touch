import {
  authorizeRelayed,
  type BoundaryPorts,
  RelayBoundary,
  safeFailure,
} from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { assert, equal } from "./fixture.ts";
const RELAY = "SYNTHETIC-LOCAL-RELAY-NOT-A-SECRET-12345", NOW = 1000000n;
function fixture() {
  const calls: string[] = [];
  const ports: BoundaryPorts = {
    sessions: {
      verifyUserBearer: (token) => {
        calls.push("Auth");
        return Promise.resolve(
          token === "SYNTHETIC-USER"
            ? { subjectId: "SYNTHETIC-SUBJECT", expiresAtUtc: NOW + 10n }
            : null,
        );
      },
    },
    entitlements: {
      current: () => {
        calls.push("current entitlement");
        return Promise.resolve({ tier: "paid", paidUntilUtc: NOW + 1n });
      },
    },
    reports: {
      find: () => {
        calls.push("owner");
        return Promise.resolve({ ownerId: "SYNTHETIC-SUBJECT", confirmed: true });
      },
    },
  };
  const headers = new Headers({
    "X-Jungsi-Relay-Token": RELAY,
    "Authorization": "Bearer SYNTHETIC-USER",
  });
  return { calls, ports, headers, relay: new RelayBoundary(RELAY) };
}
async function fails(run: () => Promise<unknown>, code: string, http: number) {
  try {
    await run();
  } catch (e) {
    assert(e instanceof AccessError);
    equal([e.code, e.http], [code, http]);
    return e;
  }
  throw new Error("expected failure");
}
Deno.test("relay precedes all providers", async () => {
  const f = fixture();
  f.headers.delete("X-Jungsi-Relay-Token");
  await fails(
    () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: true }),
    "relay_authentication_failed",
    403,
  );
  equal(f.calls, []);
});
Deno.test("wrong relay and duplicate joined relay fail", async () => {
  for (const value of [RELAY.slice(0, -1) + "0", RELAY + "," + RELAY]) {
    const f = fixture();
    f.headers.set("X-Jungsi-Relay-Token", value);
    await fails(
      () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: true }),
      "relay_authentication_failed",
      403,
    );
    equal(f.calls, []);
  }
});
Deno.test("missing mandatory relay configuration fails closed", async () => {
  const f = fixture();
  await fails(
    () => authorizeRelayed(f.headers, new RelayBoundary(null), f.ports, NOW, { paid: false }),
    "security_policy_unavailable",
    503,
  );
  equal(f.calls, []);
});
Deno.test("relay does not establish user or accept API key", async () => {
  for (const token of ["SYNTHETIC-INVALID", "sb_publishable_SYNTHETIC", "sb_secret_SYNTHETIC"]) {
    const f = fixture();
    f.headers.set("Authorization", "Bearer " + token);
    await fails(
      () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: false }),
      "authentication_required",
      401,
    );
    assert(!f.calls.includes("current entitlement"));
  }
});
Deno.test("expired verified JWT is rejected before entitlement", async () => {
  const f = fixture();
  f.ports.sessions.verifyUserBearer = () =>
    Promise.resolve({ subjectId: "SYNTHETIC-SUBJECT", expiresAtUtc: NOW });
  await fails(
    () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: false }),
    "authentication_required",
    401,
  );
  equal(f.calls, []);
});
Deno.test("valid request checks current entitlement then owner", async () => {
  const f = fixture();
  await authorizeRelayed(f.headers, f.relay, f.ports, NOW, {
    paid: true,
    reportId: "SYNTHETIC-REPORT",
    confirmed: true,
  });
  equal(f.calls, ["Auth", "current entitlement", "owner"]);
});
Deno.test("current paid revocation is checked on every call", async () => {
  const f = fixture();
  await authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: true });
  f.ports.entitlements.current = () => Promise.resolve({ tier: "standard", paidUntilUtc: null });
  await fails(
    () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: true }),
    "paid_required",
    403,
  );
});
Deno.test("paid expiration at UTC boundary fails", async () => {
  const f = fixture();
  f.ports.entitlements.current = () => Promise.resolve({ tier: "paid", paidUntilUtc: NOW });
  await fails(
    () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: true }),
    "paid_required",
    403,
  );
});
Deno.test("standard member can use standard operation", async () => {
  const f = fixture();
  f.ports.entitlements.current = () => Promise.resolve({ tier: "standard", paidUntilUtc: null });
  equal(
    (await authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: false })).subjectId,
    "SYNTHETIC-SUBJECT",
  );
});
Deno.test("owner mismatch does not disclose another report", async () => {
  const f = fixture();
  f.ports.reports.find = () => Promise.resolve({ ownerId: "SYNTHETIC-OTHER", confirmed: true });
  await fails(
    () =>
      authorizeRelayed(f.headers, f.relay, f.ports, NOW, {
        paid: true,
        reportId: "SYNTHETIC-REPORT",
      }),
    "report_not_found",
    404,
  );
});
Deno.test("unconfirmed report is 409", async () => {
  const f = fixture();
  f.ports.reports.find = () => Promise.resolve({ ownerId: "SYNTHETIC-SUBJECT", confirmed: false });
  await fails(
    () =>
      authorizeRelayed(f.headers, f.relay, f.ports, NOW, {
        paid: true,
        reportId: "SYNTHETIC-REPORT",
        confirmed: true,
      }),
    "score_confirmation_required",
    409,
  );
});
Deno.test("provider failure is safe 503 without raw exception", async () => {
  const f = fixture();
  f.ports.entitlements.current = () => Promise.reject(new Error("SYNTHETIC-PRIVATE-DETAIL"));
  const e = await fails(
    () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: true }),
    "entitlement_unavailable",
    503,
  );
  const response = safeFailure(e, "SYNTHETIC-REQUEST");
  equal(response.status, 503);
  equal(response.headers.get("Cache-Control"), "no-store");
  equal(await response.json(), {
    status: "error",
    error: { code: "entitlement_unavailable" },
    request_id: "SYNTHETIC-REQUEST",
  });
});
Deno.test("unknown error code cannot appear in response", async () => {
  const response = safeFailure(
    new AccessError("SYNTHETIC-PRIVATE-DETAIL", 503),
    "SYNTHETIC-REQUEST",
  );
  equal((await response.json()).error.code, "backend_dependency_unavailable");
});

Deno.test("owner-required operation cannot skip a missing report ID", async () => {
  const f = fixture();
  await fails(
    () => authorizeRelayed(f.headers, f.relay, f.ports, NOW, { paid: true, reportOwner: true }),
    "report_required",
    400,
  );
  assert(!f.calls.includes("owner"));
});
Deno.test("malformed trusted report result fails with 503", async () => {
  const f = fixture();
  f.ports.reports.find = () => Promise.resolve({ ownerId: "", confirmed: true });
  await fails(
    () =>
      authorizeRelayed(f.headers, f.relay, f.ports, NOW, {
        paid: true,
        reportId: "SYNTHETIC-REPORT",
      }),
    "invalid_repository_result",
    503,
  );
});
