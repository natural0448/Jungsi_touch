/** Optional verified student-UUID/name file inside a verified personal-owner scope. */
import { AccessError } from "./access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { requireBooleanStopped } from "./reference_quiescence_fence.review-only.ts";
import {
  assertPersonalOwnerStorageIdentity,
  type PersonalOwnerStorageIdentity,
} from "./personal_owner_storage_scope_candidate.ts";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}

type VerifiedStudentName = Readonly<{
  state: "verified";
  ownerUuid: string;
  studentUuid?: string;
  studentName: string;
  receipt: object;
}>;
/** A trusted authority must prove the actual member->student relation, student UUID and exact
 * name against current records. Login owner UUID, caller input and a digest are not proof. */
export interface PersonalSelfStudentNameAuthority {
  issue(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    identity: PersonalOwnerStorageIdentity,
  ): Promise<Readonly<{ state: "pending" }> | VerifiedStudentName>;
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    identity: PersonalOwnerStorageIdentity,
    issued: VerifiedStudentName,
  ): Promise<void>;
  /** True only after every identity and downstream operation has physically stopped. */
  awaitQuiescence(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export type PersonalStudentFilenameResult =
  | Readonly<
    {
      state: "pending";
      reason: "self_student_name_unverified" | "self_student_identity_unverified";
    }
  >
  | Readonly<{ state: "ready"; studentUuid: string; logicalFilename: string }>;
type ReadyFilename = Extract<PersonalStudentFilenameResult, { state: "ready" }>;
const issuedFilenames = new WeakMap<
  ReadyFilename,
  Readonly<{
    request: ApiExecution;
    boundary: ApiExecutionBoundary;
    identity: PersonalOwnerStorageIdentity;
  }>
>();
/** Verify request-local server-minted proof, not a caller-supplied name or student identifier. */
export function assertPersonalStudentFilename(
  value: ReadyFilename,
  scope: Readonly<
    { ownerUuid: string; profileId: string; reportId: string; reportRevision: number }
  >,
  signal: AbortSignal,
): void {
  const proof = value && issuedFilenames.get(value);
  if (
    !proof || !scope || !signal || signal.aborted || signal !== proof.boundary.signal ||
    proof.identity.ownerUuid !== scope.ownerUuid || proof.identity.profileId !== scope.profileId ||
    proof.identity.reportId !== scope.reportId ||
    proof.identity.reportRevision !== scope.reportRevision
  ) fail();
  assertPersonalOwnerStorageIdentity(proof.request, proof.boundary, proof.identity);
}
/** Filename and ID are private and only valid within this owner-authorized callback. */
export async function withPersonalSelfStudentFilename<T>(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  identity: PersonalOwnerStorageIdentity,
  authority: PersonalSelfStudentNameAuthority,
  work: (value: PersonalStudentFilenameResult, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  assertPersonalOwnerStorageIdentity(request, boundary, identity);
  if (
    !authority || typeof authority.issue !== "function" ||
    typeof authority.assertCurrent !== "function" ||
    typeof authority.awaitQuiescence !== "function" || typeof work !== "function"
  ) fail();
  const signal = boundary.signal,
    active = () => assertPersonalOwnerStorageIdentity(request, boundary, identity);
  try {
    const result = await authority.issue(request, boundary, identity);
    active();
    if (!result) fail();
    if (result.state === "pending") {
      return await work(
        Object.freeze({ state: "pending", reason: "self_student_identity_unverified" }),
        signal,
      );
    }
    if (
      result.state !== "verified" || result.ownerUuid !== identity.ownerUuid ||
      typeof result.studentName !== "string" || !result.receipt ||
      typeof result.receipt !== "object" || !Object.isFrozen(result.receipt)
    ) fail();
    const studentUuid = result.studentUuid;
    if (typeof studentUuid !== "string" || !UUID.test(studentUuid)) {
      return await work(
        Object.freeze({ state: "pending", reason: "self_student_identity_unverified" }),
        signal,
      );
    }
    const name = result.studentName;
    if (
      !name || !name.trim() || name.length > 100 ||
      Array.from(name).some((char) =>
        char === "\\" || char === "/" || char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127
      )
    ) {
      return await work(
        Object.freeze({ state: "pending", reason: "self_student_name_unverified" }),
        signal,
      );
    }
    try {
      encodeURIComponent(name);
    } catch {
      return await work(
        Object.freeze({ state: "pending", reason: "self_student_name_unverified" }),
        signal,
      );
    }
    await authority.assertCurrent(request, boundary, identity, result);
    active();
    const value: ReadyFilename = Object.freeze({
      state: "ready",
      studentUuid,
      logicalFilename: `${studentUuid}_${name}.json`,
    });
    issuedFilenames.set(value, Object.freeze({ request, boundary, identity }));
    try {
      const output = await work(value, signal);
      active();
      await authority.assertCurrent(request, boundary, identity, result);
      active();
      return output;
    } finally {
      issuedFilenames.delete(value);
    }
  } finally {
    await requireBooleanStopped(() => authority.awaitQuiescence(request, boundary, signal));
  }
}
