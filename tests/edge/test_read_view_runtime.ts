/** Explicit candidate-only router and binding checks; no operating installation or private I/O. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type ApiRoutePolicy,
  READ_VIEW_CONSUMER_OPERATION_IDS,
  READ_VIEW_OPERATION_IDS,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { syntheticApiPolicies } from "./synthetic_api_contract.ts";
import {
  SYNTHETIC_RUNTIME_NOW as NOW,
  syntheticRuntimeBinding,
} from "./synthetic_runtime_binding.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
const RELAY = "SYNTHETIC-relay-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  OWNER = "00000000-0000-0000-0000-000000000001";
const extra: ApiRoutePolicy[] = [{
  id: "history.snapshot.head",
  method: "GET",
  path: "/api/v1/admission-history/snapshot/head",
  member_tiers: ["standard", "paid"],
  report_owner: false,
  confirmed_score_profile: false,
}, {
  id: "history.snapshot.read",
  method: "GET",
  path: "/api/v1/admission-history/snapshots/{snapshot_id}",
  member_tiers: ["standard", "paid"],
  report_owner: false,
  confirmed_score_profile: false,
}, {
  id: "report.list-own",
  method: "GET",
  path: "/api/v1/me/reports",
  member_tiers: ["standard", "paid"],
  report_owner: false,
  confirmed_score_profile: false,
}];
function fixture(
  options: {
    extended?: boolean;
    scopeFailure?: boolean;
    notModified?: boolean;
    finalFailure?: boolean;
    expire?: boolean;
  } = {},
) {
  const policies = [...syntheticApiPolicies(), ...(options.extended ? extra : [])],
    expected = policies.map((p) => ({ id: p.id, contract_ref: "SYNTHETIC" })),
    root = {
      type: "object",
      nullable: false,
      properties: { shown: { type: "string", nullable: false } },
      required: ["shown"],
      optional: [],
    };
  const projection = new PublicResponseProjection({
    format: "jungsi.public-response-schemas/v1",
    schemas: { result: root },
    operations: expected.map((p) => ({
      ...p,
      roots: {
        standard: { ref: "result", nullable: false },
        paid: { ref: "result", nullable: false },
      },
    })),
    auxiliary_roots: {
      error: { ref: "result", nullable: false },
      readiness: { ref: "result", nullable: false },
    },
  }, expected);
  const events: string[] = [];
  let now = NOW;
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(RELAY),
    clock: { nowUtc: () => now },
    projection,
    sessions: {
      verifyUserBearer: () => {
        events.push("auth");
        return Promise.resolve({ subjectId: OWNER, expiresAtUtc: NOW + 1000000n });
      },
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) => {
        events.push("membership");
        return Promise.resolve({
          authority: "public.jeongsi_passes" as const,
          metadataVerified: true,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: null,
        });
      },
    },
    reports: { lookupAccess: () => Promise.resolve(null) },
    authorities: { readCurrent: () => Promise.reject(new Error("unexpected management")) },
    resources: { readScope: () => Promise.reject(new Error("unexpected scope")) },
    business: {
      execute: () => {
        events.push("business");
        return Promise.resolve({ shown: "SYNTHETIC-public" });
      },
    },
    budget: {
      run: async (_r, work) => {
        events.push("reserve");
        const value = await work();
        events.push("settle");
        if (options.expire) now = NOW + 1000000n;
        return value;
      },
    },
    completion: {
      accept: (_r, work) => work(),
      current: () => {
        events.push("finish");
        return options.finalFailure
          ? Promise.reject(new AccessError("publication_changed", 409))
          : Promise.resolve();
      },
      deliver: () => {
        events.push("deliver");
        return Promise.resolve();
      },
    },
    ...(options.extended
      ? {
        readViewScope: {
          assert: () => {
            events.push("candidate_scope");
            return options.scopeFailure
              ? Promise.reject(new AccessError("operation_scope_not_approved", 503))
              : Promise.resolve();
          },
        },
      }
      : {}),
    ...(options.notModified
      ? {
        representation: {
          encode: () => {
            events.push("encode304");
            return Promise.resolve({
              body: null,
              status: 304 as const,
              etag: '"' + "a".repeat(64) + '"',
              gzip: true,
            });
          },
        },
      }
      : {}),
  };
  return { ports, policies, events, handler: createApiHandler(policies, ports) };
}
function request(path: string) {
  return new Request("https://synthetic.invalid" + path, {
    headers: {
      Authorization: "Bearer SYNTHETIC-user",
      "X-Jungsi-Relay-Token": RELAY,
      "If-None-Match": '"' + "a".repeat(64) + '"',
    },
  });
}
async function denied(work: () => unknown | Promise<unknown>) {
  let e: unknown;
  try {
    await work();
  } catch (error) {
    e = error;
  }
  assert(e instanceof AccessError);
}
Deno.test("read view default routing keeps legacy 25 and exposes no new endpoint", async () => {
  const f = fixture(), r = await f.handler(request(extra[0].path));
  equal(r.status, 404);
  equal(f.events, []);
});
Deno.test("read view 28 registration requires an explicit scope gate and exact inventory", async () => {
  const f = fixture({ extended: true });
  await denied(() => createApiHandler(f.policies, { ...f.ports, readViewScope: undefined }));
  await denied(() => createApiHandler(f.policies.slice(1), f.ports));
  await denied(() => createApiHandler([...f.policies.slice(1), f.policies[1]], f.ports));
  await denied(() =>
    createApiHandler(
      f.policies.map((p) =>
        p.id === "history.snapshot.head" ? { ...p, path: "/api/v1/snapshot-alias" } : p
      ),
      f.ports,
    )
  );
});
Deno.test("read view three routes preserve auth membership budget projection and finish order", async () => {
  for (const p of extra) {
    const f = fixture({ extended: true }),
      r = await f.handler(request(p.path.replace("{snapshot_id}", "SYNTHETIC-edition")));
    equal(r.status, 200);
    equal(r.headers.get("Cache-Control"), "private, no-store");
    equal(f.events, [
      "auth",
      "membership",
      "candidate_scope",
      "reserve",
      "business",
      "settle",
      "finish",
      "deliver",
    ]);
  }
});
Deno.test("read view relay and bearer failures cannot reach candidate scope or business", async () => {
  for (const missing of ["X-Jungsi-Relay-Token", "Authorization"]) {
    const f = fixture({ extended: true }), req = request(extra[0].path);
    req.headers.delete(missing);
    const r = await f.handler(req);
    equal(r.status, missing === "Authorization" ? 401 : 403);
    equal(f.events, []);
  }
});
Deno.test("read view unapproved binding fails before reservation and body", async () => {
  const f = fixture({ extended: true, scopeFailure: true }),
    r = await f.handler(request(extra[0].path));
  equal(r.status, 503);
  equal(f.events, ["auth", "membership", "candidate_scope"]);
});
Deno.test("read view conditional 304 still reauthorizes and settles each actual API call", async () => {
  const f = fixture({ extended: true, notModified: true });
  for (let i = 0; i < 2; i++) {
    const r = await f.handler(request(extra[1].path.replace("{snapshot_id}", "SYNTHETIC-edition")));
    equal(r.status, 304);
    equal(await r.text(), "");
    equal(r.headers.get("Cache-Control"), "private, no-store");
  }
  equal(f.events.filter((e) => e === "auth").length, 2);
  equal(f.events.filter((e) => e === "settle").length, 2);
  equal(f.events.filter((e) => e === "finish").length, 2);
});
Deno.test("read view 304 cannot bypass changed final head or session expiry", async () => {
  for (const option of [{ finalFailure: true }, { expire: true }]) {
    const f = fixture({ extended: true, notModified: true, ...option }),
      r = await f.handler(request(extra[0].path));
    equal(r.status, option.expire ? 401 : 409);
    assert(!f.events.includes("deliver"));
  }
});
function readViews(): NativeObject {
  return {
    format: "jungsi.read-view-runtime/v1",
    status: "approved",
    snapshot: {
      artifact_kind: "SYNTHETIC-p1-head",
      lineage: "SYNTHETIC-lineage",
      minimum_sequence: 1,
      scope_sha256: "a".repeat(64),
      normalization_rules_version: "SYNTHETIC-normalization-v1",
      normalization_rules_sha256: "b".repeat(64),
      selection_rules_version: "SYNTHETIC-selection-v1",
      selection_rules_sha256: "c".repeat(64),
      publisher_references: ["SYNTHETIC-owner"],
      reviewer_references: ["SYNTHETIC-reviewer"],
      object_prefix: "SYNTHETIC/snapshot/",
      max_metadata_bytes: 8192,
      max_gzip_bytes: 8192,
      max_decoded_bytes: 32768,
      max_rows: 8,
      max_parts: 4,
      max_depth: 32,
      max_in_memory_bytes: 600000,
      expires_at: "2026-10-15T00:30:00Z",
    },
    report_locator: { cursor_lifetime_seconds: 60, max_cursor_characters: 4096 },
  };
}
async function binding(change?: (d: NativeObject) => void) {
  return await syntheticRuntimeBinding((d) => {
    d.format = "jungsi.edge-api-binding/v2";
    d.scope = { ...(d.scope as NativeObject), operations: [...READ_VIEW_CONSUMER_OPERATION_IDS] };
    d.read_views = readViews();
    ((d.limits as NativeObject).read as NativeObject).max_bytes = 1048576;
    change?.(d);
  });
}
Deno.test("read view binding v2 pins exact 17 while REQ27 operations remain absent", async () => {
  const f = await binding(), b = await f.load();
  equal(b.operations.length, 17);
  assert(b.readViews);
  for (
    const op of ["score-input.status.read", "score-input.correction.grant", "report.sample.read"]
  ) assert(!b.operations.includes(op as typeof READ_VIEW_OPERATION_IDS[number]));
  assert(b.readViews.cursorLifetimeMicroseconds === 60000000n);
});
Deno.test("read view binding v1 cannot silently receive candidate routes or configuration", async () => {
  for (
    const change of [(d: NativeObject) => {
      d.format = "jungsi.edge-api-binding/v1";
    }, (d: NativeObject) => {
      delete d.read_views;
    }]
  ) await denied(async () => await (await binding(change)).load());
});
Deno.test("read view binding rejects missing alias extra REQ27 and duplicate candidate operations", async () => {
  for (
    const mutate of [
      (ops: string[]) => ops.slice(1),
      (ops: string[]) => [...ops, "session.alias"],
      (ops: string[]) => [...ops, "score-input.status.read"],
      (ops: string[]) => [...ops.slice(1), ops[1]],
    ]
  ) {
    await denied(async () =>
      await (await binding((d) => {
        (d.scope as NativeObject).operations = mutate([...READ_VIEW_CONSUMER_OPERATION_IDS]);
      })).load()
    );
  }
});
Deno.test("read view binding rejects malformed limits out of prefix expiry and missing keys", async () => {
  for (
    const change of [(v: NativeObject) => {
      (v.snapshot as NativeObject).max_in_memory_bytes = 999999999999;
    }, (v: NativeObject) => {
      (v.snapshot as NativeObject).object_prefix = "OTHER/";
    }, (v: NativeObject) => {
      (v.snapshot as NativeObject).expires_at = "2026-10-15T02:00:00Z";
    }, (v: NativeObject) => {
      delete v.report_locator;
    }, (v: NativeObject) => {
      (v.report_locator as NativeObject).max_cursor_characters = true;
    }]
  ) {
    await denied(async () =>
      await (await binding((d) => change(d.read_views as NativeObject))).load()
    );
  }
});
