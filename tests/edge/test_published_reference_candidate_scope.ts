// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic candidate scope; release and budget approval are not implied. */
import { PublishedReferenceCandidateScope } from "../../supabase/functions/_shared/jungsi/infrastructure/published_reference_candidate_scope.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
const H = (s: string) => s.repeat(64),
  limits = {
    usagePolicySha256: H("d"),
    maxRows: 8,
    maxEvidenceBytes: 4096,
    maxRuntimeMilliseconds: 2000,
  };
function fixture() {
  const entry: NativeObject = {
    kind: "reference_compatibility",
    key: "scope",
    reference_use: "candidate_scope",
    sha256: H("3"),
    bytes: 100,
    version: "v1",
    source_review_sha256: H("1"),
    independent_review_sha256: H("2"),
  };
  const tail: NativeObject = {
    reference_context: { academic_year: 2027, exam_id: "exam" },
    reference_bindings: [{ offering_id: "offering" }],
  };
  const receipt: NativeObject = {
    format: "jungsi.reference-consumer-scope/v1",
    version: "v1",
    status: "verified_reference",
    scope: "same_exam_mathematical_reference",
    selection_sha256: H("a"),
    usage_policy_sha256: H("d"),
    academic_year: 2027,
    exam_id: "exam",
    score_basis: "standard",
    catalog_version: "cat",
    offering_ids: ["offering"],
    max_rows: 4,
    max_evidence_bytes: 1024,
    max_runtime_milliseconds: 1000,
    source_review_sha256: H("1"),
    independent_review_sha256: H("2"),
  };
  const state = { head: H("a"), block: false, settled: false };
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const provider = {
    async referenceSelection(s: AbortSignal) {
      if (state.block) {
        return await new Promise<never>((_, reject) => {
          markStarted();
          const stop = () =>
            setTimeout(() => {
              state.settled = true;
              reject(Error("cancelled"));
            }, 20);
          s.addEventListener("abort", stop, { once: true });
          if (s.aborted) stop();
        });
      }
      return {
        registrySha256: H("b"),
        selectionSha256: state.head,
        approvalReferenceSha256: H("c"),
        tails: [{ key: "tail", entry: tail }],
        compatibilities: [{ key: "scope", entry }],
      };
    },
    async loadReferenceCompatibility(_key: string, _s: AbortSignal) {
      return { entry, payload: receipt };
    },
  };
  const request = {
    subjectId: "owner",
    reportId: "report",
    reportRevision: 1,
    profileId: "profile",
    academicYear: 2027,
    examId: "exam",
    scoreBasis: "standard",
    catalogVersion: "cat",
  };
  return {
    provider,
    entry,
    tail,
    receipt,
    state,
    request,
    started,
    guard: async (s: AbortSignal) => {
      if (s.aborted) throw Error("aborted");
    },
  };
}
async function denied(f: () => Promise<unknown>) {
  let ok = false;
  try {
    await f();
  } catch {
    ok = true;
  }
  assert(ok);
}
Deno.test("candidate scope returns only same-exam selected IDs under existing budget", async () => {
  const f = fixture(),
    s = new AbortController().signal,
    scope = await PublishedReferenceCandidateScope.open(f.provider, f.guard, limits, s);
  assert(scope !== null);
  await scope.assertCurrent(f.request, s);
  equal(await scope.offeringIds(f.request, s, 1024), ["offering"]);
  equal(scope.sourceSha256, H("b"));
  equal(scope.selectionSha256, H("a"));
  equal(scope.budgetPolicySha256, H("d"));
});
Deno.test("candidate scope refuses other exam, current head, offering or budget", async () => {
  for (const kind of ["exam", "head", "missing", "duplicate", "budget", "bytes"]) {
    const f = fixture(), s = new AbortController().signal;
    if (kind === "missing") f.receipt.offering_ids = ["other"];
    if (kind === "duplicate") {
      (f.tail.reference_bindings as NativeObject[]).push({ offering_id: "offering" });
    }
    if (kind === "budget") f.receipt.max_rows = 9;
    if (kind === "bytes") f.receipt.max_evidence_bytes = 4;
    if (["missing", "duplicate", "budget", "bytes"].includes(kind)) {
      await denied(() => PublishedReferenceCandidateScope.open(f.provider, f.guard, limits, s));
      continue;
    }
    const scope = await PublishedReferenceCandidateScope.open(f.provider, f.guard, limits, s);
    assert(scope !== null);
    if (kind === "head") f.state.head = H("f");
    else f.request.examId = "other";
    await denied(() => scope.assertCurrent(f.request, s));
  }
});
Deno.test("candidate cancellation waits for started head read to acknowledge abort", async () => {
  const f = fixture(),
    a = new AbortController(),
    scope = await PublishedReferenceCandidateScope.open(f.provider, f.guard, limits, a.signal);
  assert(scope !== null);
  f.state.block = true;
  const work = scope.assertCurrent(f.request, a.signal).catch(() => {});
  await f.started;
  a.abort();
  await scope.cancelAndWait();
  await work;
  assert(f.state.settled);
});
