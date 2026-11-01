/** Synthetic-only actual member HTTP and service wiring; no environment or real provider. */
import { assert, equal, syncPromise } from "./fixture.ts";
import {
  type PublishedForecastPort,
  UniversityAnalysisService,
} from "../../supabase/functions/_shared/jungsi/application/university_analysis.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type CatalogRelease,
  CatalogService,
} from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import type {
  ApiExecution,
  ApiRoutePolicy,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { ScoreInputWorkflowPort } from "../../supabase/functions/_shared/jungsi/application/score_input_ports.ts";
import type { WildcardRuntimeGate } from "../../supabase/functions/_shared/jungsi/application/wildcard_runtime_gate.ts";
import type {
  WildcardBatchBinding,
  WildcardBatchRecord,
} from "../../supabase/functions/_shared/jungsi/application/wildcard_candidate_review.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { syntheticOfferingAnalysisFixture } from "./synthetic_offering_analysis.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import {
  publicJsonText,
  PublicResponseProjection,
} from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { OverallAnalysisService } from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import { canonicalApiPolicies } from "./public_api_contract_fixture.ts";
// The generated fixture covers 25 operations. These five public route fields were
// independently checked against staged route SHA-256 d1d2b38daf066d957d608eeb21f11ddcc9bf7588fcc254e9d155f6dad8f6a592.
const fixtureRoutes = canonicalApiPolicies();
if (fixtureRoutes.length !== 25) {
  throw new Error("Generated route fixture changed; reconcile its version and full policy scope");
}
const routeExtensions: (ApiRoutePolicy & { readonly contract_ref: string })[] = [
  {
    "id": "history.snapshot.head",
    "method": "GET",
    "path": "/api/v1/admission-history/snapshot/head",
    "member_tiers": [
      "standard",
      "paid",
    ],
    "report_owner": false,
    "confirmed_score_profile": false,
    "contract_ref": "backend_platform_contract.dto_schemas.history_snapshot_head",
  },
  {
    "id": "history.snapshot.read",
    "method": "GET",
    "path": "/api/v1/admission-history/snapshots/{snapshot_id}",
    "member_tiers": [
      "standard",
      "paid",
    ],
    "report_owner": false,
    "confirmed_score_profile": false,
    "contract_ref": "backend_platform_contract.dto_schemas.history_snapshot_body",
  },
  {
    "id": "report.list-own",
    "method": "GET",
    "path": "/api/v1/me/reports",
    "member_tiers": [
      "standard",
      "paid",
    ],
    "report_owner": false,
    "confirmed_score_profile": false,
    "contract_ref": "backend_platform_contract.dto_schemas.own_report_list",
  },
  {
    "id": "member-shortlist.read",
    "method": "GET",
    "path": "/api/v1/me/shortlist",
    "member_tiers": [
      "paid",
    ],
    "report_owner": false,
    "confirmed_score_profile": false,
    "contract_ref": "backend_platform_contract.dto_schemas.member_shortlist",
  },
  {
    "id": "member-shortlist.update",
    "method": "PUT",
    "path": "/api/v1/me/shortlist/{offering_id}",
    "member_tiers": [
      "paid",
    ],
    "report_owner": false,
    "confirmed_score_profile": false,
    "contract_ref": "backend_platform_contract.dto_schemas.member_shortlist",
  },
];
const routes = { operations: [...fixtureRoutes, ...routeExtensions] };
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
const H = (x: string) => x.repeat(64);
const TOKEN = Object.freeze({ synthetic: "only-reserved-admission" });
const RELAY = "SYNTHETIC-relay-00000000000000000000";
type Provider = WildcardRuntimeGate["evidence"]["read"];
function providerRows(binding: WildcardBatchBinding): WildcardBatchRecord[] {
  return binding.offeringIds.map((offeringId) =>
    offeringId === OID
      ? {
        offeringId,
        groupClassification: "approved",
        group: "nursing",
        stability: {
          marginPp: exact(1),
          academicYear: binding.academicYear,
          examId: binding.examId,
          scoreBasis: binding.scoreBasis,
          sourceModelVersion: "SYNTHETIC-model",
          referencePopulationSha256: H("a"),
          effectivePopulationWeightsSha256: H("b"),
          denominatorPolicyId: "SYNTHETIC-policy",
          populationUnit: "SYNTHETIC-students",
          metricDefinitionId: "SYNTHETIC-metric",
          tiePolicy: "include_equal",
          forecastApprovalId: "SYNTHETIC-approval",
        },
      }
      : { offeringId, groupClassification: "excluded", group: null, stability: null }
  );
}
function gateFixture(
  events: string[],
  read?: Provider,
  release = "d",
  policy = "e",
  stop?: () => Promise<void>,
) {
  let calls = 0;
  const gate: WildcardRuntimeGate = {
    selectionPolicySha256: H(policy),
    evidenceReleaseSha256: H(release),
    budgetPolicySha256: H("f"),
    consumerReceiptSha256: H("9"),
    maximumRows: 10,
    maximumSnapshotBytes: 1000000,
    maximumEvidenceBytes: 200000,
    maximumRuntimeMilliseconds: 1000,
    verifyAdmission: (scope, admission, requirements, signal) => {
      assert(
        admission === TOKEN && !signal.aborted &&
          requirements.requirePhysicalCancellationAndSettlement,
      );
      equal(scope.subjectId, OWNER);
      equal(scope.audience, "personal");
      equal(scope.operation, "candidates.build");
      events.push("verify");
      return Promise.resolve();
    },
    evidence: {
      read: (binding, signal, limit) => {
        calls++;
        events.push("provider");
        equal(limit, 200000);
        if (read) return read(binding, signal, limit);
        return Promise.resolve({ binding, records: providerRows(binding) });
      },
      cancelAndWait: () => {
        events.push("cancel-ack");
        return stop ? stop() : Promise.resolve();
      },
    },
  };
  return { gate, calls: () => calls };
}
interface DeliveryRace {
  revokeAt: "current" | "deliver" | "projection3" | "expire" | "never";
  revoked: boolean;
  receipts: number;
}
function handler(
  f: ReturnType<typeof fixture>,
  gate: WildcardRuntimeGate | null,
  events: string[],
  withAdmission = true,
  owner = OWNER,
  failSettlement = false,
  verifyOutput = false,
  revokeAfterFirst = false,
  rejectProof = false,
  race?: DeliveryRace,
) {
  const service = new UniversityAnalysisService(f.repo, f.catalog, f.data, f.clock, null, {
    mode: "legacy_synthetic",
  }, gate);
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(RELAY),
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
    reports: { lookupAccess: () => Promise.resolve({ ownerId: owner, confirmed: true }) },
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
    readViewScope: { assert: () => Promise.resolve() },
    memberShortlistScope: { assert: () => Promise.resolve() },
    projection: new PublicResponseProjection(schemas, routes.operations),
    ...(verifyOutput
      ? {
        wildcardProjectionAuthority: {
          resolve: (r: ApiExecution, result: unknown, admission: unknown, signal: AbortSignal) => {
            events.push("proof-source");
            if (rejectProof) return Promise.reject(new Error("SYNTHETIC-proof-source-down"));
            assert(admission === TOKEN && !signal.aborted && r.session.user.subjectId === OWNER);
            const publicReport = result as NativeObject, stored = f.repo.reports.get(RID)!;
            assert(
              stored.owner_id === OWNER && publicReport.report_id === RID &&
                publicReport.report_version === stored.revision,
            );
            const candidates = stored.body.candidates as NativeObject;
            const expected = nativeJsonText(candidates._wildcard_selection_view, true);
            let count = 0, currentChecks = 0;
            // Synthetic fixture stands in for an independently authorized immutable writer record.
            return Promise.resolve({
              assertCurrent: () => {
                events.push("proof-current");
                currentChecks++;
                if (race?.revokeAt === "expire" && currentChecks === 3) f.expire();
                return (revokeAfterFirst && currentChecks > 1) || race?.revoked
                  ? Promise.reject(new Error("SYNTHETIC-revoked"))
                  : Promise.resolve();
              },
              authorizes: (
                { operation, root, privateView }: {
                  operation: string;
                  root: unknown;
                  privateView: unknown;
                },
              ) => {
                events.push("projection-proof");
                count++;
                const report = root as NativeObject;
                if (race?.revokeAt === "projection3" && count === 3) return false;
                return operation === "candidates.build" && report.report_id === RID &&
                  report.report_version === stored.revision &&
                  nativeJsonText(privateView, true) === expected &&
                  (!revokeAfterFirst || count === 1);
              },
            });
          },
        },
      }
      : {}),
    budget: {
      async run(_request, work) {
        events.push("reserve");
        try {
          const value = await work(withAdmission ? TOKEN : undefined);
          if (failSettlement) throw new AccessError("security_policy_unavailable", 503);
          if (verifyOutput) {
            events.push(
              "budget-bytes:" + new TextEncoder().encode(nativeJsonText(value)).byteLength,
            );
          }
          events.push("settle-success");
          return value;
        } catch (error) {
          events.push("settle-failure");
          throw error;
        }
      },
    },
    business: service,
    ...(race
      ? {
        completion: {
          accept: async <T>(_request: ApiExecution, work: () => Promise<T>) => await work(),
          current: () => {
            events.push("completion-current");
            if (race.revokeAt === "current") race.revoked = true;
            return Promise.resolve();
          },
          deliver: () => {
            events.push("completion-deliver");
            race.receipts++;
            if (race.revokeAt === "deliver") race.revoked = true;
            return Promise.resolve();
          },
        },
      }
      : {}),
  };
  return createApiHandler(routes.operations as unknown as ApiRoutePolicy[], ports);
}
function httpRequest(key = "SYNTHETIC-key", signal?: AbortSignal): Request {
  return new Request("https://synthetic.invalid/api/v1/reports/" + RID + "/candidates", {
    method: "POST",
    signal,
    headers: {
      Authorization: "Bearer SYNTHETIC-token",
      "X-Jungsi-Relay-Token": RELAY,
      "Idempotency-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expected_version: 1 }),
  });
}
function workflow(): ScoreInputWorkflowPort {
  return {
    assertProfile: () => Promise.resolve(),
    analysisContext: (profileId: string) => Promise.resolve(profileId === PID ? H("1") : H("2")),
    origin: () => ({}),
  } as unknown as ScoreInputWorkflowPort;
}
function activeService(f: ReturnType<typeof fixture>, gate: WildcardRuntimeGate) {
  return new UniversityAnalysisService(f.repo, f.catalog, f.data, f.clock, null, {
    mode: "rights",
    workflow: workflow(),
  }, gate);
}
Deno.test("member HTTP default OFF retains response, no added provider or budget", async () => {
  const first = await preparedFixture(),
    second = await preparedFixture(),
    firstEvents: string[] = [],
    secondEvents: string[] = [];
  const a = await handler(first, null, firstEvents)(httpRequest());
  const b = await handler(second, null, secondEvents)(httpRequest());
  equal(a.status, 200);
  equal(b.status, 200);
  equal(await a.text(), await b.text());
  equal(firstEvents, ["reserve", "settle-success"]);
  equal(secondEvents, firstEvents);
  const saved = first.repo.reports.get(RID)!;
  assert(!Object.hasOwn(saved.body.candidates as NativeObject, "wildcard_selection"));
});
Deno.test("member HTTP authorized reserved scope uses synthetic provider and preserves replay", async () => {
  const f = await preparedFixture(),
    events: string[] = [],
    g = gateFixture(events),
    run = handler(f, g.gate, events);
  const first = await run(httpRequest());
  assert(first.status === 200, await first.clone().text());
  equal(first.headers.get("cache-control"), "private, no-store");
  const body = await first.text(), json = JSON.parse(body);
  assert(!Object.hasOwn(json.candidates, "wildcard_selection"));
  const saved = f.repo.reports.get(RID)!.body.candidates as NativeObject;
  const privateView = saved._wildcard_selection_view as NativeObject;
  equal((privateView.wildcard_selection as NativeObject).status, "ready");
  equal(g.calls(), 1);
  equal(f.repo.reports.get(RID)!.revision, 2);
  assert(
    events.indexOf("reserve") < events.indexOf("verify") &&
      events.indexOf("verify") < events.indexOf("provider"),
  );
  const replay = await run(httpRequest());
  equal(replay.status, 200);
  equal(await replay.text(), body);
  equal(g.calls(), 1);
  equal(f.repo.reports.get(RID)!.revision, 2);
});
Deno.test("member HTTP absent admission or denied owner cannot reach provider", async () => {
  const first = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  equal((await handler(first, g.gate, events, false)(httpRequest())).status, 503);
  equal(g.calls(), 0);
  equal(first.repo.reports.get(RID)!.revision, 1);
  const second = await preparedFixture(), ev: string[] = [], otherGate = gateFixture(ev);
  const response = await handler(second, otherGate.gate, ev, true, OTHER)(httpRequest());
  assert([403, 404].includes(response.status));
  equal(otherGate.calls(), 0);
  equal(ev, []);
});
Deno.test("member HTTP cancellation settles failure and ignores late provider result", async () => {
  const f = await preparedFixture(), events: string[] = [], abort = new AbortController();
  let begin!: () => void,
    finish!: (
      v: { binding: WildcardBatchBinding; records: readonly WildcardBatchRecord[] },
    ) => void;
  let captured!: WildcardBatchBinding;
  const started = new Promise<void>((resolve) => begin = resolve);
  let stopped = false;
  const g = gateFixture(
    events,
    (binding, signal) => {
      captured = binding;
      signal.addEventListener("abort", () => {
        stopped = true;
        events.push("synthetic-io-stopped");
      }, { once: true });
      begin();
      return new Promise((resolve) => finish = resolve);
    },
    "d",
    "e",
    () => {
      assert(stopped);
      return Promise.resolve();
    },
  );
  const result = handler(f, g.gate, events)(httpRequest("SYNTHETIC-cancel", abort.signal));
  await Promise.race([
    started,
    result.then(() => {
      throw new Error("provider not reached");
    }),
  ]);
  abort.abort();
  const response = await result;
  equal(response.status, 503);
  equal(f.repo.reports.get(RID)!.revision, 1);
  assert(events.includes("cancel-ack") && events.includes("settle-failure"));
  assert(events.indexOf("cancel-ack") < events.indexOf("settle-failure"));
  finish({ binding: captured, records: providerRows(captured) });
  await Promise.resolve();
  await Promise.resolve();
  equal(f.repo.reports.get(RID)!.revision, 1);
  assert(!events.includes("settle-success"));
});
Deno.test("member HTTP unapproved gate fails before provider and persistence", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const invalid = {
    ...g.gate,
    verifyAdmission: () => Promise.reject(new Error("SYNTHETIC-not-approved")),
  };
  const response = await handler(f, invalid, events)(httpRequest("SYNTHETIC-invalid"));
  equal(response.status, 503);
  equal(g.calls(), 0);
  equal(f.repo.reports.get(RID)!.revision, 1);
  assert(events.includes("settle-failure"));
});
Deno.test("member cache binds policy, evidence release and authorized row universe", async () => {
  const f = await preparedFixture(),
    events: string[] = [],
    g1 = gateFixture(events),
    boundary = { signal: new AbortController().signal, admission: TOKEN };
  const run = (gate: WildcardRuntimeGate, version: number, key: string) =>
    activeService(f, gate).execute(
      request("candidates.build", { expected_version: version }, key),
      boundary,
    );
  equal((await run(g1.gate, 1, "SYNTHETIC-a")).report_version, 2);
  equal((await run(g1.gate, 2, "SYNTHETIC-b")).report_version, 2);
  equal(g1.calls(), 1);
  const g2 = gateFixture(events, undefined, "c", "e");
  equal((await run(g2.gate, 2, "SYNTHETIC-c")).report_version, 3);
  equal(g2.calls(), 1);
  const g3 = gateFixture(events, undefined, "c", "8");
  equal((await run(g3.gate, 3, "SYNTHETIC-d")).report_version, 4);
  equal(g3.calls(), 1);
  const old = f.state.catalog!;
  f.state.catalog = {
    ...old,
    offerings: old.offerings.map((r) =>
      r.offering_id === OID ? { ...r, region: "SYNTHETIC-new-region" } : r
    ),
  };
  equal((await run(g3.gate, 4, "SYNTHETIC-e")).report_version, 5);
  equal(g3.calls(), 2);
  // Synthetic correction creates a distinct immutable profile and changes the approved context.
  const previous = f.repo.profiles.get(PID)!;
  const newId = "SYNTHETIC-corrected-profile";
  const scores = structuredClone(previous.scores) as NativeObject;
  (scores.korean as NativeObject).standard_score = 8;
  f.repo.profiles.set(newId, { ...previous, profile_id: newId, scores });
  const report = f.repo.reports.get(RID)!;
  f.repo.reports.set(RID, { ...report, profile_id: newId });
  equal((await run(g3.gate, 5, "SYNTHETIC-f")).report_version, 6);
  equal(g3.calls(), 3);
});

