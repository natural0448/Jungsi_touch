/** Synthetic routing contract only; no real authority, publication or DB. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type ApiExecution,
  type ApiExecutionBoundary,
  type ApiRoutePolicy,
  CURRENT_PAGE_OPERATION_ID,
  CURRENT_PAGE_ROUTE_PATH,
  READ_VIEW_CONSUMER_OPERATION_IDS,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  type CurrentPageExecution,
  type CurrentPagePorts,
  type HistoryClaim,
  HistoryCurrentPageService,
} from "../../supabase/functions/_shared/jungsi/application/history_current_page.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import {
  RuntimeRequestBudget,
  type RuntimeUsagePolicy,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts";
import {
  currentPageBudgetScope,
  runtimeCompletionCurrent,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import {
  type RequestScopedCurrentPagePortsFactory,
  resolveCurrentPageRequestPorts,
} from "../../supabase/functions/_shared/jungsi/infrastructure/current_page_request_ports.review-only.ts";
import type { PreparedUsageAdmission } from "../../supabase/functions/_shared/jungsi/application/usage_service.ts";
import type { BudgetRequest } from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import type { UsageBudgetStorePort } from "../../supabase/functions/_shared/jungsi/application/usage_budget.ts";
import type { SupabaseRuntimeControls } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { syntheticApiPolicies } from "./synthetic_api_contract.ts";
import { assert, equal } from "./fixture.ts";

const NOW = 1700000000000000n;
const RELAY = "SYNTHETIC-relay-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const OWNER = "00000000-0000-0000-0000-000000000001";
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
const current: ApiRoutePolicy = {
  id: CURRENT_PAGE_OPERATION_ID,
  method: "GET",
  path: CURRENT_PAGE_ROUTE_PATH,
  member_tiers: ["standard", "paid"],
  report_owner: false,
  confirmed_score_profile: false,
  contract_ref: "SYNTHETIC",
};
const resultRoot = {
  type: "object",
  nullable: false,
  properties: { shown: { type: "string", nullable: false } },
  required: ["shown"],
  optional: [],
};
// Test-only recursive allowlist. Planning has not approved a production schema.
const textNode = { type: "string", nullable: true };
const intNode = { type: "integer", nullable: true };
const boolNode = { type: "boolean", nullable: true };
const scalarNode = {
  type: "union",
  nullable: true,
  options: [
    { type: "string", nullable: false },
    { type: "number", nullable: false },
  ],
};
const objectNode = (properties: Record<string, unknown>, nullable = false) => ({
  type: "object",
  nullable,
  properties,
  required: [],
  optional: Object.keys(properties),
});
const arrayNode = (items: unknown) => ({
  type: "array",
  nullable: false,
  items,
});
const contextNode = objectNode({
  observation_id: textNode,
  identity_variant_index: intNode,
  scope_status: textNode,
}, true);
const metricProps = {
  value: scalarNode,
  status: textNode,
  unit: textNode,
  reason_code: textNode,
  statistic_label: textNode,
  cohort: textNode,
  source_url: textNode,
  source_as_of: textNode,
  source_context: contextNode,
  statistic_percent: intNode,
  basis_code: textNode,
  basis_label: textNode,
  cohort_code: textNode,
  cohort_label: textNode,
  selection_rule_ref: textNode,
  metric_definition: textNode,
  value_json_type: textNode,
  original_scale: scalarNode,
  stage: textNode,
};
const metricNode = objectNode({
  field: textNode,
  ...metricProps,
  verified_score_null_reasons: arrayNode(textNode),
  entries: arrayNode(objectNode(metricProps)),
  omitted_other_basis_count: intNode,
});
const sourceQuotaNode = objectNode({
  quota_value: scalarNode,
  quota_literal_state: textNode,
  quota_stage: textNode,
  quota_condition_text: textNode,
  quota_cell: objectNode({
    status: textNode,
    reason_code: textNode,
    unit: textNode,
    source_as_of: textNode,
  }, true),
});
const historyNode = objectNode({
  status: textNode,
  items: arrayNode(objectNode({
    academic_year: intNode,
    university_id: textNode,
    offering_id: textNode,
    campus: textNode,
    admission_track: textNode,
    group: textNode,
    observation_id: textNode,
    relationship_kind: textNode,
    observation_use: textNode,
    origin_verification: textNode,
    published_score_individual_inference_allowed: boolNode,
    historical_condition: objectNode({
      stage: textNode,
      condition: textNode,
      condition_text: textNode,
    }, true),
    condition_comparison: textNode,
    metrics: arrayNode(metricNode),
  })),
});
const currentRoot = objectNode({
  format: textNode,
  status: textNode,
  items: arrayNode(
    objectNode({
      status: textNode,
      offering: objectNode({
        offering_id: textNode,
        academic_year: intNode,
        university_id: textNode,
        university_name: textNode,
        region: textNode,
        campus: textNode,
        department: textNode,
        admission_track: textNode,
        group: textNode,
      }, true),
      recruitment: objectNode({
        value: scalarNode,
        status: textNode,
        source_status: textNode,
        stage: textNode,
        source_stage: textNode,
        decision_stage: textNode,
        unit: textNode,
        condition: textNode,
        decision_condition: textNode,
        condition_text: textNode,
        source_url: textNode,
        source_as_of: textNode,
        carryover_status: textNode,
        finality: textNode,
        source_quota: sourceQuotaNode,
      }, true),
      history: historyNode,
    }),
  ),
  next_cursor: textNode,
  matching_count: intNode,
});
type Options = {
  enabled?: boolean;
  badScope?: boolean;
  noAdmission?: boolean;
  failBudget?: boolean;
  abortInScope?: boolean;
  finalFailure?: boolean;
  realService?: boolean;
  evidence?: "unresolved" | "not_applicable";
  richHistory?: boolean;
  quotaValue?: number | string | null;
  denyAuthority?: boolean;
  comparisonConflict?: boolean;
  badScopeValue?: "false" | "null";
  schemaMismatch?: boolean;
  schemaRevoke?: boolean;
  schemaValue?: "false" | "null";
  registryBytes?: Uint8Array;
  approvedByteSha?: string;
  approvedSemanticSha?: string;
  paid?: boolean;
  invalidMatchingCount?: boolean;
  badCurrent?: "false" | "null" | "throw";
};
function fixture(options: Options = {}) {
  const contractRef = options.registryBytes ? "REVIEW_ONLY.history_current_page" : "SYNTHETIC";
  const currentPolicy = { ...current, contract_ref: contractRef };
  const policies = [
    ...syntheticApiPolicies(),
    ...extra,
    ...(options.enabled ? [currentPolicy] : []),
  ];
  const expected = policies.filter((p) => p.id !== CURRENT_PAGE_OPERATION_ID)
    .map((p) => ({
      id: p.id,
      contract_ref: "SYNTHETIC",
    }));
  const projection = new PublicResponseProjection({
    format: "jungsi.public-response-schemas/v1",
    schemas: { other: resultRoot },
    operations: expected.map((p) => ({
      ...p,
      roots: {
        standard: {
          ref: "other",
          nullable: false,
        },
        paid: {
          ref: "other",
          nullable: false,
        },
      },
    })),
    auxiliary_roots: {
      error: { ref: "other", nullable: false },
      readiness: { ref: "other", nullable: false },
    },
  }, expected);
  const syntheticRegistry = {
    format: "jungsi.public-response-schemas/v1",
    schemas: { other: resultRoot, page: currentRoot },
    operations: [{
      id: CURRENT_PAGE_OPERATION_ID,
      contract_ref: "SYNTHETIC",
      roots: {
        standard: { ref: "page", nullable: false },
        paid: { ref: "page", nullable: false },
      },
    }],
    auxiliary_roots: {
      error: { ref: "other", nullable: false },
      readiness: { ref: "other", nullable: false },
    },
  };
  const pageBytes = options.registryBytes
    ? new Uint8Array(options.registryBytes)
    : new TextEncoder().encode(JSON.stringify(syntheticRegistry));
  const pageRegistry: unknown = JSON.parse(new TextDecoder().decode(pageBytes));
  const pageProjection = PublicResponseProjection.fromExactRegistryBytes(
    pageBytes,
    [{
      id: CURRENT_PAGE_OPERATION_ID,
      contract_ref: contractRef,
    }],
  );
  const events: string[] = [],
    controller = new AbortController();
  let admission: unknown = Object.freeze({ synthetic: true });
  let scopeRequest: ApiExecution | null = null,
    scopeBoundary: ApiExecutionBoundary | null = null;
  let businessSignal: AbortSignal | null = null, businessAdmission: unknown;
  let schemaChecks = 0;
  const key = {
    release_id: "synthetic-release",
    academic_year: 2027,
    offering_pk: "SYN",
    school_id: "synthetic-school",
  };
  const quotaValue = options.quotaValue === undefined ? 5 : options.quotaValue;
  const sourceContext = {
    observation_id: "observation:" + "a".repeat(64),
    identity_variant_index: 0,
    scope_status: "source_consistent" as const,
  };
  const verifiedMetric = {
    value: 0,
    status: "verified_official" as const,
    unit: "명",
    reason_code: null,
    statistic_label: "SYN 기존 통계",
    cohort: "SYN 모집집단",
    source_url: "https://example.test/history",
    source_as_of: "2026-01-01",
    source_context: sourceContext,
  };
  const claims: HistoryClaim[] = ["A", "B", "HOLD"].map((id) => ({
    claim_id: "claim-" + id,
    target: key,
    source: {
      release_id: "historical-release",
      academic_year: 2026,
      offering_pk: "OLD-" + id,
      school_id: "synthetic-school",
    },
    campus: null,
    admission_track: "SYN",
    group: "A",
    observation_id: "obs-" + id,
    historical_condition: options.comparisonConflict && id === "A" ? null : {
      stage: "initial",
      condition: "conditional",
      condition_text: "SYN 과거 조건",
    },
    metrics: id === "A"
      ? [{ field: "competition_ratio", ...verifiedMetric }, {
        field: "alternate_cut",
        value: null,
        status: "not_published",
        unit: null,
        reason_code: "not_published",
        statistic_label: null,
        cohort: null,
        source_url: null,
        source_as_of: null,
        source_context: null,
        entries: [{ ...verifiedMetric, value: "12.50", unit: "점" }],
        omitted_other_basis_count: 2,
      }]
      : [{
        field: "competition_ratio",
        ...verifiedMetric,
        value: id === "B" ? "3.50" : 999,
      }],
    relation_proof: "SYN-PRIVATE-" + id,
  }));
  const pagePorts: CurrentPagePorts = {
    authority: {
      begin: (execution, boundary) => {
        events.push("service_authority");
        assert(execution === scopeRequest && boundary === scopeBoundary);
        if (options.denyAuthority) {
          return Promise.reject(
            new AccessError("security_policy_unavailable", 503),
          );
        }
        return Promise.resolve({
          subject: OWNER,
          snapshot_id: "synthetic-snapshot",
          snapshot_publication_sha256: "a".repeat(64),
          snapshot_source_head_sha256: "b".repeat(64),
          snapshot_scope_sha256: "c".repeat(64),
          guide_publication_sha256: "d".repeat(64),
          guide_head_sha256: "e".repeat(64),
          decision_scope_sha256: "f".repeat(64),
          expires_at_utc: NOW + 10000000n,
        });
      },
      assertCurrent: () => Promise.resolve(),
      classifyGuideMembership: (_context, keys) =>
        Promise.resolve(
          keys.map((target) => ({ target, decision: "VERIFIED" as const })),
        ),
      classifyTargets: (_context, keys) =>
        Promise.resolve(
          keys.map((target) => ({
            target,
            decision: "INCLUDE" as const,
            quota: {
              value: quotaValue,
              status: quotaValue === null
                ? "pending_value_missing" as const
                : "verified_official" as const,
              stage: "final" as const,
              unit: "명",
              condition: "conditional" as const,
              condition_text: "SYN 일반 지원 조건",
              source_url: "https://example.test/source",
              source_as_of: "2026-10-01",
              source_quota: {
                quota_value: quotaValue,
                quota_literal_state: "numeric_literal",
                quota_stage: "final",
                quota_condition_text: "SYN 일반 지원 조건",
              },
            },
          })),
        ),
      verifyRelations: (_context, records) =>
        Promise.resolve(records.map((claim) => ({
          claim_id: claim.claim_id,
          decision: claim.claim_id === "claim-HOLD" ? "HOLD" as const : "VERIFIED" as const,
          relationship_kind: "continuation" as const,
          observation_use: "individual_result" as const,
          origin_verification: "single_original_verified" as const,
          published_score_individual_inference_allowed: true,
        }))),
    },
    offerings: {
      page: (context) => {
        events.push("provider_page");
        assert(context.boundary === scopeBoundary);
        return Promise.resolve({
          items: [{
            key,
            university_name: "SYN",
            region: null,
            campus: null,
            department: "SYN",
            admission_track: "SYN",
            group: "A",
          }],
          next_position: null,
          incomplete_before: false,
        });
      },
    },
    histories: {
      read: (_context, targets) =>
        Promise.resolve({
          claims: options.richHistory ? claims : [],
          complete_targets: targets,
        }),
    },
    cursors: {
      open: () => Promise.reject(new Error("unexpected cursor")),
      seal: () => Promise.reject(new Error("unexpected cursor")),
    },
    ...(options.comparisonConflict
      ? {
        condition_comparisons: {
          compare: (_context, _current, verified) =>
            Promise.resolve(verified.map((c) => ({
              claim_id: c.claim_id,
              status: "changed" as const,
            }))),
        },
      }
      : {}),
    ...(options.evidence
      ? {
        recruitment_evidence: {
          verify: (_context, rows) =>
            Promise.resolve(rows.map((r) => ({
              target: r.target,
              finality: "verified_final" as const,
              carryover_status: options.evidence!,
            }))),
        },
      }
      : {}),
  };
  const limits = {
    max_cursor_chars: 512,
    max_position_chars: 256,
    max_text_chars: 256,
    max_history_claims: 500,
    max_metrics_per_claim: 20,
    max_result_bytes: 1000000,
  };
  const currentPageScope = {
    projection: pageProjection,
    schemaAuthority: {
      assert: async (
        request: ApiExecution,
        boundary: ApiExecutionBoundary,
        binding: Readonly<{
          operation: string;
          contract_ref: string;
          schema_sha256: string;
          schema_bytes_sha256: string;
        }>,
        phase: "active" | "settled_success",
      ) => {
        events.push("schema_authority");
        schemaChecks++;
        assert(
          request.operation === CURRENT_PAGE_OPERATION_ID &&
            boundary.admission === admission &&
            request.session.tier === (options.paid ? "paid" : "standard") && phase === "active",
        );
        const approved = options.schemaMismatch
          ? "0".repeat(64)
          : options.approvedSemanticSha ?? await nativeJsonSha256(pageRegistry);
        const bytesSha = options.approvedByteSha ?? Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", pageBytes)),
          (v) => v.toString(16).padStart(2, "0"),
        ).join("");
        if (options.schemaValue) {
          return (options.schemaValue === "false" ? false : null) as unknown as void;
        }
        if (
          binding.operation !== CURRENT_PAGE_OPERATION_ID ||
          binding.contract_ref !== contractRef ||
          binding.schema_sha256 !== approved ||
          binding.schema_bytes_sha256 !== bytesSha ||
          options.schemaRevoke && schemaChecks > 1
        ) {
          throw new AccessError("security_policy_unavailable", 503);
        }
      },
    },
    assertCurrent: (request: ApiExecution, boundary: ApiExecutionBoundary) => {
      events.push("page_current");
      assert(request === scopeRequest && boundary === scopeBoundary);
      if (options.badCurrent === "throw") {
        return Promise.reject(new AccessError("security_policy_unavailable", 503));
      }
      if (options.badCurrent) {
        return Promise.resolve((options.badCurrent === "false" ? false : null) as unknown as void);
      }
      return Promise.resolve();
    },
    assertReceipt: (request: ApiExecution, boundary: ApiExecutionBoundary) => {
      events.push("page_receipt");
      assert(request === scopeRequest && boundary === scopeBoundary);
      return Promise.resolve();
    },
    assert: (request: ApiExecution, boundary: ApiExecutionBoundary) => {
      events.push("page_scope");
      scopeRequest = request;
      scopeBoundary = boundary;
      if (options.abortInScope) controller.abort();
      if (options.badScope) {
        return Promise.reject(
          new AccessError("security_policy_unavailable", 503),
        );
      }
      if (options.badScopeValue) {
        return Promise.resolve(
          (options.badScopeValue === "false" ? false : null) as unknown as void,
        );
      }
      return Promise.resolve();
    },
  };
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(RELAY),
    clock: { nowUtc: () => NOW },
    projection,
    sessions: {
      verifyUserBearer: () => {
        events.push("session");
        return Promise.resolve({
          subjectId: OWNER,
          expiresAtUtc: NOW + 100000000n,
        });
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
          paidUntilUtc: options.paid ? NOW + 100000000n : null,
        });
      },
    },
    reports: { lookupAccess: () => Promise.resolve(null) },
    authorities: { readCurrent: () => Promise.reject(new Error("unexpected")) },
    resources: { readScope: () => Promise.reject(new Error("unexpected")) },
    readViewScope: {
      assert: () => {
        events.push("base_scope");
        return Promise.resolve();
      },
    },
    ...(options.enabled
      ? {
        currentPageScope,
      }
      : {}),
    budget: {
      run: async (_request, work) => {
        events.push("reserve");
        if (options.failBudget) {
          throw new AccessError(
            "security_policy_unavailable",
            503,
          );
        }
        try {
          return await work(options.noAdmission ? undefined : admission);
        } finally {
          events.push("settle");
        }
      },
    },
    business: {
      execute: (request, boundary) => {
        events.push("business");
        businessSignal = boundary?.signal ?? null;
        businessAdmission = boundary?.admission;
        if (request.operation !== CURRENT_PAGE_OPERATION_ID) {
          return Promise
            .resolve({ shown: "synthetic" });
        }
        assert(request === scopeRequest && boundary === scopeBoundary);
        assert(Object.isFrozen(request) && Object.isFrozen(request.query));
        if (options.realService) {
          const realService = new HistoryCurrentPageService(pagePorts, {
            nowUtc: () => NOW,
          }, limits);
          return realService.execute(
            request as ApiExecution & CurrentPageExecution,
            boundary!,
          );
        }
        return Promise.resolve({
          format: "jungsi.p1-current-page/v1",
          status: "pending",
          items: [{
            status: "ready",
            offering: { offering_id: "2027:SYN", private_source: "SECRET" },
            hidden_proof: "SECRET",
          }],
          next_cursor: null,
          matching_count: options.invalidMatchingCount ? 1 : null,
          hidden_head: "SECRET",
        });
      },
    },
    representation: {
      encode: (request) =>
        request.operation === "history.snapshot.read"
          ? Promise.resolve({
            body: null,
            status: 304 as const,
            etag: '"' + "a".repeat(64) + '"',
            gzip: true,
          })
          : Promise.resolve(null),
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
  };
  const request = (path: string = CURRENT_PAGE_ROUTE_PATH) =>
    new Request("https://synthetic.invalid" + path, {
      signal: controller.signal,
      headers: {
        Authorization: "Bearer SYNTHETIC-user",
        "X-Jungsi-Relay-Token": RELAY,
      },
    });
  return {
    policies,
    ports,
    pagePorts,
    limits,
    request,
    events,
    controller,
    admission,
    setAdmission: (value: unknown) => {
      admission = value;
    },
    scopeState: () => ({ request: scopeRequest, boundary: scopeBoundary }),
    businessState: () => ({ businessSignal, businessAdmission }),
  };
}
Deno.test("legacy 17 binding stays closed and current-page is off by default", async () => {
  equal(READ_VIEW_CONSUMER_OPERATION_IDS.length, 17);
  assert(
    !(READ_VIEW_CONSUMER_OPERATION_IDS as readonly string[]).includes(
      CURRENT_PAGE_OPERATION_ID,
    ),
  );
  const f = fixture(),
    response = await createApiHandler(f.policies, f.ports)(f.request());
  equal(response.status, 404);
  equal(f.events, []);
  const incomplete = createApiHandler([...f.policies, current], f.ports);
  equal((await incomplete(f.request())).status, 404);
  equal(
    (await incomplete(f.request("/api/v1/admission-history/snapshots/SYN")))
      .status,
    304,
  );
});
Deno.test("opt-in sends one authenticated request and exact budget boundary to the business port", async () => {
  const f = fixture({ enabled: true }),
    request = f.request(CURRENT_PAGE_ROUTE_PATH + "?limit=10");
  const response = await createApiHandler(f.policies, f.ports)(request);
  equal(response.status, 200);
  equal(f.events, [
    "session",
    "membership",
    "base_scope",
    "reserve",
    "schema_authority",
    "page_scope",
    "business",
    "page_current",
    "schema_authority",
    "settle",
    "page_receipt",
    "finish",
    "page_receipt",
    "deliver",
  ]);
  assert(f.businessState().businessSignal === request.signal);
  assert(f.businessState().businessAdmission === f.admission);
  const text = await response.text();
  assert(text.includes("2027:SYN") && !text.includes("SECRET"));
});
Deno.test("relay, session, admission, scope, abort and settlement failures cannot reach business", async () => {
  for (
    const mode of [
      "relay",
      "bearer",
      "budget",
      "admission",
      "scope",
      "false_scope",
      "null_scope",
      "abort",
    ] as const
  ) {
    const f = fixture({
      enabled: true,
      realService: true,
      failBudget: mode === "budget",
      noAdmission: mode === "admission",
      badScope: mode === "scope",
      badScopeValue: mode === "false_scope" ? "false" : mode === "null_scope" ? "null" : undefined,
      abortInScope: mode === "abort",
    });
    const request = f.request();
    if (mode === "relay") request.headers.delete("X-Jungsi-Relay-Token");
    if (mode === "bearer") request.headers.delete("Authorization");
    const response = await createApiHandler(f.policies, f.ports)(request);
    assert(response.status >= 400);
    assert(!f.events.includes("business"));
    assert(
      !f.events.includes("service_authority") &&
        !f.events.includes("provider_page"),
    );
    if (["relay", "bearer"].includes(mode)) {
      assert(!f.events.includes("reserve"));
    }
    if (["scope", "false_scope", "null_scope", "abort"].includes(mode)) {
      assert(f.events.includes("settle"));
    }
  }
});
Deno.test("unapproved independent service authority prevents the first provider read", async () => {
  const f = fixture({ enabled: true, realService: true, denyAuthority: true });
  const response = await createApiHandler(f.policies, f.ports)(f.request());
  equal(response.status, 503);
  assert(
    f.events.includes("reserve") && f.events.includes("page_scope") &&
      f.events.includes("service_authority"),
  );
  assert(!f.events.includes("provider_page") && f.events.includes("settle"));
});
Deno.test("v8 recursive projection retains native values, same-year relations and pending isolation", async () => {
  for (const quotaValue of [0, "0", null] as const) {
    const f = fixture({
      enabled: true,
      realService: true,
      richHistory: true,
      quotaValue,
    });
    const response = await createApiHandler(f.policies, f.ports)(f.request());
    equal(response.status, 200);
    const body = await response.json(), row = body.items[0];
    equal(row.recruitment.value, quotaValue);
    equal(row.recruitment.stage, "unknown");
    equal(row.recruitment.condition_text, "SYN 일반 지원 조건");
    equal(row.recruitment.source_quota.quota_value, quotaValue);
    equal(
      row.recruitment.source_quota.quota_condition_text,
      "SYN 일반 지원 조건",
    );
    equal(row.history.status, "pending");
    equal(row.history.items.length, 2);
    equal(
      row.history.items.map((x: { academic_year: number }) => x.academic_year),
      [2026, 2026],
    );
    equal(row.history.items[0].metrics[0].value, 0);
    equal(row.history.items[0].metrics[1].value, null);
    equal(row.history.items[0].metrics[1].entries[0].value, "12.50");
    equal(row.history.items[0].metrics[1].omitted_other_basis_count, 2);
    equal(row.history.items[1].metrics[0].value, "3.50");
    assert(
      !JSON.stringify(body).includes("SYN-PRIVATE") &&
        !JSON.stringify(body).includes("999"),
    );
  }
});
Deno.test("candidate registration and completion fail closed", async () => {
  const f = fixture({ enabled: true });
  for (
    const bad of [{ ...current, path: "/api/v1/other" }, {
      ...current,
      method: "POST" as const,
    }, { ...current, member_tiers: ["paid"] as const }]
  ) {
    const handler = createApiHandler(
      [...f.policies.slice(0, -1), bad],
      f.ports,
    );
    equal((await handler(f.request())).status, 404);
    equal(
      (await handler(f.request("/api/v1/admission-history/snapshots/SYN")))
        .status,
      304,
    );
  }
  const wrongProjection = {
    ...f.ports,
    currentPageScope: {
      ...f.ports.currentPageScope!,
      projection: f.ports.projection,
    },
  };
  const incomplete = createApiHandler(f.policies, wrongProjection);
  equal((await incomplete(f.request())).status, 404);
  equal(
    (await incomplete(f.request("/api/v1/admission-history/snapshots/SYN")))
      .status,
    304,
  );
  const wrongContract = { ...current, contract_ref: "SYNTHETIC-OTHER" };
  const wrongContractHandler = createApiHandler([
    ...f.policies.slice(0, -1),
    wrongContract,
  ], f.ports);
  equal((await wrongContractHandler(f.request())).status, 404);
  equal(
    (await wrongContractHandler(
      f.request("/api/v1/admission-history/snapshots/SYN"),
    )).status,
    304,
  );
  const noSchemaAuthority = {
    ...f.ports,
    currentPageScope: {
      ...f.ports.currentPageScope!,
      schemaAuthority: undefined as unknown as NonNullable<
        ApiHttpPorts["currentPageScope"]
      >["schemaAuthority"],
    },
  };
  const noSchemaHandler = createApiHandler(f.policies, noSchemaAuthority);
  equal((await noSchemaHandler(f.request())).status, 404);
  equal(
    (await noSchemaHandler(
      f.request("/api/v1/admission-history/snapshots/SYN"),
    )).status,
    304,
  );
  const stale = fixture({ enabled: true, finalFailure: true });
  const response = await createApiHandler(stale.policies, stale.ports)(
    stale.request(),
  );
  equal(response.status, 409);
  assert(!stale.events.includes("deliver"));
});
Deno.test("independent schema authority binds exact contract and digest before business and rechecks revocation", async () => {
  const wrong = fixture({
    enabled: true,
    realService: true,
    schemaMismatch: true,
  });
  const first = await createApiHandler(wrong.policies, wrong.ports)(
    wrong.request(),
  );
  equal(first.status, 503);
  assert(
    wrong.events.includes("schema_authority") &&
      !wrong.events.includes("service_authority") &&
      !wrong.events.includes("provider_page"),
  );
  for (const schemaValue of ["false", "null"] as const) {
    const malformed = fixture({
      enabled: true,
      realService: true,
      schemaValue,
    });
    const denied = await createApiHandler(malformed.policies, malformed.ports)(
      malformed.request(),
    );
    equal(denied.status, 503);
    assert(
      !malformed.events.includes("service_authority") &&
        !malformed.events.includes("provider_page"),
    );
  }
  const revoked = fixture({
    enabled: true,
    realService: true,
    schemaRevoke: true,
  });
  const second = await createApiHandler(revoked.policies, revoked.ports)(
    revoked.request(),
  );
  equal(second.status, 503);
  assert(
    revoked.events.includes("service_authority") &&
      !revoked.events.includes("deliver"),
  );
});
Deno.test("existing snapshot 304 retains original gzip and etag semantics", async () => {
  const f = fixture({ enabled: true });
  const response = await createApiHandler(f.policies, f.ports)(
    f.request("/api/v1/admission-history/snapshots/SYN"),
  );
  equal(response.status, 304);
  equal(response.headers.get("ETag"), '"' + "a".repeat(64) + '"');
  equal(response.headers.get("Content-Encoding"), "gzip");
  assert(!f.events.includes("page_scope"));
});
Deno.test("v8 real service receives the same HTTP boundary and never infers final from generic condition", async () => {
  for (const evidence of [undefined, "unresolved", "not_applicable"] as const) {
    const f = fixture({ enabled: true, realService: true, evidence });
    const response = await createApiHandler(f.policies, f.ports)(f.request());
    equal(response.status, 200);
    const body = await response.json(), row = body.items[0];
    equal(row.recruitment.value, 5);
    equal(
      row.recruitment.stage,
      evidence === "not_applicable" ? "final" : "unknown",
    );
    equal(
      row.recruitment.status,
      evidence === "not_applicable" ? "verified_official" : "pending_finality",
    );
    assert(f.events.indexOf("reserve") < f.events.indexOf("service_authority"));
    assert(
      f.events.indexOf("service_authority") < f.events.indexOf("provider_page"),
    );
  }
});
Deno.test("v8 contradictory condition comparison holds one relation without failing the page", async () => {
  const f = fixture({
    enabled: true,
    realService: true,
    richHistory: true,
    evidence: "not_applicable",
    comparisonConflict: true,
  });
  const response = await createApiHandler(f.policies, f.ports)(f.request());
  equal(response.status, 200);
  const body = await response.json(), rows = body.items[0].history.items;
  equal(rows.length, 2);
  equal(rows[0].condition_comparison, "pending");
  equal(rows[1].condition_comparison, "changed");
  equal(rows[0].metrics[0].value, 0);
  equal(rows[1].metrics[0].value, "3.50");
});

function admissionDenied(run: () => void): boolean {
  try {
    run();
    return false;
  } catch (error) {
    return error instanceof AccessError && error.http === 503;
  }
}

/** Real RuntimeRequestBudget/SharedRequestBudget; policy, store and controls are synthetic. */
function runtimeBudgetFixture(
  f: ReturnType<typeof fixture>,
  mode:
    | "ok"
    | "quota"
    | "settle_failure"
    | "expired"
    | "expire_during_work"
    | "mutate_measure"
    | "abort_during_settle"
    | "deny_control_after_settle" = "ok",
  onSettle?: () => void,
) {
  let savedRequest: BudgetRequest | undefined;
  let savedAdmission: PreparedUsageAdmission | undefined;
  let budgetNow = NOW;
  let settled = false;
  const policy = {
    assertLive: () => {},
    prepare: (request: BudgetRequest) =>
      Promise.resolve({
        status: "approved" as const,
        policyVersion: "SYNTHETIC-v1",
        approvalReferenceSha256: "a".repeat(64),
        owner: request.session.user.subjectId,
        operation: request.operation,
        memberTier: request.session.tier,
        examId: null,
        normalizedScoresSha256: null,
        calculationContextSha256: null,
        computation: "required" as const,
        demands: (["request_window", "concurrent_jobs", "result_volume"] as const).map(
          (kind) => ({
            kind,
            scope: "GLOBAL",
            periodSeconds: kind === "concurrent_jobs" ? 1n : 60n,
            ceiling: 1000000n,
            capacity: 1000000n,
            units: 1n,
          }),
        ),
      }),
  } as unknown as RuntimeUsagePolicy;
  const store: UsageBudgetStorePort = {
    reserve: (request) => {
      f.events.push("real_reserve");
      return Promise.resolve(
        mode === "quota"
          ? {
            allowed: false as const,
            code: "rate_limit_exceeded" as const,
            retryAfterSeconds: 1,
          }
          : {
            allowed: true as const,
            lease: {
              id: "SYNTHETIC-lease",
              owner: request.owner,
              policyVersion: request.policyVersion,
              createdAtUtc: NOW,
              expiresAtUtc: mode === "expired" ? NOW : NOW + 100000000n,
            },
          },
      );
    },
    settle: (_lease, outcome) => {
      f.events.push("real_settle_" + outcome);
      assert(savedRequest && savedAdmission);
      assert(
        admissionDenied(() => budget.assertRunAdmission(savedAdmission!, savedRequest!, "active")),
      );
      assert(
        admissionDenied(() =>
          budget.assertRunAdmission(
            savedAdmission!,
            savedRequest!,
            "settled_success",
          )
        ),
      );
      f.events.push("settling_token_denied");
      onSettle?.();
      if (mode === "abort_during_settle") f.controller.abort();
      settled = true;
      return mode === "settle_failure"
        ? Promise.reject(new Error("synthetic-settlement-failure"))
        : Promise.resolve();
    },
  };
  const budget = new RuntimeRequestBudget(
    policy,
    store,
    { nowUtc: () => budgetNow },
    { exists: () => Promise.resolve(false) },
    {
      current: () => {
        f.events.push("budget_control_current");
        if (settled && mode === "deny_control_after_settle") {
          f.events.push("forbidden_control_after_settle");
          return Promise.reject(new Error("unexpected post-settlement control read"));
        }
        return Promise.resolve();
      },
    } as unknown as SupabaseRuntimeControls,
    mode === "mutate_measure"
      ? (_request, result) => {
        (result as Record<string, unknown>).matching_count = 1;
        return Promise.resolve(1n);
      }
      : undefined,
  );
  const configured = f.ports.currentPageScope!;
  const ports: ApiHttpPorts = {
    ...f.ports,
    currentPageScope: currentPageBudgetScope(
      configured,
      () => Promise.resolve(budget),
      () => {
        f.events.push("active_base_current");
        assert(savedAdmission && savedRequest);
        budget.assertRunAdmission(savedAdmission, savedRequest, "active");
        return Promise.resolve();
      },
    ),
    business: {
      execute: async (request, boundary) => {
        const result = await f.ports.business.execute(request, boundary);
        if (mode === "expire_during_work") budgetNow = NOW + 100000000n;
        return result;
      },
    },
    budget: {
      run: (request, work) =>
        budget.run(request, (activeAdmission) => {
          savedRequest = request;
          savedAdmission = activeAdmission as PreparedUsageAdmission;
          f.setAdmission(activeAdmission);
          return work(activeAdmission);
        }, (stage) => {
          f.events.push("mark:" + stage);
        }),
    },
  };
  return {
    budget,
    ports,
    captured: () => ({ request: savedRequest, admission: savedAdmission }),
  };
}

