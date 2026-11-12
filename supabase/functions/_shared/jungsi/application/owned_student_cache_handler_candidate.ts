/**
 * REVIEW ONLY: owned-personal-student cache read handler, not a registered route.
 * It reuses existing paid-session, report ownership, current score-profile and public
 * response projection logic. The actual subject↔student issuer, source/head authority,
 * private storage, registered response schema and runtime admission binding are NOT supplied.
 * Institutional students require a separate ProfessionalPolicy-bound implementation.
 */
import { AccessError, authorizeReport } from "./access.ts";
import {
  requireReferenceDurableFence,
  requireVoidDrains,
} from "./reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import type { PlatformRepositoryPort, StoredProfile, StoredReport } from "./platform_repository.ts";
import type { RequestClockPort } from "./ports.ts";
import { PublicResponseProjection } from "./public_response.ts";
import type { ScoreInputWorkflowPort } from "./score_input_ports.ts";
import { requirePaidSession } from "./session_service.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";
import {
  readCurrentStudentCache,
  type StudentCachePrivateReadPort,
  type StudentCacheReadAuthority,
  type StudentCacheReadGrant,
  type StudentCacheReadHead,
} from "./student_score_cache_read_candidate.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}

/** A separately trusted implementation must check the actual mapping, not compare UUIDs. */
export interface OwnedStudentLinkAuthority {
  assertOwned(subjectId: string, studentId: string, signal: AbortSignal): Promise<void>;
}
/** Route and exact schema bytes must be independently pinned to this request and admission. */
export interface StudentCacheDeliveryAuthority {
  assertCurrent(
    input: Readonly<{
      request: ApiExecution;
      boundary: ApiExecutionBoundary;
      projection: PublicResponseProjection;
      contractRef: string;
    }>,
  ): Promise<void>;
}
export interface OwnedStudentCacheHandlerPorts {
  readonly repository: Pick<PlatformRepositoryPort, "getProfile" | "getReport" | "lookupAccess">;
  readonly workflow: Pick<ScoreInputWorkflowPort, "assertProfile">;
  readonly studentLink: OwnedStudentLinkAuthority;
  readonly sourceAuthority: StudentCacheReadAuthority;
  readonly storage: StudentCachePrivateReadPort;
  readonly clock: RequestClockPort;
  readonly projection: PublicResponseProjection;
  readonly deliveryAuthority: StudentCacheDeliveryAuthority;
  /** Runtime adapter MUST bind to the real budget issuer's assertRunAdmission(..., "active"). */
  readonly assertActiveAdmission: (
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
  ) => Promise<void>;
  /** Must work even after abort, physically stopping EVERY started link, repo, source,
   * storage and delivery I/O before it resolves. Rejection is not proof of termination. */
  readonly awaitQuiescence: (signal: AbortSignal) => Promise<void>;
}
type Input = Readonly<{
  studentId: string;
  profileId: string;
  reportId: string | null;
  reportRevision: number | null;
}>;
function stableInput(raw: Input): Input {
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) fail();
  const fields = ["studentId", "profileId", "reportId", "reportRevision"];
  const keys = Reflect.ownKeys(raw);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) fail();
  const values: Record<string, unknown> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail();
    values[key] = descriptor.value;
  }
  if (
    typeof values.studentId !== "string" || !UUID.test(values.studentId) ||
    typeof values.profileId !== "string" || !ID.test(values.profileId) ||
    !(values.reportId === null && values.reportRevision === null ||
      typeof values.reportId === "string" && ID.test(values.reportId) &&
        Number.isSafeInteger(values.reportRevision) && (values.reportRevision as number) >= 1)
  ) fail();
  return Object.freeze({
    studentId: values.studentId,
    profileId: values.profileId,
    reportId: values.reportId as string | null,
    reportRevision: values.reportRevision as number | null,
  });
}

/**
 * Must be invoked only from an independently registered, relay-authenticated, budgeted API
 * route. Route parameters/body cannot grant student ownership. Returned data is projected
 * against exact separately registered schema bytes; without that schema this always fails.
 * Does not create a profile, calculate, enqueue, mutate, publish or expose storage names.
 */
