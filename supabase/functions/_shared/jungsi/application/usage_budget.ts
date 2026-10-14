/** Private shared-counter contracts. Limits are supplied only by approved server policy. */
export const BUDGET_KINDS = [
  "request_window",
  "distinct_scores",
  "calculation_cost",
  "concurrent_jobs",
  "result_volume",
] as const;
export type BudgetKind = typeof BUDGET_KINDS[number];
export interface UsageDemand {
  readonly kind: BudgetKind;
  /** Server-resolved exam identity or server-selected global bucket; never request IDs/JWT. */
  readonly scope: string;
  readonly periodSeconds: bigint;
  // concurrent_jobs uses the protocol sentinel 1; its active count never rolls over.
  readonly capacity: bigint;
  /** Stable approved maximum across member tiers; upgrades keep the same counters. */
  readonly ceiling: bigint;
  readonly units: bigint;
  /** Only distinct_scores uses the normalized score fingerprint, without raw scores. */
  readonly fingerprint?: string;
}
export interface UsageReservationRequest {
  readonly owner: string;
  readonly operation: string;
  readonly policyVersion: string;
  readonly demands: readonly UsageDemand[];
}
export interface UsageLease {
  readonly id: string;
  readonly owner: string;
  readonly policyVersion: string;
  readonly createdAtUtc: bigint;
  readonly expiresAtUtc: bigint;
}
export type UsageReservationDecision = { readonly allowed: true; readonly lease: UsageLease } | {
  readonly allowed: false;
  readonly code: "rate_limit_exceeded" | "analysis_quota_exceeded";
  readonly retryAfterSeconds: number;
};
export interface UsageBudgetStorePort {
  /** Reserve every dimension atomically under a stable owner/policy lock.
   * Request attempts remain charged when another dimension refuses the job.
   */
  reserve(request: UsageReservationRequest): Promise<UsageReservationDecision>;
  /** Consume completed calculation/volume reservations and release concurrency.
   * Failed/expired jobs keep conservative calculation charges, without raw payloads.
   */
  settle(
    lease: UsageLease,
    outcome: "success" | "failure",
    usage?: { readonly resultBytes?: bigint },
  ): Promise<void>;
}
export interface UsageStoreLimits {
  readonly leaseSeconds: bigint;
  /** Verified host worker limit; lease must outlive it and the approved clock margin. */
  readonly runtimeHardLimitSeconds: bigint;
  readonly clockMarginSeconds: bigint;
}
