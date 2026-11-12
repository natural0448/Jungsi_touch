// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal, withMonotonic } from "./fixture.ts";
import {
  nativeJsonSha256,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type {
  PlatformRepositoryPort,
  StoredReport,
} from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
import type { ScoreInputWorkflowPort } from "../../supabase/functions/_shared/jungsi/application/score_input_ports.ts";
import { resolveReferenceReportProjection } from "../../supabase/functions/_shared/jungsi/application/reference_report_projection.ts";
import { ReferenceReceiptExpired } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { RuntimeReferenceLease } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_lease.ts";
import { bindRuntimeReferencePorts } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_ports.ts";
import { referenceRuntimeFactory } from "../../supabase/functions/_shared/jungsi/infrastructure/reference_runtime_factory.ts";
import type { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
import type { CatalogService } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
const NOW = 1700000000000000n;
async function fixture() {
  const value: NativeObject = {
    status: "reference_estimated",
    estimated_upper_cumulative_percent_all_examinees: "10.5",
    metric: "estimated_upper_cumulative_percent_all_examinees",
    calculation_review_scope: "same_exam_mathematical_reference",
    production_allowed: false,
    actual_admission_full_total_approved: false,
  };
  const assessment: NativeObject = {
    offering_id: "synthetic-offering",
    status: "pending",
    reference_percentile: value,
  };
  const groups = [{
    university_id: "synthetic-u",
    offerings: [{
      offering: { offering_id: "synthetic-offering" },
      reference_percentile: structuredClone(value),
    }],
  }];
  const proof: NativeObject = {
    format: "jungsi.reference-result-provenance/v1",
    owner_id: "synthetic-owner",
    report_id: "synthetic-report",
    profile_id: "synthetic-profile",
    assessments: {
      "synthetic-offering": {
        issued_revision: 2,
        value_sha256: await nativeJsonSha256(value),
        provenance: { selection_sha256: "a".repeat(64) },
      },
    },
    candidates: {
      issued_revision: 2,
      value_sha256: await nativeJsonSha256(groups),
      selection_sha256: "a".repeat(64),
      offering_ids: ["synthetic-offering"],
    },
  };
  const record: StoredReport = {
    owner_id: "synthetic-owner",
    report_id: "synthetic-report",
    profile_id: "synthetic-profile",
    revision: 3,
    updated_at: "synthetic",
    body: {
      overall: {},
      analyses: { "synthetic-offering": assessment },
      candidates: { reference_university_groups: groups },
      _reference_evidence: proof,
    },
  };
  const request = {
    operation: "report.read",
    session: {
      user: { subjectId: "synthetic-owner", expiresAtUtc: NOW + 9000000000n },
      evaluatedAtUtc: NOW,
      tier: "paid",
      paidUntilUtc: NOW + 9000000000n,
    },
    params: { report_id: "synthetic-report" },
    query: {},
    body: {},
    requestKey: null,
    management: null,
  } as unknown as ApiExecution;
  const result: NativeObject = {
    format: "jungsi.persisted-report/v1",
    report_id: record.report_id,
    report_version: record.revision,
    profile_id: record.profile_id,
    analyses: { "synthetic-offering": structuredClone(assessment) },
    candidates: { reference_university_groups: structuredClone(groups) },
  };
  const state = {
    record,
    valid: true,
    assessmentApproved: true,
    candidatesApproved: true,
    scopeIds: ["synthetic-offering"],
    scopeCandidates: true,
  };
  const repository: Pick<PlatformRepositoryPort, "getReport" | "lookupAccess"> = {
    async getReport() {
      return state.record;
    },
    async lookupAccess() {
      return { ownerId: state.record.owner_id, confirmed: true };
    },
  };
  const workflow = {
    async snapshotScope() {
      return {
        overall: false,
        analysisIds: state.scopeIds,
        candidates: state.scopeCandidates,
        legacyVerified: false,
      };
    },
  } as Pick<ScoreInputWorkflowPort, "snapshotScope">;
  const verifier = {
    maximumAssessments: 10,
    async verifyAssessment() {
      return state.assessmentApproved;
    },
    async verifyCandidates() {
      return state.candidatesApproved;
    },
    async assertCurrent(rec: StoredReport) {
      if (!state.valid || rec.revision !== state.record.revision) {
        throw new Error("revoked or stale report");
      }
    },
  };
  const controller = new AbortController(), clock = { nowUtc: () => NOW };
  const input = {
    request,
    result,
    repository,
    workflow,
    verifier,
    clock,
    signal: controller.signal,
    async assertActive() {},
    assertReceipt() {},
  };
  return { record, result, request, state, controller, input };
}
Deno.test("reference report projection admits independently verified stored values only", async () => {
  const x = await fixture(), proof = await resolveReferenceReportProjection(x.input);
  assert(proof);
  const a = (x.result.analyses as NativeObject)["synthetic-offering"];
  assert(
    proof.authorizes({
      operation: "report.read",
      tier: "paid",
      root: x.result,
      kind: "assessment",
      value: a,
    }),
  );
  assert(
    proof.authorizes({
      operation: "report.read",
      tier: "paid",
      root: x.result,
      kind: "candidates",
      value: x.result.candidates,
    }),
  );
  await proof.assertCurrent(x.controller.signal);
  ((a as NativeObject).reference_percentile as NativeObject)
    .estimated_upper_cumulative_percent_all_examinees = "99";
  assert(
    !proof.authorizes({
      operation: "report.read",
      tier: "paid",
      root: x.result,
      kind: "assessment",
      value: a,
    }),
  );
});
Deno.test("old or tampered reports never gain reference disclosure from a hash alone", async () => {
  let x = await fixture();
  delete x.state.record.body._reference_evidence;
  equal(await resolveReferenceReportProjection(x.input), null);
  x = await fixture();
  x.state.assessmentApproved = false;
  x.state.candidatesApproved = false;
  equal(await resolveReferenceReportProjection(x.input), null);
  x = await fixture();
  ((x.state.record.body.analyses as NativeObject)["synthetic-offering"] as NativeObject)
    .reference_percentile = { status: "forged" };
  x.state.candidatesApproved = false;
  equal(await resolveReferenceReportProjection(x.input), null);
});
Deno.test("reference projection rejects mismatched owner, revision and report identity", async () => {
  for (const kind of ["owner", "revision", "identity"] as const) {
    const x = await fixture();
    if (kind === "owner") x.state.record = { ...x.state.record, owner_id: "other" };
    if (kind === "revision") x.state.record = { ...x.state.record, revision: 4 };
    if (kind === "identity") x.result.report_id = "other";
    let rejected = false,
      result: Awaited<ReturnType<typeof resolveReferenceReportProjection>> = null;
    try {
      result = await resolveReferenceReportProjection(x.input);
    } catch {
      rejected = true;
    }
    assert(rejected || result === null);
  }
});
Deno.test("free saved access is restricted to existing component rights", async () => {
  const x = await fixture();
  const session = x.request.session as { tier: string; paidUntilUtc: bigint | null };
  session.tier = "standard";
  session.paidUntilUtc = null;
  x.state.scopeIds = [];
  x.state.scopeCandidates = false;
  equal(await resolveReferenceReportProjection(x.input), null);
  x.state.scopeIds = ["synthetic-offering"];
  const proof = await resolveReferenceReportProjection(x.input);
  assert(proof);
  assert(
    proof.authorizes({
      operation: "report.read",
      tier: "standard",
      root: x.result,
      kind: "assessment",
      value: (x.result.analyses as NativeObject)["synthetic-offering"],
    }),
  );
  assert(
    !proof.authorizes({
      operation: "report.read",
      tier: "standard",
      root: x.result,
      kind: "candidates",
      value: x.result.candidates,
    }),
  );
  x.state.scopeIds = [];
  x.state.scopeCandidates = true;
  const candidatesOnly = await resolveReferenceReportProjection(x.input);
  assert(candidatesOnly);
  assert(
    !candidatesOnly.authorizes({
      operation: "report.read",
      tier: "standard",
      root: x.result,
      kind: "assessment",
      value: (x.result.analyses as NativeObject)["synthetic-offering"],
    }),
  );
  assert(
    candidatesOnly.authorizes({
      operation: "report.read",
      tier: "standard",
      root: x.result,
      kind: "candidates",
      value: x.result.candidates,
    }),
  );
});
Deno.test("reference delivery fails closed on later source revocation", async () => {
  const x = await fixture(), proof = await resolveReferenceReportProjection(x.input);
  assert(proof);
  x.state.valid = false;
  let failed = false;
  try {
    await proof.assertCurrent(x.controller.signal);
  } catch {
    failed = true;
  }
  assert(failed);
});

Deno.test("reference runtime composes stored report authority inside the same budget lease", async () => {
  const x = await fixture(),
    admission = { lease: { owner: "synthetic-owner", expiresAtUtc: NOW + 1000000n } };
  const boundary = { signal: x.controller.signal, admission };
  const lease = new RuntimeReferenceLease(
    x.input.clock,
    async () => {},
    async () => ({ assertCurrent() {} }),
  );
  const factory = referenceRuntimeFactory({
    async open() {
      return {
        tail: {
          async getReferenceTail() {
            return null;
          },
        },
        candidateScope: null,
        reportEvidence: x.input.verifier,
      };
    },
  });
  const runtime = {} as Pick<NativeRuntimeRequest, "binding" | "controls" | "data">;
  const services = {
    repository: x.input.repository,
    catalog: {} as CatalogService,
    clock: x.input.clock,
    workflow: x.input.workflow as ScoreInputWorkflowPort,
  };
  const proof = await lease.enter(x.request, admission, x.controller.signal, async () => {
    const ports = await bindRuntimeReferencePorts(
      factory,
      lease,
      runtime,
      services,
      x.request,
      boundary,
    );
    assert(ports);
    const proof = await ports.projectionAuthority.resolve(
      x.request,
      x.result,
      admission,
      x.controller.signal,
    );
    assert(proof);
    await proof.assertCurrent(x.controller.signal);
    return proof;
  });
  lease.markSettled();
  proof.assertSettled!(x.controller.signal);
  let failed = false;
  try {
    await proof.assertCurrent(x.controller.signal);
  } catch {
    failed = true;
  }
  assert(failed);
});

Deno.test("a recomputed group hash cannot hide a changed reference value", async () => {
  const x = await fixture(), saved = x.state.record.body.candidates as NativeObject;
  const groups = saved.reference_university_groups as NativeObject[],
    group = groups[0],
    item = (group.offerings as NativeObject[])[0];
  (item.reference_percentile as NativeObject).estimated_upper_cumulative_percent_all_examinees =
    "99";
  const proof = x.state.record.body._reference_evidence as NativeObject;
  (proof.candidates as NativeObject).value_sha256 = await nativeJsonSha256(groups);
  (x.result.candidates as NativeObject).reference_university_groups = structuredClone(groups);
  const verifier = await resolveReferenceReportProjection(x.input);
  assert(verifier);
  assert(
    !verifier.authorizes({
      operation: "report.read",
      tier: "paid",
      root: x.result,
      kind: "candidates",
      value: x.result.candidates,
    }),
  );
});

Deno.test("proof cannot change while the independent verifier is running", async () => {
  const x = await fixture();
  const verifier = {
    ...x.input.verifier,
    async verifyAssessment(_record: StoredReport, id: string, evidence: Readonly<NativeObject>) {
      assert(id === "synthetic-offering");
      (evidence as NativeObject).value_sha256 = "0".repeat(64);
      return true;
    },
  };
  let failed = false;
  try {
    await resolveReferenceReportProjection({ ...x.input, verifier });
  } catch {
    failed = true;
  }
  assert(failed);
});

Deno.test("reference export binds proof to the exact owned report inside the print snapshot", async () => {
  const x = await fixture(), request = { ...x.request, operation: "report.export" } as ApiExecution;
  const result: NativeObject = {
    format: "jungsi.counseling-snapshot/v1",
    status: "ready",
    snapshot_version: 3,
    generated_at: "synthetic",
    report: x.result,
  };
  const proof = await resolveReferenceReportProjection({ ...x.input, request, result });
  assert(proof);
  const assessment = (x.result.analyses as NativeObject)["synthetic-offering"];
  assert(
    proof.authorizes({
      operation: "report.export",
      tier: "paid",
      root: result,
      kind: "assessment",
      value: assessment,
    }),
  );
  assert(
    !proof.authorizes({
      operation: "report.read",
      tier: "paid",
      root: result,
      kind: "assessment",
      value: assessment,
    }),
  );
  assert(
    !proof.authorizes({
      operation: "report.export",
      tier: "paid",
      root: x.result,
      kind: "assessment",
      value: assessment,
    }),
  );
});

Deno.test("after settlement reference receipt uses no external I/O and expires at reuse limit", async () => {
  let now = 1000, settled = false, reads = 0;
  await withMonotonic(() => now, async () => {
    const x = await fixture();
    const verifier = {
      ...x.input.verifier,
      async assertCurrent(record: StoredReport) {
        if (settled) throw new Error("I/O after settlement");
        reads++;
        await x.input.verifier.assertCurrent(record);
      },
    };
    const proof = await resolveReferenceReportProjection({
      ...x.input,
      verifier,
      assertReceipt() {
        if (!settled) throw new Error("not settled");
      },
    });
    assert(proof);
    await proof.assertCurrent(x.controller.signal);
    const prior = reads;
    settled = true;
    now += 1499;
    proof.assertSettled!(x.controller.signal);
    equal(reads, prior);
    now += 1;
    let denied = false;
    try {
      proof.assertSettled!(x.controller.signal);
    } catch (error) {
      denied = error instanceof ReferenceReceiptExpired;
    }
    assert(denied);
    equal(reads, prior);
  });
});
