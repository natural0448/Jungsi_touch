/** Pure service-linkage review with synthetic batch evidence; no DB or network. */
import { candidateGroups } from "../../supabase/functions/_shared/jungsi/application/university_analysis.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  buildWildcardCandidateReview,
  prepareWildcardSelectionForRequest,
  type WildcardBatchBinding,
  type WildcardBatchRecord,
  type WildcardEvidenceBatchPort,
  type WildcardReviewContext,
} from "../../supabase/functions/_shared/jungsi/application/wildcard_candidate_review.ts";
import type { WildcardStability } from "../../supabase/functions/_shared/jungsi/application/wildcard_selection.ts";

const H = (x: string) => x.repeat(64);
const context: WildcardReviewContext = {
  audience: "personal",
  operationContextSha256: H("1"),
  selectionPolicySha256: H("2"),
  academicYear: 2027,
  examId: "SYNTHETIC-exam",
  scoreBasis: "actual_exam",
  maxRows: 10,
  maxSnapshotBytes: 100000,
};
const stable: Omit<WildcardStability, "marginPp"> = {
  academicYear: 2027,
  examId: "SYNTHETIC-exam",
  scoreBasis: "actual_exam",
  sourceModelVersion: "SYNTHETIC-model",
  referencePopulationSha256: H("a"),
  effectivePopulationWeightsSha256: H("b"),
  denominatorPolicyId: "SYNTHETIC-denominator",
  populationUnit: "weighted-students",
  metricDefinitionId: "SYNTHETIC-metric",
  tiePolicy: "include_equal",
  forecastApprovalId: "SYNTHETIC-approval",
};
type Def = { id: string; group: string; category: string; score: number };
const defs: Def[] = [
  { id: "SYNTHETIC-a", group: "nursing", category: "room", score: 9 },
  { id: "SYNTHETIC-b", group: "nursing", category: "room", score: 8 },
  { id: "SYNTHETIC-c", group: "health", category: "core", score: 2 },
  { id: "SYNTHETIC-d", group: "education", category: "challenge", score: 1 },
  { id: "SYNTHETIC-e", group: "contract", category: "challenge", score: 0 },
];
function fixture(items: readonly Def[] = defs) {
  const rows: NativeObject[] = items.map((x) => ({
    offering_id: x.id,
    academic_year: 2027,
    university_id: "SYNTHETIC-u-" + x.id,
    university_name: "SYNTHETIC-university",
    wildcard_group: x.group === "contract" ? null : x.group,
  }));
  const analyses: NativeObject = {};
  for (const x of items) {
    analyses[x.id] = {
      offering_id: x.id,
      status: "ready",
      category: x.category,
      reason_code: null,
      converted_score: null,
      converted_percentile: null,
      advantage: null,
      years: [],
      versions: {},
      eligibility_status: "eligible",
      synthetic_private_sentinel: "DO_NOT_EXPOSE",
    };
  }
  const records: WildcardBatchRecord[] = items.map((x) => ({
    offeringId: x.id,
    groupClassification: "approved",
    group: x.group,
    stability: { ...stable, marginPp: exact(x.score) },
  }));
  return {
    rows,
    analyses,
    records,
    expected: candidateGroups(rows, analyses, "SYNTHETIC-catalog"),
  };
}
function assert(value: unknown, why = "assertion"): asserts value {
  if (!value) throw new Error(why);
}
function same(a: unknown, b: unknown) {
  assert(nativeJsonText(a, true) === nativeJsonText(b, true), "values differ");
}
function port(
  records: readonly WildcardBatchRecord[],
  transform: (binding: WildcardBatchBinding) => WildcardBatchBinding = (x) => x,
) {
  let calls = 0, seen: WildcardBatchBinding | null = null, gotSignal: AbortSignal | null = null;
  const provider: WildcardEvidenceBatchPort = {
    read: (binding, signal) => {
      calls++;
      seen = binding;
      gotSignal = signal;
      return Promise.resolve({ binding: transform(binding), records });
    },
  };
  return { provider, calls: () => calls, seen: () => seen, signal: () => gotSignal };
}
async function run(
  f: ReturnType<typeof fixture>,
  provider: WildcardEvidenceBatchPort | null,
  ctx: WildcardReviewContext = context,
  signal = new AbortController().signal,
) {
  return await buildWildcardCandidateReview(
    f.rows,
    f.analyses,
    "SYNTHETIC-catalog",
    ctx,
    provider,
    signal,
  );
}
function cardIds(wildcards: readonly NativeObject[]): unknown[] {
  return wildcards.map((card) => (card.offering as NativeObject).offering_id);
}

