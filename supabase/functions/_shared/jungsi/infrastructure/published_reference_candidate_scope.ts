/** Optional 4-page scope pinned to the same current reference selection and existing budget. */
import { AccessError } from "../application/access.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
type Row = { key: string; entry: NativeObject };
type Selected = {
  registrySha256: string;
  selectionSha256: string;
  approvalReferenceSha256: string;
  tails: readonly Row[];
  compatibilities: readonly Row[];
};
type Provider = {
  referenceSelection(signal: AbortSignal): Promise<Readonly<Selected>>;
  loadReferenceCompatibility(
    key: string,
    signal: AbortSignal,
  ): Promise<{ entry: NativeObject; payload: NativeObject } | null>;
};
type ScopeRequest = {
  subjectId: string;
  reportId: string;
  reportRevision: number;
  profileId: string;
  academicYear: number;
  examId: string;
  scoreBasis: string;
  catalogVersion: string;
};
type ExistingLimits = {
  usagePolicySha256: string;
  maxRows: number;
  maxEvidenceBytes: number;
  maxRuntimeMilliseconds: number;
};
const HASH = /^[0-9a-f]{64}$/;
const KEYS = [
  "format",
  "version",
  "status",
  "scope",
  "selection_sha256",
  "usage_policy_sha256",
  "academic_year",
  "exam_id",
  "score_basis",
  "catalog_version",
  "offering_ids",
  "max_rows",
  "max_evidence_bytes",
  "max_runtime_milliseconds",
  "source_review_sha256",
  "independent_review_sha256",
];
function fail(): never {
  throw new AccessError("reference_scope_unavailable", 503);
}
function live(s: AbortSignal): void {
  if (!s || s.aborted) fail();
}
function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function hash(v: unknown): v is string {
  return typeof v === "string" && HASH.test(v);
}
function positive(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}
function same(a: unknown, b: unknown): boolean {
  try {
    return nativeJsonText(a as NativeObject, true) === nativeJsonText(b as NativeObject, true);
  } catch {
    return false;
  }
}
/** At most one explicitly selected scope receipt; absence means 4P reference remains pending. */
export class PublishedReferenceCandidateScope {
  readonly sourceSha256: string;
  readonly selectionSha256: string;
  readonly budgetPolicySha256: string;
  readonly consumerReceiptSha256: string;
  readonly maximumRows: number;
  readonly maximumEvidenceBytes: number;
  readonly maximumRuntimeMilliseconds: number;
  private readonly pending = new Set<Promise<unknown>>();
  private constructor(
    private readonly data: Provider,
    private readonly guard: (signal: AbortSignal) => Promise<void>,
    private readonly entry: NativeObject,
    private readonly receipt: NativeObject,
    selection: Readonly<Selected>,
  ) {
    this.sourceSha256 = selection.registrySha256;
    this.selectionSha256 = selection.selectionSha256;
    this.budgetPolicySha256 = receipt.usage_policy_sha256 as string;
    this.consumerReceiptSha256 = entry.sha256 as string;
    this.maximumRows = receipt.max_rows as number;
    this.maximumEvidenceBytes = receipt.max_evidence_bytes as number;
    this.maximumRuntimeMilliseconds = receipt.max_runtime_milliseconds as number;
  }
  static async open(
    data: Provider,
    guard: (signal: AbortSignal) => Promise<void>,
    limits: ExistingLimits,
    signal: AbortSignal,
  ): Promise<PublishedReferenceCandidateScope | null> {
    live(signal);
    if (
      !data || typeof guard !== "function" || !limits || !hash(limits.usagePolicySha256) ||
      ![limits.maxRows, limits.maxEvidenceBytes, limits.maxRuntimeMilliseconds].every(positive)
    ) fail();
    await guard(signal);
    live(signal);
    const selected = await data.referenceSelection(signal);
    live(signal);
    if (
      !selected ||
      ![selected.registrySha256, selected.selectionSha256, selected.approvalReferenceSha256].every(
        hash,
      )
    ) fail();
    const choices = selected.compatibilities.filter((v) =>
      v.entry.reference_use === "candidate_scope"
    );
    if (choices.length === 0) return null;
    if (choices.length !== 1) fail();
    const row = choices[0];
    if (typeof row.key !== "string" || !row.key || !hash(row.entry.sha256)) fail();
    const loaded = await data.loadReferenceCompatibility(row.key, signal);
    live(signal);
    if (!loaded || !same(loaded.entry, row.entry) || !object(loaded.payload)) fail();
    const p = loaded.payload;
    if (
      Object.keys(p).sort().join(",") !== [...KEYS].sort().join(",") ||
      p.format !== "jungsi.reference-consumer-scope/v1" ||
      p.version !== row.entry.version || p.status !== "verified_reference" ||
      p.scope !== "same_exam_mathematical_reference" ||
      p.selection_sha256 !== selected.selectionSha256 ||
      p.usage_policy_sha256 !== limits.usagePolicySha256 ||
      p.source_review_sha256 !== row.entry.source_review_sha256 ||
      p.independent_review_sha256 !== row.entry.independent_review_sha256 ||
      !hash(p.source_review_sha256) || !hash(p.independent_review_sha256) ||
      !positive(p.max_rows) || p.max_rows > limits.maxRows || !positive(p.max_evidence_bytes) ||
      p.max_evidence_bytes > limits.maxEvidenceBytes ||
      !positive(p.max_runtime_milliseconds) ||
      p.max_runtime_milliseconds > limits.maxRuntimeMilliseconds ||
      typeof p.academic_year !== "number" || !Number.isSafeInteger(p.academic_year) ||
      [p.exam_id, p.score_basis, p.catalog_version].some((v) => typeof v !== "string" || !v) ||
      !Array.isArray(p.offering_ids) || !p.offering_ids.length ||
      p.offering_ids.length > p.max_rows ||
      p.offering_ids.some((v) => typeof v !== "string" || !v) ||
      new Set(p.offering_ids).size !== p.offering_ids.length
    ) fail();
    if (
      !positive(row.entry.bytes) || row.entry.bytes > p.max_evidence_bytes ||
      new TextEncoder().encode(nativeJsonText(p.offering_ids, true)).length > p.max_evidence_bytes
    ) fail();
    // Every offered key must be selected exactly once for this same exam/year; no cross-year inference.
    const count = new Map<string, number>();
    for (const tail of selected.tails) {
      const c = tail.entry.reference_context, rows = tail.entry.reference_bindings;
      if (!object(c) || !Array.isArray(rows)) fail();
      if (c.academic_year !== p.academic_year || c.exam_id !== p.exam_id) continue;
      for (const binding of rows) {
        if (!object(binding) || typeof binding.offering_id !== "string") fail();
        const id = binding.offering_id;
        count.set(id, (count.get(id) ?? 0) + 1);
      }
    }
    if (p.offering_ids.some((id) => count.get(id as string) !== 1)) fail();
    const result = new PublishedReferenceCandidateScope(
      data,
      guard,
      cloneNativeJson(row.entry),
      cloneNativeJson(p),
      selected,
    );
    await result.currentSelection(signal);
    return result;
  }
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
    return work;
  }
  private async currentSelection(signal: AbortSignal): Promise<void> {
    live(signal);
    await this.guard(signal);
    live(signal);
    const current = await this.data.referenceSelection(signal);
    live(signal);
    const hit = current.compatibilities.filter((v) => v.key === this.entry.key);
    if (
      current.registrySha256 !== this.sourceSha256 ||
      current.selectionSha256 !== this.selectionSha256 || hit.length !== 1 ||
      !same(hit[0].entry, this.entry)
    ) fail();
  }
  async assertCurrent(request: Readonly<ScopeRequest>, signal: AbortSignal): Promise<void> {
    return await this.track((async () => {
      await this.currentSelection(signal);
      if (
        !request || request.academicYear !== this.receipt.academic_year ||
        request.examId !== this.receipt.exam_id ||
        request.scoreBasis !== this.receipt.score_basis ||
        request.catalogVersion !== this.receipt.catalog_version
      ) fail();
    })());
  }
  async offeringIds(
    request: Readonly<ScopeRequest>,
    signal: AbortSignal,
    maximumBytes: number,
  ): Promise<readonly string[]> {
    return await this.track((async () => {
      if (maximumBytes !== this.maximumEvidenceBytes) fail();
      await this.currentSelection(signal);
      if (
        request.academicYear !== this.receipt.academic_year ||
        request.examId !== this.receipt.exam_id ||
        request.scoreBasis !== this.receipt.score_basis ||
        request.catalogVersion !== this.receipt.catalog_version
      ) fail();
      live(signal);
      return Object.freeze([...(this.receipt.offering_ids as string[])]);
    })());
  }
  async cancelAndWait(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}
