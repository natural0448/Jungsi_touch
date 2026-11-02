/** P2 refresh through the actual HTTP handler and in-memory ports; no real data or network. */
import { ProfileReportService } from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { NativeExamTotalModel } from "../../supabase/functions/_shared/jungsi/domain/total_model.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { assert, equal } from "./fixture.ts";
import {
  canonicalApiPolicies,
  canonicalPublicResponseSchemas,
} from "./public_api_contract_fixture.ts";
import { syntheticNativeModelData, syntheticNativePackData } from "./synthetic_exam_pack.ts";
import { A, clock, nativeFixture, NOW } from "./synthetic_score_input_policy.ts";

Deno.test("HTTP P2 pending refresh preserves the report and succeeds idempotently when the model recovers", async () => {
  const f = nativeFixture();
  const saved = await f.save();
  const initial = await f.repo.accept(A, () =>
    f.profile.execute({
      operation: "overall.analyze",
      session: f.verified,
      management: null,
      body: { profile_id: saved.profile_id },
      query: {},
      params: {},
      requestKey: "SYNTHETIC-http-initial",
    }));
  const pack = new NativeExamPack(syntheticNativePackData());
  const model = new NativeExamTotalModel(syntheticNativeModelData());
  let available = false;
  let modelReads = 0;
  const service = new ProfileReportService(
    f.platform,
    {
      getExamPack: () => Promise.resolve(pack),
      getTotalModel: () => {
        modelReads++;
        return Promise.resolve(available ? { model, distributionId: model.distributionId } : null);
      },
    },
    clock,
    { mode: "rights", workflow: f.service },
  );
  const policies = canonicalApiPolicies();
  const relay = "SYNTHETIC-http-relay-" + "x".repeat(32);
  const calls = { authentication: 0, pass: 0, budget: 0, business: 0 };
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(relay),
    clock,
    sessions: {
      verifyUserBearer: () => {
        calls.authentication++;
        return Promise.resolve({ subjectId: A, expiresAtUtc: NOW + 1000000n });
      },
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) => {
        calls.pass++;
        return Promise.resolve({
          authority: "public.jeongsi_passes" as const,
          metadataVerified: true as const,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: NOW + 1000000n,
          passId: "1",
        });
      },
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
    budget: {
      run: async (_request, work) => {
        calls.budget++;
        return await work();
      },
    },
    business: {
      execute: (input) => {
        calls.business++;
        return service.execute(input);
      },
    },
  };
  const handler = createApiHandler(policies.map(({ contract_ref: _, ...policy }) => policy), ports);
  const body = JSON.stringify({
    profile_id: saved.profile_id,
    report_id: initial.report_id,
    expected_version: initial.report_version,
  });
  const makeRequest = () =>
    new Request("https://synthetic.invalid/api/v1/overall-reports", {
      method: "POST",
      headers: {
        Authorization: "Bearer SYNTHETIC-token",
        "X-Jungsi-Relay-Token": relay,
        "Content-Type": "application/json",
        "Idempotency-Key": "SYNTHETIC-http-retry",
      },
      body,
    });
  const missing = await handler(makeRequest());
  equal(missing.status, 503);
  equal(missing.headers.get("Cache-Control"), "no-store");
  equal((await missing.json()).error.code, "overall_model_refresh_pending");
  equal([calls.authentication, calls.pass, calls.budget, calls.business], [1, 1, 1, 1]);
  equal(f.pool.state.revisions.size, 1);
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
  available = true;
  const recovered = await handler(makeRequest());
  equal(recovered.status, 201);
  const result = await recovered.json();
  equal(result.report_id, initial.report_id);
  equal(result.report_version, 2);
  assert(result.overall.overall.status !== "pending");
  equal(f.pool.state.revisions.size, 2);
  equal(f.pool.state.profiles.size, 1);
  equal(f.pool.state.attempts.length, 1);
  equal(modelReads, 2);
  const retried = await handler(makeRequest());
  equal(retried.status, 201);
  equal(await retried.json(), result);
  equal(modelReads, 2);
  equal(f.pool.state.revisions.size, 2);
});
