import { syncPromise } from "./fixture.ts";
/** Invented selected sources only; all approval flags are synthetic control-flow inputs. */
import {
  NativeDataProvider,
  NativeForecastInputs,
} from "../../supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts";
import { NativeSourceSelection } from "../../supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts";
import { SupabaseArtifactClient } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { UniversityPercentileService } from "../../supabase/functions/_shared/jungsi/application/university_percentile.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { OverallAnalysisService } from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { syntheticNativeModelData } from "./synthetic_exam_pack.ts";
import { syntheticUniversityCurveData } from "./synthetic_university_curve.ts";
import { syntheticForecastFixture } from "./synthetic_forecast.ts";
import { SyntheticUniversityData } from "./synthetic_university.ts";
import { assert, equal } from "./fixture.ts";
async function pin(text: string) {
  const bytes = new TextEncoder().encode(text);
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ].map((v) => v.toString(16).padStart(2, "0")).join("");
  return { bytes, sha256, maxBytes: 65536 };
}
async function fixture(
  change: (sources: Map<string, NativeObject>) => void = () => {},
) {
  const u = new SyntheticUniversityData(),
    pack = u.pack!,
    oid = u.offering.offering_id as string;
  const rule: NativeObject = {
    ...u.rawRule,
    exam_id: pack.examId,
    source_pack_version: pack.packVersion,
    score_scale_id: "SYNTHETIC-scale",
    bonus_treatment: "excluded",
  };
  const binding = {
    ...u.offering,
    offering_pk: oid,
    rule_version: rule.rule_version,
  };
  const model = syntheticNativeModelData() as NativeObject;
  model.exam_id = pack.examId;
  model.pack_version = pack.packVersion;
  const curve = syntheticUniversityCurveData();
  (curve.metadata as NativeObject).source_pack_version = pack.packVersion;
  const f = syntheticForecastFixture(),
    context = f.inputs.context as NativeObject;
  Object.assign(context, {
    offering_id: oid,
    university_id: u.offering.university_id,
    ...Object.fromEntries(
      ["campus", "department", "track", "group"].map((k) => [k, u.offering[k]]),
    ),
    exam_id: pack.examId,
    source_pack_version: pack.packVersion,
    catalog_version: "SYNTHETIC-catalog",
    rule_id: rule.rule_id,
    rule_version: rule.rule_version,
    curve_version: (curve.metadata as NativeObject).curve_version,
    population_id: (curve.metadata as NativeObject).population_id,
    bonus_treatment: "excluded",
  });
  f.policy.context = cloneNativeJson(context);
  f.policy.policy_id = "SYNTHETIC-policy-id";
  f.inputs.input_id = "SYNTHETIC-input-id";
  const sources = new Map<string, NativeObject>([
    ["exam_pack|" + pack.examId, u.rawPack],
    ["total_model|" + pack.examId + ":" + pack.packVersion, model],
    ["catalog|service", {
      format: "jungsi.catalog-release/v1",
      version: "SYNTHETIC-catalog",
      status: "approved",
      as_of: "2026-10-14T00:00:00Z",
      offerings: [{
        ...u.offering,
        university_name: "가상대학",
        region: "가상지역",
        wildcard_group: null,
        practical_required: false,
        recruitment: {
          deadline_at: "2027-01-01T09:00:00.123456",
          changes: [{ announced_at: "2026-10-14T09:00:00.123456" }],
        },
      }],
      history: [],
    }],
    ["conversion|" + oid, {
      format: "jungsi.university-conversion-release/v1",
      version: "SYNTHETIC-conversion",
      status: "approved",
      academic_year: 2027,
      exam_id: pack.examId,
      source_pack_version: pack.packVersion,
      exam_type: "csat",
      release_id: "SYNTHETIC-rule-release",
      rules: [rule],
      bindings: [binding],
    }],
    ["percentile|" + oid, {
      format: "jungsi.university-percentile-release/v1",
      version: "SYNTHETIC-percentile",
      release_id: "SYNTHETIC-percentile-id",
      status: "approved",
      academic_year: 2027,
      exam_id: pack.examId,
      source_pack_version: pack.packVersion,
      exam_type: "csat",
      rule_version: rule.rule_version,
      curve,
      bindings: [{
        ...binding,
        curve_version: (curve.metadata as NativeObject).curve_version,
      }],
    }],
    ["forecast_inputs|SYNTHETIC-input-id:SYNTHETIC-input", f.inputs],
    ["forecast_policy|SYNTHETIC-policy-id:SYNTHETIC-policy", f.policy],
    ["forecast_context|" + oid, { version: "SYNTHETIC-context", context }],
  ]);
  change(sources);
  const entries: NativeObject[] = [],
    bodies = new Map<string, Uint8Array<ArrayBuffer>>(),
    calls: string[] = [];
  for (const [id, raw] of sources) {
    const [kind, key] = id.split("|"),
      artifact = await pin(nativeJsonText(raw)),
      object_key = "SYNTHETIC/" + String(entries.length) + ".json";
    const distribution = raw.distribution as NativeObject | undefined;
    entries.push({
      kind,
      key,
      bucket: "synthetic-private",
      object_key,
      sha256: artifact.sha256,
      bytes: artifact.bytes.length,
      version: Object.hasOwn(raw, "version") ? raw.version : raw.pack_version,
      status: "approved",
      engine_approved: true,
      production_allowed: true,
      archive_only: false,
      source_timezone: "Asia/Seoul",
      ...(kind === "total_model"
        ? {
          distribution_id: (distribution!.metadata as NativeObject).distribution_id,
        }
        : {}),
    });
    bodies.set(object_key, artifact.bytes);
  }
  const fetcher = ((input: RequestInfo | URL) =>
    syncPromise(() => {
      const url = String(input);
      calls.push(url);
      const body = url.includes("/bucket/")
        ? '{"id":"synthetic-private","public":false,"file_size_limit":65536}'
        : bodies.get(decodeURIComponent(url.split("/synthetic-private/")[1]));
      if (body === undefined) throw new Error("unexpected_synthetic_object");
      const response = new Response(body);
      Object.defineProperty(response, "url", { value: url });
      return response;
    })) as typeof fetch;
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
  const selected = await NativeSourceSelection.prepare(
    client,
    await pin(nativeJsonText({ format: "jungsi.data-registry/v1", entries })),
    await pin(
      nativeJsonText({
        format: "jungsi.runtime-selection/v1",
        required: entries.map((e) => ({ kind: e.kind, key: e.key })),
      }),
    ),
  );
  return { data: new NativeDataProvider(selected), selected, u, oid, calls, context };
}
async function denied(run: () => Promise<unknown>, code: string, http = 503) {
  let e: unknown;
  try {
    await run();
  } catch (value) {
    e = value;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, http);
}
Deno.test("native provider reuses pinned pack model and catalog without further GETs", async () => {
  const f = await fixture(), calls = f.calls.length;
  const pack = await f.data.getExamPack(f.u.pack!.examId),
    model = await f.data.getTotalModel(f.u.pack!.examId, f.u.pack!.packVersion);
  equal(pack!.examId, f.u.pack!.examId);
  assert(model !== null);
  equal(model.distributionId, model.model.distributionId);
  const catalog = await f.data.getCatalog();
  equal(
    (catalog!.offerings[0].recruitment as NativeObject).deadline_at,
    "2027-01-01T00:00:00.123456Z",
  );
  equal(utcText(catalog!.asOfUtc), "2026-10-14T00:00:00Z");
  equal(await f.data.getExamPack("SYNTHETIC-unselected"), null);
  equal(f.calls.length, calls);
});
Deno.test("native provider decoded conversion and independent curve feed real scoring services", async () => {
  const f = await fixture(), offering = f.u.offering, scores = f.u.scores();
  const profile = {
    profile_id: "SYNTHETIC-profile",
    owner_id: "SYNTHETIC-owner",
    confirmed: true,
    created_at: "2026-10-14T00:00:00Z",
    scores,
  };
  const converted = await new UniversityScoringService(f.data).calculate(
    offering,
    profile,
  );
  equal(converted.dto().status, "ready");
  equal(converted.state.converted_score, "30.00");
  const percentile = await new UniversityPercentileService(f.data).calculate(
    offering,
    converted,
  );
  equal(percentile.dto().status, "ready");
});
Deno.test("native forecast inputs bind fixed IDs versions and the current selected context", async () => {
  const f = await fixture(), inputs = new NativeForecastInputs(f.data);
  equal(
    (await inputs.inputs(f.oid, "SYNTHETIC-input-id", "SYNTHETIC-input"))
      .input_id,
    "SYNTHETIC-input-id",
  );
  equal(
    (await inputs.policy("SYNTHETIC-policy-id", "SYNTHETIC-policy"))
      .require_independent_approver,
    true,
  );
  equal(await inputs.currentContext(f.oid), f.context);
  await denied(
    () => inputs.inputs("SYNTHETIC-other", "SYNTHETIC-input-id", "SYNTHETIC-input"),
    "forecast_input_binding_mismatch",
  );
});
Deno.test("native provider requires an independently selected restricted population receipt", async () => {
  const f = await fixture((sources) => {
    const p = [...sources].find(([key]) => key.startsWith("percentile|"))![1];
    p.comparison_population = {
      validation_receipt_version: "SYNTHETIC-missing-receipt",
    };
  });
  await denied(
    () => f.data.getPercentile(f.oid),
    "percentile_population_receipt_missing",
  );
});
Deno.test("native forecast context refuses a different catalog identity or current curve version", async () => {
  for (const field of ["group", "curve_version"]) {
    const f = await fixture((sources) => {
      const raw = [...sources].find(([key]) => key.startsWith("forecast_context|"))![1];
      (raw.context as NativeObject)[field] = "SYNTHETIC-other";
    });
    await denied(
      () => new NativeForecastInputs(f.data).currentContext(f.oid),
      "forecast_base_version_conflict",
      409,
    );
  }
});
Deno.test("native provider preserves raw source timestamps when catalog adapter normalizes its private copy", async () => {
  const f = await fixture();
  await f.data.getCatalog();
  const raw = f.data.load("catalog", "service")!;
  equal(
    ((raw.offerings as NativeObject[])[0].recruitment as NativeObject)
      .deadline_at,
    "2027-01-01T09:00:00.123456",
  );
  const conversion = await f.data.getConversion(f.oid);
  assert(Object.isFrozen(conversion!.bindings));
});

