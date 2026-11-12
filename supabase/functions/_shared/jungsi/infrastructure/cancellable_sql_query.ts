/** Forward request cancellation to the existing postgres.js query and await its settlement. */
import { AccessError } from "../application/access.ts";
export async function cancellableSqlQuery<T>(
  query: PromiseLike<T> & { cancel(): void },
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return await query;
  let sent = false;
  const cancel = () => {
    if (sent) return;
    sent = true;
    try {
      query.cancel();
    } catch { /* The original query/transaction is still awaited. */ }
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const value = await query;
    if (signal.aborted) throw new AccessError("storage_unavailable", 503);
    return value;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