Deno.test("HTTP v8 uses marked real budget issuer and only a successful settled receipt", async () => {
  const f = fixture({ enabled: true, realService: true, richHistory: true });
  const b = runtimeBudgetFixture(f);
  const response = await createApiHandler(f.policies, b.ports)(f.request());
  equal(response.status, 200);
  const { request, admission } = b.captured();
  assert(request && admission);
  b.budget.assertRunAdmission(admission, request, "settled_success");
  assert(
    admissionDenied(() => b.budget.assertRunAdmission(admission, request, "active")),
  );
  assert(
    admissionDenied(() =>
      b.budget.assertRunAdmission(admission, { ...request }, "settled_success")
    ),
  );
  assert(
    admissionDenied(() =>
      b.budget.assertRunAdmission(
        {} as PreparedUsageAdmission,
        request,
        "settled_success",
      )
    ),
  );
  const other = runtimeBudgetFixture(f);
  assert(
    admissionDenied(() => other.budget.assertRunAdmission(admission, request, "settled_success")),
  );
  assert(f.events.includes("mark:budget_business"));
  assert(f.events.includes("mark:budget_settle_success"));
  assert(f.events.includes("settling_token_denied"));
  assert(
    f.events.indexOf("real_reserve") < f.events.indexOf("service_authority"),
  );
  assert(
    f.events.indexOf("service_authority") < f.events.indexOf("provider_page"),
  );
  assert(
    f.events.indexOf("page_current") < f.events.indexOf("real_settle_success"),
  );
  equal((await response.json()).items[0].history.items.length, 2);
});

