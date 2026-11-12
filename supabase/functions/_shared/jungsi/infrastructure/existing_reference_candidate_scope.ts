/** 4-page scope from the already approved current tail selection; no new data or receipt. */
import { AccessError } from "../application/access.ts";
import type { ReferenceCandidateRequest } from "../application/reference_candidate_scope.ts";
import type { PublishedReferenceScopeSource } from "../application/reference_candidate_access.ts";
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
type Selected = {
  registrySha256: string;
  selectionSha256: string;
  approvalReferenceSha256: string;
  tails: readonly unknown[];
};
type Provider = {
  referenceSelection(signal: AbortSignal): Promise<Readonly<Selected>>;
  referenceTailOfferings(year: number, exam: string): readonly string[];
};
const HASH = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new AccessError("reference_scope_unavailable", 503);
}
function live(s: AbortSignal): void {
  if (!s || s.aborted) fail();
}
export class ExistingReferenceCandidateScope implements PublishedReferenceScopeSource {
  private readonly pending = new Set<Promise<unknown>>();
  constructor(
    private readonly data: Provider,
    private readonly guard: (signal: AbortSignal) => Promise<void>,
    readonly sourceSha256: string,
    readonly selectionSha256: string,
    readonly budgetPolicySha256: string,
    readonly consumerReceiptSha256: string,
    readonly maximumRows: number,
    readonly maximumEvidenceBytes: number,
    readonly maximumRuntimeMilliseconds: number,
  ) {
    if (
      !data || typeof data.referenceSelection !== "function" ||
      typeof data.referenceTailOfferings !== "function" ||
      typeof guard !== "function" ||
      ![sourceSha256, selectionSha256, budgetPolicySha256, consumerReceiptSha256].every((v) =>
        HASH.test(v)
      ) ||
      ![maximumRows, maximumEvidenceBytes, maximumRuntimeMilliseconds].every((v) =>
        Number.isSafeInteger(v) && v > 0
      ) ||
      maximumRows > 256 || maximumEvidenceBytes > 65536 || maximumRuntimeMilliseconds > 8000
    ) fail();
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
    return promise;
  }
  async assertCurrent(
    request: Readonly<ReferenceCandidateRequest>,
    signal: AbortSignal,
  ): Promise<void> {
    return await this.track((async () => {
      live(signal);
      if (
        !request || !Number.isSafeInteger(request.academicYear) ||
        request.academicYear < 2024 || request.academicYear > 2027 ||
        typeof request.examId !== "string" || !request.examId
      ) fail();
      await this.guard(signal);
      live(signal);
      const selected = await this.data.referenceSelection(signal);
      live(signal);
      if (
        selected.registrySha256 !== this.sourceSha256 ||
        selected.selectionSha256 !== this.selectionSha256 ||
        !HASH.test(selected.approvalReferenceSha256) || !Array.isArray(selected.tails)
      ) fail();
      await this.guard(signal);
      live(signal);
    })());
  }
  async offeringIds(
    request: Readonly<ReferenceCandidateRequest>,
    signal: AbortSignal,
    maximumBytes: number,
  ): Promise<readonly string[]> {
    return await this.track((async () => {
      if (maximumBytes !== this.maximumEvidenceBytes) fail();
      await this.assertCurrent(request, signal);
      live(signal);
      const ids = this.data.referenceTailOfferings(request.academicYear, request.examId);
      if (
        !Array.isArray(ids) || ids.length > this.maximumRows || new Set(ids).size !== ids.length ||
        ids.some((id) =>
          typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
        ) ||
        new TextEncoder().encode(nativeJsonText(ids as unknown as NativeObject, true)).length >
          maximumBytes
      ) fail();
      await this.assertCurrent(request, signal);
      return Object.freeze([...ids]);
    })());
  }
  async cancelAndWait(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}
