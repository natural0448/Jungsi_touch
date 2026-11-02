/** Synthetic schema evolution only: never updates the canonical registry or emits an API response. */
import {
  publicJsonText,
  PublicResponseProjection,
  type WildcardProjectionAuthority,
} from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { canonicalApiPolicies } from "./public_api_contract_fixture.ts";
import { materializeWildcardReview } from "../../supabase/functions/_shared/jungsi/application/wildcard_runtime_gate.ts";
import proposedRegistry from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
// The generated fixture covers 25 operations. These five public route fields were
// independently checked against staged route SHA-256 d1d2b38daf066d957d608eeb21f11ddcc9bf7588fcc254e9d155f6dad8f6a592.
const fixtureRoutes = canonicalApiPolicies();
if (fixtureRoutes.length !== 25) {
  throw new Error("Generated route fixture changed; reconcile its version and full policy scope");
}
const proposedRoutes = {
  operations: [...fixtureRoutes, ...[
    {
      "id": "history.snapshot.head",
      "contract_ref": "backend_platform_contract.dto_schemas.history_snapshot_head",
    },
    {
      "id": "history.snapshot.read",
      "contract_ref": "backend_platform_contract.dto_schemas.history_snapshot_body",
    },
    {
      "id": "report.list-own",
      "contract_ref": "backend_platform_contract.dto_schemas.own_report_list",
    },
    {
      "id": "member-shortlist.read",
      "contract_ref": "backend_platform_contract.dto_schemas.member_shortlist",
    },
    {
      "id": "member-shortlist.update",
      "contract_ref": "backend_platform_contract.dto_schemas.member_shortlist",
    },
  ]],
};
import { ProfessionalProjection } from "../../supabase/functions/_shared/jungsi/application/professional_projection.ts";
import { PROFESSIONAL_CONTRACT } from "../../supabase/functions/_shared/jungsi/application/professional_contract.generated.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  buildWildcardCandidateReview,
  type WildcardBatchRecord,
  type WildcardEvidenceBatchPort,
  type WildcardReviewContext,
} from "../../supabase/functions/_shared/jungsi/application/wildcard_candidate_review.ts";

