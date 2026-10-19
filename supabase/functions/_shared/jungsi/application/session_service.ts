/** Request-local session projection. No HTTP, concrete database, or default wiring. */
import { AccessError, authorizeUser } from "./access.ts";
import type { PublicPassPort, UserSessionPort, VerifiedUser } from "./ports.ts";
import { utcText } from "../domain/time.ts";
export interface SessionSnapshot {
  readonly user: VerifiedUser;
  readonly evaluatedAtUtc: bigint;
  readonly tier: "standard" | "paid";
  readonly paidUntilUtc: bigint | null;
  readonly paidPassId?: string | null;
  /** Private server origin; never a public DTO field or a client role claim. */
  readonly adminOrigin?: "verified_own_profile_active_admin_aal2";
}
const verifiedAdminSnapshots = new WeakSet<SessionSnapshot>();
function verifiedAdmin(user: VerifiedUser): boolean {
  return user.accountRole === "admin" && user.accountStatus === "active" &&
    user.assuranceLevel === "aal2";
}
export interface SessionDto {
  readonly format: "jungsi.session/v1";
  readonly member_tier: "standard" | "paid";
  readonly entitlement_expires_at: string | null;
}
export async function readSessionSnapshot(
  token: string,
  sessions: UserSessionPort,
  passes: PublicPassPort,
  nowUtc: bigint,
): Promise<SessionSnapshot> {
  if (typeof nowUtc !== "bigint") throw new AccessError("backend_dependency_unavailable", 503);
  const user = await authorizeUser(token, sessions, nowUtc);
  let state;
  try {
    state = await passes.readCurrent(user.subjectId, nowUtc);
  } catch (error) {
    if (
      error instanceof AccessError && error.http === 503 &&
      [
        "entitlement_unavailable",
        "entitlement_schema_unverified",
        "entitlement_runtime_role_unverified",
        "entitlement_rls_unverified",
        "entitlement_identity_or_time_invalid",
        "entitlement_result_invalid",
      ].includes(error.code)
    ) throw error;
    throw new AccessError("entitlement_unavailable", 503);
  }
  if (
    !state || state.authority !== "public.jeongsi_passes" || state.metadataVerified !== true ||
    state.subjectId !== user.subjectId || state.evaluatedAtUtc !== nowUtc ||
    (state.passId !== undefined &&
      ((state.passId === null) !== (state.paidUntilUtc === null) ||
        state.passId !== null &&
          (typeof state.passId !== "string" || !/^[1-9][0-9]*$/.test(state.passId) ||
            BigInt(state.passId) > 9223372036854775807n))) ||
    (state.paidUntilUtc !== null &&
      (typeof state.paidUntilUtc !== "bigint" || state.paidUntilUtc <= nowUtc))
  ) {
    throw new AccessError("entitlement_unavailable", 503);
  }
  const admin = verifiedAdmin(user);
  const snapshot: SessionSnapshot = Object.freeze({
    user,
    evaluatedAtUtc: nowUtc,
    tier: state.paidUntilUtc === null && !admin ? "standard" : "paid",
    paidUntilUtc: state.paidUntilUtc,
    paidPassId: state.passId ?? null,
    ...(admin ? { adminOrigin: "verified_own_profile_active_admin_aal2" as const } : {}),
  });
  if (admin) verifiedAdminSnapshots.add(snapshot);
  return snapshot;
}
export function sessionDto(snapshot: SessionSnapshot, nowUtc: bigint): SessionDto {
  if (typeof nowUtc !== "bigint" || nowUtc < snapshot.evaluatedAtUtc) {
    throw new AccessError("backend_dependency_unavailable", 503);
  }
  if (snapshot.user.expiresAtUtc <= nowUtc) throw new AccessError("authentication_required", 401);
  if (snapshot.tier === "standard") {
    return Object.freeze({
      format: "jungsi.session/v1",
      member_tier: "standard",
      entitlement_expires_at: null,
    });
  }
  if (
    snapshot.paidUntilUtc === null && verifiedAdminSnapshots.has(snapshot) &&
    snapshot.adminOrigin === "verified_own_profile_active_admin_aal2" &&
    verifiedAdmin(snapshot.user)
  ) {
    return Object.freeze({
      format: "jungsi.session/v1",
      member_tier: "paid",
      entitlement_expires_at: null,
    });
  }
  if (snapshot.paidUntilUtc === null || snapshot.paidUntilUtc <= nowUtc) {
    throw new AccessError("entitlement_unavailable", 503);
  }
  let expiry;
  try {
    expiry = utcText(snapshot.paidUntilUtc);
  } catch {
    throw new AccessError("entitlement_unavailable", 503);
  }
  return Object.freeze({
    format: "jungsi.session/v1",
    member_tier: "paid",
    entitlement_expires_at: expiry,
  });
}
export function requirePaidSession(snapshot: SessionSnapshot, nowUtc: bigint): void {
  const dto = sessionDto(snapshot, nowUtc);
  if (dto.member_tier !== "paid") throw new AccessError("paid_required", 403);
}

/** Private identity proof; neither client role fields nor a copied snapshot grant exemption. */
export function isVerifiedAdminSnapshot(snapshot: SessionSnapshot): boolean {
  return verifiedAdminSnapshots.has(snapshot) &&
    snapshot.adminOrigin === "verified_own_profile_active_admin_aal2" &&
    verifiedAdmin(snapshot.user);
}
