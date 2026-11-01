/**
 * REVIEW_ONLY server candidate. Not a route, DTO, writer or activated provider.
 * Call only after the existing operation has authenticated, authorized, bounded,
 * and evaluated the exact catalog universe for its own request.
 * A matching digest is not authority; the port must independently validate it.
 */
import { candidateGroups } from "./university_analysis.ts";
import {
  selectWildcards,
  type WildcardChoice,
  type WildcardStability,
} from "./wildcard_selection.ts";
import { Rational } from "../domain/exact.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";

type Audience = "personal" | "professional";
type GroupClassification = "approved" | "excluded" | "unresolved";
export type WildcardSelectionStatus = "ready" | "partial" | "pending";
export type WildcardStabilityStatus = "verified" | "pending";
export type WildcardSelectionReason =
  | "wildcard_evidence_unavailable"
  | "wildcard_assessment_pending"
  | "wildcard_comparison_unverified";
/** Proposed optional public shape; recursive public projection is still mandatory. */
export interface WildcardSelectionDto {
  readonly status: WildcardSelectionStatus;
  readonly reason_code: WildcardSelectionReason | null;
  readonly card_stability: readonly {
    readonly offering_id: string;
    readonly status: WildcardStabilityStatus;
  }[];
}

export interface WildcardReviewContext {
  /** Already authorized request context; the integration must bind identity and ownership. */
  readonly audience: Audience;
  readonly operationContextSha256: string;
  readonly selectionPolicySha256: string;
  readonly academicYear: number;
  readonly examId: string;
  readonly scoreBasis: string;
  /** Limits supplied by the existing request budget; this module does not increase them. */
  readonly maxRows: number;
  readonly maxSnapshotBytes: number;
  /** The approved adapter must enforce this limit before/during its read. */
  readonly maxEvidenceBytes?: number;
}
export interface WildcardBatchBinding {
  readonly format: "jungsi.wildcard-review-batch/v1";
  readonly audience: Audience;
  readonly operationContextSha256: string;
  readonly selectionPolicySha256: string;
  readonly catalogVersion: string;
  readonly academicYear: number;
  readonly examId: string;
  readonly scoreBasis: string;
  readonly rowsSha256: string;
  readonly assessmentsSha256: string;
  readonly offeringIds: readonly string[];
}
export interface WildcardBatchRecord {
  readonly offeringId: string;
  readonly groupClassification: GroupClassification;
  readonly group: string | null;
  /** Server-validated and context-bound; absent evidence stays pending. */
  readonly stability: WildcardStability | null;
}
export interface WildcardEvidenceBatchPort {
  /** One bounded batch. A real implementation must validate source, approval and cancellation. */
  read(
    binding: Readonly<WildcardBatchBinding>,
    signal: AbortSignal,
    maximumEvidenceBytes?: number,
  ): Promise<
    { readonly binding: WildcardBatchBinding; readonly records: readonly WildcardBatchRecord[] }
  >;
  /** Required for a wired request; completes only after underlying I/O has actually stopped. */
  cancelAndWait?(): Promise<void>;
}
export interface WildcardReviewResult {
  /** Exact legacy result, never persisted or rewritten here. */
  readonly current_candidates: NativeObject;
  readonly preview: {
    readonly mode: "REVIEW_ONLY";
    readonly wildcards: readonly NativeObject[];
    readonly wildcard_selection: WildcardSelectionDto;
  };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const GROUPS = new Set(["nursing", "health", "education", "contract", "maritime", "railway"]);
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) && !(x instanceof JsonFloat);
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const hash = (x: unknown): x is string => typeof x === "string" && HASH.test(x);
function pending(current: NativeObject): WildcardReviewResult {
  return {
    current_candidates: current,
    preview: {
      mode: "REVIEW_ONLY",
      wildcards: [],
      wildcard_selection: {
        status: "pending",
        reason_code: "wildcard_evidence_unavailable",
        card_stability: [],
      },
    },
  };
}

