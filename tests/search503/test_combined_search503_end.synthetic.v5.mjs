/** No network, DB, Storage, file output or actual users. */
import assert from "node:assert/strict";
import { currentCatalogCompositionFixture } from "./synthetic_combined503_composition.ts";
import {
  ObservedCurrentPublicCatalogService,
  SearchDiagnostic,
} from "../../supabase/functions/_shared/search_failure_diagnostic.ts";
import { CurrentPublicCatalogCursor } from "../../supabase/functions/_shared/current_public_catalog.ts";
import routeCatalog from "../../src/jungsi_touch/application/route_catalog.json" with {
  type: "json",
};
import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { createApiHandler } from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import {
  RelayBoundary,
  safeFailure,
} from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { syntheticApiPolicies } from "./synthetic_api_contract.ts";
import { observeRuntimeResponse } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import { createCombinedPolicyCatalogService } from "../../supabase/functions/_shared/combined_policy_catalog_runtime.ts";
import { SearchFailureCorrelation } from "../../supabase/functions/_shared/jungsi/infrastructure/search503_correlation.ts";
import { SERVICE_END_UTC_MICROS } from "../../supabase/functions/_shared/jungsi/application/service_end_admission.ts";

function test(name, fn) {
  Deno.test(name, fn);
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const id = "a".repeat(32), forged = "f".repeat(32);
const event = (phase = "publication", failure = "publication_unapproved") => ({
  event: "current_public_search_failure_v1",
  operation: "offerings.search",
  phase,
  failure,
});
const makeResponse = (bodyId = id, headerId = id, status = 503) =>
  new Response(
    JSON.stringify({
      status: "error",
      error: { code: "backend_dependency_unavailable" },
      request_id: bodyId,
    }),
    { status, headers: { "X-Request-ID": headerId, "Content-Type": "application/json" } },
  );
const NOW = 1700000000000000n, OWNER = "00000000-0000-0000-0000-000000000001";
const relay = "SYNTHETIC-RELAY-" + "a".repeat(48);
function request() {
  return new Request(
    "https://synthetic.invalid/api/v1/offerings/search?academic_year=2027&limit=30",
    {
      headers: {
        "Authorization": "Bearer SYNTHETIC",
        "X-Jungsi-Relay-Token": relay,
        "X-Request-ID": forged,
      },
    },
  );
}
function oneHandler(failure, sink) {
  const corr = new SearchFailureCorrelation(sink), clock = { nowUtc: () => NOW };
  let sqlCalled = false, controlsCalled = false;
  const catalog = createCombinedPolicyCatalogService(
    {},
    clock,
    () => {
      sqlCalled = true;
      throw new Error("unexpected SQL");
    },
    { get: () => undefined },
    {
      binding: () => Promise.reject(failure),
      controls: () => {
        controlsCalled = true;
        return Promise.reject(new Error("unexpected controls"));
      },
      searchDiagnostic: corr.capture,
    },
  );
  const ports = {
    relay: new RelayBoundary(relay),
    clock,
    sessions: {
      verifyUserBearer: () =>
        Promise.resolve({
          subjectId: OWNER,
          expiresAtUtc: NOW + 1000000n,
          assuranceLevel: "aal1",
          accountStatus: "active",
        }),
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) =>
        Promise.resolve({
          authority: "public.jeongsi_passes",
          metadataVerified: true,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: NOW + 500000n,
        }),
    },
    reports: { lookupAccess: () => Promise.resolve(null) },
    authorities: { readCurrent: () => Promise.resolve(null) },
    resources: { readScope: () => Promise.resolve(null) },
    projection: { project: (_id, _tier, value) => value },
    budget: { run: async (_r, work) => await work() },
    business: { execute: async (r) => await catalog.execute(r) },
  };
  return {
    corr,
    handler: createApiHandler(syntheticApiPolicies(), ports),
    getCalls: () => ({ sqlCalled, controlsCalled }),
  };
}

