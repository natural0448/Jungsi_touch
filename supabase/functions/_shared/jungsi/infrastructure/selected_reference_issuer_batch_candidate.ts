/**
 * Bounded scoped candidate: reuse verified school-reference selections in a request-local map.
 * Current Guide and explicitly authorized exact fallback retain separate authority.
 * No default artifact batch loader, current-head lease, approval or runtime selection is installed.
 */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type { RequestClockPort } from "../application/ports.ts";
import type { SchoolReferenceFunction } from "../application/school_reference_scoring.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { SupabaseSqlTransport } from "./transaction_sql.ts";
import {
  readCurrentUnifiedGuideRulesBatch,
  type UnifiedGuideKey,
  type UnifiedGuideRuleAuthority,
  type UnifiedGuideRuleRead,
} from "./current_guide_unified_batch_candidate.ts";
import {
  type IssuedTailPin,
  PublishedReferenceTailIssuer,
} from "./published_reference_tail_issuer.ts";

type BaseProvider = ConstructorParameters<typeof PublishedReferenceTailIssuer>[0];
type ReferenceSelection = Awaited<ReturnType<BaseProvider["referenceSelection"]>>;
type ExamPin = Awaited<ReturnType<BaseProvider["referenceExamPin"]>>;
type CachedReference = NonNullable<Awaited<ReturnType<NonNullable<BaseProvider["getReference"]>>>>;
/** Must be implemented by the existing independently approved artifact source: one bounded bulk
 * load of verified selected conversion functions, not a Promise.all of per-offering DB reads.
 * No implementation is installed here. Null means a selected function is genuinely unavailable. */
