import {
  canonicalApiPolicies,
  canonicalPublicResponseSchemas,
} from "./public_api_contract_fixture.ts";
import {
  memberShortlistPolicies,
  memberShortlistResponseSchemas,
} from "../../supabase/functions/_shared/jungsi/application/member_shortlist_schema.ts";
import { createApiHandler } from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import type { ApiRoutePolicy } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { memberFixture, NOW, OWNER, report } from "./member_shortlist_fixture.ts";
import { assert, equal } from "./fixture.ts";
import { syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { MEMBER_SHORTLIST_CONSUMER_OPERATION_IDS } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { rejects } from "./member_shortlist_fixture.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  NativeRuntimeApi,
  type RuntimeRoutePolicy,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
const RELAY = "SYNTHETIC-relay-token-000000000000000000000";
const extraReadViews: (ApiRoutePolicy & { contract_ref: string })[] = [
  {
    id: "history.snapshot.head",
    method: "GET",
    path: "/api/v1/admission-history/snapshot/head",
    member_tiers: ["standard", "paid"],
    report_owner: false,
    confirmed_score_profile: false,
    contract_ref: "SYNTHETIC-read-view",
  },
  {
    id: "history.snapshot.read",
    method: "GET",
    path: "/api/v1/admission-history/snapshots/{snapshot_id}",
    member_tiers: ["standard", "paid"],
    report_owner: false,
    confirmed_score_profile: false,
    contract_ref: "SYNTHETIC-read-view",
  },
  {
    id: "report.list-own",
    method: "GET",
    path: "/api/v1/me/reports",
    member_tiers: ["standard", "paid"],
    report_owner: false,
    confirmed_score_profile: false,
    contract_ref: "SYNTHETIC-read-view",
  },
];
const routes = { operations: [...canonicalApiPolicies(), ...extraReadViews] };
const schemas = canonicalPublicResponseSchemas() as { operations: unknown[] };
schemas.operations.push(
  ...extraReadViews.map((p) => ({
    id: p.id,
    contract_ref: p.contract_ref,
    roots: {
      standard: { ref: "report_standard", nullable: false },
      paid: { ref: "report_paid", nullable: false },
    },
  })),
);
function memberBinding(change: (row: NativeObject) => void = () => {}) {
  return syntheticRuntimeBinding((d) => {
    d.format = "jungsi.edge-api-binding/v4";
    d.scope = {
      operations: [...MEMBER_SHORTLIST_CONSUMER_OPERATION_IDS],
      artifacts: [{ kind: "catalog", key: "service" }],
    };
    d.member_json = {
      format: "jungsi.member-json-runtime/v1",
      status: "approved",
      object_prefix: "SYNTHETIC/member-json/",
      max_items: 8,
      max_object_bytes: 65536,
    };
    d.read_views = {
      format: "jungsi.read-view-runtime/v1",
      status: "approved",
      snapshot: {
        artifact_kind: "SYNTHETIC-head",
        lineage: "SYNTHETIC-lineage",
        minimum_sequence: 1,
        scope_sha256: "a".repeat(64),
        normalization_rules_version: "SYNTHETIC-norm",
        normalization_rules_sha256: "b".repeat(64),
        selection_rules_version: "SYNTHETIC-selection",
        selection_rules_sha256: "c".repeat(64),
        publisher_references: ["SYNTHETIC-publisher"],
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
      report_locator: {
        cursor_lifetime_seconds: 60,
        max_cursor_characters: 4096,
      },
    };
    ((d.limits as NativeObject).read as NativeObject).max_bytes = 1048576;
    change(d);
  });
}
Deno.test("member binding v4 requires the explicit exact22 consumer generation", async () => {
  const f = await memberBinding(), b = await f.load();
  equal(b.consumerGeneration, "member-json-22");
  equal(b.operations.length, 22);
  equal(b.memberJson?.maxItems, 8);
  equal(b.memberJson?.prefix, "SYNTHETIC/member-json/");
});
Deno.test("member binding rejects old format and namespace escape instead of upgrading scope", async () => {
  for (
    const change of [
      (d: NativeObject) => d.format = "jungsi.edge-api-binding/v3",
      (d: NativeObject) => (d.member_json as NativeObject).object_prefix = "elsewhere/",
    ]
  ) {
    const f = await memberBinding(change);
    await rejects(() => f.load(), "security_policy_unavailable");
  }
});
Deno.test("member binding limits cannot exceed already approved physical batch or object bounds", async () => {
  for (const field of ["max_items", "max_object_bytes"]) {
    const f = await memberBinding((d) => (d.member_json as NativeObject)[field] = 1000000);
    await rejects(() => f.load(), "security_policy_unavailable");
  }
});
Deno.test("member registered30 keeps the existing read-view runtime on28 without activating new routes", async () => {
  let pools = 0;
  const runtime = new NativeRuntimeApi({
    readViewExtensions: true,
    environment: { get: () => undefined },
    policies: memberShortlistPolicies(
      routes.operations as readonly ApiRoutePolicy[],
    ) as readonly RuntimeRoutePolicy[],
    responseSchemas: memberShortlistResponseSchemas(schemas),
    createPool: () => {
      pools++;
      throw new Error("no live pool");
    },
  });
  equal(
    (await runtime.fetch(
      new Request("https://synthetic.invalid/api/v1/me/shortlist?year=2027"),
    ))
      .status,
    404,
  );
  equal(
    (await runtime.fetch(new Request("https://synthetic.invalid/health/live")))
      .status,
    200,
  );
  equal(pools, 0);
});
function fixture() {
  const f = memberFixture();
  f.reports[0].body.overall = {
    format: "jungsi.overall-analysis/v1",
    exam: { exam_id: "SYNTHETIC-exam", academic_year: 2027, exam_type: "mock" },
    pack_version: "SYNTHETIC-pack",
    score_basis: "SYNTHETIC-standard",
    total_standard_score: 0,
    subjects: [],
    absolute_grades: {},
    overall: {
      status: "pending",
      reason_code: "total_model_missing",
      top_percent: null,
      inclusive_top_percent: null,
      exclusive_top_percent: null,
      tie_share_percent: null,
      tie_interval_percent: null,
      tie_policy: null,
      population_id: null,
      model_version: null,
      data_kind: null,
    },
  };
  f.reports[0].body.shortlist = {
    "SYNTHETIC-a": {
      selected: true,
      changed_at: f.reports[0].updated_at,
      assessment_status: "pending",
      profile_id: "SYNTHETIC-profile",
      catalog_version: "SYNTHETIC-catalog",
    },
  };
  f.reports[0].body.analysis_status = {
    status: "pending",
    reason_code: "total_model_missing",
  };
  let entitled = true, scope = true, business = 0, budgets = 0, revoked = false;
  f.reports[0].body.analyses = {
    "SYNTHETIC-a": {
      offering_id: "SYNTHETIC-a",
      status: "pending",
      reason_code: "reference_conversion_not_production_approved",
      converted_score: "0",
      converted_percentile: null,
      category: "pending",
      advantage: null,
      years: [],
      versions: { profile: "SYNTHETIC-profile", pack: "SYNTHETIC-pack" },
      eligibility_status: null,
      private_extra: "SYNTHETIC-private-model",
    },
  };
  const policies = memberShortlistPolicies(
    routes.operations as readonly ApiRoutePolicy[],
  );
  const projected = memberShortlistResponseSchemas(schemas);
  const projection = new PublicResponseProjection(
    projected,
    policies as readonly (ApiRoutePolicy & { contract_ref: string })[],
  );
  const handler = createApiHandler(policies, {
    relay: new RelayBoundary(RELAY),
    clock: { nowUtc: () => NOW },
    sessions: {
      verifyUserBearer: () => Promise.resolve({ subjectId: OWNER, expiresAtUtc: NOW + 1000000n }),
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) =>
        Promise.resolve({
          authority: "public.jeongsi_passes" as const,
          metadataVerified: true as const,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: entitled ? NOW + 1000000n : null,
        }),
    },
    reports: {
      lookupAccess: () => Promise.resolve({ ownerId: OWNER, confirmed: true }),
    },
    authorities: {
      readCurrent: () => {
        throw new Error("not a management API");
      },
    },
    resources: {
      readScope: () => {
        throw new Error("not a management API");
      },
    },
    projection,
    readViewScope: { assert: () => Promise.resolve() },
    memberShortlistScope: {
      assert: () => {
        if (!scope) throw new AccessError("operation_scope_not_approved", 503);
        return Promise.resolve();
      },
    },
    budget: {
      run: async (_r, work) => {
        budgets++;
        return await work();
      },
    },
    business: {
      execute: async (r) => {
        business++;
        const value = r.operation === "report.export" && Object.keys(r.query).length
          ? await f.service.print(r)
          : await f.service.execute(r);
        return {
          ...value,
          private_storage_path: "SYNTHETIC-private",
          owner_id: OWNER,
        };
      },
    },
    completion: {
      accept: (_r, work) => work(),
      deliver: () => Promise.resolve(),
      current: () => {
        if (revoked) throw new AccessError("security_policy_unavailable", 503);
        return Promise.resolve();
      },
    },
  });
  const req = (
    path = "/api/v1/me/shortlist?year=2027",
    method = "GET",
    body?: string,
  ) =>
    new Request("https://synthetic.invalid" + path, {
      method,
      headers: {
        Authorization: "Bearer SYNTHETIC-user",
        "X-Jungsi-Relay-Token": RELAY,
        ...(body
          ? {
            "Content-Type": "application/json",
            "Idempotency-Key": "SYNTHETIC-http",
          }
          : {}),
      },
      ...(body ? { body } : {}),
    });
  return {
    ...f,
    handler,
    req,
    countsHttp: () => ({ business, budgets }),
    setEntitled: (v: boolean) => entitled = v,
    setScope: (v: boolean) => scope = v,
    setRevoked: (v: boolean) => revoked = v,
  };
}
Deno.test("member HTTP GET reaches real service through auth budget and recursive projection", async () => {
  const f = fixture(), r = await f.handler(f.req());
  assert(r.status === 200, JSON.stringify(await r.clone().json()));
  equal(r.headers.get("Cache-Control"), "private, no-store");
  const v = await r.json();
  equal(v.format, "jungsi.member-shortlist/v1");
  equal(v.origin, "legacy_report");
  equal(v.items[0].assessment.converted_score, "0");
  equal(v.items[0].assessment.status, "pending");
  assert(!JSON.stringify(v).includes("private_extra"));
  assert(!JSON.stringify(v).includes("private_storage_path"));
  assert(!JSON.stringify(v).includes(OWNER));
  equal(f.countsHttp(), { business: 1, budgets: 1 });
  equal(f.counts.put, 0);
});
Deno.test("member HTTP PUT routes to real immutable storage and returns revision1", async () => {
  const f = fixture(),
    r = await f.handler(
      f.req(
        "/api/v1/me/shortlist/SYNTHETIC-b?year=2027",
        "PUT",
        JSON.stringify({
          selected: true,
          expected_revision: 0,
          expected_legacy_source: {
            report_id: "SYNTHETIC-report",
            report_version: 1,
          },
        }),
      ),
    );
  assert(r.status === 200, JSON.stringify(await r.clone().json()));
  const v = await r.json();
  equal(v.revision, 1);
  equal(v.items.length, 2);
  equal(f.records.size, 2);
});
Deno.test("member HTTP missing relay fails before business or metadata", async () => {
  const f = fixture(), req = f.req();
  req.headers.delete("X-Jungsi-Relay-Token");
  const r = await f.handler(req);
  equal(r.status, 403);
  equal(f.countsHttp().business, 0);
  equal(f.counts.dbInsert, 0);
});
Deno.test("member HTTP free user fails before private GET", async () => {
  const f = fixture();
  f.setEntitled(false);
  const r = await f.handler(f.req());
  equal(r.status, 403);
  equal(f.countsHttp().business, 0);
  equal(f.counts.get, 0);
});
Deno.test("member HTTP unapproved binding fails closed before business", async () => {
  const f = fixture();
  f.setScope(false);
  const r = await f.handler(f.req());
  equal(r.status, 503);
  equal(f.countsHttp().business, 0);
});
Deno.test("member HTTP current-head rejection prevents a successful response", async () => {
  const f = fixture();
  f.setRevoked(true);
  const r = await f.handler(f.req());
  equal(r.status, 503);
  const v = await r.json();
  equal(v.error.code, "security_policy_unavailable");
  assert(typeof v.request_id === "string");
  assert(!("items" in v));
});
Deno.test("member HTTP print retains the exact two revisions and selection through recursive projection", async () => {
  const f = fixture();
  const put = await f.handler(
    f.req(
      "/api/v1/me/shortlist/SYNTHETIC-b?year=2027",
      "PUT",
      JSON.stringify({
        selected: true,
        expected_revision: 0,
        expected_legacy_source: {
          report_id: "SYNTHETIC-report",
          report_version: 1,
        },
      }),
    ),
  );
  equal(put.status, 200);
  const printed = await f.handler(
    f.req(
      "/api/v1/reports/SYNTHETIC-report/print?year=2027&expected_report_version=1&shortlist_revision=1",
    ),
  );
  assert(printed.status === 200, JSON.stringify(await printed.clone().json()));
  const v = await printed.json();
  equal(v.shortlist_revision, 1);
  equal(v.report.report_version, 1);
  equal(v.member_shortlist.revision, 1);
  equal(
    v.member_shortlist.items.map((i: { offering_id: string }) => i.offering_id),
    [
      "SYNTHETIC-a",
      "SYNTHETIC-b",
    ],
  );
  equal(v.member_shortlist.assessment_context.report_version, 1);
  assert(!JSON.stringify(v).includes("private_extra"));
  const base = routes.operations.find((p) => p.id === "report.export"),
    extended = memberShortlistPolicies(
      routes.operations as readonly ApiRoutePolicy[],
    ).find((p) => p.id === "report.export");
  equal(extended, base);
});

Deno.test("member HTTP revision0 print retains independent report and GET legacy pins without a write", async () => {
  const f = fixture(), newest = report("SYNTHETIC-newest", 2);
  newest.body.shortlist = {
    "SYNTHETIC-b": { selected: true, changed_at: newest.updated_at },
  };
  f.reports.unshift({ ...newest, updated_at: "2026-10-25T00:00:01.000000Z" });
  const read = await f.handler(
    f.req("/api/v1/me/shortlist?year=2027&report_id=SYNTHETIC-report"),
  );
  equal(read.status, 200);
  const list = await read.json();
  f.reports.unshift({
    ...report("SYNTHETIC-after-get", 3),
    updated_at: "2026-10-25T00:00:02.000000Z",
  });
  const printed = await f.handler(
    f.req(
      "/api/v1/reports/SYNTHETIC-report/print?year=2027&expected_report_version=1&shortlist_revision=0&legacy_source_report_id=SYNTHETIC-newest&legacy_source_report_version=2",
    ),
  );
  assert(printed.status === 200, JSON.stringify(await printed.clone().json()));
  const v = await printed.json();
  equal(v.report.report_id, "SYNTHETIC-report");
  equal(v.report.report_version, 1);
  equal(v.member_shortlist.legacy_source, list.legacy_source);
  equal(v.member_shortlist.items, list.items);
  equal(v.member_shortlist.assessment_context.report_id, "SYNTHETIC-report");
  equal(v.shortlist_revision, 0);
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
  equal(f.records.size, 0);
});
