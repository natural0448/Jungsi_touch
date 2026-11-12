/** Bounded transport diagnostics; runtime configuration controls whether observations are recorded. */
export interface SafeExchangeObservation {
  readonly kind: "auth_lookup" | "profile_lookup";
  readonly outcome: "ok" | "http_status" | "timeout" | "request_failed" | "status_unobserved";
  readonly http_status: number | null;
  readonly elapsed_ms: number;
}
/**
 * The operation must pass this signal to the existing fetch and read its bounded response body
 * before resolving. It keeps the same five-second limit; there is no retry or auth fallback.
 * The observer sees fixed categories, a bounded status and duration only, never input, response,
 * token, subject, exception or role/status. Observer failure cannot change the exchange outcome.
 */
export async function observeAuthExchange<T>(
  kind: SafeExchangeObservation["kind"],
  operation: (signal: AbortSignal, recordStatus: (status: number) => void) => Promise<T>,
  observe?: (event: SafeExchangeObservation) => void | Promise<void>,
  requestSignal?: AbortSignal,
): Promise<T> {
  const started = performance.now(), deadline = AbortSignal.timeout(5000);
  const signal = requestSignal ? AbortSignal.any([deadline, requestSignal]) : deadline;
  let status: number | null = null;
  let outcome: SafeExchangeObservation["outcome"] = "request_failed";
  try {
    if (signal.aborted) throw signal.reason;
    const result = await operation(signal, (value) => {
      if (Number.isSafeInteger(value) && value >= 100 && value <= 599) status = value;
    });
    // A denial already received must remain a denial even if body cancellation finishes
    // just after the deadline. No successful identity can pass this exception.
    const rejectedBearer = kind === "auth_lookup" && result === null && status !== null &&
      [400, 401, 403].includes(status);
    if (requestSignal?.aborted || signal.aborted && !rejectedBearer) throw signal.reason;
    outcome = status === null ? "status_unobserved" : status !== 200 ? "http_status" : "ok";
    return result;
  } catch (error) {
    outcome = deadline.aborted && signal.reason === deadline.reason
      ? "timeout"
      : status !== null && status !== 200
      ? "http_status"
      : "request_failed";
    throw error;
  } finally {
    try {
      const elapsed = performance.now() - started;
      const pending = observe?.(Object.freeze({
        kind,
        outcome,
        http_status: status,
        elapsed_ms: Number.isFinite(elapsed)
          ? Math.min(60000, Math.max(0, Math.round(elapsed)))
          : 0,
      }));
      if (pending) void Promise.resolve(pending).catch(() => {});
    } catch { /* Diagnostics are not authority and must not affect the request. */ }
  }
}
