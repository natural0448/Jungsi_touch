/** Explicit refresh recovery; invented data and existing in-memory repositories only. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import {
  cloneNativeJson,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { ProfileReportService } from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import { safeFailure } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { NativeExamTotalModel } from "../../supabase/functions/_shared/jungsi/domain/total_model.ts";
import { syntheticNativeModelData, syntheticNativePackData } from "./synthetic_exam_pack.ts";
import { A, clock, nativeFixture, session } from "./synthetic_score_input_policy.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { assert, equal } from "./fixture.ts";

function execution(profileId: string, key: string, previous?: NativeObject): ApiExecution {
  return {
    operation: "overall.analyze",
    session: session(),
    management: null,
    body: {
      profile_id: profileId,
      ...(previous
        ? { report_id: previous.report_id, expected_version: previous.report_version }
        : {}),
    },
    query: {},
    params: {},
    requestKey: key,
  };
}
function pending(report: NativeObject): boolean {
  return ((report.overall as NativeObject).overall as NativeObject).status === "pending";
}
async function blocked(work: () => Promise<unknown>, code = "overall_model_refresh_pending") {
  let caught: unknown;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof AccessError);
  equal(caught.code, code);
  equal(caught.http, 503);
  return caught;
}

Deno.test("explicit overall refresh recalculates a pending same-context result without another score input", async () => {
  const f = nativeFixture();
  const saved = await f.save();
  const initial = await f.repo.accept(
    A,
    () => f.profile.execute(execution(saved.profile_id as string, "SYNTHETIC-initial-report")),
  );
  assert(pending(initial));
  const pack = new NativeExamPack(syntheticNativePackData());
  const model = new NativeExamTotalModel(syntheticNativeModelData());
  let modelReads = 0;
  const service = new ProfileReportService(
    f.platform,
    {
      getExamPack: () => Promise.resolve(pack),
      getTotalModel: () => {
        modelReads++;
        return Promise.resolve({ model, distributionId: model.distributionId });
      },
    },
    clock,
    { mode: "rights", workflow: f.service },
  );
  const input = execution(saved.profile_id as string, "SYNTHETIC-explicit-refresh", initial);
  const refreshed = await f.repo.accept(A, () => service.execute(input));
  assert(!pending(refreshed));
  equal(refreshed.report_id, initial.report_id);
  equal(refreshed.report_version, 2);
  equal(modelReads, 1);
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
  equal(f.pool.state.states.length, 1);
  const replay = await f.repo.accept(A, () => service.execute(input));
  equal(replay, refreshed);
  equal(modelReads, 1);
  equal(f.pool.state.revisions.size, 2);
});

Deno.test("still missing model on explicit refresh keeps prior revision and input rights intact", async () => {
  const f = nativeFixture();
  const saved = await f.save();
  const initial = await f.repo.accept(
    A,
    () => f.profile.execute(execution(saved.profile_id as string, "SYNTHETIC-missing-initial")),
  );
  await blocked(() =>
    f.repo.accept(
      A,
      () =>
        f.profile.execute(
          execution(saved.profile_id as string, "SYNTHETIC-still-missing", initial),
        ),
    )
  );
  equal(f.pool.state.revisions.size, 1);
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
  const read = await f.profile.execute({
    ...execution(saved.profile_id as string, "SYNTHETIC-read"),
    operation: "report.read",
    body: {},
    params: { report_id: initial.report_id as string },
    requestKey: null,
  });
  equal(read.report_version, 1);
  assert(pending(read));
});

Deno.test("a pending recalculation cannot replace an existing successful overall result", async () => {
  const repo = new SyntheticNativeRepository();
  const pack = new NativeExamPack(syntheticNativePackData());
  const model = new NativeExamTotalModel(syntheticNativeModelData());
  let connected = true;
  const service = new ProfileReportService(
    repo,
    {
      getExamPack: () => Promise.resolve(pack),
      getTotalModel: () =>
        Promise.resolve(connected ? { model, distributionId: model.distributionId } : null),
    },
    clock,
    { mode: "legacy_synthetic" },
  );
  const scores = {
    exam_id: "SYNTHETIC-mock",
    pack_version: "SYNTHETIC-pack.v1",
    korean: { standard_score: 5 },
    math: { standard_score: 6 },
    inquiry: [{ subject: "가상탐구가", standard_score: 7 }, {
      subject: "가상탐구나",
      standard_score: 8,
    }],
  };
  const initial = await service.execute({
    ...execution("unused", "SYNTHETIC-ready"),
    body: scores,
  });
  assert(!pending(initial));
  const profileId = [...repo.profiles.keys()][0];
  connected = false;
  await blocked(() => service.execute(execution(profileId, "SYNTHETIC-ready-to-missing", initial)));
  equal(repo.reports.size, 1);
  equal([...repo.reports.values()][0].revision, 1);
  const current = await service.execute({
    ...execution(profileId, "SYNTHETIC-read-ready"),
    operation: "report.read",
    body: {},
    params: { report_id: initial.report_id as string },
    requestKey: null,
  });
  equal(current, initial);
});

Deno.test("initial analysis without a model preserves pending instead of inventing a percentile", async () => {
  const f = nativeFixture();
  const saved = await f.save();
  const report = await f.repo.accept(
    A,
    () => f.profile.execute(execution(saved.profile_id as string, "SYNTHETIC-no-fallback")),
  );
  const overall = (report.overall as NativeObject).overall as NativeObject;
  equal(overall.status, "pending");
  equal(overall.reason_code, "total_model_missing");
  equal(overall.inclusive_top_percent, null);
  equal(overall.exclusive_top_percent, null);
  equal(f.pool.state.profiles.size, 1);
});

function readyService(f: ReturnType<typeof nativeFixture>) {
  const pack = new NativeExamPack(syntheticNativePackData());
  const model = new NativeExamTotalModel(syntheticNativeModelData());
  return new ProfileReportService(
    f.platform,
    {
      getExamPack: () => Promise.resolve(pack),
      getTotalModel: () => Promise.resolve({ model, distributionId: model.distributionId }),
    },
    clock,
    { mode: "rights", workflow: f.service },
  );
}

async function storedPending(
  kind: "analysis" | "candidates" | "shortlist" | "invalid_analysis" | "invalid_candidates",
  changedContext = false,
) {
  const f = nativeFixture();
  const profile = await f.save();
  const initial = await f.repo.accept(
    A,
    () => f.profile.execute(execution(profile.profile_id as string, "SYNTHETIC-guard-initial")),
  );
  const rid = initial.report_id as string;
  const previous = await f.platform.getReport(A, rid);
  assert(previous !== null);
  const body = cloneNativeJson(previous.body);
  body.shortlist = {
    "SYNTHETIC-zero": {
      selected: true,
      changed_at: null,
      assessment_status: "ready",
      profile_id: profile.profile_id,
      catalog_version: "SYNTHETIC-catalog",
    },
  };
  if (changedContext) (body.operation_contexts as NativeObject).overall = "f".repeat(64);
  let operation: "university.analyze" | "candidates.build" | "shortlist.update" =
    "shortlist.update";
  let componentKeys: string[] = [];
  if (kind === "analysis") {
    operation = "university.analyze";
    componentKeys = ["analysis:SYNTHETIC-zero"];
    body.analyses = {
      "SYNTHETIC-zero": {
        offering_id: "SYNTHETIC-zero",
        status: "pending",
        reason_code: "offering_analysis_not_requested",
        converted_score: 0,
        converted_percentile: null,
        category: "pending",
        advantage: null,
        years: [],
        versions: { rule: "SYNTHETIC-rule" },
        eligibility_status: "needs_confirmation",
      },
    };
    (body.operation_contexts as NativeObject)["analysis:SYNTHETIC-zero"] = "a".repeat(64);
  } else if (kind === "candidates") {
    operation = "candidates.build";
    componentKeys = ["candidates"];
    body.candidates = {
      status: "pending",
      reason_code: "approved_candidates_missing",
      basic_university_groups: [],
      wildcards: [],
      pending_offerings: [{
        offering_id: "SYNTHETIC-zero",
        category: "pending",
        reason_code: null,
      }],
      outside_offerings: [],
      ineligible_offerings: [],
      catalog_version: "SYNTHETIC-catalog",
    };
    (body.operation_contexts as NativeObject).candidates = "b".repeat(64);
  } else if (kind === "invalid_analysis") {
    body.analyses = null;
  } else if (kind === "invalid_candidates") {
    body.candidates = [];
  }
  const stored = await f.repo.accept(A, () =>
    f.platform.writeReport({
      owner: A,
      reportId: rid,
      profileId: profile.profile_id as string,
      body,
      expected: previous.revision,
      nowUtc: clock.nowUtc(),
      operation,
      key: "SYNTHETIC-guard-seed",
      digest: "c".repeat(64),
      ...(operation === "shortlist.update"
        ? {}
        : { paidOrigin: f.service.origin(session(), operation, componentKeys) }),
    }));
  return { f, profile, stored };
}

function preservedState(f: ReturnType<typeof nativeFixture>) {
  return structuredClone({
    reports: [...f.pool.state.reports],
    revisions: [...f.pool.state.revisions],
    profiles: [...f.pool.state.profiles],
    attempts: f.pool.state.attempts,
    states: f.pool.state.states,
    origins: f.pool.state.origins,
    requests: [...f.pool.state.requests],
  });
}

Deno.test("pending refresh protects zero-score analysis, selection, origins, and input rights", async () => {
  const { f, profile, stored } = await storedPending("analysis");
  const before = preservedState(f);
  const error = await blocked(
    () =>
      f.repo.accept(A, () =>
        readyService(f).execute(execution(
          profile.profile_id as string,
          "SYNTHETIC-guard-analysis",
          { report_id: stored.report_id, report_version: stored.revision },
        ))),
    "overall_refresh_result_preservation_required",
  );
  equal(preservedState(f), before);
  const current = await f.platform.getReport(A, stored.report_id);
  assert(current !== null);
  equal(current.revision, stored.revision);
  equal(
    ((current.body.analyses as NativeObject)["SYNTHETIC-zero"] as NativeObject).converted_score,
    0,
  );
  equal(
    ((current.body.shortlist as NativeObject)["SYNTHETIC-zero"] as NativeObject).selected,
    true,
  );
  assert(f.pool.state.origins.some((o) => o.component === "analysis:SYNTHETIC-zero"));
  const response = safeFailure(error, "a".repeat(32));
  equal(response.status, 503);
  equal(response.headers.get("Cache-Control"), "no-store");
  equal((await response.json()).error.code, "backend_dependency_unavailable");
});

Deno.test("pending refresh protects candidates even when the analysis map is empty and context changed", async () => {
  const { f, profile, stored } = await storedPending("candidates", true);
  const before = preservedState(f);
  await blocked(
    () =>
      f.repo.accept(A, () =>
        readyService(f).execute(execution(
          profile.profile_id as string,
          "SYNTHETIC-guard-candidates",
          { report_id: stored.report_id, report_version: stored.revision },
        ))),
    "overall_refresh_result_preservation_required",
  );
  equal(preservedState(f), before);
  const current = await f.platform.getReport(A, stored.report_id);
  assert(current !== null);
  equal(current.body.candidates, stored.body.candidates);
  assert(f.pool.state.origins.some((o) => o.component === "candidates"));
});

Deno.test("pending refresh without saved analyses or candidates keeps the selection for revalidation", async () => {
  const { f, profile, stored } = await storedPending("shortlist");
  const beforeOrigins = structuredClone(f.pool.state.origins);
  const beforeAttempts = structuredClone(f.pool.state.attempts);
  const refreshed = await f.repo.accept(A, () =>
    readyService(f).execute(execution(
      profile.profile_id as string,
      "SYNTHETIC-guard-empty",
      { report_id: stored.report_id, report_version: stored.revision },
    )));
  assert(!pending(refreshed));
  equal(refreshed.report_version, stored.revision + 1);
  const selected = (refreshed.shortlist as NativeObject)["SYNTHETIC-zero"] as NativeObject;
  equal(selected.selected, true);
  equal(selected.assessment_status, "needs_revalidation");
  equal(f.pool.state.attempts, beforeAttempts);
  equal(f.pool.state.origins.slice(0, beforeOrigins.length), beforeOrigins);
});

Deno.test("pending refresh fails closed on malformed persisted analysis or candidates", async () => {
  for (const kind of ["invalid_analysis", "invalid_candidates"] as const) {
    const { f, profile, stored } = await storedPending(kind);
    const before = preservedState(f);
    await blocked(
      () =>
        f.repo.accept(A, () =>
          readyService(f).execute(execution(
            profile.profile_id as string,
            "SYNTHETIC-guard-malformed-" + kind,
            { report_id: stored.report_id, report_version: stored.revision },
          ))),
      "invalid_repository_result",
    );
    equal(preservedState(f), before);
  }
});

async function storedReady(kind: "analysis" | "candidates", changedContext: boolean) {
  const f = nativeFixture();
  const profile = await f.save();
  const initial = await f.repo.accept(
    A,
    () =>
      readyService(f).execute(execution(profile.profile_id as string, "SYNTHETIC-ready-initial")),
  );
  assert(!pending(initial));
  const previous = await f.platform.getReport(A, initial.report_id as string);
  assert(previous !== null);
  const body = cloneNativeJson(previous.body);
  const contexts = body.operation_contexts as NativeObject;
  if (changedContext) {
    assert(contexts.overall !== "f".repeat(64));
    contexts.overall = "f".repeat(64);
  }
  let operation: "university.analyze" | "candidates.build";
  let component: string;
  if (kind === "analysis") {
    operation = "university.analyze";
    component = "analysis:SYNTHETIC-zero-ready";
    body.analyses = {
      "SYNTHETIC-zero-ready": {
        offering_id: "SYNTHETIC-zero-ready",
        status: "ready",
        reason_code: null,
        converted_score: 0,
        converted_percentile: 0,
        category: "pending",
        advantage: null,
        years: [],
        versions: { rule: "SYNTHETIC-rule" },
        eligibility_status: "needs_confirmation",
      },
    };
    contexts[component] = "a".repeat(64);
  } else {
    operation = "candidates.build";
    component = "candidates";
    body.candidates = {
      status: "pending",
      reason_code: "approved_candidates_missing",
      basic_university_groups: [],
      wildcards: [],
      pending_offerings: [{
        offering_id: "SYNTHETIC-zero-ready",
        category: "pending",
        reason_code: null,
      }],
      outside_offerings: [],
      ineligible_offerings: [],
      catalog_version: "SYNTHETIC-catalog",
    };
    contexts.candidates = "b".repeat(64);
  }
  const stored = await f.repo.accept(A, () =>
    f.platform.writeReport({
      owner: A,
      reportId: previous.report_id,
      profileId: profile.profile_id as string,
      body,
      expected: previous.revision,
      nowUtc: clock.nowUtc(),
      operation,
      key: "SYNTHETIC-ready-seed-" + kind,
      digest: "c".repeat(64),
      paidOrigin: f.service.origin(session(), operation, [component]),
    }));
  return { f, profile, stored };
}

Deno.test("ready refresh with a changed context preserves existing analysis and candidates", async () => {
  for (const kind of ["analysis", "candidates"] as const) {
    const { f, profile, stored } = await storedReady(kind, true);
    const before = preservedState(f);
    await blocked(
      () =>
        f.repo.accept(A, () =>
          readyService(f).execute(execution(
            profile.profile_id as string,
            "SYNTHETIC-ready-guard-" + kind,
            { report_id: stored.report_id, report_version: stored.revision },
          ))),
      "overall_refresh_result_preservation_required",
    );
    equal(preservedState(f), before);
    const current = await f.platform.getReport(A, stored.report_id);
    assert(current !== null);
    equal(current.revision, stored.revision);
    if (kind === "analysis") {
      equal(
        ((current.body.analyses as NativeObject)["SYNTHETIC-zero-ready"] as NativeObject)
          .converted_score,
        0,
      );
    } else {
      equal(current.body.candidates, stored.body.candidates);
    }
  }
});

Deno.test("same-context ready no-op preserves existing analysis and candidates", async () => {
  for (const kind of ["analysis", "candidates"] as const) {
    const { f, profile, stored } = await storedReady(kind, false);
    const before = preservedState(f);
    const pack = new NativeExamPack(syntheticNativePackData());
    const model = new NativeExamTotalModel(syntheticNativeModelData());
    let modelReads = 0;
    const service = new ProfileReportService(
      f.platform,
      {
        getExamPack: () => Promise.resolve(pack),
        getTotalModel: () => {
          modelReads++;
          return Promise.resolve({ model, distributionId: model.distributionId });
        },
      },
      clock,
      { mode: "rights", workflow: f.service },
    );
    const input = execution(
      profile.profile_id as string,
      "SYNTHETIC-ready-noop-" + kind,
      { report_id: stored.report_id, report_version: stored.revision },
    );
    const result = await f.repo.accept(A, () => service.execute(input));
    equal(result.report_version, stored.revision);
    equal(modelReads, 0);
    equal({ ...preservedState(f), requests: [] }, { ...before, requests: [] });
    const replay = await f.repo.accept(A, () => service.execute(input));
    equal(replay, result);
    equal(modelReads, 0);
    const current = await f.platform.getReport(A, stored.report_id);
    assert(current !== null);
    equal(current.body.analyses, stored.body.analyses);
    equal(current.body.candidates, stored.body.candidates);
  }
});
