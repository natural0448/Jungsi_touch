// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Invented references and approvals; no operating Storage or DB is contacted. */
import { assert, equal } from "./fixture.ts";
import {
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type {
  PlatformRepositoryPort,
  StoredReport,
} from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
import type { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
import type { RuntimeReferenceFactory } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_ports.ts";
import { CatalogService } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import { acquireReferenceCandidateScope } from "../../supabase/functions/_shared/jungsi/application/reference_candidate_scope.ts";
import { RuntimeReferenceLease } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_lease.ts";
import { bindRuntimeReferencePorts } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_ports.ts";
import {
  publishedReferenceFactory,
  publishedReferenceRuntimeSource,
} from "../../supabase/functions/_shared/jungsi/infrastructure/published_reference_runtime.ts";
const H = (s: string) => s.repeat(64), NOW = 1700000000000000n;
async function fixture(includeTail = true) {
  const ctx: NativeObject = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_pack_version: "pack",
    model_version: "model",
    profile_sha256: H("a"),
    rule_version: "rule",
    score_scale_id: "axis",
    reference_curve_id: "curve",
    weight_encoding: "synthetic",
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
    ].map((k) => [k, H("b")]),
  ) as NativeObject;
  const projection: NativeObject = {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "tail-v1",
    context: ctx,
    evidence,
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + H("c"),
      weight_decimal_scale: 0,
      eligible_weight_units: "10",
      whole_mass_decimal: "20",
      whole_mass_numerator: "20",
      whole_mass_denominator: "1",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    rows: [{
      score_numerator: "10",
      score_denominator: "1",
      strict_weight_units: "0",
      tie_weight_units: "10",
      inclusive_weight_units: "10",
    }],
  };
  const raw = new TextEncoder().encode(nativeJsonText(projection));
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
  const link: NativeObject = {
    offering_id: "offering",
    physical_offering_pk: "physical",
    academic_year: 2027,
    rule_version: "rule",
  };
  const tail: NativeObject = {
    key: "tail",
    sha256: sha,
    bytes: raw.length,
    compatibility_key: "model",
    reference_bindings: [link],
    reference_context: ctx,
    reference_evidence: evidence,
    model_exam_pack_sha256: H("9"),
    source_review_sha256: H("1"),
    independent_review_sha256: H("2"),
  };
  const model: NativeObject = { key: "model", sha256: H("3"), version: "v1" };
  const scopeMeta: NativeObject = {
    kind: "reference_compatibility",
    key: "scope",
    reference_use: "candidate_scope",
    sha256: H("4"),
    bytes: 100,
    version: "v1",
    source_review_sha256: H("1"),
    independent_review_sha256: H("2"),
  };
  const scopeReceipt: NativeObject = {
    format: "jungsi.reference-consumer-scope/v1",
    version: "v1",
    status: "verified_reference",
    scope: "same_exam_mathematical_reference",
    selection_sha256: H("5"),
    usage_policy_sha256: H("6"),
    academic_year: 2027,
    exam_id: "exam",
    score_basis: "standard",
    catalog_version: "catalog",
    offering_ids: ["offering"],
    max_rows: 4,
    max_evidence_bytes: 1024,
    max_runtime_milliseconds: 1000,
    source_review_sha256: H("1"),
    independent_review_sha256: H("2"),
  };
  const modelReceipt: NativeObject = {
    format: "jungsi.reference-model-compatibility/v1",
    version: "v1",
    status: "verified_reference",
    scope: "same_exam_mathematical_reference",
    tail_sha256: sha,
    exam_pack_sha256: H("7"),
    model_exam_pack_sha256: H("9"),
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_pack_version: "pack",
    rule_version: "rule",
    score_scale_id: "axis",
    context_sha256: await nativeJsonSha256(ctx),
    evidence_sha256: await nativeJsonSha256(evidence),
    source_review_sha256: H("1"),
    independent_review_sha256: H("2"),
  };
  const state = { active: true, source: true, scope: true };
  const selected = () => ({
    registrySha256: H("8"),
    selectionSha256: H("5"),
    approvalReferenceSha256: H("a"),
    tails: state.source && includeTail ? [{ key: "tail", entry: tail }] : [],
    compatibilities: [
      { key: "model", entry: model },
      ...(state.scope ? [{ key: "scope", entry: scopeMeta }] : []),
    ],
  });
  const provider = {
    async getReference(id: string) {
      return id === "offering"
        ? {
          binding: { offering_pk: id, rule_version: "rule" },
          academicYear: 2027,
          examId: "exam",
          packVersion: "pack",
          examType: "september_mock",
          scoreScaleId: "axis",
          rule: { data: { rule_id: "rule", rule_version: "rule" } },
        }
        : null;
    },
    referenceTailOfferings() {
      return ["offering"];
    },
    async referenceSelection() {
      return selected();
    },
    async referenceExamPin() {
      return { key: "exam", sha256: H("7"), version: "pack" };
    },
    async loadReferenceTail() {
      return { entry: tail, bytes: raw };
    },
    async loadReferenceCompatibility(key: string) {
      return key === "scope"
        ? { entry: scopeMeta, payload: scopeReceipt }
        : { entry: model, payload: modelReceipt };
    },
  };
  const binding = {
    descriptorSha256: H("a"),
    references: { usage_policy: { sha256: H("6") } },
    readLimits: { maxRequests: 20, maxBytes: 1000000 },
    repositoryLimits: { maxBatchIds: 8 },
    storage: { limits: { maxArtifactBytes: 65536, requestTimeoutMs: 2000 } },
  };
  const request = {
    operation: "candidates.build",
    session: {
      user: { subjectId: "owner", expiresAtUtc: NOW + 9000000000n },
      evaluatedAtUtc: NOW,
      tier: "paid",
      paidUntilUtc: NOW + 9000000000n,
    },
    params: { report_id: "report" },
    query: {},
    body: {},
    management: null,
    requestKey: null,
  } as unknown as ApiExecution;
  const record: StoredReport = {
    owner_id: "owner",
    report_id: "report",
    profile_id: "profile",
    revision: 1,
    updated_at: "synthetic",
    body: { overall: { exam: { academic_year: 2027, exam_id: "exam" }, score_basis: "standard" } },
  };
  const repository: Pick<
    PlatformRepositoryPort,
    "getReport" | "getReportRevision" | "lookupAccess"
  > = {
    async lookupAccess() {
      return { ownerId: "owner", confirmed: true };
    },
    async getReport() {
      return record;
    },
    async getReportRevision() {
      return record;
    },
  };
  const clock = { nowUtc: () => NOW },
    catalog = new CatalogService({
      async getCatalog() {
        return { version: "catalog", status: "approved", asOfUtc: NOW, offerings: [], history: [] };
      },
    }, clock);
  const controller = new AbortController(),
    admission = { lease: { owner: "owner", expiresAtUtc: NOW + 5000000n } },
    boundary = { signal: controller.signal, admission };
  const lease = new RuntimeReferenceLease(clock, async (signal) => {
    if (signal.aborted || !state.active) throw Error("inactive");
  }, async () => ({ assertCurrent() {} }));
  const runtime = {
    async binding() {
      return binding;
    },
    async data() {
      return provider;
    },
  } as unknown as Pick<NativeRuntimeRequest, "binding" | "controls" | "data">;
  const services = {
    repository,
    catalog,
    clock,
    workflow: {} as Parameters<RuntimeReferenceFactory["create"]>[0]["workflow"],
  };
  return {
    request,
    record,
    state,
    boundary,
    lease,
    runtime,
    services,
    ctx,
    controller,
    tail,
    modelReceipt,
  };
}
Deno.test("unpublished reference selection leaves existing service unaltered", async () => {
  const x = await fixture(false);
  const value = await x.lease.enter(
    x.request,
    x.boundary.admission,
    x.controller.signal,
    () =>
      bindRuntimeReferencePorts(
        publishedReferenceFactory,
        x.lease,
        x.runtime,
        x.services,
        x.request,
        x.boundary,
      ),
  );
  equal(value, null);
});
Deno.test("runtime assembles selected reference, owner scope and exact provenance under one lease", async () => {
  const x = await fixture(),
    req = {
      subjectId: "owner",
      reportId: "report",
      reportRevision: 1,
      profileId: "profile",
      academicYear: 2027,
      examId: "exam",
      scoreBasis: "standard",
      catalogVersion: "catalog",
    };
  await x.lease.enter(x.request, x.boundary.admission, x.controller.signal, async () => {
    const ports = await bindRuntimeReferencePorts(
      publishedReferenceFactory,
      x.lease,
      x.runtime,
      x.services,
      x.request,
      x.boundary,
    );
    assert(ports?.candidateScope);
    const scope = await acquireReferenceCandidateScope(req, ports.candidateScope, x.boundary);
    assert(scope);
    equal(scope.offeringIds, ["offering"]);
    const tail = await ports.tail.getReferenceTail!("offering", scope.signal);
    assert(tail?.verifiedProvenance);
    const id: NativeObject = {
      academic_year: 2027,
      exam_id: "exam",
      exam_type: "september_mock",
      source_pack_version: "pack",
      rule_version: "rule",
      score_scale_id: "axis",
      offering_id: "offering",
    };
    const proof = await tail.verifiedProvenance(id, scope.signal);
    equal(proof.selection_sha256, H("5"));
  });
});
Deno.test("runtime refuses scope that exceeds existing policy limit", async () => {
  const x = await fixture();
  const original = x.runtime.binding;
  x.runtime.binding = async () => {
    const b = await original();
    return { ...b, repositoryLimits: { ...b.repositoryLimits, maxBatchIds: 1 } };
  };
  let denied = false;
  try {
    await x.lease.enter(
      x.request,
      x.boundary.admission,
      x.controller.signal,
      () =>
        bindRuntimeReferencePorts(
          publishedReferenceFactory,
          x.lease,
          x.runtime,
          x.services,
          x.request,
          x.boundary,
        ),
    );
  } catch {
    denied = true;
  }
  assert(denied);
});