Deno.test("HTTP denied reservation, failed work and failed settlement never authorize a receipt", async () => {
  for (
    const mode of [
      "quota",
      "work_failure",
      "settle_failure",
      "expired",
      "expire_during_work",
    ] as const
  ) {
    const f = fixture({
      enabled: true,
      realService: true,
      denyAuthority: mode === "work_failure",
    });
    const b = runtimeBudgetFixture(f, mode === "work_failure" ? "ok" : mode);
    const response = await createApiHandler(f.policies, b.ports)(f.request());
    equal(response.status, mode === "quota" ? 429 : 503);
    const { request, admission } = b.captured();
    if (request && admission) {
      assert(
        admissionDenied(() => b.budget.assertRunAdmission(admission, request, "active")),
      );
      assert(
        admissionDenied(() => b.budget.assertRunAdmission(admission, request, "settled_success")),
      );
      assert(f.events.includes("settling_token_denied"));
    } else {
      assert(mode === "quota");
    }
    if (mode !== "settle_failure" && mode !== "expire_during_work") {
      assert(!f.events.includes("provider_page"));
    }
    if (mode !== "settle_failure") assert(!f.events.includes("page_current"));
    assert(!f.events.includes("deliver"));
  }
});

const REVIEW_SCHEMA = new URL(
  "../../supabase/functions/_shared/jungsi/application/history_current_page_public_registry.review-only.json",
  import.meta.url,
);
const REVIEW_RAW_SHA = "579ecbad541b8d002ea21db13312e7882fbd8fab0e19ffd060ea03c7ee6d80f0";
const REVIEW_SEMANTIC_SHA = "e5c306ab1346dc54f19e012e5fb2a6dcf31276d878c37bd0e4827ba4a364319b";
async function rawSha(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}