// Freshness is a server-owned port. These approvals are fictional, not live selections.
async function servingFixture(change: (sources: Map<string, NativeObject>) => void = () => {}) {
  const f = await fixture((sources) => {
    const model = [...sources].find(([id]) => id.startsWith("total_model|"))![1];
    (model.distribution as NativeObject).metadata = {
      ...(model.distribution as NativeObject).metadata as NativeObject,
      status: "approved",
    };
    change(sources);
  });
  let now = 10n, headCalls = 0;
  const head = {
    status: "approved",
    registrySha256: f.selected.registryHash,
    selectionSha256: f.selected.selectionHash,
    approvalReferenceSha256: "a".repeat(64),
    expiresAtUtc: 100n,
  };
  const data = new NativeDataProvider(f.selected, {
    approvalReferenceSha256: head.approvalReferenceSha256,
    expiresAtUtc: head.expiresAtUtc,
    clock: { nowUtc: () => now },
    heads: {
      current: () => {
        headCalls++;
        return Promise.resolve({ ...head });
      },
    },
  });
  return { ...f, data, head, setNow: (value: bigint) => now = value, headCalls: () => headCalls };
}
async function preflightRefused(change: (sources: Map<string, NativeObject>) => void) {
  const f = await servingFixture(change);
  let error: unknown;
  try {
    await f.data.preflight();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.http, 503);
}
Deno.test("selected release preflight decodes the complete graph without another source GET or source mutation", async () => {
  const f = await servingFixture(), before = nativeJsonText(f.data.load("conversion", f.oid));
  const calls = f.calls.length, receipt = await f.data.preflight();
  equal(receipt.status, "verified_selected_release_graph");
  equal(receipt.artifacts, f.selected.identities().length);
  equal(receipt.production_ready, false);
  equal(receipt.native_acceptance, "NOT_VERIFIED_BY_SOURCE_PREFLIGHT");
  equal(f.calls.length, calls);
  equal(nativeJsonText(f.data.load("conversion", f.oid)), before);
});
Deno.test("serving preflight requires a fresh approved head even when offline source decoding succeeds", async () => {
  const f = await fixture();
  assert(await f.data.getCatalog() !== null);
  await denied(() => f.data.preflight(), "artifact_not_approved");
});
Deno.test("complete release preflight rejects every corrected binding dimension before any scoring", async () => {
  for (
    const field of ["academic_year", "university_id", "campus", "department", "track", "group"]
  ) {
    await preflightRefused((sources) => {
      const raw = [...sources].find(([id]) => id.startsWith("conversion|"))![1];
      (raw.bindings as NativeObject[])[0][field] = field === "academic_year"
        ? 2026
        : "SYNTHETIC-other";
    });
  }
});
Deno.test("release preflight checks unrequested bindings and unused rules rather than only the first matching offering", async () => {
  await preflightRefused((sources) => {
    const raw = [...sources].find(([id]) => id.startsWith("conversion|"))![1];
    (raw.bindings as NativeObject[]).push({
      ...(raw.bindings as NativeObject[])[0],
      offering_pk: "SYNTHETIC-unselected",
    });
  });
  await preflightRefused((sources) => {
    const raw = [...sources].find(([id]) => id.startsWith("conversion|"))![1];
    (raw.rules as NativeObject[]).push({
      ...(raw.rules as NativeObject[])[0],
      rule_version: "SYNTHETIC-unused",
      review_status: "draft",
    });
  });
});
Deno.test("release preflight rejects wrong year exam type pack version and publication despite approved registry flags", async () => {
  for (
    const [field, value] of [["academic_year", 2026], ["exam_type", "june_mock"], [
      "source_pack_version",
      "SYNTHETIC-other",
    ], ["status", "draft"]] as const
  ) {
    await preflightRefused((sources) => {
      [...sources].find(([id]) => id.startsWith("conversion|"))![1][field] = value;
    });
  }
});
Deno.test("release preflight checks percentile binding context and the independent curve approval", async () => {
  for (const field of ["group", "rule_version", "curve_version"]) {
    await preflightRefused((sources) => {
      const raw = [...sources].find(([id]) => id.startsWith("percentile|"))![1];
      (raw.bindings as NativeObject[])[0][field] = "SYNTHETIC-other";
    });
  }
  await preflightRefused((sources) => {
    const raw = [...sources].find(([id]) => id.startsWith("percentile|"))![1];
    ((raw.curve as NativeObject).metadata as NativeObject).status = "reference";
  });
});
Deno.test("a decoded warm-cache hit rechecks selection registry approval and expiry pins", async () => {
  for (const field of ["selectionSha256", "registrySha256", "approvalReferenceSha256"] as const) {
    const f = await servingFixture();
    await f.data.getConversion(f.oid);
    const calls = f.headCalls();
    f.head[field] = "b".repeat(64);
    await denied(() => f.data.getConversion(f.oid), "artifact_version_mismatch");
    assert(f.headCalls() > calls);
  }
  const f = await servingFixture();
  await f.data.getCatalog();
  f.setNow(100n);
  await denied(() => f.data.getCatalog(), "artifact_version_mismatch");
});
Deno.test("revoked or unavailable active heads never return an old warm-cache value", async () => {
  const f = await servingFixture();
  await f.data.getCatalog();
  f.head.status = "revoked";
  await denied(() => f.data.getCatalog(), "artifact_version_mismatch");
  const data = new NativeDataProvider(f.selected, {
    approvalReferenceSha256: "a".repeat(64),
    expiresAtUtc: 100n,
    clock: { nowUtc: () => 10n },
    heads: { current: () => Promise.reject(new Error("SYNTHETIC-head-unavailable")) },
  });
  await denied(() => data.getCatalog(), "artifact_not_approved");
});
Deno.test("a head change while native decoding awaits cannot populate or return a stale cache entry", async () => {
  const f = await servingFixture();
  let reads = 0;
  const data = new NativeDataProvider(f.selected, {
    approvalReferenceSha256: "a".repeat(64),
    expiresAtUtc: 100n,
    clock: { nowUtc: () => 10n },
    heads: {
      current: () => {
        reads++;
        return Promise.resolve({
          ...f.head,
          selectionSha256: reads === 1 ? f.head.selectionSha256 : "b".repeat(64),
        });
      },
    },
  });
  await denied(() => data.getConversion(f.oid), "artifact_version_mismatch");
});
Deno.test("unissued optional model curve and judgment retain subject analysis conversion and history", async () => {
  const f = await servingFixture((sources) => {
    for (const id of [...sources.keys()]) {
      if (
        id.startsWith("total_model|") || id.startsWith("percentile|") || id.startsWith("analysis|")
      ) sources.delete(id);
    }
  });
  const receipt = await f.data.preflight();
  const pending = receipt.optional_missing as NativeObject[];
  for (
    const reason of [
      "total_model_missing",
      "percentile_release_missing",
      "analysis_release_missing",
    ]
  ) {
    assert(pending.some((item) => item.reason_code === reason));
  }
  const overall = await new OverallAnalysisService(f.data).analyze({
    user: {
      subjectId: "SYNTHETIC-owner",
      expiresAtUtc: 100n,
      assuranceLevel: null,
      accountStatus: null,
    },
    evaluatedAtUtc: 10n,
    tier: "paid",
    paidUntilUtc: 100n,
  }, f.u.scores());
  equal((overall.subjects as unknown[]).length, 4);
  equal(overall.total_standard_score, 30);
  equal((overall.overall as NativeObject).reason_code, "total_model_missing");
  const conversion = await new UniversityScoringService(f.data).calculate(f.u.offering, {
    profile_id: "SYNTHETIC-profile",
    scores: f.u.scores(),
  });
  equal(conversion.dto().status, "ready");
  equal(conversion.state.converted_score, "30.00");
  const curve = await new UniversityPercentileService(f.data).calculate(f.u.offering, conversion);
  equal(curve.dto().status, "pending");
  equal(curve.state.reason_code, "percentile_release_missing");
  const catalog = await f.data.getCatalog();
  equal(catalog!.offerings.length, 1);
  equal(catalog!.history.length, 0);
});