Deno.test("member base groups remain exact while selector uses one full-scope batch", async () => {
  const f = fixture(), p = port(f.records), before = nativeJsonText([f.rows, f.analyses], true);
  const out = await run(f, p.provider);
  same(out.current_candidates, f.expected);
  same(nativeJsonText([f.rows, f.analyses], true), before);
  same(p.calls(), 1);
  same(p.seen()?.offeringIds, defs.map((d) => d.id));
  assert(Object.isFrozen(p.seen()) && Object.isFrozen(p.seen()?.offeringIds));
  same(out.preview.wildcard_selection.status, "ready");
  same(cardIds(out.preview.wildcards), [
    "SYNTHETIC-a",
    "SYNTHETIC-c",
    "SYNTHETIC-d",
    "SYNTHETIC-b",
  ]);
});

Deno.test("professional scope uses only preauthorized filtered rows and same selector", async () => {
  const f = fixture([defs[2], defs[4]]), p = port(f.records);
  const out = await run(f, p.provider, { ...context, audience: "professional" });
  same(p.calls(), 1);
  same(p.seen()?.audience, "professional");
  same(p.seen()?.offeringIds, ["SYNTHETIC-c", "SYNTHETIC-e"]);
  same(cardIds(out.preview.wildcards), ["SYNTHETIC-c", "SYNTHETIC-e"]);
  same(out.current_candidates, f.expected);
  const second = out.preview.wildcards[1].offering as NativeObject;
  same(second.wildcard_group, "contract");
  const original = f.rows[1];
  same(original.wildcard_group, null);
});

Deno.test("missing provider is pending, not zero, and does not change legacy result", async () => {
  const f = fixture(), out = await run(f, null);
  same(out.current_candidates, f.expected);
  same(out.preview.mode, "REVIEW_ONLY");
  same(out.preview.wildcard_selection.status, "pending");
  same(out.preview.wildcard_selection.reason_code, "wildcard_evidence_unavailable");
  same(out.preview.wildcards, []);
});

Deno.test("partial retains proven wildcard prefix and separate pending status", async () => {
  const f = fixture([
    defs[0],
    { ...defs[2], category: "core", score: 2 },
    { ...defs[3], category: "core", score: 1 },
  ]);
  const records = f.records.map((r) =>
    r.offeringId === "SYNTHETIC-d"
      ? { ...r, stability: { ...r.stability!, effectivePopulationWeightsSha256: H("c") } }
      : r
  );
  const out = await run(f, port(records).provider);
  same(out.current_candidates, f.expected);
  same(out.preview.wildcard_selection.status, "partial");
  same(out.preview.wildcard_selection.reason_code, "wildcard_comparison_unverified");
  same(cardIds(out.preview.wildcards), ["SYNTHETIC-a"]);
  same(out.preview.wildcard_selection.card_stability, [
    { offering_id: "SYNTHETIC-a", status: "verified" },
  ]);
});

Deno.test("different denominators without a certain first card stay pending", async () => {
  const f = fixture([defs[0], { ...defs[2], category: "room" }]);
  const records = f.records.map((r) =>
    r.offeringId === "SYNTHETIC-c"
      ? { ...r, stability: { ...r.stability!, effectivePopulationWeightsSha256: H("c") } }
      : r
  );
  const out = await run(f, port(records).provider);
  same(out.preview.wildcard_selection.status, "pending");
  same(out.preview.wildcards, []);
  same(out.current_candidates, f.expected);
});

