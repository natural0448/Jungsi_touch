/** Separate synthetic whole-population suite; no actual model weights or population counts. */
import { assert, equal } from "../../../tests/edge/fixture.ts";
import {
  syntheticNativeModelData,
  syntheticNativePackData,
} from "../../../tests/edge/synthetic_exam_pack.ts";
import { SyntheticNativeRepository } from "../../../tests/edge/synthetic_platform_repository.ts";
import { NativeAllExamineesTotalModel } from "./jungsi/domain/all_examinees_total_model.ts";
import { NativeExamTotalModel } from "./jungsi/domain/total_model.ts";
import { NativeExamPack } from "./jungsi/domain/exam_pack.ts";
import { ContractError } from "./jungsi/domain/exact.ts";
import { nativeJsonText, type NativeObject } from "./jungsi/domain/json_value.ts";
import { OverallAnalysisService } from "./jungsi/application/overall_analysis.ts";
import { ProfileReportService } from "./jungsi/application/profile_reports.ts";
import type { ApiExecution } from "./jungsi/application/api_dispatch.ts";
import { NativeDataProvider } from "./jungsi/infrastructure/native_data_provider.ts";
import { NativeSourceSelection } from "./jungsi/infrastructure/native_source_selection.ts";
import { SupabaseArtifactClient } from "./jungsi/infrastructure/supabase_artifacts.ts";

