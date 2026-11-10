// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Invented registry, selection and storage. Current-head authority is tested separately. */
import {
  NativeSourceSelection,
  type PinnedSourceBytes,
} from "../../supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts";
import {
  type StorageArtifactSettings,
  SupabaseArtifactClient,
} from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { NativeDataProvider } from "../../supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
const settings: StorageArtifactSettings = {
  projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
  secretKey: "sb_secret_SYNTHETIC",
  bucket: "synthetic-private",
  objectPrefix: "SYNTHETIC/",
  limits: {
    maxArtifactBytes: 4096,
    maxBucketBytes: 8192,
    maxMetadataBytes: 1024,
    requestTimeoutMs: 1000,
  },
};
const encode = new TextEncoder();
async function pin(text: string): Promise<PinnedSourceBytes> {
  const bytes = encode.encode(text),
    sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
  return { bytes, sha256, maxBytes: 16384 };
}
function response(url: string, body: string | Uint8Array): Response {
  const r = new Response(typeof body === "string" ? body : Uint8Array.from(body));
  Object.defineProperty(r, "url", { value: url });
  return r;
}
async function setup(
  mode: "all" | "catalog_only" | "university_only" = "university_only",
  choose = true,
  includeExam = false,
) {
  const tail = await pin('{"format":"SYNTHETIC-tail","version":"SYNTHETIC-v"}');
  const proof = await pin('{"format":"SYNTHETIC-proof","version":"SYNTHETIC-v"}');
  const exam = await pin('{"format":"SYNTHETIC-exam","version":"SYNTHETIC-v"}');
  const common = {
    bucket: settings.bucket,
    version: "SYNTHETIC-v",
    status: "approved_reference",
    approval_scope: "same_exam_mathematical_reference",
    engine_approved: false,
    production_allowed: false,
    archive_only: false,
    source_review_sha256: "a".repeat(64),
    independent_review_sha256: "b".repeat(64),
  };
  const tailEntry: NativeObject = {
    ...common,
    reference_context: {
      academic_year: 2027,
      exam_id: "exam",
      exam_type: "september_mock",
      model_version: "model",
      offering_ids: ["2027:1"],
      profile_sha256: "c".repeat(64),
      reference_curve_id: "curve",
      resolved_model_scenario: "base",
      rule_version: "rule",
      score_scale_id: "axis",
      source_pack_version: "pack",
      source_scenario_field_present: false,
      source_scenario_value: null,
      weight_encoding: "synthetic",
    },
    reference_evidence: Object.fromEntries(
      [
        "binder_sha256",
        "definition_sha256",
        "independent_sha256",
        "shared_proof_sha256",
        "source_cdf_sha256",
        "source_csv_sha256",
      ].map((k) => [k, "d".repeat(64)]),
    ),
    kind: "reference_tail",
    key: "SYNTHETIC-tail",
    object_key: "SYNTHETIC/tail.json",
    bytes: tail.bytes.length,
    sha256: tail.sha256,
  };
  const proofEntry: NativeObject = {
    ...common,
    kind: "reference_compatibility",
    key: "SYNTHETIC-proof",
    object_key: "SYNTHETIC/proof.json",
    bytes: proof.bytes.length,
    sha256: proof.sha256,
  };
  const examEntry: NativeObject = {
    bucket: settings.bucket,
    version: "SYNTHETIC-v",
    status: "approved",
    engine_approved: true,
    production_allowed: true,
    archive_only: false,
    kind: "exam_pack",
    key: "SYNTHETIC-exam",
    object_key: "SYNTHETIC/exam.json",
    bytes: exam.bytes.length,
    sha256: exam.sha256,
  };
  const registry = await pin(
    JSON.stringify({
      format: "jungsi.data-registry/v1",
      entries: includeExam ? [tailEntry, proofEntry, examEntry] : [tailEntry, proofEntry],
    }),
  );
  const required = choose
    ? [{ kind: "reference_tail", key: "SYNTHETIC-tail" }, {
      kind: "reference_compatibility",
      key: "SYNTHETIC-proof",
    }]
    : [{ kind: "reference_compatibility", key: "SYNTHETIC-proof" }];
  if (includeExam) required.push({ kind: "exam_pack", key: "SYNTHETIC-exam" });
  const selection = await pin(JSON.stringify({ format: "jungsi.runtime-selection/v1", required }));
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/bucket/")) {
      return response(url, '{"id":"synthetic-private","public":false,"file_size_limit":8192}');
    }
    if (url.includes("tail.json")) return response(url, tail.bytes);
    if (url.includes("proof.json")) return response(url, proof.bytes);
    if (url.includes("exam.json")) return response(url, exam.bytes);
    throw new Error("unexpected synthetic path");
  }) as typeof fetch;
  const client = new SupabaseArtifactClient(settings, fetcher),
    result = await NativeSourceSelection.prepare(client, registry, selection, mode);
  return { result, calls, tail, proof, exam, registry, selection, tailEntry };
}
async function denied(run: () => unknown, code: string) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
}
Deno.test("selected reference sources remain lazy and bind exact registry+selection", async () => {
  const f = await setup(), signal = new AbortController().signal;
  equal(f.result.referenceTailMetadata().length, 1);
  equal(f.result.referenceCompatibilityMetadata().length, 1);
  equal(f.calls.filter((x) => x.includes("object/authenticated")).length, 0);
  const tail = await f.result.loadReferenceTail("SYNTHETIC-tail", signal),
    proof = await f.result.loadReferenceCompatibility("SYNTHETIC-proof", signal);
  assert(tail !== null && proof !== null);
  equal([...tail.bytes], [...f.tail.bytes]);
  equal(proof.payload.format, "SYNTHETIC-proof");
  equal(f.result.registryHash, f.registry.sha256);
  equal(f.result.selectionHash, f.selection.sha256);
});
Deno.test("unselected reference tail cannot be read from the registry", async () => {
  const f = await setup("university_only", false);
  equal(f.result.referenceTailMetadata().length, 0);
  equal(await f.result.loadReferenceTail("SYNTHETIC-tail", new AbortController().signal), null);
});
Deno.test("catalog-only request does not load private tail or compatibility bodies", async () => {
  const f = await setup("catalog_only"), signal = new AbortController().signal;
  await denied(
    () => f.result.loadReferenceTail("SYNTHETIC-tail", signal),
    "runtime_dependency_not_loaded",
  );
  await denied(
    () => f.result.loadReferenceCompatibility("SYNTHETIC-proof", signal),
    "runtime_dependency_not_loaded",
  );
  equal(f.calls.filter((x) => x.includes("object/authenticated")).length, 0);
});
Deno.test("reference selection returns detached metadata rather than mutable originals", async () => {
  const f = await setup(), meta = f.result.referenceTailEntries();
  meta[0].entry.object_key = "SYNTHETIC/changed.json";
  const result = await f.result.loadReferenceTail("SYNTHETIC-tail", new AbortController().signal);
  assert(result !== null);
  equal([...result.bytes], [...f.tail.bytes]);
});