Deno.test("review registry exact bytes and semantic digest bind both tiers to real v8 and marked budget", async () => {
  const bytes = await Deno.readFile(REVIEW_SCHEMA);
  equal(await rawSha(bytes), REVIEW_RAW_SHA);
  equal(
    await nativeJsonSha256(JSON.parse(new TextDecoder().decode(bytes))),
    REVIEW_SEMANTIC_SHA,
  );
  for (const paid of [false, true]) {
    for (const quotaValue of [0, "0", null] as const) {
      const f = fixture({
        enabled: true,
        realService: true,
        richHistory: true,
        registryBytes: bytes,
        approvedByteSha: REVIEW_RAW_SHA,
        approvedSemanticSha: REVIEW_SEMANTIC_SHA,
        quotaValue,
        paid,
      });
      const b = runtimeBudgetFixture(f);
      const response = await createApiHandler(f.policies, b.ports)(f.request());
      equal(response.status, 200);
      const body = await response.json();
      equal(body.matching_count, null);
      equal(body.items[0].recruitment.value, quotaValue);
      equal(body.items[0].recruitment.source_quota.quota_value, quotaValue);
      equal(body.items[0].recruitment.condition_text, "SYN 일반 지원 조건");
      equal(body.items[0].history.items.length, 2);
      equal(body.items[0].history.items[0].metrics[0].value, 0);
      equal(body.items[0].history.items[1].metrics[0].value, "3.50");
      assert(
        f.events.indexOf("real_reserve") < f.events.indexOf("schema_authority"),
      );
      assert(
        f.events.indexOf("schema_authority") <
          f.events.indexOf("service_authority"),
      );
      assert(
        f.events.indexOf("page_current") <
          f.events.indexOf("real_settle_success"),
      );
      assert(f.events.includes("mark:budget_business"));
    }
  }
});

