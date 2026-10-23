/** Additive internal Guide reference cases stay separate from the retained foundation suite. */
import "../../../tests/edge/test_guide_rule_reference.ts";
import * as retained from "./current_public_catalog_sql.ts";
import * as reference from "./jungsi/infrastructure/guide_metadata_sql.ts";

Deno.test("guide metadata permission SQL retains the reviewed provider recipe", () => {
  if (retained.CURRENT_PUBLIC_METADATA_SQL !== reference.CURRENT_PUBLIC_METADATA_SQL) {
    throw new Error("guide_metadata_recipe_drift");
  }
});
Deno.test("guide source and command guards retain the reviewed provider inventory", () => {
  if (
    JSON.stringify(retained.CURRENT_PUBLIC_SOURCE_VIEWS) !==
      JSON.stringify(reference.CURRENT_PUBLIC_SOURCE_VIEWS) ||
    JSON.stringify(retained.CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS) !==
      JSON.stringify(reference.CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS) ||
    retained.CURRENT_PUBLIC_GUIDE_COMMAND_SQL !== reference.CURRENT_PUBLIC_GUIDE_COMMAND_SQL
  ) throw new Error("guide_source_inventory_drift");
});