Deno.test("reference selection requires actual current head and rejects revocation", async () => {
  const f = await setup(), signal = new AbortController().signal, approval = "c".repeat(64);
  let revoked = false;
  const heads = {
    async current(s?: AbortSignal) {
      if (s?.aborted) throw new Error("aborted");
      return {
        status: revoked ? "revoked" : "approved",
        registrySha256: f.result.registryHash,
        selectionSha256: f.result.selectionHash,
        approvalReferenceSha256: approval,
        expiresAtUtc: 9000n,
      };
    },
  };
  const data = new NativeDataProvider(f.result, {
    heads,
    clock: { nowUtc: () => 1000n },
    approvalReferenceSha256: approval,
    expiresAtUtc: 9000n,
  });
  const selected = await data.referenceSelection(signal);
  equal(selected.tails.length, 1);
  equal(selected.compatibilities.length, 1);
  equal(selected.selectionSha256, f.selection.sha256);
  assert((await data.loadReferenceTail("SYNTHETIC-tail", signal)) !== null);
  revoked = true;
  await denied(() => data.referenceSelection(signal), "artifact_version_mismatch");
  await denied(() => data.loadReferenceTail("SYNTHETIC-tail", signal), "artifact_version_mismatch");
});
Deno.test("reference source is closed without freshness authority or after cancellation", async () => {
  const f = await setup(),
    controller = new AbortController(),
    data = new NativeDataProvider(f.result);
  await denied(() => data.referenceSelection(controller.signal), "artifact_not_approved");
  await denied(
    () => data.loadReferenceTail("SYNTHETIC-tail", controller.signal),
    "artifact_not_approved",
  );
  controller.abort();
  await denied(() => data.referenceSelection(controller.signal), "artifact_not_approved");
});

Deno.test("current selected exam pin binds verified bytes and rejects stale head", async () => {
  const f = await setup("university_only", true, true),
    signal = new AbortController().signal,
    approval = "c".repeat(64);
  let revoked = false;
  const heads = {
    async current() {
      return {
        status: revoked ? "revoked" : "approved",
        registrySha256: f.result.registryHash,
        selectionSha256: f.result.selectionHash,
        approvalReferenceSha256: approval,
        expiresAtUtc: 9000n,
      };
    },
  };
  const data = new NativeDataProvider(f.result, {
    heads,
    clock: { nowUtc: () => 1000n },
    approvalReferenceSha256: approval,
    expiresAtUtc: 9000n,
  });
  const selected = await data.referenceExamPin("SYNTHETIC-exam", signal);
  assert(selected !== null);
  equal(selected.sha256, f.exam.sha256);
  equal(selected.version, "SYNTHETIC-v");
  equal(await data.referenceExamPin("SYNTHETIC-unselected", signal), null);
  revoked = true;
  await denied(() => data.referenceExamPin("SYNTHETIC-exam", signal), "artifact_version_mismatch");
});
