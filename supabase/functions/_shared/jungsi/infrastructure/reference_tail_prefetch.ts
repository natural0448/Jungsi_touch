/** Request-local bounded prefetch; the caller supplies the exact authority used for calculation. */
import { AccessError } from "../application/access.ts";
import type { ReferenceTailPort } from "../application/reference_percentile.ts";

export async function prefetchSelectedSavedTails(
  tail: ReferenceTailPort,
  ids: readonly string[],
  requestSignal: AbortSignal,
  scopeSignal?: AbortSignal,
  failures?: Map<string, unknown>,
): Promise<void> {
  const pending = [...new Set(ids)];
  let failed = false;
  const worker = async () => {
    while (pending.length && !failed) {
      if (requestSignal.aborted || scopeSignal?.aborted) {
        failed = true;
        throw new AccessError("security_policy_unavailable", 503);
      }
      const id = pending.shift()!;
      try {
        await tail.getReferenceTail?.(id, scopeSignal);
      } catch (error) {
        if (requestSignal.aborted || scopeSignal?.aborted || !failures) {
          failed = true;
          throw error;
        }
        failures.set(id, error);
      }
    }
  };
  const workers = await Promise.allSettled(Array.from({ length: 4 }, worker));
  const failure = workers.find((item) => item.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

/** For multi-offering 3P, preserve each failed selection so a later retry cannot hide it. */
export function preservePrefetchFailures(
  tail: ReferenceTailPort,
  failures: ReadonlyMap<string, unknown>,
): ReferenceTailPort {
  return {
    ...tail,
    async getReferenceTail(id, signal) {
      if (failures.has(id)) throw failures.get(id);
      return await tail.getReferenceTail?.(id, signal) ?? null;
    },
  };
}
