import { syncPromise } from "./fixture.ts";
/** Python synthetic pack/model normal and hold cases; no actual scores or source tables. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  OverallAnalysisService,
  type OverallDataPort,
} from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
import type { SessionSnapshot } from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { NativeExamTotalModel } from "../../supabase/functions/_shared/jungsi/domain/total_model.ts";
import { ContractError } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { assert, equal } from "./fixture.ts";
import { syntheticNativeModelData, syntheticNativePackData } from "./synthetic_exam_pack.ts";

const NOW = 1700000000000000n;
function actor(): SessionSnapshot {
  return {
    user: {
      subjectId: "00000000-0000-0000-0000-000000000001",
      expiresAtUtc: NOW + 1000000n,
      assuranceLevel: null,
      accountStatus: null,
    },
    evaluatedAtUtc: NOW,
    tier: "standard",
    paidUntilUtc: null,
  };
}
function request() {
  return {
    exam_id: "SYNTHETIC-mock",
    pack_version: "SYNTHETIC-pack.v1",
    korean: { standard_score: 5, choice: "가상국어선택" },
    math: { standard_score: 6 },
    inquiry: [{ subject: "가상탐구가", standard_score: 7 }, {
      subject: "가상탐구나",
      standard_score: 8,
    }],
  };
}
function set(root: unknown, path: string[], value: unknown) {
  let at = root as Record<string, unknown>;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string, unknown>;
  at[path[path.length - 1]] = value;
}
function provider(
  model: NativeExamTotalModel | null = new NativeExamTotalModel(syntheticNativeModelData()),
) {
  const calls: string[] = [], pack = new NativeExamPack(syntheticNativePackData());
  const data: OverallDataPort = {
    getExamPack() {
      return syncPromise(() => {
        calls.push("pack");
        return pack;
      });
    },
    getTotalModel() {
      return syncPromise(() => {
        calls.push("model");
        return model ? { model, distributionId: model.distributionId } : null;
      });
    },
  };
  return { calls, pack, data, service: new OverallAnalysisService(data) };
}
async function denied(run: () => Promise<unknown>, code: string, http: number) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
  equal(error.http, http);
}
const overall = (value: Record<string, unknown>) => value.overall as Record<string, unknown>;
Deno.test("overall native service matches invented Python same-exam sum and exact tail", async () => {
  const f = provider(), result = await f.service.analyze(actor(), request());
  equal(result.format, "jungsi.overall-analysis/v1");
  equal(result.total_standard_score, 26);
  equal(overall(result).status, "observed");
  equal(overall(result).top_percent, "66.666667");
  equal(overall(result).tie_share_percent, "0.000000");
  equal(overall(result).tie_policy, "include_equal");
  equal((result.subjects as unknown[]).length, 4);
  equal(f.calls, ["pack", "model"]);
  assert(!Object.hasOwn(result, "university_analysis"));
  // 제2외국어/한문: 없으면 미응시(null), 있으면 과목·등급만. 총점·과목 결과에는 넣지 않는다
  equal(result.second_language, null);
  const taken = await f.service.analyze(actor(), {
    ...request(),
    second_language: { subject: "일본어Ⅰ", grade: 2 },
  });
  equal(taken.second_language, { subject: "일본어Ⅰ", grade: 2 });
  equal(taken.total_standard_score, 26);
  equal((taken.subjects as unknown[]).length, 4);
  equal(
    (await f.service.analyze(actor(), { ...request(), second_language: null })).second_language,
    null,
  );
});
Deno.test("overall native service requires verified actor before input and any data access", async () => {
  const f = provider(), a = actor();
  const bad = { ...a, user: { ...a.user, expiresAtUtc: NOW } };
  await denied(() => f.service.analyze(bad, {}), "authentication_required", 401);
  equal(f.calls, []);
});
Deno.test("overall native input and pack version failures keep original safe statuses", async () => {
  const f = provider();
  await denied(() => f.service.analyze(actor(), {}), "invalid_request", 422);
  equal(f.calls, []);
  for (
    const bad of [
      { subject: "일본어Ⅰ", grade: 0 },
      { subject: "일본어Ⅰ", grade: 10 },
      { subject: "일본어Ⅰ", grade: true },
      { subject: "일본어", grade: 2 },
      { subject: "일본어Ⅰ" },
      { subject: "일본어Ⅰ", grade: 2, standard_score: 60 },
      2,
    ]
  ) {
    await denied(
      () => f.service.analyze(actor(), { ...request(), second_language: bad }),
      "invalid_second_language",
      422,
    );
  }
  equal(f.calls, []);
  await denied(
    () => f.service.analyze(actor(), { ...request(), pack_version: "SYNTHETIC-old" }),
    "pack_version_mismatch",
    409,
  );
  equal(f.calls, ["pack"]);
});
Deno.test("overall native missing total model preserves successful subject results", async () => {
  const result = await provider(null).service.analyze(actor(), request());
  equal(result.total_standard_score, 26);
  equal((result.subjects as unknown[]).length, 4);
  equal(overall(result).reason_code, "total_model_missing");
  equal(overall(result).top_percent, null);
});
Deno.test("overall native unapproved total is held rather than computed", async () => {
  const source = syntheticNativeModelData();
  set(source, ["distribution", "metadata", "status"], "reference");
  const result = await provider(new NativeExamTotalModel(source)).service.analyze(
    actor(),
    request(),
  );
  equal(overall(result).reason_code, "total_model_not_approved");
  equal(result.total_standard_score, 26);
});
Deno.test("overall native provider hash failure holds only total curve", async () => {
  const f = provider();
  f.data.getTotalModel = () => {
    throw new AccessError("drive_hash_mismatch", 503);
  };
  const result = await f.service.analyze(actor(), request());
  equal(overall(result).reason_code, "model_provider_hash_mismatch");
  equal(result.total_standard_score, 26);
});
Deno.test("overall native different exam pack and academic year models are independent holds", async () => {
  for (
    const [path, value, reason] of [
      [["exam_id"], "SYNTHETIC-other", "model_exam_mismatch"],
      [["pack_version"], "SYNTHETIC-old", "model_pack_mismatch"],
      [["distribution", "metadata", "academic_year"], 2028, "academic_year_mismatch"],
    ] as [string[], unknown, string][]
  ) {
    const source = syntheticNativeModelData();
    set(source, path, value);
    const result = await provider(new NativeExamTotalModel(source)).service.analyze(
      actor(),
      request(),
    );
    equal(overall(result).reason_code, reason);
    equal(result.total_standard_score, 26);
  }
});
Deno.test("overall native incompatible population cannot reuse same numerical curve", async () => {
  const source = syntheticNativeModelData();
  set(source, ["distribution", "metadata", "expected_total_weight"], "10");
  set(source, ["distribution", "rows", "0", "weight"], "4");
  const result = await provider(new NativeExamTotalModel(source)).service.analyze(
    actor(),
    request(),
  );
  equal(overall(result).reason_code, "model_population_mismatch");
  equal(result.total_standard_score, 26);
});
Deno.test("overall native model identifier binding is checked independently of numeric equality", async () => {
  const f = provider(), model = new NativeExamTotalModel(syntheticNativeModelData());
  f.data.getTotalModel = () =>
    syncPromise(() => ({ model, distributionId: "SYNTHETIC-different" }));
  equal(overall(await f.service.analyze(actor(), request())).reason_code, "model_version_mismatch");
});
Deno.test("overall native partial model domain does not turn successful subjects into missing", async () => {
  const source = syntheticNativeModelData();
  set(source, ["distribution", "metadata", "score_min"], 30);
  set(source, ["distribution", "rows"], [{ total_score: 30, weight: "7" }, {
    total_score: 36,
    weight: "2",
  }]);
  const result = await provider(new NativeExamTotalModel(source)).service.analyze(
    actor(),
    request(),
  );
  equal(overall(result).reason_code, "score_outside_domain");
  equal(result.total_standard_score, 26);
});
Deno.test("overall native invalid subject score is not replaced with a total-model estimate", async () => {
  const f = provider(), p = request();
  p.korean.standard_score = 10;
  await denied(() => f.service.analyze(actor(), p), "unobserved_standard_score", 422);
  equal(f.calls, ["pack"]);
});
Deno.test("overall native does not fabricate unpublished combination DTO fields", async () => {
  const result = await provider().service.analyze(actor(), request());
  for (const field of ["combinations", "reflection_combinations", "korean_math_inq_avg"]) {
    assert(!Object.hasOwn(result, field));
  }
});
Deno.test("overall model native metadata approval booleans and frequency integrity are strict", () => {
  for (
    const [path, value] of [
      [["distribution", "metadata", "complete"], "true"],
      [["distribution", "metadata", "population_verified"], false],
      [["distribution", "rows", "0", "weight"], "2.5"],
      [["distribution", "rows", "1", "total_score"], 20],
    ] as [string[], unknown][]
  ) {
    const source = syntheticNativeModelData();
    set(source, path, value);
    let error: unknown;
    try {
      new NativeExamTotalModel(source);
    } catch (e) {
      error = e;
    }
    assert(error instanceof ContractError);
  }
});

Deno.test("overall model JSON rejects rational strings in row and expected weights", () => {
  for (
    const value of ["1/2", "1/3", "2/1", "-1/2", "1/-2", "-1/-2", "0/1", "1/0", "0/0", "1 / 2"]
  ) {
    for (
      const path of [["distribution", "metadata", "expected_total_weight"], [
        "distribution",
        "rows",
        "0",
        "weight",
      ]]
    ) {
      const source = syntheticNativeModelData();
      set(source, path, value);
      let error: unknown;
      try {
        NativeExamTotalModel.fromJson(JSON.stringify(source));
      } catch (e) {
        error = e;
      }
      assert(error instanceof ContractError);
      equal(error.code, "invalid_weight");
    }
  }
});