/** Capture own data fields only; provider objects must not expose mutable getters. */
function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!record(value)) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}
function ownArray(value: unknown, expectedLength: number): unknown[] | null {
  if (!Array.isArray(value) || value.length !== expectedLength) return null;
  const result: unknown[] = [];
  for (let i = 0; i < expectedLength; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

/** Structural defense only. Provider authority and approval are separate obligations. */
function captureStability(
  input: unknown,
  context: WildcardReviewContext,
): WildcardStability | null {
  const value = ownData(input, [
    "marginPp",
    "academicYear",
    "examId",
    "scoreBasis",
    "sourceModelVersion",
    "referencePopulationSha256",
    "effectivePopulationWeightsSha256",
    "denominatorPolicyId",
    "populationUnit",
    "metricDefinitionId",
    "tiePolicy",
    "forecastApprovalId",
  ]);
  if (!value) return null;
  const r = value.marginPp;
  if (
    !(r instanceof Rational) || Object.getPrototypeOf(r) !== Rational.prototype ||
    !Object.isFrozen(r)
  ) {
    return null;
  }
  const n = Object.getOwnPropertyDescriptor(r, "numerator");
  const d = Object.getOwnPropertyDescriptor(r, "denominator");
  if (
    !n || !("value" in n) || typeof n.value !== "bigint" ||
    !d || !("value" in d) || typeof d.value !== "bigint" || d.value <= 0n ||
    n.value < -100n * d.value || n.value > 100n * d.value ||
    value.academicYear !== context.academicYear || value.examId !== context.examId ||
    value.scoreBasis !== context.scoreBasis || !text(value.sourceModelVersion) ||
    !hash(value.referencePopulationSha256) || !hash(value.effectivePopulationWeightsSha256) ||
    !text(value.denominatorPolicyId) || !text(value.populationUnit) ||
    !text(value.metricDefinitionId) || value.tiePolicy !== "include_equal" ||
    !text(value.forecastApprovalId)
  ) return null;
  return Object.freeze(value) as unknown as WildcardStability;
}

async function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    // Always observe the provider result, even if read() aborted synchronously.
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

/**
 * rows must already be the complete authorized universe of this operation:
 * full eligible year for the member workflow, and the existing authorized
 * year/filter scope for the professional workflow. No extra query or compute.
 */
export async function buildWildcardCandidateReview(
  rows: readonly NativeObject[],
  analyses: Readonly<NativeObject>,
  catalogVersion: string,
  context: WildcardReviewContext | null,
  provider: WildcardEvidenceBatchPort | null,
  signal: AbortSignal,
): Promise<WildcardReviewResult> {
  // Preserve the exact existing successful base result and its failure behavior.
  const current = candidateGroups(rows, analyses, catalogVersion);
  if (!context || !provider || !signal || signal.aborted) return pending(current);
  try {
    const capturedContext: WildcardReviewContext = Object.freeze({
      audience: context.audience,
      operationContextSha256: context.operationContextSha256,
      selectionPolicySha256: context.selectionPolicySha256,
      academicYear: context.academicYear,
      examId: context.examId,
      scoreBasis: context.scoreBasis,
      maxRows: context.maxRows,
      maxSnapshotBytes: context.maxSnapshotBytes,
      maxEvidenceBytes: context.maxEvidenceBytes,
    });
    if (
      !["personal", "professional"].includes(capturedContext.audience) ||
      !hash(capturedContext.operationContextSha256) ||
      !hash(capturedContext.selectionPolicySha256) ||
      !Number.isSafeInteger(capturedContext.academicYear) || capturedContext.academicYear < 1 ||
      !text(capturedContext.examId) || !text(capturedContext.scoreBasis) || !text(catalogVersion) ||
      !Number.isSafeInteger(capturedContext.maxRows) || capturedContext.maxRows < 0 ||
      rows.length > capturedContext.maxRows ||
      !Number.isSafeInteger(capturedContext.maxSnapshotBytes) ||
      capturedContext.maxSnapshotBytes < 1
    ) return pending(current);

    // Capture before awaiting the provider, and only retain analyses for this scope.
    const copiedRows = cloneNativeJson(rows as unknown as NativeJson) as unknown as NativeObject[];
    const ids = copiedRows.map((row) => row.offering_id);
    if (
      ids.some((id) => typeof id !== "string" || !ID.test(id)) ||
      new Set(ids).size !== ids.length ||
      copiedRows.some((row) => row.academic_year !== capturedContext.academicYear)
    ) return pending(current);
    const orderedRows = [...copiedRows].sort((a, b) =>
      (a.offering_id as string) < (b.offering_id as string) ? -1 : 1
    );
    const assessmentPairs: NativeJson[] = orderedRows.map((row) => [
      row.offering_id,
      cloneNativeJson(analyses[row.offering_id as string]),
    ]);
    const body = { rows: orderedRows, analyses: assessmentPairs };
    if (
      new TextEncoder().encode(nativeJsonText(body, true)).byteLength >
        capturedContext.maxSnapshotBytes
    ) {
      return pending(current);
    }
    const binding: WildcardBatchBinding = Object.freeze({
      format: "jungsi.wildcard-review-batch/v1",
      audience: capturedContext.audience,
      operationContextSha256: capturedContext.operationContextSha256,
      selectionPolicySha256: capturedContext.selectionPolicySha256,
      catalogVersion,
      academicYear: capturedContext.academicYear,
      examId: capturedContext.examId,
      scoreBasis: capturedContext.scoreBasis,
      rowsSha256: await nativeJsonSha256(orderedRows),
      assessmentsSha256: await nativeJsonSha256(assessmentPairs),
      offeringIds: Object.freeze(orderedRows.map((row) => row.offering_id as string)),
    });
    if (signal.aborted) return pending(current);
    const batch = ownData(
      await awaitAbortable(
        provider.read(binding, signal, capturedContext.maxEvidenceBytes),
        signal,
      ),
      ["binding", "records"],
    );
    const returnedBinding = ownData(batch?.binding, [
      "format",
      "audience",
      "operationContextSha256",
      "selectionPolicySha256",
      "catalogVersion",
      "academicYear",
      "examId",
      "scoreBasis",
      "rowsSha256",
      "assessmentsSha256",
      "offeringIds",
    ]);
    const returnedIds = ownArray(returnedBinding?.offeringIds, binding.offeringIds.length);
    if (
      !batch || !returnedBinding || !returnedIds || !Array.isArray(batch.records) ||
      batch.records.length > orderedRows.length
    ) return pending(current);
    returnedBinding.offeringIds = returnedIds;
    if (nativeJsonText(returnedBinding, true) !== nativeJsonText(binding, true)) {
      return pending(current);
    }
    const entries = ownArray(batch.records, batch.records.length);
    if (!entries) return pending(current);
    const permitted = new Set(binding.offeringIds);
    const records = new Map<string, WildcardBatchRecord>();
    for (const entry of entries) {
      const raw = ownData(entry, ["offeringId", "groupClassification", "group", "stability"]);
      if (
        !raw || typeof raw.offeringId !== "string" || !permitted.has(raw.offeringId) ||
        records.has(raw.offeringId) ||
        !["approved", "excluded", "unresolved"].includes(raw.groupClassification as string) ||
        (raw.groupClassification === "approved"
          ? typeof raw.group !== "string" || !GROUPS.has(raw.group)
          : raw.group !== null)
      ) return pending(current);
      records.set(
        raw.offeringId,
        Object.freeze({
          offeringId: raw.offeringId,
          groupClassification: raw.groupClassification as GroupClassification,
          group: raw.group as string | null,
          stability: captureStability(raw.stability, capturedContext),
        }),
      );
    }
    const assessmentMap = new Map(assessmentPairs.map((pair) => {
      const p = pair as NativeJson[];
      return [p[0] as string, p[1]] as const;
    }));
    const proofStatus = new Map<string, WildcardStabilityStatus>();
    const groups = new Map<string, string>();
    const choices: WildcardChoice<string>[] = orderedRows.map((row) => {
      const id = row.offering_id as string,
        raw = records.get(id),
        assessment = assessmentMap.get(id);
      const a = record(assessment) ? assessment : {};
      const stability = raw?.stability ?? null;
      proofStatus.set(id, stability ? "verified" : "pending");
      if (raw?.groupClassification === "approved" && raw.group) groups.set(id, raw.group);
      return {
        offeringId: id,
        group: raw?.group ?? null,
        groupClassification: raw?.groupClassification ?? "unresolved",
        status: typeof a.status === "string" ? a.status : "pending",
        category: typeof a.category === "string" ? a.category : null,
        stability,
        value: id,
      };
    });
    const selection = selectWildcards(choices);
    const cards = new Map<string, NativeObject>();
    for (const group of current.basic_university_groups as NativeObject[]) {
      if (!Array.isArray(group.offerings)) return pending(current);
      for (const item of group.offerings) {
        if (
          !record(item) || !record(item.offering) || typeof item.offering.offering_id !== "string"
        ) {
          return pending(current);
        }
        cards.set(item.offering.offering_id, item as NativeObject);
      }
    }
    const wildcards: NativeObject[] = [],
      cardStability: { offering_id: string; status: WildcardStabilityStatus }[] = [];
    for (const id of selection.items) {
      const original = cards.get(id), group = groups.get(id);
      if (!original || !group) return pending(current);
      const card = cloneNativeJson(original) as NativeObject;
      const offering = card.offering;
      if (!record(offering)) return pending(current);
      offering.wildcard_group = group;
      wildcards.push(card);
      cardStability.push({ offering_id: id, status: proofStatus.get(id) ?? "pending" });
    }
    const status: WildcardSelectionStatus = selection.status === "ready"
      ? "ready"
      : selection.items.length
      ? "partial"
      : "pending";
    return {
      current_candidates: current,
      preview: {
        mode: "REVIEW_ONLY",
        wildcards,
        wildcard_selection: {
          status,
          reason_code: selection.status === "ready" ? null : selection.reasonCode,
          card_stability: cardStability,
        },
      },
    };
  } catch {
    // Keep the successful base candidate result; do not expose provider errors.
    return pending(current);
  }
}

/**
 * Request-scoped candidate for future server composition. A null gate is strictly OFF:
 * it produces only the legacy result and never calls the evidence port. Even the
 * explicit review-only gate yields no HTTP response or persistence by itself.
 * The caller must already have enforced fresh authentication, ownership/tenant,
 * existing universe and physical/time budgets, and must provide a request signal.
 * Future persistence/cache activation additionally requires immutable evidence
 * release/policy pins and idempotent replay semantics, not supplied here.
 */
export interface WildcardCandidateRequest {
  readonly operation: "candidates.build" | "pro.candidates";
  readonly rows: readonly NativeObject[];
  readonly analyses: Readonly<NativeObject>;
  readonly catalogVersion: string;
  readonly context: WildcardReviewContext;
  readonly signal: AbortSignal;
}
export interface WildcardRequestReviewGate {
  readonly mode: "REVIEW_ONLY";
  /** Injected only by trusted server composition; no implementation is provided. */
  readonly evidence: WildcardEvidenceBatchPort;
}
export async function prepareWildcardSelectionForRequest(
  request: WildcardCandidateRequest,
  gate: WildcardRequestReviewGate | null = null,
): Promise<
  WildcardReviewResult | { readonly current_candidates: NativeObject; readonly preview: null }
> {
  if (!gate) {
    return {
      current_candidates: candidateGroups(request.rows, request.analyses, request.catalogVersion),
      preview: null,
    };
  }
  if (
    gate.mode !== "REVIEW_ONLY" ||
    (request.operation === "candidates.build" && request.context.audience !== "personal") ||
    (request.operation === "pro.candidates" && request.context.audience !== "professional") ||
    !["candidates.build", "pro.candidates"].includes(request.operation)
  ) return pending(candidateGroups(request.rows, request.analyses, request.catalogVersion));
  return await buildWildcardCandidateReview(
    request.rows,
    request.analyses,
    request.catalogVersion,
    request.context,
    gate.evidence,
    request.signal,
  );
}
