/** Dependency-injected candidate catalog port. No dependency on coexisting source modules. */
import type { CatalogDataPort, CatalogService } from "../application/catalog.ts";
import type { RequestClockPort } from "../application/ports.ts";
import type { ApprovedRuntimeBinding, RuntimeEnvironment } from "./runtime_settings.ts";
import type { SupabaseSqlTransport } from "./transaction_sql.ts";
export interface ReadViewCatalogContext {
  binding(): Promise<ApprovedRuntimeBinding>;
  controls(): Promise<{ fetcher: typeof fetch }>;
}
export type ReadViewCatalogFactory = (
  data: CatalogDataPort,
  clock: RequestClockPort,
  sql: () => SupabaseSqlTransport,
  environment: RuntimeEnvironment,
  context: ReadViewCatalogContext,
) => CatalogService;
