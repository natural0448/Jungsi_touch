// Independent synthetic cancellation suite; does not import or register the foundation suite.
import { nativeJsonText } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  type PublishedForecastPort,
  UniversityAnalysisService,
} from "../../supabase/functions/_shared/jungsi/application/university_analysis.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type CatalogRelease,
  CatalogService,
} from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { syntheticOfferingAnalysisFixture } from "./synthetic_offering_analysis.ts";
import { assert, equal, syncPromise } from "./fixture.ts";
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
Deno.test("cancelled university work does not start a later offering or write a partial report", async () => {
  for (const op of ["university.analyze", "candidates.build"] as const) {
    const f = fixture();
    const controller = new AbortController();
    const visited: string[] = [];
    const data = {
      ...f.data,
      getAnalysis(id: string) {
        visited.push(id);
        controller.abort();
        return f.data.getAnalysis(id);
      },
    };
    const service = new UniversityAnalysisService(
      f.repo,
      f.catalog,
      data,
      f.clock,
      null,
      { mode: "legacy_synthetic" },
    );
    const previous = nativeJsonText(f.repo.reports.get(RID)!.body, true);
    const body: NativeObject = op === "university.analyze"
      ? { expected_version: 1, offering_ids: [OID, "SYNTHETIC-B-2027"] }
      : { expected_version: 1 };
    await denied(
      () => service.execute(request(op, body), { signal: controller.signal, admission: {} }),
      "security_policy_unavailable",
      503,
    );
    equal(visited, [OID]);
    equal(f.repo.reports.get(RID)!.revision, 1);
    equal(nativeJsonText(f.repo.reports.get(RID)!.body, true), previous);
  }
});

Deno.test("cancelled calculation does not start the next expensive dependency", async () => {
  for (const stopAt of ["conversion", "percentile"] as const) {
    const f = fixture();
    const controller = new AbortController();
    let percentiles = 0;
    let analyses = 0;
    const data = {
      ...f.data,
      getConversion(id: string) {
        if (stopAt === "conversion") controller.abort();
        return f.data.getConversion(id);
      },
      getPercentile(id: string) {
        percentiles++;
        if (stopAt === "percentile") controller.abort();
        return f.data.getPercentile(id);
      },
      getAnalysis(id: string) {
        analyses++;
        return f.data.getAnalysis(id);
      },
    };
    const service = new UniversityAnalysisService(
      f.repo,
      f.catalog,
      data,
      f.clock,
      null,
      { mode: "legacy_synthetic" },
    );
    await denied(
      () => service.execute(request(), { signal: controller.signal, admission: {} }),
      "security_policy_unavailable",
      503,
    );
    equal(percentiles, stopAt === "conversion" ? 0 : 1);
    equal(analyses, 0);
    equal(f.repo.reports.get(RID)!.revision, 1);
  }
});

Deno.test("cancelled replay does not deliver a saved result or modify its receipt", async () => {
  const f = fixture();
  const r = request();
  const success = await f.service.execute(r);
  const receiptCount = f.repo.requests.size;
  const saved = nativeJsonText(f.repo.reports.get(RID)!.body, true);
  const controller = new AbortController();
  const originalReplay = f.repo.replay.bind(f.repo);
  f.repo.replay = (owner, operation, key, digest) => {
    controller.abort();
    return originalReplay(owner, operation, key, digest);
  };
  await denied(
    () => f.service.execute(r, { signal: controller.signal, admission: {} }),
    "security_policy_unavailable",
    503,
  );
  equal(f.repo.requests.size, receiptCount);
  equal(f.repo.reports.get(RID)!.revision, 2);
  equal(nativeJsonText(f.repo.reports.get(RID)!.body, true), saved);
  assert(objectHasResult(success));
});

function objectHasResult(value: NativeObject): boolean {
  return typeof value === "object" && value !== null;
}