Deno.test("singleton selection is ready while missing stability is separately pending", async () => {
  const f = fixture([defs[0]]);
  const out = await run(f, port([{ ...f.records[0], stability: null }]).provider);
  same(out.preview.wildcard_selection.status, "ready");
  same(cardIds(out.preview.wildcards), ["SYNTHETIC-a"]);
  same(out.preview.wildcard_selection.card_stability, [
    { offering_id: "SYNTHETIC-a", status: "pending" },
  ]);
});

Deno.test("missing classification stays unresolved instead of becoming excluded", async () => {
  const f = fixture([defs[0], defs[2]]);
  const out = await run(f, port([f.records[0]]).provider);
  same(out.preview.wildcard_selection.status, "pending");
  same(out.preview.wildcards, []);
  same(out.current_candidates, f.expected);
});

Deno.test("wrong scope binding, duplicate rows or extra IDs never become ready", async () => {
  const f = fixture([defs[0], defs[2]]);
  for (
    const p of [
      port(f.records, (b) => ({ ...b, operationContextSha256: H("f") })),
      port(f.records, (b) => ({ ...b, audience: "professional" })),
      port([...f.records, f.records[0]]),
      port([f.records[0], { ...f.records[1], offeringId: "SYNTHETIC-other" }]),
    ]
  ) {
    const out = await run(f, p.provider);
    same(out.preview.wildcard_selection.status, "pending");
    same(out.current_candidates, f.expected);
  }
});

Deno.test("wrong exam or academic-year evidence is never marked verified", async () => {
  const f = fixture([defs[0]]);
  const bad = [{ ...f.records[0], stability: { ...f.records[0].stability!, academicYear: 2026 } }];
  const out = await run(f, port(bad).provider);
  same(out.preview.wildcard_selection.card_stability, [
    { offering_id: "SYNTHETIC-a", status: "pending" },
  ]);
});

Deno.test("port failure and approved physical bounds preserve base without leaking failure", async () => {
  const f = fixture(),
    bad: WildcardEvidenceBatchPort = {
      read: () => Promise.reject(new Error("SYNTHETIC-secret-failure")),
    };
  const out = await run(f, bad);
  same(out.preview.wildcard_selection.status, "pending");
  same(out.current_candidates, f.expected);
  assert(!JSON.stringify(out.preview).includes("SYNTHETIC-secret-failure"));
  const p = port(f.records), bounded = await run(f, p.provider, { ...context, maxRows: 1 });
  same(p.calls(), 0);
  same(bounded.current_candidates, f.expected);
  same(bounded.preview.wildcard_selection.status, "pending");
  const bytes = await run(f, p.provider, { ...context, maxSnapshotBytes: 1 });
  same(p.calls(), 0);
  same(bytes.preview.wildcard_selection.status, "pending");
});

Deno.test("provider cancellation leaves base intact and marks only review pending", async () => {
  const f = fixture(), abort = new AbortController();
  let started!: () => void, signaled: AbortSignal | null = null;
  const ready = new Promise<void>((resolve) => started = resolve);
  const provider: WildcardEvidenceBatchPort = {
    read: (_binding, signal) => {
      signaled = signal;
      started();
      return new Promise(() => {});
    },
  };
  const result = run(f, provider, context, abort.signal);
  await ready;
  abort.abort();
  const out = await result;
  assert(signaled === abort.signal);
  same(out.current_candidates, f.expected);
  same(out.preview.wildcard_selection.status, "pending");
});

Deno.test("rows, assessments and context are captured before awaiting the provider", async () => {
  const f = fixture([defs[0], defs[2]]);
  const mutable = { ...context };
  let started!: () => void,
    finish!: (
      v: { binding: WildcardBatchBinding; records: readonly WildcardBatchRecord[] },
    ) => void;
  const ready = new Promise<void>((resolve) => started = resolve);
  let captured!: WildcardBatchBinding;
  const provider: WildcardEvidenceBatchPort = {
    read: (binding) => {
      captured = binding;
      started();
      return new Promise((resolve) => finish = resolve);
    },
  };
  const pending = run(f, provider, mutable);
  await ready;
  mutable.academicYear = 2026;
  mutable.examId = "SYNTHETIC-other";
  f.rows[0].offering_id = "SYNTHETIC-changed";
  (f.analyses["SYNTHETIC-a"] as NativeObject).category = "outside";
  finish({ binding: captured, records: f.records });
  const out = await pending;
  same(out.current_candidates, f.expected);
  same(cardIds(out.preview.wildcards), ["SYNTHETIC-a", "SYNTHETIC-c"]);
});