const HASH = "a".repeat(64), NOW = 1700000000000000n;
const actor = {
  user: { subjectId: "00000000-0000-0000-0000-000000000001", expiresAtUtc: NOW + 1000000n },
  evaluatedAtUtc: NOW,
  tier: "paid" as const,
  paidUntilUtc: NOW + 500000n,
};
function packData(): NativeObject {
  const p = syntheticNativePackData() as NativeObject,
    participants = p.participants as NativeObject;
  participants.total = 12;
  (participants.target_population as NativeObject).count_lower_bound = 3;
  return p;
}
function data(status = "reference"): NativeObject {
  const d = syntheticNativeModelData() as NativeObject;
  d.format = "jungsi.exam-total-model/v2";
  d.basis = "official_all_examinees_estimate";
  const distribution = d.distribution as NativeObject, m = distribution.metadata as NativeObject;
  Object.assign(m, {
    population_id: "official_all_examinees",
    kind: "estimated_weights",
    status,
    population_verified: false,
    expected_total_weight: "12",
  });
  distribution.rows = [{ total_score: 20, weight: "3" }, { total_score: 30, weight: "5" }, {
    total_score: 36,
    weight: "4",
  }];
  d.population_policy = {
    format: "jungsi.official-all-examinees-population-policy/v1",
    population_id: "official_all_examinees",
    denominator_basis: "same_exam_pack.participants.total",
    official_total: 12,
    official_total_verified: true,
    joint_scores_observed: false,
    missing_scores: "model_imputation",
    estimate_basis: "estimated_not_observed",
    complete_semantics: "all_modeled_weights_accounted_not_observed_joint",
    complete_response_profiles: 9,
    model_imputed_profiles: 3,
    observed_missing_value: null,
    internal_missing_sentinel: -1,
    total_point_curve: "conditional_band_grade_imputation",
    imputation_kind: "model_assumption_not_actual_score",
    missing_domain_subject_choice: "official_marginal_weighted_sampling_without_duplicate",
    inquiry_one_subject_extra_score: "modeled_counterfactual_second_subject",
    rank_bounds: "official_supported_score_domain_bounds_no_zero_substitution",
    official_n_is_not_complete_subject_intersection: true,
    scenario_id: "lower_correlation",
    within_band_correlation: "0",
    official_population_decision_sha256: HASH,
    source_model_config_sha256: HASH,
    source_curve_sha256: HASH,
    scenario_profiles_sha256: HASH,
    independent_validation_sha256: HASH,
    scenario_selection_sha256: status === "approved" ? HASH : null,
  };
  return d;
}
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
const policy = (d: NativeObject) => d.population_policy as NativeObject;
const metadata = (d: NativeObject) => (d.distribution as NativeObject).metadata as NativeObject;
function rejects(run: () => unknown, code?: string) {
  let e: unknown;
  try {
    run();
  } catch (error) {
    e = error;
  }
  assert(e instanceof ContractError);
  if (code) equal(e.code, code);
}
Deno.test("whole-population v2 uses the pack official total outside the retained intersection bounds", () => {
  const p = new NativeExamPack(packData()), m = new NativeAllExamineesTotalModel(data("approved"));
  assert(p.officialParticipantTotal() === 12n);
  equal(nativeJsonText(p.populationBounds()), nativeJsonText({ lower: 3n, upper: 9n, count: 9n }));
  const r = m.calculate(p, p.analyze(scores()));
  equal([r.status, r.population_id, r.top_percent, r.data_kind], [
    "estimated",
    "official_all_examinees",
    "75.000000",
    "estimated_weights",
  ]);
});
Deno.test("whole-population v2 preserves exact inclusive exclusive and tie intervals", () => {
  const p = new NativeExamPack(packData()), m = new NativeAllExamineesTotalModel(data("approved"));
  const r = m.calculate(p, { ...p.analyze(scores()), totalStandardScore: 30 });
  equal([r.inclusive_top_percent, r.exclusive_top_percent, r.tie_share_percent], [
    "75.000000",
    "33.333333",
    "41.666667",
  ]);
  equal(r.tie_interval_percent, { lower: "33.333333", upper: "75.000000" });
  equal(r.tie_policy, "include_equal");
});
Deno.test("whole-population reference cannot return a numeric result", async () => {
  const p = new NativeExamPack(packData()), m = new NativeAllExamineesTotalModel(data());
  rejects(() => m.calculate(p, p.analyze(scores())), "model_not_ready");
  const service = new OverallAnalysisService({
    getExamPack: () => Promise.resolve(p),
    getTotalModel: () => Promise.resolve({ model: m, distributionId: m.distributionId }),
  });
  const r = await service.analyze(actor, scores()), o = r.overall as NativeObject;
  equal([o.status, o.reason_code, o.population_id, o.top_percent], [
    "pending",
    "total_model_not_approved",
    "official_all_examinees",
    null,
  ]);
  equal([r.total_standard_score, (r.subjects as unknown[]).length], [26, 4]);
  assert(!nativeJsonText(r).includes("population_policy"));
});
Deno.test("whole-population approval requires an explicit scenario selection hash", () => {
  const d = data("approved");
  policy(d).scenario_selection_sha256 = null;
  rejects(() => new NativeAllExamineesTotalModel(d), "scenario_selection_required");
  const ref = data();
  policy(ref).scenario_selection_sha256 = HASH;
  rejects(() => new NativeAllExamineesTotalModel(ref), "scenario_selection_required");
});
Deno.test("whole-population v2 exact envelope policy metadata and frequency fields reject missing or extra keys", () => {
  for (const path of [[], ["population_policy"], ["distribution"], ["distribution", "metadata"]]) {
    const original = data();
    let target = original;
    for (const k of path) target = target[k] as NativeObject;
    for (const k of Object.keys(target)) {
      const d = data();
      let at = d;
      for (const key of path) at = at[key] as NativeObject;
      delete at[k];
      rejects(() => new NativeAllExamineesTotalModel(d));
    }
    target.extra = true;
    rejects(() => new NativeAllExamineesTotalModel(original), "invalid_schema");
  }
  const d = data();
  ((d.distribution as NativeObject).rows as NativeObject[])[0].extra = true;
  rejects(() => new NativeAllExamineesTotalModel(d), "invalid_schema");
});
Deno.test("whole-population v2 rejects observed or verified joint claims and missing-score substitutions", () => {
  for (
    const [key, value] of [
      ["joint_scores_observed", true],
      ["official_total_verified", false],
      ["observed_missing_value", 0],
      ["internal_missing_sentinel", 0],
      ["missing_scores", "zero"],
      ["official_n_is_not_complete_subject_intersection", false],
    ] as const
  ) {
    const d = data();
    policy(d)[key] = value;
    rejects(() => new NativeAllExamineesTotalModel(d), "population_policy_mismatch");
  }
  for (
    const [key, value] of [["population_verified", true], ["kind", "observed_counts"], [
      "complete",
      false,
    ]] as const
  ) {
    const d = data();
    metadata(d)[key] = value;
    rejects(() => new NativeAllExamineesTotalModel(d));
  }
});
Deno.test("whole-population v2 checks integer population composition exact mass and same-exam denominator", () => {
  for (
    const [key, value] of [["official_total", 13], ["model_imputed_profiles", 2], [
      "complete_response_profiles",
      true,
    ], ["official_total", "12"]] as const
  ) {
    const d = data();
    policy(d)[key] = value;
    rejects(() => new NativeAllExamineesTotalModel(d));
  }
  const d = data();
  ((d.distribution as NativeObject).rows as NativeObject[])[0].weight = "2";
  rejects(() => new NativeAllExamineesTotalModel(d), "population_total_mismatch");
  const p = new NativeExamPack(syntheticNativePackData()),
    m = new NativeAllExamineesTotalModel(data("approved"));
  rejects(() => m.calculate(p, p.analyze(scores())), "model_population_mismatch");
});
Deno.test("whole-population v2 rejects incomplete provenance and absent invalid or implicit scenarios", () => {
  for (
    const key of [
      "official_population_decision_sha256",
      "source_model_config_sha256",
      "source_curve_sha256",
      "scenario_profiles_sha256",
      "independent_validation_sha256",
    ]
  ) {
    const d = data();
    policy(d)[key] = "invalid";
    rejects(() => new NativeAllExamineesTotalModel(d), "invalid_policy_hash");
  }
  for (const value of [null, "default", "other"]) {
    const d = data();
    policy(d).scenario_id = value;
    rejects(() => new NativeAllExamineesTotalModel(d), "invalid_scenario");
  }
  for (const value of ["-0.1", "1.1", true]) {
    const d = data();
    policy(d).within_band_correlation = value;
    rejects(() => new NativeAllExamineesTotalModel(d));
  }
});
Deno.test("whole-population v2 retains all three explicit scenarios without choosing a default", () => {
  for (
    const [id, correlation] of [["base", "0.5"], ["lower_correlation", "0"], [
      "higher_correlation",
      "1",
    ]]
  ) {
    const d = data();
    Object.assign(policy(d), { scenario_id: id, within_band_correlation: correlation });
    equal(new NativeAllExamineesTotalModel(d).populationPolicy.scenario_id, id);
  }
});
Deno.test("whole-population v2 validates native source date duplicates score domain and status", () => {
  for (
    const [key, value] of [["source_date", "2026-02-30"], ["status", "ready"], [
      "metric_id",
      "other",
    ], ["score_max", 1]]
  ) {
    const d = data();
    metadata(d)[key] = value;
    rejects(() => new NativeAllExamineesTotalModel(d));
  }
  const d = data(), rows = (d.distribution as NativeObject).rows as NativeObject[];
  rows[1].total_score = 20;
  rejects(() => new NativeAllExamineesTotalModel(d), "duplicate_score");
});
Deno.test("whole-population v2 keeps the legacy v1 constructor and intersection guard strict", () => {
  rejects(() => new NativeExamTotalModel(data()), "invalid_schema");
  const raw = syntheticNativeModelData() as NativeObject, p = new NativeExamPack(packData());
  const old = new NativeExamTotalModel(raw);
  equal(
    old.calculate(p, p.analyze(scores())).population_id,
    "all_examinees_with_korean_math_two_inquiry_scores",
  );
  const d = syntheticNativeModelData() as NativeObject, dist = d.distribution as NativeObject;
  (dist.metadata as NativeObject).expected_total_weight = "12";
  (dist.rows as NativeObject[])[0].weight = "6";
  rejects(
    () => new NativeExamTotalModel(d).calculate(p, p.analyze(scores())),
    "model_population_mismatch",
  );
  rejects(() => new NativeAllExamineesTotalModel(raw), "invalid_schema");
});
Deno.test("whole-population v2 copies model state before caller mutation", () => {
  const d = data("approved"),
    m = new NativeAllExamineesTotalModel(d),
    p = new NativeExamPack(packData());
  metadata(d).score_max = 0;
  policy(d).official_total = 0;
  ((d.distribution as NativeObject).rows as NativeObject[])[0].weight = "999";
  equal(m.calculate(p, p.analyze(scores())).top_percent, "75.000000");
  assert(Object.isFrozen(m.populationPolicy));
});
async function selectedModel(raw: NativeObject) {
  const bytes = new TextEncoder().encode(nativeJsonText(raw)),
    hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) =>
      n.toString(16).padStart(2, "0")
    ).join("");
  const entry = {
    kind: "total_model",
    key: "SYNTHETIC-mock:SYNTHETIC-pack.v1",
    bucket: "synthetic-private",
    object_key: "SYNTHETIC/model.json",
    sha256: hash,
    bytes: bytes.length,
    version: "SYNTHETIC-pack.v1",
    status: "approved",
    engine_approved: true,
    production_allowed: true,
    archive_only: false,
    distribution_id: metadata(raw).distribution_id,
  };
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input),
      response = new Response(
        url.includes("/bucket/")
          ? '{"id":"synthetic-private","public":false,"file_size_limit":65536}'
          : bytes,
      );
    Object.defineProperty(response, "url", { value: url });
    return Promise.resolve(response);
  }) as typeof fetch;
  const client = new SupabaseArtifactClient({
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    secretKey: "sb_secret_SYNTHETIC",
    bucket: "synthetic-private",
    objectPrefix: "SYNTHETIC/",
    limits: {
      maxArtifactBytes: 65536,
      maxBucketBytes: 65536,
      maxMetadataBytes: 1024,
      requestTimeoutMs: 1000,
    },
  }, fetcher);
  const pin = async (value: unknown) => {
    const b = new TextEncoder().encode(nativeJsonText(value)),
      h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((n) =>
        n.toString(16).padStart(2, "0")
      ).join("");
    return { bytes: b, sha256: h, maxBytes: 65536 };
  };
  const selection = await NativeSourceSelection.prepare(
    client,
    await pin({ format: "jungsi.data-registry/v1", entries: [entry] }),
    await pin({
      format: "jungsi.runtime-selection/v1",
      required: [{ kind: entry.kind, key: entry.key }],
    }),
  );
  return new NativeDataProvider(selection);
}
Deno.test("whole-population provider explicitly decodes v2 and preserves immutable selection cache", async () => {
  const provider = await selectedModel(data("approved")),
    first = await provider.getTotalModel("SYNTHETIC-mock", "SYNTHETIC-pack.v1");
  assert(first?.model instanceof NativeAllExamineesTotalModel);
  assert(await provider.getTotalModel("SYNTHETIC-mock", "SYNTHETIC-pack.v1") === first);
});
Deno.test("whole-population saved profile explicit reanalysis creates a new revision while old request replay stays pending", async () => {
  const repo = new SyntheticNativeRepository(), p = new NativeExamPack(packData());
  let m = new NativeAllExamineesTotalModel(data()), calculations = 0;
  // Exact032 ignores the fourth fixture argument; the current branch selects its legacy fixture mode.
  const service = Reflect.construct(ProfileReportService, [
    repo,
    {
      getExamPack: () => {
        calculations++;
        return Promise.resolve(p);
      },
      getTotalModel: () => Promise.resolve({ model: m, distributionId: m.distributionId }),
    },
    { nowUtc: () => NOW },
    { mode: "legacy_synthetic" },
  ]) as ProfileReportService;
  const request = (
    operation: ApiExecution["operation"],
    body: NativeObject,
    key: string,
  ): ApiExecution => ({
    operation,
    session: actor,
    management: null,
    body,
    query: {},
    params: {},
    requestKey: key,
  });
  const profile = await service.execute(
      request("score-profile.create", { scores: scores(), confirmed: true }, "SYNTHETIC-create"),
    ),
    body = { profile_id: profile.profile_id };
  const profileBefore = nativeJsonText([...repo.profiles.values()][0]),
    pendingRequest = request("overall.analyze", body, "SYNTHETIC-pending");
  const old = await service.execute(pendingRequest);
  m = new NativeAllExamineesTotalModel(data("approved"));
  equal(await service.execute(pendingRequest), old);
  const next = await service.execute(
    request(
      "overall.analyze",
      { ...body, report_id: old.report_id, expected_version: 1 },
      "SYNTHETIC-fresh",
    ),
  );
  equal([next.report_id, next.report_version], [old.report_id, 2]);
  const inner = (next.overall as NativeObject).overall as NativeObject;
  equal([inner.status, inner.population_id], ["estimated", "official_all_examinees"]);
  equal(((old.overall as NativeObject).overall as NativeObject).status, "pending");
  equal(nativeJsonText([...repo.profiles.values()][0]), profileBefore);
  equal(repo.events.filter((e) => e === "create-profile").length, 1);
  const before = calculations;
  await service.execute({
    ...request("report.read", {}, "SYNTHETIC-read"),
    params: { report_id: old.report_id as string },
  });
  equal(calculations, before);
});
