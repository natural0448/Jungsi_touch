import { syncPromise } from "./fixture.ts";
import {
  candidateGroups,
  productionCandidateRows,
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
import { assert, equal } from "./fixture.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { PinnedSchoolReferenceSource } from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  canonicalApiPolicies,
  canonicalPublicResponseSchemas,
} from "./public_api_contract_fixture.ts";
import { OverallAnalysisService } from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
Deno.test("completed university and candidate keys reject forbidden query before replay", async () => {
  for (const op of ["university.analyze", "candidates.build"] as const) {
    const f = fixture(),
      r = request(
        op,
        op === "university.analyze"
          ? { expected_version: 1, offering_ids: [OID] }
          : { expected_version: 1 },
      );
    const first = await f.service.execute(r),
      replays = f.repo.events.filter((e) => e === "replay").length,
      reads = f.catalogReads();
    await denied(
      () => f.service.execute({ ...r, query: { unexpected: "SYNTHETIC" } }),
      "invalid_request",
      422,
    );
    equal(f.repo.events.filter((e) => e === "replay").length, replays);
    equal(f.catalogReads(), reads);
    equal(f.repo.reports.get(RID)!.revision, 2);
    equal(await f.service.execute(r), first);
  }
});
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
async function referenceAnalysis() {
  const f = fixture(),
    bytes = await new SyntheticReferenceBytes().seal(),
    source = new PinnedSchoolReferenceSource(bytes);
  const p = f.repo.profiles.get(PID)!;
  (p.scores.inquiry as NativeObject[])[0].percentile = 31;
  (p.scores.inquiry as NativeObject[])[1].percentile = 17;
  const overall = await new OverallAnalysisService({
    getExamPack: f.data.getExamPack,
    getTotalModel: () => Promise.resolve(null),
  }).analyze(request().session, p.scores);
  f.repo.reports.get(RID)!.body.overall = overall as NativeObject;
  Object.assign((f.repo.reports.get(RID)!.body.shortlist as NativeObject)[OID] as NativeObject, {
    changed_at: TIME,
    catalog_version: "SYNTHETIC-catalog.v1",
  });
  const data = {
    ...f.data,
    getConversion: () => Promise.resolve(null),
    getReference: source.getReference.bind(source),
  };
  const service = new UniversityAnalysisService(f.repo, f.catalog, data, f.clock, null, {
    mode: "legacy_synthetic",
  });
  return { ...f, service };
}
async function referenceConversionSurvivesAnalysis() {
  const f = await referenceAnalysis(), r = await f.service.execute(request());
  const a = (r.analyses as NativeObject)[OID] as NativeObject;
  equal(a.converted_score, "31.00");
  equal(a.status, "pending");
  equal(a.reason_code, "reference_conversion_not_production_approved");
}
async function referenceConversionSurvivesHttp() {
  const f = await referenceAnalysis(), relay = "SYNTHETIC-REFERENCE-RELAY-" + "x".repeat(32);
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
        throw new Error("Unrequested authority");
      },
    },
    resources: {
      readScope: () => {
        throw new Error("Unrequested resource");
      },
    },
    projection: new PublicResponseProjection(
      canonicalPublicResponseSchemas(),
      canonicalApiPolicies(),
    ),
    budget: {
      async run(_request, work) {
        return await work();
      },
    },
    business: f.service,
  };
  const handler = createApiHandler(
    canonicalApiPolicies().map(({ contract_ref: _, ...route }) => route),
    ports,
  );
  const url = "https://synthetic.invalid/api/v1/reports/" + RID + "/university-results";
  const deniedResponse = await handler(
    new Request(url, {
      method: "POST",
      headers: { Authorization: "Bearer SYNTHETIC-token" },
      body: "{}",
    }),
  );
  equal(deniedResponse.status, 403);
  const response = await handler(
    new Request(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer SYNTHETIC-token",
        "X-Jungsi-Relay-Token": relay,
        "Idempotency-Key": "SYNTHETIC-reference-http",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expected_version: 1, offering_ids: [OID] }),
    }),
  );
  assert(response.status === 200, await response.clone().text());
  const dto = await response.json(), a = dto.analyses[OID];
  equal(a.converted_score, "31.00");
  equal(a.status, "pending");
  equal(a.reason_code, "reference_conversion_not_production_approved");
  const text = JSON.stringify(dto);
  for (
    const key of [
      "source_sha256",
      "independent_sha256",
      "reference_context",
      "exactScore",
      "source_refs",
    ]
  ) assert(!text.includes(key));
  equal(response.headers.get("Cache-Control"), "private, no-store");
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
Deno.test("university analysis persists owned immutable revision and all four year outcomes", async () => {
  await referenceConversionSurvivesAnalysis();
  await referenceConversionSurvivesHttp();
  const f = fixture(),
    before = f.repo.reports.get(RID)!,
    r = await f.service.execute(request());
  equal(r.report_version, 2);
  const a = (r.analyses as NativeObject)[OID] as NativeObject;
  equal(a.status, "ready");
  equal(a.converted_score, "30.00");
  equal((a.years as NativeObject[]).length, 4);
  equal(before.revision, 1);
  equal(before.body.analyses, {});
  equal(
    ((r.shortlist as NativeObject)[OID] as NativeObject).assessment_status,
    "ready",
  );
});
Deno.test("candidate build evaluates all same year nonpractical rows and keeps pending nonpractical arts", async () => {
  const f = fixture(),
    r = await f.service.execute(
      request("candidates.build", { expected_version: 1 }),
    ),
    c = r.candidates as NativeObject;
  equal((c.basic_university_groups as NativeObject[]).length, 1);
  equal((c.wildcards as NativeObject[]).length, 1);
  equal((c.pending_offerings as NativeObject[]).map((x) => x.offering_id), [
    "SYNTHETIC-B-2027",
  ]);
  assert(!Object.hasOwn(r.analyses as NativeObject, "SYNTHETIC-C-2027"));
  assert(!Object.hasOwn(r.analyses as NativeObject, "SYNTHETIC-A-2026"));
});
Deno.test("university analysis replay returns saved result without repeated catalog or calculation", async () => {
  const f = fixture(),
    r = request(),
    first = await f.service.execute(r),
    reads = f.catalogReads(),
    calls = f.f.data.calls.length;
  equal(await f.service.execute(r), first);
  equal(f.catalogReads(), reads);
  equal(f.f.data.calls.length, calls);
  await denied(
    () =>
      f.service.execute({
        ...r,
        body: { expected_version: 2, offering_ids: [OID] },
      }),
    "idempotency_conflict",
    409,
  );
  equal(f.repo.reports.get(RID)!.revision, 2);
});
Deno.test("paid owner confirmation guards run before body data and replay", async () => {
  const f = fixture(), r = request();
  await denied(
    () =>
      f.service.execute({
        ...r,
        session: { ...r.session, tier: "standard", paidUntilUtc: null },
      }),
    "paid_required",
    403,
  );
  equal(f.repo.events, []);
  const g = fixture(), other = request();
  await denied(
    () =>
      g.service.execute({
        ...other,
        session: {
          ...other.session,
          user: { ...other.session.user, subjectId: OTHER },
        },
      }),
    "report_not_found",
    404,
  );
  equal(g.catalogReads(), 0);
  assert(!g.repo.events.includes("replay"));
  const h = fixture();
  h.repo.profiles.set(PID, { ...h.repo.profiles.get(PID)!, confirmed: false });
  await denied(
    () => h.service.execute(request()),
    "score_confirmation_required",
    409,
  );
  equal(h.catalogReads(), 0);
});
Deno.test("analysis revision and selected IDs fail without appending a report", async () => {
  const f = fixture();
  await denied(
    () =>
      f.service.execute(
        request("university.analyze", {
          expected_version: 2,
          offering_ids: [OID],
        }),
      ),
    "revision_conflict",
    409,
  );
  equal(f.catalogReads(), 0);
  for (
    const ids of [
      [],
      [OID, OID],
      Array.from({ length: 101 }, (_, i) => "SYNTHETIC-" + String(i)),
    ]
  ) {
    const g = fixture();
    await denied(
      () =>
        g.service.execute(
          request("university.analyze", {
            expected_version: 1,
            offering_ids: ids,
          }),
        ),
      "invalid_offering_ids",
      422,
    );
    equal(g.repo.reports.get(RID)!.revision, 1);
  }
  const g = fixture();
  await denied(
    () =>
      g.service.execute(
        request("university.analyze", {
          expected_version: 1,
          offering_ids: ["SYNTHETIC-C-2027"],
        }),
      ),
    "offering_not_found",
    404,
  );
});
Deno.test("missing catalog records a pending analysis update without invented candidates", async () => {
  const f = fixture();
  f.state.catalog = null;
  const r = await f.service.execute(
    request("candidates.build", { expected_version: 1 }),
  );
  equal(
    (r.analysis_status as NativeObject).reason_code,
    "catalog_release_missing",
  );
  equal(r.candidates, null);
  equal(r.report_version, 2);
});
Deno.test("published forecast batch error holds judgment but preserves successful score and percentile", async () => {
  let batches = 0;
  const port: PublishedForecastPort = {
    validatedReleases(ids) {
      return syncPromise(() => {
        batches++;
        return new Map(
          ids.map((id) => [id, new AccessError("forecast_release_invalid", 503)]),
        );
      });
    },
    evaluateRelease() {
      throw new Error("not expected");
    },
  };
  const f = fixture(port),
    r = await f.service.execute(
      request("candidates.build", { expected_version: 1 }),
    ),
    a = (r.analyses as NativeObject)[OID] as NativeObject;
  equal(batches, 1);
  equal(a.status, "pending");
  equal(a.reason_code, "forecast_release_invalid");
  equal(a.converted_score, "30.00");
  equal(a.converted_percentile, "44.444444");
});
Deno.test("analysis rechecks expiration before saving after dependency work", async () => {
  const f = fixture();
  f.data.getAnalysis = () =>
    syncPromise(() => {
      f.expire();
      return f.f.release();
    });
  await denied(
    () => f.service.execute(request()),
    "authentication_required",
    401,
  );
  equal(f.repo.reports.get(RID)!.revision, 1);
  // Folded registration keeps the reviewed edge unit count fixed.
  await productionCandidateUniverse();
});
Deno.test("candidate categories retain outside and ineligible distinctions without pretending pending is zero", () => {
  const rows = [{
    offering_id: "SYNTHETIC-a",
    university_id: "SYNTHETIC-u",
    university_name: "가상대학",
  }, {
    offering_id: "SYNTHETIC-b",
    university_id: "SYNTHETIC-u",
    university_name: "가상대학",
  }];
  const result = candidateGroups(rows, {
    "SYNTHETIC-a": { status: "ready", category: "outside", reason_code: null },
    "SYNTHETIC-b": {
      status: "ineligible",
      category: "ineligible",
      reason_code: "eligibility_not_met",
    },
  }, "SYNTHETIC-catalog");
  equal(result.status, "ready");
  equal((result.outside_offerings as NativeObject[]).length, 1);
  equal((result.ineligible_offerings as NativeObject[]).length, 1);
});
async function productionCandidateUniverse() {
  const rows = [{ offering_id: "2027:1" }, { offering_id: "2027:2" }, {
    offering_id: "2027:3",
  }];
  const kept = await productionCandidateRows(
    {
      hasProductionConversion: (id: string) => Promise.resolve(id !== "2027:2"),
    },
    rows,
  );
  equal(kept.map((r) => r.offering_id), ["2027:1", "2027:3"]);
  // Ports without the capability keep the previous full universe.
  equal((await productionCandidateRows({}, rows)).length, 3);
}
