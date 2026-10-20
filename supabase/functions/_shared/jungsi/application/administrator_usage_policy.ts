/** Explicit daily exemption is issued only from a fresh factory-verified administrator. */
import { AccessError } from "./access.ts";
import { isVerifiedAdminSnapshot, sessionDto, type SessionSnapshot } from "./session_service.ts";
import type { BudgetRequest } from "./request_budget.ts";
import type { BudgetKind } from "./usage_budget.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";

export const ADMINISTRATOR_DAILY_KINDS = [
  "request_window",
  "distinct_scores",
  "calculation_cost",
  "result_volume",
] as const;
const DAY_SECONDS = 86400n;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
export interface AdministratorUsageBinding {
  readonly approvalSha256: string;
  readonly policyVersion: string;
  readonly expiresAtUtc: bigint;
  readonly requestRuntimeMicroseconds: bigint;
}
export interface AdministratorUsageProof {
  readonly owner: string;
  readonly operation: string;
  readonly session: SessionSnapshot;
  readonly approvalSha256: string;
  readonly policyVersion: string;
  readonly issuedAtUtc: bigint;
  readonly expiresAtUtc: bigint;
  readonly deadlineUtc: bigint;
  readonly exemptKinds: readonly BudgetKind[];
  readonly maximumResultBytes: bigint;
  readonly maximumCalculationUnits: bigint;
}
const proofs = new WeakSet<object>();
export function verifyAdministratorUsageProof(
  proof: AdministratorUsageProof | undefined,
  request: {
    readonly owner: string;
    readonly operation: string;
    readonly policyVersion: string;
    readonly session?: SessionSnapshot;
    readonly approvalSha256?: string;
  },
  now: bigint,
): readonly BudgetKind[] {
  if (proof === undefined) return [];
  if (
    !proofs.has(proof) || proof.owner !== request.owner || proof.operation !== request.operation ||
    proof.policyVersion !== request.policyVersion ||
    request.session !== undefined && proof.session !== request.session ||
    request.approvalSha256 !== undefined && proof.approvalSha256 !== request.approvalSha256 ||
    typeof now !== "bigint" || now < proof.issuedAtUtc || now >= proof.expiresAtUtc ||
    now >= proof.deadlineUtc ||
    !isVerifiedAdminSnapshot(proof.session)
  ) unavailable();
  sessionDto(proof.session, now);
  return proof.exemptKinds;
}
/** Policy revision and approval may change while the existing counter version stays fixed. */
export class ApprovedAdministratorUsagePolicy {
  readonly expiresAtUtc: bigint;
  private readonly binding: AdministratorUsageBinding;
  constructor(raw: NativeJson, binding: AdministratorUsageBinding) {
    const r = cloneNativeJson(raw);
    if (!r || typeof r !== "object" || Array.isArray(r) || r instanceof JsonFloat) unavailable();
    const row = r as NativeObject;
    const dimensions = row.daily_dimensions;
    const fields = [
      "format",
      "status",
      "purpose",
      "approval_reference_sha256",
      "expires_at",
      "daily_dimensions",
    ];
    if (
      Object.keys(row).length !== fields.length || fields.some((k) => !Object.hasOwn(row, k)) ||
      row.format !== "jungsi.administrator-usage-policy/v1" || row.status !== "approved" ||
      row.purpose !== "administrator_verification" ||
      !HASH.test(binding.approvalSha256) ||
      row.approval_reference_sha256 !== binding.approvalSha256 || !ID.test(binding.policyVersion) ||
      typeof binding.expiresAtUtc !== "bigint" ||
      typeof binding.requestRuntimeMicroseconds !== "bigint" ||
      binding.requestRuntimeMicroseconds < 1n ||
      !Array.isArray(dimensions) || dimensions.length !== ADMINISTRATOR_DAILY_KINDS.length ||
      new Set(dimensions).size !== ADMINISTRATOR_DAILY_KINDS.length ||
      ADMINISTRATOR_DAILY_KINDS.some((k) => !dimensions.includes(k))
    ) unavailable();
    let expiry: bigint;
    try {
      if (typeof row.expires_at !== "string") unavailable();
      expiry = utcInstant(row.expires_at);
    } catch {
      unavailable();
    }
    this.expiresAtUtc = expiry;
    if (this.expiresAtUtc > binding.expiresAtUtc) unavailable();
    this.binding = Object.freeze({ ...binding });
  }
  issue(
    request: BudgetRequest,
    periods: ReadonlyMap<BudgetKind, bigint>,
    physical: {
      readonly calculationUnits: bigint;
      readonly maximumCalculationUnits: bigint;
      readonly maximumResultBytes: bigint;
    },
    now: bigint,
  ): AdministratorUsageProof | undefined {
    if (typeof now !== "bigint") unavailable();
    sessionDto(request.session, now);
    if (!isVerifiedAdminSnapshot(request.session)) return undefined;
    if (now >= this.expiresAtUtc || now >= this.binding.expiresAtUtc) unavailable();
    if (
      typeof physical.calculationUnits !== "bigint" || physical.calculationUnits < 0n ||
      typeof physical.maximumCalculationUnits !== "bigint" ||
      physical.maximumCalculationUnits < 0n ||
      physical.calculationUnits > physical.maximumCalculationUnits ||
      typeof physical.maximumResultBytes !== "bigint" || physical.maximumResultBytes < 1n
    ) unavailable();
    // A short request/result period remains enforced. This policy cannot invent a burst value.
    const exemptKinds = ADMINISTRATOR_DAILY_KINDS.filter((k) => periods.get(k) === DAY_SECONDS);
    const proof: AdministratorUsageProof = Object.freeze({
      owner: request.session.user.subjectId,
      operation: request.operation,
      session: request.session,
      approvalSha256: this.binding.approvalSha256,
      policyVersion: this.binding.policyVersion,
      issuedAtUtc: now,
      expiresAtUtc: this.expiresAtUtc,
      deadlineUtc: now + this.binding.requestRuntimeMicroseconds,
      exemptKinds: Object.freeze(exemptKinds),
      maximumResultBytes: physical.maximumResultBytes,
      maximumCalculationUnits: physical.maximumCalculationUnits,
    });
    proofs.add(proof);
    return proof;
  }
}