export interface SelectedSchoolReferenceBatchSource {
  load(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    keys: readonly UnifiedGuideKey[],
    selection: ReferenceSelection,
  ): Promise<
    readonly Readonly<{ offeringId: string; reference: SchoolReferenceFunction | null }>[]
  >;
  /** Verify actual artifact bytes/reviews, exact request, approved selection, Guide release/PK/rule,
   * CDF/exam/score-axis and non-promotion of reference-only evidence; do not trust supplied SHA. */
  assertBound(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    selection: ReferenceSelection,
    guide: readonly UnifiedGuideRuleRead[],
    rows: readonly Readonly<{
      offeringId: string;
      reference: SchoolReferenceFunction | null;
    }>[],
  ): Promise<void>;
  /** Includes abort, rejection and physically outstanding work. */
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
/** The real issuer must provide an expiring same-request current-head/access lease. Its in-memory
 * assertion must bind actual subject/report, admission, selection+Guide heads and loader identity;
 * a caller-provided timestamp, hash, object shape or boolean is not a lease. No issuer is installed. */
export interface ReferenceBatchFreshnessAuthority {
  issue(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    selection: ReferenceSelection,
    guide: readonly UnifiedGuideRuleRead[],
    source: SelectedSchoolReferenceBatchSource,
  ): Promise<
    Readonly<{
      assertCurrent(request: ApiExecution, boundary: ApiExecutionBoundary): void;
    }>
  >;
}
export type ReferenceIssuerBatchInput = Readonly<{
  request: ApiExecution;
  boundary: ApiExecutionBoundary;
  keys: readonly UnifiedGuideKey[];
  sql: SupabaseSqlTransport;
  clock: RequestClockPort;
  guideAuthority: UnifiedGuideRuleAuthority;
  budget: { reserveExternalRead(maximumBytes: number): (actualBytes: number) => void };
  source: SelectedSchoolReferenceBatchSource;
  freshness: ReferenceBatchFreshnessAuthority;
  /** Actual selected NativeDataProvider, not the caller's data. */
  base: BaseProvider;
  /** Existing request/session/owner/active admission guard, called before/after all initial I/O. */
  assertAccess(signal: AbortSignal): Promise<void>;
  nativeExactExamFallback: boolean;
}>;
// Hard disabled until a real durable UNKNOWN fence, physical cancellation and
// independent HTTP/settlement lifetimes are installed and independently verified.
const REFERENCE_PHYSICAL_FENCE_IMPLEMENTED: boolean = false;
const ID = /^[1-9][0-9]{0,18}$/;
function fail(): never {
  throw new AccessError("reference_tail_unavailable", 503);
}
function freezeData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const x of Object.values(value as Record<string, unknown>)) freezeData(x, seen);
    Object.freeze(value);
  }
  return value;
}
/** Pinned issuer semantics are reused rather than synthesizing pin or compatibility receipts. */
export class SelectedReferenceIssuerBatch {
  private readonly selections = new Map<string, Promise<IssuedTailPin | null>>();
  private readonly sourceRules = new WeakMap<IssuedTailPin, Promise<string | null>>();
  private constructor(
    private readonly delegate: PublishedReferenceTailIssuer,
    private readonly request: ApiExecution,
    private readonly boundary: ApiExecutionBoundary,
    private readonly ids: ReadonlySet<string>,
    private readonly guard: () => void,
  ) {}
  static async create(input: ReferenceIssuerBatchInput): Promise<SelectedReferenceIssuerBatch> {
    if (
      !input || !input.request || !input.boundary?.admission || !input.boundary.signal ||
      input.boundary.signal.aborted ||
      !Array.isArray(input.keys) || input.keys.length < 1 || input.keys.length > 64 ||
      !(input.sql instanceof SupabaseSqlTransport) ||
      !input.budget || typeof input.budget.reserveExternalRead !== "function" ||
      !input.source || typeof input.source.load !== "function" ||
      typeof input.source.assertBound !== "function" ||
      typeof input.source.awaitQuiescence !== "function" || !input.freshness ||
      typeof input.freshness.issue !== "function" ||
      !input.base || typeof input.assertAccess !== "function"
    ) fail();
    // Reject synchronously before this issuer starts physical work. Lease expiry alone
    // cannot prove termination or prevent overlap. Do not replace with Promise.race.
    if (!REFERENCE_PHYSICAL_FENCE_IMPLEMENTED) fail();
    const request = input.request,
      boundary = input.boundary,
      signal = boundary.signal,
      admission = boundary.admission;
    const session = request.session, user = session.user, subject = user.subjectId;
    const keys = Object.freeze(input.keys.map((k) => {
      if (k.academicYear !== 2027 || typeof k.offeringPk !== "string" || !ID.test(k.offeringPk)) {
        fail();
      }
      return Object.freeze({ academicYear: 2027, offeringPk: k.offeringPk });
    }));
    const ids = new Set(keys.map((k) => `2027:${k.offeringPk}`));
    if (ids.size !== keys.length) fail();
    const same = () => {
      if (
        signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
        request.session !== session || session.user !== user || user.subjectId !== subject
      ) fail();
    };
    let success = false;
    try {
      await input.assertAccess(signal);
      same();
      const selected = await input.base.referenceSelection(signal);
      same();
      // Clone/freeze request-local selection; this is not itself proof of selection authority.
      const selection: ReferenceSelection = Object.freeze({
        registrySha256: selected.registrySha256,
        selectionSha256: selected.selectionSha256,
        approvalReferenceSha256: selected.approvalReferenceSha256,
        tails: Object.freeze(
          selected.tails.map((r) =>
            Object.freeze({
              key: r.key,
              entry: freezeData(cloneNativeJson(r.entry) as NativeObject),
            })
          ),
        ),
        compatibilities: Object.freeze(
          selected.compatibilities.map((r) =>
            Object.freeze({
              key: r.key,
              entry: freezeData(cloneNativeJson(r.entry) as NativeObject),
            })
          ),
        ),
      });
      // Unified function performs bounded current-key JOIN and exact authorized fallback checks.
      const guide = await readCurrentUnifiedGuideRulesBatch(
        request,
        boundary,
        keys,
        input.sql,
        input.clock,
        input.guideAuthority,
        input.budget,
      );
      same();
      const loaded = await input.source.load(request, boundary, keys, selection);
      same();
      if (!Array.isArray(loaded) || loaded.length !== keys.length) fail();
      await input.source.assertBound(request, boundary, selection, guide, loaded);
      same();
      const byId = new Map<string, CachedReference | null>();
      for (let i = 0; i < keys.length; i++) {
        const row = loaded[i], g = guide[i], id = `2027:${keys[i].offeringPk}`;
        if (
          !row || row.offeringId !== id || byId.has(id) || !g ||
          g.key.academicYear !== 2027 || g.key.offeringPk !== keys[i].offeringPk
        ) fail();
        const ref = row.reference;
        if (g.status === "pending" || ref === null) {
          byId.set(id, null);
          continue;
        }
        if (
          !ref || ref.academicYear !== 2027 || ref.examType !== "september_mock" ||
          ref.binding.offering_pk !== id ||
          !ref.rule || typeof ref.rule.data.rule_id !== "string" ||
          ref.binding.rule_version !== ref.rule.data.rule_version || !g.header || !g.rule
        ) fail();
        // These are already source-validated domain instances. The external assertBound above
        // must establish actual Guide-rule equivalence; shape/hash comparisons are insufficient.
        byId.set(
          id,
          Object.freeze({
            academicYear: ref.academicYear,
            examId: ref.examId,
            packVersion: ref.packVersion,
            examType: ref.examType,
            scoreScaleId: ref.scoreScaleId,
            binding: freezeData(cloneNativeJson(ref.binding as NativeObject)),
            rule: Object.freeze({
              data: freezeData(cloneNativeJson(ref.rule.data as NativeObject)),
            }),
          }),
        );
      }
      const examIds = new Set(
        [...byId.values()].filter((r): r is CachedReference => r !== null).map((r) => r.examId),
      );
      if (examIds.size > 1) fail();
      let exam: ExamPin = null;
      if (examIds.size) {
        exam = await input.base.referenceExamPin([...examIds][0], signal);
        same();
      }
      await input.assertAccess(signal);
      same();
      const lease = await input.freshness.issue(request, boundary, selection, guide, input.source);
      same();
      if (!lease || typeof lease.assertCurrent !== "function") fail();
      const leaseAssert = lease.assertCurrent;
      const guard = () => {
        same();
        if (
          lease.assertCurrent !== leaseAssert ||
          lease.assertCurrent(request, boundary) !== undefined
        ) fail();
        same();
      };
      guard();
      // The preverified selection, bounded reference map and exam pin serve per-item lookups
      // from memory; existing issuer keeps independent compatibility parsing and proof semantics.
      const provider: BaseProvider = {
        referenceSelection: (s) =>
          guardedPromise(() => {
            if (s !== signal) fail();
            guard();
            return selection;
          }),
        referenceExamPin: (id, s) =>
          guardedPromise(() => {
            if (s !== signal) fail();
            guard();
            return exam?.key === id ? exam : null;
          }),
        getReference: (id) =>
          guardedPromise(() => {
            guard();
            if (!ids.has(id)) fail();
            return byId.get(id) ?? null;
          }),
        loadReferenceTail: async (key, s) => {
          if (s !== signal) fail();
          guard();
          const v = await input.base.loadReferenceTail(key, s);
          guard();
          return v;
        },
        loadReferenceCompatibility: async (key, s) => {
          if (s !== signal) fail();
          guard();
          const v = await input.base.loadReferenceCompatibility(key, s);
          guard();
          return v;
        },
      };
      const delegate = new PublishedReferenceTailIssuer(provider, (s) =>
        guardedPromise(() => {
          if (s !== signal) fail();
          guard();
        }), input.nativeExactExamFallback);
      guard();
      success = true;
      return new SelectedReferenceIssuerBatch(delegate, request, boundary, ids, guard);
    } finally {
      // This candidate must not permit the original admission to settle with live source work.
      try {
        await input.source.awaitQuiescence(signal);
      } catch {
        await new Promise<never>(() => {});
      }
      if (success) same();
    }
  }
  private live(signal: AbortSignal): void {
    if (
      signal !== this.boundary.signal || signal.aborted || !this.boundary.admission ||
      !this.request.session
    ) fail();
    this.guard();
  }
  async select(id: string, signal: AbortSignal): Promise<IssuedTailPin | null> {
    this.live(signal);
    if (!this.ids.has(id)) fail();
    let p = this.selections.get(id);
    if (!p) {
      p = this.delegate.select(id, signal);
      this.selections.set(id, p);
    }
    const result = await p;
    this.live(signal);
    return result;
  }
  async sourceRuleId(pin: IssuedTailPin, signal: AbortSignal): Promise<string | null> {
    this.live(signal);
    let p = this.sourceRules.get(pin);
    if (!p) {
      p = this.delegate.sourceRuleId(pin, signal);
      this.sourceRules.set(pin, p);
    }
    const result = await p;
    this.live(signal);
    return result;
  }
  modelExamPackSha256(pin: IssuedTailPin): string {
    this.guard();
    return this.delegate.modelExamPackSha256(pin);
  }
  async assertCurrent(pin: IssuedTailPin, signal: AbortSignal): Promise<void> {
    this.live(signal);
    await this.delegate.assertCurrent(pin, signal);
    this.live(signal);
  }
  async assertCompatible(
    pin: IssuedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<void> {
    this.live(signal);
    await this.delegate.assertCompatible(pin, identity, signal);
    this.live(signal);
  }
  async verifiedProvenance(
    pin: IssuedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<Readonly<NativeObject>> {
    this.live(signal);
    const v = await this.delegate.verifiedProvenance(pin, identity, signal);
    this.live(signal);
    return v;
  }
}
/** Execute synchronous guards immediately while retaining Promise rejection semantics. */
function guardedPromise<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      resolve(work());
    } catch (error) {
      reject(error);
    }
  });
}
