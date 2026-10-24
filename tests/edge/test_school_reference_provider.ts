import { assert, equal } from "./fixture.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { SupabaseArtifactClient } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { NativeSourceSelection } from "../../supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts";
import { NativeDataProvider } from "../../supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { runtimeAnalysisDataPort } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  RuntimeReadBudget,
  SupabaseRuntimeControls,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { SYNTHETIC_RUNTIME_NOW, syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
async function pin(raw: NativeObject) {
  const bytes = new TextEncoder().encode(nativeJsonText(raw));
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
  return { bytes, sha256, maxBytes: Math.max(65536, bytes.length) };
}
async function fixture(
  change: (entries: NativeObject[], source: SyntheticReferenceBytes) => void = () => {},
  onFetch = () => {},
  extraReferences = 0,
  mode: "all" | "university_only" = "all",
  concreteControls = false,
  sameRuleBindings = 1,
) {
  const s = await new SyntheticReferenceBytes().seal(), f = s.university;
  const bodies = new Map<string, Uint8Array<ArrayBuffer>>(), entries: NativeObject[] = [];
  let gets = 0, referenceGets = 0;
  const sources: [string, string, NativeObject][] = [["exam_pack", f.pack!.examId, f.rawPack], [
    "catalog",
    "service",
    {
      format: "jungsi.catalog-release/v1",
      version: "SYNTHETIC-catalog",
      status: "approved",
      as_of: "2026-10-14T00:00:00Z",
      offerings: [{
        ...f.offering,
        university_name: "가상대학",
        region: "가상지역",
        wildcard_group: null,
        practical_required: false,
        recruitment: {},
      }],
      history: [],
    },
  ], ["reference_conversion", "SYNTHETIC-shared-rule", s.body]];
  for (let i = 1; i < sameRuleBindings; i++) {
    const key = "SYNTHETIC-same-rule-" + i;
    (s.body.bindings as NativeObject[]).push({
      ...((s.body.bindings as NativeObject[])[0]),
      offering_pk: key,
    });
    (sources[1][2].offerings as NativeObject[]).push({
      ...f.offering,
      offering_id: key,
      university_name: "가상대학",
      region: "가상지역",
      wildcard_group: null,
      practical_required: false,
      recruitment: {},
    });
  }
  for (let i = 0; i < extraReferences; i++) {
    const key = "SYNTHETIC-unrequested-" + i,
      payload = cloneNativeJson(s.body),
      offering = { ...f.offering, offering_id: key };
    (payload.bindings as NativeObject[])[0].offering_pk = key;
    (sources[1][2].offerings as NativeObject[]).push({
      ...offering,
      university_name: "가상대학",
      region: "가상지역",
      wildcard_group: null,
      practical_required: false,
      recruitment: {},
    });
    sources.push(["reference_conversion", key, payload]);
  }
  for (const [kind, key, payload] of sources) {
    const raw = await pin(payload),
      object_key = "SYNTHETIC/" + entries.length + "-" + kind + ".json";
    bodies.set(object_key, raw.bytes);
    entries.push({
      kind,
      key,
      bucket: "synthetic-private",
      object_key,
      bytes: raw.bytes.length,
      sha256: raw.sha256,
      version: payload.version ?? payload.pack_version,
      status: kind === "reference_conversion" ? "approved_reference" : "approved",
      archive_only: false,
      engine_approved: kind !== "reference_conversion",
      production_allowed: kind !== "reference_conversion",
      ...(kind === "reference_conversion"
        ? {
          approval_scope: "same_exam_mathematical_reference",
          source_review_sha256: "a".repeat(64),
          independent_review_sha256: "b".repeat(64),
          reference_context: {
            academic_year: payload.academic_year,
            exam_id: payload.exam_id,
            source_pack_version: payload.source_pack_version,
            exam_type: payload.exam_type,
            rule_version: (payload.rule as NativeObject).rule_version,
            score_scale_id: payload.score_scale_id,
            offering_ids: (payload.bindings as NativeObject[]).map((b) => b.offering_pk),
          },
        }
        : {}),
    });
  }
  change(entries, s);
  const registry = await pin({ format: "jungsi.data-registry/v1", entries }),
    selected = await pin({
      format: "jungsi.runtime-selection/v1",
      required: entries.map((e) => ({ kind: e.kind, key: e.key })),
    });
  let active = true,
    now = concreteControls ? SYNTHETIC_RUNTIME_NOW : utcInstant("2026-10-14T00:00:00Z"),
    headGets = 0;
  const runtime = concreteControls
    ? await syntheticRuntimeBinding(
      (raw) => {
        raw.scope = {
          ...(raw.scope as NativeObject),
          artifacts: entries.map((e) => ({ kind: e.kind, key: e.key })),
        };
        const limits = raw.limits as NativeObject;
        Object.assign(limits.storage as NativeObject, {
          max_artifact_bytes: 1048576,
          max_bucket_bytes: 1048576,
        });
        Object.assign(limits.read as NativeObject, { max_requests: 64, max_bytes: 10485760 });
      },
      () => {},
      (body) => {
        body.registry = new TextDecoder().decode(registry.bytes);
        body.selection = new TextDecoder().decode(selected.bytes);
      },
    )
    : null;
  const binding = runtime ? await runtime.load() : null;
  const budget = binding ? new RuntimeReadBudget(binding.readLimits) : null;
  const fetcher = ((input: RequestInfo | URL) => {
    gets++;
    onFetch();
    const url = String(input);
    if (url.includes("reference_conversion")) referenceGets++;
    let body: string | Uint8Array<ArrayBuffer> | undefined = url.includes("/bucket/")
      ? '{"id":"synthetic-private","public":false,"file_size_limit":1048576}'
      : bodies.get(decodeURIComponent(url.split("/synthetic-private/")[1]));
    if (url.endsWith("/head.json") && runtime) {
      headGets++;
      body = active ? runtime.body.head : runtime.body.head.replace('"approved"', '"revoked"');
    }
    if (!body) throw new Error("Unexpected object");
    const r = new Response(body);
    Object.defineProperty(r, "url", { value: url });
    return Promise.resolve(r);
  }) as typeof fetch;
  const controls = binding
    ? new SupabaseRuntimeControls(binding, { nowUtc: () => now }, budget!, fetcher)
    : null;
  const client = new SupabaseArtifactClient({
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    secretKey: "sb_secret_SYNTHETIC",
    bucket: "synthetic-private",
    objectPrefix: "SYNTHETIC/",
    limits: {
      maxArtifactBytes: 1048576,
      maxBucketBytes: 1048576,
      maxMetadataBytes: 1024,
      requestTimeoutMs: 1000,
    },
  }, controls?.fetcher ?? fetcher);
  const selection = await NativeSourceSelection.prepare(client, registry, selected, mode);
  const expires = binding?.expiresAtUtc ?? now + 3600_000_000n;
  const data = new NativeDataProvider(selection, {
    heads: controls ?? {
      current: () =>
        Promise.resolve({
          status: active ? "approved" : "revoked",
          registrySha256: selection.registryHash,
          selectionSha256: selection.selectionHash,
          approvalReferenceSha256: "d".repeat(64),
          expiresAtUtc: expires,
        }),
    },
    clock: { nowUtc: () => now },
    approvalReferenceSha256: binding?.approvalReferenceSha256 ?? "d".repeat(64),
    expiresAtUtc: expires,
  });
  return {
    s,
    f,
    data,
    budget,
    headCount: () => headGets,
    getCount: () => gets,
    referenceCount: () => referenceGets,
    offerings: sources[1][2].offerings as NativeObject[],
    revoke: () => {
      active = false;
    },
    expire: () => {
      now = expires;
    },
  };
}
async function denied(work: Promise<unknown>, expected: string) {
  try {
    await work;
  } catch (e) {
    assert(e instanceof AccessError);
    equal(e.code, expected);
    return;
  }
  throw new Error("Expected failure");
}
Deno.test("selected reference registry reaches real NativeDataProvider and existing scoring service", async () => {
  const { f, data, getCount } = await fixture();
  const p = f.profile();
  (p.scores.inquiry as NativeObject[])[0].percentile = 31;
  (p.scores.inquiry as NativeObject[])[1].percentile = 17;
  const before = getCount(), pre = await data.preflight();
  equal(pre.production_ready, false);
  const r = await new UniversityScoringService(data).calculate(f.offering, p);
  equal(r.dto().converted_score, "31.00");
  equal(r.dto().reason_code, "reference_conversion_not_production_approved");
  assert(!r.ready);
  equal(getCount(), before + 2);
});
Deno.test("reference registry wrong scope rejected before any Storage fetch", async () => {
  let gets = 0;
  await denied(
    fixture((e) => {
      e[2].approval_scope = "SYNTHETIC_OTHER_SCOPE";
    }, () => {
      gets++;
    }),
    "artifact_not_approved",
  );
  equal(gets, 0);
});
Deno.test("reference registry engine promotion cannot use scoped path", async () => {
  let gets = 0;
  await denied(
    fixture((e) => {
      e[2].engine_approved = true;
    }, () => {
      gets++;
    }),
    "artifact_not_approved",
  );
  equal(gets, 0);
});
Deno.test("reference false flags never pass legacy production conversion validator", async () => {
  let gets = 0;
  await denied(
    fixture((e) => {
      e[2].kind = "conversion";
    }, () => {
      gets++;
    }),
    "artifact_not_approved",
  );
  equal(gets, 0);
});
Deno.test("reference selected raw SHA corruption remains a storage rejection", async () => {
  const f = await fixture((e) => {
    e[2].sha256 = "c".repeat(64);
  });
  await denied(f.data.getReference(String(f.f.offering.offering_id)), "storage_hash_mismatch");
});
Deno.test("reference decoded cache never survives revoked active source selection", async () => {
  const { f, data, revoke } = await fixture();
  assert(await data.getReference(String(f.offering.offering_id)));
  revoke();
  await denied(data.getReference(String(f.offering.offering_id)), "artifact_version_mismatch");
});
Deno.test("444 unrequested reference rules retain full metadata preflight but fetch only one requested body", async () => {
  const { f, data, referenceCount } = await fixture(() => {}, () => {}, 444, "university_only");
  equal(referenceCount(), 0);
  await data.preflight();
  equal(referenceCount(), 0);
  const p = f.profile();
  (p.scores.inquiry as NativeObject[])[0].percentile = 31;
  (p.scores.inquiry as NativeObject[])[1].percentile = 17;
  const scorer = new UniversityScoringService(data);
  equal((await scorer.calculate(f.offering, p)).dto().converted_score, "31.00");
  equal(referenceCount(), 1);
  equal((await scorer.calculate(f.offering, p)).dto().converted_score, "31.00");
  equal(referenceCount(), 1);
});
Deno.test("an unrequested reference with invalid approval still fails before first fetch", async () => {
  let gets = 0;
  await denied(
    fixture(
      (e) => {
        e[e.length - 1].independent_review_sha256 = null;
      },
      () => {
        gets++;
      },
      100,
      "university_only",
    ),
    "artifact_not_approved",
  );
  equal(gets, 0);
});
Deno.test("concrete runtime controls and shared physical budget keep one and 100 same-rule PK calculations bounded", async () => {
  const counts = [];
  for (const size of [1, 100]) {
    const f = await fixture(() => {}, () => {}, 0, "university_only", true, size);
    await f.data.preflight();
    equal(f.referenceCount(), 0);
    let packs = 0;
    const get = f.data.getExamPack.bind(f.data);
    f.data.getExamPack = (key) => {
      packs++;
      return get(key);
    };
    const p = f.f.profile();
    (p.scores.inquiry as NativeObject[])[0].percentile = 31;
    (p.scores.inquiry as NativeObject[])[1].percentile = 17;
    const runtimeData = runtimeAnalysisDataPort(
      { data: () => Promise.resolve(f.data) },
      (_stage, work) => work(),
    );
    const before = f.budget!.snapshot(),
      heads = f.headCount(),
      scorer = new UniversityScoringService(runtimeData);
    await scorer.batch(async () => {
      for (const offering of f.offerings) {
        equal((await scorer.calculate(offering, p)).dto().converted_score, "31.00");
      }
    });
    equal(packs, 1);
    equal(f.referenceCount(), 1);
    equal(f.headCount() - heads, 2);
    const after = f.budget!.snapshot();
    equal(after.physicalRequests - before.physicalRequests, 6);
    counts.push(after.physicalRequests - before.physicalRequests);
    // Runtime finish must still reread the concrete pinned head; the batch never caches controls.current().
    await f.data.assertCurrentSelection(true);
    equal(f.headCount() - heads, 3);
    assert(f.budget!.snapshot().requests <= 64);
  }
  equal(counts, [6, 6]);
});
Deno.test("concrete head revocation or expiry during a calculation batch prevents the subsequent report write", async () => {
  for (const mutate of ["revoke", "expire"] as const) {
    const f = await fixture(() => {}, () => {}, 0, "university_only", true),
      scorer = new UniversityScoringService(f.data);
    let writes = 0;
    const work = async () => {
      await scorer.batch(async () => {
        await scorer.calculate(f.f.offering, f.f.profile());
        f[mutate]();
      });
      writes++;
    };
    await denied(
      work(),
      mutate === "revoke" ? "security_policy_unavailable" : "security_policy_unavailable",
    );
    equal(writes, 0);
  }
});
Deno.test("a second calculation batch cannot enter while its initial current-head check is pending", async () => {
  const f = await fixture(), original = f.data.assertCurrentSelection.bind(f.data);
  let release!: () => void, entered = 0;
  const opening = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.data.assertCurrentSelection = async (required = false) => {
    await opening;
    await original(required);
  };
  const first = f.data.withScoringBatch(() => {
    entered++;
    return Promise.resolve();
  });
  await denied(
    f.data.withScoringBatch(() => {
      entered++;
      return Promise.resolve();
    }),
    "analysis_release_invalid",
  );
  release();
  await first;
  equal(entered, 1);
  f.data.assertCurrentSelection = original;
  await f.data.withScoringBatch(() => {
    entered++;
    return Promise.resolve();
  });
  equal(entered, 2);
});
