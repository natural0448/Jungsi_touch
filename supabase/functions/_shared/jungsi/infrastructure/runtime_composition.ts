import {
  assertAdmissionMicros,
  issueAdmissionPermit,
} from "../application/service_end_admission.ts";
/** Concrete service graph with an injected native pool and transport. No server starts on import. */
import { SearchFailureCorrelation } from "./search503_correlation.ts";
import {
  handlePersonalOwnerReferenceBatch,
  type OwnedStudentReferenceBatchPorts as PersonalOwnerReferenceBatchPorts,
} from "../application/personal_owner_reference_batch_handler_candidate.ts";
import {
  PersonalOwnerPublishedCacheEvidence,
  type PersonalPublishedCacheAuthority,
} from "./personal_owner_published_cache_evidence_candidate.v3.ts";
import {
  PersonalOwnerNamedR2Reader,
  type PrivateR2Bucket,
} from "./personal_owner_named_cache_r2_read_candidate.ts";
import type { BoundTailInputs } from "./current_tail_cache_evidence_candidate.v3.ts";
import {
  type BoundHistoricalRuntimeInputs,
  JoinedHistoricalBatchEvidence,
} from "./joined_historical_batch_evidence_candidate.v5.ts";
import {
  BoundedStudentReferenceBatchProvider,
  type StudentReferenceProviderInputs,
} from "./student_reference_batch_provider_candidate.ts";
import { AccessError } from "../application/access.ts";
import { REFERENCE_DURABLE_FENCE_IMPLEMENTED } from "../application/reference_quiescence_fence.review-only.ts";
import type {
  ApiBusinessPort,
  ApiExecution,
  ApiExecutionBoundary,
  ApiOperationId,
  ApiRoutePolicy,
} from "../application/api_dispatch.ts";
import { REGISTERED_API_OPERATION_IDS } from "../application/api_dispatch.ts";
import { CURRENT_PAGE_OPERATION_ID } from "../application/api_dispatch.ts";
import { isCurrentPagePolicy } from "../application/api_dispatch.ts";
import {
  isStudentReferencePolicy,
  STUDENT_REFERENCE_OPERATION_ID,
} from "../application/api_dispatch.ts";
import {
  handleOwnedStudentReferenceBatch,
  type OwnedStudentReferenceBatchPorts,
} from "../application/owned_student_reference_batch_handler_candidate.ts";
import {
  type CurrentPageExecution,
  type CurrentPageLimits,
  type CurrentPagePorts,
  HistoryCurrentPageService,
} from "../application/history_current_page.ts";
import { READ_VIEW_OPERATION_IDS } from "../application/api_dispatch.ts";
import { MEMBER_SHORTLIST_OPERATION_IDS } from "../application/api_dispatch.ts";
import { legacyReadViewRegistration } from "../application/member_shortlist_schema.ts";
import {
  CATALOG_OPERATIONS,
  type CatalogDataPort,
  CatalogService,
} from "../application/catalog.ts";
import type { OverallDataPort } from "../application/overall_analysis.ts";
import { FORECAST_OPERATIONS, ForecastPolicyService } from "../application/forecast_policy.ts";
import type { ForecastRepositoryPort } from "../application/forecast_ports.ts";
import type { PlatformRepositoryPort } from "../application/platform_repository.ts";
import type { PreparedUsageAdmission } from "../application/usage_service.ts";
import { isCommittedScoreRejection } from "./score_input_postgres.ts";
import { ScoreInputService } from "../application/score_input_service.ts";
import { attachSavedPageScores } from "../application/attach_saved_scores.ts";
import { readSavedCandidateGroups } from "../application/member_saved_candidate_groups.ts";
import { scoreMapPin } from "../application/score_map.ts";
import { readSavedScoreMap, SavedScoreTransientUnavailable } from "./member_score_map_read.ts";
import { SCORE_POLICY_OPERATION_IDS } from "../application/api_dispatch.ts";
import type { ScoreInputWorkflowPort } from "../application/score_input_ports.ts";
import { resultObject } from "../application/paid_result_components.ts";
import { requirePaidSession, sessionDto } from "../application/session_service.ts";
import { ProfileReportService } from "../application/profile_reports.ts";
import { PublicResponseProjection } from "../application/public_response.ts";
import { REPORT_ACTION_OPERATIONS, ReportActionService } from "../application/report_actions.ts";
import type { RequestClockPort } from "../application/ports.ts";
import {
  type MemberSchoolResultsWriterPort,
  UNIVERSITY_ANALYSIS_OPERATIONS,
  type UniversityAnalysisDataPort,
  UniversityAnalysisService,
} from "../application/university_analysis.ts";
import { projectMemberSchoolResultBatches } from "../application/member_school_results.ts";
import { MemberSchoolResultsStorage } from "./member_school_results_storage.ts";
import { utcText } from "../domain/time.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import {
  API_REQUEST_STAGES,
  type ApiHttpPorts,
  type ApiRequestStage,
  createApiHandler,
} from "./api_http.ts";
import {
  RUNTIME_BUDGET_STAGES,
  type RuntimeBudgetStage,
  type RuntimeRequestBudget,
} from "./runtime_budget.ts";
import {
  type RequestScopedCurrentPagePortsFactory,
  resolveCurrentPageRequestPorts,
} from "./current_page_request_ports.review-only.ts";
import { RelayBoundary, safeFailure } from "./auth_relay.ts";
import { SupabaseForecastAuthorities, SupabaseManagementResources } from "./management_postgres.ts";
import { type NativeDataProvider, NativeForecastInputs } from "./native_data_provider.ts";
import { PublicJeongsiPassesReader } from "./public_passes.ts";
import { VerifiedArtifactCache } from "./supabase_artifacts.ts";
import { PreparedSelectionCache } from "./native_source_selection.ts";
import { NativeRuntimeRequest } from "./runtime_context.ts";
import { PinnedSavedReferenceTailSource } from "./saved_reference_tail_source.ts";
import {
  referenceCandidateScopePort,
  referenceProjectionAuthorityPort,
} from "./reference_runtime_authority.ts";
type RuntimePersonalOwnerCache =
  | Extract<PersonalOwnerReferenceBatchPorts["cache"], { kind: "owner_code" }>
  | (
    & Omit<
      Extract<PersonalOwnerReferenceBatchPorts["cache"], { kind: "verified_self_student_name" }>,
      "storageForName"
    >
    & Readonly<{ bucket: PrivateR2Bucket; prefix: string }>
  );
type RuntimePersonalOwnerPorts =
  & Omit<
    PersonalOwnerReferenceBatchPorts,
    "reports" | "clock" | "projection" | "assertActiveAdmission" | "source" | "cache"
  >
  & Readonly<{ cache: RuntimePersonalOwnerCache }>;

