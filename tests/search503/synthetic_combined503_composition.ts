/** Actual runtime/factory/HTTP and business services; every external port is synthetic. */
import { NativeRuntimeApi } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
import { PublicJeongsiPassesReader } from "../../supabase/functions/_shared/jungsi/infrastructure/public_passes.ts";
import { ApprovedOperatingPolicy } from "../../supabase/functions/_shared/jungsi/application/operating_policy.ts";
import { OverallAnalysisService } from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
import {
  type BudgetRequest,
  RequestLimitError,
} from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import type { ReadViewCatalogFactory } from "../../supabase/functions/_shared/jungsi/infrastructure/read_view_catalog_runtime.ts";
import type { RuntimeRoutePolicy } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { syntheticOfferingAnalysisFixture } from "./synthetic_offering_analysis.ts";
import {
  SYNTHETIC_RUNTIME_NOW as NOW,
  SYNTHETIC_RUNTIME_URL,
  syntheticRuntimeBinding,
} from "./synthetic_runtime_binding.ts";
import { assert } from "./fixture.ts";
import type { ServerOnlySink } from "../../supabase/functions/_shared/search_failure_diagnostic.ts";
import { SERVICE_END_UTC_MICROS } from "../../supabase/functions/_shared/jungsi/application/service_end_admission.ts";

