/** Professional application contracts. Actor identity and institutional ownership are separate. */
import type { NativeJson } from "../domain/native_json.ts";
import type { NativeObject } from "../domain/json_value.ts";
import type { ScoreInputStage, ScoreInputState } from "../domain/score_input_rights.ts";
import type { VerifiedUser } from "./ports.ts";
import type { ApprovedScoreStage } from "./score_input_ports.ts";

export type ProfessionalRole = "teacher" | "org_admin" | "viewer";
export interface ProfessionalRoute {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly access: string;
  readonly response_schema: string;
  readonly request: {
    readonly path_parameters: readonly string[];
    readonly body_fields: readonly string[];
    readonly query_fields: readonly string[];
    readonly Idempotency_Key_required: boolean;
    readonly BFF_CSRF_required: boolean;
  };
}
export interface ProfessionalContract {
  readonly routes: readonly ProfessionalRoute[];
  readonly DTOs: Readonly<Record<string, readonly string[] | string>>;
  readonly DTO_contract_refs: Readonly<Record<string, string>>;
  readonly cursor_and_idempotency: string;
  readonly error_contract: Readonly<Record<string, string | number>>;
}
export interface ProfessionalContractState {
  readonly orgId: string;
  readonly orgName: string;
  readonly contractId: string;
  readonly academicYear: number;
  readonly version: number;
  readonly startsAtUtc: bigint;
  readonly expiresAtUtc: bigint;
  readonly studentCapacity: number;
  readonly approvedExamIds: readonly string[];
}
export interface ProfessionalMembership {
  readonly orgId: string;
  readonly memberId: string;
  readonly subjectId: string;
  readonly role: ProfessionalRole;
  readonly version: number;
  readonly active: boolean;
}
export interface ProfessionalAuthority {
  readonly user: VerifiedUser;
  readonly contract: ProfessionalContractState;
  readonly membership: ProfessionalMembership | null;
  readonly mode: "member" | "support" | "retention";
  readonly sourceVersion: string;
  readonly evaluatedAtUtc: bigint;
  readonly ticketRef: string | null;
  readonly supportStudentId: string | null;
  readonly supportExamId: string | null;
  readonly supportStage: ScoreInputStage | null;
}
export interface ProfessionalStudent {
  readonly orgId: string;
  readonly studentId: string;
  readonly contractId: string;
  readonly academicYear: number;
  readonly version: number;
  readonly archived: boolean;
  readonly assignedSubjectIds: readonly string[];
  readonly createdAtUtc: bigint;
  readonly metadata: NativeObject;
}
export interface ProfessionalProfile {
  readonly orgId: string;
  readonly studentId: string;
  readonly profileId: string;
  readonly version: number;
  readonly examId: string;
  readonly packVersion: string;
  readonly stage: ScoreInputStage;
  readonly confirmed: boolean;
  readonly scores: NativeObject;
  readonly createdAtUtc: bigint;
}
export interface ProfessionalReport {
  readonly orgId: string;
  readonly studentId: string;
  readonly reportId: string;
  readonly revision: number;
  readonly profileId: string;
  readonly examId: string;
  readonly stage: ScoreInputStage;
  readonly body: NativeObject;
  readonly reasons: readonly NativeObject[];
  readonly createdAtUtc: bigint;
}
export interface ProfessionalCommand {
  readonly key: string;
  readonly digest: string;
  readonly operation: string;
}
export interface ProfessionalReplay {
  readonly digest: string;
  readonly result: NativeObject;
}
export interface ProfessionalScope {
  readonly authority: ProfessionalAuthority;
  readonly student: ProfessionalStudent | null;
}
export interface ProfessionalAuthorityPort {
  organizations(user: VerifiedUser, nowUtc: bigint): Promise<readonly ProfessionalAuthority[]>;
  resolve(
    user: VerifiedUser,
    orgId: string,
    mode: ProfessionalAuthority["mode"],
    nowUtc: bigint,
    ticketRef?: string,
  ): Promise<ProfessionalAuthority>;
  assertCurrent(authority: ProfessionalAuthority, nowUtc: bigint): Promise<void>;
  members(authority: ProfessionalAuthority): Promise<readonly ProfessionalMembership[]>;
  /** 기관 관리자에게만 {구성원 번호: 이름}. 이름 함수가 승인되지 않았으면 빈 객체(2026-11-13) */
  memberNames?(authority: ProfessionalAuthority): Promise<Readonly<Record<string, string>>>;
}
export interface OrganizationStudentRepositoryPort {
  /** A request-local frame encloses mutation, audit, final authority check and serialization. */
  transaction<T>(user: VerifiedUser, work: () => Promise<T>): Promise<T>;
  bindScope(authority: ProfessionalAuthority): Promise<void>;
  students(
    authority: ProfessionalAuthority,
    maximum: number,
  ): Promise<readonly ProfessionalStudent[]>;
  student(authority: ProfessionalAuthority, studentId: string): Promise<ProfessionalStudent | null>;
  seatUsage(authority: ProfessionalAuthority): Promise<number>;
  create(
    authority: ProfessionalAuthority,
    metadata: NativeObject,
    expectedContractVersion: number,
    command: ProfessionalCommand,
  ): Promise<ProfessionalStudent>;
  update(
    scope: ProfessionalScope,
    metadata: NativeObject,
    expectedVersion: number,
  ): Promise<ProfessionalStudent>;
  archive(scope: ProfessionalScope, expectedVersion: number): Promise<ProfessionalStudent>;
  assign(
    scope: ProfessionalScope,
    subjects: readonly string[],
    expectedVersion: number,
  ): Promise<ProfessionalStudent>;
  replay(
    scope: ProfessionalScope,
    command: ProfessionalCommand,
  ): Promise<ProfessionalReplay | null>;
  remember(
    scope: ProfessionalScope,
    command: ProfessionalCommand,
    result: NativeObject,
  ): Promise<void>;
}
export interface StudentScoreInputPort {
  state(scope: ProfessionalScope, stage: ApprovedScoreStage): Promise<ScoreInputState>;
  save(
    scope: ProfessionalScope,
    stage: ApprovedScoreStage,
    expectedVersion: number,
    scores: NativeObject,
    command: ProfessionalCommand,
    rejectionCode: string | null,
  ): Promise<{ state: ScoreInputState; profile: ProfessionalProfile | null }>;
  correction(
    scope: ProfessionalScope,
    stage: ApprovedScoreStage,
    expectedVersion: number,
    ticketRef: string,
    command: ProfessionalCommand,
  ): Promise<ScoreInputState>;
  profile(scope: ProfessionalScope, profileId: string): Promise<ProfessionalProfile | null>;
}
export interface StudentReportPort {
  reports(scope: ProfessionalScope, maximum: number): Promise<readonly ProfessionalReport[]>;
  report(
    scope: ProfessionalScope,
    reportId: string,
    revision?: number,
  ): Promise<ProfessionalReport | null>;
  publish(
    scope: ProfessionalScope,
    profile: ProfessionalProfile,
    operation: string,
    result: NativeObject,
    reasons: readonly NativeObject[],
    assessments?: NativeObject,
  ): Promise<ProfessionalReport>;
  bookmarks(scope: ProfessionalScope, reportId: string, maximum: number): Promise<NativeObject>;
  addBookmark(
    scope: ProfessionalScope,
    report: ProfessionalReport,
    offeringId: string,
    maximum: number,
  ): Promise<NativeObject>;
  /**
   * 2026-11-13 담은 학교 빼기: 장부를 지우지 않고 remove 기록을 쌓는다(012 bookmark_events).
   * 선택 기능이다. 없는 저장소(예전 합성 고정본)에서는 빼기 요청을 503 으로 거절한다
   */
  removeBookmark?(
    scope: ProfessionalScope,
    report: ProfessionalReport,
    offeringId: string,
    eventId: string,
    maximum: number,
  ): Promise<NativeObject>;
}
/** Internal signal and same-request usage reservation, never public response data. */
export interface ProfessionalAnalysisBoundary {
  readonly signal: AbortSignal;
  readonly admission: ProfessionalUsageLease;
}
export interface ApprovedAnalysisPort {
  /** Validate content through the unchanged approved exam pack; structural errors throw. */
  validateScores(
    authority: ProfessionalAuthority,
    stage: ApprovedScoreStage,
    scores: NativeObject,
  ): Promise<string | null>;
  analyze(
    scope: ProfessionalScope,
    profile: ProfessionalProfile,
    operation: string,
    input: NativeObject,
    boundary?: ProfessionalAnalysisBoundary,
  ): Promise<
    { result: NativeObject; reasons: readonly NativeObject[]; assessments?: NativeObject }
  >;
  assertOffering(scope: ProfessionalScope, offeringId: string): Promise<void>;
  assertCurrent(): Promise<void>;
}
export interface ProfessionalUsageLease {
  readonly id: string;
  readonly expiresAtUtc: bigint;
}
export interface ProfessionalUsagePort {
  /** Must include the existing shared physical/concurrency controls, never an admin exemption. */
  reserve(
    scope: ProfessionalScope,
    operation: string,
    command: ProfessionalCommand | null,
    context?: {
      readonly examId: string | null;
      readonly maximumCalculationUnits: bigint;
      readonly replay: boolean;
    },
  ): Promise<ProfessionalUsageLease>;
  finish(
    scope: ProfessionalScope,
    lease: ProfessionalUsageLease,
    success: boolean,
    resultBytes: bigint,
    replayed?: boolean,
  ): Promise<void>;
}
export interface ProfessionalAuditPort {
  record(
    scope: ProfessionalScope,
    event: {
      readonly requestId: string;
      readonly operation: string;
      readonly result: "success" | "rejected";
      readonly ticketRef: string | null;
    },
  ): Promise<void>;
}
export interface ProfessionalRetentionPort {
  preview(authority: ProfessionalAuthority, input: NativeObject): Promise<NativeObject>;
  noticeTargets(authority: ProfessionalAuthority): Promise<NativeObject>;
}
export interface ProfessionalCursorCodec {
  seal(payload: NativeObject): Promise<string>;
  open(token: string): Promise<NativeObject>;
}
export interface ProfessionalMetadataCipher {
  seal(orgId: string, studentId: string, value: NativeObject): Promise<string>;
  open(orgId: string, studentId: string, value: string): Promise<NativeObject>;
}
export interface ProfessionalExecution {
  readonly startedAtUtc?: bigint;
  readonly operation: string;
  readonly user: VerifiedUser;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: NativeObject;
  readonly key: string | null;
  readonly requestId: string;
}
export interface ProfessionalResponse {
  readonly orgId: string | null;
  readonly studentId: string | null;
  readonly data: NativeJson;
  readonly reasons: readonly string[];
}
