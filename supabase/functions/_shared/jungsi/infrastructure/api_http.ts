import { assertAdmissionOrConsume } from "../application/service_end_admission.ts";
import { personalResultComponents, resultObject } from "../application/paid_result_components.ts";
import { ReferenceReceiptExpired, ReferenceReceiptInvalidated } from "../application/access.ts";
/** All 25 HTTP routes (legacy 22 plus policy 3). Concrete business/provider/budget wiring is supplied separately. */
import { AccessError, authorizeReport } from "../application/access.ts";
import {
  API_OPERATION_IDS,
  type ApiBusinessPort,
  type ApiExecution,
  type ApiExecutionBoundary,
  type ApiRoutePolicy,
  CURRENT_PAGE_OPERATION_ID,
  CURRENT_PAGE_ROUTE_PATH,
  isCurrentPagePolicy,
  isStudentReferencePolicy,
  MEMBER_SHORTLIST_OPERATION_IDS,
  MEMBER_SHORTLIST_ROUTE_PATHS,
  READ_VIEW_OPERATION_IDS,
  READ_VIEW_REGISTERED_API_OPERATION_IDS,
  READ_VIEW_ROUTE_PATHS,
  REGISTERED_API_OPERATION_IDS,
  STUDENT_REFERENCE_OPERATION_ID,
  STUDENT_REFERENCE_ROUTE_PATH,
} from "../application/api_dispatch.ts";
import {
  authorizeManagement,
  MANAGEMENT_OPERATIONS,
  type ManagementDecision,
  type ManagementOperation,
  requireManagementUniversity,
} from "../application/management_access.ts";
import type {
  ForecastAuthorityPort,
  ManagementResourcePort,
  PublicPassPort,
  ReportAccess,
  RequestClockPort,
  UserSessionPort,
} from "../application/ports.ts";
import {
  publicJsonText,
  PublicResponseProjection,
  type ReferenceProjectionAuthority,
  type WildcardProjectionAuthority,
} from "../application/public_response.ts";
import { BUDGET_OPERATIONS, type RequestBudgetPort } from "../application/request_budget.ts";
import {
  isVerifiedAdminSnapshot,
  readSessionSnapshot,
  sessionDto,
  type SessionSnapshot,
} from "../application/session_service.ts";
import { type NativeJson, parseNativeJson } from "../domain/native_json.ts";
import { RelayBoundary, safeFailure } from "./auth_relay.ts";
export const API_REQUEST_STAGES = [
  "route",
  "relay",
  "user_session",
  "member_access",
  "owner_access",
  "management_access",
  "request_body",
  "business",
  "business_session",
  "response_projection",
  "budget",
  "final_session",
  "final_projection",
  "response_serialization",
  "response_current",
  "response_delivery",
  "response_acceptance",
] as const;
export type ApiRequestStage = typeof API_REQUEST_STAGES[number];
export interface ApiHttpPorts {
  readonly admissionPermit?: object;
  /** Entirely optional route. Budget/schema/issuer are independently provisioned, never defaulted. */
  readonly studentReferenceScope?: {
    readonly budget: RequestBudgetPort;
    readonly projection: PublicResponseProjection;
    assert(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    assertCurrent(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    /** Settled request-local receipt; MUST NOT initiate I/O. */
    assertReceipt(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    readonly schemaAuthority: {
      assert(
        request: ApiExecution,
        boundary: ApiExecutionBoundary,
        binding: Readonly<
          {
            operation: string;
            contract_ref: string;
            schema_sha256: string;
            schema_bytes_sha256: string;
          }
        >,
        phase: "active" | "settled_success",
      ): Promise<void>;
    };
  };
  readonly representation?: {
    encode(
      request: ApiExecution,
      result: unknown,
    ): Promise<
      {
        body: Uint8Array<ArrayBuffer> | null;
        status: 200 | 304;
        etag: string;
        gzip: boolean;
        snapshotId?: string;
        publicationSha256?: string;
      } | null
    >;
  };
  /** Explicit candidate opt-in; must verify the approved v2 binding before any new work. */
  readonly readViewScope?: { assert(operation: ApiExecution["operation"]): Promise<void> };
  readonly memberShortlistScope?: { assert(): Promise<void> };
  /** Explicit opt-in to a separately authorized candidate; no default authority. */
  readonly currentPageScope?: {
    assert(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    /** Final external/head validation while this request's reservation is active. */
    assertCurrent(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    /** Request-local settled receipt only: no new DB, Storage or business I/O. */
    assertReceipt(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<void>;
    readonly projection: PublicResponseProjection;
    readonly schemaAuthority: {
      /** Independently approve this request, admission, operation, contract and exact schema pin. */
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
  readonly relay: RelayBoundary;
  readonly sessions: UserSessionPort;
  readonly passes: PublicPassPort;
  readonly clock: RequestClockPort;
  readonly reports: {
    lookupAccess(owner: string, reportId: string): Promise<ReportAccess | null>;
  };
  readonly authorities: ForecastAuthorityPort;
  readonly resources: ManagementResourcePort;
  readonly projection: PublicResponseProjection;
  /** Optional approved, request-bound immutable-revision verifier; absent in the runtime. */
  readonly wildcardProjectionAuthority?: {
    resolve(
      request: ApiExecution,
      result: unknown,
      admission: unknown,
      signal: AbortSignal,
    ): Promise<WildcardProjectionAuthority | null>;
  };
  /** Optional independent exact-revision reference proof; not installed by default. */
  readonly referenceProjectionAuthority?: {
    resolve(
      request: ApiExecution,
      result: unknown,
      admission: unknown,
      signal: AbortSignal,
    ): Promise<ReferenceProjectionAuthority | null>;
  };
  readonly budget: RequestBudgetPort;
  readonly business: ApiBusinessPort;
  readonly completion?: {
    accept<T>(request: ApiExecution, work: () => Promise<T>): Promise<T>;
    deliver(request: ApiExecution, result: unknown, requestId: string): Promise<void>;
    current(): Promise<void>;
  };
  /** Constant phase names only. Observation failures cannot change request behavior. */
  readonly onStage?: (stage: ApiRequestStage) => void;
}
interface Route {
  policy: ApiRoutePolicy;
  pattern: RegExp;
  keys: string[];
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function configuration(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function hasPrivateWildcardReport(value: unknown, operation: string): boolean {
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  let report = value;
  if (operation === "report.export" && object(report)) report = report.report;
  if (!object(report)) return false;
  const selected = object(report.candidates)
    ? report.candidates
    : object(report.read_only_snapshot) && object(report.read_only_snapshot.candidates)
    ? report.read_only_snapshot.candidates
    : null;
  return !!selected && Object.hasOwn(selected, "_wildcard_selection_view");
}
function hasPrivateReferenceReport(value: unknown, operation: string): boolean {
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  let report = value;
  if (operation === "report.export" && object(report)) report = report.report;
  if (!object(report)) return false;
  const views = [report, ...(object(report.read_only_snapshot) ? [report.read_only_snapshot] : [])];
  return views.some((view) =>
    object(view.candidates) && Object.hasOwn(view.candidates, "reference_university_groups") ||
    object(view.analyses) &&
      Object.values(view.analyses).some((a) =>
        object(a) && Object.hasOwn(a, "reference_percentile")
      )
  );
}
function routes(
  policies: readonly ApiRoutePolicy[],
  extended = false,
  memberShortlist = false,
  currentPage = false,
  studentReference = false,
): Route[] {
  const base = memberShortlist
    ? REGISTERED_API_OPERATION_IDS
    : extended
    ? READ_VIEW_REGISTERED_API_OPERATION_IDS
    : API_OPERATION_IDS;
  const expected: readonly string[] = [
    ...base,
    ...(currentPage ? [CURRENT_PAGE_OPERATION_ID] : []),
    ...(studentReference ? [STUDENT_REFERENCE_OPERATION_ID] : []),
  ];
  if (
    !Array.isArray(policies) || policies.length !== expected.length ||
    new Set(policies.map((p) => p?.id)).size !== expected.length ||
    expected.some((id) => !policies.some((p) => p?.id === id))
  ) configuration();
  const result = policies.map((policy: ApiRoutePolicy) => {
    if (
      policy?.id === STUDENT_REFERENCE_OPERATION_ID &&
      (!studentReference || !isStudentReferencePolicy(policy) ||
        policy.path !== STUDENT_REFERENCE_ROUTE_PATH)
    ) configuration();
    if (policy?.id === CURRENT_PAGE_OPERATION_ID) {
      if (
        !currentPage || !extended || policy.method !== "GET" ||
        policy.path !== CURRENT_PAGE_ROUTE_PATH || policy.member_tiers?.length !== 2 ||
        !policy.member_tiers.includes("standard") || !policy.member_tiers.includes("paid") ||
        policy.report_owner !== false || policy.confirmed_score_profile !== false
      ) configuration();
    }
    if (policy && MEMBER_SHORTLIST_OPERATION_IDS.some((id) => id === policy.id)) {
      const id = policy.id as typeof MEMBER_SHORTLIST_OPERATION_IDS[number];
      if (
        policy.path !== MEMBER_SHORTLIST_ROUTE_PATHS[id] ||
        policy.method !== (id === "member-shortlist.read" ? "GET" : "PUT") ||
        policy.member_tiers?.length !== 1 || policy.member_tiers[0] !== "paid" ||
        policy.report_owner !== false || policy.confirmed_score_profile !== false
      ) configuration();
    }
    if (policy && READ_VIEW_OPERATION_IDS.some((id) => id === policy.id)) {
      const id = policy.id as typeof READ_VIEW_OPERATION_IDS[number];
      if (
        policy.method !== "GET" || policy.path !== READ_VIEW_ROUTE_PATHS[id] ||
        policy.member_tiers?.length !== 2 || !policy.member_tiers.includes("standard") ||
        !policy.member_tiers.includes("paid") || policy.report_owner !== false ||
        policy.confirmed_score_profile !== false
      ) configuration();
    }
    if (
      !policy || !(REGISTERED_API_OPERATION_IDS as readonly string[]).includes(policy.id) &&
        policy.id !== CURRENT_PAGE_OPERATION_ID && policy.id !== STUDENT_REFERENCE_OPERATION_ID ||
      !["GET", "POST", "PUT"].includes(policy.method) ||
      typeof policy.path !== "string" ||
      !/^\/api\/v1\/[A-Za-z0-9_{}./:-]+$/.test(policy.path) ||
      typeof policy.report_owner !== "boolean" ||
      typeof policy.confirmed_score_profile !== "boolean" ||
      !Array.isArray(policy.member_tiers) || !policy.member_tiers.length ||
      policy.member_tiers.some((t) => !["standard", "paid"].includes(t)) ||
      new Set(policy.member_tiers).size !== policy.member_tiers.length
    ) configuration();
    const keys: string[] = [];
    const segments = policy.path.split("/").map((part) => {
      const match = /^\{([a-z_]+)\}$/.exec(part);
      if (match) {
        if (
          !["offering_id", "report_id", "draft_id", "snapshot_id"].includes(match[1]) ||
          keys.includes(match[1])
        ) configuration();
        keys.push(match[1]);
        return "([^/]+)";
      }
      if (part.includes("{") || part.includes("}")) configuration();
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    if (
      policy.confirmed_score_profile && !policy.report_owner ||
      policy.report_owner && !keys.includes("report_id")
    ) configuration();
    return {
      policy: { ...policy, member_tiers: [...policy.member_tiers] },
      keys,
      pattern: new RegExp("^" + segments.join("/") + "$"),
    };
  });
  if (
    new Set(result.map((r) => r.policy.method + " " + r.policy.path)).size !==
      result.length
  ) {
    configuration();
  }
  return result.sort((a, b) =>
    a.keys.length - b.keys.length || b.policy.path.length - a.policy.path.length
  );
}
function bearer(headers: Headers): string {
  const match = /^Bearer ([^\s,]+)$/.exec(headers.get("Authorization") ?? "");
  if (
    !match || match[1].length > 16384 ||
    /^sb_(?:publishable|secret)_/.test(match[1])
  ) {
    throw new AccessError("authentication_required", 401);
  }
  return match[1];
}
async function body(request: Request): Promise<NativeJson> {
  if (!["POST", "PUT"].includes(request.method)) return {};
  const declared = request.headers.get("Content-Length");
  if (
    declared !== null &&
    (declared.length > 20 || !/^\d+$/.test(declared) ||
      BigInt(declared) > 200000n)
  ) {
    throw new AccessError("request_too_large", 413);
  }
  const chunks: Uint8Array[] = [];
  let count = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        count += part.value.byteLength;
        if (count > 200000) {
          await reader.cancel();
          throw new AccessError("request_too_large", 413);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return parseNativeJson(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new AccessError("invalid_json", 422);
  }
}
function query(url: URL): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) {
      throw new AccessError("duplicate_query_field", 422);
    }
    result[key] = value;
  }
  return result;
}
async function management(
  policy: ApiRoutePolicy,
  session: SessionSnapshot,
  params: Record<string, string>,
  ports: ApiHttpPorts,
): Promise<ManagementDecision | null> {
  if (!MANAGEMENT_OPERATIONS.includes(policy.id as ManagementOperation)) {
    return null;
  }
  const decision = await authorizeManagement(
    session.user,
    ports.authorities,
    session.evaluatedAtUtc,
    policy.id as ManagementOperation,
  );
  const kind = policy.id === "forecast.create" ? "offering" : params.draft_id ? "draft" : null;
  if (kind) {
    const id = params[kind === "offering" ? "offering_id" : "draft_id"];
    if (!IDENTIFIER.test(id)) throw new AccessError("forecast_not_found", 404);
    let resource;
    try {
      resource = await ports.resources.readScope(
        kind,
        id,
        session.user.subjectId,
      );
    } catch {
      throw new AccessError("backend_dependency_unavailable", 503);
    }
    if (!resource) throw new AccessError("forecast_not_found", 404);
    if (
      resource.kind !== kind || resource.id !== id ||
      typeof resource.universityId !== "string"
    ) {
      throw new AccessError("invalid_repository_result", 503);
    }
    requireManagementUniversity(decision, resource.universityId);
  }
  return decision;
}
export function createApiHandler(
  policies: readonly ApiRoutePolicy[],
  ports: ApiHttpPorts,
  internalRequestId?: string,
): (request: Request) => Promise<Response> {
  // Internal runtime-generated correlation only; never derive this value from a client header.
  if (internalRequestId !== undefined && !/^[a-f0-9]{32}$/.test(internalRequestId)) {
    configuration();
  }
  const candidates = policies.filter((p) => p?.id === CURRENT_PAGE_OPERATION_ID);
  const currentPageEnabled = candidates.length === 1 && isCurrentPagePolicy(candidates[0]) &&
    !!ports.readViewScope && typeof ports.currentPageScope?.assert === "function" &&
    typeof ports.currentPageScope?.assertCurrent === "function" &&
    typeof ports.currentPageScope?.assertReceipt === "function" &&
    typeof ports.currentPageScope?.schemaAuthority?.assert === "function" &&
    ports.currentPageScope.projection instanceof PublicResponseProjection &&
    ports.currentPageScope.projection.hasExactRegistryBytes() &&
    ports.currentPageScope.projection.supportsOperation(
      CURRENT_PAGE_OPERATION_ID,
      candidates[0].contract_ref!,
    ) &&
    !policies.some((p) =>
      p?.id !== CURRENT_PAGE_OPERATION_ID &&
      p?.method === candidates[0].method && p?.path === candidates[0].path
    );
  const studentCandidates = policies.filter((p) => p?.id === STUDENT_REFERENCE_OPERATION_ID);
  const studentScope = ports.studentReferenceScope;
  const studentEnabled = studentCandidates.length === 1 &&
    isStudentReferencePolicy(studentCandidates[0]) &&
    !!studentScope && typeof studentScope.budget?.run === "function" &&
    typeof studentScope.assert === "function" && typeof studentScope.assertCurrent === "function" &&
    typeof studentScope.assertReceipt === "function" &&
    typeof studentScope.schemaAuthority?.assert === "function" &&
    studentScope.projection instanceof PublicResponseProjection &&
    studentScope.projection.hasExactRegistryBytes() &&
    studentScope.projection.supportsOperation(
      STUDENT_REFERENCE_OPERATION_ID,
      studentCandidates[0].contract_ref!,
    ) &&
    !policies.some((p) =>
      p?.id !== STUDENT_REFERENCE_OPERATION_ID &&
      p?.method === studentCandidates[0].method && p?.path === studentCandidates[0].path
    );
  const currentPageAssert = currentPageEnabled
    ? ports.currentPageScope!.assert.bind(ports.currentPageScope)
    : null;
  const currentPageProjection = currentPageEnabled ? ports.currentPageScope!.projection : null;
  const currentPageRecheck = currentPageEnabled
    ? ports.currentPageScope!.assertCurrent.bind(ports.currentPageScope)
    : null;
  const currentPageReceipt = currentPageEnabled
    ? ports.currentPageScope!.assertReceipt.bind(ports.currentPageScope)
    : null;
  const schemaAssert = currentPageEnabled
    ? ports.currentPageScope!.schemaAuthority.assert.bind(ports.currentPageScope!.schemaAuthority)
    : null;
  const effectivePolicies = policies.filter((p) =>
    (currentPageEnabled || p?.id !== CURRENT_PAGE_OPERATION_ID) &&
    (studentEnabled || p?.id !== STUDENT_REFERENCE_OPERATION_ID)
  );
  const registered = routes(
    effectivePolicies,
    ports.readViewScope !== undefined,
    ports.memberShortlistScope !== undefined,
    currentPageEnabled,
    studentEnabled,
  );
  if (
    ports.memberShortlistScope &&
    (!ports.readViewScope || typeof ports.memberShortlistScope.assert !== "function")
  ) configuration();
  if (ports.readViewScope && typeof ports.readViewScope.assert !== "function") configuration();
  if (
    !ports?.budget || typeof ports.budget.run !== "function" ||
    !ports.business ||
    typeof ports.business.execute !== "function"
  ) configuration();
  return async (request) => {
    const requestId = internalRequestId ?? crypto.randomUUID().replaceAll("-", "");
    const stage = (value: ApiRequestStage) => {
      try {
        const pending: unknown = ports.onStage?.(value);
        if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(pending).catch(() => {});
        }
      } catch { /* Observability is not authorization. */ }
    };
    try {
      stage("route");
      const url = new URL(request.url),
        matches = registered.filter((r) => r.pattern.test(url.pathname));
      const route = matches.find((r) => r.policy.method === request.method);
      if (!route) {
        throw new AccessError(
          matches.length ? "method_not_allowed" : "route_not_found",
          matches.length ? 405 : 404,
        );
      }
      const policy = route.policy,
        match = route.pattern.exec(url.pathname)!,
        params = Object.fromEntries(
          route.keys.map((key, i) => [key, match[i + 1]]),
        );
      stage("relay");
      await ports.relay.verify(request.headers);
      assertAdmissionOrConsume(() => ports.clock.nowUtc(), request, ports.admissionPermit);
      stage("user_session");
      const session = await readSessionSnapshot(
        bearer(request.headers),
        ports.sessions,
        ports.passes,
        ports.clock.nowUtc(),
      );
      stage("member_access");
      if (!policy.member_tiers.includes(session.tier)) {
        throw new AccessError("paid_required", 403);
      }
      if (MEMBER_SHORTLIST_OPERATION_IDS.some((id) => id === policy.id)) {
        if (!ports.memberShortlistScope) configuration();
        await ports.memberShortlistScope.assert();
      }
      if (
        policy.id === CURRENT_PAGE_OPERATION_ID ||
        READ_VIEW_OPERATION_IDS.some((id) => id === policy.id)
      ) {
        if (!ports.readViewScope) configuration();
        await ports.readViewScope.assert(policy.id);
      }
      if (policy.report_owner) {
        stage("owner_access");
        await authorizeReport(session.user, params.report_id ?? "", {
          find: (id) =>
            IDENTIFIER.test(id)
              ? ports.reports.lookupAccess(session.user.subjectId, id)
              : Promise.resolve(null),
        }, policy.confirmed_score_profile);
      }
      stage("management_access");
      if (policy.id === "score-input.correction.grant" && !isVerifiedAdminSnapshot(session)) {
        throw new AccessError("management_mfa_required", 403);
      }
      const decision = await management(policy, session, params, ports);
      // Authorization is complete before consuming any untrusted body or query.
      stage("request_body");
      const selectedQuery = query(url);
      if (
        policy.method !== "GET" && policy.id !== "member-shortlist.update" &&
        Object.keys(selectedQuery).length > 0
      ) {
        throw new AccessError("invalid_request", 422);
      }
      const payload = await body(request);
      for (const id of Object.values(params)) {
        if (!IDENTIFIER.test(id)) {
          throw new AccessError("invalid_identifier", 422);
        }
      }
      const selected = {
        operation: policy.id,
        session,
        management: decision,
        body: payload,
        query: selectedQuery,
        params,
        requestKey: request.headers.get("Idempotency-Key"),
      };
      if (policy.id === CURRENT_PAGE_OPERATION_ID || policy.id === STUDENT_REFERENCE_OPERATION_ID) {
        Object.freeze(selectedQuery);
        Object.freeze(params);
        Object.freeze(selected);
      }
      let authority: WildcardProjectionAuthority | null = null;
      let referenceAuthority: ReferenceProjectionAuthority | null = null;
      let pageContext: {
        boundary: ApiExecutionBoundary;
        schema: Readonly<{
          operation: string;
          contract_ref: string;
          schema_sha256: string;
          schema_bytes_sha256: string;
        }>;
      } | null = null;
      let pageCurrentVerified = false;
      let studentContext: {
        boundary: ApiExecutionBoundary;
        schema: Readonly<{
          operation: string;
          contract_ref: string;
          schema_sha256: string;
          schema_bytes_sha256: string;
        }>;
      } | null = null;
      let studentCurrentVerified = false;
      let firstStudentProjection: string | null = null;
      const checkStudentReceipt = async () => {
        if (
          !studentEnabled || !studentScope || !studentContext || !studentCurrentVerified ||
          studentContext.boundary.signal.aborted
        ) configuration();
        if (
          await studentScope.assertReceipt(selected, studentContext.boundary) !== undefined ||
          await studentScope.schemaAuthority.assert(
              selected,
              studentContext.boundary,
              studentContext.schema,
              "settled_success",
            ) !== undefined
        ) configuration();
        const current = await studentScope.projection.schemaBinding(
          STUDENT_REFERENCE_OPERATION_ID,
          policy.contract_ref!,
        );
        if (
          current.operation !== studentContext.schema.operation ||
          current.contract_ref !== studentContext.schema.contract_ref ||
          current.schema_sha256 !== studentContext.schema.schema_sha256 ||
          current.schema_bytes_sha256 !== studentContext.schema.schema_bytes_sha256 ||
          studentContext.boundary.signal.aborted
        ) configuration();
      };
      const checkPageReceipt = async () => {
        if (
          !pageContext || !pageCurrentVerified || !currentPageReceipt || !currentPageProjection ||
          pageContext.boundary.signal.aborted
        ) configuration();
        if (await currentPageReceipt(selected, pageContext.boundary) !== undefined) configuration();
        const current = await currentPageProjection.schemaBinding(
          CURRENT_PAGE_OPERATION_ID,
          policy.contract_ref!,
        );
        if (
          current.operation !== pageContext.schema.operation ||
          current.contract_ref !== pageContext.schema.contract_ref ||
          current.schema_sha256 !== pageContext.schema.schema_sha256 ||
          current.schema_bytes_sha256 !== pageContext.schema.schema_bytes_sha256
        ) configuration();
        if (pageContext.boundary.signal.aborted) configuration();
      };
      const requirePageCountNull = (value: unknown) => {
        if (
          !value || typeof value !== "object" || Array.isArray(value) ||
          !Object.hasOwn(value, "matching_count") ||
          (value as Record<string, unknown>).matching_count !== null
        ) configuration();
      };
      let trustedRaw: unknown, firstProjection: string | null = null;
      let firstPageProjection: string | null = null;
      const work = async (admission?: unknown) => {
        stage("business");
        const rawBoundary = { signal: request.signal, admission };
        const boundary =
          policy.id === CURRENT_PAGE_OPERATION_ID || policy.id === STUDENT_REFERENCE_OPERATION_ID
            ? Object.freeze(rawBoundary)
            : rawBoundary;
        if (policy.id === CURRENT_PAGE_OPERATION_ID) {
          if (
            !currentPageAssert || !currentPageProjection || !schemaAssert || !admission ||
            boundary.signal.aborted
          ) configuration();
          const schema = await currentPageProjection.schemaBinding(
            CURRENT_PAGE_OPERATION_ID,
            policy.contract_ref!,
          );
          if (await schemaAssert(selected, boundary, schema, "active") !== undefined) {
            configuration();
          }
          if (await currentPageAssert(selected, boundary) !== undefined) configuration();
          if (boundary.signal.aborted || selected.operation !== CURRENT_PAGE_OPERATION_ID) {
            configuration();
          }
          sessionDto(session, ports.clock.nowUtc());
          pageContext = Object.freeze({ boundary, schema });
        }
        if (policy.id === STUDENT_REFERENCE_OPERATION_ID) {
          if (!studentEnabled || !studentScope || !admission || boundary.signal.aborted) {
            configuration();
          }
          const schema = await studentScope.projection.schemaBinding(
            STUDENT_REFERENCE_OPERATION_ID,
            policy.contract_ref!,
          );
          if (
            await studentScope.schemaAuthority.assert(selected, boundary, schema, "active") !==
              undefined ||
            await studentScope.assert(selected, boundary) !== undefined || boundary.signal.aborted
          ) configuration();
          sessionDto(session, ports.clock.nowUtc());
          studentContext = Object.freeze({ boundary, schema });
        }
        const result = policy.id === "session.read"
          ? sessionDto(session, ports.clock.nowUtc())
          : await ports.business.execute(selected, boundary);
        if (policy.id === CURRENT_PAGE_OPERATION_ID) requirePageCountNull(result);
        if (
          policy.id === "session.read" &&
          (Object.keys(selectedQuery).length ||
            request.headers.get("Content-Length") &&
              request.headers.get("Content-Length") !== "0")
        ) throw new AccessError("invalid_request", 422);
        stage("business_session");
        sessionDto(session, ports.clock.nowUtc());
        stage("response_projection");
        if (
          ports.wildcardProjectionAuthority && [
            "overall.analyze",
            "university.analyze",
            "candidates.build",
            "report.read",
            "report.export",
            "shortlist.update",
          ].includes(policy.id) && hasPrivateWildcardReport(result, policy.id)
        ) {
          if (request.signal.aborted) configuration();
          // An absent or failing proof source must leave old response and cards intact.
          if (admission !== null && admission !== undefined) {
            try {
              authority = await ports.wildcardProjectionAuthority.resolve(
                selected,
                result,
                admission,
                request.signal,
              );
              if (authority) await authority.assertCurrent(request.signal);
            } catch {
              authority = null;
            }
          }
          if (request.signal.aborted) configuration();
        }
        if (
          ports.referenceProjectionAuthority &&
          [
            "overall.analyze",
            "university.analyze",
            "candidates.build",
            "report.read",
            "report.export",
            "shortlist.update",
          ].includes(policy.id) && hasPrivateReferenceReport(result, policy.id) &&
          admission !== null && admission !== undefined
        ) {
          try {
            referenceAuthority = await ports.referenceProjectionAuthority.resolve(
              selected,
              result,
              admission,
              request.signal,
            );
            if (referenceAuthority && typeof referenceAuthority.assertSettled !== "function") {
              referenceAuthority = null;
            }
            if (referenceAuthority) await referenceAuthority.assertCurrent(request.signal);
          } catch {
            referenceAuthority = null;
          }
          if (request.signal.aborted) configuration();
        }
        const projection = policy.id === CURRENT_PAGE_OPERATION_ID
          ? currentPageProjection!
          : policy.id === STUDENT_REFERENCE_OPERATION_ID
          ? studentScope!.projection
          : ports.projection;
        const projected = projection.project(
          policy.id,
          session.tier,
          result,
          authority ?? undefined,
          referenceAuthority ?? undefined,
        );
        if (policy.id === CURRENT_PAGE_OPERATION_ID) {
          requirePageCountNull(projected);
          firstPageProjection = publicJsonText(projected);
          if (!pageContext || !currentPageRecheck || !schemaAssert || boundary.signal.aborted) {
            configuration();
          }
          if (
            await currentPageRecheck(selected, boundary) !== undefined ||
            await schemaAssert(selected, boundary, pageContext.schema, "active") !== undefined
          ) configuration();
          if (boundary.signal.aborted) configuration();
          sessionDto(session, ports.clock.nowUtc());
          pageCurrentVerified = true;
        }
        if (policy.id === STUDENT_REFERENCE_OPERATION_ID) {
          if (!studentScope || !studentContext || boundary.signal.aborted) configuration();
          firstStudentProjection = publicJsonText(projected);
          if (
            await studentScope.assertCurrent(selected, boundary) !== undefined ||
            await studentScope.schemaAuthority.assert(
                selected,
                boundary,
                studentContext.schema,
                "active",
              ) !== undefined ||
            boundary.signal.aborted
          ) configuration();
          sessionDto(session, ports.clock.nowUtc());
          studentCurrentVerified = true;
        }
        if (authority || referenceAuthority) {
          trustedRaw = result;
          firstProjection = publicJsonText(projected);
        }
        // Last external reference source/report check happens before the shared lease settles.
        if (referenceAuthority) await referenceAuthority.assertCurrent(request.signal);
        return projected;
      };
      const complete = async () => {
        stage("budget");
        let result = policy.id === STUDENT_REFERENCE_OPERATION_ID
          ? await studentScope!.budget.run(selected, work)
          : BUDGET_OPERATIONS.includes(
              policy.id as typeof BUDGET_OPERATIONS[number],
            )
          ? await ports.budget.run(selected, work)
          : await work();
        if (policy.id === CURRENT_PAGE_OPERATION_ID) await checkPageReceipt();
        if (policy.id === STUDENT_REFERENCE_OPERATION_ID) await checkStudentReceipt();
        // Budget settlement or a future cache hit must still pass the final boundary.
        stage("final_session");
        sessionDto(session, ports.clock.nowUtc());
        stage("final_projection");
        const projection = policy.id === CURRENT_PAGE_OPERATION_ID
          ? currentPageProjection!
          : policy.id === STUDENT_REFERENCE_OPERATION_ID
          ? studentScope!.projection
          : ports.projection;
        // An expired/revoked optional reference may be removed only from an owned report read.
        // Session, cancellation, other authority and shared-budget failures still fail closed.
        const withoutReference = (error: unknown) => {
          if (
            policy.id !== "report.read" || request.signal.aborted ||
            !(error instanceof ReferenceReceiptExpired ||
              error instanceof ReferenceReceiptInvalidated)
          ) throw error;
          sessionDto(session, ports.clock.nowUtc());
          const reduced = projection.project(
            policy.id,
            session.tier,
            trustedRaw,
            authority ?? undefined,
          );
          referenceAuthority = null;
          firstProjection = authority ? publicJsonText(reduced) : null;
          return reduced;
        };
        if (authority && firstProjection !== null) {
          await authority.assertCurrent(request.signal);
        }
        if (referenceAuthority && firstProjection !== null) {
          try {
            referenceAuthority.assertSettled!(request.signal);
          } catch (error) {
            result = withoutReference(error);
          }
        }
        let approved = (authority || referenceAuthority) && firstProjection !== null
          ? projection.project(
            policy.id,
            session.tier,
            trustedRaw,
            authority ?? undefined,
            referenceAuthority ?? undefined,
          )
          : projection.project(policy.id, session.tier, result);
        if (policy.id === CURRENT_PAGE_OPERATION_ID) {
          requirePageCountNull(result);
          requirePageCountNull(approved);
          if (
            firstPageProjection === null || publicJsonText(result) !== firstPageProjection ||
            publicJsonText(approved) !== firstPageProjection
          ) configuration();
        }
        if (
          policy.id === STUDENT_REFERENCE_OPERATION_ID &&
          (firstStudentProjection === null || publicJsonText(result) !== firstStudentProjection ||
            publicJsonText(approved) !== firstStudentProjection)
        ) configuration();
        // Identity or a request-local cache is only transport: the independent authority
        // must approve both passes and the settled representation must match byte-for-byte.
        if (
          (authority || referenceAuthority) && firstProjection !== null &&
          (request.signal.aborted || publicJsonText(result) !== firstProjection ||
            publicJsonText(approved) !== firstProjection)
        ) configuration();
        stage("response_serialization");
        const encoded =
          policy.id === CURRENT_PAGE_OPERATION_ID || policy.id === STUDENT_REFERENCE_OPERATION_ID
            ? null
            : await ports.representation?.encode(selected, approved);
        if (
          encoded &&
          (!READ_VIEW_OPERATION_IDS.some((id) => id === policy.id) ||
            !/^"[a-f0-9]{64}"$/.test(encoded.etag) || ![200, 304].includes(encoded.status) ||
            encoded.status === 304 && encoded.body !== null ||
            encoded.status === 200 && !(encoded.body instanceof Uint8Array) ||
            encoded.snapshotId !== undefined && !IDENTIFIER.test(encoded.snapshotId) ||
            encoded.publicationSha256 !== undefined &&
              !/^[a-f0-9]{64}$/.test(encoded.publicationSha256))
        ) configuration();
        const responseBody = encoded ? encoded.body : publicJsonText(approved);
        // encode() is asynchronous: compare the actual immutable wire body after it returns.
        if (
          policy.id === CURRENT_PAGE_OPERATION_ID &&
          (typeof responseBody !== "string" || responseBody !== firstPageProjection)
        ) configuration();
        let response = new Response(responseBody, {
          status: encoded
            ? encoded.status
            : ["score-profile.create", "overall.analyze"].includes(policy.id)
            ? 201
            : 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Request-ID": requestId,
            ...(encoded ? { ETag: encoded.etag } : {}),
            ...(encoded?.gzip ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}),
            ...(encoded?.snapshotId ? { "X-Jungsi-Snapshot-ID": encoded.snapshotId } : {}),
            ...(encoded?.publicationSha256
              ? { "X-Publication-SHA256": encoded.publicationSha256 }
              : {}),
          },
        });
        stage("response_current");
        await ports.completion?.current();
        sessionDto(session, ports.clock.nowUtc());
        if (policy.id === CURRENT_PAGE_OPERATION_ID) await checkPageReceipt();
        if (policy.id === STUDENT_REFERENCE_OPERATION_ID) await checkStudentReceipt();
        if (policy.id === CURRENT_PAGE_OPERATION_ID) {
          requirePageCountNull(result);
          requirePageCountNull(approved);
          if (
            firstPageProjection === null || publicJsonText(result) !== firstPageProjection ||
            publicJsonText(approved) !== firstPageProjection
          ) {
            configuration();
          }
        }
        // This check is before any delivery receipt. It narrows one race only;
        // the later receipt and actual transport are not atomic with revocation.
        if ((authority || referenceAuthority) && firstProjection !== null) {
          if (authority) await authority.assertCurrent(request.signal);
          if (referenceAuthority) {
            try {
              referenceAuthority.assertSettled!(request.signal);
            } catch (error) {
              result = withoutReference(error);
              approved = result;
              response = new Response(publicJsonText(approved), {
                status: response.status,
                headers: response.headers,
              });
            }
          }
          if (
            (authority || referenceAuthority) && firstProjection !== null &&
            (request.signal.aborted ||
              publicJsonText(
                  ports.projection.project(
                    policy.id,
                    session.tier,
                    trustedRaw,
                    authority ?? undefined,
                    referenceAuthority ?? undefined,
                  ),
                ) !==
                firstProjection)
          ) configuration();
          sessionDto(session, ports.clock.nowUtc());
        }
        stage("response_delivery");
        await ports.completion?.deliver(selected, approved, requestId);
        // Delivery bookkeeping may itself take time. Recheck only the local reference
        // receipt immediately before returning; never open a new external read here.
        if (referenceAuthority && firstProjection !== null) {
          try {
            referenceAuthority.assertSettled!(request.signal);
          } catch (error) {
            const reduced = withoutReference(error);
            // A completed delivery receipt must describe exactly the same paid components.
            // If removing reference fields changes that set, retain the original failure.
            if (
              !resultObject(approved) || !resultObject(reduced) ||
              JSON.stringify([...personalResultComponents(approved)].sort()) !==
                JSON.stringify([...personalResultComponents(reduced)].sort())
            ) throw error;
            result = reduced;
            approved = reduced;
            response = new Response(publicJsonText(approved), {
              status: response.status,
              headers: response.headers,
            });
          }
        }
        if (policy.id === STUDENT_REFERENCE_OPERATION_ID) {
          await checkStudentReceipt();
          if (
            firstStudentProjection === null || publicJsonText(result) !== firstStudentProjection ||
            publicJsonText(approved) !== firstStudentProjection || request.signal.aborted
          ) configuration();
          sessionDto(session, ports.clock.nowUtc());
        }
        return response;
      };
      stage("response_acceptance");
      return ports.completion
        ? await ports.completion.accept(selected, complete)
        : await complete();
    } catch (error) {
      return safeFailure(error, requestId);
    }
  };
}
