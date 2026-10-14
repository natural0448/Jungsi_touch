/** Server-only dispatch contracts. No HTTP, concrete database or private provider. */
import type { ManagementDecision } from "./management_access.ts";
import type { SessionSnapshot } from "./session_service.ts";
import type { NativeJson } from "../domain/native_json.ts";
export const API_OPERATION_IDS = [
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
export type ApiOperationId = typeof API_OPERATION_IDS[number];
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