Deno.test("member HTTP missing physical cancellation contract cannot start provider", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const noCancellation = { ...g.gate, evidence: { read: g.gate.evidence.read } };
  const response = await handler(f, noCancellation, events)(
    httpRequest("SYNTHETIC-no-cancel-proof"),
  );
  equal(response.status, 503);
  equal(g.calls(), 0);
  equal(f.repo.reports.get(RID)!.revision, 1);
  assert(events.includes("settle-failure"));
});

Deno.test("member synthetic settlement failure keeps committed revision and same-key replay", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const first = await handler(f, g.gate, events, true, OWNER, true)(
    httpRequest("SYNTHETIC-settlement"),
  );
  equal(first.status, 503);
  equal(f.repo.reports.get(RID)!.revision, 2);
  equal(g.calls(), 1);
  const replay = await handler(f, g.gate, events)(httpRequest("SYNTHETIC-settlement"));
  equal(replay.status, 200);
  equal(f.repo.reports.get(RID)!.revision, 2);
  equal(g.calls(), 1);
  const body = await replay.json();
  assert(!Object.hasOwn(body.candidates, "wildcard_selection"));
});

Deno.test("member verified revision survives both projections and budget covers response bytes", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const response = await handler(f, g.gate, events, true, OWNER, false, true)(
    httpRequest("SYNTHETIC-verified"),
  );
  assert(response.status === 200, await response.clone().text());
  const body = await response.text(), json = JSON.parse(body);
  equal(json.candidates.wildcard_selection.status, "ready");
  equal(events.filter((e) => e === "projection-proof").length, 3);
  const measured = Number(
    events.find((e) => e.startsWith("budget-bytes:"))!.slice("budget-bytes:".length),
  );
  assert(measured >= new TextEncoder().encode(body).byteLength);
  assert(events.indexOf("settle-success") < events.lastIndexOf("projection-proof"));
});
Deno.test("member final proof revocation suppresses response after settlement", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const response = await handler(f, g.gate, events, true, OWNER, false, true, true)(
    httpRequest("SYNTHETIC-proof-expired"),
  );
  equal(response.status, 503);
  equal(f.repo.reports.get(RID)!.revision, 2);
  assert(events.includes("settle-success"));
  assert(!((await response.text()).includes("wildcard_selection")));
});

