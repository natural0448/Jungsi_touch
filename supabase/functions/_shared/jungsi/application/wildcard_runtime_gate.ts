/**
 * Optional server-only integration contract. No real approval/authority provider exists here.
 * A matching hash, fabricated verifier, or the presence of a budget lease is not approval.
 * Production composition must leave this port absent until its independent authority verifies
 * same-request ownership, consumer receipt, immutable policy/evidence release, reserved
 * sidecar work, hard read/byte limits, and an end-to-end deadline within the existing lease.
 */
import { AccessError } from "./access.ts";
import { validWildcardSelection } from "./wildcard_public_contract.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import type { NativeJson } from "../domain/native_json.ts";
import type {
  WildcardEvidenceBatchPort,
  WildcardReviewContext,
  WildcardReviewResult,
} from "./wildcard_candidate_review.ts";

export interface WildcardExecutionBoundary {
  readonly signal: AbortSignal;
  /** Opaque existing request admission or professional lease; never part of a DTO. */
  readonly admission?: unknown;
}
export interface WildcardAuthorizedScope {
  readonly audience: "personal" | "professional";
  readonly operation: "candidates.build" | "pro.candidates";
  readonly subjectId: string;
  readonly organizationId: string | null;
  readonly studentId: string | null;
  readonly reportId: string | null;
  /** Input revision only; a new written revision still needs independent output proof. */
  readonly sourceReportRevision: number;
  readonly profileId: string;
  readonly academicYear: number;
  readonly examId: string;
  readonly scoreBasis: string;
  readonly catalogVersion: string;
  readonly analysisContextSha256: string | null;
}
export interface WildcardRuntimeGate {
  readonly selectionPolicySha256: string;
  readonly evidenceReleaseSha256: string;
  readonly budgetPolicySha256: string;
  readonly consumerReceiptSha256: string;
  readonly maximumRows: number;
  readonly maximumSnapshotBytes: number;
  readonly maximumEvidenceBytes: number;
  readonly maximumRuntimeMilliseconds: number;
  readonly evidence: WildcardEvidenceBatchPort;
  /** Must verify independently approved scope, byte/time limits and actual live admission.
   * It must additionally prove the provider physically stops and acknowledges cancellation
   * inside the existing lease, with settlement safe on every exit. No real verifier exists here.
   * Verification itself must use already bounded request-local evidence, without new I/O.
   */
  verifyAdmission(
    scope: WildcardAuthorizedScope,
    admission: unknown,
    requirements: WildcardGateRequirements,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface WildcardGateRequirements {
  readonly selectionPolicySha256: string;
  readonly evidenceReleaseSha256: string;
  readonly budgetPolicySha256: string;
  readonly consumerReceiptSha256: string;
  readonly maximumRows: number;
  readonly maximumSnapshotBytes: number;
  readonly maximumEvidenceBytes: number;
  readonly maximumRuntimeMilliseconds: number;
  readonly requirePhysicalCancellationAndSettlement: true;
}
export interface WildcardRuntimeGrant {
  readonly context: WildcardReviewContext;
  readonly evidence: WildcardEvidenceBatchPort;
  readonly signal: AbortSignal;
  readonly cachePins: readonly string[];
  assertCurrent(): Promise<void>;
}
const HASH = /^[a-f0-9]{64}$/;
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function bounded(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) > 0;
}
function aborted(signal: AbortSignal): void {
  if (signal.aborted) unavailable();
}
async function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new AccessError("security_policy_unavailable", 503));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (x) => {
        signal.removeEventListener("abort", abort);
        resolve(x);
      },
      (e) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      },
    );
    if (signal.aborted) abort();
  });
}
export async function requestWildcardGrant(
  scope: WildcardAuthorizedScope,
  gate: WildcardRuntimeGate | null,
  boundary?: WildcardExecutionBoundary,
): Promise<WildcardRuntimeGrant | null> {
  if (!gate) return null;
  if (
    !boundary || !boundary.signal || boundary.admission === null ||
    boundary.admission === undefined ||
    ![
      gate.selectionPolicySha256,
      gate.evidenceReleaseSha256,
      gate.budgetPolicySha256,
      gate.consumerReceiptSha256,
    ].every((x) => typeof x === "string" && HASH.test(x)) ||
    ![
      gate.maximumRows,
      gate.maximumSnapshotBytes,
      gate.maximumEvidenceBytes,
      gate.maximumRuntimeMilliseconds,
    ].every(bounded) || gate.maximumRuntimeMilliseconds > 2147483647 ||
    !gate.evidence || typeof gate.evidence.read !== "function" ||
    typeof gate.evidence.cancelAndWait !== "function" ||
    typeof gate.verifyAdmission !== "function" ||
    !Number.isSafeInteger(scope.sourceReportRevision) || scope.sourceReportRevision < 1 ||
    (scope.operation === "candidates.build" && scope.audience !== "personal") ||
    (scope.operation === "pro.candidates" && scope.audience !== "professional")
  ) unavailable();
  const capturedScope = Object.freeze({ ...scope });
  const pins = Object.freeze([
    gate.selectionPolicySha256,
    gate.evidenceReleaseSha256,
    gate.budgetPolicySha256,
    gate.consumerReceiptSha256,
  ]);
  const maximumRows = gate.maximumRows,
    maximumSnapshotBytes = gate.maximumSnapshotBytes,
    maximumEvidenceBytes = gate.maximumEvidenceBytes,
    maximumRuntimeMilliseconds = gate.maximumRuntimeMilliseconds,
    rawRead = gate.evidence.read.bind(gate.evidence),
    cancelAndWait = gate.evidence.cancelAndWait!.bind(gate.evidence),
    verifyAdmission = gate.verifyAdmission.bind(gate);
  const requirements: WildcardGateRequirements = Object.freeze({
    selectionPolicySha256: pins[0],
    evidenceReleaseSha256: pins[1],
    budgetPolicySha256: pins[2],
    consumerReceiptSha256: pins[3],
    maximumRows,
    maximumSnapshotBytes,
    maximumEvidenceBytes,
    maximumRuntimeMilliseconds,
    requirePhysicalCancellationAndSettlement: true,
  });
  let readStarted = false, stopped: Promise<void> | undefined;
  const evidence = Object.freeze({
    read: (...args: Parameters<WildcardEvidenceBatchPort["read"]>) => {
      readStarted = true;
      return rawRead(...args);
    },
    cancelAndWait,
  });
  const signal = AbortSignal.any([
    boundary.signal,
    AbortSignal.timeout(maximumRuntimeMilliseconds),
  ]);
  const check = async () => {
    try {
      aborted(signal);
      await within(
        Promise.resolve().then(() =>
          verifyAdmission(capturedScope, boundary.admission, requirements, signal)
        ),
        signal,
      );
      aborted(signal);
    } catch (error) {
      // Do not settle the containing budget while an approved adapter still reports live I/O.
      if (signal.aborted && readStarted) {
        stopped ??= Promise.resolve().then(() => cancelAndWait());
        await stopped;
      }
      throw error;
    }
  };
  await check();
  // Source revision is checked by the authority on every request. It is not part of
  // the reusable calculation key, because a successful write creates a new revision.
  const { sourceReportRevision: _sourceReportRevision, ...calculationScope } = capturedScope;
  const operationContextSha256 = await within(
    nativeJsonSha256({ scope: calculationScope, pins }),
    signal,
  );
  const context: WildcardReviewContext = Object.freeze({
    audience: capturedScope.audience,
    operationContextSha256,
    selectionPolicySha256: pins[0],
    academicYear: capturedScope.academicYear,
    examId: capturedScope.examId,
    scoreBasis: capturedScope.scoreBasis,
    maxRows: maximumRows,
    maxSnapshotBytes: maximumSnapshotBytes,
    maxEvidenceBytes: maximumEvidenceBytes,
  });
  aborted(signal);
  return Object.freeze({ context, evidence, signal, cachePins: pins, assertCurrent: check });
}
/** Internal DTO draft still requires the existing recursive public projection before transport. */
export function materializeWildcardReview(review: WildcardReviewResult): NativeObject {
  const view = cloneNativeJson({
    wildcards: review.preview.wildcards,
    wildcard_selection: review.preview.wildcard_selection,
  } as unknown as NativeJson) as NativeObject;
  if (!validWildcardSelection(view)) unavailable();
  const candidate = cloneNativeJson(review.current_candidates) as NativeObject;
  // Private draft: public output switches cards and status together only after separate
  // revision-bound evidence. No ordinary payload field is producer authorization.
  candidate._wildcard_selection_view = view;
  return candidate;
}
