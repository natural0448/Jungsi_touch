// Preserve the synchronous execution order of async test doubles.
// deno-lint-ignore-file require-await
import { ImmutableReferenceReportVerifier } from "../../supabase/functions/_shared/jungsi/infrastructure/reference_report_evidence_verifier.ts";
import { resolveReferenceReportProjection } from "../../supabase/functions/_shared/jungsi/application/reference_report_projection.ts";
import { RuntimeReferenceLease } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_lease.ts";
import { savedReportProjectionAuthority } from "../../supabase/functions/_shared/jungsi/infrastructure/saved_report_projection_authority.ts";
import { referenceProjectionAuthorityPort } from "../../supabase/functions/_shared/jungsi/infrastructure/reference_runtime_authority.ts";
import { referenceCandidateGroups } from "../../supabase/functions/_shared/jungsi/application/reference_candidates.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import {
  cloneNativeJson,
  nativeJsonText,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SavedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/saved_reference_projection.ts";
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
import { resolveReferenceTransition } from "../../supabase/functions/_shared/jungsi/infrastructure/reference_projection_transition.ts";
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
const attendanceFixtureOnly = (_name: string, _body: () => unknown): void => {};
attendanceFixtureOnly(
  "completed university and candidate keys reject forbidden query before replay",
  async () => {
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
  },
);
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
async function referenceAnalysis(requireAttendance = false) {
  const f = fixture(), bytes = new SyntheticReferenceBytes();
  if (requireAttendance) {
    (bytes.body.domain as NativeObject).required_attendance = [
      "korean",
      "math",
      "english",
      "korean_history",
      "inquiry_1",
      "inquiry_2",
    ];
  }
  await bytes.seal();
  const source = new PinnedSchoolReferenceSource(bytes);
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
  return { ...f, service, referenceData: data };
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
attendanceFixtureOnly(
  "university analysis persists owned immutable revision and all four year outcomes",
  async () => {
    await referenceConversionSurvivesAnalysis();
    await referenceConversionSurvivesHttp();
    await referencePercentileSurvivesOwnedReport();
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
  },
);
attendanceFixtureOnly(
  "candidate build evaluates all same year nonpractical rows and keeps pending nonpractical arts",
  async () => {
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
  },
);
attendanceFixtureOnly(
  "university analysis replay returns saved result without repeated catalog or calculation",
  async () => {
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
  },
);
attendanceFixtureOnly(
  "paid owner confirmation guards run before body data and replay",
  async () => {
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
  },
);
attendanceFixtureOnly(
  "analysis revision and selected IDs fail without appending a report",
  async () => {
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
  },
);
attendanceFixtureOnly(
  "missing catalog records a pending analysis update without invented candidates",
  async () => {
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
  },
);
attendanceFixtureOnly(
  "published forecast batch error holds judgment but preserves successful score and percentile",
  async () => {
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
  },
);
attendanceFixtureOnly(
  "analysis rechecks expiration before saving after dependency work",
  async () => {
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
  },
);
attendanceFixtureOnly(
  "candidate categories retain outside and ineligible distinctions without pretending pending is zero",
  () => {
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
  },
);
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

async function referencePercentileSurvivesOwnedReport() {
  const f = fixture(),
    bytes = new SyntheticReferenceBytes(),
    pack = cloneNativeJson(f.f.data.rawPack);
  (pack.exam as NativeObject).exam_type = "september_mock";
  f.f.data.pack = new NativeExamPack(pack);
  bytes.body.exam_type = "september_mock";
  await bytes.seal();
  const source = new PinnedSchoolReferenceSource(bytes), profile = f.repo.profiles.get(PID)!;
  Object.assign((f.repo.reports.get(RID)!.body.shortlist as NativeObject)[OID] as NativeObject, {
    changed_at: TIME,
    catalog_version: "SYNTHETIC-catalog.v1",
  });
  (profile.scores.inquiry as NativeObject[])[0].percentile = 31;
  (profile.scores.inquiry as NativeObject[])[1].percentile = 17;
  f.repo.reports.get(RID)!.body.overall = await new OverallAnalysisService({
    getExamPack: f.data.getExamPack,
    getTotalModel: () => Promise.resolve(null),
  }).analyze(request().session, profile.scores) as NativeObject;
  const context: NativeObject = {
    academic_year: 2027,
    exam_id: f.f.data.pack.examId,
    exam_type: "september_mock",
    source_pack_version: f.f.data.pack.packVersion,
    model_version: "SYNTHETIC-model",
    profile_sha256: "a".repeat(64),
    rule_version: (bytes.body.rule as NativeObject).rule_version,
    score_scale_id: bytes.body.score_scale_id,
    reference_curve_id: "SYNTHETIC-curve",
    weight_encoding: "SYNTHETIC",
    source_scenario_field_present: false,
    source_scenario_value: null,
    resolved_model_scenario: "SYNTHETIC-fixed",
  };
  const evidence = Object.fromEntries(
    [
      "source_csv_sha256",
      "source_cdf_sha256",
      "definition_sha256",
      "shared_proof_sha256",
      "binder_sha256",
      "independent_sha256",
    ].map((k) => [k, "b".repeat(64)]),
  );
  const payload: NativeObject = {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "SYNTHETIC-tail",
    context,
    evidence,
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + "d".repeat(64),
      weight_decimal_scale: 1,
      eligible_weight_units: "15",
      whole_mass_decimal: "3.00001",
      whole_mass_numerator: "300001",
      whole_mass_denominator: "100000",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    rows: [{
      score_numerator: "10",
      score_denominator: "1",
      strict_weight_units: "5",
      tie_weight_units: "10",
      inclusive_weight_units: "15",
    }, {
      score_numerator: "50",
      score_denominator: "1",
      strict_weight_units: "0",
      tie_weight_units: "5",
      inclusive_weight_units: "5",
    }],
  };
  const raw = new TextEncoder().encode(nativeJsonText(payload)),
    sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
  const projection = await SavedReferenceTailProjection.bind(raw, {
    sha256: sha,
    bytes: raw.length,
    maxBytes: 65536,
    context,
    evidence,
  });
  const binding = { ...(bytes.body.bindings as NativeObject[])[0], offering_id: OID };
  const data = {
    ...f.data,
    getConversion: () => Promise.resolve(null),
    hasProductionConversion: () => Promise.resolve(false),
    getReference: source.getReference.bind(source),
    async getReferenceTail() {
      await Promise.resolve();
      return { projection, binding, async assertCompatible() {}, async assertCurrent() {} };
    },
  };
  let scopeChecks = 0;
  const referenceScope = {
    sourceSha256: "a".repeat(64),
    selectionSha256: "b".repeat(64),
    budgetPolicySha256: "c".repeat(64),
    consumerReceiptSha256: "d".repeat(64),
    maximumRows: 1,
    maximumEvidenceBytes: 4096,
    maximumRuntimeMilliseconds: 10000,
    async verifyAdmission(
      scope: { subjectId: string; reportId: string; reportRevision: number; profileId: string },
      admission: unknown,
      _requirements: unknown,
      signal: AbortSignal,
    ) {
      await Promise.resolve();
      equal(scope.subjectId, OWNER);
      equal(scope.reportId, RID);
      equal(scope.reportRevision, 2);
      equal(scope.profileId, PID);
      assert(admission !== null && !signal.aborted);
      scopeChecks++;
    },
    async readOfferingIds() {
      await Promise.resolve();
      return [OID];
    },
    async cancelAndWait() {},
  };
  const service = new UniversityAnalysisService(
    f.repo,
    f.catalog,
    data,
    f.clock,
    null,
    { mode: "legacy_synthetic" },
    null,
    referenceScope,
  );
  const result = await service.execute(request()),
    assessment = (result.analyses as NativeObject)[OID] as NativeObject;
  equal(assessment.status, "pending");
  equal(assessment.converted_score, "31.00");
  equal((assessment.reference_percentile as NativeObject).status, "reference_estimated");
  equal((assessment.reference_percentile as NativeObject).production_allowed, false);
  equal(assessment.category, "pending");
  (assessment.reference_percentile as NativeObject).private_proof = "SYNTHETIC-SECRET";
  const projectionFilter = new PublicResponseProjection(
    canonicalPublicResponseSchemas(),
    canonicalApiPolicies(),
  );
  const referenceProof = {
    async assertCurrent() {},
    authorizes() {
      return true;
    },
  };
  const withoutProof = projectionFilter.project(
    "university.analyze",
    "paid",
    result,
  ) as NativeObject;
  assert(
    !Object.hasOwn(
      (withoutProof.analyses as NativeObject)[OID] as NativeObject,
      "reference_percentile",
    ),
  );
  const publicReport = projectionFilter.project(
    "university.analyze",
    "paid",
    result,
    undefined,
    referenceProof,
  ) as NativeObject;
  const publicAssessment = (publicReport.analyses as NativeObject)[OID] as NativeObject;
  equal((publicAssessment.reference_percentile as NativeObject).status, "reference_estimated");
  assert(!JSON.stringify(publicReport).includes("SYNTHETIC-SECRET"));
  const referenceGroups = referenceCandidateGroups(f.state.catalog!.offerings, {
    [OID]: assessment,
  });
  result.candidates = {
    status: "pending",
    reason_code: "approved_candidates_missing",
    basic_university_groups: [],
    wildcards: [],
    pending_offerings: [],
    catalog_version: "SYNTHETIC-catalog.v1",
    outside_offerings: [],
    ineligible_offerings: [],
    reference_university_groups: referenceGroups.university_groups,
  };
  const publicCandidates = projectionFilter.project(
    "candidates.build",
    "paid",
    result,
    undefined,
    referenceProof,
  ) as NativeObject;
  equal(
    ((publicCandidates.candidates as NativeObject).reference_university_groups as NativeObject[])
      .length,
    1,
  );
  assert(!JSON.stringify(publicCandidates).includes("SYNTHETIC-SECRET"));
  const scoped = await service.execute(
    request("candidates.build", { expected_version: 2 }, "SYNTHETIC-candidate-key"),
    { signal: new AbortController().signal, admission: {} },
  );
  const scopedCandidates = scoped.candidates as NativeObject;
  equal((scopedCandidates.basic_university_groups as NativeObject[]).length, 0);
  equal((scopedCandidates.reference_university_groups as NativeObject[]).length, 1);
  assert(scopeChecks >= 3);
  const hidden = projectionFilter.project("candidates.build", "paid", scoped) as NativeObject;
  assert(!Object.hasOwn(hidden.candidates as NativeObject, "reference_university_groups"));
  const safe = projectionFilter.project(
    "candidates.build",
    "paid",
    scoped,
    undefined,
    referenceProof,
  ) as NativeObject;
  equal(
    ((safe.candidates as NativeObject).reference_university_groups as NativeObject[]).length,
    1,
  );
  const relay = "SYNTHETIC-REFERENCE-RELAY-" + "x".repeat(32);
  let outputChecks = 0, deliveries = 0;
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
    projection: projectionFilter,
    budget: {
      async run(_r, work) {
        return await work({});
      },
    },
    business: { execute: () => Promise.resolve(scoped) },
    completion: {
      async accept(_r, work) {
        return await work();
      },
      async current() {},
      async deliver() {
        await Promise.resolve();
        deliveries++;
      },
    },
  };
  const route = canonicalApiPolicies().map(({ contract_ref: _, ...route }) => route);
  const readRequest = () =>
    new Request("https://synthetic.invalid/api/v1/reports/" + RID, {
      headers: { Authorization: "Bearer SYNTHETIC-token", "X-Jungsi-Relay-Token": relay },
    });
  let response = await createApiHandler(route, ports)(readRequest());
  equal(response.status, 200);
  let dto = await response.json();
  assert(!Object.hasOwn(dto.analyses[OID], "reference_percentile"));
  assert(!Object.hasOwn(dto.candidates, "reference_university_groups"));
  let settledChecks = 0;
  const withProof: ApiHttpPorts = {
    ...ports,
    referenceProjectionAuthority: {
      async resolve(request, result, admission, signal) {
        await Promise.resolve();
        equal(request.session.user.subjectId, OWNER);
        assert(result === scoped && admission !== undefined && !signal.aborted);
        return {
          assertSettled() {
            settledChecks++;
          },
          async assertCurrent() {
            await Promise.resolve();
            outputChecks++;
          },
          authorizes(input) {
            return input.operation === "report.read" && input.root === scoped;
          },
        };
      },
    },
  };
  response = await createApiHandler(route, withProof)(readRequest());
  equal(response.status, 200);
  dto = await response.json();
  equal(dto.analyses[OID].reference_percentile.status, "reference_estimated");
  equal(dto.candidates.reference_university_groups.length, 1);
  assert(outputChecks >= 1 && settledChecks >= 1);
  for (const kind of ["legacy", "valid", "invalid"] as const) {
    let legacyCalls = 0, provenCalls = 0;
    const body: NativeObject = kind === "legacy"
      ? {}
      : { _reference_evidence: kind === "valid" ? { format: "synthetic" } : null };
    const routed: ApiHttpPorts = {
      ...ports,
      referenceProjectionAuthority: {
        async resolve(_request, _result, _admission, signal) {
          const authority = {
            async assertCurrent() {},
            assertSettled() {},
            authorizes(input: { root: unknown }) {
              return input.root === scoped;
            },
          };
          return await resolveReferenceTransition({
            signal,
            async readOwnedCurrent() {
              return { body };
            },
            async resolveLegacy() {
              legacyCalls++;
              return authority;
            },
            async resolveProven() {
              provenCalls++;
              return kind === "valid" ? authority : null;
            },
            async captureReceipt() {
              return { assertCurrent() {} };
            },
            assertSettledRequest() {},
          });
        },
      },
    };
    const rendered = await createApiHandler(route, routed)(readRequest());
    equal(rendered.status, 200);
    const parsed = await rendered.json();
    equal(Object.hasOwn(parsed.analyses[OID], "reference_percentile"), kind !== "invalid");
    equal(legacyCalls, kind === "legacy" ? 1 : 0);
    equal(provenCalls, kind === "legacy" ? 0 : 1);
  }
  // Exercise the actual HTTP handler and runtime authority helper with distinct factory modes.
  for (const mode of ["not_configured", "unselected", "failed", "selected"] as const) {
    const raw = readRequest();
    let legacyCalls = 0, factoryCalls = 0, receiptChecks = 0;
    const head = {
      async referenceTailPins() {
        return true;
      },
      async assertCurrentSelection(_strict: boolean, s?: AbortSignal) {
        if (s?.aborted) throw Error("aborted");
      },
      hasReferenceTail(id: string) {
        return id === OID;
      },
    };
    const ctx = {
      async data() {
        return head;
      },
      async assertCurrent(signal?: AbortSignal) {
        if (signal?.aborted) throw Error("aborted");
      },
    };
    const receipt = async () => ({
      assertCurrent() {
        receiptChecks++;
      },
    });
    const lease = new RuntimeReferenceLease(f.clock, (s) => ctx.assertCurrent(s), receipt);
    const authority = savedReportProjectionAuthority({
      repository: f.repo,
      lease,
      factoryConfigured: mode !== "not_configured",
      reference: async () => {
        factoryCalls++;
        if (mode === "failed") throw Error("synthetic factory failure");
        return mode === "selected"
          ? {
            projectionAuthority: {
              async resolve() {
                return null;
              },
            },
          } as never
          : null;
      },
      legacy: async (r, result, admission, signal) => {
        legacyCalls++;
        return await referenceProjectionAuthorityPort(ctx as never).resolve(
          r,
          result,
          admission,
          signal,
        );
      },
      receipt,
    });
    const withLease: ApiHttpPorts = {
      ...ports,
      referenceProjectionAuthority: authority,
      budget: {
        async run(r, work) {
          const admission = { lease: { owner: OWNER, expiresAtUtc: NOW + 500000n } };
          const value = await lease.enter(
            r as ApiExecution,
            admission,
            raw.signal,
            () => work(admission),
          );
          lease.markSettled();
          return value;
        },
      },
    };
    const rendered = await createApiHandler(route, withLease)(raw);
    equal(rendered.status, 200);
    const parsed = await rendered.json(),
      shown = Object.hasOwn(parsed.analyses[OID], "reference_percentile");
    equal(shown, mode === "not_configured" || mode === "selected");
    equal(legacyCalls, mode === "not_configured" || mode === "selected" ? 1 : 0);
    if (shown) assert(receiptChecks > 0);
    if (mode === "not_configured") equal(factoryCalls, 0);
    else assert(factoryCalls > 0);
  }
  for (const kind of ["evidence_present", "evidence_deleted", "wrong_owner"] as const) {
    const raw = readRequest(), original = await f.repo.getReport(OWNER, RID);
    assert(original);
    const marked = {
      ...original,
      body: { ...structuredClone(original.body), _reference_evidence: { format: "synthetic" } },
    };
    const current = kind === "evidence_present"
      ? marked
      : kind === "wrong_owner"
      ? { ...original, owner_id: "other" }
      : original;
    const repository = {
      lookupAccess: f.repo.lookupAccess.bind(f.repo),
      async getReport() {
        return current;
      },
      async getReportRevision(_owner: string, _id: string, n: number) {
        return n === current.revision
          ? (kind === "evidence_deleted" ? marked : current)
          : await f.repo.getReportRevision(OWNER, RID, n);
      },
    };
    const head = {
      async referenceTailPins() {
        return true;
      },
      async assertCurrentSelection() {},
      hasReferenceTail(id: string) {
        return id === OID;
      },
    };
    const ctx = {
      async data() {
        return head;
      },
      async assertCurrent() {},
    };
    const receipt = async () => ({ assertCurrent() {} }),
      lease = new RuntimeReferenceLease(f.clock, () => ctx.assertCurrent(), receipt);
    let legacyCalls = 0;
    const authority = savedReportProjectionAuthority({
      repository,
      lease,
      factoryConfigured: false,
      reference: async () => null,
      legacy: async (r, result, admission, signal) => {
        legacyCalls++;
        return await referenceProjectionAuthorityPort(ctx as never).resolve(
          r,
          result,
          admission,
          signal,
        );
      },
      receipt,
    });
    const guarded: ApiHttpPorts = {
      ...ports,
      referenceProjectionAuthority: authority,
      budget: {
        async run(r, work) {
          const admission = { lease: { owner: OWNER, expiresAtUtc: NOW + 500000n } };
          const value = await lease.enter(
            r as ApiExecution,
            admission,
            raw.signal,
            () => work(admission),
          );
          lease.markSettled();
          return value;
        },
      },
    };
    const rendered = await createApiHandler(route, guarded)(raw);
    equal(rendered.status, 200);
    const parsed = await rendered.json();
    assert(!Object.hasOwn(parsed.analyses[OID], "reference_percentile"));
    equal(legacyCalls, 0);
  }
  const beforeDeliveries = deliveries;
  outputChecks = 0;
  const revokedProof: ApiHttpPorts = {
    ...ports,
    referenceProjectionAuthority: {
      async resolve() {
        await Promise.resolve();
        return {
          async assertCurrent() {
            await Promise.resolve();
            outputChecks++;
          },
          assertSettled() {
            throw new Error("revoked");
          },
          authorizes() {
            return true;
          },
        };
      },
    },
  };
  response = await createApiHandler(route, revokedProof)(readRequest());
  equal(response.status, 503);
  equal(deliveries, beforeDeliveries);
  const badScope = {
    ...referenceScope,
    async verifyAdmission() {},
    async readOfferingIds() {
      await Promise.resolve();
      return ["SYNTHETIC-outside-catalog"];
    },
  };
  const badService = new UniversityAnalysisService(
    f.repo,
    f.catalog,
    data,
    f.clock,
    null,
    { mode: "legacy_synthetic" },
    null,
    badScope,
  );
  // A scope outside the catalog never fails 4-page: the official result is kept and the
  // reference bundle is simply not delivered.
  await badService.execute(
    request("candidates.build", { expected_version: 3 }, "SYNTHETIC-bad-scope"),
    { signal: new AbortController().signal, admission: {} },
  );
  equal(f.repo.reports.get(RID)!.revision, 4);
  assert(
    !Object.hasOwn(
      f.repo.reports.get(RID)!.body.candidates as NativeObject,
      "reference_university_groups",
    ),
  );
  let verifyCount = 0;
  const revokedScope = {
    ...referenceScope,
    async verifyAdmission() {
      await Promise.resolve();
      if (++verifyCount === 3) throw new AccessError("security_policy_unavailable", 503);
    },
  };
  const revokedService = new UniversityAnalysisService(
    f.repo,
    f.catalog,
    data,
    f.clock,
    null,
    { mode: "legacy_synthetic" },
    null,
    revokedScope,
  );
  // Revoked after scoring: same, the official result is written without the reference bundle.
  const earlierAssessment = cloneNativeJson(
    (f.repo.reports.get(RID)!.body.analyses as NativeObject)[OID],
  );
  delete (f.repo.reports.get(RID)!.body.analyses as NativeObject)[OID];
  const revokedResult = await revokedService.execute(
    request("candidates.build", { expected_version: 4 }, "SYNTHETIC-revoked-scope"),
    { signal: new AbortController().signal, admission: {} },
  );
  equal(f.repo.reports.get(RID)!.revision, 5);
  const visibleRevoked = projectionFilter.project(
    "candidates.build",
    "paid",
    revokedResult,
  ) as NativeObject;
  console.log(
    "SYNTHETIC_REVOKED_SCOPE",
    JSON.stringify({
      stored_reference_only_row: Object.hasOwn(
        f.repo.reports.get(RID)!.body.analyses as NativeObject,
        OID,
      ),
      dto_reference_only_row: Object.hasOwn(revokedResult.analyses as NativeObject, OID),
      public_reference_only_row: Object.hasOwn(visibleRevoked.analyses as NativeObject, OID),
      public_reference_percentile: Object.hasOwn(
        ((visibleRevoked.analyses as NativeObject)[OID] ?? {}) as NativeObject,
        "reference_percentile",
      ),
      public_converted_score: Object.hasOwn(
        ((visibleRevoked.analyses as NativeObject)[OID] ?? {}) as NativeObject,
        "converted_score",
      ),
      public_converted_score_non_null:
        (((visibleRevoked.analyses as NativeObject)[OID] ?? {}) as NativeObject).converted_score !=
          null,
      saved_reference_groups: Object.hasOwn(
        f.repo.reports.get(RID)!.body.candidates as NativeObject,
        "reference_university_groups",
      ),
    }),
  );
  assert(!Object.hasOwn(f.repo.reports.get(RID)!.body.analyses as NativeObject, OID));
  assert(!Object.hasOwn(visibleRevoked.analyses as NativeObject, OID));
  assert(
    !Object.hasOwn(
      f.repo.reports.get(RID)!.body.candidates as NativeObject,
      "reference_university_groups",
    ),
  );
  (assessment.reference_percentile as NativeObject).production_allowed = true;
  let rejected = false;
  try {
    projectionFilter.project("university.analyze", "paid", result, undefined, referenceProof);
  } catch {
    rejected = true;
  }
  assert(rejected);
  (f.repo.reports.get(RID)!.body.analyses as NativeObject)[OID] = earlierAssessment;
  verifyCount = 0;
  await revokedService.execute(
    request("candidates.build", { expected_version: 5 }, "SYNTHETIC-retain-prior"),
    { signal: new AbortController().signal, admission: {} },
  );
  equal(
    nativeJsonText((f.repo.reports.get(RID)!.body.analyses as NativeObject)[OID], true),
    nativeJsonText(earlierAssessment, true),
  );
  const events: string[] = [];
  let prefetchStarted!: () => void, releasePrefetch!: () => void;
  const began = new Promise<void>((resolve) => {
    prefetchStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releasePrefetch = resolve;
  });
  const delayData = {
    ...data,
    hasProductionConversion: (id: string) => Promise.resolve(id === "SYNTHETIC-B-2027"),
    async getConversion(id: string) {
      events.push("conversion:" + id);
      return await f.data.getConversion(id);
    },
    async withScoringBatch<T>(work: () => Promise<T>, signal?: AbortSignal) {
      events.push(signal ? "batch:reference" : "batch:official");
      return await work();
    },
    async prefetchReferenceTails(_ids: readonly string[], signal?: AbortSignal) {
      assert(signal && !signal.aborted);
      events.push("prefetch");
      prefetchStarted();
      await gate;
    },
  };
  const mixedScope = {
    ...referenceScope,
    async verifyAdmission() {},
    async readOfferingIds() {
      return [OID];
    },
  };
  const delayService = new UniversityAnalysisService(
    f.repo,
    f.catalog,
    delayData,
    f.clock,
    null,
    { mode: "legacy_synthetic" },
    null,
    mixedScope,
  );
  const pending = delayService.execute(
    request("candidates.build", { expected_version: 6 }, "SYNTHETIC-prefetch-delay"),
    { signal: new AbortController().signal, admission: {} },
  );
  await began;
  console.log(
    "SYNTHETIC_PREFETCH_ORDER",
    JSON.stringify({
      official_conversion_started_while_prefetch_waits: events.includes(
        "conversion:SYNTHETIC-B-2027",
      ),
    }),
  );
  assert(events.includes("conversion:SYNTHETIC-B-2027"));
  assert(events.includes("batch:official") && events.includes("batch:reference"));
  releasePrefetch();
  await pending;
}

