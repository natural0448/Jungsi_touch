/** Server-only dispatch contracts. No HTTP, concrete database or private provider. */
import type { ManagementDecision } from "./management_access.ts";
import type { SessionSnapshot } from "./session_service.ts";
import type { NativeJson } from "../domain/native_json.ts";
export const LEGACY_API_OPERATION_IDS = [
  "history.search",
  "recruitment.read",
  "score-profile.create",
  "overall.analyze",
  "report.read",
  "offerings.search",
  "offering.read",
  "university.analyze",
  "candidates.build",
  "shortlist.update",
  "report.export",
  "statistics.read",
  "session.read",
  "forecast.capabilities",
  "forecast.list",
  "forecast.create",
  "forecast.read",
  "forecast.adjust",
  "forecast.validate",
  "forecast.approve",
  "forecast.publish",
  "forecast.published.read",
] as const;
export const SCORE_POLICY_OPERATION_IDS = [
  "score-input.status.read",
  "score-input.correction.grant",
  "report.sample.read",
] as const;
/** Preserve every legacy operation and register policy extensions explicitly. */
export const API_OPERATION_IDS = [
  ...LEGACY_API_OPERATION_IDS,
  ...SCORE_POLICY_OPERATION_IDS,
] as const;
/** Candidate registrations do not change the default legacy route set or installed binding. */
export const READ_VIEW_OPERATION_IDS = [
  "history.snapshot.head",
  "history.snapshot.read",
  "report.list-own",
] as const;
export const REGISTERED_API_OPERATION_IDS = [
  ...API_OPERATION_IDS,
  ...READ_VIEW_OPERATION_IDS,
] as const;
export const READ_VIEW_ROUTE_PATHS = {
  "history.snapshot.head": "/api/v1/admission-history/snapshot/head",
  "history.snapshot.read": "/api/v1/admission-history/snapshots/{snapshot_id}",
  "report.list-own": "/api/v1/me/reports",
} as const;
export const LEGACY_CONSUMER_OPERATION_IDS = [
  "session.read",
  "history.search",
  "recruitment.read",
  "score-profile.create",
  "overall.analyze",
  "report.read",
  "offerings.search",
  "offering.read",
  "university.analyze",
  "candidates.build",
  "shortlist.update",
  "report.export",
  "statistics.read",
  "forecast.published.read",
] as const;
export const READ_VIEW_CONSUMER_OPERATION_IDS = [
  ...LEGACY_CONSUMER_OPERATION_IDS,
  ...READ_VIEW_OPERATION_IDS,
] as const;
/** Explicit future operating-policy + administrator composition; never upgrades the read17 binding. */
export const COMBINED_POLICY_CONSUMER_OPERATION_IDS = [
  ...READ_VIEW_CONSUMER_OPERATION_IDS,
  ...SCORE_POLICY_OPERATION_IDS,
] as const;
export type ApiOperationId = typeof REGISTERED_API_OPERATION_IDS[number];
export interface ApiRoutePolicy {
  readonly id: ApiOperationId;
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly member_tiers: readonly ("standard" | "paid")[];
  readonly report_owner: boolean;
  readonly confirmed_score_profile: boolean;
}
export interface ApiExecution {
  readonly operation: ApiOperationId;
  readonly session: SessionSnapshot;
  readonly management: ManagementDecision | null;
  readonly body: NativeJson;
  readonly query: Readonly<Record<string, string>>;
  readonly params: Readonly<Record<string, string>>;
  readonly requestKey: string | null;
}
export interface ApiBusinessPort {
  execute(request: ApiExecution): Promise<unknown>;
}
