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
      await Promise.resolve();
      assert(actual.subjectId === req.subjectId);
      assert(admission !== undefined && !signal.aborted);
    },
    async readOfferingIds() {
      await Promise.resolve();
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
    acquireReferenceCandidateScope(req, gate(), {
      signal: ctrl.signal,
      admission: {},
    })
  );
});
Deno.test("reference candidate scope rejects duplicates and scope beyond the budgeted cap", async () => {
  const b = { signal: new AbortController().signal, admission: {} };
  await denied(() => acquireReferenceCandidateScope(req, gate(["SYNTHETIC-o", "SYNTHETIC-o"]), b));
  await denied(() =>
    acquireReferenceCandidateScope(
      req,
      gate(["SYNTHETIC-a", "SYNTHETIC-b", "SYNTHETIC-c"]),
      b,
    )
  );
});
Deno.test("reference candidate scope freezes independently selected IDs", async () => {
  const ids = ["SYNTHETIC-o"],
    b = { signal: new AbortController().signal, admission: {} };
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
      await Promise.resolve();
      throw new Error("revoked");
    },
  };
  await denied(() => acquireReferenceCandidateScope(req, g, b));
});

Deno.test("reference candidate scope waits for physical cancellation after request abort", async () => {
  const ctrl = new AbortController();
  let cancelled = false, started = false;
  let release!: (ids: string[]) => void;
  const pending = new Promise<string[]>((resolve) => {
    release = resolve;
  });
  const g = {
    ...gate(),
    async readOfferingIds() {
      started = true;
      ctrl.abort();
      return await pending;
    },
    async cancelAndWait() {
      await Promise.resolve();
      cancelled = true;
      release([]);
    },
  };
  await denied(() =>
    acquireReferenceCandidateScope(req, g, {
      signal: ctrl.signal,
      admission: {},
    })
  );
  assert(started);
  assert(cancelled);
});
Deno.test("reference candidate scope rejects invalid authority pins", async () => {
  const g = { ...gate(), sourceSha256: "invalid" };
  await denied(() =>
    acquireReferenceCandidateScope(req, g, {
      signal: new AbortController().signal,
      admission: {},
    })
  );
});

Deno.test("reference candidate calculation waits for provider cancellation when aborted", async () => {
  const ctrl = new AbortController();
  let cancelled = false;
  let release!: () => void;
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scope = await acquireReferenceCandidateScope(req, {
    ...gate(),
    async cancelAndWait() {
      await Promise.resolve();
      cancelled = true;
      release();
    },
  }, { signal: ctrl.signal, admission: {} });
  assert(scope);
  ctrl.abort();
  await denied(() => scope.run(work));
  assert(cancelled);
});

Deno.test("scope abort waits until in-flight work actually settles", async () => {
  const ctrl = new AbortController();
  let release!: () => void;
  let workSettled = false;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scope = await acquireReferenceCandidateScope(req, gate(), {
    signal: ctrl.signal,
    admission: {},
  });
  assert(scope);
  const work = cleanup.then(() => {
    workSettled = true;
  });
  let returned = false;
  const result = scope.run(work).then(() => {
    returned = true;
  }, () => {
    returned = true;
  });
  ctrl.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(!returned && !workSettled);
  release();
  await result;
  assert(returned && workSettled);
});
