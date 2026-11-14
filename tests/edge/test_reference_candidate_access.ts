// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal } from "./fixture.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type {
  PlatformRepositoryPort,
  StoredReport,
} from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
import { CatalogService } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import {
  acquireReferenceCandidateScope,
  type ReferenceCandidateRequest,
} from "../../supabase/functions/_shared/jungsi/application/reference_candidate_scope.ts";
import { referenceCandidateAccess } from "../../supabase/functions/_shared/jungsi/application/reference_candidate_access.ts";
const NOW = 1700000000000000n;
function fixture() {
  const request = {
    operation: "candidates.build",
    session: {
      user: { subjectId: "synthetic-owner", expiresAtUtc: NOW + 9000000000n },
      evaluatedAtUtc: NOW,
      tier: "paid",
      paidUntilUtc: NOW + 9000000000n,
    },
    params: { report_id: "synthetic-report" },
    query: {},
    body: {},
    requestKey: null,
    management: null,
  } as unknown as ApiExecution;
  const scope: ReferenceCandidateRequest = {
    subjectId: "synthetic-owner",
    reportId: "synthetic-report",
    reportRevision: 2,
    profileId: "synthetic-profile",
    academicYear: 2027,
    examId: "synthetic-exam",
    scoreBasis: "synthetic-basis",
    catalogVersion: "synthetic-catalog",
  };
  const record: StoredReport = {
    owner_id: scope.subjectId,
    report_id: scope.reportId,
    profile_id: scope.profileId,
    revision: scope.reportRevision,
    updated_at: "synthetic",
    body: {
      overall: {
        exam: { academic_year: scope.academicYear, exam_id: scope.examId },
        score_basis: scope.scoreBasis,
      },
    },
  };
  const state = {
    record,
    confirmed: true,
    releaseVersion: scope.catalogVersion,
    approved: true,
    current: true,
    active: true,
    reads: 0,
  };
  const repository: Pick<PlatformRepositoryPort, "getReport" | "lookupAccess"> = {
    async lookupAccess() {
      return { ownerId: state.record.owner_id, confirmed: state.confirmed };
    },
    async getReport() {
      return state.record;
    },
  };
  const clock = { nowUtc: () => NOW };
  const catalog = new CatalogService({
    async getCatalog() {
      return {
        version: state.releaseVersion,
        status: state.approved ? "approved" : "draft",
        asOfUtc: NOW,
        offerings: [],
        history: [],
      };
    },
  }, clock);
  const ctrl = new AbortController(), admission = {}, boundary = { signal: ctrl.signal, admission };
  const source = {
    sourceSha256: "a".repeat(64),
    selectionSha256: "b".repeat(64),
    budgetPolicySha256: "c".repeat(64),
    consumerReceiptSha256: "d".repeat(64),
    maximumRows: 3,
    maximumEvidenceBytes: 1024,
    maximumRuntimeMilliseconds: 10000,
    async assertCurrent() {
      if (!state.current) throw new Error("revoked");
    },
    async offeringIds() {
      state.reads++;
      return ["synthetic-offering"];
    },
    async cancelAndWait() {},
  };
  const port = referenceCandidateAccess({
    request,
    boundary,
    repository,
    catalog,
    clock,
    source,
    async assertActive() {
      if (!state.active) throw new Error("inactive");
    },
  });
  return { request, scope, state, boundary, ctrl, port };
}
async function denied(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("expected denial");
}
Deno.test("reference scope reuses owned confirmed report, paid session and current catalog", async () => {
  const x = fixture(), grant = await acquireReferenceCandidateScope(x.scope, x.port, x.boundary);
  assert(grant);
  equal(grant.offeringIds, ["synthetic-offering"]);
  equal(x.state.reads, 1);
  await grant.assertCurrent();
});
Deno.test("reference scope rejects unverified read and different budget admission", async () => {
  const x = fixture();
  await denied(() => x.port.readOfferingIds(x.scope, x.ctrl.signal, 1024));
  await denied(() =>
    acquireReferenceCandidateScope(x.scope, x.port, { signal: x.ctrl.signal, admission: {} })
  );
  equal(x.state.reads, 0);
});
Deno.test("reference scope rejects wrong owner, revision, profile, exam, year, basis and catalog", async () => {
  const changes: Partial<ReferenceCandidateRequest>[] = [
    { subjectId: "other" },
    { reportId: "other" },
    { reportRevision: 3 },
    { profileId: "other" },
    { examId: "other" },
    { academicYear: 2026 },
    { scoreBasis: "other" },
    { catalogVersion: "other" },
  ];
  for (const change of changes) {
    const x = fixture();
    await denied(() =>
      acquireReferenceCandidateScope({ ...x.scope, ...change }, x.port, x.boundary)
    );
    equal(x.state.reads, 0);
  }
});
Deno.test("reference scope denies unconfirmed report, unapproved catalog, lost lease or revoked release", async () => {
  for (const change of ["confirmed", "approved", "active", "current"] as const) {
    const x = fixture();
    x.state[change] = false;
    await denied(() => acquireReferenceCandidateScope(x.scope, x.port, x.boundary));
    equal(x.state.reads, 0);
  }
});
Deno.test("reference scope rechecks report revision and authority after selection", async () => {
  const x = fixture(), grant = await acquireReferenceCandidateScope(x.scope, x.port, x.boundary);
  assert(grant);
  x.state.record = { ...x.state.record, revision: 3 };
  await denied(() => grant.assertCurrent());
});
Deno.test("reference scope rejects free session and expired paid rights", async () => {
  for (const mode of ["free", "expired"] as const) {
    const x = fixture(),
      session = x.request.session as { tier: string; paidUntilUtc: bigint | null };
    if (mode === "free") {
      session.tier = "standard";
      session.paidUntilUtc = null;
    } else session.paidUntilUtc = NOW;
    await denied(() => acquireReferenceCandidateScope(x.scope, x.port, x.boundary));
  }
});
