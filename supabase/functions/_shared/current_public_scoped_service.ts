/** REVIEW ONLY. Keep the existing catalog instance for non-search operations. */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApiExecution } from "./jungsi/application/api_dispatch.ts";
import type { CatalogDataPort } from "./jungsi/application/catalog.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import type { NativeObject } from "./jungsi/domain/json_value.ts";
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
      const lazy: PublicCatalogCursorPort = {
        seal: (...args) => activeCursor().seal(...args),
        open: (...args) => activeCursor().open(...args),
      };
      const service = new CurrentPublicCatalogService(
        this.scopedData,
        current,
        this.scopedClock,
        lazy,
      );
      const result = await service.execute(request);
      cursor?.assertUnexpired();
      if (
        request.operation === "offerings.search" && this.scoreMap && Array.isArray(result.items)
      ) {
        const attached = await this.scoreMap().attach(
          request.session.user.subjectId,
          result.items as NativeObject[],
        );
        return { ...result, items: attached.items, my_score_state: attached.state };
      }
      return result;
    });
  }
}