Deno.test("the independently approved byte and semantic pins both gate first business I/O", async () => {
  const bytes = await Deno.readFile(REVIEW_SCHEMA);
  const whitespaceBytes = new Uint8Array(bytes.length + 1);
  whitespaceBytes.set(bytes);
  whitespaceBytes[bytes.length] = 32;
  equal(
    await nativeJsonSha256(
      JSON.parse(new TextDecoder().decode(whitespaceBytes)),
    ),
    REVIEW_SEMANTIC_SHA,
  );
  assert(await rawSha(whitespaceBytes) !== REVIEW_RAW_SHA);
  const changed = JSON.parse(new TextDecoder().decode(bytes));
  changed.schemas.error.properties.request_id.nullable = true;
  const semanticBytes = new TextEncoder().encode(JSON.stringify(changed));
  assert(await nativeJsonSha256(changed) !== REVIEW_SEMANTIC_SHA);
  for (
    const [candidateBytes, approvedByteSha] of [
      [whitespaceBytes, REVIEW_RAW_SHA],
      [semanticBytes, await rawSha(semanticBytes)],
    ] as const
  ) {
    const f = fixture({
      enabled: true,
      realService: true,
      registryBytes: candidateBytes,
      approvedByteSha,
      approvedSemanticSha: REVIEW_SEMANTIC_SHA,
    });
    const b = runtimeBudgetFixture(f);
    const response = await createApiHandler(f.policies, b.ports)(f.request());
    equal(response.status, 503);
    assert(
      f.events.includes("real_reserve") &&
        f.events.includes("schema_authority"),
    );
    assert(
      !f.events.includes("service_authority") &&
        !f.events.includes("provider_page"),
    );
    assert(f.events.includes("real_settle_failure"));
  }
});