await test("combined candidate handler response, existing observation and catalog trace use the same server ID", async () => {
  const diagnostics = [], observations = [];
  const f = oneHandler(
    new AccessError("operation_scope_not_approved", 503),
    (e) => diagnostics.push(e),
  );
  const response = await f.handler(request());
  f.corr.finish(response);
  const returned = await observeRuntimeResponse(
    (e) => observations.push(e),
    response,
    "offerings.search",
    "business",
    id,
  );
  await tick();
  assert.equal(returned, response);
  assert.equal(response.status, 503);
  const data = await response.clone().json(), serverId = response.headers.get("X-Request-ID");
  assert.match(serverId, /^[a-f0-9]{32}$/);
  assert.notEqual(serverId, forged);
  assert.equal(data.request_id, serverId);
  assert.equal(data.error.code, "operation_scope_not_approved");
  assert.equal(observations.length, 1);
  assert.equal(observations[0].request_id, serverId);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].request_id, serverId);
  assert.equal(diagnostics[0].event, "current_public_search_failure_v2");
  assert.equal(diagnostics[0].phase, "publication");
  assert.equal(diagnostics[0].failure, "operation_scope_unapproved");
  assert.deepEqual(f.getCalls(), { sqlCalled: false, controlsCalled: false });
});

await test("three concurrent requests do not mix response IDs, observations or failure categories", async () => {
  const diagnostics = [], observations = [];
  const failures = [
    "operation_scope_not_approved",
    "current_catalog_publication_unapproved",
    "security_policy_unavailable",
  ];
  const result = await Promise.all(failures.map(async (code) => {
    const f = oneHandler(new AccessError(code, 503), (e) => diagnostics.push(e));
    const response = await f.handler(request());
    f.corr.finish(response);
    await observeRuntimeResponse(
      (e) => observations.push(e),
      response,
      "offerings.search",
      "business",
      id,
    );
    return { code, id: response.headers.get("X-Request-ID"), body: await response.clone().json() };
  }));
  await tick();
  assert.equal(new Set(result.map((x) => x.id)).size, 3);
  assert.equal(diagnostics.length, 3);
  assert.equal(observations.length, 3);
  const expected = {
    operation_scope_not_approved: "operation_scope_unapproved",
    current_catalog_publication_unapproved: "publication_unapproved",
    security_policy_unavailable: "security_guard_unavailable",
  };
  for (const r of result) {
    assert.notEqual(r.id, forged);
    assert.equal(r.id, r.body.request_id);
    assert.equal(diagnostics.find((x) => x.request_id === r.id)?.failure, expected[r.code]);
    assert.ok(observations.some((x) => x.request_id === r.id));
  }
});

await test("tampered response header does not match server body and cannot emit", async () => {
  const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
  c.capture(event());
  const original = safeFailure(new Error("SYNTHETIC_PRIVATE"), id),
    h = new Headers(original.headers);
  h.set("X-Request-ID", forged);
  const changed = new Response(await original.text(), { status: 503, headers: h });
  c.finish(changed);
  await tick();
  assert.deepEqual(seen, []);
});

await test("missing, invalid and mismatched response identifiers emit nothing", async () => {
  for (
    const response of [
      null,
      new Response("{}", { status: 503 }),
      makeResponse(id, "invalid"),
      makeResponse(id, forged),
    ]
  ) {
    const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
    c.capture(event());
    c.finish(response);
    await tick();
    assert.deepEqual(seen, []);
  }
});

await test("early error without a captured business event cannot emit or accept input ID", async () => {
  const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
  c.finish(safeFailure(new Error("SYNTHETIC"), id));
  await tick();
  assert.deepEqual(seen, []);
});

await test("non-503 response, invalid body, huge body and missing body cannot emit", async () => {
  const large = JSON.stringify({ status: "error", request_id: id, pad: "x".repeat(4096) });
  for (
    const response of [
      makeResponse(id, id, 200),
      new Response("not JSON", { status: 503, headers: { "X-Request-ID": id } }),
      new Response(large, { status: 503, headers: { "X-Request-ID": id } }),
      new Response(null, { status: 503, headers: { "X-Request-ID": id } }),
    ]
  ) {
    const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
    c.capture(event());
    c.finish(response);
    await tick();
    assert.deepEqual(seen, []);
  }
});

await test("captured event is fixed, immutable, bounded and emits at most once", async () => {
  const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
  c.capture(event());
  c.capture(event("catalog_read", "state_unapproved"));
  const r = makeResponse();
  c.finish(r);
  c.finish(r);
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].phase, "publication");
  assert.equal(Object.isFrozen(seen[0]), true);
  assert.equal(seen[0].final_error_class, "backend_dependency_unavailable");
  assert.equal(seen[0].event, "current_public_search_failure_v2");
  assert.deepEqual(Object.keys(seen[0]).sort(), [
    "event",
    "failure",
    "final_error_class",
    "operation",
    "phase",
    "request_id",
  ]);
});

