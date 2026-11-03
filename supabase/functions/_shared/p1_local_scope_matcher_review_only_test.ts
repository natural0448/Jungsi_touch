import {
  createLocalScopeCandidateMatcher,
  type LocalScopeReviewTrust,
} from "./p1_local_scope_matcher_review_only.ts";
import type {
  CurrentPagePortContext,
  PhysicalKey,
} from "./jungsi/application/history_current_page.ts";
import type { GuideProjectionClaim } from "./current_2027_guide_search_review_only.ts";

const H = (x: string) => x.repeat(64);
const assert = (x: unknown) => {
  if (!x) throw new Error("assertion_failed");
};
async function rejects(f: () => Promise<unknown>) {
  try {
    await f();
  } catch {
    return;
  }
  throw new Error("expected_failure");
}
async function sha(s: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function key(pk: string, release = "synthetic-release"): PhysicalKey {
  return {
    release_id: release,
    academic_year: 2027,
    school_id: "synthetic-school",
    offering_pk: pk,
  };
}
function claim(target: PhysicalKey, fingerprint: string | null = H("f")): GuideProjectionClaim {
  return {
    target,
    rowFingerprint: fingerprint,
    offering: { campus: null, admission_track: "SYN-TRACK", group: "A" },
  } as unknown as GuideProjectionClaim;
}
async function makeIndex(keys: PhysicalKey[], holds = new Set<string>()) {
  const rows: Record<string, unknown> = {};
  for (const target of keys) {
    const id = await sha(
      JSON.stringify([
        target.release_id,
        target.academic_year,
        target.school_id,
        target.offering_pk,
      ]),
    );
    rows[id] = {
      source_row_sha256: H("f"),
      snapshot_line_1based: 1,
      lineage_candidate: {
        recruitment_fact: "BASE_RECRUITMENT_RECORDED_PRIOR_STAGE_REVIEW",
        scope_state: "PRIOR_FINAL_CARRYOVER_HOLD_BASE_CANDIDATE",
        local_membership_candidate: 1,
        prior_scope: "SCOPE_CANDIDATE_O_WITH_SOURCE_CONDITIONS",
        scope254: "NONE",
        user_hold: holds.has(target.offering_pk) ? 1 : 0,
        original_final_carryover_only_hold: 1,
      },
      references: { coverage_row_0based: 0, rowox_row_0based: 0, v20_entry_0based: null },
    };
  }
  const content = JSON.stringify({
    format: "jungsi.p1-private-scope-evidence-candidate/v1",
    authorization: "NONE_REVIEW_ONLY",
    key_scheme: "sha256_utf8_compact_json_array_release_year_school_offering",
    snapshot_scope: "LOCAL_SNAPSHOT_ONLY_NOT_CURRENT_HEAD",
    source_hashes: {
      source: H("a"),
      rowox: H("b"),
      v20: H("c"),
      coverage: H("d"),
      lineage: H("e"),
    },
    rows,
  });
  return { bytes: new TextEncoder().encode(content), digest: await sha(content) };
}
function fixture() {
  const controller = new AbortController();
  const context = {
    execution: {
      operation: "history.current-page",
      session: {
        user: { subjectId: "subject-test", expiresAtUtc: 900n },
        evaluatedAtUtc: 50n,
        tier: "standard",
        paidUntilUtc: null,
      },
      query: {},
    },
    boundary: { signal: controller.signal, admission: Object.freeze({ test: true }) },
    pins: {
      subject: "subject-test",
      snapshot_id: "snapshot-test",
      snapshot_publication_sha256: H("1"),
      snapshot_source_head_sha256: H("2"),
      snapshot_scope_sha256: H("3"),
      guide_publication_sha256: H("4"),
      guide_head_sha256: H("5"),
      decision_scope_sha256: H("6"),
      expires_at_utc: 800n,
    },
  } as unknown as CurrentPagePortContext;
  const state = {
    allowed: true,
    bound: true,
    stale: false,
    mutate: false,
    reviewDecision: "CONFIRMED" as "CONFIRMED" | "HOLD",
    preflight: 0,
    bind: 0,
    review: 0,
    reviewed: 0,
  };
  const trust: LocalScopeReviewTrust = {
    authorizeBeforeIO: () => {
      state.preflight++;
      if (!state.allowed) throw new Error("no admission");
    },
    assertCurrent: () => state.stale ? Promise.reject(new Error("revoked")) : Promise.resolve(),
    bindIndex: (_ctx, _digest, sources) => {
      state.bind++;
      assert(sources.source === H("a"));
      return state.bound ? Promise.resolve() : Promise.reject(new Error("unbound"));
    },
    review: async (_ctx, candidates) => {
      state.review++;
      state.reviewed += candidates.length;
      await Promise.resolve();
      if (state.mutate) (context.execution.query as Record<string, string>).bad = "changed";
      return candidates.map(({ target, lineage }) => {
        assert(lineage.original_final_carryover_only_hold === 1);
        return { target, enrollment: state.reviewDecision, practical: "NON_PRACTICAL" as const };
      });
    },
  };
  return { context, controller, state, trust, clock: { nowUtc: () => 100n } };
}

Deno.test("missing authority or changed index bytes never form an issuer", async () => {
  const f = fixture(), idx = await makeIndex([key("A")]);
  await rejects(() => createLocalScopeCandidateMatcher(idx.bytes, idx.digest, null, f.clock));
  await rejects(() => createLocalScopeCandidateMatcher(idx.bytes, H("9"), f.trust, f.clock));
  assert(f.state.bind === 0 && f.state.review === 0);
});
Deno.test("exact fingerprint and explicit user HOLD govern only their targets", async () => {
  const f = fixture(), idx = await makeIndex([key("A"), key("B"), key("C")], new Set(["C"]));
  const p = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, f.trust, f.clock);
  const verdict = await p.verifyGuideScope!(f.context, [
    claim(key("A")),
    claim(key("B"), H("8")),
    claim(key("C")),
    claim(key("D")),
  ]);
  assert(verdict[0].enrollment === "CONFIRMED" && verdict[0].practical === "NON_PRACTICAL");
  assert(verdict.slice(1).every((v) => v.enrollment === "HOLD" && v.practical === "HOLD"));
  assert(f.state.review === 1 && f.state.reviewed === 1);
});
Deno.test("local candidate and carryover-only flag never self-approve", async () => {
  const f = fixture(), idx = await makeIndex([key("A")]);
  f.state.reviewDecision = "HOLD";
  const p = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, f.trust, f.clock);
  const [out] = await p.verifyGuideScope!(f.context, [claim(key("A"))]);
  assert(out.enrollment === "HOLD" && f.state.reviewed === 1);
});
Deno.test("missing admission, unbound index or expired approval closes before review", async () => {
  for (const situation of ["admission", "binding", "stale"] as const) {
    const f = fixture(), idx = await makeIndex([key("A")]);
    if (situation === "admission") f.state.allowed = false;
    if (situation === "binding") f.state.bound = false;
    if (situation === "stale") f.state.stale = true;
    const p = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, f.trust, f.clock);
    await rejects(() => p.verifyGuideScope!(f.context, [claim(key("A"))]));
    assert(f.state.review === 0);
  }
});
Deno.test("request mutation during evidence review is rejected", async () => {
  const f = fixture(), idx = await makeIndex([key("A")]);
  f.state.mutate = true;
  const p = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, f.trust, f.clock);
  await rejects(() => p.verifyGuideScope!(f.context, [claim(key("A"))]));
});
Deno.test("one batch maintains 42 synthetic verified rows and holds the changed row", async () => {
  const f = fixture(),
    keys = Array.from(
      { length: 43 },
      (_, i) => key(`K${String(i).padStart(2, "0")}`, i % 2 ? "release-a" : "release-b"),
    ),
    idx = await makeIndex(keys);
  const p = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, f.trust, f.clock);
  const verdict = await p.verifyGuideScope!(
    f.context,
    keys.map((k, i) => claim(k, i === 17 ? H("8") : H("f"))),
  );
  assert(
    verdict.filter((v) => v.enrollment === "CONFIRMED").length === 42 &&
      verdict[17].enrollment === "HOLD",
  );
  assert(f.state.review === 1 && f.state.reviewed === 42);
});
Deno.test("page bounds are checked before any trust I/O", async () => {
  const f = fixture(), idx = await makeIndex([key("A")]);
  const p = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, f.trust, f.clock);
  await rejects(() =>
    p.verifyGuideScope!(f.context, Array.from({ length: 101 }, (_, i) => claim(key(`K${i}`))))
  );
  assert(f.state.preflight === 0 && f.state.bind === 0);
});
Deno.test("historical relation HOLD and final carryover HOLD do not automatically reject verified current enrollment", async () => {
  const f = fixture(), idx = await makeIndex([key("A")]);
  const root = JSON.parse(new TextDecoder().decode(idx.bytes));
  const entry = Object.values(root.rows)[0] as {
    lineage_candidate: { scope254: string; scope_state: string };
  };
  entry.lineage_candidate.scope254 = "HOLD_DAEJEON_HISTORICAL_ADDITION_LINK_NOT_REGISTERED";
  entry.lineage_candidate.scope_state = "PRIOR_SCOPE254_HOLD";
  const content = JSON.stringify(root), bytes = new TextEncoder().encode(content);
  const p = await createLocalScopeCandidateMatcher(bytes, await sha(content), f.trust, f.clock);
  const [out] = await p.verifyGuideScope!(f.context, [claim(key("A"))]);
  assert(out.enrollment === "CONFIRMED" && out.practical === "NON_PRACTICAL");
});

Deno.test("settlement during batch prevents any subsequent trust I/O", async () => {
  const f = fixture(), idx = await makeIndex([key("A")]);
  let settled = false, currentCalls = 0;
  f.trust.authorizeBeforeIO = () => {
    if (settled) throw new Error("already settled");
  };
  f.trust.assertCurrent = () => {
    currentCalls++;
    return Promise.resolve();
  };
  const prior = f.trust.review;
  f.trust.review = async (ctx, candidates) => {
    const out = await prior(ctx, candidates);
    settled = true;
    return out;
  };
  const p = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, f.trust, f.clock);
  await rejects(() => p.verifyGuideScope!(f.context, [claim(key("A"))]));
  assert(currentCalls === 1 && f.state.bind === 1 && f.state.review === 1);
});
