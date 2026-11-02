/** Local-only fault-injection review; same transaction boundaries as overall runtime. */
import { ProfileReportService } from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
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

for (const mode of ["settlement", "delivery"] as const) {
  Deno.test("P2 stored result replays after synthetic " + mode + " failure", async () => {
    const f = nativeFixture(), profile = await f.save();
    const initial = await f.profile.execute({
      operation: "overall.analyze",
      session: f.verified,
      management: null,
      body: { profile_id: profile.profile_id },
      query: {},
      params: {},
      requestKey: "SYNTHETIC-initial",
    });
    const pack = new NativeExamPack(syntheticNativePackData());
    const model = new NativeExamTotalModel(syntheticNativeModelData());
    let reads = 0, faulted = false;
    const service = new ProfileReportService(
      f.platform,
      {
        getExamPack: () => Promise.resolve(pack),
        getTotalModel: () => {
          reads++;
          return Promise.resolve({ model, distributionId: model.distributionId });
        },
      },
      clock,
      { mode: "rights", workflow: f.service },
    );
    const policies = canonicalApiPolicies(), relay = "SYNTHETIC-relay-" + "x".repeat(32);
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
      budget: {
        run: async (_r, work) => {
          const result = await work();
          if (mode === "settlement" && !faulted) {
            faulted = true;
            throw new Error("SYNTHETIC-settlement");
          }
          return result;
        },
      },
      business: { execute: (r) => service.execute(r) },
      completion: {
        accept: async (_r, work) => await work(),
        current: () => Promise.resolve(),
        deliver: async (r, result, requestId) => {
          if (mode === "delivery" && !faulted) {
            faulted = true;
            throw new Error("SYNTHETIC-delivery");
          }
          await f.service.deliver(r.session, r.operation, result as NativeObject, requestId);
        },
      },
    };
    const handler = createApiHandler(policies.map(({ contract_ref: _, ...p }) => p), ports);
    const request = () =>
      new Request("https://synthetic.invalid/api/v1/overall-reports", {
        method: "POST",
        headers: {
          Authorization: "Bearer SYNTHETIC-token",
          "X-Jungsi-Relay-Token": relay,
          "Content-Type": "application/json",
          "Idempotency-Key": "SYNTHETIC-fault-retry",
        },
        body: JSON.stringify({
          profile_id: profile.profile_id,
          report_id: initial.report_id,
          expected_version: initial.report_version,
        }),
      });
    const first = await handler(request());
    equal(first.status, 503);
    equal((await first.json()).error.code, "backend_dependency_unavailable");
    equal(f.pool.state.revisions.size, 2);
    equal(f.pool.state.attempts.length, 1);
    const origins = structuredClone(f.pool.state.origins),
      requestCount = f.pool.state.requests.size;
    equal(f.pool.state.firstUse.size, 0);
    equal(reads, 1);
    const retry = await handler(request());
    equal(retry.status, 201);
    const result = await retry.json();
    equal(result.report_id, initial.report_id);
    equal(result.report_version, 2);
    assert(result.overall.overall.status !== "pending");
    equal(f.pool.state.revisions.size, 2);
    equal(f.pool.state.attempts.length, 1);
    equal(f.pool.state.origins, origins);
    equal(f.pool.state.requests.size, requestCount);
    equal(f.pool.state.firstUse.size, 1);
    equal(reads, 1);
    const third = await handler(request());
    equal(third.status, 201);
    equal(await third.json(), result);
    equal(f.pool.state.revisions.size, 2);
    equal(f.pool.state.origins, origins);
    equal(f.pool.state.firstUse.size, 1);
    equal(reads, 1);
  });
}
