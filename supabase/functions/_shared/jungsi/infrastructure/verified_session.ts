/** Injectable verification receipts. Real Auth/JWT/profile transport remains NOT_RUN. */
import { AccessError } from "../application/access.ts";
import { utcText } from "../domain/time.ts";
import type { UserSessionPort, VerifiedUser } from "../application/ports.ts";
export interface NativeSessionReceipt {
  readonly verification: "supabase_auth_getUser_exact_bearer";
  readonly bearerSha256: string;
  readonly subjectId: string;
  readonly expiresAtUtc: bigint;
  /** Native port supplies AAL only after verifying this exact bearer; no request metadata. */
  readonly assuranceLevel: "aal1" | "aal2" | null;
}
export interface NativeSessionVerificationPort {
  verifyExactBearer(token: string, nowUtc: bigint): Promise<NativeSessionReceipt | null>;
}
export interface OwnProfileReceipt {
  readonly verification: "own_profile_same_bearer_publishable_RLS";
  readonly bearerSha256: string;
  readonly subjectId: string;
  readonly status: string | null;
  readonly role?: string | null;
}
export interface OwnProfileVerificationPort {
  readOwnStatus(token: string, subjectId: string): Promise<OwnProfileReceipt | null>;
}
export async function bearerSha256(token: string): Promise<string> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(raw)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export class BoundVerifiedSessionProvider implements UserSessionPort {
  constructor(
    private readonly auth: NativeSessionVerificationPort,
    private readonly profiles: OwnProfileVerificationPort,
  ) {}
  async verifyUserBearer(token: string, nowUtc: bigint): Promise<VerifiedUser | null> {
    if (
      typeof token !== "string" || !token || token.length > 16384 || /[\s,]/.test(token) ||
      /^sb_(?:publishable|secret)_/.test(token)
    ) return null;
    let verified;
    try {
      verified = await this.auth.verifyExactBearer(token, nowUtc);
    } catch {
      throw new AccessError("auth_unavailable", 503);
    }
    if (verified === null) return null;
    const digest = await bearerSha256(token);
    if (
      !verified || verified.verification !== "supabase_auth_getUser_exact_bearer" ||
      verified.bearerSha256 !== digest || typeof verified.subjectId !== "string" ||
      !verified.subjectId.trim() ||
      typeof verified.expiresAtUtc !== "bigint" || verified.expiresAtUtc <= nowUtc ||
      ![null, "aal1", "aal2"].includes(verified.assuranceLevel)
    ) return null;
    try {
      utcText(verified.expiresAtUtc);
    } catch {
      return null;
    }
    let accountStatus: string | null = null;
    let accountRole: string | null = null;
    try {
      const own = await this.profiles.readOwnStatus(token, verified.subjectId);
      if (
        own && own.verification === "own_profile_same_bearer_publishable_RLS" &&
        own.bearerSha256 === digest && own.subjectId === verified.subjectId &&
        (own.status === null ||
          (typeof own.status === "string" && own.status.trim() && own.status.length <= 64))
      ) {
        accountStatus = own.status;
        if (typeof own.role === "string" && own.role.trim() && own.role.length <= 64) {
          accountRole = own.role;
        }
      }
    } catch { /* Unknown status closes management; student/session reads survive. */ }
    return Object.freeze({
      subjectId: verified.subjectId,
      expiresAtUtc: verified.expiresAtUtc,
      assuranceLevel: verified.assuranceLevel,
      accountStatus,
      accountRole,
    });
  }
}
