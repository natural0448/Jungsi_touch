/** Service-owned atomic input, immutable result provenance and first delivery ports. */
import type { ScoreInputStage, ScoreInputState } from "../domain/score_input_rights.ts";
import type { NativeObject } from "../domain/json_value.ts";
import type { ProfileWrite, StoredProfile, StoredReport } from "./platform_repository.ts";
export interface ApprovedScoreStage {
  readonly examId: string;
  /** Server canonical exam/season, shared by approved aliases and pack revisions. */
  readonly scopeId: string;
  readonly packVersion: string;
  readonly academicYear: number;
  readonly stage: ScoreInputStage;
  readonly opensAtUtc: bigint | null;
  readonly closesAtUtc: bigint | null;
  readonly policyVersion: string;
  readonly rolloutId: string;
  readonly approvalSha256: string;
}
export interface ScoreInputContext {
  readonly owner: string;
  readonly stage: ApprovedScoreStage;
  readonly previewExempt: boolean;
}
export interface ScoreInputAttempt {
  readonly attemptId: string;
  readonly owner: string;
  readonly operation: "score-profile.create" | "overall.profile";
  readonly key: string;
  readonly digest: string;
  readonly state: ScoreInputState;
  readonly outcome: "accepted" | "rejected";
  readonly profile: StoredProfile | null;
  readonly context: ScoreInputContext;
  readonly rejectionCode: string | null;
}
export interface ScoreCorrectionCommand {
  readonly actor: string;
  readonly owner: string;
  readonly stage: ApprovedScoreStage;
  readonly ticketRef: string;
  readonly expectedVersion: number;
  readonly reasonCode: "score_correction";
  readonly key: string;
  readonly digest: string;
  readonly nowUtc: bigint;
}
export interface ScoreCorrectionReceipt {
  readonly commandId: string;
  readonly ticketRef: string;
  readonly state: ScoreInputState;
}
export interface PaidResultOriginWrite {
  readonly passId: string | null;
  readonly accessBasis: "customer_pass" | "verified_admin";
  readonly operation: "overall.analyze" | "university.analyze" | "candidates.build";
  readonly componentKeys: readonly string[];
}
export interface SavedSnapshotScope {
  readonly overall: boolean;
  readonly analysisIds: readonly string[];
  readonly candidates: boolean;
  readonly legacyVerified: boolean;
}
export interface PaidResultDelivery {
  readonly owner: string;
  readonly operation:
    | "overall.analyze"
    | "university.analyze"
    | "candidates.build"
    | "report.read"
    | "report.export";
  /** Current verified pass for a paid operation; read/export use original provenance only. */
  readonly accessPassId: string | null;
  readonly reportId: string;
  readonly revision: number;
  readonly componentKeys: readonly string[];
  readonly requestId: string;
  readonly nowUtc: bigint;
  readonly tokenExpiresAtUtc: bigint;
}
export interface ScoreInputRepositoryPort {
  /** A null stage record is not zero credit until the rollout/legacy checks pass. */
  state(context: ScoreInputContext): Promise<ScoreInputState>;
  replay(
    owner: string,
    operation: string,
    key: string,
    digest: string,
  ): Promise<ScoreInputAttempt | null>;
  commitProfile(context: ScoreInputContext, profile: ProfileWrite): Promise<ScoreInputAttempt>;
  commitRejection(context: ScoreInputContext, input: {
    readonly operation: "score-profile.create" | "overall.profile";
    readonly key: string;
    readonly digest: string;
    readonly code: string;
    readonly nowUtc: bigint;
  }): Promise<ScoreInputAttempt>;
  profileContext(owner: string, profileId: string): Promise<ScoreInputContext | null>;
  currentReport(owner: string, profileId: string): Promise<StoredReport | null>;
  profileConsumed(owner: string, profileId: string): Promise<boolean>;
  grantCorrection(command: ScoreCorrectionCommand): Promise<ScoreCorrectionReceipt>;
  snapshotScope(owner: string, reportId: string, revision: number): Promise<SavedSnapshotScope>;
  firstPaidResult(owner: string, passId: string): Promise<string | null>;
  /** Resolve immutable original-pass provenance, then unique-insert per pass in one transaction. */
  recordDelivered(input: PaidResultDelivery): Promise<void>;
}
export interface ScoreInputPolicyPort {
  status(
    session: import("./session_service.ts").SessionSnapshot,
    query: Readonly<Record<string, string>>,
  ): Promise<NativeObject>;
}

export interface ScoreInputWorkflowPort {
  saveProfile(input: {
    readonly session: import("./session_service.ts").SessionSnapshot;
    readonly scores: unknown;
    readonly stage: unknown;
    readonly confirmed: boolean;
    readonly key: string;
    readonly digest: string;
    readonly analyze: (scores: NativeObject) => Promise<NativeObject>;
  }): Promise<{ readonly profile: StoredProfile; readonly analysis: NativeObject | null }>;
  assertProfile(
    session: import("./session_service.ts").SessionSnapshot,
    profile: StoredProfile,
  ): Promise<void>;
  reusableOverall(
    session: import("./session_service.ts").SessionSnapshot,
    profile: StoredProfile,
  ): Promise<StoredReport | null>;
  analysisContext(profileId: string): Promise<string>;
  origin(
    session: import("./session_service.ts").SessionSnapshot,
    operation: PaidResultOriginWrite["operation"],
    componentKeys: readonly string[],
  ): PaidResultOriginWrite;
  snapshotScope(owner: string, reportId: string, revision: number): Promise<SavedSnapshotScope>;
  deliver(
    session: import("./session_service.ts").SessionSnapshot,
    operation: string,
    result: NativeObject,
    requestId: string,
    requestedOfferingIds?: readonly string[],
  ): Promise<void>;
}
