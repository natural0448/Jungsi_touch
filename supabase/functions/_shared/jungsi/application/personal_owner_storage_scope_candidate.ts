/**
 * Internal personal-owner storage identity scope. This uses the verified member subject UUID
 * as a FILE OWNER KEY, not as a student UUID. It grants no bucket access or public API.
 */
import { AccessError, authorizeReport } from "./access.ts";
import { requireVoidDrains } from "./reference_quiescence_fence.review-only.ts";
import {
  type ApiExecution,
  type ApiExecutionBoundary,
  STUDENT_REFERENCE_OPERATION_ID,
} from "./api_dispatch.ts";
import type { PlatformRepositoryPort } from "./platform_repository.ts";
import type { ScoreInputWorkflowPort } from "./score_input_ports.ts";
import type { RequestClockPort } from "./ports.ts";
import { requirePaidSession } from "./session_service.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
export type PersonalOwnerStorageIdentity = Readonly<{
  kind: "personal_owner";
  /** A confirmed login subject only; not a student ID or a person merge. */
  ownerUuid: string;
  reportId: string;
  reportRevision: number;
  profileId: string;
}>;
const issued = new WeakMap<
  PersonalOwnerStorageIdentity,
  Readonly<{
    request: ApiExecution;
    boundary: ApiExecutionBoundary;
    admission: unknown;
    signal: AbortSignal;
  }>
>();
/** Validate the exact object minted inside this still-active personal owner scope. */
export function assertPersonalOwnerStorageIdentity(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  identity: PersonalOwnerStorageIdentity,
): void {
  const record = identity && issued.get(identity);
  if (
    !record || record.request !== request || record.boundary !== boundary ||
    record.admission !== boundary.admission || record.signal !== boundary.signal ||
    record.signal.aborted || request.session.user.subjectId !== identity.ownerUuid
  ) fail();
}
export interface PersonalOwnerStorageScopePorts {
  readonly repository: Pick<PlatformRepositoryPort, "lookupAccess" | "getReport" | "getProfile">;
  readonly workflow: Pick<ScoreInputWorkflowPort, "assertProfile">;
  readonly clock: RequestClockPort;
  /** Real runtime budget must validate this exact request's active admission. */
  readonly assertActiveAdmission: (
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
  ) => Promise<void>;
  /** Must drain all started SQL, authority and downstream work, including on abort/rejection. */
  readonly awaitQuiescence: (signal: AbortSignal) => Promise<void>;
}
/**
 * Authorizes an internal server callback and rechecks the owner, report revision, profile,
 * confirmed-current-stage, profile scores and report body immediately afterward. A storage
 * adapter separately needs an approved private prefix/bucket, grant/head and physical budget.
 */
export async function withVerifiedPersonalOwnerStorageScope<T>(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  input: Readonly<{ reportId: string; profileId: string; reportRevision: number }>,
  ports: PersonalOwnerStorageScopePorts,
  work: (identity: PersonalOwnerStorageIdentity, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (
    !request || request.operation !== STUDENT_REFERENCE_OPERATION_ID || !boundary?.admission ||
    !boundary.signal || boundary.signal.aborted || !input ||
    typeof input.reportId !== "string" || !ID.test(input.reportId) ||
    typeof input.profileId !== "string" || !ID.test(input.profileId) ||
    !Number.isSafeInteger(input.reportRevision) || input.reportRevision < 1 ||
    !ports?.repository || !ports.workflow || !ports.clock ||
    typeof ports.assertActiveAdmission !== "function" ||
    typeof ports.awaitQuiescence !== "function" ||
    typeof work !== "function"
  ) fail();
  const signal = boundary.signal,
    admission = boundary.admission,
    session = request.session,
    user = session.user,
    subject = user.subjectId,
    requestKey = request.requestKey;
  const reportId = input.reportId, profileId = input.profileId, revision = input.reportRevision;
  const body = request.body;
  if (
    !UUID.test(subject) || request.params.report_id !== reportId || !body ||
    typeof body !== "object" ||
    Array.isArray(body) || Object.getOwnPropertyDescriptor(body, "profile_id")?.value !== profileId
  ) fail();
  const expected = Object.getOwnPropertyDescriptor(body, "expected_version")?.value;
  if (
    !(typeof expected === "number" && expected === revision ||
      typeof expected === "bigint" && expected === BigInt(revision))
  ) fail();
  const bodyDigest = await nativeJsonSha256([body, request.params, request.query]);
  const same = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session !== session || session.user !== user || user.subjectId !== subject ||
      request.params.report_id !== reportId || request.requestKey !== requestKey
    ) fail();
  };
  const active = async () => {
    same();
    requirePaidSession(session, ports.clock.nowUtc());
    await ports.assertActiveAdmission(request, boundary);
    same();
    requirePaidSession(session, ports.clock.nowUtc());
    if (await nativeJsonSha256([body, request.params, request.query]) !== bodyDigest) fail();
    same();
  };
  let profileDigest: string | null = null, reportDigest: string | null = null;
  const check = async () => {
    await active();
    await authorizeReport(user, reportId, {
      find: (id) => ports.repository.lookupAccess(subject, id),
    }, true);
    await active();
    const report = await ports.repository.getReport(subject, reportId);
    await active();
    if (
      !report || report.owner_id !== subject || report.report_id !== reportId ||
      report.profile_id !== profileId || report.revision !== revision
    ) fail();
    const profile = await ports.repository.getProfile(subject, profileId);
    await active();
    if (
      !profile || profile.owner_id !== subject || profile.profile_id !== profileId ||
      !profile.confirmed
    ) fail();
    await ports.workflow.assertProfile(session, profile);
    await active();
    const p = await nativeJsonSha256(profile.scores), r = await nativeJsonSha256(report.body);
    await active();
    if (
      profileDigest !== null && p !== profileDigest || reportDigest !== null && r !== reportDigest
    ) fail();
    profileDigest = p;
    reportDigest = r;
  };
  try {
    await check();
    const identity: PersonalOwnerStorageIdentity = Object.freeze({
      kind: "personal_owner",
      ownerUuid: subject,
      reportId,
      reportRevision: revision,
      profileId,
    });
    issued.set(identity, Object.freeze({ request, boundary, admission, signal }));
    try {
      const result = await work(identity, signal);
      await check();
      return result;
    } finally {
      issued.delete(identity);
    }
  } finally {
    await requireVoidDrains([() => ports.awaitQuiescence(signal)]);
  }
}