Deno.test("accessor-based evidence cannot be marked as independently verified", async () => {
  const f = fixture([defs[0]]);
  const unstable = { ...f.records[0].stability! };
  Object.defineProperty(unstable, "marginPp", { enumerable: true, get: () => exact(9) });
  const out = await run(f, port([{ ...f.records[0], stability: unstable }]).provider);
  same(out.preview.wildcard_selection.card_stability, [
    { offering_id: "SYNTHETIC-a", status: "pending" },
  ]);
});

Deno.test("accessor-based batch records cannot be accepted as validated evidence", async () => {
  const f = fixture([defs[0]]);
  const rec = { ...f.records[0] };
  Object.defineProperty(rec, "stability", { enumerable: true, get: () => f.records[0].stability });
  const out = await run(f, port([rec]).provider);
  same(out.preview.wildcard_selection.status, "pending");
  same(out.current_candidates, f.expected);
});

Deno.test("a synchronously aborted provider still gets a rejection observer", async () => {
  const f = fixture([defs[0]]), abort = new AbortController();
  let observed = false;
  const pendingWork = new Promise<
    { binding: WildcardBatchBinding; records: readonly WildcardBatchRecord[] }
  >(() => {});
  const originalThen = pendingWork.then.bind(pendingWork);
  pendingWork.then = ((...args: Parameters<typeof pendingWork.then>) => {
    observed = true;
    return originalThen(...args);
  }) as typeof pendingWork.then;
  const provider: WildcardEvidenceBatchPort = {
    read: () => {
      abort.abort();
      return pendingWork;
    },
  };
  const out = await run(f, provider, context, abort.signal);
  same(out.preview.wildcard_selection.status, "pending");
  assert(
    observed,
    "provider work must have rejection handling even when abort happens synchronously",
  );
});
Deno.test("request port defaults off and leaves legacy candidate payload untouched", async () => {
  const f = fixture(), p = port(f.records);
  const out = await prepareWildcardSelectionForRequest({
    operation: "candidates.build",
    rows: f.rows,
    analyses: f.analyses,
    catalogVersion: "SYNTHETIC-catalog",
    context,
    signal: new AbortController().signal,
  });
  same(out.current_candidates, f.expected);
  same(out.preview, null);
  same(p.calls(), 0);
  assert(!Object.hasOwn(out.current_candidates, "wildcard_selection"));
});

Deno.test("explicit request review uses each operation scope and rejects audience mismatch", async () => {
  const f = fixture([defs[0], defs[2]]), p = port(f.records), signal = new AbortController().signal;
  const base = {
    rows: f.rows,
    analyses: f.analyses,
    catalogVersion: "SYNTHETIC-catalog",
    context,
    signal,
  };
  const personal = await prepareWildcardSelectionForRequest(
    { ...base, operation: "candidates.build" },
    { mode: "REVIEW_ONLY", evidence: p.provider },
  );
  assert(personal.preview !== null && personal.preview.mode === "REVIEW_ONLY");
  same(personal.current_candidates, f.expected);
  same(p.calls(), 1);
  const professional = await prepareWildcardSelectionForRequest(
    { ...base, operation: "pro.candidates", context: { ...context, audience: "professional" } },
    { mode: "REVIEW_ONLY", evidence: p.provider },
  );
  assert(professional.preview !== null && professional.preview.mode === "REVIEW_ONLY");
  same(professional.current_candidates, f.expected);
  same(p.calls(), 2);
  const mismatch = await prepareWildcardSelectionForRequest(
    { ...base, operation: "pro.candidates" },
    { mode: "REVIEW_ONLY", evidence: p.provider },
  );
  assert(mismatch.preview !== null);
  same(mismatch.preview.wildcard_selection.status, "pending");
  same(mismatch.current_candidates, f.expected);
  same(p.calls(), 2);
});