type CurrentCatalogTestRecord = {
  row: NativeObject;
  guide: NativeObject;
  key: [number, string, string, string, string];
};
interface CurrentCatalogTestPort {
  publication(): Promise<{ version: string; sha256: string; expiresAtUtc: bigint }>;
  lookup(
    owner: string,
    ids: readonly string[],
    detail?: boolean,
  ): Promise<
    { version: string; head: string; asOfUtc: bigint; rows: readonly CurrentCatalogTestRecord[] }
  >;
  search(): never;
}
const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002";
const PID = "SYNTHETIC-profile", RID = "SYNTHETIC-report", OLD = "SYNTHETIC-A-2027";
const IDS = Array.from({ length: 8 }, (_, i) => "2027:SYNTHETIC-NEW-" + i);
const EXPIRY = SERVICE_END_UTC_MICROS + 3_600_000_000n;
function bearer(owner: string) {
  const claims = JSON.stringify({
    sub: owner,
    iss: SYNTHETIC_RUNTIME_URL + "/auth/v1",
    exp: Number(EXPIRY / 1_000_000n),
    aal: "aal1",
  });
  return "e30." + btoa(claims).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") +
    ".SYNTHETIC";
}
export async function currentCatalogCompositionFixture(
  createCatalog: (
    data: Parameters<ReadViewCatalogFactory>[0],
    clock: Parameters<ReadViewCatalogFactory>[1],
    current: CurrentCatalogTestPort,
    context: Parameters<ReadViewCatalogFactory>[4] & { searchDiagnostic?: ServerOnlySink },
  ) => ReturnType<ReadViewCatalogFactory>,
  routeCatalog: { operations: readonly RuntimeRoutePolicy[] },
  responseSchemas: unknown,
) {
  const source = syntheticOfferingAnalysisFixture(), binding = await syntheticRuntimeBinding();
  const repo = new SyntheticNativeRepository(),
    calls = {
      lookups: [] as { owner: string; ids: string[] }[],
      publication: 0,
      catalog: 0,
      conversion: 0,
      reference: 0,
      analysis: 0,
      budget: 0,
      profileSave: 0,
      delivery: 0,
      prepare: 0,
      restrict: 0,
    };
  const state = {
    now: NOW,
    paid: true,
    auth: true,
    denyBudget: false,
    qualified: true,
    practical: false,
    publicationExpired: false,
  };
  const data = {
    getCatalog: () => {
      calls.catalog++;
      return Promise.resolve({
        version: "SYNTHETIC-old",
        status: "approved",
        asOfUtc: NOW,
        offerings: [{ ...source.data.offering, practical_required: false }],
        history: [],
      });
    },
    getExamPack: source.data.getExamPack.bind(source.data),
    getTotalModel: () => Promise.resolve(null),
    getConversion: (id: string) => {
      calls.conversion++;
      return source.data.getConversion(id);
    },
    getReference: (_id: string) => {
      calls.reference++;
      return Promise.resolve(null);
    },
    getPercentile: (id: string) =>
      Promise.resolve(id === OLD ? source.settings.curves.get(2027)! : null),
    getAnalysis: (id: string) => {
      calls.analysis++;
      return Promise.resolve(id === OLD ? source.release() : null);
    },
    withScoringBatch: <T>(work: () => Promise<T>) => work(),
  };
  const scores = source.data.scores();
  const operating = new ApprovedOperatingPolicy({
    format: "jungsi.score-input-policy/v1",
    status: "approved",
    purpose: "paid_score_input",
    version: "SYNTHETIC-policy",
    rollout_id: "SYNTHETIC-rollout",
    calculation_version: "SYNTHETIC-calc",
    approval_reference_sha256: "a".repeat(64),
    expires_at: utcText(EXPIRY),
    personal_daily_analysis_limit: "replaced_by_stage_rights",
    initial_saves: 1,
    correction_grants: 1,
    physical: { max_request_calculation_units: 1000, max_request_runtime_milliseconds: 10000 },
    preview: { enabled: false, expires_at: utcText(EXPIRY), allow_subjects: [] },
    stages: [{
      exam_id: scores.exam_id,
      pack_version: scores.pack_version,
      input_scope_id: "SYNTHETIC-season",
      academic_year: 2027,
      stage: "mock",
      window: { mode: "policy_lifetime" },
    }],
  }, {
    policyVersion: "SYNTHETIC-policy",
    approvalSha256: "a".repeat(64),
    expiresAtUtc: EXPIRY,
    exams: new Map([[scores.exam_id as string, {
      packVersion: scores.pack_version as string,
      academicYear: 2027,
    }]]),
    registrySha256: "b".repeat(64),
    selectionSha256: "c".repeat(64),
  });
  const stage = operating.stage(scores.exam_id, "mock", NOW);
  const setupSession = {
    user: { subjectId: OWNER, expiresAtUtc: EXPIRY },
    evaluatedAtUtc: NOW,
    tier: "paid" as const,
    paidUntilUtc: EXPIRY,
  };
  const overall = await new OverallAnalysisService(data).analyze(setupSession, scores);
  for (const [owner, pid, rid] of [[OWNER, PID, RID], [OTHER, PID + "-other", RID + "-other"]]) {
    repo.profiles.set(pid, {
      profile_id: pid,
      owner_id: owner,
      scores,
      confirmed: true,
      created_at: utcText(NOW),
    });
    repo.reports.set(rid, {
      report_id: rid,
      owner_id: owner,
      profile_id: pid,
      revision: 1,
      updated_at: utcText(NOW),
      body: {
        overall: overall as NativeObject,
        analyses: {},
        candidates: null,
        shortlist: {},
        catalog_version: null,
        analysis_status: { status: "pending", reason_code: "offering_analysis_not_requested" },
      },
    });
  }
  const inputStates = new Map([OWNER, OTHER].map((owner) => [owner, {
    version: 1,
    initialAttemptId: "SYNTHETIC-already-used",
    currentProfileId: owner === OWNER ? PID : PID + "-other",
    correctionGrantId: null,
    correctionAttemptId: null,
    lastAttemptId: "SYNTHETIC-already-used",
    lastOutcome: "accepted",
    lastRejectionCode: null,
  }]));
  const scoreInputs = {
    profileContext: (owner: string, pid: string) =>
      Promise.resolve(
        repo.profiles.get(pid)?.owner_id === owner ? { owner, stage, previewExempt: false } : null,
      ),
    state: (c: { owner: string }) => Promise.resolve(inputStates.get(c.owner)),
    recordDelivered: () => {
      calls.delivery++;
      return Promise.resolve();
    },
    commitProfile: () => {
      calls.profileSave++;
      throw new Error("No synthetic score save expected");
    },
  };
  function record(id: string): CurrentCatalogTestRecord {
    const pk = id.slice("2027:".length);
    const row: NativeObject = {
      offering_id: id,
      academic_year: 2027,
      school_id: "SYNTHETIC-SCHOOL",
      offering_pk: pk,
      university_code: "SYNTHETIC-UNI",
      university: "가상대학교",
      department: "가상모집단위",
      track: "가상일반",
      recruit_group: "가",
      active_service: true,
      canonical_result_id: "SYNTHETIC-OBS-" + pk,
      metric_kind: "final_waitlist_rank",
    };
    const guide: NativeObject = {
      ...row,
      release_id: "SYNTHETIC-GUIDE",
      location: "가상지역",
      quota_value: null,
      practical_required: state.practical,
      metadata: {
        practical_required: state.qualified ? false : null,
        participation_conditions_status: state.qualified ? "verified" : "pending",
      },
    };
    return {
      row,
      guide,
      key: [2027, "SYNTHETIC-SCHOOL", pk, "final_waitlist_rank", row.canonical_result_id as string],
    };
  }
  const current: CurrentCatalogTestPort = {
    publication: () => {
      calls.publication++;
      return Promise.resolve({
        version: "SYNTHETIC-current",
        sha256: "d".repeat(64),
        expiresAtUtc: state.publicationExpired ? NOW : EXPIRY,
      });
    },
    lookup: (owner, ids) => {
      calls.lookups.push({ owner, ids: [...ids] });
      return Promise.resolve({
        version: "SYNTHETIC-current",
        head: "e".repeat(64),
        asOfUtc: NOW,
        rows: ids.filter((id) => IDS.includes(id)).sort().map(record),
      });
    },
    search: () => {
      throw new Error("Analysis must use exact lookup, never search/name matching");
    },
  };
  const budget = {
    policy: { operating },
    run: async (_request: BudgetRequest, work: () => Promise<unknown>) => {
      calls.budget++;
      if (state.denyBudget) throw new RequestLimitError("rate_limit_exceeded", 7);
      return await work();
    },
  };
  const observations: unknown[] = [];
  const api = new NativeRuntimeApi({
    observe: (event) => {
      observations.push(event);
    },
    readViewExtensions: true,
    memberShortlistExtensions: true,
    environment: binding.env,
    policies: routeCatalog.operations as readonly RuntimeRoutePolicy[],
    responseSchemas,
    clock: { nowUtc: () => state.now },
    candidateCatalog: (native, clock, _sql, _env, context) => {
      const catalog = createCatalog(
        native,
        clock,
        current,
        context as typeof context & { searchDiagnostic?: ServerOnlySink },
      );
      const prepare = catalog.prepareSelection.bind(catalog),
        restrict = catalog.restrictAnalysisData.bind(catalog);
      catalog.prepareSelection = (request) => {
        calls.prepare++;
        prepare(request);
      };
      catalog.restrictAnalysisData = (port) => {
        calls.restrict++;
        restrict(port);
      };
      return catalog;
    },
    createPool: () => ({
      transaction: () => {
        throw new Error("Synthetic context ports must not open SQL connections");
      },
      close: () => Promise.resolve(),
    }),
    fetcher: (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(
          Response.json({ id: selectedOwner }, { status: state.auth ? 200 : 401 }),
        );
      }
      if (url.pathname === "/rest/v1/profiles") {
        return Promise.resolve(Response.json([{ role: "student", status: "active" }]));
      }
      throw new Error("No private network fetch in composition fixture");
    },
  });
  let selectedOwner = OWNER;
  function request(
    ids = IDS,
    version = 1,
    key = "SYNTHETIC-key",
    owner = OWNER,
    rid = RID,
    relay = true,
  ) {
    selectedOwner = owner;
    const path = routeCatalog.operations.find((p) => p.id === "university.analyze")!.path.replace(
      "{report_id}",
      rid,
    );
    return new Request("https://synthetic.invalid" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + bearer(owner),
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...(relay ? { "X-Jungsi-Relay-Token": binding.values.JUNGSI_RELAY_TOKEN } : {}),
      },
      body: JSON.stringify({ expected_version: version, offering_ids: ids }),
    });
  }
  function reportRequest(
    operation: "shortlist.update" | "candidates.build",
    id = IDS[0],
    version = 1,
    key = "SYNTHETIC-report-key",
  ) {
    selectedOwner = OWNER;
    const policy = routeCatalog.operations.find((p) => p.id === operation)!;
    const path = policy.path.replace("{report_id}", RID).replace("{offering_id}", id);
    return new Request("https://synthetic.invalid" + path, {
      method: policy.method,
      headers: {
        Authorization: "Bearer " + bearer(OWNER),
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        "X-Jungsi-Relay-Token": binding.values.JUNGSI_RELAY_TOKEN,
      },
      body: JSON.stringify({
        expected_version: version,
        ...(operation === "shortlist.update" ? { selected: true } : {}),
      }),
    });
  }
  const patches: [object, string, PropertyDescriptor | undefined][] = [];
  function replace(object: object, name: string, value: unknown) {
    patches.push([object, name, Object.getOwnPropertyDescriptor(object, name)]);
    Object.defineProperty(object, name, { configurable: true, writable: true, value });
  }
  async function run(work: () => Promise<void>) {
    replace(NativeRuntimeRequest.prototype, "platform", () => Promise.resolve(repo));
    replace(NativeRuntimeRequest.prototype, "data", () => Promise.resolve(data));
    replace(NativeRuntimeRequest.prototype, "budget", () => Promise.resolve(budget));
    replace(NativeRuntimeRequest.prototype, "scoreInputs", () => Promise.resolve(scoreInputs));
    replace(
      NativeRuntimeRequest.prototype,
      "forecasts",
      () =>
        Promise.resolve({
          publishedMany: (_owner: string, ids: readonly string[]) =>
            Promise.resolve(new Map(ids.map((id) => [id, null]))),
        }),
    );
    replace(NativeRuntimeRequest.prototype, "assertCurrent", () => Promise.resolve());
    replace(
      PublicJeongsiPassesReader.prototype,
      "readCurrent",
      (owner: string, now: bigint) =>
        Promise.resolve({
          authority: "public.jeongsi_passes",
          metadataVerified: true,
          subjectId: owner,
          evaluatedAtUtc: now,
          paidUntilUtc: state.paid ? EXPIRY : null,
          passId: state.paid ? "1" : null,
        }),
    );
    try {
      await work();
    } finally {
      for (const [object, name, descriptor] of patches.reverse()) {
        assert(descriptor);
        Object.defineProperty(object, name, descriptor);
      }
      await api.close();
    }
  }
  return { api, request, reportRequest, run, repo, calls, state, inputStates, observations };
}
