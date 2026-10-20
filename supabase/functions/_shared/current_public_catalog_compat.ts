/** Build-time-only exact-032 composition recipe; never imports or activates a runtime. */
export const CURRENT_PUBLIC_COMPAT_BASE = "032a5647bc0b56e091eda279506aa534d559ea2f";
export const CURRENT_PUBLIC_COMPAT_INPUTS = {
  "supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts":
    "b757ad470d5a3d9cb44b8ad08203ca7d42359dd2657d9d91581674c639e6f557",
  "supabase/functions/jungsi-api/index.ts":
    "ef68f227b04705681d2f269babad5688bd3558dab33e3a889574b1b09b6321b2",
} as const;
export const TOTAL_MODEL_V2_COMPAT_INPUTS = {
  "supabase/functions/_shared/jungsi/domain/exam_pack.ts":
    "1f168890ca9c22ac4f9939162b6af495ee8b2f1f418a4efb5864d8f7317c1dca",
  "supabase/functions/_shared/jungsi/application/overall_analysis.ts":
    "a6e02c9df28a225c232e8a55730312cf4c5a717365155f8b36220a8775dba459",
  "supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts":
    "55d886f7227699cd4141a16012c8d400dfa6faf32787c25fa71d0ee0bf78cbc5",
} as const;
/** This is the only additional domain source; its five imports already exist in exact032. */
export const TOTAL_MODEL_V2_COMPAT_NEW_SOURCE =
  "supabase/functions/_shared/jungsi/domain/all_examinees_total_model.ts";
async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function once(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2) {
    throw new Error("installed032_patch_anchor_drift");
  }
  return source.replace(from, () => to);
}
export async function patchInstalled032CatalogSources(
  baseCommit: string,
  inputs: Readonly<Record<string, Uint8Array>>,
): Promise<Readonly<Record<string, Uint8Array>>> {
  if (
    baseCommit !== CURRENT_PUBLIC_COMPAT_BASE ||
    Object.keys(inputs).length !== 2
  ) throw new Error("installed032_base_mismatch");
  const text: Record<string, string> = {};
  for (const [path, sha] of Object.entries(CURRENT_PUBLIC_COMPAT_INPUTS)) {
    const b = inputs[path];
    if (!(b instanceof Uint8Array) || await digest(b) !== sha) {
      throw new Error("installed032_source_hash_mismatch");
    }
    text[path] = new TextDecoder("utf-8", { fatal: true }).decode(b);
  }
  const composition = "supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts",
    entry = "supabase/functions/jungsi-api/index.ts";
  text[composition] =
    'import { createCurrentPublicCatalogService } from "../../current_public_catalog_runtime.ts";\n' +
    text[composition];
  text[composition] = once(
    text[composition],
    "const catalog = new CatalogService(data, this.clock);",
    "const catalog = createCurrentPublicCatalogService(data, this.clock, sql, this.config.environment, context);\n      catalog.restrictAnalysisData(data);",
  );
  text[composition] = once(
    text[composition],
    ") return await universities.execute(r);",
    ') {\n            if (r.operation === "university.analyze") await catalog.prepareSelection(r);\n            return await universities.execute(r);\n          }',
  );
  text[composition] = once(
    text[composition],
    "return await actions.execute(r);",
    'if (r.operation === "shortlist.update") await catalog.prepareSelection(r);\n            return await actions.execute(r);',
  );
  text[entry] =
    'import { currentPublicResponseSchemas } from "../_shared/current_public_catalog.ts";\n' +
    text[entry];
  text[entry] = once(
    text[entry],
    "  responseSchemas,\n",
    "  responseSchemas: currentPublicResponseSchemas(responseSchemas),\n",
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(text).map((
        [path, value],
      ) => [path, new TextEncoder().encode(value)]),
    ),
  );
}

