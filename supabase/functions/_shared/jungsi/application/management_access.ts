/** Eight management authorization gates; business mutations are outside this slice. */
import { AccessError } from "./access.ts";
import type { ForecastAuthorityPort, ForecastAuthorityState, VerifiedUser } from "./ports.ts";
export const MANAGEMENT_OPERATIONS = [
  "forecast.capabilities",
  "forecast.list",
  "forecast.create",
  "forecast.read",
  "forecast.adjust",
  "forecast.validate",
  "forecast.approve",
  "forecast.publish",
] as const;
export type ManagementOperation = typeof MANAGEMENT_OPERATIONS[number];
export interface ManagementDecision {
  readonly operation: ManagementOperation;
  readonly subjectId: string;
  readonly evaluatedAtUtc: bigint;
  readonly capabilities: readonly ("editor" | "approver")[];
  readonly universityIds: readonly string[];
}
function ids(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 4096 &&
    value.every((x) =>
      typeof x === "string" && x.length > 0 && x.length <= 128 && x.trim() === x
    ) && new Set(value).size === value.length;
}
function stateIsValid(state: ForecastAuthorityState, user: VerifiedUser, nowUtc: bigint): boolean {
  if (
    !state || state.authority !== "jungsi_backend.forecast_authorities" ||
    state.subjectId !== user.subjectId ||
    state.evaluatedAtUtc !== nowUtc || typeof state.edit !== "boolean" ||
    typeof state.approve !== "boolean" ||
    !ids(state.universityIds) || !ids(state.editUniversityIds) || !ids(state.approveUniversityIds)
  ) return false;
  if (
    (!state.edit && state.editUniversityIds.length > 0) ||
    (!state.approve && state.approveUniversityIds.length > 0)
  ) return false;
  const union = new Set([...state.editUniversityIds, ...state.approveUniversityIds]);
  return union.size === state.universityIds.length &&
    state.universityIds.every((x) => union.has(x));
}
export async function authorizeManagement(
  user: VerifiedUser,
  authorities: ForecastAuthorityPort,
  nowUtc: bigint,
  operation: ManagementOperation,
): Promise<ManagementDecision> {
  if (!MANAGEMENT_OPERATIONS.includes(operation)) throw new AccessError("invalid_request", 400);
  if (
    typeof nowUtc !== "bigint" || !user || typeof user.subjectId !== "string" ||
    !user.subjectId.trim() ||
    typeof user.expiresAtUtc !== "bigint" || user.expiresAtUtc <= nowUtc
  ) throw new AccessError("authentication_required", 401);
  let state;
  try {
    state = await authorities.readCurrent(user.subjectId, nowUtc);
  } catch {
    throw new AccessError("backend_dependency_unavailable", 503);
  }
  if (!stateIsValid(state, user, nowUtc)) throw new AccessError("invalid_repository_result", 503);
  const staff = state.edit || state.approve;
  if (staff) {
    if (user.assuranceLevel !== "aal2") throw new AccessError("management_mfa_required", 403);
    if (user.accountStatus == null) {
      throw new AccessError("management_account_state_unverified", 503);
    }
    if (user.accountStatus !== "active") throw new AccessError("management_account_inactive", 403);
  }
  const approval = operation === "forecast.approve" || operation === "forecast.publish";
  const read = operation === "forecast.list" || operation === "forecast.read";
  if (
    operation !== "forecast.capabilities" && !(approval ? state.approve : read ? staff : state.edit)
  ) {
    throw new AccessError("forecast_forbidden", 403);
  }
  const capabilities: ("editor" | "approver")[] = [];
  if (state.edit) capabilities.push("editor");
  if (state.approve) capabilities.push("approver");
  const schools = operation === "forecast.capabilities" || read
    ? state.universityIds
    : approval
    ? state.approveUniversityIds
    : state.editUniversityIds;
  return Object.freeze({
    operation,
    subjectId: user.subjectId,
    evaluatedAtUtc: nowUtc,
    capabilities: Object.freeze(capabilities),
    universityIds: Object.freeze([...schools]),
  });
}
export function requireManagementUniversity(
  decision: ManagementDecision,
  universityId: string,
): void {
  if (
    typeof universityId !== "string" || !universityId.trim() ||
    !decision.universityIds.includes(universityId)
  ) {
    throw new AccessError("forecast_not_found", 404);
  }
}
