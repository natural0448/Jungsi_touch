/** Separate professional candidate. Existing project, auth and native app-role pool only. */
import responseSchemas from "../../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import { NativeProfessionalRuntime } from "../_shared/jungsi/infrastructure/professional_runtime.ts";
import { createNativePostgresPool } from "../jungsi-api/postgres_pool.ts";
const runtime = new NativeProfessionalRuntime({
  environment: { get: (name) => Deno.env.get(name) },
  responseSchemas,
  createPool: createNativePostgresPool,
});
Deno.serve(runtime.fetch);
