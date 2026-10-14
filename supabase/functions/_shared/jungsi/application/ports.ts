/** Application-owned server verification and read-only authority ports. */
export interface VerifiedUser {
  readonly subjectId: string;
  readonly expiresAtUtc: bigint;
  readonly assuranceLevel?: "aal1" | "aal2" | null;
  readonly accountStatus?: string | null;
}
export interface UserSessionPort {
  verifyUserBearer(token: string, nowUtc: bigint): Promise<VerifiedUser | null>;
}
/** Historical synthetic boundary; current production passes use PublicPassPort. */
export interface CurrentEntitlement {
  readonly tier: "standard" | "paid";
  readonly paidUntilUtc: bigint | null;
}
export interface EntitlementPort {
  current(subjectId: string): Promise<CurrentEntitlement>;
}
export interface ReportAccess {
  readonly ownerId: string;
  readonly confirmed: boolean;
}
export interface ReportAccessPort {
  find(reportId: string): Promise<ReportAccess | null>;
}
export interface PublicPassState {
  readonly authority: "public.jeongsi_passes";
  readonly metadataVerified: true;
  readonly subjectId: string;
  readonly evaluatedAtUtc: bigint;
  readonly paidUntilUtc: bigint | null;
}
export interface PublicPassPort {
  readCurrent(subjectId: string, nowUtc: bigint): Promise<PublicPassState>;
}
export interface ForecastAuthorityState {
  readonly authority: "jungsi_backend.forecast_authorities";
  readonly subjectId: string;
  readonly evaluatedAtUtc: bigint;
  readonly edit: boolean;
  readonly approve: boolean;
  readonly universityIds: readonly string[];
  readonly editUniversityIds: readonly string[];
  readonly approveUniversityIds: readonly string[];
}
export interface ForecastAuthorityPort {
  readCurrent(subjectId: string, nowUtc: bigint): Promise<ForecastAuthorityState>;
}
export interface ManagementResourceScope {
  readonly kind: "offering" | "draft";
  readonly id: string;
  readonly universityId: string;
}
export interface ManagementResourcePort {
  readScope(
    kind: "offering" | "draft",
    id: string,
    subjectId: string,
  ): Promise<ManagementResourceScope | null>;
}
export interface RequestClockPort {
  nowUtc(): bigint;
}
