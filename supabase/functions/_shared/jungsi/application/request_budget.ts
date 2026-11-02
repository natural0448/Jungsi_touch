/** Application-owned shared budget boundary; runtime has no unlimited default. */
import { AccessError } from "./access.ts";
import type { NativeJson } from "../domain/native_json.ts";
import type { SessionSnapshot } from "./session_service.ts";
export class RequestLimitError extends AccessError {
  constructor(
    code: "rate_limit_exceeded" | "analysis_quota_exceeded",
    readonly retryAfterSeconds: number,
  ) {
    super(code, 429);
    if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1) {
      throw new AccessError("security_policy_unavailable", 503);
    }
  }
}
export interface BudgetRequest {
  readonly operation: string;
  readonly session: SessionSnapshot;
  readonly body: NativeJson;
  readonly query: Readonly<Record<string, string>>;
  readonly params: Readonly<Record<string, string>>;
  readonly requestKey: string | null;
}
export interface RequestBudgetPort {
  /** Reserve shared request/compute/concurrency/response costs before work;
   * settle or release within the same call. Replay still consumes request/volume.
   * Missing/unapproved policy and dependency failure must throw a safe 503.
   */
  run<T>(request: BudgetRequest, work: (admission?: unknown) => Promise<T>): Promise<T>;
}
export const BUDGET_OPERATIONS = [
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
  "score-input.status.read",
  "score-input.correction.grant",
  "report.sample.read",
  "history.snapshot.head",
  "history.snapshot.read",
  "report.list-own",
  "member-shortlist.read",
  "member-shortlist.update",
] as const;