Deno.test("member non-budget session remains available with optional revision verifier", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const req = new Request("https://synthetic.invalid/api/v1/me", {
    headers: {
      Authorization: "Bearer SYNTHETIC-token",
      "X-Jungsi-Relay-Token": RELAY,
    },
  });
  const response = await handler(f, g.gate, events, true, OWNER, false, true)(req);
  equal(response.status, 200);
  equal(events, []);
  equal(g.calls(), 0);
});
Deno.test("default native budget serialization covers public bytes for synthetic numeric forms", () => {
  const examples: unknown[] = [
    { n: new JsonFloat("2") },
    { n: new JsonFloat("-2") },
    { n: new JsonFloat("2.0") },
    { n: new JsonFloat("2e1") },
    { rows: [new JsonFloat("0"), "가상", 42, 9n, null] },
  ];
  for (const value of examples) {
    const budget = new TextEncoder().encode(nativeJsonText(value)).byteLength;
    const output = new TextEncoder().encode(publicJsonText(value)).byteLength;
    assert(budget >= output);
  }
  assert(
    new TextEncoder().encode(nativeJsonText({ n: new JsonFloat("2") })).length >
      new TextEncoder().encode(publicJsonText({ n: new JsonFloat("2") })).length,
  );
});

Deno.test("member old report skips proof source and unavailable proof preserves legacy cards", async () => {
  const old = await preparedFixture(), oldEvents: string[] = [];
  const noProof = await handler(old, null, oldEvents, true, OWNER, false, true, false, true)(
    httpRequest("SYNTHETIC-old"),
  );
  equal(noProof.status, 200);
  assert(!oldEvents.includes("proof-source"));
  const newer = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const fallback = await handler(newer, g.gate, events, true, OWNER, false, true, false, true)(
    httpRequest("SYNTHETIC-proof-down"),
  );
  equal(fallback.status, 200);
  assert(events.includes("proof-source"));
  const dto = await fallback.json(),
    saved = newer.repo.reports.get(RID)!.body.candidates as NativeObject;
  assert(!Object.hasOwn(dto.candidates, "wildcard_selection"));
  equal(dto.candidates.wildcards.length, (saved.wildcards as unknown[]).length);
});

