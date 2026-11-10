/** Application-owned immutable profile/report records and atomic write port. */
import type { NativeObject } from "../domain/json_value.ts";
import type { ReportAccess } from "./ports.ts";
export interface StoredProfile {
  readonly profile_id: string;
  readonly owner_id: string;
  readonly scores: NativeObject;
  readonly confirmed: boolean;
  readonly created_at: string;
}
export interface StoredReport {
  readonly report_id: string;
  readonly owner_id: string;
  readonly profile_id: string;
  readonly revision: number;
  readonly body: NativeObject;
  readonly updated_at: string;
}
export type StoredMutation = StoredProfile | StoredReport;
export interface ProfileWrite {
  readonly owner: string;
  readonly scores: NativeObject;
  readonly confirmed: boolean;
  readonly nowUtc: bigint;
  readonly key: string;
  readonly digest: string;
  readonly operation?: "score-profile.create" | "overall.profile";
}
export interface ReportWrite {
  readonly owner: string;
  readonly reportId: string | null;
  readonly profileId: string;
  readonly body: NativeObject;
  readonly expected: number | null;
  readonly nowUtc: bigint;
  readonly operation:
    | "overall.analyze"
    | "university.analyze"
    | "candidates.build"
    | "shortlist.update";
  readonly key: string;
  readonly digest: string;
  readonly noOp?: boolean;
  readonly paidOrigin?: import("./score_input_ports.ts").PaidResultOriginWrite;
}
export interface PlatformRepositoryPort {
  replay(
    owner: string,
    operation: string,
    key: string,
    digest: string,
  ): Promise<StoredMutation | null>;
  createProfile(input: ProfileWrite): Promise<StoredProfile>;
  getProfile(owner: string, profileId: string): Promise<StoredProfile | null>;
  getReport(owner: string, reportId: string): Promise<StoredReport | null>;
  /** Optional private, owner-scoped immutable revision read for saved reference verification. */
  getReportRevision?(
    owner: string,
    reportId: string,
    revision: number,
    signal?: AbortSignal,
  ): Promise<StoredReport | null>;
  lookupAccess(owner: string, reportId: string): Promise<ReportAccess | null>;
  writeReport(input: ReportWrite): Promise<StoredReport>;
  /** Internal aggregation only; report records are never a public statistics DTO. */
  activeReports(verifiedRequestor: string): Promise<readonly StoredReport[]>;
}