await test("untrusted event getters and extra fields cannot leak into output", async () => {
  let getter = false;
  const bad = event();
  Object.defineProperty(bad, "failure", {
    enumerable: true,
    get() {
      getter = true;
      throw new Error("SYNTHETIC_PRIVATE");
    },
  });
  for (
    const input of [bad, { ...event(), private: "SYNTHETIC_PRIVATE" }, {
      ...event(),
      failure: "SYNTHETIC_PRIVATE",
    }]
  ) {
    const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
    c.capture(input);
    c.finish(makeResponse());
    await tick();
    assert.deepEqual(seen, []);
  }
  assert.equal(getter, false);
});

await test("sink failure or pending work cannot change server response", async () => {
  for (
    const sink of [
      () => {
        throw new Error("SYNTHETIC_PRIVATE");
      },
      () => Promise.reject(new Error("SYNTHETIC_PRIVATE")),
      () => new Promise(() => {}),
    ]
  ) {
    const c = new SearchFailureCorrelation(sink), r = makeResponse();
    c.capture(event());
    assert.equal(c.finish(r), undefined);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).request_id, id);
    await tick();
  }
});

await test("pending response clone never delays or fabricates an observation", async () => {
  const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
  c.capture(event());
  const pending = new Response(
    new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
    }),
    { status: 503, headers: { "X-Request-ID": id } },
  );
  assert.equal(c.finish(pending), undefined);
  await tick();
  assert.deepEqual(seen, []);
});
await test("runtime fetch copy ties its actual handler response to diagnostic and existing observer", async () => {
  const f = await currentCatalogCompositionFixture(
    (data, clock, current, context) =>
      new ObservedCurrentPublicCatalogService(
        data,
        current,
        clock,
        new CurrentPublicCatalogCursor(new Uint8Array(32).fill(7)),
        new SearchDiagnostic(context.searchDiagnostic),
      ),
    routeCatalog,
    schemas,
  );
  const diagnostics = [], previous = console.info;
  console.info = (text) => diagnostics.push(JSON.parse(text));
  try {
    await f.run(async () => {
      const requests = Array.from({ length: 3 }, () => {
        const headers = new Headers(f.request().headers);
        headers.set("X-Request-ID", forged);
        return new Request(
          "https://synthetic.invalid/api/v1/offerings/search?academic_year=2027&limit=30",
          { headers },
        );
      });
      const responses = await Promise.all(requests.map((r) => f.api.fetch(r)));
      await tick();
      assert.deepEqual(responses.map((r) => r.status), [503, 503, 503]);
      const ids = responses.map((r) => r.headers.get("X-Request-ID"));
      assert.equal(new Set(ids).size, 3);
      assert.equal(diagnostics.length, 3);
      assert.equal(f.observations.length, 3);
      for (let i = 0; i < responses.length; i++) {
        const body = await responses[i].clone().json();
        assert.notEqual(ids[i], forged);
        assert.equal(body.request_id, ids[i]);
        assert.equal(body.error.code, "backend_dependency_unavailable");
        assert.ok(f.observations.some((x) => x.request_id === ids[i] && x.stage === "business"));
        assert.ok(
          diagnostics.some((x) =>
            x.request_id === ids[i] && x.phase === "catalog_read" && x.failure === "unclassified"
          ),
        );
      }
    });
  } finally {
    console.info = previous;
  }
});
await test("actual runtime early 503 has no search event", async () => {
  const f = await currentCatalogCompositionFixture(
    (data, clock, current, context) =>
      new ObservedCurrentPublicCatalogService(
        data,
        current,
        clock,
        new CurrentPublicCatalogCursor(new Uint8Array(32).fill(7)),
        new SearchDiagnostic(context.searchDiagnostic),
      ),
    routeCatalog,
    schemas,
  );
  const diagnostics = [], previous = console.info;
  console.info = (text) => diagnostics.push(JSON.parse(text));
  try {
    await f.run(async () => {
      const h = new Headers(f.request().headers);
      h.set("X-Request-ID", forged);
      f.api.config.environment = { get: () => undefined };
      const response = await f.api.fetch(
        new Request(
          "https://synthetic.invalid/api/v1/offerings/search?academic_year=2027&limit=30",
          { headers: h },
        ),
      );
      await tick();
      assert.equal(response.status, 503);
      assert.notEqual(response.headers.get("X-Request-ID"), forged);
      assert.equal(
        (await response.clone().json()).request_id,
        response.headers.get("X-Request-ID"),
      );
      assert.equal(diagnostics.length, 0);
      assert.equal(f.observations.length, 1);
    });
  } finally {
    console.info = previous;
  }
});
await test("tampered error body does not match response header", async () => {
  const seen = [], c = new SearchFailureCorrelation((e) => seen.push(e));
  c.capture(event());
  c.finish(makeResponse(forged, id));
  await tick();
  assert.deepEqual(seen, []);
});

