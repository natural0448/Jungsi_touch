/** Explicit member-json22 candidate entry; same existing function target, no deployment performed. */
import routeCatalog from "../../../src/jungsi_touch/application/route_catalog.json" with {
  type: "json",
};
import responseSchemas from "../../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import {
  NativeRuntimeApi,
  type RuntimeRoutePolicy,
} from "../_shared/jungsi/infrastructure/runtime_composition.ts";
import { createSupabaseApiIngress } from "../_shared/jungsi/infrastructure/supabase_api_ingress.ts";
import { publishedReferenceFactory } from "../_shared/jungsi/infrastructure/published_reference_runtime.ts";
import { createNativePostgresPool } from "./postgres_pool.ts";
import { createMemberShortlistCatalogService } from "../_shared/combined_policy_catalog_runtime.ts";
import { currentPublicResponseSchemas } from "../_shared/current_public_catalog.ts";
import {
  memberShortlistPolicies,
  memberShortlistResponseSchemas,
} from "../_shared/jungsi/application/member_shortlist_schema.ts";
const runtime = new NativeRuntimeApi({
  referenceFactory: publishedReferenceFactory,
  readViewExtensions: true,
  memberShortlistExtensions: true,
  candidateCatalog: createMemberShortlistCatalogService,
  environment: { get: (name) => Deno.env.get(name) },
  policies: memberShortlistPolicies(
    routeCatalog.operations as readonly RuntimeRoutePolicy[],
  ) as readonly RuntimeRoutePolicy[],
  responseSchemas: memberShortlistResponseSchemas(currentPublicResponseSchemas(responseSchemas)),
  createPool: createNativePostgresPool,
  observe: (event) => console.info(JSON.stringify(event)),
});
Deno.serve(createSupabaseApiIngress(runtime.fetch));