Deno.test("published runtime opens existing DB CDF under selected identity and rechecks DB receipt", async () => {
  const x = await fixture(), methodId = "estimated-whole-cohort-percentile:" + H("c");
  const doc = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_rule_id: "rule",
    model_references: { pack: { sha256: H("9") } },
    engine_approved: false,
    production_allowed: false,
    data_kind: "fixed_mock_model_reference_not_actual_admission",
    actual_2027_csat_available: false,
    support_bin_count: 3,
    eligible_weight_units: "6",
    weight_decimal_scale: 0,
    whole_model_weight: "10",
    whole_model_weight_units: "10",
    score_denominator: 100,
    frequencies_numerator_integer_weight: [[100, "2"], [200, "3"], [300, "1"]],
  };
  const raw = new TextEncoder().encode(JSON.stringify(doc)),
    sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))].map((n) =>
      n.toString(16).padStart(2, "0")
    ).join("");
  (x.tail.reference_evidence as NativeObject).source_cdf_sha256 = sha;
  x.modelReceipt.evidence_sha256 = await nativeJsonSha256(
    x.tail.reference_evidence as NativeObject,
  );
  const method: NativeObject = {
    method_id: methodId,
    metric: "estimated_upper_cumulative_percent_all_examinees",
    native_score_and_source_definition_metadata: {
      academic_year: 2027,
      source_rule_id: "rule",
      score_denominator: 100,
      engine_approved: false,
      reference_curve_id: "curve",
    },
    binding: {
      projection_arguments: {
        expected_curve_id: "curve",
        eligible_weight_units: "6",
        weight_decimal_scale: 0,
        whole_model_weight_decimal: "10",
      },
    },
  };
  const db = {
    releaseId: "reference-percentile:" + H("d"),
    readbackSha256: H("e"),
    datasetSha256: H("f"),
    academicYear: 2027,
    physicalOfferingPk: "physical",
    methodId,
    methodSha256: H("b"),
    cdfSha256: sha,
    gzipSha256: H("a"),
    sourceBytes: raw.length,
    gzipBytes: 1,
    method,
  };
  let valid = true, reads = 0;
  const reader = {
    async select(_owner: string, _year: number, _pk: string, s: AbortSignal) {
      if (s.aborted) throw Error("aborted");
      return db;
    },
    async source(_owner: string, _pin: unknown, s: AbortSignal) {
      if (s.aborted) throw Error("aborted");
      reads++;
      return raw;
    },
    async assertCurrent(_owner: string, _pin: unknown, s: AbortSignal) {
      if (s.aborted || !valid) throw Error("DB head");
    },
    currentReceipt(_pin: unknown, s: AbortSignal) {
      return {
        assertCurrent() {
          if (s.aborted || !valid) throw Error("DB head");
        },
      };
    },
  };
  const request = { ...x.request, operation: "university.analyze" } as ApiExecution;
  const runtime = { ...x.runtime, referencePercentileDbReader: async () => reader };
  const context = {
    request,
    boundary: x.boundary,
    runtime,
    repository: x.services.repository,
    catalog: x.services.catalog,
    clock: x.services.clock,
    workflow: x.services.workflow,
    scopeSignal: (s?: AbortSignal) => s ?? x.controller.signal,
    assertActive: async (s?: AbortSignal) => {
      if (s?.aborted) throw Error("abort");
    },
    assertReceipt: () => {},
  };
  const selected = await publishedReferenceRuntimeSource.open(
    context as unknown as Parameters<typeof publishedReferenceRuntimeSource.open>[0],
  );
  assert(selected);
  const v = await selected.tail.getNativeReferenceTail!("offering", x.controller.signal);
  assert(v?.verifiedProvenance);
  const identity: NativeObject = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_pack_version: "pack",
    rule_version: "rule",
    score_scale_id: "axis",
    offering_id: "offering",
  };
  await v.assertCompatible(identity, x.controller.signal);
  const proof = await v.verifiedProvenance(identity, x.controller.signal);
  equal(proof.release_sha256, H("d"));
  await selected.reportEvidence.assertCurrent(x.record, x.controller.signal);
  selected.assertSettled!(x.controller.signal);
  equal(reads, 1);
  valid = false;
  let denied = false;
  try {
    selected.assertSettled!(x.controller.signal);
  } catch {
    denied = true;
  }
  assert(denied);
});

Deno.test("runtime reuses the approved selection for 4P when no separate scope receipt exists", async () => {
  const x = await fixture();
  x.state.scope = false;
  const req = {
    subjectId: "owner",
    reportId: "report",
    reportRevision: 1,
    profileId: "profile",
    academicYear: 2027,
    examId: "exam",
    scoreBasis: "standard",
    catalogVersion: "catalog",
  };
  await x.lease.enter(x.request, x.boundary.admission, x.controller.signal, async () => {
    const ports = await bindRuntimeReferencePorts(
      publishedReferenceFactory,
      x.lease,
      x.runtime,
      x.services,
      x.request,
      x.boundary,
    );
    assert(ports?.candidateScope);
    const scope = await acquireReferenceCandidateScope(req, ports.candidateScope, x.boundary);
    assert(scope);
    equal(scope.offeringIds, ["offering"]);
  });
});