Deno.test("missing exact source keeps new route disabled and source byte snapshots resist mutation", async () => {
  const bytes = await Deno.readFile(REVIEW_SCHEMA);
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  const refs = [{
    id: CURRENT_PAGE_OPERATION_ID,
    contract_ref: "REVIEW_ONLY.history_current_page",
  }];
  const noBytes = new PublicResponseProjection(parsed, refs);
  const f = fixture({ enabled: true, registryBytes: bytes, realService: true });
  const b = runtimeBudgetFixture(f);
  const ports = {
    ...b.ports,
    currentPageScope: { ...b.ports.currentPageScope!, projection: noBytes },
  };
  const handler = createApiHandler(f.policies, ports);
  equal((await handler(f.request())).status, 404);
  equal(
    (await handler(f.request("/api/v1/admission-history/snapshots/SYN")))
      .status,
    304,
  );
  assert(!f.events.includes("service_authority"));
  const callerBytes = new Uint8Array(bytes);
  const projection = PublicResponseProjection.fromExactRegistryBytes(
    callerBytes,
    refs,
  );
  callerBytes.fill(0);
  const pin = await projection.schemaBinding(
    CURRENT_PAGE_OPERATION_ID,
    refs[0].contract_ref,
  );
  equal(pin.schema_bytes_sha256, REVIEW_RAW_SHA);
  equal(pin.schema_sha256, REVIEW_SEMANTIC_SHA);
  for (
    const invalid of [
      new Uint8Array([0xff]),
      new TextEncoder().encode('{"x":1,"x":2}'),
    ]
  ) {
    assert(
      admissionDenied(() => PublicResponseProjection.fromExactRegistryBytes(invalid, refs)),
    );
  }
});

Deno.test("current page rejects a non-null matching count even when an integer schema permits it", async () => {
  const f = fixture({ enabled: true, invalidMatchingCount: true });
  const b = runtimeBudgetFixture(f);
  const response = await createApiHandler(f.policies, b.ports)(f.request());
  equal(response.status, 503);
  assert(
    f.events.includes("business") && f.events.includes("real_settle_failure"),
  );
  assert(!f.events.includes("deliver"));
});

Deno.test("measurement mutation and post-settlement replacement cannot change current page values", async () => {
  const bytes = await Deno.readFile(REVIEW_SCHEMA);
  for (
    const mode of ["mutate_measure", "replace_count", "replace_value"] as const
  ) {
    const f = fixture({
      enabled: true,
      realService: true,
      registryBytes: bytes,
      approvedByteSha: REVIEW_RAW_SHA,
      approvedSemanticSha: REVIEW_SEMANTIC_SHA,
    });
    const b = runtimeBudgetFixture(
      f,
      mode === "mutate_measure" ? "mutate_measure" : "ok",
    );
    const ports: ApiHttpPorts = mode === "mutate_measure" ? b.ports : {
      ...b.ports,
      budget: {
        run: async <T>(
          request: BudgetRequest,
          work: (admission?: unknown) => Promise<T>,
        ): Promise<T> => {
          const result = await b.ports.budget.run(request, work);
          const replacement = structuredClone(result) as Record<
            string,
            unknown
          >;
          if (mode === "replace_count") replacement.matching_count = 1;
          else {
            const row = (replacement.items as Record<string, unknown>[])[0];
            (row.recruitment as Record<string, unknown>).value = 999;
          }
          return replacement as T;
        },
      },
    };
    const response = await createApiHandler(f.policies, ports)(f.request());
    equal(response.status, 503);
    assert(
      f.events.includes("real_settle_success") && !f.events.includes("deliver"),
    );
  }
});

