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
