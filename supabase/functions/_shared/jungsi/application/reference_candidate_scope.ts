/** Optional server-only scope. No real issuer or data provider is implemented here. */
import { AccessError } from "./access.ts";
import type { ApiExecutionBoundary } from "./api_dispatch.ts";
export interface ReferenceCandidateRequest {
  readonly subjectId: string;
  readonly reportId: string;
  readonly reportRevision: number;
  readonly profileId: string;
  readonly academicYear: number;
  readonly examId: string;
  readonly scoreBasis: string;
  readonly catalogVersion: string;
}
export interface ReferenceCandidateScope {
  readonly offeringIds: readonly string[];
  readonly signal: AbortSignal;
  assertCurrent(): Promise<void>;
  run<T>(work: Promise<T>): Promise<T>;
}
export interface ReferenceCandidateRequirements {
  readonly sourceSha256: string;
  readonly selectionSha256: string;
  readonly budgetPolicySha256: string;
  readonly consumerReceiptSha256: string;
  readonly maximumRows: number;
  readonly maximumEvidenceBytes: number;
  readonly maximumRuntimeMilliseconds: number;
  readonly requirePhysicalCancellationAndSettlement: true;
}
/** Independent server authority must verify exact request, current source/head, selected consumer,
 * existing budget admission, byte/time limits, cancellation and settlement. A hash, payload claim
 * or admission alone is not authorization. cancelAndWait must stop and acknowledge all selected
 * reference scope and tail-provider I/O before the shared lease settles. */
export interface ReferenceCandidateScopePort {
  readonly sourceSha256: string;
  readonly selectionSha256: string;
  readonly budgetPolicySha256: string;
  readonly consumerReceiptSha256: string;
  readonly maximumRows: number;
  readonly maximumEvidenceBytes: number;
  readonly maximumRuntimeMilliseconds: number;
  verifyAdmission(
    request: Readonly<ReferenceCandidateRequest>,
    admission: unknown,
    requirements: ReferenceCandidateRequirements,
    signal: AbortSignal,
  ): Promise<void>;
  readOfferingIds(
    request: Readonly<ReferenceCandidateRequest>,
    signal: AbortSignal,
    maximumEvidenceBytes: number,
  ): Promise<readonly string[]>;
  cancelAndWait(): Promise<void>;
}
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function bounded(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) > 0;
}
async function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new AccessError("security_policy_unavailable", 503));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
}
export async function acquireReferenceCandidateScope(
  request: ReferenceCandidateRequest,
  port: ReferenceCandidateScopePort | null,
  boundary?: ApiExecutionBoundary,
): Promise<ReferenceCandidateScope | null> {
  if (!port) return null;
  const hashes = [
    port.sourceSha256,
    port.selectionSha256,
    port.budgetPolicySha256,
    port.consumerReceiptSha256,
  ];
  if (
    !boundary?.signal || boundary.signal.aborted ||
    boundary.admission == null ||
    !hashes.every((v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) ||
    ![
      port.maximumRows,
      port.maximumEvidenceBytes,
      port.maximumRuntimeMilliseconds,
    ].every(
      bounded,
    ) ||
    port.maximumRuntimeMilliseconds > 2147483647 ||
    typeof port.verifyAdmission !== "function" ||
    typeof port.readOfferingIds !== "function" ||
    typeof port.cancelAndWait !== "function"
  ) unavailable();
  const captured = Object.freeze({ ...request });
  const requirements: ReferenceCandidateRequirements = Object.freeze({
    sourceSha256: hashes[0],
    selectionSha256: hashes[1],
    budgetPolicySha256: hashes[2],
    consumerReceiptSha256: hashes[3],
    maximumRows: port.maximumRows,
    maximumEvidenceBytes: port.maximumEvidenceBytes,
    maximumRuntimeMilliseconds: port.maximumRuntimeMilliseconds,
    requirePhysicalCancellationAndSettlement: true,
  });
  const verify = port.verifyAdmission.bind(port),
    read = port.readOfferingIds.bind(port),
    cancel = port.cancelAndWait.bind(port);
  const cancelled = new AbortController();
  const signal = AbortSignal.any([
    boundary.signal,
    AbortSignal.timeout(requirements.maximumRuntimeMilliseconds),
    cancelled.signal,
  ]);
  const outstanding = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    outstanding.add(promise);
    void promise.then(
      () => outstanding.delete(promise),
      () => outstanding.delete(promise),
    );
    return promise;
  };
  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (!stopped) {
      cancelled.abort();
      stopped = (async () => {
        try {
          await cancel();
        } finally {
          while (outstanding.size) await Promise.allSettled([...outstanding]);
        }
      })();
    }
    return stopped;
  };
  const ensure = async () => {
    try {
      if (signal.aborted) unavailable();
      await within(
        track(
          Promise.resolve().then(() => verify(captured, boundary.admission, requirements, signal)),
        ),
        signal,
      );
      if (signal.aborted) unavailable();
    } catch (e) {
      await stop();
      throw e;
    }
  };
  await ensure();
  let ids: readonly string[];
  try {
    ids = await within(
      track(
        Promise.resolve().then(() => read(captured, signal, requirements.maximumEvidenceBytes)),
      ),
      signal,
    );
  } catch (e) {
    await stop();
    throw e;
  }
  if (
    !Array.isArray(ids) || ids.length > requirements.maximumRows ||
    ids.some((id) => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    await stop();
    unavailable();
  }
  await ensure();
  const run = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await within(track(work), signal);
    } catch (e) {
      await stop();
      throw e;
    }
  };
  return Object.freeze({
    offeringIds: Object.freeze([...ids]),
    signal,
    assertCurrent: ensure,
    run,
  });
}
