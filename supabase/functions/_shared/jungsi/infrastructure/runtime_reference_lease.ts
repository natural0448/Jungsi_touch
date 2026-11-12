/** Request-local bridge to the existing budget callback. It is not an approval issuer. */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { sessionDto } from "../application/session_service.ts";

type State = "new" | "active" | "settling" | "settled" | "failed";
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}

/** Construct once for a single HTTP request. `enter` must be called only by the callback
 * passed directly to the existing RuntimeRequestBudget.run; markSettled only after it returns. */
export class RuntimeReferenceLease {
  private state: State = "new";
  private request?: ApiExecution;
  private admission?: unknown;
  private signal?: AbortSignal;
  private subject?: string;
  private expiresAt?: bigint;
  private receipt?: Readonly<{ assertCurrent(): void }>;
  private readonly scopeSignals = new WeakMap<AbortSignal, AbortSignal>();
  private readonly canonicalSignals = new WeakSet<AbortSignal>();
  constructor(
    private readonly clock: RequestClockPort,
    private readonly current: (signal: AbortSignal) => Promise<void>,
    private readonly currentReceipt: (
      signal: AbortSignal,
    ) => Promise<Readonly<{ assertCurrent(): void }>>,
  ) {}

  async enter<T>(
    request: ApiExecution,
    admission: unknown,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    if (
      this.state !== "new" || !admission || typeof admission !== "object" || !signal ||
      signal.aborted
    ) unavailable();
    const lease = (admission as { lease?: { owner?: unknown; expiresAtUtc?: unknown } }).lease;
    if (
      !lease || lease.owner !== request.session.user.subjectId ||
      typeof lease.expiresAtUtc !== "bigint"
    ) unavailable();
    this.request = request;
    this.admission = admission;
    this.signal = signal;
    this.subject = request.session.user.subjectId;
    this.expiresAt = lease.expiresAtUtc;
    this.state = "active";
    try {
      this.local(request, admission, signal, false);
      const result = await work();
      this.local(request, admission, signal, false);
      this.state = "settling";
      return result;
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }
  markSettled(): void {
    if (this.state !== "settling") unavailable();
    this.state = "settled";
  }
  fail(): void {
    this.state = "failed";
  }
  /** Only already-settled request-local state; no provider, network or database access. */
  assertSettled(request: ApiExecution, boundary: ApiExecutionBoundary): void {
    if (this.state !== "settled") unavailable();
    this.local(request, boundary.admission, boundary.signal, true);
    if (!this.receipt) unavailable();
    this.receipt.assertCurrent();
  }
  private local(
    request: ApiExecution,
    admission: unknown,
    signal: AbortSignal,
    delivery: boolean,
  ): void {
    if (
      request !== this.request || admission !== this.admission || signal !== this.signal ||
      signal.aborted ||
      request.session.user.subjectId !== this.subject ||
      (this.state !== "active" && !(delivery && this.state === "settled"))
    ) unavailable();
    const now = this.clock.nowUtc();
    if (
      typeof now !== "bigint" ||
      (this.state === "active" && (this.expiresAt === undefined || now >= this.expiresAt))
    ) unavailable();
    sessionDto(request.session, now);
  }
  /** One canonical composite per request/scope; pass this same resolver to all issuers. */
  scopeSignal(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    scopeSignal?: AbortSignal,
  ): AbortSignal {
    this.local(request, boundary.admission, boundary.signal, false);
    if (scopeSignal?.aborted) unavailable();
    if (!scopeSignal || scopeSignal === boundary.signal) return boundary.signal;
    if (this.canonicalSignals.has(scopeSignal)) return scopeSignal;
    let combined = this.scopeSignals.get(scopeSignal);
    if (!combined) {
      combined = AbortSignal.any([boundary.signal, scopeSignal]);
      this.scopeSignals.set(scopeSignal, combined);
      this.canonicalSignals.add(combined);
    }
    return combined;
  }
  async assert(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    scopeSignal?: AbortSignal,
  ): Promise<void> {
    this.local(request, boundary.admission, boundary.signal, false);
    if (scopeSignal?.aborted) unavailable();
    const signal = this.scopeSignal(request, boundary, scopeSignal);
    await this.current(signal);
    if (signal === boundary.signal) this.receipt = await this.currentReceipt(signal);
    this.local(request, boundary.admission, boundary.signal, false);
    if (scopeSignal?.aborted) unavailable();
  }
}
