// Preserve the synchronous execution order of async test doubles.
// deno-lint-ignore-file require-await
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import {
  captureUnchangedLegacyAssessments,
  captureUnchangedLegacyCandidates,
} from "../../supabase/functions/_shared/jungsi/application/legacy_reference_transition.ts";
import { resolveReferenceTransition } from "../../supabase/functions/_shared/jungsi/infrastructure/reference_projection_transition.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { StoredReport } from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
function assert(v: unknown): asserts v {
  if (!v) throw Error("assertion failed");
}
Deno.test("mixed evidence preserves unchanged legacy after store and rejects proof removal", async () => {
  const repo = new SyntheticNativeRepository(),
    owner = "owner",
    rid = "report",
    pid = "profile",
    now = "2026-11-10T00:00:00Z";
  repo.profiles.set(pid, {
    owner_id: owner,
    profile_id: pid,
    scores: {},
    confirmed: true,
    created_at: now,
  });
  const oldAssessment = { offering_id: "old", reference_percentile: { value: 12 } };
  const original: StoredReport = {
    owner_id: owner,
    report_id: rid,
    profile_id: pid,
    revision: 1,
    updated_at: now,
    body: { analyses: { old: oldAssessment } },
  };
  repo.reports.set(rid, original);
  const body: NativeObject = {
    analyses: {
      old: oldAssessment,
      new: { offering_id: "new", reference_percentile: { value: 34 } },
    },
  };
  const legacy = await captureUnchangedLegacyAssessments(original, body);
  body._reference_evidence = {
    format: "jungsi.reference-result-provenance/v1",
    owner_id: owner,
    report_id: rid,
    profile_id: pid,
    assessments: { new: { synthetic: true } },
    legacy_assessments: legacy,
  };
  const write = (b: NativeObject, key: string) =>
    repo.writeReport({
      owner,
      reportId: rid,
      profileId: pid,
      body: b,
      expected: key === "first" ? 1 : 2,
      nowUtc: utcInstant(now),
      operation: "university.analyze",
      key,
      digest: "synthetic",
    });
  await write(body, "first");
  const saved = await repo.getReport(owner, rid);
  assert(saved && saved.revision === 2);
  assert(await repo.getReportRevision(owner, rid, 1));
  assert(await repo.getReportRevision(owner, rid, 2));
  let denied = false;
  try {
    await write({ analyses: body.analyses }, "remove-proof");
  } catch {
    denied = true;
  }
  assert(denied);
  const altered = structuredClone(body);
  delete (altered._reference_evidence as NativeObject).assessments;
  denied = false;
  try {
    await write(altered, "break-proof");
  } catch {
    denied = true;
  }
  assert(denied);
  const stripped = structuredClone(body);
  delete ((stripped._reference_evidence as NativeObject).assessments as NativeObject).new;
  denied = false;
  try {
    await write(stripped, "strip-new");
  } catch {
    denied = true;
  }
  assert(denied);
  const forged = structuredClone(body);
  ((forged._reference_evidence as NativeObject).legacy_assessments as NativeObject).new =
    structuredClone(legacy.old);
  denied = false;
  try {
    await write(forged, "forge-legacy");
  } catch {
    denied = true;
  }
  assert(denied);
  const signal = new AbortController().signal;
  const make = (id: string) => ({
    async assertCurrent() {},
    assertSettled() {},
    authorizes(v: { value: unknown }) {
      return typeof v.value === "object" && v.value !== null &&
        (v.value as { offering_id?: string }).offering_id === id;
    },
  });
  const resolve = async (readOwnedCurrent: () => Promise<StoredReport | null>) =>
    resolveReferenceTransition({
      signal,
      readOwnedCurrent,
      readRevision: (r, n, s) => repo.getReportRevision(r.owner_id, r.report_id, n, s),
      resolveLegacy: async () => make("old"),
      resolveProven: async () => make("new"),
      captureReceipt: async () => ({ assertCurrent() {} }),
      assertSettledRequest() {},
    });
  const authority = await resolve(() => repo.getReport(owner, rid));
  assert(authority);
  await authority.assertCurrent(signal);
  authority.assertSettled!(signal);
  const root = saved.body, analyses = root.analyses as NativeObject;
  assert(
    authority.authorizes({
      operation: "report.read",
      tier: "paid",
      root,
      kind: "assessment",
      value: analyses.old as NativeObject,
    }),
  );
  assert(
    authority.authorizes({
      operation: "report.read",
      tier: "paid",
      root,
      kind: "assessment",
      value: analyses.new as NativeObject,
    }),
  );
  assert(
    !authority.authorizes({
      operation: "report.read",
      tier: "paid",
      root,
      kind: "assessment",
      value: { offering_id: "old", reference_percentile: { value: 13 } },
    }),
  );
  const tampered = structuredClone(saved);
  delete tampered.body._reference_evidence;
  assert(await resolve(async () => tampered) === null);
  assert(await resolve(() => repo.getReport("other", rid)) === null);
});

