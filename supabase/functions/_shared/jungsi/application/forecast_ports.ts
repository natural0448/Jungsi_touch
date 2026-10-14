/** Application-owned forecast storage and immutable input ports. */
import type { ManagementDecision, ManagementOperation } from "./management_access.ts";
import type { ForecastAuthorityPort } from "./ports.ts";
import type { NativeObject } from "../domain/json_value.ts";
import type { AccessError } from "./access.ts";
export interface ForecastInputPort {
  inputs(offeringId: string, inputId: string, version: string): Promise<NativeObject>;
  policy(policyId: string, version: string): Promise<NativeObject>;
  currentContext(offeringId: string): Promise<NativeObject>;
}
export interface ForecastDraftScope {
  readonly draftId: string;
  readonly universityId: string;
}
export interface ForecastTransactionPort extends ForecastAuthorityPort {
  draftScope(draftId: string): Promise<ForecastDraftScope | null>;
  get(draftId: string, decision: ManagementDecision): Promise<NativeObject | null>;
  put(
    record: Readonly<NativeObject>,
    expectedRevision: number | null,
    decision: ManagementDecision,
  ): Promise<void>;
  publish(release: Readonly<NativeObject>, decision: ManagementDecision): Promise<void>;
}
export interface ForecastRepositoryPort extends ForecastAuthorityPort {
  draftScope(subjectId: string, draftId: string): Promise<ForecastDraftScope | null>;
  get(
    subjectId: string,
    draftId: string,
    decision: ManagementDecision,
  ): Promise<NativeObject | null>;
  list(
    subjectId: string,
    decision: ManagementDecision,
    universityId: string | null,
  ): Promise<readonly NativeObject[]>;
  published(subjectId: string, offeringId: string): Promise<NativeObject | null>;
  publishedMany(
    subjectId: string,
    offeringIds: readonly string[],
  ): Promise<ReadonlyMap<string, NativeObject | AccessError | null>>;
  transact(
    subjectId: string,
    operation: ManagementOperation,
    key: string,
    requestHash: string,
    nowUtc: bigint,
    authorize: (store: ForecastTransactionPort) => Promise<ManagementDecision>,
    mutate: (store: ForecastTransactionPort, decision: ManagementDecision) => Promise<NativeObject>,
  ): Promise<NativeObject>;
}
