// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal } from "./fixture.ts";
import {
  acquireReferenceCandidateScope,
  type ReferenceCandidateScopePort,
} from "../../supabase/functions/_shared/jungsi/application/reference_candidate_scope.ts";
const req = {
  subjectId: "SYNTHETIC-subject",
  reportId: "SYNTHETIC-report",
  reportRevision: 1,
  profileId: "SYNTHETIC-profile",
  academicYear: 2027,
  examId: "SYNTHETIC-exam",
  scoreBasis: "mock_exam",
  catalogVersion: "SYNTHETIC-catalog",
};
function gate(ids: string[] = ["SYNTHETIC-o"]): ReferenceCandidateScopePort {
  return {
    sourceSha256: "a".repeat(64),
    selectionSha256: "b".repeat(64),
    budgetPolicySha256: "c".repeat(64),
    consumerReceiptSha256: "d".repeat(64),
    maximumRows: 2,
    maximumEvidenceBytes: 4096,
    maximumRuntimeMilliseconds: 10000,
    async verifyAdmission(actual, admission, _requirements, signal) {
      assert(actual.subjectId === req.subjectId);
      assert(admission !== undefined && !signal.aborted);
    },
    async readOfferingIds() {
      return ids;
    },
    async cancelAndWait() {},
  };
}
async function denied(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("expected denial");
}
Deno.test("reference candidate scope is absent unless a trusted issuer is injected", async () => {
  equal(await acquireReferenceCandidateScope(req, null), null);
});
Deno.test("reference candidate scope requires an existing live admission and signal", async () => {
  await denied(() => acquireReferenceCandidateScope(req, gate()));
  const ctrl = new AbortController();
  ctrl.abort();
  await denied(() =>
    acquireReferenceCandidateScope(req, gate(), { signal: ctrl.signal, admission: {} })
  );
});
Deno.test("reference candidate scope rejects duplicates and scope beyond the budgeted cap", async () => {
  const b = { signal: new AbortController().signal, admission: {} };
  await denied(() => acquireReferenceCandidateScope(req, gate(["SYNTHETIC-o", "SYNTHETIC-o"]), b));
  await denied(() =>
    acquireReferenceCandidateScope(req, gate(["SYNTHETIC-a", "SYNTHETIC-b", "SYNTHETIC-c"]), b)
  );
});
Deno.test("reference candidate scope freezes independently selected IDs", async () => {
  const ids = ["SYNTHETIC-o"], b = { signal: new AbortController().signal, admission: {} };
  const g = await acquireReferenceCandidateScope(req, gate(ids), b);
  assert(g);
  ids.push("SYNTHETIC-new");
  equal(g.offeringIds, ["SYNTHETIC-o"]);
});
Deno.test("reference candidate scope fails if the verified current selection changes", async () => {
  const b = { signal: new AbortController().signal, admission: {} };
  const g = {
    ...gate(),
    async verifyAdmission() {
      throw new Error("revoked");
    },
  };
  await denied(() => acquireReferenceCandidateScope(req, g, b));
});

Deno.test("reference candidate scope waits for physical cancellation after request abort", async () => {
  const ctrl = new AbortController();
  let cancelled = false, started = false, release!: () => void;
  const g = {
    ...gate(),
    async readOfferingIds() {
      started = true;
      const pending = new Promise<string[]>((resolve) => {
        release = () => resolve([]);
      });
      ctrl.abort();
      return await pending;
    },
    async cancelAndWait() {
      cancelled = true;
      release();
    },
  };
  await denied(() =>
    acquireReferenceCandidateScope(req, g, { signal: ctrl.signal, admission: {} })
  );
  assert(started);
  assert(cancelled);
});
Deno.test("reference candidate scope rejects invalid authority pins", async () => {
  const g = { ...gate(), sourceSha256: "invalid" };
  await denied(() =>
    acquireReferenceCandidateScope(req, g, { signal: new AbortController().signal, admission: {} })
  );
});

Deno.test("reference candidate calculation waits for provider cancellation when aborted", async () => {
  const ctrl = new AbortController();
  let cancelled = false, release!: () => void;
  const scope = await acquireReferenceCandidateScope(req, {
    ...gate(),
    async cancelAndWait() {
      cancelled = true;
      release();
    },
  }, { signal: ctrl.signal, admission: {} });
  assert(scope);
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  ctrl.abort();
  await denied(() => scope.run(work));
  assert(cancelled);
});

Deno.test("reference candidate cannot settle while cancelled calculation remains in flight", async () => {
  const ctrl = new AbortController();
  let release!: () => void, settled = false, cancelled = false;
  const scope = await acquireReferenceCandidateScope(req, {
    ...gate(),
    async cancelAndWait() {
      cancelled = true;
    },
  }, { signal: ctrl.signal, admission: {} });
  assert(scope);
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = scope.run(work).then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  ctrl.abort();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert(cancelled);
  assert(!settled);
  release();
  await result;
  assert(settled);
});
