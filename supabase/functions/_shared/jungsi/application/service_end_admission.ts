import { AccessError } from "./access.ts";
export const SERVICE_END_UTC_MICROS = 1799334000000000n;
export type AdmissionDecision = "open" | "ended" | "invalid_clock";
export function admissionMicros(now: unknown): AdmissionDecision {
  if (typeof now !== "bigint" || now < 0n) return "invalid_clock";
  return now < SERVICE_END_UTC_MICROS ? "open" : "ended";
}
export function admissionMillis(now: unknown): AdmissionDecision {
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return "invalid_clock";
  return admissionMicros(BigInt(now) * 1000n);
}
export function assertAdmissionMicros(now: unknown): void {
  const result = admissionMicros(now);
  if (result === "invalid_clock") throw new AccessError("security_policy_unavailable", 503);
  if (result === "ended") throw new AccessError("service_ended", 403);
}

/** A permit is bound to the same Request and consumed once by the inner handler. */
const issued = new WeakMap<object, Request>();
export function issueAdmissionPermit(now: unknown, request: Request): object {
  assertAdmissionMicros(now);
  const permit = Object.freeze({});
  issued.set(permit, request);
  return permit;
}
export function assertAdmissionOrConsume(
  now: () => bigint,
  request: Request,
  permit?: object,
): void {
  if (permit === undefined) {
    assertAdmissionMicros(now());
    return;
  }
  if (!permit || issued.get(permit) !== request) {
    throw new AccessError("security_policy_unavailable", 503);
  }
  issued.delete(permit);
}