Deno.test("reference attendance flows through owned analysis and preserves saved prior", async () => {
  const yes = {
    profile_id: PID,
    exam_id: "SYNTHETIC-exam",
    pack_version: "SYNTHETIC-pack",
    korean: true,
    math: true,
    english: true,
    korean_history: true,
    inquiry_1: true,
    inquiry_2: true,
  };
  for (const mode of ["missing", "false", "confirmed", "wrong_profile"] as const) {
    const f = await referenceAnalysis(true), profile = f.repo.profiles.get(PID)!;
    const form = {
      ...yes,
      exam_id: profile.scores.exam_id,
      pack_version: profile.scores.pack_version,
      ...(mode === "false" ? { english: false } : {}),
      ...(mode === "wrong_profile" ? { profile_id: "SYNTHETIC-other" } : {}),
    };
    const body: NativeObject = {
      expected_version: 1,
      offering_ids: [OID],
      ...(mode === "missing" ? {} : { attendance_confirmation: form }),
    };
    const before = nativeJsonText(profile.scores, true),
      result = await f.service.execute(request("university.analyze", body));
    const assessment = (result.analyses as NativeObject)[OID] as NativeObject;
    if (mode === "confirmed") equal(assessment.converted_score, "31.00");
    else {
      equal(assessment.converted_score, null);
      equal(
        (assessment.reference_percentile as NativeObject).reason_code,
        "reference_attendance_confirmation_required",
      );
    }
    equal(nativeJsonText(profile.scores, true), before);
  }
  const f = await referenceAnalysis(true),
    prior: NativeObject = {
      offering_id: OID,
      status: "pending",
      reason_code: "synthetic_old",
      converted_score: "31.00",
      reference_percentile: {
        status: "reference_estimated",
        estimated_upper_cumulative_percent_all_examinees: "10",
        calculation_review_scope: "same_exam_mathematical_reference",
        production_allowed: false,
        actual_admission_full_total_approved: false,
      },
    };
  (f.repo.reports.get(RID)!.body.analyses as NativeObject)[OID] = cloneNativeJson(prior);
  const result = await f.service.execute(request());
  equal(nativeJsonText((result.analyses as NativeObject)[OID], true), nativeJsonText(prior, true));
  const needs = result.reference_attendance_requirements as NativeObject;
  equal(needs.confirmation_kind, "self_reported");
  equal(((needs.offerings as NativeObject)[OID] as string[]).length, 6);
  const stored = await f.repo.getReport(OWNER, RID);
  assert(stored);
  equal(
    nativeJsonText((stored.body.analyses as NativeObject)[OID], true),
    nativeJsonText(prior, true),
  );
  await attendanceCacheRegression();
});
Deno.test("reference attendance is accepted through the existing authenticated HTTP request", async () => {
  const f = await referenceAnalysis(true),
    relay = "SYNTHETIC-ATTENDANCE-RELAY-" + "x".repeat(32),
    profile = f.repo.profiles.get(PID)!;
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
        throw Error("unexpected");
      },
    },
    resources: {
      readScope: () => {
        throw Error("unexpected");
      },
    },
    projection: new PublicResponseProjection(
      canonicalPublicResponseSchemas(),
      canonicalApiPolicies(),
    ),
    budget: {
      async run(_r, work) {
        return await work();
      },
    },
    business: f.service,
  };
  const handler = createApiHandler(
    canonicalApiPolicies().map(({ contract_ref: _, ...route }) => route),
    ports,
  );
  const form = {
    profile_id: PID,
    exam_id: profile.scores.exam_id,
    pack_version: profile.scores.pack_version,
    korean: true,
    math: true,
    english: true,
    korean_history: true,
    inquiry_1: true,
    inquiry_2: true,
  };
  const body = { expected_version: 1, offering_ids: [OID], attendance_confirmation: form };
  const send = (payload: unknown) =>
    handler(
      new Request("https://synthetic.invalid/api/v1/reports/" + RID + "/university-results", {
        method: "POST",
        headers: {
          Authorization: "Bearer SYNTHETIC",
          "X-Jungsi-Relay-Token": relay,
          "Idempotency-Key": "SYNTHETIC-attendance-http",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    );
  const response = await send(body);
  equal(response.status, 200);
  const dto = await response.json();
  equal(dto.analyses[OID].converted_score, "31.00");
  const replay = await send(body);
  equal(replay.status, 200);
  const conflicting = await send({ ...body, attendance_confirmation: { ...form, english: false } });
  equal(conflicting.status, 409);
  assert(!JSON.stringify(dto).includes("attendance_confirmation"));
});

Deno.test("unconfirmed attendance preserves prior 4-page reference groups while ordinary candidates continue", async () => {
  const f = await referenceAnalysis(true), profile = f.repo.profiles.get(PID)!;
  const form = {
    profile_id: PID,
    exam_id: profile.scores.exam_id,
    pack_version: profile.scores.pack_version,
    korean: true,
    math: true,
    english: true,
    korean_history: true,
    inquiry_1: true,
    inquiry_2: true,
  };
  await f.service.execute(
    request("university.analyze", {
      expected_version: 1,
      offering_ids: [OID],
      attendance_confirmation: form,
    }, "synthetic-initial"),
  );
  const report = f.repo.reports.get(RID)!,
    prior = (report.body.analyses as NativeObject)[OID] as NativeObject;
  prior.reference_percentile = {
    status: "reference_estimated",
    estimated_upper_cumulative_percent_all_examinees: "10",
    metric: "estimated_upper_cumulative_percent_all_examinees",
    calculation_review_scope: "same_exam_mathematical_reference",
    production_allowed: false,
    actual_admission_full_total_approved: false,
  };
  const oldGroups = [{
    university_id: "SYNTHETIC-A",
    offerings: [{
      offering: { offering_id: OID },
      reference_percentile: prior.reference_percentile,
    }],
  }];
  report.body.candidates = {
    reference_university_groups: oldGroups,
    basic_university_groups: [],
    wildcards: [],
    pending_offerings: [],
    outside_offerings: [],
    ineligible_offerings: [],
    catalog_version: "SYNTHETIC-old",
  };
  const result = await f.service.execute(
    request("candidates.build", { expected_version: 2 }, "synthetic-next"),
  );
  const candidates = result.candidates as NativeObject;
  equal(
    nativeJsonText(candidates.reference_university_groups, true),
    nativeJsonText(oldGroups, true),
  );
  assert(Array.isArray(candidates.basic_university_groups));
});

Deno.test("reference attendance needs appear as owner-only status without overwriting a prior result", async () => {
  const f = await referenceAnalysis(true),
    profile = f.repo.profiles.get(PID)!,
    relay = "SYNTHETIC-ATTENDANCE-STATUS-" + "x".repeat(32);
  const spec = canonicalPublicResponseSchemas();
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
        throw Error("unexpected");
      },
    },
    resources: {
      readScope: () => {
        throw Error("unexpected");
      },
    },
    projection: new PublicResponseProjection(spec, canonicalApiPolicies()),
    budget: {
      async run(_r, work) {
        return await work();
      },
    },
    business: f.service,
  };
  const handler = createApiHandler(
    canonicalApiPolicies().map(({ contract_ref: _, ...route }) => route),
    ports,
  );
  const send = (body: NativeObject, key: string) =>
    handler(
      new Request("https://synthetic.invalid/api/v1/reports/" + RID + "/university-results", {
        method: "POST",
        headers: {
          Authorization: "Bearer SYNTHETIC",
          "X-Jungsi-Relay-Token": relay,
          "Idempotency-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  const missing = await send({ expected_version: 1, offering_ids: [OID] }, "synthetic-status-1");
  equal(missing.status, 200);
  const first = await missing.json(), status = first.reference_attendance_requirements;
  equal(status.status, "confirmation_required");
  equal(status.confirmation_kind, "self_reported");
  equal(status.profile_id, PID);
  equal(status.offerings[OID].length, 6);
  const form = {
    profile_id: PID,
    exam_id: profile.scores.exam_id,
    pack_version: profile.scores.pack_version,
    korean: true,
    math: true,
    english: true,
    korean_history: true,
    inquiry_1: true,
    inquiry_2: true,
  };
  const confirmed = await send({
    expected_version: 2,
    offering_ids: [OID],
    attendance_confirmation: form,
  }, "synthetic-status-2");
  equal(confirmed.status, 200);
  const second = await confirmed.json();
  assert(!Object.hasOwn(second, "reference_attendance_requirements"));
  equal(second.analyses[OID].converted_score, "31.00");
});

Deno.test("4-page attendance hold retains old reference while a different university is newly computed", async () => {
  const f = fixture(),
    profile = f.repo.profiles.get(PID)!,
    b1 = new SyntheticReferenceBytes(),
    b2 = new SyntheticReferenceBytes();
  const pack = cloneNativeJson(f.f.data.rawPack);
  (pack.exam as NativeObject).exam_type = "september_mock";
  f.f.data.pack = new NativeExamPack(pack);
  b1.body.exam_type = "september_mock";
  b2.body.exam_type = "september_mock";
  (b1.body.domain as NativeObject).required_attendance = [
    "korean",
    "math",
    "english",
    "korean_history",
    "inquiry_1",
    "inquiry_2",
  ];
  const secondId = "SYNTHETIC-B-2027",
    rowB = f.state.catalog!.offerings.find((v) => v.offering_id === secondId)!;
  const bindingB = (b2.body.bindings as NativeObject[])[0];
  for (const k of ["academic_year", "university_id", "campus", "department", "track", "group"]) {
    bindingB[k] = rowB[k];
  }
  bindingB.offering_pk = secondId;
  await b1.seal();
  await b2.seal();
  const src1 = new PinnedSchoolReferenceSource(b1), src2 = new PinnedSchoolReferenceSource(b2);
  (profile.scores.inquiry as NativeObject[])[0].percentile = 31;
  (profile.scores.inquiry as NativeObject[])[1].percentile = 17;
  f.repo.reports.get(RID)!.body.overall = await new OverallAnalysisService({
    getExamPack: f.data.getExamPack,
    getTotalModel: () => Promise.resolve(null),
  }).analyze(request().session, profile.scores) as NativeObject;
  Object.assign((f.repo.reports.get(RID)!.body.shortlist as NativeObject)[OID] as NativeObject, {
    changed_at: TIME,
    catalog_version: "SYNTHETIC-catalog.v1",
  });
  const context: NativeObject = {
    academic_year: 2027,
    exam_id: f.f.data.pack.examId,
    exam_type: "september_mock",
    source_pack_version: f.f.data.pack.packVersion,
    model_version: "SYNTHETIC-model",
    profile_sha256: "a".repeat(64),
    rule_version: (b1.body.rule as NativeObject).rule_version,
    score_scale_id: b1.body.score_scale_id,
    reference_curve_id: "SYNTHETIC-curve",
    weight_encoding: "SYNTHETIC",
    source_scenario_field_present: false,
    source_scenario_value: null,
    resolved_model_scenario: "base",
  };
  const evidence = Object.fromEntries(
    [
      "source_csv_sha256",
      "source_cdf_sha256",
      "definition_sha256",
      "shared_proof_sha256",
      "binder_sha256",
      "independent_sha256",
    ].map((k) => [k, "b".repeat(64)]),
  );
  const payload: NativeObject = {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "SYNTHETIC-tail",
    context,
    evidence,
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + "d".repeat(64),
      weight_decimal_scale: 1,
      eligible_weight_units: "15",
      whole_mass_decimal: "3.00001",
      whole_mass_numerator: "300001",
      whole_mass_denominator: "100000",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    rows: [{
      score_numerator: "10",
      score_denominator: "1",
      strict_weight_units: "5",
      tie_weight_units: "10",
      inclusive_weight_units: "15",
    }, {
      score_numerator: "50",
      score_denominator: "1",
      strict_weight_units: "0",
      tie_weight_units: "5",
      inclusive_weight_units: "5",
    }],
  };
  const raw = new TextEncoder().encode(nativeJsonText(payload)),
    sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
  const curve = await SavedReferenceTailProjection.bind(raw, {
    sha256: sha,
    bytes: raw.length,
    maxBytes: 65536,
    context,
    evidence,
  });
  let newProof = false;
  const data = {
    ...f.data,
    getConversion: () => Promise.resolve(null),
    hasProductionConversion: () => Promise.resolve(false),
    getReference: (id: string) =>
      id === OID
        ? src1.getReference(id)
        : id === secondId
        ? src2.getReference(id)
        : Promise.resolve(null),
    async getReferenceTail(id: string) {
      const binding = {
        ...((id === OID ? b1.body.bindings : b2.body.bindings) as NativeObject[])[0],
        offering_id: id,
      };
      return {
        projection: curve,
        binding,
        async assertCompatible() {},
        async assertCurrent() {},
        ...(newProof && id === secondId
          ? {
            async verifiedProvenance(identity: NativeObject) {
              return {
                release_sha256: "a".repeat(64),
                selection_sha256: "b".repeat(64),
                tail_sha256: sha,
                compatibility_sha256: "d".repeat(64),
                academic_year: identity.academic_year,
                exam_id: identity.exam_id,
                source_pack_version: identity.source_pack_version,
                rule_version: identity.rule_version,
                score_scale_id: identity.score_scale_id,
                offering_id: identity.offering_id,
              };
            },
          }
          : {}),
      };
    },
  };
  const scope = {
    sourceSha256: "a".repeat(64),
    selectionSha256: "b".repeat(64),
    budgetPolicySha256: "c".repeat(64),
    consumerReceiptSha256: "d".repeat(64),
    maximumRows: 2,
    maximumEvidenceBytes: 4096,
    maximumRuntimeMilliseconds: 10000,
    async verifyAdmission() {},
    async readOfferingIds() {
      return [OID, secondId];
    },
    async cancelAndWait() {},
  };
  const service = new UniversityAnalysisService(
    f.repo,
    f.catalog,
    data,
    f.clock,
    null,
    { mode: "legacy_synthetic" },
    null,
    scope,
  );
  const form = {
    profile_id: PID,
    exam_id: profile.scores.exam_id,
    pack_version: profile.scores.pack_version,
    korean: true,
    math: true,
    english: true,
    korean_history: true,
    inquiry_1: true,
    inquiry_2: true,
  };
  const first = await service.execute(
    request("university.analyze", {
      expected_version: 1,
      offering_ids: [OID],
      attendance_confirmation: form,
    }, "synthetic-mixed-first"),
  );
  const old = (first.analyses as NativeObject)[OID] as NativeObject;
  equal((old.reference_percentile as NativeObject).status, "reference_estimated");
  const oldGroups =
    referenceCandidateGroups(f.state.catalog!.offerings, { [OID]: old }).university_groups;
  const saved = f.repo.reports.get(RID)!;
  saved.body.candidates = {
    status: "pending",
    reason_code: "approved_candidates_missing",
    basic_university_groups: [],
    wildcards: [],
    pending_offerings: [],
    outside_offerings: [],
    ineligible_offerings: [],
    catalog_version: "SYNTHETIC-old",
    reference_university_groups: oldGroups,
  };
  newProof = true;
  const next = await service.execute(
    request("candidates.build", { expected_version: 2 }, "synthetic-mixed-next"),
    { signal: new AbortController().signal, admission: {} },
  );
  const groups = (next.candidates as NativeObject).reference_university_groups as NativeObject[];
  const ids = groups.flatMap((g) =>
    (g.offerings as NativeObject[]).map((v) => (v.offering as NativeObject).offering_id)
  );
  assert(ids.includes(OID));
  assert(ids.includes(secondId));
  equal(nativeJsonText((next.analyses as NativeObject)[OID], true), nativeJsonText(old, true));
  assert(
    Object.hasOwn(
      (next.reference_attendance_requirements as NativeObject).offerings as NativeObject,
      OID,
    ),
  );
  // Verify the merged actual service output with both legacy and immutable new authorities.
  const savedNow = await f.repo.getReport(OWNER, RID);
  assert(savedNow);
  const proof = savedNow.body._reference_evidence as NativeObject,
    proofRow = (proof.assessments as NativeObject)[secondId] as NativeObject;
  const provenance = proofRow.provenance as NativeObject, signal = new AbortController().signal;
  const issuer = {
    async select(id: string) {
      return id === secondId
        ? {
          context: {
            academic_year: 2027,
            exam_id: context.exam_id,
            exam_type: context.exam_type,
            source_pack_version: context.source_pack_version,
            rule_version: context.rule_version,
            score_scale_id: context.score_scale_id,
          },
        } as never
        : null;
    },
    async verifiedProvenance() {
      return provenance;
    },
  };
  const verifier = new ImmutableReferenceReportVerifier(
    10,
    (o, i, n, s) => f.repo.getReportRevision(o, i, n, s),
    issuer,
    async (record) => {
      const current = await f.repo.getReport(OWNER, RID);
      assert(current && current.revision === record.revision);
    },
  );
  const req = request("candidates.build", { expected_version: 2 }),
    head = {
      async referenceTailPins() {
        return true;
      },
      async assertCurrentSelection() {},
      hasReferenceTail(id: string) {
        return id === OID || id === secondId;
      },
    };
  const ctx = {
      async data() {
        return head;
      },
      async assertCurrent() {},
    },
    workflow = {
      async snapshotScope() {
        return { overall: false, analysisIds: [], candidates: false, legacyVerified: false };
      },
    };
  const authority = await resolveReferenceTransition({
    signal,
    readOwnedCurrent: () => f.repo.getReport(OWNER, RID),
    readRevision: (r, n, s) => f.repo.getReportRevision(r.owner_id, r.report_id, n, s),
    resolveLegacy: () =>
      referenceProjectionAuthorityPort(ctx as never).resolve(req, next, {}, signal),
    resolveProven: () =>
      resolveReferenceReportProjection({
        request: req,
        result: next,
        signal,
        repository: f.repo,
        workflow,
        verifier,
        clock: f.clock,
        async assertActive() {},
        assertReceipt() {},
      }),
    captureReceipt: async () => ({ assertCurrent() {} }),
    assertSettledRequest() {},
  });
  assert(authority);
  await authority.assertCurrent(signal);
  authority.assertSettled!(signal);
  const projected = new PublicResponseProjection(
    canonicalPublicResponseSchemas(),
    canonicalApiPolicies(),
  ).project("candidates.build", "paid", next, undefined, authority) as NativeObject;
  equal(
    ((projected.candidates as NativeObject).reference_university_groups as NativeObject[]).length,
    2,
  );
  // Execute another full HTTP candidates request against the same owned stored report.
  const relay = "SYNTHETIC-ATTENDANCE-MIXED-" + "x".repeat(32);
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
        throw Error("unexpected");
      },
    },
    resources: {
      readScope: () => {
        throw Error("unexpected");
      },
    },
    projection: new PublicResponseProjection(
      canonicalPublicResponseSchemas(),
      canonicalApiPolicies(),
    ),
    budget: {
      async run(_r, work) {
        return await work({});
      },
    },
    business: service,
    referenceProjectionAuthority: {
      async resolve(r, result, _admission, scopeSignal) {
        const check = new ImmutableReferenceReportVerifier(
          10,
          (o, i, n, s) => f.repo.getReportRevision(o, i, n, s),
          issuer,
          async (record) => {
            const current = await f.repo.getReport(OWNER, RID);
            assert(current && current.revision === record.revision);
          },
        );
        return await resolveReferenceTransition({
          signal: scopeSignal,
          readOwnedCurrent: () => f.repo.getReport(OWNER, RID),
          readRevision: (rec, n, s) => f.repo.getReportRevision(rec.owner_id, rec.report_id, n, s),
          resolveLegacy: () =>
            referenceProjectionAuthorityPort(ctx as never).resolve(r, result, {}, scopeSignal),
          resolveProven: () =>
            resolveReferenceReportProjection({
              request: r,
              result,
              signal: scopeSignal,
              repository: f.repo,
              workflow,
              verifier: check,
              clock: f.clock,
              async assertActive() {},
              assertReceipt() {},
            }),
          captureReceipt: async () => ({ assertCurrent() {} }),
          assertSettledRequest() {},
        });
      },
    },
  };
  const handler = createApiHandler(
    canonicalApiPolicies().map(({ contract_ref: _, ...route }) => route),
    ports,
  );
  const response = await handler(
    new Request("https://synthetic.invalid/api/v1/reports/" + RID + "/candidates", {
      method: "POST",
      headers: {
        Authorization: "Bearer SYNTHETIC",
        "X-Jungsi-Relay-Token": relay,
        "Idempotency-Key": "synthetic-mixed-http",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expected_version: 3 }),
    }),
  );
  equal(response.status, 200);
  const http = await response.json();
  equal(http.candidates.reference_university_groups.length, 2);
});

