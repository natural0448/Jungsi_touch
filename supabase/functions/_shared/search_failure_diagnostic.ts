/**
 * REVIEW ONLY: request-local fixed-enum diagnostics for offerings.search.
 * No source/coverage policy, data query, authorization, response or error is changed.
 * Callers must inject an approved server-only sink, never an HTTP-provided callback.
 */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApiExecution } from "./jungsi/application/api_dispatch.ts";
import type { CatalogDataPort } from "./jungsi/application/catalog.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import type { NativeObject } from "./jungsi/domain/json_value.ts";
import {
  type CurrentPublicCatalogPort,
  CurrentPublicCatalogService,
  type CurrentPublicKeySelectionPort,
  type PublicCatalogCursorPort,
} from "./current_public_catalog.ts";

export type SearchPhase = "publication" | "index_select" | "catalog_read" | "catalog_operation";
export type SearchFailure =
  | "publication_unapproved"
  | "index_unapproved"
  | "schema_unapproved"
  | "state_unapproved"
  | "page_invalid"
  | "identity_conflict"
  | "operation_scope_unapproved"
  | "runtime_role_unverified"
  | "transport_unavailable"
  | "security_guard_unavailable"
  | "unclassified";
export type SearchEvent = Readonly<{
  event: "current_public_search_failure_v1";
  operation: "offerings.search";
  phase: SearchPhase;
  failure: SearchFailure;
}>;
export type ServerOnlySink = (event: SearchEvent) => void | PromiseLike<void>;
const FAILURES: Readonly<Record<string, SearchFailure>> = Object.freeze({
  current_catalog_publication_unapproved: "publication_unapproved",
  current_catalog_key_index_unapproved: "index_unapproved",
  current_catalog_schema_unapproved: "schema_unapproved",
  current_catalog_state_unapproved: "state_unapproved",
  current_catalog_page_invalid: "page_invalid",
  current_catalog_identity_conflict: "identity_conflict",
  operation_scope_not_approved: "operation_scope_unapproved",
  storage_runtime_role_unverified: "runtime_role_unverified",
  storage_unavailable: "transport_unavailable",
  security_policy_unavailable: "security_guard_unavailable",
});
const PHASES: readonly SearchPhase[] = Object.freeze([
  "publication",
  "index_select",
  "catalog_read",
  "catalog_operation",
]);

function failureOf(error: unknown): SearchFailure | null {
  try {
    if (!(error instanceof AccessError)) return "unclassified";
    const http = Object.getOwnPropertyDescriptor(error, "http");
    if (!http || !("value" in http) || http.value !== 503) return null;
    const code = Object.getOwnPropertyDescriptor(error, "code");
    if (!code || !("value" in code) || typeof code.value !== "string") return "unclassified";
    return Object.hasOwn(FAILURES, code.value) ? FAILURES[code.value] : "unclassified";
  } catch {
    return "unclassified";
  }
}

/** One instance is required per request; any reuse disables further trace emission. */
export class SearchDiagnostic {
  private active = false;
  private started = false;
  private reported = false;
  constructor(private readonly sink?: ServerOnlySink) {}

  async operation<T>(operation: unknown, work: () => Promise<T>): Promise<T> {
    if (this.started) {
      this.active = false;
      return await work();
    }
    this.started = true;
    this.active = operation === "offerings.search";
    try {
      return await this.capture("catalog_operation", work);
    } finally {
      this.active = false;
    }
  }

  async capture<T>(phase: SearchPhase, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      try {
        if (this.active && !this.reported && this.sink && PHASES.includes(phase)) {
          const failure = failureOf(error);
          if (failure !== null) {
            this.reported = true;
            const event: SearchEvent = Object.freeze({
              event: "current_public_search_failure_v1",
              operation: "offerings.search",
              phase,
              failure,
            });
            void Promise.resolve(this.sink(event)).catch(() => {});
          }
        }
      } catch {
        // Diagnostics never alter a response, admission, budget or the original exception.
      }
      throw error;
    }
  }
}

/** Preserve all key selection inputs, limits and results. No keys or queries are logged. */
export function observeKeySelection(
  base: CurrentPublicKeySelectionPort,
  trace: SearchDiagnostic,
): CurrentPublicKeySelectionPort {
  return {
    select: (kind, query, after) =>
      trace.capture("index_select", () => base.select(kind, query, after)),
    resolve: (ids, recruitment) => base.resolve(ids, recruitment),
  };
}

/** Preserve publication, ownership, SQL/read checks and return values unchanged. */
export function observeCurrentCatalog(
  base: CurrentPublicCatalogPort,
  trace: SearchDiagnostic,
): CurrentPublicCatalogPort {
  return {
    publication: () => trace.capture("publication", () => base.publication()),
    search: (subject, kind, query, after) =>
      trace.capture("catalog_read", () => base.search(subject, kind, query, after)),
    lookup: (subject, ids, recruitment) => base.lookup(subject, ids, recruitment),
  };
}

/** 799 source-compatible wiring candidate. Rebase and rebuild against the exact 859c source. */
export class ObservedCurrentPublicCatalogService extends CurrentPublicCatalogService {
  constructor(
    data: CatalogDataPort,
    current: CurrentPublicCatalogPort,
    clock: RequestClockPort,
    cursor: PublicCatalogCursorPort,
    private readonly trace: SearchDiagnostic,
  ) {
    super(data, observeCurrentCatalog(current, trace), clock, cursor);
  }
  override execute(request: ApiExecution): Promise<NativeObject> {
    return this.trace.operation(request.operation, () => super.execute(request));
  }
}
