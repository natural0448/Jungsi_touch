/** Concrete service graph with an injected native pool and transport. No server starts on import. */
import { AccessError } from "../application/access.ts";
import type {
  ApiBusinessPort,
  ApiOperationId,
  ApiRoutePolicy,
} from "../application/api_dispatch.ts";
import { API_OPERATION_IDS } from "../application/api_dispatch.ts";
import {
  CATALOG_OPERATIONS,
  type CatalogDataPort,
  CatalogService,
} from "../application/catalog.ts";
import type { OverallDataPort } from "../application/overall_analysis.ts";
import { FORECAST_OPERATIONS, ForecastPolicyService } from "../application/forecast_policy.ts";
import type { ForecastRepositoryPort } from "../application/forecast_ports.ts";
import type { PlatformRepositoryPort } from "../application/platform_repository.ts";
import { ProfileReportService } from "../application/profile_reports.ts";
import { PublicResponseProjection } from "../application/public_response.ts";
import { REPORT_ACTION_OPERATIONS, ReportActionService } from "../application/report_actions.ts";
import type { RequestClockPort } from "../application/ports.ts";
import {
  UNIVERSITY_ANALYSIS_OPERATIONS,
  type UniversityAnalysisDataPort,
  UniversityAnalysisService,
} from "../application/university_analysis.ts";
import { utcText } from "../domain/time.ts";
import { API_REQUEST_STAGES, type ApiRequestStage, createApiHandler } from "./api_http.ts";
import { RUNTIME_BUDGET_STAGES, type RuntimeBudgetStage } from "./runtime_budget.ts";
import { RelayBoundary, safeFailure } from "./auth_relay.ts";
import { SupabaseForecastAuthorities, SupabaseManagementResources } from "./management_postgres.ts";
import { NativeForecastInputs } from "./native_data_provider.ts";
import { PublicJeongsiPassesReader } from "./public_passes.ts";
import { NativeRuntimeRequest } from "./runtime_context.ts";
import {
  type BasicRuntimeSettings,
  readBasicRuntimeSettings,
  type RuntimeEnvironment,
} from "./runtime_settings.ts";
import { SupabaseNativeAuth } from "./supabase_auth.ts";
import { type NativeSqlPool, SupabaseSqlTransport } from "./transaction_sql.ts";
import { BoundVerifiedSessionProvider } from "./verified_session.ts";
export interface RuntimeRoutePolicy extends ApiRoutePolicy {
  readonly contract_ref: string;
}
const COMPOSITION_STAGES = [
  "entry",
  "runtime_settings",
  "runtime_pool",
  "readiness_schema",
  "readiness_data",
  "budget_initialize",
  "runtime_final_current",
  "platform_replay",
  "profile_store",
  "profile_after_store",
  "profile_read",
  "report_store",
  "report_after_store",
  "report_read",
  "report_access",
  "active_reports",
  "exam_provider",
  "total_model_provider",
  "catalog_provider",
  "conversion_provider",
  "percentile_provider",
  "analysis_provider",
  "complete",
] as const;
type ObservationStage = ApiRequestStage | RuntimeBudgetStage | typeof COMPOSITION_STAGES[number];
const OBSERVATION_STAGES = new Set<string>([
  ...API_REQUEST_STAGES,
  ...RUNTIME_BUDGET_STAGES,
  ...COMPOSITION_STAGES,
]);
export interface SafeRuntimeObservation {
  readonly operation: ApiOperationId | "health.ready" | null;
  readonly stage: ObservationStage;
  readonly status: number;
  readonly code: string | null;
  readonly request_id: string;
}
export interface RuntimeComposition {
  readonly environment: RuntimeEnvironment;
  readonly policies: readonly RuntimeRoutePolicy[];
  readonly responseSchemas: unknown;
  readonly createPool: (settings: BasicRuntimeSettings["database"]) => NativeSqlPool;
  readonly clock?: RequestClockPort;
  readonly fetcher?: typeof fetch;
  /** Receives exactly five safe fields; never request data or exception objects. */
  readonly observe?: (event: SafeRuntimeObservation) => void | Promise<void>;
}
function operation(policies: readonly ApiRoutePolicy[], request: Request): ApiOperationId | null {
  const pathname = new URL(request.url).pathname;
  const ordered = [...policies].sort((a, b) =>
    (a.path.match(/\{/g)?.length ?? 0) - (b.path.match(/\{/g)?.length ?? 0)
  );
  for (const policy of ordered) {
    if (policy.method !== request.method) continue;
    const pattern = policy.path.split("/").map((part) =>
      /^\{[a-z_]+\}$/.test(part) ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ).join("/");
    if (new RegExp("^" + pattern + "$", "u").test(pathname)) return policy.id;
  }
  return null;
}
export async function observeRuntimeResponse(
  observe: RuntimeComposition["observe"],
  response: Response,
  operationId: ApiOperationId | "health.ready" | null,
  stage: ObservationStage,
  fallbackId: string,
): Promise<Response> {
  if (!observe || response.status < 400 && response.status !== 201) return response;
  try {
    const headerId = response.headers.get("X-Request-ID");
    const requestId = headerId && /^[a-f0-9]{32}$/.test(headerId)
      ? headerId
      : typeof fallbackId === "string" && /^[a-f0-9]{32}$/.test(fallbackId)
      ? fallbackId
      : null;
    if (!requestId) return response;
    const safeOperation = operationId === "health.ready" ||
        API_OPERATION_IDS.includes(operationId as ApiOperationId)
      ? operationId
      : null;
    let code: string | null = null;
    if (response.status >= 400) {
      const body = await response.clone().json();
      const candidate =
        typeof body?.error?.code === "string" && /^[a-z][a-z0-9_]{1,79}$/.test(body.error.code)
          ? body.error.code
          : "backend_dependency_unavailable";
      if (
        response.status === 429 &&
        ["rate_limit_exceeded", "analysis_quota_exceeded"].includes(candidate)
      ) code = candidate;
      else {code =
          (await safeFailure(new AccessError(candidate, response.status), requestId).json()).error
            .code;}
    }
    const event: SafeRuntimeObservation = Object.freeze({
      operation: safeOperation,
      stage: OBSERVATION_STAGES.has(stage) ? stage : "entry",
      status: response.status,
      code,
      request_id: requestId,
    });
    // Do not await a sink, retry business work, or alter the response on sink failure.
    void Promise.resolve(observe(event)).catch(() => {});
  } catch { /* Public responses remain authoritative if observation itself fails. */ }
  return response;
}
export class NativeRuntimeApi {
  private readonly clock: RequestClockPort;
  private readonly fetcher: typeof fetch;
  private readonly projection: PublicResponseProjection;
  private readonly pools = new Map<string, SupabaseSqlTransport>();
  constructor(private readonly config: RuntimeComposition) {
    if (
      !config || typeof config.environment?.get !== "function" ||
      typeof config.createPool !== "function"
    ) throw new AccessError("security_policy_unavailable", 503);
    this.clock = config.clock ?? { nowUtc: () => BigInt(Date.now()) * 1000n };
    this.fetcher = config.fetcher ?? fetch;
    this.projection = new PublicResponseProjection(config.responseSchemas, config.policies);
  }
  readonly fetch = async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID().replaceAll("-", "");
    let stage: ObservationStage = "entry";
    let selectedOperation: ApiOperationId | "health.ready" | null = null;
    const mark = (next: ObservationStage) => {
      const before = stage;
      stage = next;
      return () => {
        stage = before;
      };
    };
    const phase = async <T>(next: ObservationStage, work: () => Promise<T>): Promise<T> => {
      const before = stage;
      stage = next;
      const value = await work();
      stage = before;
      return value;
    };
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/health/live" && request.method === "GET") {
        return Response.json({
          status: "alive",
          server_timezone: "UTC",
          now: utcText(this.clock.nowUtc()),
        }, { headers: { "Cache-Control": "no-store" } });
      }
      let basicValue: BasicRuntimeSettings | undefined;
      const basic = () => {
        if (!basicValue) {
          const before = stage;
          stage = "runtime_settings";
          basicValue = readBasicRuntimeSettings(this.config.environment);
          stage = before;
        }
        return basicValue;
      };
      const sql = () => {
        const settings = basic().database,
          key = JSON.stringify([settings.databaseUrl, settings.databaseCa]);
        let transport = this.pools.get(key);
        if (!transport) {
          const before = stage;
          stage = "runtime_pool";
          transport = new SupabaseSqlTransport(this.config.createPool(settings));
          stage = before;
          this.pools.set(key, transport);
        }
        return transport;
      };
      const relay = new RelayBoundary(this.config.environment.get("JUNGSI_RELAY_TOKEN") ?? null);
      selectedOperation = pathname === "/health/ready"
        ? "health.ready"
        : operation(this.config.policies, request);
      const context = new NativeRuntimeRequest(
        this.config.environment,
        basic,
        sql,
        this.clock,
        selectedOperation,
        this.fetcher,
      );
      if (pathname === "/health/ready" && request.method === "GET") {
        stage = "relay";
        await relay.verify(request.headers);
        stage = "readiness_schema";
        if (!await sql().probeUsageSchema()) {
          throw new AccessError("security_policy_unavailable", 503);
        }
        // Nil is a schema-only health probe, never a user session or administrator origin.
        await new PublicJeongsiPassesReader(sql()).readCurrent(
          "00000000-0000-0000-0000-000000000000",
          this.clock.nowUtc(),
        );
        stage = "readiness_data";
        await context.data();
        stage = "runtime_final_current";
        await context.assertCurrent();
        return Response.json({ status: "ready", server_timezone: "UTC" }, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      const platform: PlatformRepositoryPort = {
        replay: async (...a) =>
          await phase("platform_replay", async () => (await context.platform()).replay(...a)),
        createProfile: async (...a) => {
          const value = await phase(
            "profile_store",
            async () => (await context.platform()).createProfile(...a),
          );
          stage = "profile_after_store";
          return value;
        },
        getProfile: async (...a) =>
          await phase("profile_read", async () => (await context.platform()).getProfile(...a)),
        getReport: async (...a) =>
          await phase("report_read", async () => (await context.platform()).getReport(...a)),
        lookupAccess: async (...a) =>
          await phase("report_access", async () => (await context.platform()).lookupAccess(...a)),
        writeReport: async (...a) => {
          const value = await phase(
            "report_store",
            async () => (await context.platform()).writeReport(...a),
          );
          stage = "report_after_store";
          return value;
        },
        activeReports: async (...a) =>
          await phase("active_reports", async () => (await context.platform()).activeReports(...a)),
      };
      const data: UniversityAnalysisDataPort & OverallDataPort & CatalogDataPort = {
        getCatalog: async () =>
          await phase("catalog_provider", async () => (await context.data()).getCatalog()),
        getExamPack: async (...a) =>
          await phase("exam_provider", async () => (await context.data()).getExamPack(...a)),
        getTotalModel: async (...a) =>
          await phase(
            "total_model_provider",
            async () => (await context.data()).getTotalModel(...a),
          ),
        getConversion: async (...a) =>
          await phase(
            "conversion_provider",
            async () => (await context.data()).getConversion(...a),
          ),
        getPercentile: async (...a) =>
          await phase(
            "percentile_provider",
            async () => (await context.data()).getPercentile(...a),
          ),
        getAnalysis: async (...a) =>
          await phase("analysis_provider", async () => (await context.data()).getAnalysis(...a)),
      };
      const catalog = new CatalogService(data, this.clock);
      const authorities = {
        readCurrent: (subject: string, now: bigint) =>
          new SupabaseForecastAuthorities(sql()).readCurrent(subject, now),
      };
      const forecastRepository: ForecastRepositoryPort = {
        readCurrent: authorities.readCurrent,
        draftScope: async (...a) => (await context.forecasts()).draftScope(...a),
        get: async (...a) => (await context.forecasts()).get(...a),
        list: async (...a) => (await context.forecasts()).list(...a),
        published: async (...a) => (await context.forecasts()).published(...a),
        publishedMany: async (...a) => (await context.forecasts()).publishedMany(...a),
        transact: async (...a) => (await context.forecasts()).transact(...a),
      };
      const resources = {
        readScope: async (...a: Parameters<SupabaseManagementResources["readScope"]>) => {
          const binding = await context.binding();
          return new SupabaseManagementResources(sql(), catalog, {
            maxDraftBytes: binding.repositoryLimits.maxRecordBytes,
          }).readScope(...a);
        },
      };
      const forecasts = new ForecastPolicyService(
        forecastRepository,
        {
          inputs: async (...a) => new NativeForecastInputs(await context.data()).inputs(...a),
          policy: async (...a) => new NativeForecastInputs(await context.data()).policy(...a),
          currentContext: async (...a) =>
            new NativeForecastInputs(await context.data()).currentContext(...a),
        },
        resources,
        this.clock,
      );
      const profiles = new ProfileReportService(platform, data, this.clock);
      const actions = new ReportActionService(platform, catalog, this.clock);
      const universities = new UniversityAnalysisService(
        platform,
        catalog,
        data,
        this.clock,
        forecasts,
      );
      const business: ApiBusinessPort = {
        execute: async (r) => {
          if (CATALOG_OPERATIONS.some((id) => id === r.operation)) return await catalog.execute(r);
          if (REPORT_ACTION_OPERATIONS.some((id) => id === r.operation)) {
            return await actions.execute(r);
          }
          if (
            UNIVERSITY_ANALYSIS_OPERATIONS.some((id) => id === r.operation)
          ) return await universities.execute(r);
          if (FORECAST_OPERATIONS.some((id) => id === r.operation)) {
            return await forecasts.execute(r);
          }
          return await profiles.execute(r);
        },
      };
      const handler = createApiHandler(this.config.policies, {
        relay,
        clock: this.clock,
        projection: this.projection,
        reports: platform,
        authorities,
        resources,
        business,
        sessions: {
          verifyUserBearer: async (token, now) => {
            const auth = new SupabaseNativeAuth(basic().auth, this.fetcher);
            return await new BoundVerifiedSessionProvider(auth, auth).verifyUserBearer(token, now);
          },
        },
        passes: {
          readCurrent: (subject, now) =>
            new PublicJeongsiPassesReader(sql()).readCurrent(subject, now),
        },
        onStage: mark,
        budget: {
          run: async (r, work) => {
            const budget = await phase("budget_initialize", () => context.budget());
            return await budget.run(r, work, mark);
          },
        },
      });
      const response = await handler(request);
      if (response.ok) {
        stage = "runtime_final_current";
        await context.assertCurrent();
        stage = "complete";
      }
      return await observeRuntimeResponse(
        this.config.observe,
        response,
        selectedOperation,
        stage,
        requestId,
      );
    } catch (error) {
      return await observeRuntimeResponse(
        this.config.observe,
        safeFailure(error, requestId),
        selectedOperation,
        stage,
        requestId,
      );
    }
  };
  async close(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.close()));
  }
}