/** Patch only the v2 dispatch/getter. Retain exact032 validators, input rights and usage-v1. */
export async function patchInstalled032TotalModelSources(
  baseCommit: string,
  inputs: Readonly<Record<string, Uint8Array>>,
): Promise<Readonly<Record<string, Uint8Array>>> {
  if (baseCommit !== CURRENT_PUBLIC_COMPAT_BASE || Object.keys(inputs).length !== 3) {
    throw new Error("installed032_base_mismatch");
  }
  const text: Record<string, string> = {};
  for (const [path, sha] of Object.entries(TOTAL_MODEL_V2_COMPAT_INPUTS)) {
    const b = inputs[path];
    if (!(b instanceof Uint8Array) || await digest(b) !== sha) {
      throw new Error("installed032_source_hash_mismatch");
    }
    text[path] = new TextDecoder("utf-8", { fatal: true }).decode(b);
  }
  const pack = "supabase/functions/_shared/jungsi/domain/exam_pack.ts",
    overall = "supabase/functions/_shared/jungsi/application/overall_analysis.ts",
    provider = "supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts";
  text[pack] = once(
    text[pack],
    "  populationBounds():",
    `  officialParticipantTotal(): bigint {
    return integer(row(this.data.participants).total, 1n);
  }
  populationBounds():`,
  );
  text[overall] =
    'import { ALL_EXAMINEES_POPULATION_ID, NativeAllExamineesTotalModel } from "../domain/all_examinees_total_model.ts";\n' +
    text[overall];
  text[overall] = once(
    text[overall],
    "readonly model: NativeExamTotalModel;",
    "readonly model: NativeExamTotalModel | NativeAllExamineesTotalModel;",
  );
  text[overall] = once(
    text[overall],
    "function pending(reason: string): ExamRow {",
    "function pending(reason: string, population = OVERALL_POPULATION_ID): ExamRow {",
  );
  text[overall] = once(
    text[overall],
    "population_id: OVERALL_POPULATION_ID,",
    "population_id: population,",
  );
  text[overall] = once(
    text[overall],
    "if (!binding || !(binding.model instanceof NativeExamTotalModel)) {",
    "if (!binding || !(binding.model instanceof NativeExamTotalModel || binding.model instanceof NativeAllExamineesTotalModel)) {",
  );
  text[overall] = once(
    text[overall],
    '    ) return pending("model_version_mismatch");',
    '    ) return pending("model_version_mismatch", population);',
  );
  text[overall] = once(
    text[overall],
    '    if (binding.model.metadata.status !== "approved") return pending("total_model_not_approved");',
    '    if (binding.model.metadata.status !== "approved") return pending("total_model_not_approved", population);',
  );
  text[overall] = once(
    text[overall],
    '    if (\n      typeof binding.distributionId !== "string"',
    '    const population = binding.model instanceof NativeAllExamineesTotalModel ? ALL_EXAMINEES_POPULATION_ID : OVERALL_POPULATION_ID;\n    if (\n      typeof binding.distributionId !== "string"',
  );
  text[overall] = once(
    text[overall],
    'e instanceof ContractError && allowed.includes(e.code) ? e.code : "total_model_invalid",',
    'e instanceof ContractError && allowed.includes(e.code) ? e.code : "total_model_invalid",\n        population,',
  );
  text[provider] =
    'import { NativeAllExamineesTotalModel } from "../domain/all_examinees_total_model.ts";\n' +
    text[provider];
  text[provider] = once(
    text[provider],
    "const model = new NativeExamTotalModel(raw);",
    `const model = raw.format === "jungsi.exam-total-model/v2"
            ? new NativeAllExamineesTotalModel(raw)
            : raw.format === "jungsi.exam-total-model/v1"
            ? new NativeExamTotalModel(raw)
            : fail("model_unverified");`,
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(text).map(([path, value]) => [path, new TextEncoder().encode(value)]),
    ),
  );
}