async function attendanceCacheRegression(): Promise<void> {
  for (const op of ["university.analyze", "candidates.build"] as const) {
    const f = await referenceAnalysis(true),
      profile = f.repo.profiles.get(PID)!;
    const workflow = {
      assertProfile: () => Promise.resolve(),
      analysisContext: () => Promise.resolve("SYNTHETIC-stable-context"),
      origin: () => ({}),
    } as never;
    const service = new UniversityAnalysisService(
      f.repo,
      f.catalog,
      f.referenceData,
      f.clock,
      null,
      { mode: "rights", workflow },
    );
    const ids: NativeObject = op === "university.analyze" ? { offering_ids: [OID] } : {};
    const before = nativeJsonText(profile.scores, true);
    const initial = await service.execute(
      request(
        op,
        { expected_version: 1, ...ids },
        "SYNTHETIC-cache-" + op + "-1",
      ),
    );
    equal(
      ((initial.analyses as NativeObject)[OID] as NativeObject).converted_score,
      null,
    );
    assert(Object.hasOwn(initial, "reference_attendance_requirements"));
    const form = {
      profile_id: PID,
      exam_id: profile.scores.exam_id,
      pack_version: profile.scores.pack_version,
      korean: true,
      math: true,
      english: true,
      korean_history: true,
      inquiry_1: true,
      inquiry_2: true,
    };
    const wrong = await service.execute(
      request(op, {
        expected_version: 2,
        ...ids,
        attendance_confirmation: { ...form, profile_id: "SYNTHETIC-other" },
      }, "SYNTHETIC-cache-" + op + "-2"),
    );
    equal(
      ((wrong.analyses as NativeObject)[OID] as NativeObject).converted_score,
      null,
    );
    assert(Object.hasOwn(wrong, "reference_attendance_requirements"));
    const after = await service.execute(
      request(op, {
        expected_version: 3,
        ...ids,
        attendance_confirmation: form,
      }, "SYNTHETIC-cache-" + op + "-3"),
    );
    equal(
      ((after.analyses as NativeObject)[OID] as NativeObject).converted_score,
      "31.00",
    );
    assert(!Object.hasOwn(after, "reference_attendance_requirements"));
    equal(nativeJsonText(profile.scores, true), before);
    assert(
      !JSON.stringify(f.repo.reports.get(RID)!.body).includes(
        '"attendance_confirmation"',
      ),
    );
  }
}
