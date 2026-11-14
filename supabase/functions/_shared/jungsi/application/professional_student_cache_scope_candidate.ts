/**
 * REVIEW ONLY: institutional student scope for a future private cache reader.
 * This is not a registered route, cache reader, public response, or new permission.
 * It reuses the existing pro.report.read policy; ordinary member UUIDs are never
 * treated as student IDs. Public delivery still requires the registered DTO gate.
 */
import { AccessError } from "./access.ts";
import { requireVoidDrains } from "./reference_quiescence_fence.review-only.ts";
import type { RequestClockPort } from "./ports.ts";
import { ProfessionalPolicy, proFresh, proId } from "./professional_policy.ts";
import type {
  OrganizationStudentRepositoryPort,
  ProfessionalAnalysisBoundary,
  ProfessionalAuthority,
  ProfessionalAuthorityPort,
  ProfessionalExecution,
  ProfessionalProfile,
  ProfessionalReport,
  ProfessionalScope,
  StudentReportPort,
  StudentScoreInputPort,
} from "./professional_ports.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";

function fail(): never {
  throw new AccessError("professional_policy_unavailable", 503);
}
export interface ProfessionalStudentCacheScopePorts {
  readonly policy: ProfessionalPolicy;
  readonly authorities: Pick<ProfessionalAuthorityPort, "resolve" | "assertCurrent">;
  readonly students: Pick<OrganizationStudentRepositoryPort, "bindScope" | "student">;
  readonly scores: Pick<StudentScoreInputPort, "profile" | "state">;
  readonly reports: Pick<StudentReportPort, "report">;
  readonly clock: RequestClockPort;
  /** Must bind this exact operation/subject/student to the actual shared usage reservation. */
  readonly assertActiveAdmission: (
    request: ProfessionalExecution,
    boundary: ProfessionalAnalysisBoundary,
  ) => Promise<void>;
  /** Must stop all authority, repository and callback I/O even after cancellation. */
  readonly awaitQuiescence: (signal: AbortSignal) => Promise<void>;
}
export type ProfessionalStudentCacheContext = Readonly<{
  scope: ProfessionalScope;
  profile: ProfessionalProfile;
  report: ProfessionalReport;
}>;

/**
 * Only the already registered pro.report.read operation can enter this candidate. Existing
 * membership, org contract, assignment, student, stage, current profile and report checks
 * run again after internal work. The callback is server-internal and MUST NOT return this
 * context to the browser. It must enforce separate approved source/head/coverage, private
 * storage and response-schema contracts; none is implemented here.
 */
export async function withProfessionalStudentCacheScopeCandidate<T>(
  request: ProfessionalExecution,
  boundary: ProfessionalAnalysisBoundary,
  ports: ProfessionalStudentCacheScopePorts,
  work: (context: ProfessionalStudentCacheContext, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (
    !request || request.operation !== "pro.report.read" || !request.user ||
    !boundary?.admission || !boundary.signal || boundary.signal.aborted || !ports?.policy ||
    !ports.authorities || !ports.students || !ports.scores || !ports.reports || !ports.clock ||
    typeof ports.assertActiveAdmission !== "function" ||
    typeof ports.awaitQuiescence !== "function" ||
    typeof work !== "function"
  ) fail();
  const orgId = proId(request.params.org_id), studentId = proId(request.params.student_id);
  const reportId = proId(request.params.report_id),
    signal = boundary.signal,
    lease = boundary.admission;
  const user = request.user, subject = user.subjectId, operation = request.operation;
  const requestId = request.requestId;
  const same = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== lease ||
      request.user !== user || request.user.subjectId !== subject ||
      request.operation !== operation ||
      request.requestId !== requestId || request.params.org_id !== orgId ||
      request.params.student_id !== studentId || request.params.report_id !== reportId
    ) fail();
  };
  const now = () => {
    const t = ports.clock.nowUtc();
    proFresh(user, t);
    ports.policy.assertLive(t);
    return t;
  };
  const active = async () => {
    same();
    now();
    await ports.assertActiveAdmission(request, boundary);
    same();
    now();
  };
  let initialAuthority: ProfessionalAuthority | null = null;
  let initialVersion: number | null = null;
  let profileId: string | null = null;
  let profileHash: string | null = null;
  let profileVersion: number | null = null;
  let reportBodyHash: string | null = null;
  let reportRevision: number | null = null;
  const checked = async (): Promise<ProfessionalStudentCacheContext> => {
    await active();
    const authority = initialAuthority ??
      await ports.authorities.resolve(user, orgId, "member", now());
    await active();
    if (authority.user.subjectId !== subject || authority.contract.orgId !== orgId) fail();
    ports.policy.assertAuthority(authority, now());
    await ports.authorities.assertCurrent(authority, now());
    await active();
    await ports.students.bindScope(authority);
    await active();
    const student = await ports.students.student(authority, studentId);
    await active();
    ports.policy.assertStudent(authority, student, operation, now());
    if (
      student.studentId !== studentId || student.academicYear !== 2027 || student.archived ||
      initialVersion !== null && student.version !== initialVersion
    ) fail();
    const scope: ProfessionalScope = Object.freeze({ authority, student });
    const report = await ports.reports.report(scope, reportId);
    await active();
    if (
      !report || report.orgId !== orgId || report.studentId !== studentId ||
      report.reportId !== reportId ||
      !Number.isSafeInteger(report.revision) || report.revision < 1 ||
      reportRevision !== null && report.revision !== reportRevision ||
      profileId !== null && report.profileId !== profileId
    ) fail();
    const profile = await ports.scores.profile(scope, report.profileId);
    await active();
    if (
      !profile || profile.orgId !== orgId || profile.studentId !== studentId ||
      profile.profileId !== report.profileId || profile.confirmed !== true ||
      profile.examId !== report.examId || profile.stage !== report.stage ||
      !Number.isSafeInteger(profile.version) || profile.version < 1 ||
      profileVersion !== null && profile.version !== profileVersion
    ) fail();
    const stage = ports.policy.stage(
      authority,
      profile.examId,
      profile.packVersion,
      profile.stage,
      now(),
      false,
    );
    const state = await ports.scores.state(scope, stage);
    await active();
    if (state.currentProfileId !== profile.profileId) fail();
    const digest = await nativeJsonSha256(profile.scores);
    await active();
    const bodyDigest = await nativeJsonSha256(report.body);
    await active();
    if (
      profileHash !== null && digest !== profileHash ||
      reportBodyHash !== null && bodyDigest !== reportBodyHash
    ) fail();
    initialAuthority ??= authority;
    initialVersion ??= student.version;
    reportRevision ??= report.revision;
    profileId ??= profile.profileId;
    profileHash ??= digest;
    profileVersion ??= profile.version;
    reportBodyHash ??= bodyDigest;
    return Object.freeze({ scope, profile, report });
  };
  try {
    const context = await checked();
    const result = await work(context, signal);
    await active();
    await checked();
    await active();
    return result;
  } finally {
    await requireVoidDrains([() => ports.awaitQuiescence(signal)]);
  }
}
