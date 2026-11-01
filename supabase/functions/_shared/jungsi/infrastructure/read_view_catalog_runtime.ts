/** Dependency-injected candidate catalog port. No dependency on coexisting source modules. */
import type { CatalogDataPort, CatalogService } from "../application/catalog.ts";
import type { ApiExecution } from "../application/api_dispatch.ts";
import type { RequestClockPort } from "../application/ports.ts";
import type { UniversityAnalysisDataPort } from "../application/university_analysis.ts";
import type { ApprovedRuntimeBinding, RuntimeEnvironment } from "./runtime_settings.ts";
import type { SupabaseSqlTransport } from "./transaction_sql.ts";
export interface ReadViewCatalogContext {
  binding(): Promise<ApprovedRuntimeBinding>;
  controls(): Promise<{ fetcher: typeof fetch }>;
}
export interface ReadViewCatalogService extends CatalogService {
  /** Request-local selection only; private reads remain in catalog() after access checks. */
  prepareSelection(request: ApiExecution): void;
  /** Keep unqualified current rows from reaching conversion, analysis or reference providers. */
  restrictAnalysisData(data: UniversityAnalysisDataPort): void;
}
export type ReadViewCatalogFactory = (
  data: CatalogDataPort,
  clock: RequestClockPort,
  sql: () => SupabaseSqlTransport,
  environment: RuntimeEnvironment,
  context: ReadViewCatalogContext,
) => ReadViewCatalogService;
