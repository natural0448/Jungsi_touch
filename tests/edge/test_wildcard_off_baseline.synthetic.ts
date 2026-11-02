/** Synthetic exact-byte default-OFF comparison against the original f137 service graph. */
import { assert, syncPromise } from "./fixture.ts";
import {
  type PublishedForecastPort,
  UniversityAnalysisService,
} from "../../supabase/functions/_shared/jungsi/application/university_analysis.ts";
import {
  type CatalogRelease,
  CatalogService,
} from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { syntheticOfferingAnalysisFixture } from "./synthetic_offering_analysis.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { OverallAnalysisService } from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
import {
  canonicalApiPolicies,
  canonicalPublicResponseSchemas,
} from "./public_api_contract_fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  PID = "SYNTHETIC-profile",
  RID = "SYNTHETIC-report",
  OID = "SYNTHETIC-A-2027",
  NOW = 1700000000000000n,
  TIME = "2023-11-14T22:13:20Z";
function request(
  op: "university.analyze" | "candidates.build" = "university.analyze",
  body: NativeObject = { expected_version: 1, offering_ids: [OID] },
  key = "SYNTHETIC-key",
): ApiExecution {
  return {
    operation: op,
    body,
    query: {},
    params: { report_id: RID },
    requestKey: key,
    management: null,
    session: {
      user: { subjectId: OWNER, expiresAtUtc: NOW + 1000000n },
      evaluatedAtUtc: NOW,
      tier: "paid",
      paidUntilUtc: NOW + 500000n,
    },
  };
}
function fixture(forecasts: PublishedForecastPort | null = null) {
  const f = syntheticOfferingAnalysisFixture(),
    repo = new SyntheticNativeRepository();
  let now = NOW, catalogReads = 0;
  repo.profiles.set(PID, {
    profile_id: PID,
    owner_id: OWNER,
    scores: f.data.scores(),
    confirmed: true,
    created_at: TIME,
  });
  repo.reports.set(RID, {
    report_id: RID,
    owner_id: OWNER,
    profile_id: PID,
    revision: 1,
    updated_at: TIME,
    body: {
      overall: f.overall,
      analyses: {},
      candidates: null,
      shortlist: {
        [OID]: {
          selected: true,
          assessment_status: "pending",
          profile_id: PID,
        },
      },
      catalog_version: null,
      analysis_status: {
        status: "pending",
        reason_code: "offering_analysis_not_requested",
      },
    },
  });
  const a = {
      ...f.data.offering,
      university_name: "가상대학교",
      region: "가상지역",
      wildcard_group: "nursing",
      practical_required: false,
    },
    b = {
      ...a,
      offering_id: "SYNTHETIC-B-2027",
      university_id: "SYNTHETIC-B",
      university_name: "가상예술대학교",
      department: "가상예술 비실기",
      wildcard_group: null,
    },
    c = {
      ...b,
      offering_id: "SYNTHETIC-C-2027",
      department: "가상실기",
      practical_required: true,
    },
    old = { ...a, offering_id: "SYNTHETIC-A-2026", academic_year: 2026 };
  const state: { catalog: CatalogRelease | null } = {
    catalog: {
      version: "SYNTHETIC-catalog.v1",
      status: "approved",
      asOfUtc: NOW,
      offerings: [a, b, c, old],
      history: [],
    },
  };
  const clock = { nowUtc: () => now },
    catalog = new CatalogService({
      getCatalog() {
        return syncPromise(() => {
          catalogReads++;
          return state.catalog;
        });
      },
    }, clock);
  const data = {
    getExamPack: f.data.getExamPack.bind(f.data),
    getConversion: f.data.getConversion.bind(f.data),
    getPercentile(id: string) {
      return syncPromise(() => {
        if (id !== OID) return null;
        const curve = f.settings.curves.get(2027)!;
        return {
          version: "SYNTHETIC-percentile.v1",
          status: "approved",
          releaseId: "SYNTHETIC-percentile-release",
          academicYear: 2027,
          examId: f.data.pack!.examId,
          sourcePackVersion: f.data.pack!.packVersion,
          examType: "csat",
          ruleVersion: "SYNTHETIC-A-2027",
          curve,
          bindings: [{
            ...f.data.offering,
            offering_pk: OID,
            rule_version: "SYNTHETIC-A-2027",
            curve_version: curve.metadata.curve_version,
          }],
        };
      });
    },
    getAnalysis(id: string) {
      return syncPromise(() => {
        return id.startsWith("SYNTHETIC-A-") ? f.release() : null;
      });
    },
  };
  return {
    f,
    repo,
    state,
    data,
    catalog,
    clock,
    catalogReads: () => catalogReads,
    expire: () => {
      now = NOW + 2000000n;
    },
    service: new UniversityAnalysisService(
      repo,
      catalog,
      data,
      clock,
      forecasts,
      { mode: "legacy_synthetic" },
    ),
  };
}

async function preparedFixture() {
  const f = fixture();
  const overall = await new OverallAnalysisService({
    getExamPack: f.data.getExamPack,
    getTotalModel: () => Promise.resolve(null),
  }).analyze(request().session, f.repo.profiles.get(PID)!.scores) as NativeObject;
  Object.assign(overall.overall as NativeObject, f.f.overall.overall as NativeObject, {
    status: "estimated",
    reason_code: null,
    top_percent: "50",
    inclusive_top_percent: "50",
    exclusive_top_percent: "49",
    tie_share_percent: "1",
    tie_interval_percent: { lower: "49", upper: "50" },
    tie_policy: "include_equal",
    population_id: "SYNTHETIC-population",
    data_kind: "synthetic",
  });
  const report = f.repo.reports.get(RID)!;
  report.body.overall = overall;
  Object.assign((report.body.shortlist as NativeObject)[OID] as NativeObject, {
    changed_at: TIME,
    catalog_version: "SYNTHETIC-catalog.v1",
  });
  return f;
}

Deno.test("default-off member response and replay match pinned baseline bytes", async () => {
  const f = await preparedFixture(), relay = "SYNTHETIC-relay-00000000000000000000";
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(relay),
    clock: f.clock,
    sessions: {
      verifyUserBearer: () => Promise.resolve({ subjectId: OWNER, expiresAtUtc: NOW + 1000000n }),
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
    reports: { lookupAccess: () => Promise.resolve({ ownerId: OWNER, confirmed: true }) },
    authorities: {
      readCurrent: () => {
        throw new Error("unexpected");
      },
    },
    resources: {
      readScope: () => {
        throw new Error("unexpected");
      },
    },
    projection: new PublicResponseProjection(
      canonicalPublicResponseSchemas(),
      canonicalApiPolicies(),
    ),
    budget: { run: async (_r, work) => await work() },
    business: f.service,
  };
  const handler = createApiHandler(canonicalApiPolicies(), ports);
  const make = () =>
    new Request("https://synthetic.invalid/api/v1/reports/" + RID + "/candidates", {
      method: "POST",
      headers: {
        Authorization: "Bearer SYNTHETIC-token",
        "X-Jungsi-Relay-Token": relay,
        "Idempotency-Key": "SYNTHETIC-same-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expected_version: 1 }),
    });
  const a = await handler(make()), b = await handler(make());
  assert(a.status === 200 && b.status === 200);
  const first = await a.text(), replay = await b.text();
  assert(first === replay);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(first));
  const hash = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  console.log(
    "SYNTHETIC_OFF_BODY_SHA256=" + hash + ";bytes=" + new TextEncoder().encode(first).length,
  );
  assert(hash === "15b1243691c8b3cdc3f5da96e4162eb6a5473482f585f68b5b13145b0c63ba72");
});