const H = (x: string) => x.repeat(64);
const ctx: WildcardReviewContext = {
  audience: "personal",
  operationContextSha256: H("1"),
  selectionPolicySha256: H("2"),
  academicYear: 2027,
  examId: "SYNTHETIC-exam",
  scoreBasis: "actual_exam",
  maxRows: 5,
  maxSnapshotBytes: 100000,
};
function fixture(single = false) {
  const defs = single ? [{ id: "SYNTHETIC-a", group: "nursing", category: "room" }] : [
    { id: "SYNTHETIC-a", group: "nursing", category: "room" },
    { id: "SYNTHETIC-b", group: "health", category: "core" },
    { id: "SYNTHETIC-c", group: "education", category: "core" },
  ];
  const rows: NativeObject[] = defs.map((d) => ({
    offering_id: d.id,
    academic_year: 2027,
    university_id: "SYNTHETIC-u-" + d.id,
    university_name: "SYNTHETIC-school",
    wildcard_group: d.group,
  }));
  const analyses: NativeObject = {};
  const records: WildcardBatchRecord[] = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    analyses[d.id] = {
      offering_id: d.id,
      status: "ready",
      category: d.category,
      reason_code: null,
      converted_score: null,
      converted_percentile: null,
      advantage: null,
      years: [],
      versions: {},
      eligibility_status: "eligible",
      sensitive_diagnostic: "SYNTHETIC-PRIVATE-NEVER-PUBLIC",
    };
    records.push({
      offeringId: d.id,
      groupClassification: "approved",
      group: d.group,
      stability: {
        marginPp: exact(9 - i),
        academicYear: 2027,
        examId: "SYNTHETIC-exam",
        scoreBasis: "actual_exam",
        sourceModelVersion: "SYNTHETIC-private-model",
        referencePopulationSha256: H("a"),
        effectivePopulationWeightsSha256: i === 2 ? H("c") : H("b"),
        denominatorPolicyId: "SYNTHETIC-private-denominator",
        populationUnit: "weighted-students",
        metricDefinitionId: "SYNTHETIC-private-metric",
        tiePolicy: "include_equal",
        forecastApprovalId: "SYNTHETIC-private-approval",
      },
    });
  }
  const port: WildcardEvidenceBatchPort = {
    read: (binding) => Promise.resolve({ binding, records }),
  };
  return { rows, analyses, records, port };
}
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function row(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
type Schema = Record<string, unknown>;
function patchedRegistry(): Schema {
  return structuredClone(proposedRegistry) as Schema;
}
function report(candidates: unknown) {
  return {
    format: "jungsi.persisted-report/v1",
    report_id: "SYNTHETIC-report",
    report_version: 1,
    profile_id: "SYNTHETIC-profile",
    updated_at: "2026-01-01T00:00:00Z",
    overall: {
      format: "jungsi.overall-analysis/v1",
      exam: { exam_id: "SYNTHETIC-exam", academic_year: 2027, exam_type: "mock" },
      pack_version: "SYNTHETIC-pack",
      score_basis: "actual_exam",
      total_standard_score: 0,
      subjects: [],
      absolute_grades: {},
      overall: {
        status: "pending",
        reason_code: null,
        top_percent: null,
        inclusive_top_percent: null,
        exclusive_top_percent: null,
        tie_share_percent: null,
        tie_interval_percent: null,
        tie_policy: null,
        population_id: null,
        model_version: null,
        data_kind: null,
      },
    },
    analyses: {},
    candidates,
    shortlist: {},
    analysis_status: { status: "ready", reason_code: null },
  };
}
async function proposed(single = false, absent = false) {
  const f = fixture(single);
  if (single) f.records[0] = { ...f.records[0], stability: null };
  const out = await buildWildcardCandidateReview(
    f.rows,
    f.analyses,
    "SYNTHETIC-catalog",
    ctx,
    absent ? null : f.port,
    new AbortController().signal,
  );
  return {
    current: out.current_candidates,
    merged: materializeWildcardReview(out),
  };
}
/** Synthetic receipt only: production has no such verifier or writer evidence. */
function syntheticAuthority(
  expectedOperation: string,
  expectedTier: "standard" | "paid",
  candidate: unknown,
  expectedRevision = 1,
  allowedOwner = "SYNTHETIC-owner",
): WildcardProjectionAuthority {
  const c = row(candidate), v = row(c._wildcard_selection_view);
  const signature = (view: Record<string, unknown>) =>
    JSON.stringify({
      selection: view.wildcard_selection,
      ids: (view.wildcards as unknown[]).map((item) => row(row(item).offering).offering_id),
    });
  const expected = signature(v);
  return {
    assertCurrent: () => Promise.resolve(),
    authorizes: ({ operation, tier, root, privateView }) => {
      if (
        operation !== expectedOperation || tier !== expectedTier ||
        allowedOwner !== "SYNTHETIC-owner"
      ) return false;
      const outer = row(root);
      if (operation.startsWith("pro.")) {
        if (
          outer.org_id !== "SYNTHETIC-org" || outer.student_id !== "SYNTHETIC-student"
        ) return false;
        if (operation === "pro.report.read") {
          const item = row(row(outer.data).published_result);
          if (
            item.report_id !== "SYNTHETIC-report" || item.report_version !== expectedRevision
          ) return false;
        } else if (expectedRevision !== 1) return false; // synthetic out-of-band revision evidence
      } else if (
        outer.report_id !== "SYNTHETIC-report" || outer.report_version !== expectedRevision
      ) return false;
      return signature(row(privateView)) === expected;
    },
  };
}
function assertNoPrivate(value: unknown) {
  const s = JSON.stringify(value);
  for (
    const forbidden of [
      "SYNTHETIC-PRIVATE-NEVER-PUBLIC",
      "SYNTHETIC-private-model",
      "SYNTHETIC-private-denominator",
      "SYNTHETIC-private-metric",
      "SYNTHETIC-private-approval",
      H("a"),
      H("b"),
      H("c"),
    ]
  ) assert(!s.includes(forbidden), "unapproved internal evidence escaped");
}
Deno.test("member schema preserves partial prefix and strips internal evidence", async () => {
  const f = await proposed();
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const projected = row(
    projector.project(
      "candidates.build",
      "paid",
      report(f.merged),
      syntheticAuthority("candidates.build", "paid", f.merged),
    ),
  );
  const candidates = row(projected.candidates), selection = row(candidates.wildcard_selection);
  assert(
    selection.status === "partial" && selection.reason_code === "wildcard_comparison_unverified",
  );
  assert(Array.isArray(candidates.wildcards) && candidates.wildcards.length === 1);
  assertNoPrivate(projected);
});
Deno.test("professional schema preserves the same prefix and strips internal evidence", async () => {
  const f = await proposed();
  const projector = new ProfessionalProjection(PROFESSIONAL_CONTRACT, patchedRegistry());
  const projected = row(projector.project(
    "pro.candidates",
    {
      orgId: "SYNTHETIC-org",
      studentId: "SYNTHETIC-student",
      data: {
        org_id: "SYNTHETIC-org",
        student_id: "SYNTHETIC-student",
        candidates: f.merged as unknown as NativeObject,
      },
      reasons: [],
    },
    "0".repeat(32),
    syntheticAuthority("pro.candidates", "standard", f.merged),
  ));
  const data = row(projected.data), candidates = row(data.candidates);
  assert(row(candidates.wildcard_selection).status === "partial");
  assert(Array.isArray(candidates.wildcards) && candidates.wildcards.length === 1);
  assertNoPrivate(projected);
  // Only pro.candidates promotes the verified wildcard partial reason.
  assert(Array.isArray(projected.reason_codes));
  assert((projected.reason_codes as unknown[]).includes("wildcard_comparison_unverified"));
});
Deno.test("schema keeps empty pending distinct from a confirmed zero", async () => {
  const f = await proposed(false, true);
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const projected = row(
    projector.project(
      "candidates.build",
      "paid",
      report(f.merged),
      syntheticAuthority("candidates.build", "paid", f.merged),
    ),
  );
  const candidates = row(projected.candidates), selection = row(candidates.wildcard_selection);
  assert(selection.status === "pending");
  assert(Array.isArray(candidates.wildcards) && candidates.wildcards.length === 0);
  assert(!Object.hasOwn(selection, "count"));
});
Deno.test("singleton retains ready membership and exposes pending stability only", async () => {
  const f = await proposed(true);
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const projected = row(
    projector.project(
      "candidates.build",
      "paid",
      report(f.merged),
      syntheticAuthority("candidates.build", "paid", f.merged),
    ),
  );
  const selection = row(row(projected.candidates).wildcard_selection);
  assert(selection.status === "ready");
  const item = row((selection.card_stability as unknown[])[0]);
  assert(item.status === "pending" && item.offering_id === "SYNTHETIC-a");
  assertNoPrivate(projected);
});
Deno.test("old report without field stays absent under optional schema", async () => {
  const f = await proposed();
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const projected = row(projector.project("report.read", "paid", report(f.current)));
  const candidates = row(projected.candidates);
  assert(!Object.hasOwn(candidates, "wildcard_selection"));
});

Deno.test("professional pending with no cards stays pending and carries its approved reason", async () => {
  const f = await proposed(false, true);
  const projector = new ProfessionalProjection(PROFESSIONAL_CONTRACT, patchedRegistry());
  const projected = row(projector.project(
    "pro.candidates",
    {
      orgId: "SYNTHETIC-org",
      studentId: "SYNTHETIC-student",
      data: {
        org_id: "SYNTHETIC-org",
        student_id: "SYNTHETIC-student",
        candidates: f.merged as unknown as NativeObject,
      },
      reasons: [],
    },
    "0".repeat(32),
    syntheticAuthority("pro.candidates", "standard", f.merged),
  ));
  const candidates = row(row(projected.data).candidates);
  const selection = row(candidates.wildcard_selection);
  assert(selection.status === "pending");
  assert(Array.isArray(candidates.wildcards) && candidates.wildcards.length === 0);
  assert(
    Array.isArray(projected.reason_codes) &&
      projected.reason_codes.includes("wildcard_evidence_unavailable"),
  );
  assertNoPrivate(projected);
});

Deno.test("standard saved snapshot retains partial selection and strips internal fields", async () => {
  const f = await proposed();
  const stored = {
    ...report(f.merged),
    read_only_snapshot: {
      analyses: {},
      candidates: f.merged,
      shortlist: {},
      analysis_status: { status: "read_only", reason_code: "saved_snapshot_only" },
    },
  };
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const projected = row(
    projector.project(
      "report.read",
      "standard",
      stored,
      syntheticAuthority("report.read", "standard", f.merged),
    ),
  );
  const candidates = row(row(projected.read_only_snapshot).candidates);
  assert(candidates.status === "ready");
  assert(row(candidates.wildcard_selection).status === "partial");
  assert(Array.isArray(candidates.wildcards) && candidates.wildcards.length === 1);
  assertNoPrivate(projected);
});

Deno.test("old standard saved snapshot stays absent rather than zero or ready", async () => {
  const f = await proposed();
  const stored = {
    ...report(f.current),
    read_only_snapshot: {
      analyses: {},
      candidates: f.current,
      shortlist: {},
      analysis_status: { status: "read_only", reason_code: "saved_snapshot_only" },
    },
  };
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const projected = row(projector.project("report.read", "standard", stored));
  const candidates = row(row(projected.read_only_snapshot).candidates);
  assert(!Object.hasOwn(candidates, "wildcard_selection"));
  assertNoPrivate(projected);
});

Deno.test("wildcard partial reason is not promoted for other professional operations", async () => {
  const f = await proposed();
  const projector = new ProfessionalProjection(PROFESSIONAL_CONTRACT, patchedRegistry());
  const projected = row(projector.project(
    "pro.report.read",
    {
      orgId: "SYNTHETIC-org",
      studentId: "SYNTHETIC-student",
      data: {
        org_id: "SYNTHETIC-org",
        student_id: "SYNTHETIC-student",
        report_id: "SYNTHETIC-report",
        revision_id: 1,
        exam_id: "SYNTHETIC-exam",
        stage: "mock",
        profile_id: "SYNTHETIC-profile",
        published_result: report(f.merged),
        counseling_reasons: [],
        created_at_utc: "2026-01-01T00:00:00Z",
      } as unknown as NativeObject,
      reasons: [],
    },
    "0".repeat(32),
    syntheticAuthority("pro.report.read", "standard", f.merged),
  ));
  assert(Array.isArray(projected.reason_codes));
  assert(!(projected.reason_codes as unknown[]).includes("wildcard_comparison_unverified"));
});

Deno.test("legacy null or untrusted object keeps five old cards and strips selection", async () => {
  const f = await proposed();
  const legacy = {
    ...f.current,
    wildcards: Array.from({ length: 5 }, (_, i) => ({
      ...(f.current.wildcards as NativeObject[])[0],
      offering: {
        ...((f.current.wildcards as NativeObject[])[0].offering as NativeObject),
        offering_id: "SYNTHETIC-old-" + i,
      },
    })),
  };
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  for (const value of [null, { status: "ready", reason_code: null, card_stability: [] }]) {
    const projected = row(
      projector.project(
        "candidates.build",
        "paid",
        report({ ...legacy, wildcard_selection: value }),
      ),
    );
    const candidates = row(projected.candidates);
    assert(!Object.hasOwn(candidates, "wildcard_selection"));
    assert(Array.isArray(candidates.wildcards) && candidates.wildcards.length === 5);
  }
});
Deno.test("untrusted or wrong-revision private view retains original cards", async () => {
  const f = await proposed(),
    projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  for (const proof of [undefined, syntheticAuthority("candidates.build", "paid", f.merged, 2)]) {
    const projected = row(projector.project("candidates.build", "paid", report(f.merged), proof));
    const c = row(projected.candidates);
    assert(!Object.hasOwn(c, "wildcard_selection"));
    assert(
      Array.isArray(c.wildcards) &&
        c.wildcards.length === (f.current.wildcards as unknown[]).length,
    );
  }
});
Deno.test("authorized projection rejects inconsistent status, reason, order and over-four", async () => {
  const f = await proposed(), c = row(f.merged), view = row(c._wildcard_selection_view);
  const first = (view.wildcards as unknown[])[0];
  const cases = [
    {
      wildcards: [first],
      wildcard_selection: {
        status: "pending",
        reason_code: "wildcard_evidence_unavailable",
        card_stability: [{ offering_id: "SYNTHETIC-a", status: "verified" }],
      },
    },
    {
      wildcards: [],
      wildcard_selection: {
        status: "partial",
        reason_code: "wildcard_comparison_unverified",
        card_stability: [],
      },
    },
    {
      wildcards: [],
      wildcard_selection: {
        status: "ready",
        reason_code: "wildcard_comparison_unverified",
        card_stability: [],
      },
    },
    {
      wildcards: [first],
      wildcard_selection: {
        status: "ready",
        reason_code: null,
        card_stability: [{ offering_id: "SYNTHETIC-other", status: "verified" }],
      },
    },
    {
      wildcards: Array(5).fill(first),
      wildcard_selection: {
        status: "ready",
        reason_code: null,
        card_stability: Array(5).fill({ offering_id: "SYNTHETIC-a", status: "verified" }),
      },
    },
  ];
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  for (const invalid of cases) {
    let rejected = false;
    try {
      projector.project(
        "candidates.build",
        "paid",
        report({ ...c, _wildcard_selection_view: invalid }),
        { assertCurrent: () => Promise.resolve(), authorizes: () => true },
      );
    } catch {
      rejected = true;
    }
    assert(rejected, "trusted but inconsistent DTO must fail closed");
  }
});
Deno.test("producer rejects inconsistent preview before persistence", async () => {
  const f = await proposed(), c = row(f.merged), view = row(c._wildcard_selection_view);
  let rejected = false;
  try {
    materializeWildcardReview({
      current_candidates: f.current,
      preview: {
        mode: "REVIEW_ONLY",
        wildcards: view.wildcards as NativeObject[],
        wildcard_selection: {
          status: "pending",
          reason_code: "wildcard_evidence_unavailable",
          card_stability: [],
        },
      },
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("synthetic revision authority rejects other owner and modified selection", async () => {
  const f = await proposed(),
    projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const wrongOwner = syntheticAuthority("candidates.build", "paid", f.merged, 1, "SYNTHETIC-other");
  const denied = row(projector.project("candidates.build", "paid", report(f.merged), wrongOwner));
  assert(!Object.hasOwn(row(denied.candidates), "wildcard_selection"));
  const original = row(f.merged), view = row(original._wildcard_selection_view);
  const selection = row(view.wildcard_selection);
  const modified = {
    ...original,
    _wildcard_selection_view: {
      ...view,
      wildcard_selection: { ...selection, reason_code: "wildcard_evidence_unavailable" },
    },
  };
  const proof = syntheticAuthority("candidates.build", "paid", f.merged);
  const changed = row(projector.project("candidates.build", "paid", report(modified), proof));
  const candidates = row(changed.candidates);
  assert(!Object.hasOwn(candidates, "wildcard_selection"));
  assert(
    Array.isArray(candidates.wildcards) &&
      candidates.wildcards.length === (f.current.wildcards as unknown[]).length,
  );
});
Deno.test("authorized ready empty selection is a confirmed zero without invented cards", async () => {
  const f = await proposed(), original = row(f.merged);
  const empty = {
    ...original,
    _wildcard_selection_view: {
      wildcards: [],
      wildcard_selection: { status: "ready", reason_code: null, card_stability: [] },
    },
  };
  const projector = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  const projected = row(
    projector.project(
      "candidates.build",
      "paid",
      report(empty),
      syntheticAuthority("candidates.build", "paid", empty),
    ),
  );
  const candidates = row(projected.candidates);
  assert(row(candidates.wildcard_selection).status === "ready");
  assert(Array.isArray(candidates.wildcards) && candidates.wildcards.length === 0);
});

Deno.test("legacy null and accidental object serialize exactly as old projection", async () => {
  const f = await proposed(), source = row(f.current);
  // f137 fixture SHA-256: 3cd3edc348addd802945b9c89b6a86a9a0074a2ff80e7d9c5f04a35eab3e39fd.
  // Pinned offline from its synthetic old projection; the generated fixture may evolve.
  const oldResponseSha256 = "3a920ce09e2b09c056cc88849595f455a49e66e58e4a5caaf6f580763e46da76";
  const current = new PublicResponseProjection(patchedRegistry(), proposedRoutes.operations);
  for (const selection of [null, { status: "ready", reason_code: null, card_stability: [] }]) {
    const saved = report({ ...source, wildcard_selection: selection });
    const bytes = new TextEncoder().encode(
      publicJsonText(current.project("report.read", "paid", saved)),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    assert(
      bytes.length === 4020 && sha256 === oldResponseSha256,
      "f137 synthetic old response differs",
    );
  }
});

Deno.test("professional changing wildcard authority between recursive projections fails closed", async () => {
  const f = await proposed();
  const transitions: (boolean | "throw")[][] = [
    [true, false],
    [false, true],
    [true, "throw"],
    ["throw", true],
  ];
  const unblocked: string[] = [];
  for (const transition of transitions) {
    const projector = new ProfessionalProjection(PROFESSIONAL_CONTRACT, patchedRegistry());
    let index = 0, rejected = false;
    const authority: WildcardProjectionAuthority = {
      assertCurrent: () => Promise.resolve(),
      authorizes: () => {
        const value = transition[index++];
        if (value === "throw") throw new Error("SYNTHETIC-revocation");
        return value === true;
      },
    };
    try {
      projector.project(
        "pro.candidates",
        {
          orgId: "SYNTHETIC-org",
          studentId: "SYNTHETIC-student",
          data: {
            org_id: "SYNTHETIC-org",
            student_id: "SYNTHETIC-student",
            candidates: f.merged,
          } as unknown as NativeObject,
          reasons: [],
        },
        "0".repeat(32),
        authority,
      );
    } catch {
      rejected = true;
    }
    if (!rejected) unblocked.push(transition.join(" -> "));
  }
  assert(!unblocked.length, "inconsistent transitions allowed: " + unblocked.join(", "));
});
Deno.test("professional consistently denied or throwing wildcard proof preserves legacy reasons", async () => {
  const f = await proposed();
  for (const throwing of [false, true]) {
    const projector = new ProfessionalProjection(PROFESSIONAL_CONTRACT, patchedRegistry());
    const authority: WildcardProjectionAuthority = {
      assertCurrent: () => Promise.resolve(),
      authorizes: () => {
        if (throwing) throw new Error("SYNTHETIC-proof-unavailable");
        return false;
      },
    };
    const output = row(projector.project(
      "pro.candidates",
      {
        orgId: "SYNTHETIC-org",
        studentId: "SYNTHETIC-student",
        data: {
          org_id: "SYNTHETIC-org",
          student_id: "SYNTHETIC-student",
          candidates: f.merged,
        } as unknown as NativeObject,
        reasons: [],
      },
      "0".repeat(32),
      authority,
    ));
    const candidates = row(row(output.data).candidates);
    assert(!Object.hasOwn(candidates, "wildcard_selection"));
    assert(
      Array.isArray(candidates.wildcards) &&
        candidates.wildcards.length === (f.current.wildcards as unknown[]).length,
    );
    assert(
      Array.isArray(output.reason_codes) &&
        output.reason_codes.includes("counseling_basis_not_connected"),
    );
    assert(
      !(output.reason_codes as unknown[]).some((code) =>
        typeof code === "string" && code.startsWith("wildcard_")
      ),
    );
  }
});