/** Add explicit request payload scopes after the exact v2 patch; all original guards remain. */
export const PAYLOAD_SCOPE_COMPAT_INPUTS = {
  "supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts":
    "bc8e80d2875eccf710f32f3e6efbb21bfa0b1d29eb685b7631fc012d87054418",
  "supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts":
    "0dec28a66dcaa6cb83ab7260e390450f08dd7bc15125f994cb47c2c7106f62ce",
  "supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts":
    "dc7484cb340b74449b99d133781ab19205a353cc764612c0b2291fece4afb8ee",
  "supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts":
    "85c7b534cfbdd928bfedbcfa76ac1eb3e82bb83f0f21d97b20c4e0568ee798f9",
} as const;
export async function patchInstalled032PayloadScopeSources(
  baseCommit: string,
  inputs: Readonly<Record<string, Uint8Array>>,
): Promise<Readonly<Record<string, Uint8Array>>> {
  if (baseCommit !== CURRENT_PUBLIC_COMPAT_BASE || Object.keys(inputs).length !== 4) {
    throw new Error("installed032_base_mismatch");
  }
  const text: Record<string, string> = {};
  for (const [path, sha] of Object.entries(PAYLOAD_SCOPE_COMPAT_INPUTS)) {
    const b = inputs[path];
    if (!(b instanceof Uint8Array) || await digest(b) !== sha) {
      throw new Error("installed032_source_hash_mismatch");
    }
    text[path] = new TextDecoder("utf-8", { fatal: true }).decode(b);
  }
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "export interface PinnedSourceBytes {",
    'export type NativePayloadMode = "all" | "catalog_only" | "overall_only";\nexport interface PinnedSourceBytes {',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "  private readonly artifacts: ReadonlyMap<string, SelectedNativeArtifact>;",
    "  private readonly artifacts: ReadonlyMap<string, SelectedNativeArtifact>;\n  private readonly references: ReadonlyMap<string, NativeObject>;",
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "    readonly selectionHash: string,\n  ) {",
    "    readonly selectionHash: string,\n    selected: ReadonlyMap<string, NativeObject>,\n    readonly payloadMode: NativePayloadMode,\n  ) {\n    this.references = new Map([...selected].map(([id, entry]) => [id, cloneNativeJson(entry)]));",
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    '    selectionSource: PinnedSourceBytes,\n  ): Promise<NativeSourceSelection> {\n    if (!(client instanceof SupabaseArtifactClient)) fail("storage_configuration_invalid");',
    '    selectionSource: PinnedSourceBytes,\n    payloadMode: NativePayloadMode = "all",\n  ): Promise<NativeSourceSelection> {\n    if (!(client instanceof SupabaseArtifactClient) || !["all", "catalog_only", "overall_only"].includes(payloadMode)) fail("storage_configuration_invalid");',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "      client.validateSelectedReference(entry);\n      chosen.set(id, entry);",
    '      client.validateSelectedReference(entry);\n      if (entry.source_timezone != null && typeof entry.source_timezone !== "string") fail("artifact_time_invalid");\n      chosen.set(id, entry);',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "    const artifacts = new Map<string, SelectedNativeArtifact>();",
    '    const loads = (kind: unknown) => payloadMode === "all" || (payloadMode === "catalog_only" ? kind === "catalog" : kind === "exam_pack" || kind === "total_model");\n    if (payloadMode !== "all" && [...chosen.values()].some(e => !loads(e.kind))) await client.assertSelectedMetadata([...chosen.values()]);\n    const artifacts = new Map<string, SelectedNativeArtifact>();',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "    for (const [id, entry] of chosen) {\n      const verified",
    "    for (const [id, entry] of chosen) {\n      if (!loads(entry.kind)) continue;\n      const verified",
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "return new NativeSourceSelection(artifacts, registry.hash, selection.hash);",
    "return new NativeSourceSelection(artifacts, registry.hash, selection.hash, chosen, payloadMode);",
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "  load(kind: NativeRuntimeKind, key: string): SelectedNativeArtifact | null {\n    const row = this.artifacts.get(identity(kind, key));",
    '  reference(kind: NativeRuntimeKind, key: string): NativeObject | null {\n    const entry = this.references.get(identity(kind, key));\n    return entry ? cloneNativeJson(entry) : null;\n  }\n  load(kind: NativeRuntimeKind, key: string): SelectedNativeArtifact | null {\n    const id = identity(kind, key), row = this.artifacts.get(id);\n    if (!row && this.references.has(id)) fail("runtime_dependency_not_loaded");',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    "      artifacts: [...this.artifacts.values()]",
    '      ...(this.payloadMode === "all" ? {} : {payload_mode: this.payloadMode, metadata_status: "validated_all_selected_references", selected_metadata_count: this.references.size, loaded_payload_count: this.artifacts.size, deferred_payload_count: this.references.size - this.artifacts.size}),\n      artifacts: [...this.artifacts.values()]',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts"],
    "  async artifact(raw: Readonly<NativeObject>)",
    '  /** One fresh metadata response checks every selected reference, including deferred bodies. */\n  async assertSelectedMetadata(entries: readonly Readonly<NativeObject>[]): Promise<void> {\n    if (!entries.length) fail("storage_reference_invalid");\n    let maximum = 0;\n    for (const entry of entries) {\n      this.validateSelectedReference(entry);\n      maximum = Math.max(maximum, Number(entry.bytes));\n    }\n    const bytes = maximum;\n    const bucket = parsed(\n      await this.get(\n        "bucket/" + encodeURIComponent(this.settings.bucket),\n        this.settings.limits.maxMetadataBytes,\n      ),\n    );\n    if (bucket.id !== this.settings.bucket || bucket.public !== false) {\n      fail("storage_bucket_not_private");\n    }\n    const cap = bucket.file_size_limit;\n    if (!positiveInteger(cap) || cap > this.settings.limits.maxBucketBytes || cap < bytes) {\n      fail("storage_bucket_limit_unverified");\n    }\n\n  }\n  async artifact(raw: Readonly<NativeObject>)',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    "import { CatalogService }",
    "import { CATALOG_OPERATIONS, CatalogService }",
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    "      this.assertArtifactScope(selection, binding);",
    "      this.assertArtifactScope(selection, binding);\n      const catalogOnly = CATALOG_OPERATIONS.some(id => id === this.operation);",
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    "          maxBytes: binding.references.selection.bytes,\n        },\n      );",
    '          maxBytes: binding.references.selection.bytes,\n        },\n        catalogOnly ? "catalog_only" : this.operation === "overall.analyze" ? "overall_only" : "all",\n      );',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    "      for (const exam of policy.exams.values()) {",
    '      for (const exam of policy.exams.values()) {\n        if (catalogOnly) {\n          const reference = snapshot.reference("exam_pack", exam.examId);\n          if (\n            !reference || reference.version !== exam.packVersion ||\n            Object.hasOwn(reference, "academic_year") &&\n              reference.academic_year !== exam.academicYear\n          ) fail();\n          continue;\n        }\n',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    "      const catalog = await this.getCatalog();\n      const offerings =",
    '      const overallOnly = this.selection.payloadMode === "overall_only";\n      if (overallOnly && identities.some(({kind}) => !["exam_pack", "total_model"].includes(kind))) fail("artifact_not_approved");\n      const catalog = overallOnly ? null : await this.getCatalog();\n      if (this.selection.payloadMode === "catalog_only") {\n        if (identities.some(({ kind, key }) => kind !== "catalog" || key !== "service")) {\n          fail("artifact_not_approved");\n        }\n        await this.assertCurrentSelection(true);\n        return Object.freeze({\n          format: "jungsi.native-provider-preflight/v1",\n          status: "verified_catalog_payload",\n          registry_sha256: this.selection.registryHash,\n          selection_sha256: this.selection.selectionHash,\n          approval_reference_sha256: this.freshness!.approvalReferenceSha256,\n          artifacts: identities.length,\n          verification_scope: "catalog_payload_and_all_selected_reference_metadata",\n          source_selection: this.selection.privateReceipt(),\n          optional_missing: catalog\n            ? []\n            : [{ kind: "catalog", key: "service", reason_code: "catalog_not_selected" }],\n          production_ready: false,\n          native_acceptance: "NOT_VERIFIED_BY_SOURCE_PREFLIGHT",\n        });\n      }\n      const offerings =',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    '        status: "verified_selected_release_graph",',
    '        status: overallOnly ? "verified_overall_payloads" : "verified_selected_release_graph",',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    '        verification_scope: "selected_native_envelopes_and_release_bindings",',
    '        verification_scope: overallOnly ? "exam_model_payloads_and_all_selected_reference_metadata" : "selected_native_envelopes_and_release_bindings",\n        ...(overallOnly ? {source_selection:this.selection.privateReceipt()} : {}),',
  );
  // Match the directly approved three-operation scope on the exact guarded032 inputs.
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    'export type NativePayloadMode = "all" | "catalog_only" | "overall_only";',
    'export type NativePayloadMode = "all" | "catalog_only" | "overall_only" | "university_only";',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    '["all", "catalog_only", "overall_only"].includes(payloadMode)',
    '["all", "catalog_only", "overall_only", "university_only"].includes(payloadMode)',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_source_selection.ts"],
    'const loads = (kind: unknown) => payloadMode === "all" || (payloadMode === "catalog_only" ? kind === "catalog" : kind === "exam_pack" || kind === "total_model");',
    'const loads = (kind: unknown) => payloadMode === "all" || (payloadMode === "catalog_only" ? kind === "catalog" : payloadMode === "university_only" ? kind !== "total_model" : kind === "exam_pack" || kind === "total_model");',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    'import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";',
    'import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";\nimport { NativeExamPack } from "../domain/exam_pack.ts";',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    "const catalogOnly = CATALOG_OPERATIONS.some(id => id === this.operation);",
    'const catalogOnly = CATALOG_OPERATIONS.some(id => id === this.operation);\n      const universityOnly = ["university.analyze", "candidates.build"].some(id => id === this.operation);',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    'catalogOnly ? "catalog_only" : this.operation === "overall.analyze" ? "overall_only" : "all",',
    'catalogOnly ? "catalog_only" : universityOnly ? "university_only" : this.operation === "overall.analyze" || this.operation === "score-profile.create" ? "overall_only" : "all",',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts"],
    "        const pack = await data.getExamPack(exam.examId);",
    '        if (universityOnly) {\n          const raw = snapshot.load("exam_pack", exam.examId);\n          const pack = raw ? new NativeExamPack(raw.payload) : null;\n          if (!pack || pack.packVersion !== exam.packVersion || pack.academicYear !== exam.academicYear) fail();\n          if (this.operation === "candidates.build") {\n            const catalog = snapshot.load("catalog", "service")?.payload;\n            if (!catalog || !Array.isArray(catalog.offerings) || BigInt(catalog.offerings.filter(row => row !== null && typeof row === "object" && !Array.isArray(row) && !(row instanceof JsonFloat) && row.practical_required === false && row.academic_year === exam.academicYear).length) !== exam.eligibleOfferingCount) fail();\n          }\n          continue;\n        }\n        const pack = await data.getExamPack(exam.examId);',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    'const overallOnly = this.selection.payloadMode === "overall_only";',
    'const overallOnly = this.selection.payloadMode === "overall_only";\n      const universityOnly = this.selection.payloadMode === "university_only";',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    '          case "exam_pack":\n            await this.getExamPack(key);',
    '          case "exam_pack":\n            if (universityOnly) {\n              const pack = new NativeExamPack(raw);\n              if (pack.examId !== key) fail("artifact_exam_mismatch");\n            } else await this.getExamPack(key);',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    '          const modelKey = key + ":" + text(pack.pack_version);',
    '          const modelKey = key + ":" + text(pack.pack_version);\n          if (universityOnly && this.selection.reference("total_model", modelKey)) continue;',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    'status: overallOnly ? "verified_overall_payloads" : "verified_selected_release_graph",',
    'status: overallOnly ? "verified_overall_payloads" : universityOnly ? "verified_university_payloads" : "verified_selected_release_graph",',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    'verification_scope: overallOnly ? "exam_model_payloads_and_all_selected_reference_metadata" : "selected_native_envelopes_and_release_bindings",',
    'verification_scope: overallOnly ? "exam_model_payloads_and_all_selected_reference_metadata" : universityOnly ? "university_payloads_and_all_selected_reference_metadata" : "selected_native_envelopes_and_release_bindings",',
  );
  text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"] = once(
    text["supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts"],
    "...(overallOnly ? {source_selection:this.selection.privateReceipt()} : {}),",
    "...(overallOnly || universityOnly ? {source_selection:this.selection.privateReceipt()} : {}),",
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(text).map(([path, value]) => [path, new TextEncoder().encode(value)]),
    ),
  );
}