Deno.test("mutation after response serialization is rejected before delivery", async () => {
  const bytes = await Deno.readFile(REVIEW_SCHEMA);
  const f = fixture({
    enabled: true,
    realService: true,
    registryBytes: bytes,
    approvedByteSha: REVIEW_RAW_SHA,
    approvedSemanticSha: REVIEW_SEMANTIC_SHA,
  });
  const b = runtimeBudgetFixture(f);
  let returned: Record<string, unknown> | undefined;
  const originalCompletion = b.ports.completion!;
  const ports: ApiHttpPorts = {
    ...b.ports,
    budget: {
      run: async <T>(
        request: BudgetRequest,
        work: (admission?: unknown) => Promise<T>,
      ): Promise<T> =>
        await b.ports.budget.run(request, async (admission) => {
          const value = await work(admission);
          returned = value as Record<string, unknown>;
          return value;
        }),
    },
    completion: {
      ...originalCompletion,
      current: async () => {
        await originalCompletion.current();
        assert(returned);
        returned.matching_count = 1;
      },
    },
  };
  const response = await createApiHandler(f.policies, ports)(f.request());
  equal(response.status, 503);
  assert(
    f.events.includes("real_settle_success") && !f.events.includes("deliver"),
  );
});

Deno.test("current page does not invoke the legacy representation encoder after settlement", async () => {
  const bytes = await Deno.readFile(REVIEW_SCHEMA);
  const f = fixture({
    enabled: true,
    realService: true,
    registryBytes: bytes,
    approvedByteSha: REVIEW_RAW_SHA,
    approvedSemanticSha: REVIEW_SEMANTIC_SHA,
  });
  const b = runtimeBudgetFixture(f);
  let called = false;
  const ports: ApiHttpPorts = {
    ...b.ports,
    representation: {
      encode: (_request, _value) => {
        called = true;
        return Promise.resolve(null);
      },
    },
  };
  const response = await createApiHandler(f.policies, ports)(f.request());
  equal(response.status, 200);
  equal((await response.json()).matching_count, null);
  assert(!called && f.events.includes("deliver"));
});

Deno.test("final external page and base-head checks finish before successful settlement", async () => {
  const bytes = await Deno.readFile(REVIEW_SCHEMA);
  const f = fixture({
    enabled: true,
    realService: true,
    registryBytes: bytes,
    approvedByteSha: REVIEW_RAW_SHA,
    approvedSemanticSha: REVIEW_SEMANTIC_SHA,
  });
  const b = runtimeBudgetFixture(f);
  const response = await createApiHandler(f.policies, b.ports)(f.request());
  equal(response.status, 200);
  const settled = f.events.indexOf("real_settle_success");
  equal(f.events.filter((event) => event === "page_current").length, 1);
  equal(f.events.filter((event) => event === "active_base_current").length, 1);
  equal(f.events.filter((event) => event === "schema_authority").length, 2);
  assert(f.events.indexOf("page_current") < f.events.indexOf("active_base_current"));
  assert(f.events.indexOf("active_base_current") < settled);
  assert(f.events.lastIndexOf("schema_authority") < settled);
  assert(f.events.indexOf("finish") > settled);
  const state = f.scopeState();
  assert(
    state.request && state.boundary && Object.isFrozen(state.request) &&
      Object.isFrozen(state.boundary),
  );
});

Deno.test("current-page post-settlement completion is local while legacy snapshot keeps final I/O", async () => {
  const f = fixture({ enabled: true });
  const b = runtimeBudgetFixture(f);
  let external = 0, local = 0;
  const existing = () => {
    external++;
    return Promise.resolve();
  };
  const localP1 = () => {
    local++;
  };
  await runtimeCompletionCurrent(CURRENT_PAGE_OPERATION_ID, b.budget, existing, localP1);
  equal(external, 0);
  equal(local, 1);
  await runtimeCompletionCurrent("history.snapshot.read", b.budget, existing, localP1);
  equal(external, 1);
  equal(local, 2);
  let denied = false;
  try {
    await runtimeCompletionCurrent(CURRENT_PAGE_OPERATION_ID, undefined, existing, localP1);
  } catch (error) {
    denied = error instanceof AccessError && error.http === 503;
  }
  assert(denied);
  equal(external, 1);
});

Deno.test("settled receipt cannot be replayed across request or boundary identities", async () => {
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f);
  const response = await createApiHandler(f.policies, b.ports)(f.request());
  equal(response.status, 200);
  const { request, boundary } = f.scopeState();
  assert(request && boundary);
  const scope = b.ports.currentPageScope!;
  await scope.assertReceipt(request, boundary);
  for (
    const [r, token] of [
      [{ ...request }, boundary],
      [request, Object.freeze({ ...boundary })],
    ] as const
  ) {
    let denied = false;
    try {
      await scope.assertReceipt(r, token);
    } catch (error) {
      denied = error instanceof AccessError && error.http === 503;
    }
    assert(denied);
  }
});

Deno.test("final authority rejection and abort during settlement never deliver current page", async () => {
  for (const badCurrent of ["false", "null", "throw"] as const) {
    const f = fixture({ enabled: true, realService: true, badCurrent });
    const b = runtimeBudgetFixture(f);
    const response = await createApiHandler(f.policies, b.ports)(f.request());
    equal(response.status, 503);
    assert(f.events.includes("page_current") && f.events.includes("real_settle_failure"));
    assert(!f.events.includes("active_base_current") && !f.events.includes("deliver"));
  }
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f, "abort_during_settle");
  const response = await createApiHandler(f.policies, b.ports)(f.request());
  equal(response.status, 503);
  assert(f.events.includes("active_base_current") && f.events.includes("real_settle_success"));
  assert(!f.events.includes("deliver"));
});

Deno.test("current page does not reread budget controls after settlement", async () => {
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f, "deny_control_after_settle");
  const response = await createApiHandler(f.policies, b.ports)(f.request());
  equal(response.status, 200);
  assert(f.events.includes("budget_control_current"));
  assert(f.events.lastIndexOf("budget_control_current") < f.events.indexOf("real_settle_success"));
  assert(!f.events.includes("forbidden_control_after_settle"));
  assert(f.events.includes("deliver"));
});

function withRequestFactory(
  f: ReturnType<typeof fixture>,
  b: ReturnType<typeof runtimeBudgetFixture>,
  factory: RequestScopedCurrentPagePortsFactory,
): ApiHttpPorts {
  return {
    ...b.ports,
    business: {
      execute: async (raw, boundary) => {
        if (raw.operation !== CURRENT_PAGE_OPERATION_ID || !boundary) {
          throw new AccessError("security_policy_unavailable", 503);
        }
        const request = raw as ApiExecution & CurrentPageExecution;
        const pagePorts = await resolveCurrentPageRequestPorts(
          factory,
          request,
          boundary,
          b.budget,
          { nowUtc: () => NOW },
        );
        return await new HistoryCurrentPageService(pagePorts, { nowUtc: () => NOW }, f.limits)
          .execute(request, boundary);
      },
    },
  };
}

