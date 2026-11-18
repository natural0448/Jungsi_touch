/** REVIEW ONLY. Keep the existing catalog instance for non-search operations. */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApiExecution } from "./jungsi/application/api_dispatch.ts";
import type { CatalogDataPort } from "./jungsi/application/catalog.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { nativeJsonSha256, type NativeObject } from "./jungsi/domain/json_value.ts";
import {
  type CurrentPublicCatalogPort,
  CurrentPublicCatalogService,
  type PublicCatalogCursorPort,
  type PublicCatalogPublication,
} from "./current_public_catalog.ts";
import {
  CurrentPublicBoundCursor,
  type ExistingCatalogTrust,
} from "./current_public_bound_cursor.ts";
import type { ScoreMapService } from "./jungsi/application/score_map.ts";
import {
  observeCurrentCatalog,
  ObservedCurrentPublicCatalogService,
  SearchDiagnostic,
} from "./search_failure_diagnostic.ts";

/**
 * Search-only per-request wrapper. It does not consume the request budget,
 * contact an authority, or initiate physical IO: it calls the very same
 * publication/search port, verified-context loader and secret as the factory.
 * The outer handler still owns session, relay, budget and cancellation.
 */
export class CurrentPublicSearchScopedService extends ObservedCurrentPublicCatalogService {
  constructor(
    private readonly scopedData: CatalogDataPort,
    private readonly scopedCurrent: CurrentPublicCatalogPort,
    private readonly scopedClock: RequestClockPort,
    legacyCursor: PublicCatalogCursorPort,
    private readonly scopedTrace: SearchDiagnostic,
    private readonly secret: () => Uint8Array,
    private readonly existing: () => Promise<ExistingCatalogTrust>,
    /** 3P score map: attaches `my_score` to offerings.search items (best-effort, never fails). */
    private readonly scoreMap?: () => ScoreMapService,
  ) {
    super(scopedData, scopedCurrent, scopedClock, legacyCursor, scopedTrace);
  }
  override execute(request: ApiExecution): Promise<NativeObject> {
    if (request.operation !== "history.search" && request.operation !== "offerings.search") {
      return super.execute(request);
    }
    return this.scopedTrace.operation(request.operation, async () => {
      const { exam_id, stage, ...catalogQuery } = request.query;
      if (request.operation === "offerings.search") {
        if (exam_id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(exam_id)) {
          throw new AccessError("invalid_query", 422);
        }
        if (stage !== undefined && !["mock", "provisional", "final"].includes(stage)) {
          throw new AccessError("invalid_query", 422);
        }
      }
      const catalogRequest = request.operation === "offerings.search"
        ? { ...request, query: catalogQuery }
        : request;
      let pinned: PublicCatalogPublication | null = null;
      const observed = observeCurrentCatalog(this.scopedCurrent, this.scopedTrace);
      const current: CurrentPublicCatalogPort = {
        publication: async () => {
          const pub = await observed.publication();
          const captured = {
            version: pub.version,
            sha256: pub.sha256,
            expiresAtUtc: pub.expiresAtUtc,
          };
          if (
            pinned && (pinned.version !== captured.version || pinned.sha256 !== captured.sha256 ||
              pinned.expiresAtUtc !== captured.expiresAtUtc)
          ) {
            throw new AccessError("security_policy_unavailable", 503);
          }
          pinned = Object.freeze(captured);
          return pinned;
        },
        search: (...args) => observed.search(...args),
        lookup: (...args) => observed.lookup(...args),
      };
      let cursor: CurrentPublicBoundCursor | undefined;
      const activeCursor = () =>
        cursor ??= new CurrentPublicBoundCursor(this.secret(), this.existing, this.scopedClock);
      const bindScoreContext = async (binding: Parameters<PublicCatalogCursorPort["seal"]>[0]) => {
        if (request.operation !== "offerings.search" || (exam_id === undefined && stage === undefined)) {
          return binding;
        }
        return { ...binding, query: await nativeJsonSha256([binding.query, exam_id ?? null, stage ?? null]) };
      };
      const lazy: PublicCatalogCursorPort = {
        seal: async (binding, head, after) => activeCursor().seal(await bindScoreContext(binding), head, after),
        open: async (token, binding, now) => activeCursor().open(token, await bindScoreContext(binding), now),
      };
      const service = new CurrentPublicCatalogService(
        this.scopedData,
        current,
        this.scopedClock,
        lazy,
      );
      const result = await service.execute(catalogRequest);
      cursor?.assertUnexpired();
      if (
        request.operation === "offerings.search" && this.scoreMap && Array.isArray(result.items)
      ) {
        // The current search admission does not bind scoring work or SQL to its
        // physical budget and cancellation. Preserve search without starting them.
        // Re-enable only with an independently approved, request-bound capability.
        return {
          ...result,
          items: (result.items as NativeObject[]).map((item) => ({ ...item, my_score: null })),
          my_score_state: "unavailable",
        };
      }
      return result;
    });
  }
}
