/** Licensed student rights replace personal daily score counts; global physical counters remain shared. */
import { AccessError } from "./access.ts";
import { PROFESSIONAL_CONTRACT } from "./professional_contract.generated.ts";
import { proId, proInteger, proObject, proShape } from "./professional_policy.ts";
import type {
  ProfessionalCommand,
  ProfessionalScope,
  ProfessionalUsageLease,
  ProfessionalUsagePort,
} from "./professional_ports.ts";
import type { RequestClockPort } from "./ports.ts";
import { RequestLimitError } from "./request_budget.ts";
import type {
  BudgetKind,
  UsageDemand,
  UsageLease,
  UsageReservationDecision,
  UsageReservationRequest,
} from "./usage_budget.ts";
import type { NativeObject } from "../domain/json_value.ts";
import { utcInstant } from "../domain/time.ts";
function unavailable(): never {
  throw new AccessError("professional_policy_unavailable", 503);
}
function natural(v: unknown, positive = false): bigint {
  return BigInt(proInteger(v, positive ? 1 : 0));
}
interface SharedDimension {
  readonly kind: BudgetKind;
  readonly period: bigint;
  readonly capacity: bigint;
  readonly ceiling: bigint;
}
export interface ProfessionalUsageAdmissionPort {
  reserve(
    scope: ProfessionalScope,
    request: UsageReservationRequest,
    organization: { readonly period: bigint; readonly capacity: bigint },
  ): Promise<UsageReservationDecision>;
  settle(
    scope: ProfessionalScope,
    lease: UsageLease,
    success: boolean,
    resultBytes: bigint,
    replayed: boolean,
  ): Promise<void>;
}
export class ProfessionalSharedUsage implements ProfessionalUsagePort {
  private readonly sharedVersion: string;
  private readonly expiry: bigint;
  private readonly dimensions: readonly SharedDimension[];
  private readonly operationBytes = new Map<string, bigint>();
  private readonly operationCost = new Map<string, bigint>();
  private readonly organizationPeriod: bigint;
  private readonly requestsPerStudent: bigint;
  private readonly leases = new WeakMap<
    ProfessionalUsageLease,
    { scope: ProfessionalScope; lease: UsageLease }
  >();
  constructor(
    raw: NativeObject,
    sharedPolicy: NativeObject,
    private readonly store: ProfessionalUsageAdmissionPort,
    private readonly clock: RequestClockPort,
    private readonly approvedSha256: string,
    private readonly assertSharedCurrent: () => Promise<void>,
  ) {
    try {
      const r = proShape(raw, [
        "format",
        "status",
        "approval_reference_sha256",
        "expires_at",
        "shared_policy_version",
        "shared_capacity_tier",
        "organization_window",
        "operations",
      ]);
      if (
        r.format !== "jungsi.professional-usage/v1" || r.status !== "approved" ||
        r.approval_reference_sha256 !== approvedSha256 || !/^[a-f0-9]{64}$/.test(approvedSha256) ||
        sharedPolicy.status !== "approved" || typeof sharedPolicy.expires_at !== "string" ||
        !["standard", "paid"].includes(String(r.shared_capacity_tier))
      ) unavailable();
      this.sharedVersion = proId(r.shared_policy_version);
      if (this.sharedVersion !== sharedPolicy.version || typeof r.expires_at !== "string") {
        unavailable();
      }
      this.expiry = utcInstant(r.expires_at);
      if (this.expiry > utcInstant(sharedPolicy.expires_at)) unavailable();
      if (!Array.isArray(sharedPolicy.dimensions)) unavailable();
      const dimensions: SharedDimension[] = [];
      for (
        const kind of [
          "request_window",
          "calculation_cost",
          "concurrent_jobs",
          "result_volume",
        ] as const
      ) {
        const candidates = sharedPolicy.dimensions.map(proObject).filter((d) => d.kind === kind);
        if (candidates.length !== 1) unavailable();
        const d = candidates[0];
        const period = natural(d.period_seconds, true),
          capacity = natural(d[String(r.shared_capacity_tier)]),
          ceiling = natural(d.ceiling);
        if (capacity > ceiling || kind === "concurrent_jobs" && period !== 1n) unavailable();
        dimensions.push({ kind, period, capacity, ceiling });
      }
      this.dimensions = dimensions;
      const window = proShape(r.organization_window, [
        "period_seconds",
        "requests_per_contracted_student",
      ]);
      this.organizationPeriod = natural(window.period_seconds, true);
      this.requestsPerStudent = natural(window.requests_per_contracted_student, true);
      if (!Array.isArray(r.operations)) unavailable();
      for (const value of r.operations) {
        const op = proShape(value, ["operation", "maximum_result_bytes", "calculation_units"]),
          name = proId(op.operation),
          bytes = natural(op.maximum_result_bytes, true),
          cost = natural(op.calculation_units);
        if (
          !PROFESSIONAL_CONTRACT.routes.some((route) => route.id === name) ||
          this.operationBytes.has(name) || bytes > 8388608n ||
          (["pro.score.create", "pro.overall.analyze", "pro.university.analyze", "pro.candidates"]
              .includes(name)
            ? cost < 1n
            : cost !== 0n)
        ) unavailable();
        this.operationBytes.set(name, bytes);
        this.operationCost.set(name, cost);
      }
      if (this.operationBytes.size !== PROFESSIONAL_CONTRACT.routes.length) unavailable();
    } catch {
      unavailable();
    }
  }
  private async fresh(): Promise<void> {
    if (this.clock.nowUtc() >= this.expiry) unavailable();
    await this.assertSharedCurrent();
    if (this.clock.nowUtc() >= this.expiry) unavailable();
  }
  async reserve(
    scope: ProfessionalScope,
    operation: string,
    _command: ProfessionalCommand | null,
    context?: { examId: string | null; maximumCalculationUnits: bigint; replay: boolean },
  ): Promise<ProfessionalUsageLease> {
    await this.fresh();
    const maximum = this.operationBytes.get(operation);
    if (!maximum) unavailable();
    const cost = this.operationCost.get(operation)!;
    if (
      !context || cost > context.maximumCalculationUnits || cost > 0n && context.examId === null
    ) unavailable();
    const demands: UsageDemand[] = this.dimensions.filter((d) =>
      d.kind !== "calculation_cost" || cost > 0n
    ).map((d) => ({
      kind: d.kind,
      scope: d.kind === "calculation_cost" ? proId(context.examId) : "GLOBAL",
      periodSeconds: d.period,
      capacity: d.capacity,
      ceiling: d.ceiling,
      units: d.kind === "result_volume"
        ? maximum
        : d.kind === "calculation_cost"
        ? context.replay ? 0n : cost
        : 1n,
    }));
    const capacity = BigInt(scope.authority.contract.studentCapacity) * this.requestsPerStudent;
    if (capacity > 9223372036854775807n) unavailable();
    const decision = await this.store.reserve(scope, {
      owner: scope.authority.user.subjectId,
      operation,
      policyVersion: this.sharedVersion,
      demands,
    }, { period: this.organizationPeriod, capacity });
    if (!decision.allowed) throw new RequestLimitError(decision.code, decision.retryAfterSeconds);
    const result = Object.freeze({
      id: decision.lease.id,
      expiresAtUtc: decision.lease.expiresAtUtc,
    });
    this.leases.set(result, { scope, lease: decision.lease });
    return result;
  }
  async finish(
    scope: ProfessionalScope,
    lease: ProfessionalUsageLease,
    success: boolean,
    resultBytes: bigint,
    replayed = false,
  ): Promise<void> {
    const proof = this.leases.get(lease);
    if (
      !proof || proof.scope.authority !== scope.authority || typeof resultBytes !== "bigint" ||
      resultBytes < 0n || this.clock.nowUtc() >= lease.expiresAtUtc
    ) unavailable();
    await this.fresh();
    // Keep the proof until the request is discarded: an enclosing business rollback also rolls back settlement.
    await this.store.settle(scope, proof.lease, success, resultBytes, replayed);
  }
}
