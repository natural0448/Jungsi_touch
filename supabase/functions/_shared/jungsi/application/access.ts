import { ContractError } from "../domain/exact.ts";
import { utcText } from "../domain/time.ts";
import type { EntitlementPort, ReportAccessPort, UserSessionPort, VerifiedUser } from "./ports.ts";
export class AccessError extends ContractError {
  constructor(code: string, readonly http: number) {
    super(code);
  }
}
/** Optional reference receipt state; shared authentication and budget errors stay separate. */
export class ReferenceReceiptExpired extends AccessError {
  constructor(
    code: "security_policy_unavailable" | "reference_source_unavailable" =
      "security_policy_unavailable",
  ) {
    super(code, 503);
  }
}
export class ReferenceReceiptInvalidated extends AccessError {
  constructor(
    code: "security_policy_unavailable" | "reference_source_unavailable" =
      "reference_source_unavailable",
  ) {
    super(code, 503);
  }
}
export async function authorizeUser(
  token: string,
  sessions: UserSessionPort,
  nowUtc: bigint,
): Promise<VerifiedUser> {
  let user;
  try {
    user = await sessions.verifyUserBearer(token, nowUtc);
  } catch {
    throw new AccessError("auth_unavailable", 503);
  }
  if (
    !user || typeof user.subjectId !== "string" || !user.subjectId.trim() ||
    typeof user.expiresAtUtc !== "bigint" || user.expiresAtUtc <= nowUtc
  ) throw new AccessError("authentication_required", 401);
  try {
    utcText(user.expiresAtUtc);
  } catch {
    throw new AccessError("authentication_required", 401);
  }
  const assuranceLevel = user.assuranceLevel ?? null, accountStatus = user.accountStatus ?? null;
  const accountRole = user.accountRole ?? null;
  if (
    ![null, "aal1", "aal2"].includes(assuranceLevel) ||
    (accountStatus !== null &&
      (typeof accountStatus !== "string" || !accountStatus.trim() || accountStatus.length > 64))
  ) {
    throw new AccessError("authentication_required", 401);
  }
  return Object.freeze({
    subjectId: user.subjectId,
    expiresAtUtc: user.expiresAtUtc,
    assuranceLevel,
    accountStatus,
    // An unknown/malformed optional profile role never discards a verified paid session.
    accountRole: typeof accountRole === "string" && accountRole.trim() && accountRole.length <= 64
      ? accountRole
      : null,
  });
}
export async function authorizeCurrent(
  user: VerifiedUser,
  entitlements: EntitlementPort,
  nowUtc: bigint,
  paid: boolean,
): Promise<void> {
  let current;
  try {
    current = await entitlements.current(user.subjectId);
  } catch {
    throw new AccessError("entitlement_unavailable", 503);
  }
  if (
    !current || !["standard", "paid"].includes(current.tier) ||
    (current.paidUntilUtc !== null && typeof current.paidUntilUtc !== "bigint")
  ) throw new AccessError("entitlement_unavailable", 503);
  if (
    paid &&
    (current.tier !== "paid" || current.paidUntilUtc === null || current.paidUntilUtc <= nowUtc)
  ) throw new AccessError("paid_required", 403);
}
export async function authorizeReport(
  user: VerifiedUser,
  reportId: string,
  reports: ReportAccessPort,
  confirmed: boolean,
): Promise<void> {
  if (typeof reportId !== "string" || !reportId.trim()) {
    throw new AccessError("report_required", 400);
  }
  let report;
  try {
    report = await reports.find(reportId);
  } catch {
    throw new AccessError("backend_dependency_unavailable", 503);
  }
  if (
    report &&
    (typeof report.ownerId !== "string" || !report.ownerId.trim() ||
      typeof report.confirmed !== "boolean")
  ) throw new AccessError("invalid_repository_result", 503);
  if (!report || report.ownerId !== user.subjectId) throw new AccessError("report_not_found", 404);
  if (typeof report.confirmed !== "boolean") {
    throw new AccessError("invalid_repository_result", 503);
  }
  if (confirmed && !report.confirmed) throw new AccessError("score_confirmation_required", 409);
}