function observedCatalog(data, clock, current, context) {
  return new ObservedCurrentPublicCatalogService(
    data,
    current,
    clock,
    new CurrentPublicCatalogCursor(new Uint8Array(32).fill(7)),
    new SearchDiagnostic(context.searchDiagnostic),
  );
}
function searchRequest(f, withRelay = true) {
  const headers = new Headers(f.request().headers);
  headers.set("X-Request-ID", forged);
  if (!withRelay) headers.delete("X-Jungsi-Relay-Token");
  return new Request(
    "https://synthetic.invalid/api/v1/offerings/search?academic_year=2027&limit=30",
    { headers },
  );
}
await test("end boundary blocks search before catalog or diagnostic", async () => {
  const f = await currentCatalogCompositionFixture(observedCatalog, routeCatalog, schemas),
    entries = [],
    old = console.info;
  console.info = (x) => entries.push(JSON.parse(x));
  try {
    await f.run(async () => {
      f.state.now = SERVICE_END_UTC_MICROS;
      const r = await f.api.fetch(searchRequest(f));
      await tick();
      const body = await r.json();
      assert.equal(r.status, 403);
      assert.equal(body.error.code, "service_ended");
      assert.equal(body.request_id, r.headers.get("X-Request-ID"));
      assert.notEqual(body.request_id, forged);
      assert.equal(f.calls.restrict, 0);
      assert.equal(f.calls.budget, 0);
      assert.equal(entries.length, 0);
    });
  } finally {
    console.info = old;
  }
});
await test("invalid relay takes precedence over cutoff and emits no search trace", async () => {
  const f = await currentCatalogCompositionFixture(observedCatalog, routeCatalog, schemas),
    entries = [],
    old = console.info;
  console.info = (x) => entries.push(JSON.parse(x));
  try {
    await f.run(async () => {
      f.state.now = SERVICE_END_UTC_MICROS;
      const r = await f.api.fetch(searchRequest(f, false));
      await tick();
      const body = await r.json();
      assert.equal(r.status, 403);
      assert.equal(body.error.code, "relay_authentication_failed");
      assert.equal(f.calls.restrict, 0);
      assert.equal(f.calls.budget, 0);
      assert.equal(entries.length, 0);
    });
  } finally {
    console.info = old;
  }
});
await test("one microsecond before cutoff reaches catalog and correlates mapped 503", async () => {
  const f = await currentCatalogCompositionFixture(observedCatalog, routeCatalog, schemas),
    entries = [],
    old = console.info;
  console.info = (x) => entries.push(JSON.parse(x));
  try {
    await f.run(async () => {
      f.state.now = SERVICE_END_UTC_MICROS - 1n;
      const r = await f.api.fetch(searchRequest(f));
      await tick();
      const body = await r.json(), id = r.headers.get("X-Request-ID");
      assert.equal(r.status, 503);
      assert.equal(body.error.code, "backend_dependency_unavailable");
      assert.equal(body.request_id, id);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].request_id, id);
      assert.equal(entries[0].operation, "offerings.search");
      assert.ok(f.calls.restrict > 0);
    });
  } finally {
    console.info = old;
  }
});
await test("request admitted before cutoff retains original business 503 after crossing", async () => {
  const factory = (data, clock, current, context) => {
    current.search = () => {
      f.state.now = SERVICE_END_UTC_MICROS;
      throw new Error("SYNTHETIC_SEARCH_FAILURE");
    };
    return observedCatalog(data, clock, current, context);
  };
  const f = await currentCatalogCompositionFixture(factory, routeCatalog, schemas);
  const entries = [], old = console.info;
  console.info = (x) => entries.push(JSON.parse(x));
  try {
    await f.run(async () => {
      f.state.now = SERVICE_END_UTC_MICROS - 1n;
      const r = await f.api.fetch(searchRequest(f));
      await tick();
      const body = await r.json(), id = r.headers.get("X-Request-ID");
      assert.equal(f.state.now, SERVICE_END_UTC_MICROS);
      assert.equal(r.status, 503);
      assert.equal(body.error.code, "backend_dependency_unavailable");
      assert.equal(body.request_id, id);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].request_id, id);
    });
  } finally {
    console.info = old;
  }
});
await test("live remains minimal and readiness closes after cutoff", async () => {
  const f = await currentCatalogCompositionFixture(observedCatalog, routeCatalog, schemas),
    entries = [],
    old = console.info;
  console.info = (x) => entries.push(JSON.parse(x));
  try {
    await f.run(async () => {
      f.state.now = SERVICE_END_UTC_MICROS;
      const live = await f.api.fetch(new Request("https://synthetic.invalid/health/live"));
      const liveBody = await live.json();
      assert.equal(live.status, 200);
      assert.deepEqual(Object.keys(liveBody).sort(), ["now", "server_timezone", "status"]);
      assert.equal(liveBody.status, "alive");
      const h = new Headers(f.request().headers);
      const ready = await f.api.fetch(
        new Request("https://synthetic.invalid/health/ready", { headers: h }),
      );
      assert.equal(ready.status, 403);
      assert.equal((await ready.json()).error.code, "service_ended");
      await tick();
      assert.equal(entries.length, 0);
    });
  } finally {
    console.info = old;
  }
});

