/** Build-time-only exact-032 composition recipe; never imports or activates a runtime. */
export const CURRENT_PUBLIC_COMPAT_BASE = "032a5647bc0b56e091eda279506aa534d559ea2f";
export const CURRENT_PUBLIC_COMPAT_INPUTS = {
  "supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts":
    "b757ad470d5a3d9cb44b8ad08203ca7d42359dd2657d9d91581674c639e6f557",
  "supabase/functions/jungsi-api/index.ts":
    "ef68f227b04705681d2f269babad5688bd3558dab33e3a889574b1b09b6321b2",
} as const;
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