/** Per-request saved-tail objects and raw bytes held at once (inside the existing read budget). */
export const REFERENCE_TAIL_REQUEST_OBJECTS = 16;
export const REFERENCE_TAIL_REQUEST_BYTES = 24 * 1024 * 1024;
/** Concurrent saved-tail loads per request (same request budget and signal). */
export const REFERENCE_TAIL_PREFETCH_CONCURRENCY = 4;
import { RuntimeReferenceLease } from "./runtime_reference_lease.ts";
import {
  bindRuntimeReferencePorts,
  type RuntimeReferenceFactory,
  type RuntimeReferencePorts,
} from "./runtime_reference_ports.ts";
import { savedReportProjectionAuthority } from "./saved_report_projection_authority.ts";
import { prefetchSelectedSavedTails, preservePrefetchFailures } from "./reference_tail_prefetch.ts";
import {
  type BasicRuntimeSettings,
  readBasicRuntimeSettings,
  type RuntimeEnvironment,
} from "./runtime_settings.ts";
import { type SafeProfileLookupObservation, SupabaseNativeAuth } from "./supabase_auth.ts";
import type { SafeExchangeObservation } from "./auth_exchange_observation.ts";
import { type NativeSqlPool, SupabaseSqlTransport } from "./transaction_sql.ts";
import { type AdminExceptionReason, BoundVerifiedSessionProvider } from "./verified_session.ts";
import type { ReadViewCatalogFactory } from "./read_view_catalog_runtime.ts";
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
export interface RuntimeTimingObservation {
  readonly kind: "timing";
  readonly operation: string | null;
  readonly status: number;
  readonly request_id: string;
  readonly total_ms: number;
  readonly stage_ms: Readonly<Record<string, number>>;
}
/** No bearer, account ID, role/status value, profile row, or exception text. */
export interface SafeAuthObservation extends SafeProfileLookupObservation {
  readonly kind: "profile_lookup";
  readonly request_id: string;
  readonly admin_exception_reason: AdminExceptionReason | null;
}
export interface SafeDetailedAuthObservation extends SafeExchangeObservation {
  readonly request_id: string;
}
/** Uses only the internally generated request identifier and fixed transport categories. */
export function detailedAuthObserver(
  requestId: string,
  sink?: (event: SafeDetailedAuthObservation) => void | Promise<void>,
): ((event: SafeExchangeObservation) => void | Promise<void>) | undefined {
  if (!sink) return undefined;
  if (!/^[a-f0-9]{32}$/.test(requestId)) throw new Error("auth_observation_invalid");
  return (event) =>
    sink(Object.freeze({
      kind: event.kind,
      outcome: event.outcome,
      http_status: event.http_status,
      elapsed_ms: event.elapsed_ms,
      request_id: requestId,
    }));
}
export interface RuntimeComposition {
  readonly memberShortlistExtensions?: true;
  readonly readViewExtensions?: true;
  readonly candidateCatalog?: ReadViewCatalogFactory;
  /** Absent by default; a reviewed factory must independently verify published reference authority. */
  readonly referenceFactory?: RuntimeReferenceFactory;
  /** Separate opt-in route; no storage, issuer, budget, schema or authority is installed here. */
  readonly studentReference?: {
    readonly policy: RuntimeRoutePolicy;
    readonly scope: NonNullable<ApiHttpPorts["studentReferenceScope"]>;
    /** Synchronous composition only; this factory must not start or schedule I/O. */
    readonly resolvePorts: (
      request: ApiExecution,
      boundary: ApiExecutionBoundary,
    ) => Omit<
      OwnedStudentReferenceBatchPorts,
      "reports" | "clock" | "projection" | "assertActiveAdmission" | "source"
    >;
    /** Publisher/authority remain injected; the runtime supplies its actual request read budget. */
    readonly resolveBatchSource: (
      request: ApiExecution,
      boundary: ApiExecutionBoundary,
    ) => Omit<StudentReferenceProviderInputs, "budget">;
    /** Synchronous factory; source/authority and optional scenario are independently supplied. */
    readonly resolveHistoricalSource: (
      request: ApiExecution,
      boundary: ApiExecutionBoundary,
      budget: BoundHistoricalRuntimeInputs["budget"],
    ) => BoundHistoricalRuntimeInputs;
    /** Request-scoped 6075+6/CDF resolver and independent cache conversion authority. */
    readonly resolveCurrentTail: (
      request: ApiExecution,
      boundary: ApiExecutionBoundary,
      budget: BoundHistoricalRuntimeInputs["budget"],
    ) => BoundTailInputs;
  };
  /** Personal-owner file namespace is separate from the legacy student-ID route. */
  readonly personalOwnerReference?:
    & Omit<
      NonNullable<RuntimeComposition["studentReference"]>,
      "resolvePorts" | "resolveCurrentTail"
    >
    & {
      readonly resolvePorts: (
        request: ApiExecution,
        boundary: ApiExecutionBoundary,
      ) => RuntimePersonalOwnerPorts;
      /** Trusted server proof for already published immutable rows; never a client hash. */
      readonly resolvePublishedCacheAuthority: (
        request: ApiExecution,
        boundary: ApiExecutionBoundary,
      ) => PersonalPublishedCacheAuthority;
    };
  /** Separate reviewed configuration only; no authority is installed by default. */
  readonly currentPage?: {
    assert(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    readonly ports: CurrentPagePorts | RequestScopedCurrentPagePortsFactory;
    readonly limits: CurrentPageLimits;
    readonly policy: RuntimeRoutePolicy;
    readonly projection: PublicResponseProjection;
    assertCurrent(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    readonly schemaAuthority: {
      assert(
        request: ApiExecution,
        boundary: ApiExecutionBoundary,
        binding: Readonly<{
          operation: string;
          contract_ref: string;
          schema_sha256: string;
          schema_bytes_sha256: string;
        }>,
        phase: "active" | "settled_success",
      ): Promise<void>;
    };
  };
  readonly environment: RuntimeEnvironment;
  readonly policies: readonly RuntimeRoutePolicy[];
  readonly responseSchemas: unknown;
  readonly createPool: (settings: BasicRuntimeSettings["database"]) => NativeSqlPool;
  readonly clock?: RequestClockPort;
  readonly fetcher?: typeof fetch;
  /** Receives exactly five safe fields; never request data or exception objects. */
  readonly observe?: (event: SafeRuntimeObservation) => void | Promise<void>;
  /** Durations only (milliseconds per stage); never request data. Sink failures are ignored. */
  readonly observeTiming?: (event: RuntimeTimingObservation) => void | Promise<void>;
  /** Fixed categories and timings only; sink failures do not alter authorization. */
  readonly observeAuth?: (event: SafeAuthObservation) => void | Promise<void>;
  /** Opt-in transport-only reason codes; no request data or exception text. */
  readonly observeAuthDetailed?: (event: SafeDetailedAuthObservation) => void | Promise<void>;
}
/** New route only: verify the exact issuer and phase before consulting candidate authorities. */
export function currentPageBudgetScope(
  config: Pick<
    NonNullable<RuntimeComposition["currentPage"]>,
    "assert" | "assertCurrent" | "projection" | "schemaAuthority"
  >,
  budget: () => Promise<RuntimeRequestBudget>,
  assertBaseCurrent: () => Promise<void>,
): NonNullable<ApiHttpPorts["currentPageScope"]> {
  const requests = new WeakMap<ApiExecutionBoundary, {
    readonly request: ApiExecution;
    readonly budget: RuntimeRequestBudget;
  }>();
  const assertAdmission = async (
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    phase: "active" | "settled_success",
  ) => {
    if (
      request.operation !== CURRENT_PAGE_OPERATION_ID || !boundary.admission ||
      boundary.signal.aborted
    ) {
      throw new AccessError("security_policy_unavailable", 503);
    }
    let record = requests.get(boundary);
    if (phase === "settled_success" && !record) {
      throw new AccessError("security_policy_unavailable", 503);
    }
    if (!record) {
      const issuedBy = await budget();
      issuedBy.assertRunAdmission(boundary.admission as PreparedUsageAdmission, request, "active");
      record = { request, budget: issuedBy };
      requests.set(boundary, record);
    }
    if (record.request !== request) throw new AccessError("security_policy_unavailable", 503);
    record.budget.assertRunAdmission(boundary.admission as PreparedUsageAdmission, request, phase);
    if (boundary.signal.aborted) throw new AccessError("security_policy_unavailable", 503);
  };
  return {
    projection: config.projection,
    assert: async (request, boundary) => {
      await assertAdmission(request, boundary, "active");
      const result = await config.assert(request, boundary);
      await assertAdmission(request, boundary, "active");
      return result;
    },
    assertCurrent: async (request, boundary) => {
      await assertAdmission(request, boundary, "active");
      const result = await config.assertCurrent(request, boundary);
      if (result !== undefined) return result;
      await assertAdmission(request, boundary, "active");
      const baseResult = await assertBaseCurrent();
      if (baseResult !== undefined) return baseResult;
      await assertAdmission(request, boundary, "active");
    },
    assertReceipt: async (request, boundary) => {
      // Previously captured request-local budget only; no factory, provider or I/O.
      await assertAdmission(request, boundary, "settled_success");
    },
    schemaAuthority: {
      assert: async (request, boundary, binding, phase) => {
        if (phase !== "active") throw new AccessError("security_policy_unavailable", 503);
        await assertAdmission(request, boundary, phase);
        const result = await config.schemaAuthority.assert(request, boundary, binding, phase);
        await assertAdmission(request, boundary, "active");
        return result;
      },
    },
  };
}
/** Preserve legacy final checks; the new page uses only already-captured local state after settlement. */
export async function runtimeCompletionCurrent(
  operation: string | null,
  pageBudget: RuntimeRequestBudget | undefined,
  existingCurrent: () => Promise<void>,
  assertP1Current: () => void,
): Promise<void> {
  if (operation === CURRENT_PAGE_OPERATION_ID) {
    if (!pageBudget) throw new AccessError("security_policy_unavailable", 503);
    pageBudget.policy.assertLive();
  } else {
    await existingCurrent();
  }
  assertP1Current();
}
/** The serving graph forwards every scoring capability through the same request-local provider. */
export function runtimeAnalysisDataPort(
  context: Pick<NativeRuntimeRequest, "data">,
  phase: <T>(next: ObservationStage, work: () => Promise<T>) => Promise<T>,
  signal?: AbortSignal,
  legacyTail = true,
): UniversityAnalysisDataPort & OverallDataPort & CatalogDataPort {
  // One request-local adapter over the approved saved-tail authority; never an isolate singleton.
  // Providers without the saved-tail capability keep the previous behavior (no reference tail).
  type TailCapable = Partial<
    Pick<NativeDataProvider, "referenceTailAuthority" | "referenceTailPins">
  >;
  let tails: Promise<PinnedSavedReferenceTailSource | null> | undefined;
  const tailSource = () =>
    tails ??= (async () => {
      const data = (await context.data()) as TailCapable;
      if (typeof data.referenceTailAuthority !== "function") return null;
      return new PinnedSavedReferenceTailSource(
        data.referenceTailAuthority(),
        signal!,
        REFERENCE_TAIL_REQUEST_OBJECTS,
        REFERENCE_TAIL_REQUEST_BYTES,
      );
    })();
  return {
    ...(signal
      ? {
        ...(legacyTail
          ? {
            getReferenceTail: async (offeringId: string, scopeSignal?: AbortSignal) =>
              await phase("percentile_provider", async () => {
                const source = await tailSource();
                return source ? await source.getReferenceTail(offeringId, scopeSignal) : null;
              }),
            prefetchReferenceTails: async (
              offeringIds: readonly string[],
              scopeSignal?: AbortSignal,
            ) =>
              await phase("percentile_provider", async () => {
                const source = await tailSource();
                if (!source) return;
                const pending = [...new Set(offeringIds)];
                const worker = async () => {
                  while (pending.length) {
                    if (signal.aborted || scopeSignal?.aborted) {
                      throw new AccessError("security_policy_unavailable", 503);
                    }
                    const id = pending.shift()!;
                    try {
                      await source.getReferenceTail(id, scopeSignal);
                    } catch (error) {
                      if (signal.aborted || scopeSignal?.aborted) {
                        throw error;
                      }
                      // The later per-offering call keeps the existing pending behavior.
                    }
                  }
                };
                const workers = await Promise.allSettled(
                  Array.from({ length: REFERENCE_TAIL_PREFETCH_CONCURRENCY }, worker),
                );
                const failed = workers.find((result) => result.status === "rejected");
                if (failed?.status === "rejected") throw failed.reason;
              }),
          }
          : {}),
        referenceTailPins: async () =>
          await phase("percentile_provider", async () => {
            const data = (await context.data()) as TailCapable;
            return typeof data.referenceTailPins === "function"
              ? await data.referenceTailPins()
              : null;
          }),
      }
      : {}),
    getCatalog: async () =>
      await phase("catalog_provider", async () => (await context.data()).getCatalog()),
    getExamPack: async (...a) =>
      await phase("exam_provider", async () => (await context.data()).getExamPack(...a)),
    getTotalModel: async (...a) =>
      await phase("total_model_provider", async () => (await context.data()).getTotalModel(...a)),
    getConversion: async (...a) =>
      await phase("conversion_provider", async () => (await context.data()).getConversion(...a)),
    getReference: async (...a) =>
      await phase("conversion_provider", async () => (await context.data()).getReference(...a)),
    hasProductionConversion: async (...a) =>
      await phase("conversion_provider", async () => {
        // Providers without the capability keep the previous full candidate universe.
        const data = (await context.data()) as {
          hasProductionConversion?: (offeringId: string) => Promise<boolean>;
        };
        return data.hasProductionConversion ? await data.hasProductionConversion(...a) : true;
      }),
    withScoringBatch: async <T>(work: () => Promise<T>, scopeSignal?: AbortSignal) =>
      await phase(
        "analysis_provider",
        async () => (await context.data()).withScoringBatch(work, scopeSignal),
      ),
    getPercentile: async (...a) =>
      await phase("percentile_provider", async () => (await context.data()).getPercentile(...a)),
    getAnalysis: async (...a) =>
      await phase("analysis_provider", async () => (await context.data()).getAnalysis(...a)),
  };
}
/** Used only inside the authenticated, scoped and already-reserved business callback. */
async function invokeCurrentPageService(
  config: NonNullable<RuntimeComposition["currentPage"]> | undefined,
  clock: RequestClockPort,
  request: ApiExecution,
  boundary?: ApiExecutionBoundary,
  budget?: RuntimeRequestBudget,
): Promise<unknown> {
  if (
    !config || request.operation !== CURRENT_PAGE_OPERATION_ID ||
    !boundary?.admission || boundary.signal.aborted
  ) throw new AccessError("security_policy_unavailable", 503);
  const execution = request as ApiExecution & CurrentPageExecution;
  const ports = await resolveCurrentPageRequestPorts(
    config.ports,
    execution,
    boundary,
    budget,
    clock,
  );
  const service = new HistoryCurrentPageService(ports, clock, config.limits);
  return await service.execute(execution, boundary);
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
    const safeOperation =
      operationId === "health.ready" || operationId === CURRENT_PAGE_OPERATION_ID ||
        (REGISTERED_API_OPERATION_IDS as readonly string[]).includes(operationId ?? "")
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
  private readonly currentPageEnabled: boolean;
  private readonly studentReferenceEnabled: boolean;
  private readonly projection: PublicResponseProjection;
  private readonly pools = new Map<string, SupabaseSqlTransport>();
  private readonly artifactCache = new VerifiedArtifactCache();
  private readonly preparedSelections = new PreparedSelectionCache();
  constructor(private readonly config: RuntimeComposition) {
    if (
      !config || typeof config.environment?.get !== "function" ||
      typeof config.createPool !== "function"
    ) throw new AccessError("security_policy_unavailable", 503);
    if (
      config.readViewExtensions && !config.memberShortlistExtensions &&
      config.policies.length === 30
    ) {
      const legacy = legacyReadViewRegistration(config.policies, config.responseSchemas);
      this.config = {
        ...config,
        policies: legacy.policies,
        responseSchemas: legacy.responseSchemas,
      };
    }
    this.clock = config.clock ?? { nowUtc: () => BigInt(Date.now()) * 1000n };
    this.fetcher = config.fetcher ?? fetch;
    this.projection = new PublicResponseProjection(
      this.config.responseSchemas,
      this.config.policies,
    );
    const page = this.config.currentPage;
    this.currentPageEnabled = !!this.config.readViewExtensions && !!page &&
      typeof page.assert === "function" && !!page.ports && !!page.limits &&
      typeof page.assertCurrent === "function" &&
      typeof page.schemaAuthority?.assert === "function" &&
      isCurrentPagePolicy(page.policy) && page.projection instanceof PublicResponseProjection &&
      page.projection.hasExactRegistryBytes() &&
      page.projection.supportsOperation(CURRENT_PAGE_OPERATION_ID, page.policy.contract_ref) &&
      !this.config.policies.some((p) =>
        p.method === page.policy.method && p.path === page.policy.path
      );
    const student = this.config.personalOwnerReference ?? this.config.studentReference,
      scope = student?.scope;
    this.studentReferenceEnabled = REFERENCE_DURABLE_FENCE_IMPLEMENTED &&
      !!this.config.personalOwnerReference && !this.config.studentReference &&
      !!student && !!scope && isStudentReferencePolicy(student.policy) &&
      typeof student.resolvePorts === "function" &&
      typeof student.resolveBatchSource === "function" &&
      typeof student.resolveHistoricalSource === "function" &&
      typeof this.config.personalOwnerReference.resolvePublishedCacheAuthority === "function" &&
      typeof scope.budget?.run === "function" &&
      typeof scope.assert === "function" && typeof scope.assertCurrent === "function" &&
      typeof scope.assertReceipt === "function" &&
      typeof scope.schemaAuthority?.assert === "function" &&
      scope.projection instanceof PublicResponseProjection &&
      scope.projection.hasExactRegistryBytes() &&
      scope.projection.supportsOperation(
        STUDENT_REFERENCE_OPERATION_ID,
        student.policy.contract_ref,
      ) &&
      !this.config.policies.some((p) =>
        p.method === student.policy.method && p.path === student.policy.path
      );
  }
  readonly fetch = async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID().replaceAll("-", "");
    const searchCorrelation = new SearchFailureCorrelation((event) =>
      console.info(JSON.stringify(event))
    );
    let stage: ObservationStage = "entry";
    const startedAt = performance.now(), stageMs: Record<string, number> = {};
    let stageAt = startedAt;
    const setStage = (next: ObservationStage) => {
      const now = performance.now();
      stageMs[stage] = (stageMs[stage] ?? 0) + (now - stageAt);
      stageAt = now;
      stage = next;
    };
    const reportTiming = (response: Response) => {
      const sink = this.config.observeTiming;
      if (!sink) return;
      try {
        setStage(stage);
        const rounded: Record<string, number> = {};
        for (const [name, ms] of Object.entries(stageMs)) {
          if (ms >= 1) rounded[name] = Math.round(ms);
        }
        void Promise.resolve(sink(Object.freeze({
          kind: "timing",
          operation: selectedOperation,
          status: response.status,
          request_id: requestId,
          total_ms: Math.round(performance.now() - startedAt),
          stage_ms: Object.freeze(rounded),
        }))).catch(() => {});
      } catch { /* Timing never changes the response. */ }
    };
    let selectedOperation: ApiOperationId | "health.ready" | null = null;
    let closeP1R27: (() => void) | undefined;
    const mark = (next: ObservationStage) => {
      const before = stage;
      setStage(next);
      return () => {
        setStage(before);
      };
    };
    const phase = async <T>(next: ObservationStage, work: () => Promise<T>): Promise<T> => {
      const before = stage;
      setStage(next);
      const value = await work();
      setStage(before);
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
          setStage("runtime_settings");
          basicValue = readBasicRuntimeSettings(this.config.environment);
          setStage(before);
        }
        return basicValue;
      };
      let requestSql: SupabaseSqlTransport | undefined;
      const sql = () => {
        if (requestSql) return requestSql;
        const settings = basic().database,
          key = JSON.stringify([settings.databaseUrl, settings.databaseCa]);
        let transport = this.pools.get(key);
        if (!transport) {
          const before = stage;
          setStage("runtime_pool");
          transport = new SupabaseSqlTransport(this.config.createPool(settings));
          setStage(before);
          this.pools.set(key, transport);
        }
        requestSql = transport.fork();
        return requestSql;
      };
      const relay = new RelayBoundary(this.config.environment.get("JUNGSI_RELAY_TOKEN") ?? null);
      const requestPolicies = [
        ...this.config.policies,
        ...(this.currentPageEnabled ? [this.config.currentPage!.policy] : []),
        ...(this.studentReferenceEnabled
          ? [(this.config.personalOwnerReference ?? this.config.studentReference)!.policy]
          : []),
      ];
      selectedOperation = pathname === "/health/ready"
        ? "health.ready"
        : operation(requestPolicies, request);
      let admissionPermit: object | undefined;
      if (selectedOperation !== null && selectedOperation !== "health.ready") {
        setStage("relay");
        await relay.verify(request.headers);
        admissionPermit = issueAdmissionPermit(this.clock.nowUtc(), request);
      }
      const context = new NativeRuntimeRequest(
        this.config.environment,
        basic,
        sql,
        this.clock,
        selectedOperation,
        this.fetcher,
        this.artifactCache,
        request.headers.get("If-None-Match"),
        this.preparedSelections,
      );
      closeP1R27 = () => context.closeP1R27();
      // Request-local only. The factory cannot run until the existing budget callback is active.
      // Legacy saved-report delivery needs the same request-local admission and receipt
      // even when the optional new reference factory has not been configured.
      const referenceLease = new RuntimeReferenceLease(
        this.clock,
        (signal) => context.assertCurrent(signal),
        (signal) => context.referenceCurrentReceipt(signal),
      );
      let referencePorts: Promise<RuntimeReferencePorts | null> | undefined;
      const reference = (r: ApiExecution, boundary: ApiExecutionBoundary) => {
        if (!referenceLease || !this.config.referenceFactory) return Promise.resolve(null);
        referencePorts ??= bindRuntimeReferencePorts(
          this.config.referenceFactory,
          referenceLease,
          context,
          { repository: platform, catalog, clock: this.clock, workflow },
          r,
          boundary,
        );
        return referencePorts;
      };
      if (pathname === "/health/ready" && request.method === "GET") {
        setStage("relay");
        await relay.verify(request.headers);
        assertAdmissionMicros(this.clock.nowUtc());
        setStage("readiness_schema");
        if (!await sql().probeUsageSchema()) {
          throw new AccessError("security_policy_unavailable", 503);
        }
        // Nil is a schema-only health probe, never a user session or administrator origin.
        await new PublicJeongsiPassesReader(sql()).readCurrent(
          "00000000-0000-0000-0000-000000000000",
          this.clock.nowUtc(),
        );
        setStage("readiness_data");
        await context.data();
        setStage("runtime_final_current");
        await context.assertCurrent();
        return Response.json({ status: "ready", server_timezone: "UTC" }, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      const ownedReportRead: {
        last?: Awaited<ReturnType<PlatformRepositoryPort["getReport"]>>;
      } = {};
      const platform: PlatformRepositoryPort = {
        replay: async (...a) =>
          await phase("platform_replay", async () => (await context.platform()).replay(...a)),
        createProfile: async (...a) => {
          const value = await phase(
            "profile_store",
            async () => (await context.platform()).createProfile(...a),
          );
          setStage("profile_after_store");
          return value;
        },
        getProfile: async (...a) =>
          await phase("profile_read", async () => (await context.platform()).getProfile(...a)),
        getReport: async (...a) => {
          const value = await phase("report_read", async () => (await context.platform()).getReport(...a));
          ownedReportRead.last = value;
          return value;
        },
        getReportRevision: async (...a) => {
          const binding = await context.binding(), controls = await context.controls();
          const settle = controls.reserveExternalRead(binding.repositoryLimits.maxRecordBytes);
          const value = await phase(
            "report_read",
            async () => (await context.platform()).getReportRevision(...a),
          );
          if (a[3]?.aborted) throw new AccessError("security_policy_unavailable", 503);
          settle(value ? new TextEncoder().encode(nativeJsonText(value.body, true)).byteLength : 0);
          return value;
        },
        lookupAccess: async (...a) =>
          await phase("report_access", async () => (await context.platform()).lookupAccess(...a)),
        writeReport: async (...a) => {
          const value = await phase(
            "report_store",
            async () => (await context.platform()).writeReport(...a),
          );
          setStage("report_after_store");
          return value;
        },
        activeReports: async (...a) =>
          await phase("active_reports", async () => (await context.platform()).activeReports(...a)),
      };
      const data = runtimeAnalysisDataPort(context, phase, request.signal, true);
      const catalogContext = {
        binding: () => context.binding(),
        controls: () => context.controls(),
        searchDiagnostic: searchCorrelation.capture,
      };
      const selectedCatalog = this.config.readViewExtensions && this.config.candidateCatalog
        ? this.config.candidateCatalog(
          data,
          this.clock,
          sql,
          this.config.environment,
          catalogContext,
        )
        : null;
      selectedCatalog?.restrictAnalysisData(data);
      const catalog = selectedCatalog ?? new CatalogService(data, this.clock);
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
      let scoreValue: ScoreInputService | undefined;
      const scores = async () => {
        if (scoreValue) return scoreValue;
        const [repo, budget] = await Promise.all([context.scoreInputs(), context.budget()]);
        if (!budget.policy.operating) throw new AccessError("score_input_policy_unavailable", 503);
        scoreValue = new ScoreInputService(repo, budget.policy.operating, data, this.clock);
        return scoreValue;
      };
      const workflow: ScoreInputWorkflowPort = {
        saveProfile: async (a) => (await scores()).saveProfile(a),
        assertProfile: async (...a) => (await scores()).assertProfile(...a),
        reusableOverall: async (...a) => (await scores()).reusableOverall(...a),
        analysisContext: async (...a) => (await scores()).analysisContext(...a),
        origin: (...a) => {
          if (!scoreValue) throw new AccessError("score_input_policy_unavailable", 503);
          return scoreValue.origin(...a);
        },
        snapshotScope: async (...a) =>
          (await context.budget()).policy.operating
            ? (await scores()).snapshotScope(...a)
            : { overall: false, analysisIds: [], candidates: false, legacyVerified: false },
        deliver: async (...a) => {
          if ((await context.budget()).policy.operating) await (await scores()).deliver(...a);
        },
      };
      const mode = { mode: "rights" as const, workflow };
      const memberSchoolResults: MemberSchoolResultsWriterPort = {
        stage: async (owner, profile, report, offerings) => {
          const [binding, controls] = await Promise.all([context.binding(), context.controls()]);
          const member = binding.memberJson;
          if (!member) return null;
          if (
            typeof profile.scores.exam_id !== "string" ||
            typeof profile.scores.pack_version !== "string"
          ) {
            throw new AccessError("storage_result_invalid", 503);
          }
          await context.assertCurrent();
          const storage = new MemberSchoolResultsStorage({
            projectUrl: binding.projectUrl,
            bucket: binding.storage.bucket,
            prefix: member.prefix,
            secretKey: binding.storage.secretKey,
            maxBytes: member.maxObjectBytes,
            maxItems: Math.min(member.maxItems, 100),
            timeoutMs: binding.storage.limits.requestTimeoutMs,
          }, controls.fetcher);
          const identity = Object.freeze({
            owner,
            academicYear: 2027,
            reportId: report.report_id,
            reportRevision: report.revision,
            currentReportRevision: report.revision,
            profileId: profile.profile_id,
            profileFingerprint: await nativeJsonSha256(profile.scores),
            examId: profile.scores.exam_id,
            packVersion: profile.scores.pack_version,
          });
          const documents = await projectMemberSchoolResultBatches(
            owner,
            profile,
            report,
            offerings,
            Math.min(member.maxItems, 100),
            member.maxObjectBytes,
          );
          const refs: NativeObject[] = [];
          // Keep storage traffic bounded and wait for the complete group before failing.
          for (let i = 0; i < documents.length; i += 2) {
            const group = await Promise.allSettled(
              documents.slice(i, i + 2).map((document) => storage.create(identity, document)),
            );
            const failed = group.find((outcome) => outcome.status === "rejected");
            if (failed && failed.status === "rejected") throw failed.reason;
            for (const outcome of group) {
              if (outcome.status !== "fulfilled") throw new AccessError("storage_unavailable", 503);
              const ref = outcome.value;
              refs.push({
                object_key: ref.object_key,
                sha256: ref.sha256,
                bytes: ref.bytes,
                source_report_revision: ref.source_report_revision,
              });
            }
          }
          await context.assertCurrent();
          return refs;
        },
      };
      const profiles = new ProfileReportService(platform, data, this.clock, mode);
      const actions = new ReportActionService(platform, catalog, this.clock);
      const universities = new UniversityAnalysisService(
        platform,
        catalog,
        data,
        this.clock,
        forecasts,
        mode,
        // No approved revision-bound authority or bounded evidence adapter exists yet.
        null,
        // Existing approved selection remains the fallback only when the new factory is unselected.
        () => referenceCandidateScopePort(context),
        memberSchoolResults,
      );
      let inputAdmission: PreparedUsageAdmission | undefined;
      let currentPageBudget: RuntimeRequestBudget | undefined;
      let studentReferenceReceipt:
        | Readonly<{ request: ApiExecution; boundary: ApiExecutionBoundary }>
        | null = null;
      let studentReferenceBudget: RuntimeRequestBudget | undefined;
      const configuredStudentScope = this.studentReferenceEnabled
        ? (this.config.personalOwnerReference ?? this.config.studentReference)!.scope
        : undefined;
      const assertStudentRun = (
        r: ApiExecution,
        boundary: ApiExecutionBoundary,
        phase: "active" | "settled_success",
      ) => {
        if (!studentReferenceBudget || !boundary.admission || boundary.signal.aborted) {
          throw new AccessError("security_policy_unavailable", 503);
        }
        studentReferenceBudget.assertRunAdmission(
          boundary.admission as PreparedUsageAdmission,
          r,
          phase,
        );
      };
      // Bind every gate to the same shared-budget issuer and request-local lifecycle.
      // No policy, cost, schema or source authority is synthesized here.
      const studentScope: ApiHttpPorts["studentReferenceScope"] = configuredStudentScope
        ? {
          ...configuredStudentScope,
          budget: {
            run: async (r, work) => {
              const budget = await phase("budget_initialize", () => context.budget());
              if (studentReferenceBudget && studentReferenceBudget !== budget) {
                throw new AccessError("security_policy_unavailable", 503);
              }
              studentReferenceBudget = budget;
              return await budget.run(r, work, mark);
            },
          },
          assert: async (r, boundary) => {
            assertStudentRun(r, boundary, "active");
            await configuredStudentScope.assert(r, boundary);
            assertStudentRun(r, boundary, "active");
          },
          assertCurrent: async (r, boundary) => {
            assertStudentRun(r, boundary, "active");
            await configuredStudentScope.assertCurrent(r, boundary);
            assertStudentRun(r, boundary, "active");
          },
          assertReceipt: async (r, boundary) => {
            assertStudentRun(r, boundary, "settled_success");
            await configuredStudentScope.assertReceipt(r, boundary);
            assertStudentRun(r, boundary, "settled_success");
          },
          schemaAuthority: {
            assert: async (r, boundary, binding, stage) => {
              assertStudentRun(r, boundary, stage);
              await configuredStudentScope.schemaAuthority.assert(r, boundary, binding, stage);
              assertStudentRun(r, boundary, stage);
            },
          },
        }
        : undefined;
      const business: ApiBusinessPort = {
        execute: async (r, boundary) => {
          if (r.operation === STUDENT_REFERENCE_OPERATION_ID) {
            const personalConfig = this.config.personalOwnerReference;
            const config = personalConfig ?? this.config.studentReference;
            if (
              !this.studentReferenceEnabled || !config || !studentScope || !boundary?.admission ||
              boundary.signal.aborted ||
              !resultObject(r.body)
            ) throw new AccessError("security_policy_unavailable", 503);
            const body = r.body;
            if (
              Object.keys(body).sort().join(",") !==
                (personalConfig
                  ? "expected_version,offering_ids,profile_id"
                  : "expected_version,offering_ids,profile_id,student_id") ||
              !personalConfig && typeof body.student_id !== "string" ||
              typeof body.profile_id !== "string" ||
              !Array.isArray(body.offering_ids)
            ) throw new AccessError("invalid_request", 422);
            const rawRevision = body.expected_version;
            const revision =
              typeof rawRevision === "bigint" && rawRevision <= BigInt(Number.MAX_SAFE_INTEGER)
                ? Number(rawRevision)
                : rawRevision;
            if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
              throw new AccessError("invalid_request", 422);
            }
            const assertActive = (req: ApiExecution, b: ApiExecutionBoundary) =>
              studentScope.assert(req, b);
            const sourceInputs = config.resolveBatchSource(r, boundary);
            if (
              !sourceInputs || typeof sourceInputs !== "object" ||
              typeof (sourceInputs as { then?: unknown }).then === "function"
            ) {
              throw new AccessError("security_policy_unavailable", 503);
            }
            const controls = await context.controls();
            await assertActive(r, boundary);
            const historical = config.resolveHistoricalSource(r, boundary, controls);
            if (
              !historical || typeof historical !== "object" ||
              typeof (historical as { then?: unknown }).then === "function" ||
              historical.budget !== controls
            ) {
              throw new AccessError("security_policy_unavailable", 503);
            }
            if (!personalConfig || sourceInputs.sql !== sql()) {
              throw new AccessError("security_policy_unavailable", 503);
            }
            const personalSupplied = personalConfig.resolvePorts(r, boundary);
            if (
              !personalSupplied || typeof personalSupplied !== "object" ||
              typeof (personalSupplied as { then?: unknown }).then === "function" ||
              !personalSupplied.cache || !personalSupplied.cache.scope
            ) {
              throw new AccessError("security_policy_unavailable", 503);
            }
            const owner = personalSupplied.cache;
            const storage = owner.kind === "owner_code"
              ? { kind: "owner_code" as const, storage: owner.storage }
              : {
                kind: "verified_self_student_name" as const,
                names: owner.names,
                bucket: owner.bucket,
                prefix: owner.prefix,
              };
            const scope = {
              ...owner.scope,
              repository: platform,
              workflow,
              clock: this.clock,
              assertActiveAdmission: assertActive,
            };
            const publication = personalConfig.resolvePublishedCacheAuthority(r, boundary);
            if (!publication || typeof (publication as { then?: unknown }).then === "function") {
              throw new AccessError("security_policy_unavailable", 503);
            }
            const published = new PersonalOwnerPublishedCacheEvidence(sourceInputs.authority, {
              scope,
              storage,
              cacheAuthority: owner.authority,
              publication,
              awaitQuiescence: (signal) => owner.scope.awaitQuiescence(signal),
            });
            const authority = new JoinedHistoricalBatchEvidence(published, historical, controls);
            const source = new BoundedStudentReferenceBatchProvider({
              ...sourceInputs,
              authority,
              budget: controls,
            });
            studentReferenceReceipt = Object.freeze({ request: r, boundary });
            const reports = {
              find: (id: string) => platform.lookupAccess(r.session.user.subjectId, id),
            };
            if (personalConfig) {
              const supplied = personalSupplied;
              if (!supplied) throw new AccessError("security_policy_unavailable", 503);
              const personalScope = {
                ...supplied.cache.scope,
                repository: platform,
                workflow,
                clock: this.clock,
                assertActiveAdmission: assertActive,
              };
              const incoming = supplied.cache;
              const cache: PersonalOwnerReferenceBatchPorts["cache"] =
                incoming.kind === "owner_code" ? { ...incoming, scope: personalScope } : {
                  kind: "verified_self_student_name",
                  scope: personalScope,
                  authority: incoming.authority,
                  names: incoming.names,
                  storageForName: (name) =>
                    new PersonalOwnerNamedR2Reader(incoming.bucket, incoming.prefix, name),
                };
              const ports: PersonalOwnerReferenceBatchPorts = {
                ...supplied,
                source,
                cache,
                reports,
                clock: this.clock,
                projection: studentScope.projection,
                assertActiveAdmission: assertActive,
              };
              return await handlePersonalOwnerReferenceBatch(
                r,
                boundary,
                Object.freeze({
                  profileId: body.profile_id,
                  reportId: r.params.report_id,
                  reportRevision: revision,
                }),
                config.policy.contract_ref,
                ports,
              );
            }
            if (!this.config.studentReference || typeof body.student_id !== "string") {
              throw new AccessError("security_policy_unavailable", 503);
            }
            const supplied = this.config.studentReference.resolvePorts(r, boundary);
            if (
              !supplied || typeof supplied !== "object" ||
              typeof (supplied as { then?: unknown }).then === "function" ||
              !supplied.cache
            ) throw new AccessError("security_policy_unavailable", 503);
            const cache = {
              ...supplied.cache,
              repository: platform,
              workflow,
              clock: this.clock,
              assertActiveAdmission: assertActive,
            };
            const ports: OwnedStudentReferenceBatchPorts = {
              ...supplied,
              source,
              cache,
              reports,
              clock: this.clock,
              projection: studentScope.projection,
              assertActiveAdmission: assertActive,
            };
            return await handleOwnedStudentReferenceBatch(
              r,
              boundary,
              Object.freeze({
                studentId: body.student_id,
                profileId: body.profile_id,
                reportId: r.params.report_id,
                reportRevision: revision,
              }),
              config.policy.contract_ref,
              ports,
            );
          }
          if (r.operation === CURRENT_PAGE_OPERATION_ID) {
            return await invokeCurrentPageService(
              this.config.currentPage,
              this.clock,
              r,
              boundary,
              currentPageBudget,
            );
          }
          if (
            r.operation === "report.export" && Object.keys(r.query).length &&
            this.config.memberShortlistExtensions
          ) {
            return await (await context.memberShortlist(catalog)).print(r);
          }
          if (MEMBER_SHORTLIST_OPERATION_IDS.some((id) => id === r.operation)) {
            if (!this.config.memberShortlistExtensions) {
              throw new AccessError("operation_scope_not_approved", 503);
            }
            return await (await context.memberShortlist(catalog)).execute(r);
          }
          if (READ_VIEW_OPERATION_IDS.some((id) => id === r.operation)) {
            if (
              r.operation === "history.snapshot.head" || r.operation === "history.snapshot.read"
            ) {
              await context.prepareP1R27(request, r);
            }
            return await context.readView(r);
          }
          if (SCORE_POLICY_OPERATION_IDS.some((id) => id === r.operation)) {
            return await (await scores()).execute(r);
          }
          if (CATALOG_OPERATIONS.some((id) => id === r.operation)) {
            if (this.config.readViewExtensions && !this.config.candidateCatalog) {
              throw new AccessError("security_policy_unavailable", 503);
            }
            const result = await catalog.execute(r);
            if (r.operation !== "offerings.search" || !selectedCatalog || r.session.tier !== "paid") {
              return result;
            }
            if (!boundary?.admission || boundary.signal.aborted) {
              throw new AccessError("security_policy_unavailable", 503);
            }
            const scoreBoundary = boundary;
            const budget = await context.budget();
            const assertActive = () => {
              if (scoreBoundary.signal.aborted) throw new AccessError("security_policy_unavailable", 503);
              budget.assertRunAdmission(scoreBoundary.admission as PreparedUsageAdmission, r, "active");
            };
            assertActive();
            return await attachSavedPageScores(result, r.session, this.clock, scoreBoundary.signal, {
              read: async (session, year, ids, signal) => {
                assertActive();
                const exams = [...budget.policy.exams.values()].filter((exam) =>
                  exam.academicYear === year && (r.query.exam_id === undefined || exam.examId === r.query.exam_id)
                );
                if (exams.length !== 1 || !budget.policy.operating) return { state: "unavailable" };
                const selected = budget.policy.operating.context(
                  session, exams[0].examId, r.query.stage, this.clock.nowUtc(), false,
                );
                if (selected.stage.academicYear !== year) return { state: "unavailable" };
                const state = await (await context.scoreInputs()).state(selected, signal);
                assertActive();
                if (!state.currentProfileId) return { state: "no_profile" };
                const binding = await context.binding();
                const pin = await scoreMapPin(binding.references);
                assertActive();
                const controls = await context.controls();
                const settle = controls.reserveExternalRead(binding.repositoryLimits.maxRecordBytes);
                try {
                  const values = await readSavedScoreMap(sql(), {
                    owner: session.user.subjectId,
                    profileId: state.currentProfileId,
                    dataPin: pin,
                    signal,
                    assertActive,
                  }, ids);
                  assertActive();
                  settle(new TextEncoder().encode(JSON.stringify([...values.entries()])).byteLength);
                  return { state: "ready", scores: values };
                } catch (error) {
                  assertActive();
                  requirePaidSession(session, this.clock.nowUtc());
                  if (error instanceof SavedScoreTransientUnavailable) return { state: "unavailable" };
                  throw error;
                }
              },
            });
          }
          if (REPORT_ACTION_OPERATIONS.some((id) => id === r.operation)) {
            if (r.operation === "shortlist.update") selectedCatalog?.prepareSelection(r);
            return await actions.execute(r);
          }
          if (
            UNIVERSITY_ANALYSIS_OPERATIONS.some((id) => id === r.operation)
          ) {
            if (r.operation === "university.analyze") selectedCatalog?.prepareSelection(r);
            let activeReference: RuntimeReferencePorts | null = null;
            let referenceFailed = false;
            if (referenceLease && boundary) {
              try {
                activeReference = await reference(r, boundary);
              } catch (error) {
                if (boundary.signal.aborted) throw error;
                referenceFailed = true;
              }
            }
            const enabled = activeReference &&
                (r.operation !== "candidates.build" || activeReference.candidateScope !== null)
              ? activeReference
              : null;
            let selectedUniversities = universities;
            if (enabled) {
              // Prefetch the exact request-local source later used by the calculator.
              const tail = enabled.tail;
              const failures = new Map<string, unknown>();
              const guardedTail = preservePrefetchFailures(tail, failures);
              const prefetchReferenceTails = async (
                ids: readonly string[],
                scopeSignal?: AbortSignal,
              ) => {
                await phase(
                  "percentile_provider",
                  () =>
                    prefetchSelectedSavedTails(
                      tail,
                      ids,
                      request.signal,
                      scopeSignal,
                      r.operation === "university.analyze" ? failures : undefined,
                    ),
                );
              };
              selectedUniversities = new UniversityAnalysisService(
                platform,
                catalog,
                { ...data, ...guardedTail, prefetchReferenceTails },
                this.clock,
                forecasts,
                mode,
                null,
                enabled.candidateScope,
                memberSchoolResults,
              );
            } else if (referenceFailed || activeReference) {
              // A failed authority or an active factory without candidate scope must never fall back to legacy reference data.
              selectedUniversities = new UniversityAnalysisService(
                platform,
                catalog,
                { ...data, getReferenceTail: undefined, prefetchReferenceTails: undefined },
                this.clock,
                forecasts,
                mode,
                null,
                null,
                memberSchoolResults,
              );
            }
            return await selectedUniversities.execute(r, boundary);
          }
          if (FORECAST_OPERATIONS.some((id) => id === r.operation)) {
            return await forecasts.execute(r);
          }
          const reportResult = await profiles.execute(r);
          if (
            r.operation !== "report.read" || r.session.tier !== "paid" || !selectedCatalog ||
            !selectedCatalog.selectedSavedGuideOfferings ||
            !this.config.memberShortlistExtensions ||
            !resultObject(reportResult.analyses) || !Object.keys(reportResult.analyses).length
          ) return reportResult;
          const previousCandidates = reportResult.candidates;
          if (previousCandidates !== null) {
            if (!resultObject(previousCandidates) || previousCandidates.status !== "pending") {
              return reportResult;
            }
            const arrays = [
              "basic_university_groups", "wildcards", "pending_offerings",
              "outside_offerings", "ineligible_offerings",
            ];
            const required = ["status", "reason_code", "catalog_version", ...arrays];
            const allowed = new Set([...required, "reference_university_groups", "wildcard_selection"]);
            if (
              required.some((name) => !Object.hasOwn(previousCandidates, name)) ||
              Object.keys(previousCandidates).some((name) => !allowed.has(name)) ||
              arrays.some((name) => {
                const value = previousCandidates[name];
                return !Array.isArray(value) || value.length !== 0;
              }) ||
              ![null, "approved_candidates_missing", "current_saved_assessment_missing", "saved_assessment_missing"]
                .includes(previousCandidates.reason_code as string | null) ||
              (previousCandidates.catalog_version !== null &&
                typeof previousCandidates.catalog_version !== "string") ||
              (Object.hasOwn(previousCandidates, "reference_university_groups") &&
                (!Array.isArray(previousCandidates.reference_university_groups) ||
                  previousCandidates.reference_university_groups.length !== 0)) ||
              (Object.hasOwn(previousCandidates, "wildcard_selection") &&
                previousCandidates.wildcard_selection !== null)
            ) return reportResult;
          }
          const selectSavedGuide = selectedCatalog.selectedSavedGuideOfferings;
          if (!selectSavedGuide) return reportResult;
          if (!boundary?.admission || boundary.signal.aborted) {
            throw new AccessError("security_policy_unavailable", 503);
          }
          const reportBoundary = boundary;
          const budget = await context.budget();
          const assertActive = () => {
            if (reportBoundary.signal.aborted) throw new AccessError("security_policy_unavailable", 503);
            budget.assertRunAdmission(reportBoundary.admission as PreparedUsageAdmission, r, "active");
            requirePaidSession(r.session, this.clock.nowUtc());
          };
          assertActive();
          const record = ownedReportRead.last;
          if (
            !record || record.owner_id !== r.session.user.subjectId ||
            record.report_id !== reportResult.report_id || record.profile_id !== reportResult.profile_id ||
            record.revision !== reportResult.report_version
          ) throw new AccessError("storage_result_invalid", 503);
          if (
            !resultObject(record.body) || !resultObject(record.body.analyses) ||
            !resultObject(record.body.overall)
          ) return reportResult;
          const overall = record.body.overall;
          if (!resultObject(overall.exam)) return reportResult;
          const exam = overall.exam;
          const year = exam.academic_year, examId = exam.exam_id, packVersion = overall.pack_version;
          if (
            typeof year !== "number" || ![2024, 2025, 2026, 2027].includes(year) ||
            typeof examId !== "string" || typeof packVersion !== "string"
          ) return reportResult;
          const approvedExam = budget.policy.exams.get(examId);
          if (!approvedExam || approvedExam.academicYear !== year || approvedExam.packVersion !== packVersion) {
            return reportResult;
          }
          const savedCatalog = record.body.catalog_version;
          // Legacy snapshots without a current-head binding remain unchanged.
          if (typeof savedCatalog !== "string" || !savedCatalog.startsWith("current:")) return reportResult;
          if (
            resultObject(previousCandidates) && previousCandidates.catalog_version !== null &&
            previousCandidates.catalog_version !== savedCatalog
          ) return reportResult;
          const binding = await context.binding(), controls = await context.controls();
          if (!binding.memberJson) return reportResult;
          const limit = Math.min(100, binding.memberJson.maxItems, binding.repositoryLimits.maxBatchIds);
          if (!Number.isSafeInteger(limit) || limit < 1) throw new AccessError("security_policy_unavailable", 503);
          const allIds = Object.keys(record.body.analyses).sort(), prefix = `${year}:`;
          const ids = [
            ...allIds.filter((id) => id.startsWith(prefix)),
            ...allIds.filter((id) => !id.startsWith(prefix)),
          ].slice(0, limit);
          if (!ids.length) return reportResult;
          if (!ids.some((id) => id.startsWith(prefix) && id.length > prefix.length)) {
            return reportResult;
          }
          await context.assertCurrent(reportBoundary.signal);
          assertActive();
          const maximum = binding.repositoryLimits.maxRecordBytes;
          const settleGuide = controls.reserveExternalRead(maximum);
          const selected = await selectSavedGuide.call(
            selectedCatalog,
            r.session.user.subjectId,
            year,
            ids,
            { signal: reportBoundary.signal, maxBytes: maximum, assertActive, settle: settleGuide },
          );
          assertActive();
          if (selected.version === null) return reportResult;
          if (selected.version !== savedCatalog) return reportResult;
          const results = await context.memberResults();
          assertActive();
          const resultsMaximum = maximum * 3 + 8192;
          if (!Number.isSafeInteger(resultsMaximum)) throw new AccessError("security_policy_unavailable", 503);
          const settleResults = controls.reserveExternalRead(resultsMaximum);
          const candidates = await readSavedCandidateGroups(
            r.session,
            year,
            [...selected.rows.values()],
            selected.version,
            results,
            this.clock,
            reportBoundary.signal,
            {
              reportId: record.report_id,
              revision: record.revision,
              profileId: record.profile_id,
              examId,
              packVersion,
            },
            ids,
          );
          assertActive();
          // The SQL reader bounds each saved object; reserve the full bound without a refund.
          settleResults(resultsMaximum);
          const settleCurrent = controls.reserveExternalRead(4096);
          const current = await sql().read(r.session.user.subjectId, async (tx) =>
            await tx.query(
              `SELECT 'ok'::text FROM jungsi_backend.reports
               WHERE owner_id=$1 AND report_id=$2 AND profile_id=$3 AND revision=$4::bigint`,
              [r.session.user.subjectId, record.report_id, record.profile_id, record.revision],
              reportBoundary.signal,
            ), reportBoundary.signal);
          assertActive();
          if (current.length !== 1 || current[0].length !== 1 || current[0][0] !== "ok") {
            throw new AccessError("revision_conflict", 409);
          }
          settleCurrent(new TextEncoder().encode(JSON.stringify(current)).byteLength);
          await context.assertCurrent(reportBoundary.signal);
          assertActive();
          return { ...reportResult, candidates };
        },
      };
      const handler = createApiHandler(requestPolicies, {
        ...(studentScope ? { studentReferenceScope: studentScope } : {}),
        ...(this.currentPageEnabled
          ? {
            currentPageScope: currentPageBudgetScope(
              this.config.currentPage!,
              () => context.budget(),
              () => context.assertCurrent(),
            ),
          }
          : {}),
        ...(this.config.memberShortlistExtensions
          ? { memberShortlistScope: { assert: () => context.assertMemberShortlistScope() } }
          : {}),
        ...(this.config.readViewExtensions
          ? {
            readViewScope: { assert: () => context.assertReadViewScope() },
            representation: {
              encode: (r: ApiExecution, result: unknown) => context.encodeReadView(r, result),
            },
          }
          : {}),
        referenceProjectionAuthority: savedReportProjectionAuthority({
          repository: platform,
          lease: referenceLease,
          factoryConfigured: !!this.config.referenceFactory,
          reference,
          legacy: (r, result, admission, signal) =>
            referenceProjectionAuthorityPort(context).resolve(r, result, admission, signal),
          receipt: (signal) => context.referenceCurrentReceipt(signal),
        }),
        relay,
        admissionPermit,
        clock: this.clock,
        projection: this.projection,
        reports: platform,
        authorities,
        resources,
        business,
        completion: {
          accept: async (r, work) => {
            if (
              ["score-profile.create", "overall.analyze", "university.analyze", "candidates.build"]
                .includes(r.operation)
            ) requirePaidSession(r.session, this.clock.nowUtc());
            if (r.operation !== "score-profile.create") return await work();
            const repo = await context.scoreInputs(), budget = await context.budget();
            // Commit the request reservation first. The one-slot pool is released before input work.
            inputAdmission = await phase("budget_reserve", () => budget.admit(r));
            try {
              return await repo.accept(r.session.user.subjectId, work, async () => {
                sessionDto(r.session, this.clock.nowUtc());
                await context.assertCurrent();
                budget.assertAdmission(inputAdmission!, r);
              });
            } catch (error) {
              // A committed content rejection already includes its failure settlement.
              // Other failed frames release the existing lease after rollback, preserving request attempts.
              if (!isCommittedScoreRejection(error)) await budget.cancelAdmission(inputAdmission);
              throw error;
            } finally {
              inputAdmission = undefined;
            }
          },
          current: async () => {
            if (selectedOperation === STUDENT_REFERENCE_OPERATION_ID) {
              if (!studentReferenceReceipt || !studentScope) {
                throw new AccessError("security_policy_unavailable", 503);
              }
              return await studentScope.assertReceipt(
                studentReferenceReceipt.request,
                studentReferenceReceipt.boundary,
              );
            }
            await runtimeCompletionCurrent(
              selectedOperation,
              currentPageBudget,
              () => phase("runtime_final_current", () => context.assertCurrent()),
              () => context.assertP1R27Current(),
            );
          },
          deliver: async (r, result, id) => {
            if (
              resultObject(result) &&
              [
                "overall.analyze",
                "university.analyze",
                "candidates.build",
                "report.read",
                "report.export",
              ].includes(r.operation)
            ) {
              await workflow.deliver(
                r.session,
                r.operation,
                result,
                id,
                r.operation === "university.analyze" && resultObject(r.body) &&
                  Array.isArray(r.body.offering_ids)
                  ? r.body.offering_ids as string[]
                  : undefined,
              );
            }
          },
        },
        sessions: {
          verifyUserBearer: async (token, now) => {
            if (request.signal.aborted) throw new AccessError("auth_unavailable", 503);
            let lookup: SafeProfileLookupObservation | undefined;
            let adminReason: AdminExceptionReason | null = null;
            const auth = new SupabaseNativeAuth(
              basic().auth,
              this.fetcher,
              (event) => {
                lookup = event;
              },
              detailedAuthObserver(requestId, this.config.observeAuthDetailed),
              request.signal,
            );
            const user = await new BoundVerifiedSessionProvider(auth, auth, (reason) => {
              adminReason = reason;
            }).verifyUserBearer(token, now);
            if (request.signal.aborted) throw new AccessError("auth_unavailable", 503);
            if (lookup && this.config.observeAuth) {
              try {
                const event: SafeAuthObservation = Object.freeze({
                  kind: "profile_lookup",
                  request_id: requestId,
                  ...lookup,
                  admin_exception_reason: adminReason,
                });
                void Promise.resolve(this.config.observeAuth(event)).catch(() => {});
              } catch { /* Observation never changes authorization. */ }
            }
            if (request.signal.aborted) throw new AccessError("auth_unavailable", 503);
            return user;
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
            if (r.operation === CURRENT_PAGE_OPERATION_ID) {
              if (currentPageBudget && currentPageBudget !== budget) {
                throw new AccessError("security_policy_unavailable", 503);
              }
              currentPageBudget = budget;
            }
            const referenceOperation = (this.config.referenceFactory ||
              r.operation === "report.read" || r.operation === "report.export") && [
              "overall.analyze",
              "university.analyze",
              "candidates.build",
              "report.read",
              "report.export",
              "shortlist.update",
            ].includes(r.operation);
            if (!referenceOperation) {
              return inputAdmission
                ? await budget.runAdmitted(inputAdmission, r, work, mark)
                : await budget.run(r, work, mark);
            }
            try {
              // createApiHandler supplies ApiExecution here; reject any narrower caller.
              if (!("management" in r)) throw new AccessError("security_policy_unavailable", 503);
              const execution = r as ApiExecution;
              const result = await budget.run(
                r,
                (admission) =>
                  referenceLease.enter(execution, admission, request.signal, () => work(admission)),
                mark,
              );
              referenceLease.markSettled();
              return result;
            } catch (error) {
              referenceLease.fail();
              throw error;
            }
          },
        },
      }, requestId);
      const response = await handler(request);
      // Handler error responses are already safe; keep their status, request ID and headers.
      // Successful/redirect-class representations include conditional 304 and must be current.
      if (response.status < 400) context.assertP1R27Current();
      searchCorrelation.finish(response);
      if (response.ok) setStage("complete");
      reportTiming(response);
      return await observeRuntimeResponse(
        this.config.observe,
        response,
        selectedOperation,
        stage,
        requestId,
      );
    } catch (error) {
      const response = safeFailure(error, requestId);
      searchCorrelation.finish(response);
      reportTiming(response);
      return await observeRuntimeResponse(
        this.config.observe,
        response,
        selectedOperation,
        stage,
        requestId,
      );
    } finally {
      try {
        closeP1R27?.();
      } catch { /* Never change the response during cleanup. */ }
    }
  };
  async close(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.close()));
  }
}
