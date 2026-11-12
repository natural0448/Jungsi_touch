import {
  type SafeProfileLookupObservation,
  SupabaseNativeAuth,
} from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_auth.ts";
import {
  type AdminExceptionReason,
  bearerSha256,
  BoundVerifiedSessionProvider,
} from "../../supabase/functions/_shared/jungsi/infrastructure/verified_session.ts";
import {
  readSessionSnapshot,
  sessionDto,
} from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import { assert, equal } from "../edge/fixture.ts";

const uid = "00000000-0000-0000-0000-000000000001";
const now = 1700000000000000n;
const config = {
  url: "https://synthetic.supabase.co",
  publishableKey: "sb_publishable_SYNTHETIC",
};
function token(aal: "aal1" | "aal2" = "aal2") {
  const payload = btoa(
    JSON.stringify({
      sub: uid,
      exp: 1700000060,
      iss: config.url + "/auth/v1",
      aal,
    }),
  )
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "e30." + payload + ".SYNTHETIC";
}
function testAuth(
  response: () => Response | Promise<Response>,
  lookup: SafeProfileLookupObservation[],
  failObserver = false,
) {
  const fetcher: typeof fetch = (input) => {
    const url = String(input);
    return Promise.resolve(
      url.includes("/auth/v1/user") ? Response.json({ id: uid }) : response(),
    );
  };
  return new SupabaseNativeAuth(config, fetcher, (v) => {
    lookup.push(v);
    if (failObserver) throw new Error("SYNTHETIC_SECRET");
  });
}
async function sample(
  response: () => Response | Promise<Response>,
  aal: "aal1" | "aal2" = "aal2",
  paid = false,
  failObserver = false,
) {
  const lookups: SafeProfileLookupObservation[] = [],
    reasons: AdminExceptionReason[] = [];
  const auth = testAuth(response, lookups, failObserver);
  const provider = new BoundVerifiedSessionProvider(auth, auth, (reason) => {
    reasons.push(reason);
    if (failObserver) throw new Error("SYNTHETIC_SECRET");
  });
  const snapshot = await readSessionSnapshot(token(aal), provider, {
    readCurrent: (subjectId, evaluatedAtUtc) =>
      Promise.resolve({
        authority: "public.jeongsi_passes" as const,
        metadataVerified: true as const,
        subjectId,
        evaluatedAtUtc,
        paidUntilUtc: paid ? now + 1000000n : null,
      }),
  }, now);
  equal(lookups.length, 1);
  const o = lookups[0];
  equal(Object.keys(o).sort(), [
    "elapsed_ms",
    "http_status",
    "outcome",
    "row_count",
  ]);
  assert(
    Number.isInteger(o.elapsed_ms) && o.elapsed_ms >= 0 &&
      o.elapsed_ms <= 60000,
  );
  const serial = JSON.stringify({ lookup: o, reasons });
  assert(
    !serial.includes(uid) && !serial.includes(token(aal)) &&
      !serial.includes("SYNTHETIC_SECRET"),
  );
  return { o, reasons, tier: sessionDto(snapshot, now).member_tier };
}
Deno.test("known administrator reasons preserve exact tier conditions", async () => {
  for (
    const [role, status, aal, reason, tier] of [
      ["admin", "active", "aal2", "admin_allowed", "paid"],
      ["admin", "active", "aal1", "aal_not_aal2", "standard"],
      ["admin", "inactive", "aal2", "status_not_active", "standard"],
      ["student", "active", "aal2", "role_not_admin", "standard"],
    ] as const
  ) {
    const r = await sample(() => Response.json([{ role, status }]), aal);
    equal([r.o.outcome, r.o.http_status, r.o.row_count, r.reasons[0], r.tier], [
      "ok",
      200,
      1,
      reason,
      tier,
    ]);
  }
});
Deno.test("transport status, row count, invalid shapes and failures have bounded safe categories", async () => {
  const fixtures: [
    () => Response | Promise<Response>,
    string,
    number | null,
    number | null,
  ][] = [
    [
      () => new Response("SYNTHETIC_SECRET", { status: 503 }),
      "http_status",
      503,
      null,
    ],
    [() => Response.json([]), "invalid_shape", 200, 0],
    [
      () =>
        Response.json([{ role: "admin", status: "active" }, {
          role: "admin",
          status: "active",
        }]),
      "invalid_shape",
      200,
      2,
    ],
    [
      () => Response.json([{ role: "admin", status: "" }]),
      "invalid_status",
      200,
      1,
    ],
    [() => new Response("x".repeat(2049)), "request_failed", 200, null],
    [
      () => {
        throw new Error("SYNTHETIC_SECRET");
      },
      "request_failed",
      null,
      null,
    ],
  ];
  for (const [response, outcome, status, count] of fixtures) {
    const r = await sample(response);
    equal([r.o.outcome, r.o.http_status, r.o.row_count, r.reasons[0], r.tier], [
      outcome,
      status,
      count,
      "profile_unavailable",
      "standard",
    ]);
  }
});
Deno.test("observer exceptions never grant rights or break an existing paid pass", async () => {
  const r = await sample(
    () => new Response("secret", { status: 503 }),
    "aal2",
    true,
    true,
  );
  equal([r.reasons[0], r.tier], ["profile_unavailable", "paid"]);
});
Deno.test("wrong subject or bearer receipts have an explicit safe binding category", async () => {
  const bearer = token();
  const auth = testAuth(
    () => Response.json([{ role: "admin", status: "active" }]),
    [],
  );
  const reasons: AdminExceptionReason[] = [];
  const profiles = {
    readOwnStatus: async () => ({
      verification: "own_profile_same_bearer_publishable_RLS" as const,
      bearerSha256: await bearerSha256(bearer),
      subjectId: "other",
      status: "active",
      role: "admin",
    }),
  };
  const user = await new BoundVerifiedSessionProvider(
    auth,
    profiles,
    (v) => reasons.push(v),
  ).verifyUserBearer(bearer, now);
  assert(user);
  equal([reasons[0], user.accountRole, user.accountStatus], [
    "profile_binding_invalid",
    null,
    null,
  ]);
});
