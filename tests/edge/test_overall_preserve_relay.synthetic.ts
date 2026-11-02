/** One synthetic regression at the real API/relay boundary; no network or customer data. */
import { ProfileReportService } from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  cloneNativeJson,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { NativeExamTotalModel } from "../../supabase/functions/_shared/jungsi/domain/total_model.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import {
  RelayBoundary,
  safeFailure,
} from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { assert, equal } from "./fixture.ts";
import {
  canonicalApiPolicies,
  canonicalPublicResponseSchemas,
} from "./public_api_contract_fixture.ts";
import { syntheticNativeModelData, syntheticNativePackData } from "./synthetic_exam_pack.ts";
import { A, clock, nativeFixture, NOW, session } from "./synthetic_score_input_policy.ts";

Deno.test("HTTP refresh preservation returns safe specific 503 without replacing old zero", async () => {
  const f = nativeFixture(), profile = await f.save();
  const initial = await f.repo.accept(A, () =>
    f.profile.execute({
      operation: "overall.analyze",
      session: f.verified,
      management: null,
      body: { profile_id: profile.profile_id },
      query: {},
      params: {},
      requestKey: "SYNTHETIC-http-initial",
    }));
  const previous = await f.platform.getReport(A, initial.report_id as string);
  assert(previous !== null);
  const body = cloneNativeJson(previous.body);
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
  const stored = await f.repo.accept(A, () =>
    f.platform.writeReport({
      owner: A,
      reportId: previous.report_id,
      profileId: profile.profile_id as string,
      body,
      expected: previous.revision,
      nowUtc: clock.nowUtc(),
      operation: "university.analyze",
      key: "SYNTHETIC-http-seed",
      digest: "c".repeat(64),
      paidOrigin: f.service.origin(session(), "university.analyze", ["analysis:SYNTHETIC-zero"]),
    }));
  const before = structuredClone({
    revisions: [...f.pool.state.revisions],
    origins: f.pool.state.origins,
    attempts: f.pool.state.attempts,
    states: f.pool.state.states,
  });
  const pack = new NativeExamPack(syntheticNativePackData());
  const model = new NativeExamTotalModel(syntheticNativeModelData());
  const service = new ProfileReportService(
    f.platform,
    {
      getExamPack: () => Promise.resolve(pack),
      getTotalModel: () => Promise.resolve({ model, distributionId: model.distributionId }),
    },
    clock,
    { mode: "rights", workflow: f.service },
  );
  const policies = canonicalApiPolicies(), relay = "SYNTHETIC-http-relay-" + "x".repeat(32);
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(relay),
    clock,
    sessions: {
      verifyUserBearer: () => Promise.resolve({ subjectId: A, expiresAtUtc: NOW + 1000000n }),
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) =>
        Promise.resolve({
          authority: "public.jeongsi_passes" as const,
          metadataVerified: true as const,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: NOW + 1000000n,
          passId: "1",
        }),
    },
    reports: f.platform,
    authorities: {
      readCurrent: () => {
        throw new Error("Unexpected authority");
      },
    },
    resources: {
      readScope: () => {
        throw new Error("Unexpected scope");
      },
    },
    projection: new PublicResponseProjection(canonicalPublicResponseSchemas(), policies),
    budget: { run: async (_request, work) => await work() },
    business: { execute: (input) => service.execute(input) },
  };
  const handler = createApiHandler(policies.map(({ contract_ref: _, ...policy }) => policy), ports);
  const response = await handler(
    new Request("https://synthetic.invalid/api/v1/overall-reports", {
      method: "POST",
      headers: {
        Authorization: "Bearer SYNTHETIC-token",
        "X-Jungsi-Relay-Token": relay,
        "Content-Type": "application/json",
        "Idempotency-Key": "SYNTHETIC-http-preservation",
      },
      body: JSON.stringify({
        profile_id: profile.profile_id,
        report_id: stored.report_id,
        expected_version: stored.revision,
      }),
    }),
  );
  equal(response.status, 503);
  equal(response.headers.get("Cache-Control"), "no-store");
  const payload = await response.json();
  equal(payload.error.code, "report_refresh_preserved");
  equal(ports.projection.auxiliary("error", payload), payload);
  equal({
    revisions: [...f.pool.state.revisions],
    origins: f.pool.state.origins,
    attempts: f.pool.state.attempts,
    states: f.pool.state.states,
  }, before);
  const other = "00000000-0000-0000-0000-000000000002";
  const foreign = createApiHandler(policies.map(({ contract_ref: _, ...policy }) => policy), {
    ...ports,
    sessions: {
      verifyUserBearer: () => Promise.resolve({ subjectId: other, expiresAtUtc: NOW + 1000000n }),
    },
  });
  const unauthorized = await foreign(
    new Request("https://synthetic.invalid/api/v1/overall-reports", {
      method: "POST",
      headers: {
        Authorization: "Bearer SYNTHETIC-token",
        "X-Jungsi-Relay-Token": relay,
        "Content-Type": "application/json",
        "Idempotency-Key": "SYNTHETIC-http-foreign",
      },
      body: JSON.stringify({
        profile_id: profile.profile_id,
        report_id: stored.report_id,
        expected_version: stored.revision,
      }),
    }),
  );
  equal(unauthorized.status, 404);
  assert((await unauthorized.json()).error.code !== "report_refresh_preserved");
  const current = await f.platform.getReport(A, stored.report_id);
  assert(current !== null);
  equal(
    ((current.body.analyses as NativeObject)["SYNTHETIC-zero"] as NativeObject).converted_score,
    0,
  );
});

Deno.test("unrecognized or wrong-status internal errors remain generic and no-store", async () => {
  for (
    const error of [
      new AccessError("SYNTHETIC-unknown", 503),
      new AccessError("overall_refresh_result_preservation_required", 403),
    ]
  ) {
    const response = safeFailure(error, "a".repeat(32));
    equal(response.status, 503);
    equal(response.headers.get("Cache-Control"), "no-store");
    equal((await response.json()).error.code, "backend_dependency_unavailable");
  }
});
