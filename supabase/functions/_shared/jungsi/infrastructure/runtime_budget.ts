/** Private approved policy -> request-local shared reservations. No capacities or approvals default. */
import { AccessError } from "../application/access.ts";
import {
  COMBINED_POLICY_CONSUMER_OPERATION_IDS,
  MEMBER_SHORTLIST_CONSUMER_OPERATION_IDS,
} from "../application/api_dispatch.ts";
import { ApprovedAdministratorUsagePolicy } from "../application/administrator_usage_policy.ts";
import { ApprovedOperatingPolicy } from "../application/operating_policy.ts";
import { validateScoreInput, validateScoreStructure } from "../application/overall_analysis.ts";
import type { PlatformRepositoryPort } from "../application/platform_repository.ts";
import type { RequestClockPort } from "../application/ports.ts";
import {
  BUDGET_OPERATIONS,
  type BudgetRequest,
  type RequestBudgetPort,
} from "../application/request_budget.ts";
import { requirePaidSession, sessionDto } from "../application/session_service.ts";
import {
  BUDGET_KINDS,
  type BudgetKind,
  type UsageBudgetStorePort,
  type UsageDemand,
} from "../application/usage_budget.ts";
import {
  type ApprovedUsagePlan,
  type PreparedUsageAdmission,
  SharedRequestBudget,
  type UsagePlanningPort,
  type UsageReplayVerificationPort,
} from "../application/usage_service.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";
import { type ApprovedRuntimeBinding, runtimeInteger } from "./runtime_settings.ts";
import type { SupabaseRuntimeControls } from "./runtime_controls.ts";
const ANALYSIS = [
  "score-profile.create",
  "overall.analyze",
  "university.analyze",
  "candidates.build",
];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function object(value: unknown): NativeObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    value instanceof JsonFloat
  ) fail();
  return value as NativeObject;
}
function inputObject(value: unknown): NativeObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    value instanceof JsonFloat
  ) throw new AccessError("invalid_request", 422);
  return value as NativeObject;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new AccessError("invalid_identifier", 422);
  }
  return value;
}
export interface RuntimeExamBudget {
  readonly examId: string;
  readonly packVersion: string;
  readonly academicYear: number;
  readonly eligibleOfferingCount?: bigint | null;
}
interface Dimension {
  period: bigint;
  ceiling: bigint;
  standard: bigint;
  paid: bigint;
}
interface Cost {
  resultBytes: bigint;
  base: bigint;
  perOffering: bigint;
}
function expiryOffset(value: unknown, anchor: bigint): bigint {
  if (typeof value !== "string") fail();
  try {
    return utcInstant(value) - anchor;
  } catch {
    return fail();
  }
}
/** Only approved period fields may move together; all relative offsets stay bound. */
export function buildPeriodRenewalContext(
  row: NativeObject,
  binding: ApprovedRuntimeBinding,
): NativeObject {
  const unchanged = cloneNativeJson(row);
  const operating = object(unchanged.operating_policy);
  if (typeof operating.expires_at !== "string" || typeof binding.expiresAtUtc !== "bigint") fail();
  let operatingEnd: bigint;
  try {
    operatingEnd = utcInstant(operating.expires_at);
  } catch {
    return fail();
  }
  const preview = object(operating.preview);
  const offsets: NativeObject = {
    usage: expiryOffset(unchanged.expires_at, operatingEnd),
    operating: 0n,
    preview: expiryOffset(preview.expires_at, operatingEnd),
    administrator: null,
    binding: binding.expiresAtUtc - operatingEnd,
    snapshot: null,
  };
  if (binding.readViews) {
    if (typeof binding.readViews.snapshot.expiresAtUtc !== "bigint") fail();
    offsets.snapshot = binding.readViews.snapshot.expiresAtUtc - operatingEnd;
  }
  delete unchanged.expires_at;
  delete unchanged.approval_reference_sha256;
  delete operating.expires_at;
  delete operating.approval_reference_sha256;
  delete preview.expires_at;
  if (Object.hasOwn(unchanged, "administrator_policy")) {
    const administrator = object(unchanged.administrator_policy);
    offsets.administrator = expiryOffset(administrator.expires_at, operatingEnd);
    delete administrator.expires_at;
    delete administrator.approval_reference_sha256;
  }
  const snapshotContext: NativeObject | null = binding.readViews
    ? Object.fromEntries(
      Object.entries(binding.readViews.snapshot).filter(([key]) => key !== "expiresAtUtc"),
    ) as NativeObject
    : null;
  const readViews: NativeObject | null = binding.readViews
    ? { ...binding.readViews, snapshot: snapshotContext } as unknown as NativeObject
    : null;
  return {
    format: "jungsi.runtime-renewal-context/v2",
    expiration_offsets_microseconds: offsets,
    usage_policy: unchanged,
    project_url: binding.projectUrl,
    scope_sha256: binding.scopeSha256,
    consumer_generation: binding.consumerGeneration ?? null,
    operations: [...binding.operations],
    artifacts: binding.artifacts.map((a) => ({ kind: a.kind, key: a.key })),
    registry_reference: { ...binding.references.registry },
    selection_reference: { ...binding.references.selection },
    storage_bucket: binding.storage.bucket,
    storage_prefix: binding.storage.objectPrefix,
    storage_limits: { ...binding.storage.limits },
    read_limits: { ...binding.readLimits },
    repository_limits: { ...binding.repositoryLimits },
    usage_store_limits: { ...binding.usageStoreLimits },
    member_json: binding.memberJson ? { ...binding.memberJson } : null,
    read_view_limits: readViews,
  };
}
export class RuntimeUsagePolicy implements UsagePlanningPort {
  private readonly dimensions: ReadonlyMap<BudgetKind, Dimension>;
  private readonly costs: ReadonlyMap<string, Cost>;
  readonly exams: ReadonlyMap<string, RuntimeExamBudget>;
  readonly version: string;
  readonly expiresAtUtc: bigint;
  readonly operating: ApprovedOperatingPolicy | null;
  readonly administrator: ApprovedAdministratorUsagePolicy | null;
  readonly policyRevision: string | null;
  constructor(
    raw: Uint8Array,
    private readonly binding: ApprovedRuntimeBinding,
    private readonly repository: PlatformRepositoryPort,
    private readonly clock: RequestClockPort,
    private readonly replays: UsageReplayVerificationPort,
    private readonly mode: "rights" | "legacy_synthetic" = "rights",
  ) {
    let row: NativeObject;
    try {
      row = object(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
    } catch {
      fail();
    }
    if (
      ![
        "jungsi.runtime-usage-policy/v1",
        "jungsi.runtime-usage-policy/v2",
        "jungsi.runtime-usage-policy/v3",
        "jungsi.runtime-usage-policy/v4",
      ].includes(
        row.format as string,
      ) || row.status !== "approved" ||
      row.purpose !== "jungsi-api-runtime" ||
      typeof row.version !== "string" || !ID.test(row.version) ||
      row.approval_reference_sha256 !== binding.approvalReferenceSha256 ||
      !Array.isArray(row.exams) || !Array.isArray(row.dimensions) || !Array.isArray(row.operations)
    ) fail();
    this.version = row.version;
    if (
      ["jungsi.runtime-usage-policy/v3", "jungsi.runtime-usage-policy/v4"].includes(
        row.format as string,
      ) &&
      (typeof row.policy_revision !== "string" || !ID.test(row.policy_revision))
    ) fail();
    this.policyRevision =
      ["jungsi.runtime-usage-policy/v3", "jungsi.runtime-usage-policy/v4"].includes(
          row.format as string,
        )
        ? row.policy_revision as string
        : null;
    if (
      !["jungsi.runtime-usage-policy/v3", "jungsi.runtime-usage-policy/v4"].includes(
        row.format as string,
      ) &&
      (Object.hasOwn(row, "administrator_policy") || Object.hasOwn(row, "policy_revision"))
    ) fail();
    const combined = row.format === "jungsi.runtime-usage-policy/v4";
    if (
      combined !==
        (["operating-admin-20", "member-json-22"].includes(binding.consumerGeneration ?? "")) ||
      combined && (mode !== "rights" || !binding.readViews ||
          binding.operations.length !==
            (binding.memberJson
              ? MEMBER_SHORTLIST_CONSUMER_OPERATION_IDS
              : COMBINED_POLICY_CONSUMER_OPERATION_IDS).length ||
          (binding.memberJson
            ? MEMBER_SHORTLIST_CONSUMER_OPERATION_IDS
            : COMBINED_POLICY_CONSUMER_OPERATION_IDS).some((id) =>
              !binding.operations.includes(id)
            ) ||
          !Object.hasOwn(row, "operating_policy") || !Object.hasOwn(row, "administrator_policy"))
    ) fail();
    try {
      this.expiresAtUtc = utcInstant(row.expires_at as string);
    } catch {
      fail();
    }
    if (this.expiresAtUtc > binding.expiresAtUtc) fail();
    const dimensions = new Map<BudgetKind, Dimension>();
    for (const rawDimension of row.dimensions) {
      const d = object(rawDimension), kind = d.kind as BudgetKind;
      if (!BUDGET_KINDS.includes(kind) || dimensions.has(kind)) fail();
      const value = {
        period: runtimeInteger(d.period_seconds, 1n),
        ceiling: runtimeInteger(d.ceiling),
        standard: runtimeInteger(d.standard),
        paid: runtimeInteger(d.paid),
      };
      if (
        value.standard > value.ceiling || value.paid > value.ceiling ||
        kind === "concurrent_jobs" && value.period !== 1n
      ) fail();
      dimensions.set(kind, Object.freeze(value));
    }
    if (dimensions.size !== BUDGET_KINDS.length) fail();
    this.dimensions = dimensions;
    const costs = new Map<string, Cost>();
    for (const rawCost of row.operations) {
      const c = object(rawCost), operation = c.operation as string;
      if (
        !BUDGET_OPERATIONS.includes(operation as typeof BUDGET_OPERATIONS[number]) ||
        costs.has(operation)
      ) fail();
      const value = {
        resultBytes: runtimeInteger(c.reserved_result_bytes, 1n),
        base: runtimeInteger(c.base_units),
        perOffering: runtimeInteger(c.per_offering_units),
      };
      if (ANALYSIS.includes(operation) && value.base < 1n) fail();
      costs.set(operation, Object.freeze(value));
    }
    if (
      binding.operations.filter((op) =>
        BUDGET_OPERATIONS.includes(op as typeof BUDGET_OPERATIONS[number])
      ).some((op) => !costs.has(op))
    ) fail();
    this.costs = costs;
    const exams = new Map<string, RuntimeExamBudget>();
    for (const rawExam of row.exams) {
      const e = object(rawExam);
      if (
        typeof e.exam_id !== "string" || !ID.test(e.exam_id) ||
        typeof e.pack_version !== "string" || !ID.test(e.pack_version)
      ) fail();
      const examId = e.exam_id,
        packVersion = e.pack_version,
        y = runtimeInteger(e.academic_year, 1000n);
      if (
        y > 9999n || exams.has(examId) ||
        !binding.artifacts.some((a) => a.kind === "exam_pack" && a.key === examId)
      ) fail();
      const countPresent = Object.hasOwn(e, "eligible_offering_count");
      const eligibleOfferingCount = !countPresent
        ? undefined
        : e.eligible_offering_count === null
        ? null
        : runtimeInteger(e.eligible_offering_count);
      if (
        binding.operations.includes("candidates.build") &&
        typeof eligibleOfferingCount !== "bigint"
      ) fail();
      exams.set(
        examId,
        Object.freeze({
          examId,
          packVersion,
          academicYear: Number(y),
          ...(countPresent ? { eligibleOfferingCount } : {}),
        }),
      );
    }
    if (binding.operations.some((op) => ANALYSIS.includes(op)) && !exams.size) fail();
    this.exams = exams;
    this.operating = ["jungsi.runtime-usage-policy/v2", "jungsi.runtime-usage-policy/v4"].includes(
        row.format as string,
      )
      ? new ApprovedOperatingPolicy(row.operating_policy, {
        policyVersion: this.version,
        approvalSha256: binding.approvalReferenceSha256,
        expiresAtUtc: this.expiresAtUtc,
        exams,
        registrySha256: binding.references.registry.sha256,
        selectionSha256: binding.references.selection.sha256,
        renewalContext: buildPeriodRenewalContext(row, binding),
      })
      : null;
    if (
      !["jungsi.runtime-usage-policy/v2", "jungsi.runtime-usage-policy/v4"].includes(
        row.format as string,
      ) && Object.hasOwn(row, "operating_policy")
    ) {
      fail();
    }
    // v3 revises budget admission only. It does not enable REQ-27 rights or rename counters.
    this.administrator =
      ["jungsi.runtime-usage-policy/v3", "jungsi.runtime-usage-policy/v4"].includes(
          row.format as string,
        )
        ? new ApprovedAdministratorUsagePolicy(row.administrator_policy, {
          approvalSha256: binding.approvalReferenceSha256,
          policyVersion: this.version,
          expiresAtUtc: this.expiresAtUtc,
          requestRuntimeMicroseconds: binding.usageStoreLimits.runtimeHardLimitSeconds * 1000000n,
        })
        : null;
    this.assertLive();
  }
  assertLive(): void {
    const now = this.clock.nowUtc();
    if (typeof now !== "bigint" || now >= this.expiresAtUtc || now >= this.binding.expiresAtUtc) {
      fail();
    }
  }
  responseLimit(operation: string): bigint {
    this.assertLive();
    const cost = this.costs.get(operation);
    if (!cost) fail();
    return cost.resultBytes;
  }
  private async scores(request: BudgetRequest): Promise<NativeObject> {
    const body = inputObject(request.body), owner = request.session.user.subjectId;
    const validate = this.operating ? validateScoreStructure : validateScoreInput;
    if (request.operation === "score-profile.create") {
      return validate(body.scores) as NativeObject;
    }
    if (request.operation === "overall.analyze" && !Object.hasOwn(body, "profile_id")) {
      if (this.operating || this.mode !== "legacy_synthetic") {
        throw new AccessError("profile_required", 422);
      }
      return validate(body) as NativeObject;
    }
    let profileId: string;
    if (request.operation === "overall.analyze") profileId = id(body.profile_id);
    else {
      const report = await this.repository.getReport(owner, id(request.params.report_id));
      if (report === null || report.owner_id !== owner) {
        throw new AccessError("report_not_found", 404);
      }
      profileId = id(report.profile_id);
    }
    const profile = await this.repository.getProfile(owner, profileId);
    if (profile === null || profile.owner_id !== owner) {
      throw new AccessError("profile_not_found", 404);
    }
    return validateScoreInput(profile.scores) as NativeObject;
  }
  async prepare(request: BudgetRequest): Promise<ApprovedUsagePlan> {
    this.assertLive();
    sessionDto(request.session, this.clock.nowUtc());
    if (
      !this.binding.operations.includes(request.operation as typeof this.binding.operations[number])
    ) fail();
    const cost = this.costs.get(request.operation);
    if (!cost) fail();
    const analysis = ANALYSIS.includes(request.operation);
    if (analysis && this.mode !== "legacy_synthetic") {
      requirePaidSession(request.session, this.clock.nowUtc());
      if (!this.operating) throw new AccessError("score_input_policy_unavailable", 503);
    }
    let scoresHash: string | null = null,
      contextHash: string | null = null,
      exam: RuntimeExamBudget | undefined;
    let count = 0n;
    if (analysis) {
      const scores = await this.scores(request);
      exam = this.exams.get(scores.exam_id as string);
      if (!exam || scores.pack_version !== exam.packVersion) {
        throw new AccessError("exam_not_available", 422);
      }
      scoresHash = await nativeJsonSha256(scores);
      if (request.operation === "university.analyze") {
        const ids = inputObject(request.body).offering_ids;
        if (
          !Array.isArray(ids) || !ids.length ||
          ids.length > this.binding.repositoryLimits.maxBatchIds
        ) throw new AccessError("invalid_request", 422);
        count = BigInt(new Set(ids.map(id)).size);
      } else if (request.operation === "candidates.build") {
        if (typeof exam.eligibleOfferingCount !== "bigint") fail();
        count = exam.eligibleOfferingCount;
      }
      contextHash = await nativeJsonSha256({
        registry: this.binding.references.registry.sha256,
        selection: this.binding.references.selection.sha256,
        policy: this.version,
        operation: request.operation,
        exam_id: exam.examId,
        pack_version: exam.packVersion,
        params: cloneNativeJson(request.params),
        offering_ids: request.operation === "university.analyze"
          ? inputObject(request.body).offering_ids
          : [],
        expected_revision: Object.hasOwn(inputObject(request.body), "expected_version")
          ? inputObject(request.body).expected_version
          : null,
      });
    }
    const replay = analysis && await this.replays.exists(request);
    const stageProof = analysis && this.operating
      ? this.operating.budgetProof(
        request.session,
        request.operation,
        replay ? 0n : cost.base + cost.perOffering * count,
        this.clock.nowUtc(),
      )
      : undefined;
    const calculationUnits = analysis && !replay ? cost.base + cost.perOffering * count : 0n;
    const resultCapacity = this.dimensions.get("result_volume")!.paid;
    const maximumResultBytes = cost.resultBytes < resultCapacity
      ? cost.resultBytes
      : resultCapacity;
    const administratorProof = this.administrator?.issue(
      request,
      new Map([...this.dimensions].map(([kind, d]) => [kind, d.period])),
      {
        calculationUnits,
        maximumCalculationUnits: this.dimensions.get("calculation_cost")!.paid,
        maximumResultBytes,
      },
      this.clock.nowUtc(),
    );
    const demands: UsageDemand[] = [];
    for (const [kind, d] of this.dimensions) {
      if (administratorProof?.exemptKinds.includes(kind)) continue;
      if ((!analysis || stageProof) && ["distinct_scores", "calculation_cost"].includes(kind)) {
        continue;
      }
      const units = kind === "result_volume"
        ? cost.resultBytes
        : kind === "calculation_cost"
        ? replay ? 0n : cost.base + cost.perOffering * count
        : 1n;
      const scope = kind === "distinct_scores" || kind === "calculation_cost"
        ? exam!.examId
        : "GLOBAL";
      demands.push(
        Object.freeze({
          kind,
          scope,
          periodSeconds: d.period,
          ceiling: d.ceiling,
          capacity: request.session.tier === "paid" ? d.paid : d.standard,
          units,
          ...(kind === "distinct_scores" ? { fingerprint: scoresHash! } : {}),
        }),
      );
    }
    this.assertLive();
    return Object.freeze({
      status: "approved",
      policyVersion: this.version,
      approvalReferenceSha256: this.binding.approvalReferenceSha256,
      owner: request.session.user.subjectId,
      operation: request.operation,
      memberTier: request.session.tier,
      examId: exam?.examId ?? null,
      normalizedScoresSha256: scoresHash,
      calculationContextSha256: contextHash,
      computation: replay ? "idempotent_replay" : "required",
      demands: Object.freeze(demands),
      ...(stageProof ? { stageProof } : {}),
      ...(administratorProof ? { administratorProof, maximumResultBytes } : {}),
    });
  }
}
export const RUNTIME_BUDGET_STAGES = [
  "budget_current",
  "budget_plan",
  "budget_replay",
  "budget_reserve",
  "budget_business",
  "budget_business_current",
  "budget_settle_success",
  "budget_settle_failure",
  "budget_final_current",
] as const;
export type RuntimeBudgetStage = typeof RUNTIME_BUDGET_STAGES[number];
function ignoreStageCompletion(value: unknown): void {
  try {
    if (value && typeof (value as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(value).catch(() => {});
    }
  } catch { /* A phase observer never controls business execution. */ }
}
export class RuntimeRequestBudget implements RequestBudgetPort {
  private readonly shared: SharedRequestBudget;
  constructor(
    readonly policy: RuntimeUsagePolicy,
    private readonly store: UsageBudgetStorePort,
    private readonly clock: RequestClockPort,
    private readonly replays: UsageReplayVerificationPort,
    private readonly controls: SupabaseRuntimeControls,
    private readonly measureResult?: (request: BudgetRequest, result: unknown) => Promise<bigint>,
  ) {
    this.shared = new SharedRequestBudget(policy, store, clock, replays, measureResult);
  }
  async admit(request: BudgetRequest): Promise<PreparedUsageAdmission> {
    await this.controls.current();
    this.policy.assertLive();
    return await this.shared.admit(request);
  }
  async runAdmitted<T>(
    admission: PreparedUsageAdmission,
    request: BudgetRequest,
    work: (admission?: unknown) => Promise<T>,
    onStage?: (stage: RuntimeBudgetStage) => void | (() => void),
  ): Promise<T> {
    const stage = (name: RuntimeBudgetStage) => {
      try {
        ignoreStageCompletion(onStage?.(name));
      } catch {
        // Diagnostic completion callbacks must not change the business result.
      }
    };
    stage("budget_business_current");
    await this.controls.current();
    this.policy.assertLive();
    const result = await this.shared.runAdmitted(admission, async (activeAdmission) => {
      stage("budget_business");
      const value = await work(activeAdmission);
      stage("budget_business_current");
      await this.controls.current();
      this.policy.assertLive();
      return value;
    }, request);
    stage("budget_final_current");
    await this.controls.current();
    this.policy.assertLive();
    this.shared.assertAdmission(admission, request);
    return result;
  }
  assertAdmission(admission: PreparedUsageAdmission, request: BudgetRequest): void {
    this.policy.assertLive();
    this.shared.assertAdmission(admission, request);
  }
  cancelAdmission(admission: PreparedUsageAdmission): Promise<void> {
    return this.shared.cancel(admission);
  }
  async run<T>(
    request: BudgetRequest,
    work: (admission?: unknown) => Promise<T>,
    onStage?: (stage: RuntimeBudgetStage) => void | (() => void),
  ): Promise<T> {
    const stage = (value: RuntimeBudgetStage) => {
      try {
        const restore = onStage?.(value);
        ignoreStageCompletion(restore);
        return () => {
          try {
            if (typeof restore === "function") ignoreStageCompletion(restore());
          } catch { /* A failed observer restore cannot affect settlement or work. */ }
        };
      } catch {
        return () => {};
      }
    };
    const shared = onStage
      ? new SharedRequestBudget(
        {
          prepare: (r) => {
            stage("budget_plan");
            return this.policy.prepare(r);
          },
        },
        {
          reserve: (r) => {
            stage("budget_reserve");
            return this.store.reserve(r);
          },
          settle: async (lease, outcome, usage) => {
            const restore = stage(
              outcome === "success" ? "budget_settle_success" : "budget_settle_failure",
            );
            await this.store.settle(lease, outcome, usage);
            // Successful failure cleanup must not hide the original failing phase.
            if (outcome === "failure") restore();
          },
        },
        this.clock,
        {
          exists: (r) => {
            stage("budget_replay");
            return this.replays.exists(r);
          },
        },
        this.measureResult,
      )
      : this.shared;
    stage("budget_current");
    await this.controls.current();
    this.policy.assertLive();
    const result = await shared.run(request, async (activeAdmission) => {
      stage("budget_business_current");
      await this.controls.current();
      stage("budget_business");
      const value = await work(activeAdmission);
      stage("budget_business_current");
      await this.controls.current();
      this.policy.assertLive();
      return value;
    });
    stage("budget_final_current");
    await this.controls.current();
    this.policy.assertLive();
    return result;
  }
}