const MOCK_EXAM = "SYNTHETIC-september-mock", MOCK_PACK = "SYNTHETIC-mock-pack";
async function mockServingFixture(
  type: "september_mock" | "june_mock" = "september_mock",
  change: (conversion: NativeObject) => void = () => {},
) {
  return await servingFixture((sources) => {
    const oldPack = [...sources].find(([id]) => id.startsWith("exam_pack|"))!;
    const mock = cloneNativeJson(oldPack[1]);
    Object.assign(mock.exam as NativeObject, { exam_id: MOCK_EXAM, exam_type: type });
    mock.pack_version = MOCK_PACK;
    sources.delete(oldPack[0]);
    sources.set("exam_pack|" + MOCK_EXAM, mock);
    for (const id of [...sources.keys()]) if (id.startsWith("total_model|")) sources.delete(id);
    const conversion = [...sources].find(([id]) => id.startsWith("conversion|"))![1];
    conversion.mock_compatibility = {
      version: "SYNTHETIC-approved-compatibility",
      status: "approved",
      source_exam_id: MOCK_EXAM,
      source_pack_version: MOCK_PACK,
      source_exam_type: type,
      rule_exam_id: conversion.exam_id,
      rule_pack_version: conversion.source_pack_version,
    };
    change(conversion);
  });
}
Deno.test("approved September and June compatibility keep CSAT release identity while mock conversion succeeds", async () => {
  for (const type of ["september_mock", "june_mock"] as const) {
    const f = await mockServingFixture(type);
    const before = nativeJsonText(f.data.load("conversion", f.oid));
    await f.data.preflight();
    const scores = { ...f.u.scores(), exam_id: MOCK_EXAM, pack_version: MOCK_PACK };
    const conversion = await new UniversityScoringService(f.data).calculate(f.u.offering, {
      profile_id: "SYNTHETIC-mock-profile",
      scores,
    });
    equal(conversion.dto().status, "ready");
    equal(conversion.state.converted_score, "30.00");
    equal(conversion.state.score_basis, "mock_exam");
    equal(f.data.load("conversion", f.oid)!.exam_type, "csat");
    equal(nativeJsonText(f.data.load("conversion", f.oid)), before);
  }
});
Deno.test("unissued mock compatibility holds only conversion while catalog and subject analysis survive", async () => {
  const f = await mockServingFixture("september_mock", (release) => {
    release.mock_compatibility = null;
  });
  const receipt = await f.data.preflight();
  assert(
    (receipt.optional_missing as NativeObject[]).some((x) =>
      x.reason_code === "mock_compatibility_not_approved"
    ),
  );
  const scores = { ...f.u.scores(), exam_id: MOCK_EXAM, pack_version: MOCK_PACK };
  const conversion = await new UniversityScoringService(f.data).calculate(f.u.offering, {
    profile_id: "SYNTHETIC-mock-profile",
    scores,
  });
  equal(conversion.dto().status, "pending");
  equal(conversion.state.reason_code, "mock_compatibility_not_approved");
  const result = await new OverallAnalysisService(f.data).analyze({
    user: {
      subjectId: "SYNTHETIC-owner",
      expiresAtUtc: 100n,
      assuranceLevel: null,
      accountStatus: null,
    },
    evaluatedAtUtc: 10n,
    tier: "standard",
    paidUntilUtc: null,
  }, scores);
  equal((result.subjects as unknown[]).length, 4);
  equal((result.overall as NativeObject).reason_code, "total_model_missing");
  equal((await f.data.getCatalog())!.offerings.length, 1);
});
Deno.test("forged approved mock compatibility and directly relabelled CSAT releases fail preflight", async () => {
  for (
    const field of [
      "source_pack_version",
      "source_exam_type",
      "rule_exam_id",
      "rule_pack_version",
    ]
  ) {
    const f = await mockServingFixture("september_mock", (release) => {
      (release.mock_compatibility as NativeObject)[field] = "SYNTHETIC-forged";
    });
    let error: unknown;
    try {
      await f.data.preflight();
    } catch (e) {
      error = e;
    }
    assert(error instanceof AccessError);
    equal(error.http, 503);
  }
  const f = await mockServingFixture("september_mock", (release) => {
    release.exam_type = "september_mock";
  });
  await denied(() => f.data.preflight(), "artifact_exam_mismatch");
});
Deno.test("a declared but unselected mock source stays a hold and never authorizes another mock input", async () => {
  const f = await mockServingFixture("september_mock", (release) => {
    (release.mock_compatibility as NativeObject).source_exam_id = "SYNTHETIC-unissued-mock";
  });
  const receipt = await f.data.preflight();
  assert(
    (receipt.optional_missing as NativeObject[]).some((x) =>
      x.reason_code === "mock_compatibility_source_missing"
    ),
  );
  const scores = { ...f.u.scores(), exam_id: MOCK_EXAM, pack_version: MOCK_PACK };
  const converted = await new UniversityScoringService(f.data).calculate(f.u.offering, {
    profile_id: "SYNTHETIC-mock-profile",
    scores,
  });
  equal(converted.dto().status, "pending");
  equal(converted.state.reason_code, "mock_compatibility_not_approved");
});
Deno.test("catalog indexes preserve complete multi-binding checks and refuse duplicate or missing catalog keys", async () => {
  const f = await servingFixture((sources) => {
    const catalog = sources.get("catalog|service")!;
    const offerings = catalog.offerings as NativeObject[];
    const conversion = [...sources].find(([id]) => id.startsWith("conversion|"))![1];
    const percentile = [...sources].find(([id]) => id.startsWith("percentile|"))![1];
    for (let i = 1; i < 80; i++) {
      const id = "SYNTHETIC-indexed-" + i;
      offerings.push({
        ...cloneNativeJson(offerings[0]),
        offering_id: id,
        department: "합성학과" + i,
      });
      for (const raw of [conversion, percentile]) {
        const bindings = raw.bindings as NativeObject[];
        bindings.push({
          ...cloneNativeJson(bindings[0]),
          offering_id: id,
          offering_pk: id,
          department: "합성학과" + i,
        });
      }
    }
  });
  await f.data.preflight();
  equal((await f.data.getCatalog())!.offerings.length, 80);
  equal((await f.data.getConversion(f.oid))!.bindings.length, 80);
  for (const mode of ["duplicate", "missing"]) {
    await preflightRefused((sources) => {
      const rows = sources.get("catalog|service")!.offerings as NativeObject[];
      if (mode === "duplicate") rows.push(cloneNativeJson(rows[0]));
      else rows.splice(0, 1);
    });
  }
});
