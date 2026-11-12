/** REVIEW ONLY. No route, issuer, index proof, RLS approval or production binding. */
import { AccessError } from "./jungsi/application/access.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import type { CurrentPublicCatalogPort } from "./current_public_catalog.ts";
import {
  buildCurrentPublicP1DirectOfferingsSql,
  CurrentPublicCatalogSql,
  type P1DirectGuideGuard,
} from "./current_public_catalog_sql.ts";
import {
  createGuideSearchPageComposition,
  type GuidePositionCodec,
  type GuideSearchAuthority,
} from "./current_2027_guide_search_review_only.ts";

const fail = (): never => {
  throw new AccessError("p1_direct_guide_unavailable", 503);
};
/** Request-local composition. Existing O/user HOLD results must be independently
 * rebound to the exact current Guide PK and head; unknown targets stay HOLD.
 * Existing verified index/plan and scope evidence are reused; no national rescan
 * or new broad approval is manufactured by this candidate. */
export function createP1DirectGuideComposition(
  sql: CurrentPublicCatalogSql | null,
  base: GuideSearchAuthority | null,
  codec: GuidePositionCodec | null,
  clock: RequestClockPort,
  guard: P1DirectGuideGuard | null,
) {
  if (
    !sql || !base || !codec || !guard || typeof base.verifyGuideScope !== "function" ||
    typeof guard.authorizeBeforeBegin !== "function" ||
    typeof guard.authorizeBeforeIO !== "function"
  ) return fail();
  const authority: GuideSearchAuthority = {
    begin: (execution, boundary) => base.begin(execution, boundary),
    authorizeBeforeBegin(execution, boundary) {
      if (
        guard.authorizeBeforeBegin(execution, boundary) !== undefined ||
        base.authorizeBeforeBegin(execution, boundary) !== undefined
      ) return fail();
    },
    authorizeBeforeIO: (context, query, after) => base.authorizeBeforeIO(context, query, after),
    assertCurrent: (context) => base.assertCurrent(context),
    classifyGuideMembership: (context, keys) => base.classifyGuideMembership(context, keys),
    classifyTargets: (context, keys) => base.classifyTargets(context, keys),
    verifyRelations: (context, claims) => base.verifyRelations(context, claims),
    assertCatalogBinding: (context, pub, head) => base.assertCatalogBinding(context, pub, head),
    assertScanCoverage: (context, query, before, scanned, next, head) =>
      base.assertScanCoverage(context, query, before, scanned, next, head),
    classifyGuideProjections: (context, claims) => base.classifyGuideProjections(context, claims),
    verifyGuideScope: (context, claims) => base.verifyGuideScope!(context, claims),
    confirmExclusions: (context, keys) => base.confirmExclusions(context, keys),
  };
  const denied: CurrentPublicCatalogPort = {
    publication: () => Promise.reject(new Error("request_scope_required")),
    search: () => Promise.reject(new Error("request_scope_required")),
    lookup: () => Promise.reject(new Error("not_supported")),
  };
  return createGuideSearchPageComposition(
    denied,
    authority,
    codec,
    clock,
    (context, query, before) => {
      const recheck = () => {
        if (
          context.boundary.signal.aborted ||
          guard.authorizeBeforeIO(context, query, before) !== undefined
        ) return fail();
      };
      recheck();
      // Incompatible future base SQL fails only this opt-in path, before publication I/O.
      buildCurrentPublicP1DirectOfferingsSql();
      return Object.freeze(
        {
          publication: () => {
            recheck();
            return sql.publication();
          },
          search: (subject, kind, q, after) => {
            recheck();
            if (
              kind !== "offerings" || subject !== context.execution.session.user.subjectId ||
              q !== query || after !== before
            ) return fail();
            return sql.searchDirect2027Offerings(context, q, after, guard);
          },
          lookup: () => Promise.reject(new Error("not_supported")),
        } satisfies CurrentPublicCatalogPort,
      );
    },
  );
}