Deno.test("member final current revocation rejects before delivery receipt", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const race: DeliveryRace = { revokeAt: "current", revoked: false, receipts: 0 };
  const response = await handler(f, g.gate, events, true, OWNER, false, true, false, false, race)(
    httpRequest("SYNTHETIC-revoke-current"),
  );
  equal(response.status, 503);
  equal(race.receipts, 0);
  assert(events.includes("completion-current") && !events.includes("completion-deliver"));
  assert(!(await response.text()).includes("wildcard_selection"));
});
Deno.test("member final current valid keeps one delivery receipt and unchanged result", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const race: DeliveryRace = { revokeAt: "never", revoked: false, receipts: 0 };
  const response = await handler(f, g.gate, events, true, OWNER, false, true, false, false, race)(
    httpRequest("SYNTHETIC-current-valid"),
  );
  equal(response.status, 200);
  equal(race.receipts, 1);
  equal((await response.json()).candidates.wildcard_selection.status, "ready");
  assert(events.indexOf("completion-current") < events.lastIndexOf("proof-current"));
  assert(events.lastIndexOf("proof-current") < events.indexOf("completion-deliver"));
});
Deno.test("member revocation during delivery remains unresolved and is activation HOLD", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const race: DeliveryRace = { revokeAt: "deliver", revoked: false, receipts: 0 };
  const response = await handler(f, g.gate, events, true, OWNER, false, true, false, false, race)(
    httpRequest("SYNTHETIC-revoke-during-delivery"),
  );
  // Characterization of a known unresolved race, not an approval of this behavior.
  equal(response.status, 200);
  equal(race.receipts, 1);
  assert(race.revoked);
});
Deno.test("member default OFF retains existing delivery even with no selection authority", async () => {
  const f = await preparedFixture(), events: string[] = [];
  const race: DeliveryRace = { revokeAt: "current", revoked: false, receipts: 0 };
  const response = await handler(f, null, events, true, OWNER, false, false, false, false, race)(
    httpRequest("SYNTHETIC-off-current"),
  );
  equal(response.status, 200);
  equal(race.receipts, 1);
  assert(!Object.hasOwn((await response.json()).candidates, "wildcard_selection"));
});

Deno.test("member final selection content change fails before delivery receipt", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const race: DeliveryRace = { revokeAt: "projection3", revoked: false, receipts: 0 };
  const response = await handler(f, g.gate, events, true, OWNER, false, true, false, false, race)(
    httpRequest("SYNTHETIC-content-changed"),
  );
  equal(response.status, 503);
  equal(race.receipts, 0);
  assert(!events.includes("completion-deliver"));
});
Deno.test("member session expiry during final authority check fails before delivery receipt", async () => {
  const f = await preparedFixture(), events: string[] = [], g = gateFixture(events);
  const race: DeliveryRace = { revokeAt: "expire", revoked: false, receipts: 0 };
  const response = await handler(f, g.gate, events, true, OWNER, false, true, false, false, race)(
    httpRequest("SYNTHETIC-session-expired"),
  );
  equal(response.status, 401);
  equal(race.receipts, 0);
  assert(!events.includes("completion-deliver"));
});