export async function handleOwnedStudentCacheReadCandidate(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  rawInput: Input,
  contractRef: string,
  ports: OwnedStudentCacheHandlerPorts,
): Promise<unknown> {
  requireReferenceDurableFence();
  const input = stableInput(rawInput);
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    typeof contractRef !== "string" || !ID.test(contractRef) ||
    !ports?.repository || !ports.workflow || !ports.studentLink || !ports.sourceAuthority ||
    !ports.storage || !ports.clock || !ports.projection || !ports.deliveryAuthority ||
    typeof ports.assertActiveAdmission !== "function" ||
    typeof ports.awaitQuiescence !== "function" ||
    typeof ports.studentLink.assertOwned !== "function" ||
    typeof ports.deliveryAuthority.assertCurrent !== "function" ||
    !ports.projection.hasExactRegistryBytes() ||
    !ports.projection.supportsOperation(request.operation, contractRef)
  ) fail();
  const signal = boundary.signal, admission = boundary.admission;
  const session = request.session, user = session.user, subject = user.subjectId;
  const operation = request.operation, requestKey = request.requestKey;
  if (
    !UUID.test(subject) ||
    request.params.student_id !== undefined && request.params.student_id !== input.studentId ||
    request.params.profile_id !== undefined && request.params.profile_id !== input.profileId ||
    request.params.report_id !== undefined && request.params.report_id !== input.reportId
  ) fail();
  const same = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session !== session || session.user !== user || user.subjectId !== subject ||
      request.operation !== operation || request.requestKey !== requestKey
    ) fail();
  };
  const active = async () => {
    same();
    requirePaidSession(session, ports.clock.nowUtc());
    await ports.assertActiveAdmission(request, boundary);
    same();
  };
  let expectedProfile: string | null = null;
  const checkIdentity = async (): Promise<void> => {
    await active();
    // Link resolution is independent of the login UUID and must query a trusted authority.
    await ports.studentLink.assertOwned(subject, input.studentId, signal);
    await active();
    let report: StoredReport | null = null;
    if (input.reportId !== null) {
      await authorizeReport(user, input.reportId, {
        find: (id) => ports.repository.lookupAccess(subject, id),
      }, true);
      await active();
      report = await ports.repository.getReport(subject, input.reportId);
      await active();
      if (
        !report || report.owner_id !== subject || report.report_id !== input.reportId ||
        report.profile_id !== input.profileId || report.revision !== input.reportRevision
      ) fail();
    }
    const profile: StoredProfile | null = await ports.repository.getProfile(
      subject,
      input.profileId,
    );
    await active();
    if (
      !profile || profile.owner_id !== subject || profile.profile_id !== input.profileId ||
      profile.confirmed !== true || report && report.profile_id !== profile.profile_id
    ) fail();
    // Reuse the real score input workflow's confirmed-current-stage and ownership checks.
    await ports.workflow.assertProfile(session, profile);
    await active();
    const digest = await nativeJsonSha256(profile.scores);
    await active();
    if (expectedProfile !== null && expectedProfile !== digest) fail();
    expectedProfile = digest;
  };
  const source = ports.sourceAuthority;
  let issued: StudentCacheReadGrant | null = null;
  const wrapped: StudentCacheReadAuthority = {
    issue: async (r, b) => {
      if (r !== request || b !== boundary || issued !== null) fail();
      await checkIdentity();
      const grant = await source.issue(r, b);
      await checkIdentity();
      if (
        !grant || grant.studentId !== input.studentId || grant.profileId !== input.profileId ||
        grant.reportId !== input.reportId || grant.reportRevision !== input.reportRevision
      ) fail();
      issued = grant;
      return grant;
    },
    assertCurrent: async (r, b, grant, head, storage) => {
      if (
        r !== request || b !== boundary || !issued || grant.studentId !== input.studentId ||
        grant.profileId !== input.profileId || storage !== ports.storage
      ) fail();
      await checkIdentity();
      await source.assertCurrent(r, b, grant, head, storage);
      await checkIdentity();
    },
    verifyCoverage: async (grant, head, keys, s) => {
      if (
        !issued || s !== signal || grant.studentId !== input.studentId ||
        grant.profileId !== input.profileId
      ) fail();
      await checkIdentity();
      const valid = await source.verifyCoverage(grant, head, keys, s);
      await checkIdentity();
      return valid === true;
    },
    awaitReadQuiescence: async (r, b, grant, head: StudentCacheReadHead | null, s) => {
      if (r !== request || b !== boundary || s !== signal) fail();
      const stoppedAndCurrent = await source.awaitReadQuiescence(r, b, grant, head, s);
      if (stoppedAndCurrent !== true) return false;
      await checkIdentity();
      return true;
    },
  };
  try {
    // Authenticate and validate the active reservation before any candidate-specific I/O.
    await active();
    await ports.deliveryAuthority.assertCurrent({
      request,
      boundary,
      projection: ports.projection,
      contractRef,
    });
    await active();
    const result = await readCurrentStudentCache(request, boundary, wrapped, ports.storage);
    await checkIdentity();
    await ports.deliveryAuthority.assertCurrent({
      request,
      boundary,
      projection: ports.projection,
      contractRef,
    });
    await active();
    // Actual operation/contract registration and the schema content are planning-owned.
    return ports.projection.project(
      request.operation,
      session.tier,
      Object.freeze({
        format: "jungsi.student-score-cache/v1",
        state: result.state,
        rows: result.rows,
      }),
    );
  } finally {
    await requireVoidDrains([() => ports.awaitQuiescence(signal)]);
  }
}