Deno.test("request factory uses real active budget and cannot reuse guard after settlement", async () => {
  const f = fixture({ enabled: true, realService: true, richHistory: true });
  const b = runtimeBudgetFixture(f);
  let context: Parameters<RequestScopedCurrentPagePortsFactory>[0] | undefined;
  let chunks = 0;
  const factory: RequestScopedCurrentPagePortsFactory = (arg) => {
    context = arg;
    const original = f.pagePorts.offerings!;
    return Promise.resolve({
      ...f.pagePorts,
      offerings: {
        page: async (ctx, query, after) => {
          arg.assertActive(ctx);
          chunks++;
          const result = await original.page(ctx, query, after);
          arg.assertActive(ctx);
          return result;
        },
      },
    });
  };
  const response = await createApiHandler(f.policies, withRequestFactory(f, b, factory))(
    f.request(),
  );
  equal(response.status, 200);
  equal(chunks, 1);
  assert(context);
  assert(admissionDenied(() => context!.assertActive(context!)));
  equal(f.events.filter((e) => e === "provider_page").length, 1);
});

Deno.test("request factory rejects cross-request, copied boundary and other budget issuer", async () => {
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f), other = runtimeBudgetFixture(f);
  let factoryCalls = 0;
  const factory: RequestScopedCurrentPagePortsFactory = (arg) => {
    factoryCalls++;
    assert(
      admissionDenied(() =>
        arg.assertActive({ execution: { ...arg.execution }, boundary: arg.boundary })
      ),
    );
    assert(
      admissionDenied(() =>
        arg.assertActive({ execution: arg.execution, boundary: { ...arg.boundary } })
      ),
    );
    return Promise.resolve(f.pagePorts);
  };
  const ports: ApiHttpPorts = {
    ...b.ports,
    business: {
      execute: async (raw, boundary) => {
        assert(boundary && raw.operation === CURRENT_PAGE_OPERATION_ID);
        const request = raw as ApiExecution & CurrentPageExecution;
        try {
          await resolveCurrentPageRequestPorts(
            factory,
            request,
            boundary,
            other.budget,
            { nowUtc: () => NOW },
          );
          throw new Error("other issuer was accepted");
        } catch (error) {
          assert(error instanceof AccessError && error.http === 503);
        }
        equal(factoryCalls, 0);
        const wrapped = await resolveCurrentPageRequestPorts(
          factory,
          request,
          boundary,
          b.budget,
          { nowUtc: () => NOW },
        );
        return await new HistoryCurrentPageService(wrapped, { nowUtc: () => NOW }, f.limits)
          .execute(request, boundary);
      },
    },
  };
  equal((await createApiHandler(f.policies, ports)(f.request())).status, 200);
  equal(factoryCalls, 1);
});

Deno.test("aborted request during factory cannot enter first provider", async () => {
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f);
  const factory: RequestScopedCurrentPagePortsFactory = async () => {
    await Promise.resolve();
    f.controller.abort();
    return f.pagePorts;
  };
  const response = await createApiHandler(f.policies, withRequestFactory(f, b, factory))(
    f.request(),
  );
  equal(response.status, 503);
  assert(!f.events.includes("service_authority"));
  assert(!f.events.includes("provider_page"));
  assert(!f.events.includes("deliver"));
});

Deno.test("abort during a provider call is caught before any later provider", async () => {
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f);
  const factory: RequestScopedCurrentPagePortsFactory = (arg) => {
    const original = f.pagePorts.offerings!;
    return Promise.resolve({
      ...f.pagePorts,
      offerings: {
        page: async (ctx, query, after) => {
          arg.assertActive(ctx);
          const result = await original.page(ctx, query, after);
          f.controller.abort();
          return result;
        },
      },
    });
  };
  const response = await createApiHandler(f.policies, withRequestFactory(f, b, factory))(
    f.request(),
  );
  equal(response.status, 503);
  assert(f.events.includes("provider_page"));
  assert(!f.events.includes("deliver"));
});

Deno.test("factory guard rejects while settling and after failed settlement", async () => {
  const f = fixture({ enabled: true, realService: true });
  let context: Parameters<RequestScopedCurrentPagePortsFactory>[0] | undefined;
  let settling = 0;
  const b = runtimeBudgetFixture(f, "settle_failure", () => {
    assert(context);
    assert(admissionDenied(() => context!.assertActive(context!)));
    settling++;
  });
  const factory: RequestScopedCurrentPagePortsFactory = (arg) => {
    context = arg;
    return Promise.resolve(f.pagePorts);
  };
  const response = await createApiHandler(f.policies, withRequestFactory(f, b, factory))(
    f.request(),
  );
  equal(response.status, 503);
  assert(settling > 0 && context);
  assert(admissionDenied(() => context!.assertActive(context!)));
  assert(!f.events.includes("deliver"));
});

Deno.test("relay, session, scope, expired and denied budget prevent request factory I/O", async () => {
  for (const mode of ["relay", "bearer", "scope", "quota", "expired"] as const) {
    const f = fixture({ enabled: true, realService: true, badScope: mode === "scope" });
    const b = runtimeBudgetFixture(
      f,
      mode === "quota" ? "quota" : mode === "expired" ? "expired" : "ok",
    );
    let calls = 0;
    const factory: RequestScopedCurrentPagePortsFactory = () => {
      calls++;
      return Promise.resolve(f.pagePorts);
    };
    const request = f.request();
    if (mode === "relay") request.headers.delete("X-Jungsi-Relay-Token");
    if (mode === "bearer") request.headers.delete("Authorization");
    const response = await createApiHandler(f.policies, withRequestFactory(f, b, factory))(request);
    if (mode === "quota") equal(response.status, 429);
    else if (mode === "scope" || mode === "expired") equal(response.status, 503);
    else assert(response.status >= 400);
    equal(calls, 0);
    assert(!f.events.includes("provider_page"));
  }
});
Deno.test("legacy static ports pass through unchanged without the new factory guard", async () => {
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f);
  const ports: ApiHttpPorts = {
    ...b.ports,
    business: {
      execute: async (raw, boundary) => {
        assert(boundary && raw.operation === CURRENT_PAGE_OPERATION_ID);
        const request = raw as ApiExecution & CurrentPageExecution;
        const same = await resolveCurrentPageRequestPorts(
          f.pagePorts,
          request,
          boundary,
          undefined,
          { nowUtc: () => NOW },
        );
        assert(same === f.pagePorts);
        return await new HistoryCurrentPageService(same, { nowUtc: () => NOW }, f.limits)
          .execute(request, boundary);
      },
    },
  };
  equal((await createApiHandler(f.policies, ports)(f.request())).status, 200);
});

Deno.test("factory port accessors are rejected without executing getter I/O", async () => {
  const f = fixture({ enabled: true, realService: true });
  const b = runtimeBudgetFixture(f);
  let getterRuns = 0;
  const factory: RequestScopedCurrentPagePortsFactory = () =>
    Promise.resolve({
      ...f.pagePorts,
      get offerings() {
        getterRuns++;
        return f.pagePorts.offerings;
      },
    });
  const response = await createApiHandler(f.policies, withRequestFactory(f, b, factory))(
    f.request(),
  );
  equal(response.status, 503);
  equal(getterRuns, 0);
  assert(!f.events.includes("service_authority"));
  assert(!f.events.includes("provider_page"));
});
