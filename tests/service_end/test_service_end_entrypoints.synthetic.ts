import { createSupabaseApiIngress } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_api_ingress.ts";
import { currentPublicResponseSchemas } from "../../supabase/functions/_shared/current_public_catalog.ts";
import {
  createCombinedPolicyCatalogService,
  createMemberShortlistCatalogService,
} from "../../supabase/functions/_shared/combined_policy_catalog_runtime.ts";
import { createReadViewCatalogService } from "../../supabase/functions/_shared/read_view_catalog_runtime.ts";
import {
  memberShortlistPolicies,
  memberShortlistResponseSchemas,
} from "../../supabase/functions/_shared/jungsi/application/member_shortlist_schema.ts";
import {
  NativeRuntimeApi,
  type RuntimeRoutePolicy,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import { NativeProfessionalRuntime } from "../../supabase/functions/_shared/jungsi/infrastructure/professional_runtime.ts";
import { PROFESSIONAL_CONTRACT } from "../../supabase/functions/_shared/jungsi/application/professional_contract.generated.ts";
import routeCatalog from "../../src/jungsi_touch/application/route_catalog.json" with {
  type: "json",
};
import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import {
  admissionMicros,
  admissionMillis,
  assertAdmissionOrConsume,
  issueAdmissionPermit,
  SERVICE_END_UTC_MICROS as END,
} from "../../supabase/functions/_shared/jungsi/application/service_end_admission.ts";
const RELAY = "SYNTHETIC-ONLY-" + "x".repeat(36);
function equal(a: unknown, b: unknown) {
  if (a !== b) throw new Error("synthetic assertion: " + String(a) + " !== " + String(b));
}
function req(path: string, method = "GET", relay = true) {
  return new Request("https://synthetic.invalid" + path, {
    method,
    headers: relay ? { "X-Jungsi-Relay-Token": RELAY } : {},
  });
}
function runtimes(clock: () => bigint) {
  let poolCalls = 0, fetchCalls = 0;
  const environment = { get: (name: string) => name === "JUNGSI_RELAY_TOKEN" ? RELAY : undefined };
  const createPool = () => {
    poolCalls++;
    throw new Error("synthetic unexpected pool");
  };
  const fetcher = (() => {
    fetchCalls++;
    throw new Error("synthetic unexpected fetch");
  }) as typeof fetch;
  const personal = new NativeRuntimeApi({
    environment,
    policies: routeCatalog.operations as readonly RuntimeRoutePolicy[],
    responseSchemas: schemas,
    createPool,
    fetcher,
    clock: { nowUtc: clock },
  });
  const pro = new NativeProfessionalRuntime({
    environment,
    responseSchemas: schemas,
    createPool,
    fetcher,
    clock: { nowUtc: clock },
  });
  return { personal, pro, calls: () => [poolCalls, fetchCalls] };
}
async function ended(response: Response) {
  equal(response.status, 403);
  const b = await response.json();
  equal(b.error.code, "service_ended");
  equal(response.headers.get("Cache-Control")?.includes("no-store"), true);
}
Deno.test("UTC microsecond and millisecond deadline are exclusive; invalid clocks fail closed", () => {
  equal(admissionMicros(END - 1n), "open");
  equal(admissionMicros(END), "ended");
  equal(admissionMillis(Number(END / 1000n) - 1), "open");
  equal(admissionMillis(Number(END / 1000n)), "ended");
  for (const v of [null, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    equal(admissionMillis(v), "invalid_clock");
  }
  for (const v of [null, -1n, 0, NaN]) equal(admissionMicros(v), "invalid_clock");
});
Deno.test("all 21 professional routes stop after relay and before settings pool and work", async () => {
  const f = runtimes(() => END);
  equal(PROFESSIONAL_CONTRACT.routes.length, 21);
  for (const route of PROFESSIONAL_CONTRACT.routes) {
    const path = "/functions/v1/jungsi-pro-api" + route.path.replace(/\{[^}]+\}/g, "SYNTHETIC-id");
    await ended(await f.pro.fetch(req(path, route.method)));
  }
  equal(f.calls()[0], 0);
  equal(f.calls()[1], 0);
});
Deno.test("professional cutoff preserves relay order and open admission reaches independent settings failure", async () => {
  let clock = END;
  const f = runtimes(() => clock);
  let r = await f.pro.fetch(req("/functions/v1/jungsi-pro-api/api/v1/pro/session", "GET", false));
  equal(r.status, 403);
  equal((await r.json()).error.code, "relay_authentication_failed");
  clock = END - 1n;
  r = await f.pro.fetch(req("/functions/v1/jungsi-pro-api/api/v1/pro/session"));
  equal(r.status, 503);
  equal((await r.json()).error.code, "security_policy_unavailable");
  equal(f.calls()[0], 0);
  equal(f.calls()[1], 0);
});
Deno.test("health live remains minimal while ready is blocked at cutoff before SQL or fetch", async () => {
  const f = runtimes(() => END);
  const live = await f.personal.fetch(req("/health/live", "GET", false));
  equal(live.status, 200);
  const body = await live.json();
  equal(
    JSON.stringify(Object.keys(body).sort()),
    JSON.stringify(["now", "server_timezone", "status"]),
  );
  equal(body.status, "alive");
  equal(body.server_timezone, "UTC");
  await ended(await f.personal.fetch(req("/health/ready")));
  equal(f.calls()[0], 0);
  equal(f.calls()[1], 0);
});
Deno.test("health live works before cutoff; health ready still authenticates its relay first", async () => {
  let clock = END - 1n;
  const f = runtimes(() => clock);
  equal((await f.personal.fetch(req("/health/live"))).status, 200);
  clock = END;
  const r = await f.personal.fetch(req("/health/ready", "GET", false));
  equal(r.status, 403);
  equal((await r.json()).error.code, "relay_authentication_failed");
  equal(f.calls()[0], 0);
  equal(f.calls()[1], 0);
});
Deno.test("unknown and existing error masking retain baseline behavior", async () => {
  const f = runtimes(() => END);
  const result = await f.personal.fetch(req("/api/v1/not-a-real-route"));
  equal(result.status, 503);
  equal((await result.json()).error.code, "security_policy_unavailable");
});

Deno.test("all four native entry configurations connect to the candidate gate through ingress", async () => {
  const configs = [
    {
      readViewExtensions: undefined,
      memberShortlistExtensions: undefined,
      candidateCatalog: undefined,
      policies: routeCatalog.operations as readonly RuntimeRoutePolicy[],
      responseSchemas: schemas,
    },
    {
      readViewExtensions: true as const,
      memberShortlistExtensions: undefined,
      candidateCatalog: createCombinedPolicyCatalogService,
      policies: routeCatalog.operations as readonly RuntimeRoutePolicy[],
      responseSchemas: currentPublicResponseSchemas(schemas),
    },
    {
      readViewExtensions: true as const,
      memberShortlistExtensions: undefined,
      candidateCatalog: createReadViewCatalogService,
      policies: routeCatalog.operations as readonly RuntimeRoutePolicy[],
      responseSchemas: currentPublicResponseSchemas(schemas),
    },
    {
      readViewExtensions: true as const,
      memberShortlistExtensions: true as const,
      candidateCatalog: createMemberShortlistCatalogService,
      policies: memberShortlistPolicies(
        routeCatalog.operations as readonly RuntimeRoutePolicy[],
      ) as readonly RuntimeRoutePolicy[],
      responseSchemas: memberShortlistResponseSchemas(currentPublicResponseSchemas(schemas)),
    },
  ];
  for (const config of configs) {
    let pools = 0;
    const api = new NativeRuntimeApi({
      ...config,
      environment: { get: (key: string) => key === "JUNGSI_RELAY_TOKEN" ? RELAY : undefined },
      createPool: () => {
        pools++;
        throw new Error("synthetic no pool");
      },
      clock: { nowUtc: () => END },
    });
    const ingress = createSupabaseApiIngress(api.fetch);
    const live = await ingress(req("/jungsi-api/health/live", "GET", false));
    equal(live.status, 200);
    const body = await live.json();
    equal(
      JSON.stringify(Object.keys(body).sort()),
      JSON.stringify(["now", "server_timezone", "status"]),
    );
    await ended(await ingress(req("/jungsi-api/health/ready")));
    await ended(await ingress(req("/jungsi-api/api/v1/me")));
    equal(pools, 0);
  }
});

Deno.test("single-use permits are bound to a request and cannot be forged or replayed", () => {
  const first = req("/api/v1/me"), second = req("/api/v1/me");
  const token = issueAdmissionPermit(END - 1n, first);
  for (const bad of [{}, token]) {
    let rejected = false;
    try {
      assertAdmissionOrConsume(() => END, second, bad);
    } catch {
      rejected = true;
    }
    equal(rejected, true);
  }
  assertAdmissionOrConsume(() => END, first, token);
  let replay = false;
  try {
    assertAdmissionOrConsume(() => END, first, token);
  } catch {
    replay = true;
  }
  equal(replay, true);
});
Deno.test("concurrent request permits stay distinct across 40 synthetic admissions", async () => {
  const requests = Array.from({ length: 40 }, (_, i) => req("/api/v1/me?synthetic=" + i));
  const tokens = await Promise.all(
    requests.map((r) => Promise.resolve(issueAdmissionPermit(END - 1n, r))),
  );
  await Promise.all(requests.map(async (r, i) => {
    let rejected = false;
    try {
      assertAdmissionOrConsume(() => END, r, tokens[(i + 1) % tokens.length]);
    } catch {
      rejected = true;
    }
    equal(rejected, true);
    assertAdmissionOrConsume(() => END, r, tokens[i]);
    await Promise.resolve();
  }));
});
