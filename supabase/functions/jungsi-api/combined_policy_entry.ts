/** Explicit combined-policy20 candidate entry; same existing function target, no deployment performed. */
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
import { createCombinedPolicyCatalogService } from "../_shared/combined_policy_catalog_runtime.ts";
import { currentPublicResponseSchemas } from "../_shared/current_public_catalog.ts";
const runtime = new NativeRuntimeApi({
  referenceFactory: publishedReferenceFactory,
  readViewExtensions: true,
  candidateCatalog: createCombinedPolicyCatalogService,
  environment: { get: (name) => Deno.env.get(name) },
  policies: routeCatalog.operations as readonly RuntimeRoutePolicy[],
  responseSchemas: currentPublicResponseSchemas(responseSchemas),
  createPool: createNativePostgresPool,
  observe: (event) => console.info(JSON.stringify(event)),
  observeTiming: (event) => console.info(JSON.stringify(event)),
});
Deno.serve(createSupabaseApiIngress(runtime.fetch));