await test("runtime and real combined factory preserve allowed and masked 503 mapping", async () => {
  for (
    const [code, expectedCode, expectedFailure] of [
      [
        "operation_scope_not_approved",
        "operation_scope_not_approved",
        "operation_scope_unapproved",
      ],
      ["current_catalog_state_unapproved", "backend_dependency_unavailable", "state_unapproved"],
    ]
  ) {
    let bindings = 0, sqlCalls = 0, controls = 0;
    const factory = (data, clock, _current, context) =>
      createCombinedPolicyCatalogService(
        data,
        clock,
        () => {
          sqlCalls++;
          throw new Error("unexpected SQL");
        },
        { get: () => undefined },
        {
          binding: () => {
            bindings++;
            return Promise.reject(new AccessError(code, 503));
          },
          controls: () => {
            controls++;
            return Promise.reject(new Error("unexpected controls"));
          },
          searchDiagnostic: context.searchDiagnostic,
        },
      );
    const f = await currentCatalogCompositionFixture(factory, routeCatalog, schemas),
      entries = [],
      old = console.info;
    console.info = (x) => entries.push(JSON.parse(x));
    try {
      await f.run(async () => {
        const r = await f.api.fetch(searchRequest(f));
        await tick();
        const body = await r.json(), id = r.headers.get("X-Request-ID");
        assert.equal(r.status, 503);
        assert.equal(body.error.code, expectedCode);
        assert.equal(body.request_id, id);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].failure, expectedFailure);
        assert.equal(entries[0].phase, "publication");
        assert.equal(entries[0].request_id, id);
        assert.equal(bindings, 1);
        assert.equal(sqlCalls, 0);
        assert.equal(controls, 0);
      });
    } finally {
      console.info = old;
    }
  }
});
await test("in-flight search and post-cutoff request stay independent", async () => {
  let release, entered;
  const ready = new Promise((resolve) => entered = resolve),
    gate = new Promise((resolve) => release = resolve);
  const factory = (data, clock, current, context) => {
    current.search = async () => {
      entered();
      await gate;
      throw new Error("SYNTHETIC_SEARCH_FAILURE");
    };
    return observedCatalog(data, clock, current, context);
  };
  const f = await currentCatalogCompositionFixture(factory, routeCatalog, schemas),
    entries = [],
    old = console.info;
  console.info = (x) => entries.push(JSON.parse(x));
  try {
    await f.run(async () => {
      f.state.now = SERVICE_END_UTC_MICROS - 1n;
      const pending = f.api.fetch(searchRequest(f));
      await ready;
      f.state.now = SERVICE_END_UTC_MICROS;
      const later = await f.api.fetch(searchRequest(f));
      release();
      const earlier = await pending;
      await tick();
      const a = await earlier.json(), b = await later.json();
      const aId = earlier.headers.get("X-Request-ID"), bId = later.headers.get("X-Request-ID");
      assert.equal(earlier.status, 503);
      assert.equal(a.error.code, "backend_dependency_unavailable");
      assert.equal(a.request_id, aId);
      assert.equal(later.status, 403);
      assert.equal(b.error.code, "service_ended");
      assert.equal(b.request_id, bId);
      assert.notEqual(aId, bId);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].request_id, aId);
    });
  } finally {
    console.info = old;
  }
});
