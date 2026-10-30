/** Invented bearer, metadata and fetch responses. No network, real TLS, DB or deployment proof. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  NativeRuntimeApi,
  observeRuntimeResponse,
  type RuntimeComposition,
  type SafeRuntimeObservation,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SUBJECT_CONTEXT_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { assert, equal } from "../edge/fixture.ts";
import { syntheticApiPolicies } from "../edge/synthetic_api_contract.ts";
import {
  SYNTHETIC_RUNTIME_NOW,
  SYNTHETIC_RUNTIME_URL,
  syntheticRuntimeBinding,
} from "../edge/synthetic_runtime_binding.ts";

const SUBJECT = "00000000-0000-4000-8000-000000000001";
import type { ApiRoutePolicy } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
const extraPolicies: ApiRoutePolicy[] = [
  {id:"history.snapshot.head", method:"GET", path:"/api/v1/admission-history/snapshot/head", member_tiers:["standard","paid"], report_owner:false, confirmed_score_profile:false},
  {id:"history.snapshot.read", method:"GET", path:"/api/v1/admission-history/snapshots/{snapshot_id}", member_tiers:["standard","paid"], report_owner:false, confirmed_score_profile:false},
  {id:"report.list-own", method:"GET", path:"/api/v1/me/reports", member_tiers:["standard","paid"], report_owner:false, confirmed_score_profile:false},
];
const policies = [...syntheticApiPolicies(), ...extraPolicies].map((p) => ({ ...p, contract_ref: "SYNTHETIC" }));
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
    expiry === null ? null : "1",
  ];
  for (const index of [1, 2, 3, 4]) values[index] = JSON.stringify(values[index]);
  return values;
}
async function fixture(subjectOnly = false, observe?: RuntimeComposition["observe"]) {
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
    observe,
    readViewExtensions: true,
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
        equal(
          new Headers(init?.headers).get("apikey"),
          binding.values.SUPABASE_PUBLISHABLE_KEY ?? binding.values.JUNGSI_DISPLAY_PUBLISHABLE_KEY,
        );
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



// The real HTTP router, runtime wrapper and P1 request guard are executed. Only
// the data source, final common controls and wire representation are local stubs.
// SharedRequestBudget is the actual implementation with invented planner/store.
// Fixture Auth and SQL also use invented responses.
import { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";

import { SharedRequestBudget } from "../../supabase/functions/_shared/jungsi/application/usage_service.ts";
const CREDENTIAL = "SyntheticConsumer_".repeat(3);
const NAMES = ["headSha256","manifestSha256","sourceHeadSha256","scopeSha256",
  "indexSha256","coverageSha256","globalReceiptSha256","consumerReceiptSha256",
  "consumerBuildSha256","consumerContractSha256"];
const PINS = Object.fromEntries(NAMES.map((name, i) => [name, "0123456789"[i].repeat(64)]));
const EXP = SYNTHETIC_RUNTIME_NOW + 60000000n; // matches the fixture's synthetic JWT
async function hashText(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((n) => n.toString(16).padStart(2,"0")).join("");
}

async function trial(which: string) {
  const f = await fixture();
  const events: string[] = [], errors: number[] = [], errorCodes: string[] = [], failures: any[] = [];
  const binding = {
    descriptorSha256: "a".repeat(64),
    expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 180000000n,
    operations: ["history.snapshot.head", "history.snapshot.read"],
    readLimits: { maxBytes: 8192 },
    readViews: { snapshot: { scopeSha256: PINS.scopeSha256, maxMetadataBytes: 4096 } },
  };
  const descriptor = {
    format:"jungsi.p1-r27-server-admission/v1", status:"approved",
    purpose:"history_snapshot_r27_consumer", api_binding_sha256:binding.descriptorSha256,
    approval_reference_sha256:"b".repeat(64), deployment_evidence_sha256:"c".repeat(64),
    consumer_id:"SYNTHETIC-CONSUMER", credential_sha256:await hashText(CREDENTIAL),
    expires_at_utc_micros:String(which.includes("both-expire") ? EXP :
      which.includes("descriptor-") ? SYNTHETIC_RUNTIME_NOW + 30000000n :
      SYNTHETIC_RUNTIME_NOW + 120000000n),
    operations:["history.snapshot.read"], max_extra_bytes:4096, max_index_bytes:2048, pins:PINS,
  };
  const descriptorText = JSON.stringify(descriptor);
  if (which !== "v1-expire-before-prepare") {
    f.binding.values.JUNGSI_P1_R27_CONSUMER_BINDING_JSON = descriptorText;
    f.binding.values.JUNGSI_P1_R27_CONSUMER_BINDING_SHA256 = await hashText(descriptorText);
  }
  const p = NativeRuntimeRequest.prototype as any;
  const saved = { binding:p.binding, budget:p.budget, assertCurrent:p.assertCurrent,
    readView:p.readView, encodeReadView:p.encodeReadView,
    assertP1R27Current:p.assertP1R27Current, prepareP1R27:p.prepareP1R27 };
  const oldJson = Response.json;
  const oldGet = f.binding.env.get;
  let finalCalls = 0, expireAtRelay = false;
  (Response as any).json = function(value: any, options: any) {
    if (value?.status === "error" && value.error?.code) {
      errors.push(options.status); errorCodes.push(value.error.code);
      failures.push({id:value.request_id,headers:new Headers(options.headers)});
    }
    return oldJson.call(Response, value, options);
  };
  (f.binding.env as any).get = function(key: string) {
    if (key === "JUNGSI_RELAY_TOKEN" && expireAtRelay) {
      expireAtRelay = false; f.state.now = EXP; events.push("clock-expired-during-prepare");
    }
    return oldGet(key);
  };
  p.binding = async () => binding;
  const demand = (kind: string, periodSeconds: bigint) => ({
    kind, scope:"GLOBAL", periodSeconds, capacity:10n, ceiling:10n, units:1n,
  });
  const planner = { prepare: async (r: any) => ({
    status:"approved", policyVersion:"SYNTHETIC-POLICY", approvalReferenceSha256:"a".repeat(64),
    owner:r.session.user.subjectId, operation:r.operation, memberTier:r.session.tier,
    examId:null, normalizedScoresSha256:null, calculationContextSha256:null, computation:"required",
    demands:[demand("request_window",60n), demand("concurrent_jobs",1n), demand("result_volume",60n)],
    ...(which === "budget-proof-invalid" ? {stageProof:{}} : {}),
  })};
  const store = {
    reserve: async (r: any) => {
      events.push("real-budget-reserve");
      if (which === "budget-429") return {allowed:false,code:"rate_limit_exceeded",retryAfterSeconds:3};
      return {allowed:true,lease:{id:"SYNTHETIC-LEASE",owner:r.owner,policyVersion:r.policyVersion,
        createdAtUtc:SYNTHETIC_RUNTIME_NOW,expiresAtUtc:SYNTHETIC_RUNTIME_NOW+120000000n}};
    },
    settle: async (_lease: unknown, outcome: string) => {
      events.push("real-budget-settle-" + outcome);
      if (which.includes("settle-failure")) throw new Error("SYNTHETIC-INTERNAL-STORE-FAILURE");
    },
  };
  const budget = new SharedRequestBudget(planner as any,store as any,
    {nowUtc:()=>f.state.now}, {exists:async()=>false});
  p.budget = async () => budget;
  p.assertCurrent = async () => { events.push("synthetic-common-current"); };
  p.prepareP1R27 = async function(request: Request, execution: unknown) {
    events.push("real-prepare-enter");
    if (which === "v1-expire-before-prepare") { f.state.now = EXP; events.push("clock-expired-before-prepare"); }
    if (which === "clock-before-evaluation") f.state.now = SYNTHETIC_RUNTIME_NOW - 1n;
    if (which === "v2-expire-during-prepare") expireAtRelay = true;
    try { return await saved.prepareP1R27.call(this, request, execution); }
    finally { expireAtRelay = false; }
  };
  p.readView = async function(execution: any) {
    events.push("synthetic-source-enter");
    const input = this.p1R27Admission.take(execution, execution.session.user.subjectId);
    if (which !== "v1-expire-after-source") {
      assert(input);
      if (which === "v2-expire-before-bound") { f.state.now = EXP; events.push("clock-expired-before-bound"); }
      input.admission.assertBoundConsumer({headSha256:PINS.headSha256,
        manifestSha256:PINS.manifestSha256, scopeSha256:PINS.scopeSha256,
        consumerBuildSha256:PINS.consumerBuildSha256, consumerContractSha256:PINS.consumerContractSha256});
      events.push("real-guard-bound");
    }
    if (["v1-expire-after-source", "v2-expire-after-source", "v2-existing-error", "v2-settle-failure-after-expiry"].includes(which)) {
      f.state.now = EXP; events.push("clock-expired-after-source");
    }
    if (which === "v2-existing-error") throw new AccessError("publication_changed", 409);
    return {};
  };
  p.encodeReadView = async function() {
    if (which.includes("304")) {
      events.push("synthetic-304-encoded");
      return {body:null, status:304, etag:'"' + "a".repeat(64) + '"', gzip:false,
        publicationSha256:"b".repeat(64),snapshotId:"SYNTHETIC-SNAPSHOT"};
    }
    return undefined;
  };
  p.assertP1R27Current = function() {
    finalCalls++;
    if (finalCalls === 1 && which === "clock-backward-valid") f.state.now = SYNTHETIC_RUNTIME_NOW + 2000000n;
    if (finalCalls === 2) {
      if (which.includes("expire-final") || which === "both-expire") f.state.now = EXP;
      if (which === "user-before") f.state.now = EXP - 1n;
      if (which === "descriptor-before") f.state.now = SYNTHETIC_RUNTIME_NOW + 30000000n - 1n;
      if (which === "descriptor-at") f.state.now = SYNTHETIC_RUNTIME_NOW + 30000000n;
      if (which === "config-changed") f.binding.values.JUNGSI_P1_R27_CONSUMER_BINDING_JSON += " ";
      if (which === "clock-undefined") (f.state as any).now = undefined;
      if (which === "clock-nan") (f.state as any).now = NaN;
      if (which === "clock-null") (f.state as any).now = null;
      if (which === "clock-string") (f.state as any).now = String(SYNTHETIC_RUNTIME_NOW);
      if (which === "clock-number") (f.state as any).now = Number(SYNTHETIC_RUNTIME_NOW);
      if (which === "clock-negative") f.state.now = -1n;
      if (which === "clock-backward-valid") f.state.now = SYNTHETIC_RUNTIME_NOW + 1000000n;
    }
    return saved.assertP1R27Current.call(this);
  };
  try {
    const req = f.request("/api/v1/admission-history/snapshots/SYNTHETIC-SNAPSHOT");
    req.headers.set("X-Jungsi-P1-R27-Consumer-Credential", CREDENTIAL);
    const response = await f.api.fetch(req);
    const body = await response.text();
    assert(!body.includes(CREDENTIAL));
    assert(!body.includes("SYNTHETIC"));
    assert(f.calls.auth === 1 && f.calls.profile === 1 && f.calls.pass === 1 && f.calls.storage === 0);
    const id = response.headers.get("X-Request-ID");
    if (response.status >= 400) {
      assert(id !== null && /^[a-f0-9]{32}$/.test(id));
      equal(JSON.parse(body).request_id, id);
      assert(failures.length === 1);
      equal(failures[0].id,id);
      equal(failures[0].headers.get("X-Request-ID"),id);
      equal(failures[0].headers.get("Retry-After"),response.headers.get("Retry-After"));
    }
    return {status:response.status, errors, errorCodes, events, finalCalls, body,
      retryAfter:response.headers.get("Retry-After"), requestId:id,
      failures, etag:response.headers.get("ETag"), publication:response.headers.get("X-Publication-SHA256"),
      snapshot:response.headers.get("X-Jungsi-Snapshot-ID")};
  } finally {
    Object.assign(p, saved);
    (Response as any).json = oldJson;
    (f.binding.env as any).get = oldGet;
    await f.api.close();
  }
}


export async function verifyExpiryClockHttpScenarios(): Promise<void> {
  for (const mode of ["v1-expire-before-prepare", "v2-expire-during-prepare", "v2-expire-before-bound",
    "v1-expire-after-source", "v2-expire-after-source"]) {
    const r = await trial(mode);
    equal([r.status,r.errors,r.errorCodes],[401,[401],["authentication_required"]]);
  }
  const earlyClock = await trial("clock-before-evaluation");
  equal([earlyClock.status,earlyClock.errors,earlyClock.errorCodes],[503,[503],["backend_dependency_unavailable"]]);
  assert(!earlyClock.events.includes("synthetic-source-enter"));
  const previous = await trial("v2-existing-error");
  equal([previous.status,previous.errors,previous.errorCodes],[409,[409],["publication_changed"]]);
  assert(previous.events.includes("real-budget-settle-failure"));

  const rate = await trial("budget-429");
  equal([rate.status,rate.errorCodes,rate.retryAfter],[429,["rate_limit_exceeded"],"3"]);
  assert(!rate.events.includes("synthetic-source-enter"));
  for (const mode of ["v2-settle-failure-after-expiry", "v2-settle-failure-success"]) {
    const r = await trial(mode);
    equal([r.status,r.errors,r.errorCodes],[503,[503],["security_policy_unavailable"]]);
    assert(r.events.some((e)=>e.startsWith("real-budget-settle-")));
  }
  const proof = await trial("budget-proof-invalid");
  equal(proof.status,503);
  assert(!proof.events.includes("synthetic-source-enter"));

  for (const mode of ["v2-fresh-200", "v2-fresh-304", "user-before", "descriptor-before"]) {
    const r = await trial(mode);
    equal(r.status,mode.endsWith("304") ? 304 : 200);
    equal(r.finalCalls,2);
  }
  for (const mode of ["v2-expire-final-200", "v2-expire-final-304"]) {
    const r = await trial(mode);
    equal([r.status,r.errors,r.errorCodes],[401,[401],["authentication_required"]]);
    equal(r.finalCalls,2);
    assert(r.etag === null && r.publication === null && r.snapshot === null);
  }
  for (const mode of ["descriptor-at", "both-expire", "config-changed", "clock-undefined", "clock-nan", "clock-null", "clock-string", "clock-number", "clock-negative", "clock-backward-valid"]) {
    const r = await trial(mode);
    equal([r.status,r.errors,r.errorCodes],[503,[503],["backend_dependency_unavailable"]]);
    equal(r.finalCalls,2);
    assert(r.etag === null && r.publication === null && r.snapshot === null);
  }
}