Deno.test("cancelled cached analysis does not start no-op receipt write", async () => {
  const f = fixture();
  const controller = new AbortController();
  let cancelContext = false;
  const workflow = {
    assertProfile: () => Promise.resolve(),
    analysisContext: () => {
      if (cancelContext) controller.abort();
      return Promise.resolve("SYNTHETIC-analysis-context");
    },
    origin: () => ({
      passId: null,
      accessBasis: "verified_admin",
      operation: "university.analyze",
      componentKeys: [],
    }),
  };
  const mode = {
    mode: "rights",
    workflow,
  } as unknown as import("../../supabase/functions/_shared/jungsi/application/profile_reports.ts").ScoreWorkflowMode;
  const service = new UniversityAnalysisService(f.repo, f.catalog, f.data, f.clock, null, mode);
  await service.execute(
    request(
      "university.analyze",
      { expected_version: 1, offering_ids: [OID] },
      "SYNTHETIC-cache-first",
    ),
  );
  const saved = nativeJsonText(f.repo.reports.get(RID)!.body, true);
  const receiptCount = f.repo.requests.size;
  let writes = 0;
  const originalWrite = f.repo.writeReport.bind(f.repo);
  f.repo.writeReport = (input) => {
    writes++;
    return originalWrite(input);
  };
  cancelContext = true;
  await denied(
    () =>
      service.execute(
        request(
          "university.analyze",
          { expected_version: 2, offering_ids: [OID] },
          "SYNTHETIC-cache-second",
        ),
        { signal: controller.signal, admission: {} },
      ),
    "security_policy_unavailable",
    503,
  );
  equal(writes, 0);
  equal(f.repo.requests.size, receiptCount);
  equal(f.repo.reports.get(RID)!.revision, 2);
  equal(nativeJsonText(f.repo.reports.get(RID)!.body, true), saved);
});

Deno.test("cancelled analysis does not start reference prefetch", async () => {
  const f = fixture();
  const controller = new AbortController();
  let prefetchCalls = 0;
  const data = {
    ...f.data,
    referenceTailPins: () => {
      controller.abort();
      return Promise.resolve(null);
    },
    prefetchReferenceTails: () => {
      prefetchCalls++;
      return Promise.resolve();
    },
  };
  const service = new UniversityAnalysisService(f.repo, f.catalog, data, f.clock, null, {
    mode: "legacy_synthetic",
  });
  const previous = nativeJsonText(f.repo.reports.get(RID)!.body, true);
  await denied(
    () => service.execute(request(), { signal: controller.signal, admission: {} }),
    "security_policy_unavailable",
    503,
  );
  equal(prefetchCalls, 0);
  equal(f.repo.requests.size, 0);
  equal(f.repo.reports.get(RID)!.revision, 1);
  equal(nativeJsonText(f.repo.reports.get(RID)!.body, true), previous);
});

Deno.test("cancelled request never enters the scoring batch provider", async () => {
  for (const operation of ["university.analyze", "candidates.build"] as const) {
    const f = fixture();
    const controller = new AbortController();
    let batchCalls = 0;
    const data = {
      ...f.data,
      referenceTailPins: () => {
        controller.abort();
        return Promise.resolve(null);
      },
      withScoringBatch<T>(work: () => Promise<T>, _signal?: AbortSignal): Promise<T> {
        batchCalls++;
        return work();
      },
    };
    const service = new UniversityAnalysisService(f.repo, f.catalog, data, f.clock, null, {
      mode: "legacy_synthetic",
    });
    const saved = nativeJsonText(f.repo.reports.get(RID)!.body, true);
    const body: NativeObject = operation === "university.analyze"
      ? { expected_version: 1, offering_ids: [OID] }
      : { expected_version: 1 };
    await denied(
      () => service.execute(request(operation, body), { signal: controller.signal, admission: {} }),
      "security_policy_unavailable",
      503,
    );
    equal(batchCalls, 0);
    equal(f.repo.requests.size, 0);
    equal(f.repo.reports.get(RID)!.revision, 1);
    equal(nativeJsonText(f.repo.reports.get(RID)!.body, true), saved);
  }
});
