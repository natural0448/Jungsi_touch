// Scoped writer tests, isolated from the retained foundation suite.
import { syncPromise, assert, equal } from "../edge/fixture.ts";
import { UniversityAnalysisService, type PublishedForecastPort } from "../../supabase/functions/_shared/jungsi/application/university_analysis.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { CatalogService, type CatalogRelease } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SyntheticNativeRepository } from "../edge/synthetic_platform_repository.ts";
import { syntheticOfferingAnalysisFixture } from "../edge/synthetic_offering_analysis.ts";
import { projectMemberSchoolResultBatches } from "../../supabase/functions/_shared/jungsi/application/member_school_results.ts";
import type { ScoreInputWorkflowPort } from "../../supabase/functions/_shared/jungsi/application/score_input_ports.ts";

const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002",
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
async function denied(run: () => Promise<unknown>, code: string, http: number) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
  equal(error.http, http);
}
Deno.test("member-result stage writes internal references with the report revision and does not expose them", async () => {
  const f = fixture();
  // The legacy fixture omits a field supplied by the real overall-analysis DTO.
  (f.repo.reports.get(RID)!.body.overall as NativeObject).pack_version =
    f.repo.profiles.get(PID)!.scores.pack_version;
  let staged = 0;
  const service = new UniversityAnalysisService(f.repo, f.catalog, f.data, f.clock, null,
    { mode: "legacy_synthetic" }, null, null, {
      async stage(owner, profile, report, rows) {
        const documents = await projectMemberSchoolResultBatches(owner, profile, report, rows);
        equal(report.revision, 2);
        equal(documents.length, 1);
        staged++;
        return [{ object_key: "SYNTHETIC-private", sha256: "a".repeat(64), bytes: 1,
          source_report_revision: report.revision }];
      },
    });
  const response = await service.execute(request());
  equal(staged, 1);
  assert(!Object.hasOwn(response, "member_school_results_refs"));
  assert(Array.isArray(f.repo.reports.get(RID)!.body.member_school_results_refs));
  assert(Object.hasOwn(response.analyses as NativeObject, OID));
});

Deno.test("member-result stage failure preserves the existing report", async () => {
  const f = fixture();
  const service = new UniversityAnalysisService(f.repo, f.catalog, f.data, f.clock, null,
    { mode: "legacy_synthetic" }, null, null, {
      async stage() { throw new AccessError("storage_unavailable", 503); },
    });
  await denied(() => service.execute(request()), "storage_unavailable", 503);
  equal(f.repo.reports.get(RID)!.revision, 1);
});

Deno.test("member-result stage materializes a cached legacy report only once", async () => {
  const f = fixture();
  (f.repo.reports.get(RID)!.body.overall as NativeObject).pack_version =
    f.repo.profiles.get(PID)!.scores.pack_version;
  const workflow: ScoreInputWorkflowPort = {
    async saveProfile() { throw new Error("not used"); },
    async assertProfile() {},
    async reusableOverall() { return null; },
    async analysisContext() { return "SYNTHETIC-context"; },
    origin(_session, operation, componentKeys) {
      return { passId: null, accessBasis: "verified_admin", operation, componentKeys };
    },
    async snapshotScope() { return { overall: false, analysisIds: [], candidates: false, legacyVerified: false }; },
    async deliver() {},
  };
  const mode = { mode: "rights" as const, workflow };
  const prior = new UniversityAnalysisService(f.repo, f.catalog, f.data, f.clock, null, mode);
  await prior.execute(request("university.analyze", { expected_version: 1, offering_ids: [OID] }, "old"));
  let staged = 0;
  const service = new UniversityAnalysisService(f.repo, f.catalog, f.data, f.clock, null, mode,
    null, null, {
      async stage(owner, profile, report, rows) {
        await projectMemberSchoolResultBatches(owner, profile, report, rows);
        staged++;
        return [{ object_key: "SYNTHETIC-private", sha256: "a".repeat(64), bytes: 1,
          source_report_revision: report.revision }];
      },
    });
  const result = await service.execute(request("university.analyze", { expected_version: 2, offering_ids: [OID] }, "next"));
  equal(result.report_version, 3);
  equal(staged, 1);
  const repeated = await service.execute(request("university.analyze", { expected_version: 3, offering_ids: [OID] }, "later"));
  equal(repeated.report_version, 3);
  equal(staged, 1);
});
