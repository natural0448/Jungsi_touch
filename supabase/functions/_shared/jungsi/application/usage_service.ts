/** Approved server plans compose atomic budgets with work; no unapproved fallback. */
import { AccessError } from "./access.ts";
import type { PlatformRepositoryPort } from "./platform_repository.ts";
import type { RequestClockPort } from "./ports.ts";
import {
  BUDGET_OPERATIONS,
  type BudgetRequest,
  type RequestBudgetPort,
  RequestLimitError,
} from "./request_budget.ts";
import { sessionDto } from "./session_service.ts";
import type {
  UsageBudgetStorePort,
  UsageDemand,
  UsageReservationDecision,
} from "./usage_budget.ts";
import { cloneNativeJson, nativeJsonSha256, nativeJsonText } from "../domain/json_value.ts";
export interface ApprovedUsagePlan {
  readonly status: "approved";
  readonly policyVersion: string;
  readonly approvalReferenceSha256: string;
  readonly owner: string;
  readonly operation: string;
  readonly memberTier: "standard" | "paid";
  readonly examId: string | null;
  readonly normalizedScoresSha256: string | null;
  readonly calculationContextSha256: string | null;
  readonly computation: "required" | "idempotent_replay";
  readonly demands: readonly UsageDemand[];
}
export interface UsagePlanningPort {
  /** Resolve owned profile/direct scores, registered exam and adopted versions.
   * Capacities come from approved private configuration, never body/query fields.
   */
  prepare(request: BudgetRequest): Promise<ApprovedUsagePlan | null>;
}
export interface UsageReplayVerificationPort {
  exists(request: BudgetRequest): Promise<boolean>;
}
const ANALYSIS = [
  "score-profile.create",
  "overall.analyze",
  "university.analyze",
  "candidates.build",
];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, HASH = /^[a-f0-9]{64}$/;
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
/** Existing repository receipt verification supports zero compute cost only for real replay. */
export class RepositoryUsageReplays implements UsageReplayVerificationPort {
  constructor(private readonly repository: PlatformRepositoryPort) {}
  async exists(request: BudgetRequest): Promise<boolean> {
    if (
      ![...ANALYSIS, "shortlist.update"].includes(request.operation) || !request.requestKey ||
      !ID.test(request.requestKey)
    ) return false;
    const digest = await nativeJsonSha256([request.body, request.params]);
    const result = await this.repository.replay(
      request.session.user.subjectId,
      request.operation,
      request.requestKey,
      digest,
    );
    if (result === null) return false;
    if (result.owner_id !== request.session.user.subjectId) unavailable();
    return true;
  }
}
export class SharedRequestBudget implements RequestBudgetPort {
  constructor(
    private readonly planner: UsagePlanningPort,
    private readonly store: UsageBudgetStorePort,
    private readonly clock: RequestClockPort,
    private readonly replays: UsageReplayVerificationPort,
  ) {}
  private validate(request: BudgetRequest, plan: ApprovedUsagePlan): void {
    if (
      !plan || plan.status !== "approved" || typeof plan.policyVersion !== "string" ||
      !ID.test(plan.policyVersion) ||
      typeof plan.approvalReferenceSha256 !== "string" ||
      !HASH.test(plan.approvalReferenceSha256) ||
      plan.owner !== request.session.user.subjectId || plan.operation !== request.operation ||
      plan.memberTier !== request.session.tier ||
      !["required", "idempotent_replay"].includes(plan.computation) || !Array.isArray(plan.demands)
    ) unavailable();
    const analysis = ANALYSIS.includes(request.operation);
    if (plan.examId !== null && (typeof plan.examId !== "string" || !ID.test(plan.examId))) {
      unavailable();
    }
    for (const hash of [plan.normalizedScoresSha256, plan.calculationContextSha256]) {
      if (hash !== null && (typeof hash !== "string" || !HASH.test(hash))) unavailable();
    }
    if (
      analysis &&
      (plan.examId === null || typeof plan.normalizedScoresSha256 !== "string" ||
        !HASH.test(plan.normalizedScoresSha256) ||
        typeof plan.calculationContextSha256 !== "string" ||
        !HASH.test(plan.calculationContextSha256))
    ) unavailable();
    const kinds = new Set(plan.demands.map((d) => d.kind));
    for (
      const kind of [
        "request_window",
        "concurrent_jobs",
        "result_volume",
        ...(analysis ? ["distinct_scores", "calculation_cost"] : []),
      ]
    ) if (!kinds.has(kind as UsageDemand["kind"])) unavailable();
    for (const d of plan.demands) {
      if (d.kind === "concurrent_jobs" && (d.scope !== "GLOBAL" || d.periodSeconds !== 1n)) {
        unavailable();
      }
      if (d.scope !== "GLOBAL" && d.scope !== plan.examId) unavailable();
      if (
        d.kind === "distinct_scores" &&
        (d.scope !== plan.examId || d.fingerprint !== plan.normalizedScoresSha256)
      ) unavailable();
      if (
        d.kind === "calculation_cost" &&
        (typeof d.units !== "bigint" || d.units < 0n ||
          plan.computation === "required" && d.units === 0n ||
          plan.computation === "idempotent_replay" && d.units !== 0n)
      ) unavailable();
    }
  }
  async run<T>(request: BudgetRequest, work: () => Promise<T>): Promise<T> {
    if (!BUDGET_OPERATIONS.includes(request.operation as typeof BUDGET_OPERATIONS[number])) {
      unavailable();
    }
    sessionDto(request.session, this.clock.nowUtc());
    const protectedRequest: BudgetRequest = {
      ...request,
      body: cloneNativeJson(request.body),
      params: Object.freeze({ ...request.params }),
      query: Object.freeze({ ...request.query }),
      session: Object.freeze({
        ...request.session,
        user: Object.freeze({ ...request.session.user }),
      }),
    };
    let plan: ApprovedUsagePlan | null;
    try {
      plan = await this.planner.prepare(protectedRequest);
    } catch (e) {
      if (e instanceof AccessError && [401, 403, 404, 409, 422].includes(e.http)) throw e;
      return unavailable();
    }
    if (plan === null) unavailable();
    this.validate(protectedRequest, plan);
    if (plan.computation === "idempotent_replay") {
      let found = false;
      try {
        found = await this.replays.exists(protectedRequest);
      } catch (e) {
        if (e instanceof AccessError && e.http === 409) throw e;
        unavailable();
      }
      if (!found) unavailable();
    }
    const demands = Object.freeze(plan.demands.map((d) => Object.freeze({ ...d })));
    let decision: UsageReservationDecision;
    try {
      decision = await this.store.reserve({
        owner: protectedRequest.session.user.subjectId,
        operation: protectedRequest.operation,
        policyVersion: plan.policyVersion,
        demands,
      });
    } catch {
      return unavailable();
    }
    if (!decision.allowed) throw new RequestLimitError(decision.code, decision.retryAfterSeconds);
    const lease = decision.lease;
    if (
      !lease || lease.owner !== protectedRequest.session.user.subjectId ||
      lease.policyVersion !== plan.policyVersion
    ) unavailable();
    let result: T, resultBytes = 0n;
    try {
      sessionDto(request.session, this.clock.nowUtc());
      result = await work();
      resultBytes = BigInt(new TextEncoder().encode(nativeJsonText(result)).byteLength);
    } catch (e) {
      try {
        await this.store.settle(lease, "failure");
      } catch {
        return unavailable();
      }
      throw e;
    }
    try {
      await this.store.settle(lease, "success", { resultBytes });
    } catch {
      return unavailable();
    }
    sessionDto(request.session, this.clock.nowUtc());
    return result;
  }
}
