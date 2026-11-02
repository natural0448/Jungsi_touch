/**
 * Review-only synthetic race tests, adapted to this test directory.
 * Uses request-local transports over an in-memory fixture.
 * The single-slot SQL fixture serializes individual transactions; this is not
 * a claim of real PostgreSQL execution or production concurrency coverage.
 */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { ProfileReportService } from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import {
  cloneNativeJson,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { NativeExamTotalModel } from "../../supabase/functions/_shared/jungsi/domain/total_model.ts";
import { assert, equal } from "./fixture.ts";
import { syntheticNativeModelData, syntheticNativePackData } from "./synthetic_exam_pack.ts";
import { A, clock, nativeFixture, NOW, session } from "./synthetic_score_input_policy.ts";

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

function barrier() {
  let signal!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => signal = resolve);
  const open = new Promise<void>((resolve) => release = resolve);
  return { entered, signal: () => signal(), open, release: () => release() };
}

function caught<T>(work: Promise<T>) {
  return work.then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
}

async function awaitBarrier(
  entered: Promise<void>,
  outcome: Promise<{ value: unknown; error: unknown }>,
) {
  await Promise.race([
    entered,
    outcome.then((result) => {
      throw result.error ?? new Error("request finished before the intended barrier");
    }),
  ]);
}

function assertConflict(error: unknown) {
  assert(error instanceof AccessError);
  equal(error.code, "revision_conflict");
  equal(error.http, 409);
}

async function concurrentRevision(
  f: ReturnType<typeof nativeFixture>,
  reportId: string,
  profileId: string,
  key: string,
) {
  // Each synthetic request gets a separate transport fork over the same pool.
  const other = nativeFixture(f.p, f.pool);
  const previous = await other.platform.getReport(A, reportId);
  assert(previous !== null);
  equal(previous.revision, 1);
  const body = cloneNativeJson(previous.body);
  body.shortlist = {
    "SYNTHETIC-selected": {
      selected: true,
      changed_at: null,
      assessment_status: "needs_revalidation",
      profile_id: profileId,
      catalog_version: null,
    },
  };
  return await other.platform.writeReport({
    owner: A,
    reportId,
    profileId,
    body,
    expected: previous.revision,
    nowUtc: NOW,
    operation: "shortlist.update",
    key,
    digest: "d".repeat(64),
  });
}

function requestKey(key: string) {
  return [A, "overall.analyze", key].join("|");
}

Deno.test("pending model after a concurrent report revision returns 409 without writing", async () => {
  const f = nativeFixture();
  const profile = await f.save("SYNTHETIC-race-save-pending");
  const profileId = profile.profile_id as string;
  // The runtime wraps score-profile.create in accept; it does not wrap overall.analyze.
  const initial = await f.profile.execute(execution(profileId, "SYNTHETIC-race-initial-pending"));
  equal(initial.report_version, 1);
  const initialOverall = (initial.overall as NativeObject).overall as NativeObject;
  equal(initialOverall.status, "pending");
  const rid = initial.report_id as string;
  const b = barrier();
  const pack = new NativeExamPack(syntheticNativePackData());
  const service = new ProfileReportService(
    f.platform,
    {
      getExamPack: () => Promise.resolve(pack),
      getTotalModel: async () => {
        b.signal();
        await b.open;
        return null;
      },
    },
    clock,
    { mode: "rights", workflow: f.service },
  );
  const key = "SYNTHETIC-race-pending-refresh";
  const outcome = caught(service.execute(execution(profileId, key, initial)));
  await awaitBarrier(b.entered, outcome);
  const originsBefore = structuredClone(f.pool.state.origins);
  const attemptsBefore = f.pool.state.attempts.length;
  let changed: Awaited<ReturnType<typeof concurrentRevision>>;
  try {
    changed = await concurrentRevision(f, rid, profileId, "SYNTHETIC-race-other-pending");
  } finally {
    b.release();
  }
  equal(changed.revision, 2);
  const result = await outcome;
  assertConflict(result.error);
  const current = await f.platform.getReport(A, rid);
  assert(current !== null);
  equal(current.revision, 2);
  equal(current.body, changed.body);
  equal(f.pool.state.revisions.size, 2);
  equal(f.pool.state.requests.has(requestKey(key)), false);
  equal(f.pool.state.origins, originsBefore);
  equal(f.pool.state.attempts.length, attemptsBefore);
});

Deno.test("cached no-op preserves the explicit expected revision across concurrent change", async () => {
  const f = nativeFixture();
  const profile = await f.save("SYNTHETIC-race-save-ready");
  const profileId = profile.profile_id as string;
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
  const initial = await service.execute(execution(profileId, "SYNTHETIC-race-initial-ready"));
  equal(initial.report_version, 1);
  const initialOverall = (initial.overall as NativeObject).overall as NativeObject;
  equal(initialOverall.status, "observed");
  const rid = initial.report_id as string;
  const b = barrier();
  const getReport = f.platform.getReport.bind(f.platform);
  let held = false;
  f.platform.getReport = async (owner, reportId) => {
    const old = await getReport(owner, reportId);
    if (!held) {
      held = true;
      b.signal();
      await b.open;
    }
    return old;
  };
  const key = "SYNTHETIC-race-ready-reuse";
  const outcome = caught(service.execute(execution(profileId, key, initial)));
  await awaitBarrier(b.entered, outcome);
  const originsBefore = structuredClone(f.pool.state.origins);
  const attemptsBefore = f.pool.state.attempts.length;
  let changed: Awaited<ReturnType<typeof concurrentRevision>>;
  try {
    changed = await concurrentRevision(f, rid, profileId, "SYNTHETIC-race-other-ready");
  } finally {
    b.release();
  }
  equal(changed.revision, 2);
  const result = await outcome;
  if (result.error === null) {
    const returned = result.value as NativeObject;
    throw new Error(
      "unexpected success: revision=" + returned.report_version +
        ", receipt=" + f.pool.state.requests.has(requestKey(key)),
    );
  }
  assertConflict(result.error);
  const current = await f.platform.getReport(A, rid);
  assert(current !== null);
  equal(current.revision, 2);
  equal(current.body, changed.body);
  equal(f.pool.state.revisions.size, 2);
  equal(f.pool.state.requests.has(requestKey(key)), false);
  equal(f.pool.state.origins, originsBefore);
  equal(f.pool.state.attempts.length, attemptsBefore);
  equal(modelReads, 1);
});
