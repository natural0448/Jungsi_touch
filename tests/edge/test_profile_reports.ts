import { syncPromise } from "./fixture.ts";
/** Persisted business workflows with existing invented exam data and explicit test repository. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type {
  ApiExecution,
  ApiOperationId,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { ProfileReportService } from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { NativeExamTotalModel } from "../../supabase/functions/_shared/jungsi/domain/total_model.ts";
import type { NativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { syntheticNativeModelData, syntheticNativePackData } from "./synthetic_exam_pack.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { assert, equal } from "./fixture.ts";
Deno.test("completed profile and overall keys still reject forbidden query before saved response lookup", async () => {
  for (const op of ["score-profile.create", "overall.analyze"] as const) {
    const f = fixture(),
      r = op === "score-profile.create"
        ? execution(op, { scores: scores(), confirmed: true })
        : execution(op, scores());
    const first = await f.service.execute(r),
      replays = f.repo.events.filter((e) => e === "replay").length,
      calls = f.calls();
    await denied(
      () => f.service.execute({ ...r, query: { unexpected: "SYNTHETIC" } }),
      "invalid_request",
      422,
    );
    equal(f.repo.events.filter((e) => e === "replay").length, replays);
    equal(f.calls(), calls);
    equal(await f.service.execute(r), first);
  }
});
const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002",
  NOW = 1700000000000000n;
function scores() {
  return {
    exam_id: "SYNTHETIC-mock",
    pack_version: "SYNTHETIC-pack.v1",
    korean: { standard_score: 5 },
    math: { standard_score: 6 },
    inquiry: [{ subject: "가상탐구가", standard_score: 7 }, {
      subject: "가상탐구나",
      standard_score: 8,
    }],
  };
}
function execution(
  op: ApiOperationId,
  body: NativeJson = {},
  params: Record<string, string> = {},
  paid = true,
  key = "SYNTHETIC-key",
): ApiExecution {
  return {
    operation: op,
    session: {
      user: { subjectId: OWNER, expiresAtUtc: NOW + 1000000n },
      evaluatedAtUtc: NOW,
      tier: paid ? "paid" : "standard",
      paidUntilUtc: paid ? NOW + 500000n : null,
    },
    management: null,
    body,
    query: {},
    params,
    requestKey: key,
  };
}
function fixture(
  options: { missingModel?: boolean; missingPack?: boolean; expireAtPack?: boolean } = {},
) {
  const repo = new SyntheticNativeRepository(),
    pack = new NativeExamPack(syntheticNativePackData()),
    model = new NativeExamTotalModel(syntheticNativeModelData());
  let calls = 0, now = NOW;
  const service = new ProfileReportService(
    repo,
    {
      getExamPack() {
        return syncPromise(() => {
          calls++;
          if (options.expireAtPack) now = NOW + 2000000n;
          return options.missingPack ? null : pack;
        });
      },
      getTotalModel() {
        return syncPromise(() => {
          return options.missingModel ? null : { model, distributionId: model.distributionId };
        });
      },
    },
    { nowUtc: () => now },
    { mode: "legacy_synthetic" },
  );
  return { service, repo, calls: () => calls };
}
async function denied(run: () => Promise<unknown>, code: string, http: number) {
  let e: unknown;
  try {
    await run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, http);
}
Deno.test("profile business validates same-exam scores and returns closed immutable profile identity", async () => {
  const f = fixture(),
    r = await f.service.execute(
      execution("score-profile.create", { scores: scores(), confirmed: true }),
    );
  equal(Object.keys(r).sort(), ["confirmed", "created_at", "profile_id", "profile_version"]);
  equal(r.confirmed, true);
  equal(f.repo.profiles.size, 1);
  const p = [...f.repo.profiles.values()][0];
  equal(p.owner_id, OWNER);
  equal(p.scores, scores());
  assert(!Object.hasOwn(r, "scores"));
});
Deno.test("profile business rejects nonboolean confirmation before pack access or profile write", async () => {
  const f = fixture();
  await denied(
    () =>
      f.service.execute(execution("score-profile.create", { scores: scores(), confirmed: "true" })),
    "invalid_confirmation",
    422,
  );
  equal(f.calls(), 0);
  equal(f.repo.profiles.size, 0);
});
Deno.test("overall direct business persists unconfirmed profile and hides paid report fields for standard", async () => {
  const f = fixture(),
    r = await f.service.execute(execution("overall.analyze", scores(), {}, false));
  equal(r.format, "jungsi.persisted-report/v1");
  equal(r.report_version, 1);
  equal((r.overall as NativeObject).total_standard_score, 26);
  assert(!Object.hasOwn(r, "analyses"));
  equal([...f.repo.profiles.values()][0].confirmed, false);
  const body = [...f.repo.reports.values()][0].body;
  equal(body.analyses, {});
  equal(body.candidates, null);
});
Deno.test("overall persisted replay does not create a second profile report or calculation", async () => {
  const f = fixture(),
    input = execution("overall.analyze", scores()),
    r = await f.service.execute(input),
    count = f.calls();
  equal(await f.service.execute(input), r);
  equal(f.calls(), count);
  equal(f.repo.profiles.size, 1);
  equal(f.repo.reports.size, 1);
  await denied(
    () => f.service.execute({ ...input, body: { ...scores(), english_grade: 2 } }),
    "idempotency_conflict",
    409,
  );
});
Deno.test("profile based overall reuses owned confirmed profile without duplicating scores", async () => {
  const f = fixture(),
    p = await f.service.execute(
      execution("score-profile.create", { scores: scores(), confirmed: true }),
    );
  const r = await f.service.execute(execution("overall.analyze", { profile_id: p.profile_id }));
  equal(r.profile_id, p.profile_id);
  equal(f.repo.profiles.size, 1);
  equal(f.repo.reports.size, 1);
});
Deno.test("report read and export use own frozen revision and preserve current paid fields", async () => {
  const f = fixture(),
    p = await f.service.execute(
      execution("score-profile.create", { scores: scores(), confirmed: true }),
    );
  const r = await f.service.execute(execution("overall.analyze", { profile_id: p.profile_id }));
  equal(
    await f.service.execute(execution("report.read", {}, { report_id: r.report_id as string })),
    r,
  );
  const printed = await f.service.execute(
    execution("report.export", {}, { report_id: r.report_id as string }),
  );
  equal(printed.format, "jungsi.counseling-snapshot/v1");
  equal(printed.snapshot_version, 1);
  equal(printed.report, r);
});
Deno.test("standard export and unconfirmed paid export reject before response or analysis work", async () => {
  const f = fixture(), r = await f.service.execute(execution("overall.analyze", scores()));
  const params = { report_id: r.report_id as string };
  await denied(
    () => f.service.execute(execution("report.export", {}, params, false)),
    "paid_required",
    403,
  );
  await denied(
    () => f.service.execute(execution("report.export", {}, params)),
    "score_confirmation_required",
    409,
  );
});
Deno.test("other owner report lookup rejects before invalid body or private snapshot read", async () => {
  const f = fixture(), r = await f.service.execute(execution("overall.analyze", scores()));
  const req = execution("report.read", false, { report_id: r.report_id as string });
  await denied(
    () =>
      f.service.execute({
        ...req,
        session: { ...req.session, user: { ...req.session.user, subjectId: OTHER } },
      }),
    "report_not_found",
    404,
  );
});
Deno.test("other owner profile ID is not resolved through same name or scores", async () => {
  const f = fixture(),
    p = await f.service.execute(
      execution("score-profile.create", { scores: scores(), confirmed: true }),
    );
  const req = execution("overall.analyze", { profile_id: p.profile_id });
  await denied(
    () =>
      f.service.execute({
        ...req,
        session: { ...req.session, user: { ...req.session.user, subjectId: OTHER } },
      }),
    "profile_not_found",
    404,
  );
  equal(f.repo.reports.size, 0);
});
Deno.test("overall replacing profile preserves selections and marks them for revalidation", async () => {
  const f = fixture(),
    p = await f.service.execute(
      execution("score-profile.create", { scores: scores(), confirmed: true }),
    );
  const r = await f.service.execute(execution("overall.analyze", { profile_id: p.profile_id }));
  const rid = r.report_id as string;
  const old = f.repo.reports.get(rid)!;
  const previous = {
    ...old,
    body: {
      ...old.body,
      shortlist: { "SYNTHETIC-offering": { selected: true, assessment_status: "ready" } },
    },
  };
  f.repo.reports.set(rid, previous);
  const updated = await f.service.execute(
    execution(
      "overall.analyze",
      { profile_id: p.profile_id, report_id: rid, expected_version: 1 },
      {},
      true,
      "SYNTHETIC-replace",
    ),
  );
  equal(updated.report_version, 2);
  equal(
    ((updated.shortlist as NativeObject)["SYNTHETIC-offering"] as NativeObject).assessment_status,
    "needs_revalidation",
  );
  equal(previous.body.shortlist["SYNTHETIC-offering"].assessment_status, "ready");
});
Deno.test("stale overall report version is rejected and current report is preserved", async () => {
  const f = fixture(),
    p = await f.service.execute(
      execution("score-profile.create", { scores: scores(), confirmed: true }),
    );
  const r = await f.service.execute(execution("overall.analyze", { profile_id: p.profile_id }));
  await denied(
    () =>
      f.service.execute(
        execution(
          "overall.analyze",
          { profile_id: p.profile_id, report_id: r.report_id, expected_version: 2 },
          {},
          true,
          "SYNTHETIC-stale",
        ),
      ),
    "revision_conflict",
    409,
  );
  equal(f.repo.reports.get(r.report_id as string)!.revision, 1);
});
Deno.test("overall missing model keeps successful total and subjects in persisted report", async () => {
  const f = fixture({ missingModel: true }),
    r = await f.service.execute(execution("overall.analyze", scores()));
  const result = r.overall as NativeObject;
  equal(result.total_standard_score, 26);
  equal((result.subjects as unknown[]).length, 4);
  equal((result.overall as NativeObject).reason_code, "total_model_missing");
});
Deno.test("missing pack and expiry during analysis cannot persist a new profile or report", async () => {
  for (
    const [options, code, http] of [[{ missingPack: true }, "exam_not_available", 503], [
      { expireAtPack: true },
      "authentication_required",
      401,
    ]] as const
  ) {
    const f = fixture(options);
    await denied(() => f.service.execute(execution("overall.analyze", scores())), code, http);
    equal(f.repo.profiles.size, 0);
    equal(f.repo.reports.size, 0);
  }
});
Deno.test("profile key input shape and query validations keep original 422 semantics", async () => {
  const f = fixture();
  await denied(
    () => f.service.execute(execution("overall.analyze", scores(), {}, true, "bad key")),
    "invalid_identifier",
    422,
  );
  await denied(
    () =>
      f.service.execute({ ...execution("overall.analyze", scores()), query: { unknown: "value" } }),
    "invalid_request",
    422,
  );
  equal(f.calls(), 0);
});
