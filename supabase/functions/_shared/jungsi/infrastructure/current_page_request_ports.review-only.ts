/** Review-only request-scoped provider wiring. A guarded provider must still meter
 * and guard each physical SQL/Storage chunk; this module issues no authority. */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type {
  CurrentPageExecution,
  CurrentPagePortContext,
  CurrentPagePorts,
} from "../application/history_current_page.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { sessionDto } from "../application/session_service.ts";
import type { PreparedUsageAdmission } from "../application/usage_service.ts";
import type { RuntimeRequestBudget } from "./runtime_budget.ts";

type RequestIdentity = Pick<CurrentPagePortContext, "execution" | "boundary">;
export type RequestScopedCurrentPagePortsFactory = (
  context: Readonly<{
    execution: ApiExecution & CurrentPageExecution;
    boundary: ApiExecutionBoundary;
    /** Must also be called immediately before/after each physical provider I/O. */
    assertActive(context: RequestIdentity): void;
  }>,
) => Promise<CurrentPagePorts>;

function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}

export async function resolveCurrentPageRequestPorts(
  source: CurrentPagePorts | RequestScopedCurrentPagePortsFactory,
  execution: ApiExecution & CurrentPageExecution,
  boundary: ApiExecutionBoundary,
  budget: RuntimeRequestBudget | undefined,
  clock: RequestClockPort,
): Promise<CurrentPagePorts> {
  // Preserve the existing static ports path. Its existing HTTP and scope gates are unchanged.
  if (typeof source !== "function") return source;
  const admission = boundary?.admission;
  const signal = boundary?.signal;
  const session = execution?.session;
  const user = session?.user;
  const subject = user?.subjectId;
  const query = execution?.query;
  const entries = query ? Object.entries(query) : [];
  if (!budget || !admission || !(signal instanceof AbortSignal) || !user || !query) return fail();
  const identity = Object.freeze({ execution, boundary });
  const active = (ctx: RequestIdentity): void => {
    if (
      !ctx || ctx.execution !== execution || ctx.boundary !== boundary ||
      execution.operation !== "history.current-page" || execution.session !== session ||
      session.user !== user || user.subjectId !== subject ||
      execution.query !== query || Object.keys(query).length !== entries.length ||
      entries.some(([key, value]) => !Object.hasOwn(query, key) || query[key] !== value) ||
      boundary.signal !== signal || signal.aborted || boundary.admission !== admission
    ) return fail();
    sessionDto(session, clock.nowUtc());
    budget.assertRunAdmission(admission as PreparedUsageAdmission, execution, "active");
  };
  const run = async <T>(ctx: RequestIdentity, work: () => Promise<T>): Promise<T> => {
    active(ctx);
    const result = await work();
    active(ctx);
    return result;
  };
  active(identity);
  const ports = await source(Object.freeze({ execution, boundary, assertActive: active }));
  active(identity);
  if (!ports || typeof ports !== "object") return fail();
  // Application call boundaries are guarded. Internal multi-chunk I/O also requires
  // the issued guard in the actual provider, before and after each physical operation.
  const optional = new Set<keyof CurrentPagePorts>([
    "score_reasons",
    "condition_comparisons",
    "recruitment_evidence",
  ]);
  function port<K extends keyof CurrentPagePorts>(key: K): CurrentPagePorts[K] {
    active(identity);
    const descriptor = Object.getOwnPropertyDescriptor(ports, key);
    active(identity);
    if (!descriptor) {
      if (optional.has(key)) return undefined as CurrentPagePorts[K];
      return fail();
    }
    if (!("value" in descriptor)) return fail();
    return descriptor.value as CurrentPagePorts[K];
  }
  const a = port("authority"), o = port("offerings"), h = port("histories"), c = port("cursors");
  const s = port("score_reasons"),
    k = port("condition_comparisons"),
    r = port("recruitment_evidence");
  active(identity);
  const guarded: CurrentPagePorts = {
    authority: a
      ? {
        begin: (e, b) => run({ execution: e, boundary: b }, () => a.begin(e, b)),
        assertCurrent: (ctx) => run(ctx, () => a.assertCurrent(ctx)),
        classifyGuideMembership: (ctx, keys) =>
          run(ctx, () => a.classifyGuideMembership(ctx, keys)),
        classifyTargets: (ctx, keys) => run(ctx, () => a.classifyTargets(ctx, keys)),
        verifyRelations: (ctx, claims) => run(ctx, () => a.verifyRelations(ctx, claims)),
      }
      : null,
    offerings: o
      ? {
        page: (ctx, query, after) => run(ctx, () => o.page(ctx, query, after)),
      }
      : null,
    histories: h ? { read: (ctx, keys) => run(ctx, () => h.read(ctx, keys)) } : null,
    cursors: c
      ? {
        open: (ctx, scope, token) => run(ctx, () => c.open(ctx, scope, token)),
        seal: (ctx, scope, after, incomplete) =>
          run(ctx, () => c.seal(ctx, scope, after, incomplete)),
      }
      : null,
    score_reasons: s ? { project: (ctx, claims) => run(ctx, () => s.project(ctx, claims)) } : null,
    condition_comparisons: k
      ? {
        compare: (ctx, current, claims) => run(ctx, () => k.compare(ctx, current, claims)),
      }
      : null,
    recruitment_evidence: r
      ? {
        verify: (ctx, decisions) => run(ctx, () => r.verify(ctx, decisions)),
      }
      : null,
  };
  for (const port of Object.values(guarded)) if (port) Object.freeze(port);
  return Object.freeze(guarded);
}