Deno.test("mixed saved report checks real legacy and immutable-new authorities", async () => {
  const { referenceProjectionAuthorityPort } = await import(
    "../../supabase/functions/_shared/jungsi/infrastructure/reference_runtime_authority.ts"
  );
  const { ImmutableReferenceReportVerifier } = await import(
    "../../supabase/functions/_shared/jungsi/infrastructure/reference_report_evidence_verifier.ts"
  );
  const { resolveReferenceReportProjection } = await import(
    "../../supabase/functions/_shared/jungsi/application/reference_report_projection.ts"
  );
  const { nativeJsonSha256, nativeJsonText } = await import(
    "../../supabase/functions/_shared/jungsi/domain/json_value.ts"
  );
  const repo = new SyntheticNativeRepository(),
    owner = "owner",
    rid = "report",
    pid = "profile",
    nowText = "2026-11-10T00:00:00Z",
    now = utcInstant(nowText);
  const ref = {
    status: "reference_estimated",
    estimated_upper_cumulative_percent_all_examinees: "10.5",
    metric: "estimated_upper_cumulative_percent_all_examinees",
    calculation_review_scope: "same_exam_mathematical_reference",
    production_allowed: false,
    actual_admission_full_total_approved: false,
  };
  const oldAssessment = { offering_id: "old", status: "pending", reference_percentile: ref },
    newAssessment = { offering_id: "new", status: "pending", reference_percentile: ref };
  repo.profiles.set(pid, {
    owner_id: owner,
    profile_id: pid,
    scores: {},
    confirmed: true,
    created_at: nowText,
  });
  const original: StoredReport = {
    owner_id: owner,
    report_id: rid,
    profile_id: pid,
    revision: 1,
    updated_at: nowText,
    body: {
      overall: {},
      analyses: { old: oldAssessment },
      candidates: {
        reference_university_groups: [{
          university_id: "u",
          offerings: [{ offering: { offering_id: "old" }, reference_percentile: ref }],
        }],
      },
      shortlist: {},
      analysis_status: { status: "pending" },
    },
  };
  repo.reports.set(rid, original);
  const body: NativeObject = {
    ...structuredClone(original.body),
    analyses: { old: oldAssessment, new: newAssessment },
  };
  const provenance = { selection_sha256: "a".repeat(64) },
    marker = await captureUnchangedLegacyAssessments(original, body),
    candidateMarker = await captureUnchangedLegacyCandidates(original, body);
  assert(candidateMarker);
  ((body.candidates as NativeObject).reference_university_groups as NativeObject[]).push({
    university_id: "u2",
    offerings: [{ offering: { offering_id: "new" }, reference_percentile: structuredClone(ref) }],
  });
  body._reference_evidence = {
    format: "jungsi.reference-result-provenance/v1",
    owner_id: owner,
    report_id: rid,
    profile_id: pid,
    assessments: {
      new: { issued_revision: 2, value_sha256: await nativeJsonSha256(ref), provenance },
    },
    legacy_assessments: marker,
    legacy_candidates: candidateMarker,
  };
  await repo.writeReport({
    owner,
    reportId: rid,
    profileId: pid,
    body,
    expected: 1,
    nowUtc: now,
    operation: "university.analyze",
    key: "mixed",
    digest: "synthetic",
  });
  const record = await repo.getReport(owner, rid);
  assert(record);
  const visible: NativeObject = {
    format: "jungsi.persisted-report/v1",
    report_id: rid,
    report_version: 2,
    profile_id: pid,
    analyses: structuredClone(record.body.analyses),
    candidates: structuredClone(record.body.candidates),
  };
  const request = {
    operation: "report.read",
    session: {
      user: { subjectId: owner, expiresAtUtc: now + 9000000000n },
      evaluatedAtUtc: now,
      tier: "paid",
      paidUntilUtc: now + 9000000000n,
    },
    params: { report_id: rid },
    query: {},
    body: {},
    requestKey: null,
    management: null,
  } as never;
  let selection = true;
  const context = {
    async data() {
      return {
        async referenceTailPins() {
          return true;
        },
        async assertCurrentSelection() {
          if (!selection) throw Error("revoked");
        },
        hasReferenceTail(id: string) {
          return id === "old" || id === "new";
        },
      };
    },
    async assertCurrent() {
      if (!selection) throw Error("revoked");
    },
  } as never;
  const issuer = {
    async select(id: string) {
      return id === "new"
        ? {
          context: {
            academic_year: 2026,
            exam_id: "e",
            exam_type: "t",
            source_pack_version: "v",
            rule_version: "r",
            score_scale_id: "s",
          },
        } as never
        : null;
    },
    async verifiedProvenance() {
      return provenance;
    },
  };
  const signal = new AbortController().signal;
  const verifier = new ImmutableReferenceReportVerifier(
    10,
    (o, i, n, s) => repo.getReportRevision(o, i, n, s),
    issuer,
    async (r) => {
      const current = await repo.getReport(owner, rid);
      assert(
        current && current.revision === r.revision &&
          nativeJsonText(current.body, true) === nativeJsonText(r.body, true),
      );
    },
  );
  const workflow = {
    async snapshotScope() {
      return { overall: false, analysisIds: [], candidates: false, legacyVerified: false };
    },
  };
  let revisionReads = 0;
  const authority = await resolveReferenceTransition({
    signal,
    readOwnedCurrent: () => repo.getReport(owner, rid),
    readRevision: (r, n, s) => {
      revisionReads++;
      return repo.getReportRevision(r.owner_id, r.report_id, n, s);
    },
    resolveLegacy: () =>
      referenceProjectionAuthorityPort(context).resolve(request, visible, {}, signal),
    resolveProven: () =>
      resolveReferenceReportProjection({
        request,
        result: visible,
        signal,
        repository: repo,
        workflow,
        verifier,
        clock: { nowUtc: () => now },
        async assertActive() {},
        assertReceipt() {},
      }),
    captureReceipt: async () => ({
      assertCurrent() {
        if (!selection) throw Error("revoked");
      },
    }),
    assertSettledRequest() {},
  });
  assert(authority);
  assert(revisionReads === 2);
  await authority.assertCurrent(signal);
  authority.assertSettled!(signal);
  const analyses = visible.analyses as NativeObject;
  for (const id of ["old", "new"]) {
    assert(
      authority.authorizes({
        operation: "report.read",
        tier: "paid",
        root: visible,
        kind: "assessment",
        value: analyses[id] as NativeObject,
      }),
    );
  }
  assert(
    authority.authorizes({
      operation: "report.read",
      tier: "paid",
      root: visible,
      kind: "candidates",
      value: visible.candidates as NativeObject,
    }),
  );
  assert(
    !authority.authorizes({
      operation: "report.read",
      tier: "paid",
      root: visible,
      kind: "candidates",
      value: { reference_university_groups: [] },
    }),
  );
  const groups = (visible.candidates as NativeObject).reference_university_groups as NativeObject[];
  const newRow = (groups[1].offerings as NativeObject[])[0],
    newRef = newRow.reference_percentile as NativeObject;
  newRef.estimated_upper_cumulative_percent_all_examinees = "99";
  assert(
    !authority.authorizes({
      operation: "report.read",
      tier: "paid",
      root: visible,
      kind: "candidates",
      value: visible.candidates as NativeObject,
    }),
  );
  newRef.estimated_upper_cumulative_percent_all_examinees = "10.5";
  const withoutProof = await resolveReferenceTransition({
    signal,
    readOwnedCurrent: () => repo.getReport(owner, rid),
    readRevision: (r, n, s) => repo.getReportRevision(r.owner_id, r.report_id, n, s),
    resolveLegacy: () =>
      referenceProjectionAuthorityPort(context).resolve(request, visible, {}, signal),
    resolveProven: async () => null,
    captureReceipt: async () => ({ assertCurrent() {} }),
    assertSettledRequest() {},
  });
  assert(withoutProof);
  assert(
    !withoutProof.authorizes({
      operation: "report.read",
      tier: "paid",
      root: visible,
      kind: "candidates",
      value: visible.candidates as NativeObject,
    }),
  );
  selection = false;
  let revoked = false;
  try {
    await authority.assertCurrent(signal);
  } catch {
    revoked = true;
  }
  assert(revoked);
});
