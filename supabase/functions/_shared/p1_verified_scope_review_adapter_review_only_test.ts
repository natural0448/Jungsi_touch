/** Synthetic fixtures only. Local hashes do not issue real approval. */
import { fixture } from "./jungsi/application/scope_adapter_synthetic_fixture.ts";
import {
  CurrentGuideReviewedScopeIssuer,
  type IndependentConditionalOnlyAuthority,
  type ScopeClaim,
  type SeparateCampusGrantAuthority,
} from "./jungsi/application/current_guide_scope_issuer.campus.review-only.ts";
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
import type { CurrentPagePortContext } from "./jungsi/application/history_current_page.ts";
import type { GuideProjectionClaim } from "./current_2027_guide_search_review_only.ts";
import { createLocalScopeCandidateMatcher } from "./p1_local_scope_matcher_review_only.ts";
import {
  createVerifiedScopeReviewTrust,
  type IndependentCandidateIndexAuthority,
} from "./p1_verified_scope_review_adapter_review_only.ts";
const H = (x: string) => x.repeat(64);
const assert = (x: unknown) => {
  if (!x) throw Error("assertion_failed");
};
async function rejects(f: () => Promise<unknown>) {
  try {
    await f();
  } catch {
    return;
  }
  throw Error("expected_failure");
}
async function sha(s: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function ctx(): CurrentPagePortContext {
  return {
    execution: {
      operation: "history.current-page",
      session: {
        user: { subjectId: "SYN-USER", expiresAtUtc: 900n },
        evaluatedAtUtc: 50n,
        tier: "standard",
        paidUntilUtc: null,
      },
      query: {},
    },
    boundary: {
      signal: new AbortController().signal,
      admission: Object.freeze({ synthetic: true }),
    },
    pins: {
      subject: "SYN-USER",
      snapshot_id: "synthetic",
      snapshot_publication_sha256: H("1"),
      snapshot_source_head_sha256: H("2"),
      snapshot_scope_sha256: H("3"),
      guide_publication_sha256: H("d"),
      guide_head_sha256: H("c"),
      decision_scope_sha256: H("6"),
      expires_at_utc: 800n,
    },
  } as unknown as CurrentPagePortContext;
}
async function index(claims: ScopeClaim[], held = -1) {
  const rows: Record<string, unknown> = {};
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i],
      t = c.target,
      k = await sha(JSON.stringify([t.release_id, t.academic_year, t.school_id, t.offering_pk]));
    rows[k] = {
      source_row_sha256: c.rowFingerprint,
      snapshot_line_1based: i + 1,
      lineage_candidate: {
        recruitment_fact: "BASE_RECRUITMENT_RECORDED_PRIOR_STAGE_REVIEW",
        scope_state: "PRIOR_FINAL_CARRYOVER_HOLD_BASE_CANDIDATE",
        local_membership_candidate: 1,
        prior_scope: "SCOPE_CANDIDATE_O_WITH_SOURCE_CONDITIONS",
        scope254: "NONE",
        user_hold: i === held ? 1 : 0,
        original_final_carryover_only_hold: 1,
      },
      references: { coverage_row_0based: i, rowox_row_0based: i, v20_entry_0based: null },
    };
  }
  const s = JSON.stringify({
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
  return { bytes: new TextEncoder().encode(s), digest: await sha(s) };
}
async function setup(
  n = 43,
  held = -1,
  existing?: Awaited<ReturnType<typeof fixture>>,
  campus?: SeparateCampusGrantAuthority,
  conditional?: IndependentConditionalOnlyAuthority,
) {
  const f = existing ?? await fixture(n), idx = await index(f.claims, held), context = ctx();
  const state = {
    active: true,
    pairHold: "",
    rolloverOnly: "",
    malformed: false,
    pairFalse: false,
    mutate: false,
    mutateQueryDuringBind: false,
    mutateQueryDuringPair: false,
    settleDuringPair: false,
    bound: 0,
    pairCurrent: 0,
    bind: 0,
    pair: 0,
    rows: 0,
  };
  const guard = {
    assertActive() {
      if (!state.active) throw Error("settled");
    },
  };
  const indexAuthority: IndependentCandidateIndexAuthority = {
    assertRequest: () => Promise.resolve(),
    bindIndex: () => {
      state.bind++;
      if (state.mutateQueryDuringBind) {
        (context.execution.query as Record<string, string>).extra = "changed";
      }
      if (state.mutate) {
        (f.claims[0].offering as { admission_track: string }).admission_track = "CHANGED";
      }
      return Promise.resolve(Object.freeze({ synthetic: true }));
    },
    assertBound: () => {
      state.bound++;
      return Promise.resolve();
    },
    classifySourcePair: (_ctx, _binding, p, candidates) => {
      state.pair++;
      state.rows += candidates.length;
      assert(p.source_sha256 === H("a") && candidates.length <= 100);
      assert(candidates.every((c) => c.lineage.original_final_carryover_only_hold === 1));
      if (state.mutate) assert(candidates.every((c) => c.offering.admission_track === "SYN-TRACK"));
      const out = candidates.map((c) => ({
        target: c.target,
        decision: c.target.offering_pk === state.rolloverOnly
          ? "ROLLOVER_ONLY_PENDING" as const
          : c.target.offering_pk === state.pairHold
          ? "HOLD" as const
          : "MATCHED" as const,
      }));
      if (state.malformed && out.length > 1) out[1] = out[0];
      if (state.mutateQueryDuringPair) {
        (context.execution.query as Record<string, string>).extra = "changed";
      }
      if (state.settleDuringPair) state.active = false;
      return Promise.resolve(out);
    },
    assertPairCurrent: () => {
      state.pairCurrent++;
      return Promise.resolve(state.pairFalse ? false : undefined) as Promise<void>;
    },
  };
  const trust = createVerifiedScopeReviewTrust(
    indexAuthority,
    f.authority,
    f.reader,
    guard,
    campus ?? null,
    conditional ?? null,
  );
  const matcher = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, trust, {
    nowUtc: () => 100n,
  });
  return {
    f,
    context,
    state,
    guard,
    indexAuthority,
    run: () => matcher.verifyGuideScope!(context, f.claims as unknown as GuideProjectionClaim[]),
  };
}
Deno.test("43 synthetic initial candidates: one user HOLD and 42 independently reviewed", async () => {
  const x = await setup(43, 17), v = await x.run();
  assert(
    v.length === 43 &&
      v.filter((d) => d.enrollment === "CONFIRMED" && d.practical === "NON_PRACTICAL").length ===
        42,
  );
  assert(
    v[17].enrollment === "HOLD" && x.f.rows[0].quota_value === 0 &&
      x.f.rows[0].quota_stage === "initial",
  );
  assert(x.f.counts().readerCalls === 1 && x.state.pair === 1 && x.state.rows === 42);
});
Deno.test("source pair HOLD affects only its target and preserves independent initial scope", async () => {
  const x = await setup();
  x.state.pairHold = x.f.claims[7].target.offering_pk;
  const v = await x.run();
  assert(v[7].enrollment === "HOLD" && v.filter((d) => d.enrollment === "CONFIRMED").length === 42);
});
Deno.test("wrong track holds only its own target in the actual issuer", async () => {
  const x = await setup(2);
  (x.f.claims[0].offering as { admission_track: string }).admission_track = "WRONG";
  const v = await x.run();
  assert(v[0].enrollment === "HOLD" && v[1].enrollment === "CONFIRMED");
});
Deno.test("offering identity is snapshotted before asynchronous index binding", async () => {
  const x = await setup(2);
  x.state.mutate = true;
  const v = await x.run();
  assert(
    x.f.claims[0].offering.admission_track === "CHANGED" &&
      v.every((d) => d.enrollment === "CONFIRMED"),
  );
});
Deno.test("identity getter is never called and fails before authority I/O", async () => {
  const x = await setup(1);
  let calls = 0;
  Object.defineProperty(x.f.claims[0].offering, "group", {
    get() {
      calls++;
      return "A";
    },
    enumerable: true,
  });
  await rejects(x.run);
  assert(calls === 0 && x.state.bind === 0 && x.f.counts().readerCalls === 0);
});
Deno.test("missing approval or settled admission never reads evidence", async () => {
  const x = await setup(1);
  x.f.setUnapproved();
  const v = await x.run();
  assert(v[0].enrollment === "HOLD" && x.f.counts().readerCalls === 0 && x.state.pair === 0);
  const y = await setup(1);
  y.state.active = false;
  await rejects(y.run);
  assert(y.state.bind === 0 && y.f.counts().readerCalls === 0);
  try {
    createVerifiedScopeReviewTrust(null, y.f.authority, y.f.reader, y.guard);
    throw Error("accepted");
  } catch (e) {
    assert(e instanceof Error && e.message !== "accepted");
  }
});
Deno.test("duplicate verdict and stale source pair fail closed", async () => {
  const x = await setup(2);
  x.state.malformed = true;
  await rejects(x.run);
  const y = await setup(2);
  y.state.pairFalse = true;
  await rejects(y.run);
});
Deno.test("100 synthetic rows use one batch and preserve both physical releases", async () => {
  const x = await setup(100), v = await x.run();
  assert(v.length === 100 && v.every((d) => d.enrollment === "CONFIRMED"));
  assert(x.f.counts().readerCalls === 1 && x.state.pair === 1 && x.state.rows === 100);
});

Deno.test("unknown null group is HOLD unless independently confirmed for that row", async () => {
  const f = await fixture(2, 64, { 0: { group: null } });
  (f.entries[0].identity_states as Record<string, string>).group = "unknown";
  await f.seal();
  const a = await setup(2, -1, f), out = await a.run();
  assert(out[0].enrollment === "HOLD" && out[1].enrollment === "CONFIRMED");
  (f.entries[0].identity_states as Record<string, string>).group = "confirmed_null";
  await f.seal();
  const b = await setup(2, -1, f), verified = await b.run();
  assert(verified.every((v) => v.enrollment === "CONFIRMED"));
});
Deno.test("query mutation or settlement during pair check prevents further authority I/O", async () => {
  const a = await setup(2);
  a.state.mutateQueryDuringPair = true;
  await rejects(a.run);
  assert(a.state.pair === 1 && a.state.pairCurrent === 0);
  const b = await setup(2);
  b.state.settleDuringPair = true;
  await rejects(b.run);
  assert(b.state.pair === 1 && b.state.pairCurrent === 0);
});
Deno.test("3232, 1004 and 43 synthetic keys are processed in bounded set batches", async () => {
  const counts = [3232, 1004, 43];
  const claims: ScopeClaim[] = Array.from(
    { length: counts.reduce((a, b) => a + b, 0) },
    (_, i) => ({
      target: {
        release_id: i % 2 ? "SYN-R1" : "SYN-R0",
        academic_year: 2027,
        school_id: "SYN-SCHOOL",
        offering_pk: "SYN-" + i,
      },
      rowFingerprint: H("f"),
      offering: { campus: null, admission_track: "SYN-TRACK", group: "A" },
    }),
  );
  const idx = await index(claims), c = ctx();
  let calls = 0, max = 0;
  const matcher = await createLocalScopeCandidateMatcher(idx.bytes, idx.digest, {
    authorizeBeforeIO() {},
    assertCurrent: () => Promise.resolve(),
    bindIndex: () => Promise.resolve(),
    review: (_ctx, list) => {
      calls++;
      max = Math.max(max, list.length);
      return Promise.resolve(
        list.map(({ target }) => ({
          target,
          enrollment: "CONFIRMED" as const,
          practical: "NON_PRACTICAL" as const,
        })),
      );
    },
  }, { nowUtc: () => 100n });
  let start = 0, visited = 0;
  for (const count of counts) {
    for (let i = 0; i < count; i += 100) {
      const part = claims.slice(start + i, start + Math.min(i + 100, count));
      const result = await matcher.verifyGuideScope!(c, part as unknown as GuideProjectionClaim[]);
      assert(result.length === part.length && result.every((v) => v.enrollment === "CONFIRMED"));
      visited += result.length;
    }
    start += count;
  }
  assert(visited === 4279 && calls === 45 && max === 100);
});

Deno.test("mutation during index binding is rejected before any subsequent I/O", async () => {
  const a = await setup(2);
  a.state.mutateQueryDuringBind = true;
  await rejects(a.run);
  assert(a.state.bind === 1 && a.state.bound === 0 && a.f.counts().readerCalls === 0);
});

async function missingCampusFixture(n = 2, missingCount = 1) {
  const f = await fixture(n, 64);
  for (let i = 0; i < missingCount; i++) delete f.rows[i].campus;
  const bytes = (v: unknown) => new TextEncoder().encode(nativeJsonText(v));
  const digestBytes = async (b: Uint8Array) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
  for (let offset = 0; offset < n; offset += 64) {
    const index = offset / 64, chunk = f.rows.slice(offset, offset + 64);
    const page = bytes({
      format: "jungsi.r27-source-page/v1",
      source_sha256: H("a"),
      source_head_sha256: H("b"),
      index,
      rows: chunk,
    });
    const receipt = bytes({
      format: "jungsi.r27-reviewed-scope/v1",
      status: "approved_scope_mappings",
      source_sha256: H("a"),
      grants: chunk.map((r) => ({
        source: {
          academic_year: r.academic_year,
          school_id: r.school_id,
          original_pk: r.original_pk,
          campus: r.campus ?? "SYN-CAMPUS",
          admission_track: r.admission_track,
          group: r.group,
        },
        state: (r.scope as Record<string, unknown>).state,
        evidence_sha256: (r.scope as Record<string, unknown>).evidence_sha256,
      })),
    });
    f.pages[index] = page;
    f.receipts[index] = receipt;
    const ph = await digestBytes(page), rh = await digestBytes(receipt);
    for (let i = offset; i < Math.min(offset + 64, n); i++) {
      f.entries[i].source_page_sha256 = ph;
      f.entries[i].source_row_sha256 = await nativeJsonSha256(f.rows[i]);
      f.entries[i].scope_receipt_sha256 = rh;
    }
  }
  for (let i = 0; i < missingCount; i++) {
    (f.entries[i].identity_states as Record<string, string>).campus = "unknown";
    f.entries[i].identity_binding = {
      physical_pk: "verified_unique",
      source_scope: "verified_unique",
      evidence_sha256: H("e"),
    };
  }
  await f.seal();
  return f;
}
Deno.test("source campus key missing keeps independently verified enrollment and marks campus unknown", async () => {
  const f = await missingCampusFixture(), x = await setup(2, -1, f), out = await x.run();
  assert(!Object.hasOwn(f.rows[0], "campus") && f.claims[0].offering.campus === "SYN-CAMPUS");
  assert(
    out[0].enrollment === "CONFIRMED" && out[0].practical === "NON_PRACTICAL" &&
      out[0].campus_state === "unknown" && out[0].campus_value === null,
  );
  assert(out[1].enrollment === "CONFIRMED" && out[1].campus_state === "confirmed_value");
});
Deno.test("separate trusted campus grant preserves its value and provenance independently", async () => {
  const f = await missingCampusFixture();
  let calls = 0;
  const grant: SeparateCampusGrantAuthority = {
    classify(_request, pin, claims) {
      calls++;
      assert(
        pin.guide_head_sha256 === H("c") && claims.length === 1 &&
          claims[0].source_campus_presence === "missing" &&
          claims[0].guide_row_sha256 === f.claims[0].rowFingerprint,
      );
      return Promise.resolve([{
        target: claims[0].target,
        state: "confirmed_value",
        value: "SYN-CAMPUS",
        provenance_sha256: H("1"),
        guide_presence: "value",
      }]);
    },
    assertCurrent: () => Promise.resolve(),
  };
  const x = await setup(2, -1, f, grant), out = await x.run();
  assert(
    calls === 1 && out[0].campus_state === "confirmed_value" &&
      out[0].campus_value === "SYN-CAMPUS" && out[0].campus_origin === "separate_grant",
  );
});
Deno.test("separate confirmed null is distinct from source absence and unknown", async () => {
  const f = await missingCampusFixture();
  (f.claims[0].offering as { campus: string | null }).campus = null;
  const issuer = new CurrentGuideReviewedScopeIssuer(f.authority, f.reader, { assertActive() {} }, {
    classify: (_req, _pin, claims) =>
      Promise.resolve([{
        target: claims[0].target,
        state: "confirmed_null",
        value: null,
        provenance_sha256: H("2"),
        guide_presence: "null",
      }]),
    assertCurrent: () => Promise.resolve(),
  });
  const out = await issuer.verifyGuideScope(ctx(), f.claims);
  assert(
    out[0].enrollment === "CONFIRMED" && out[0].campus_state === "confirmed_null" &&
      out[0].campus_value === null && out[0].campus_origin === "separate_grant",
  );
});
Deno.test("conflicting or duplicate campus grants do not suppress independently verified rows", async () => {
  const f = await missingCampusFixture();
  const issuer = new CurrentGuideReviewedScopeIssuer(f.authority, f.reader, { assertActive() {} }, {
    classify: (_req, _pin, claims) =>
      Promise.resolve([
        {
          target: claims[0].target,
          state: "confirmed_value",
          value: "OTHER",
          provenance_sha256: H("2"),
          guide_presence: "value",
        },
        {
          target: claims[0].target,
          state: "confirmed_value",
          value: "SYN-CAMPUS",
          provenance_sha256: H("2"),
          guide_presence: "value",
        },
      ]),
    assertCurrent: () => Promise.resolve(),
  });
  const out = await issuer.verifyGuideScope(ctx(), f.claims);
  assert(
    out[0].enrollment === "CONFIRMED" && out[0].campus_state === "unknown" &&
      out[1].enrollment === "CONFIRMED",
  );
});

Deno.test("source fingerprint mismatch holds only that recruitment row", async () => {
  const f = await missingCampusFixture();
  f.entries[0].source_row_sha256 = H("9");
  await f.seal();
  const x = await setup(2, -1, f), out = await x.run();
  assert(out[0].enrollment === "HOLD" && out[1].enrollment === "CONFIRMED");
});
Deno.test("unavailable campus grant stays unknown and stale grant rejects before output", async () => {
  const f = await missingCampusFixture();
  const unavailable: SeparateCampusGrantAuthority = {
    classify: () => Promise.resolve(null),
    assertCurrent: () => Promise.resolve(),
  };
  const a = await setup(2, -1, f, unavailable), out = await a.run();
  assert(out[0].enrollment === "CONFIRMED" && out[0].campus_state === "unknown");
  const stale: SeparateCampusGrantAuthority = {
    classify: () => Promise.resolve(null),
    assertCurrent: () => Promise.resolve(false) as unknown as Promise<void>,
  };
  const b = await setup(2, -1, f, stale);
  await rejects(b.run);
});

Deno.test("141 synthetic absent-campus sources match string-bearing scope grants without adding null", async () => {
  const f = await missingCampusFixture(141, 141);
  const issuer = new CurrentGuideReviewedScopeIssuer(f.authority, f.reader, { assertActive() {} });
  const a = await issuer.verifyGuideScope(ctx(), f.claims.slice(0, 100));
  const b = await issuer.verifyGuideScope(ctx(), f.claims.slice(100));
  assert(
    a.length === 100 && b.length === 41 &&
      [...a, ...b].every((x) =>
        x.enrollment === "CONFIRMED" && x.practical === "NON_PRACTICAL" &&
        x.campus_state === "unknown"
      ),
  );
  assert(f.rows.every((r) => !Object.hasOwn(r, "campus")) && f.counts().readerCalls === 2);
});

/** In-memory test double. This does not constitute an actual authority. */
const pendingIssuer: IndependentConditionalOnlyAuthority = {
  classify: (_request, _pin, claims) =>
    Promise.resolve(
      claims.map(({ target }) => ({ target, decision: "VERIFIED_PENDING" as const })),
    ),
  assertCurrent: () => Promise.resolve(),
};
Deno.test("only independent conditional-only proof can mark unconfirmed rollover", async () => {
  const f = await fixture(2);
  f.entries[0].enrollment = "ROLLOVER_ONLY_PENDING";
  await f.seal();
  const a = await setup(2, -1, f, undefined, pendingIssuer);
  a.state.rolloverOnly = f.claims[0].target.offering_pk;
  const out = await a.run();
  assert(
    out[0].enrollment === "HOLD" && out[0].enrollment_basis === "rollover_only_pending" &&
      out[1].enrollment === "CONFIRMED",
  );
  const b = await setup(2, -1, f);
  const unknown = await b.run();
  assert(unknown[0].enrollment === "HOLD" && unknown[0].enrollment_basis === "unknown");
});
Deno.test("conditional-only assertion conflicting with confirmed base intake remains HOLD", async () => {
  const a = await setup(2);
  a.state.rolloverOnly = a.f.claims[0].target.offering_pk;
  const out = await a.run();
  assert(
    out[0].enrollment === "HOLD" && out[0].enrollment_basis === "unknown" &&
      out[1].enrollment === "CONFIRMED",
  );
});

Deno.test("official rollover confirmation in a new approved source can expose that row", async () => {
  const f = await fixture(2);
  f.entries[0].enrollment = "ROLLOVER_ONLY_PENDING";
  await f.seal();
  const before = await setup(2, -1, f, undefined, pendingIssuer);
  before.state.rolloverOnly = f.claims[0].target.offering_pk;
  assert((await before.run())[0].enrollment_basis === "rollover_only_pending");
  f.entries[0].enrollment = "CONFIRMED";
  await f.seal();
  const after = await setup(2, -1, f), out = await after.run();
  assert(
    out[0].enrollment === "CONFIRMED" && out[0].practical === "NON_PRACTICAL" &&
      out[0].enrollment_basis === "unknown",
  );
});
Deno.test("explicit user HOLD is never converted to a hidden conditional-only decision", async () => {
  const f = await fixture(2);
  f.entries[0].enrollment = "ROLLOVER_ONLY_PENDING";
  await f.seal();
  const x = await setup(2, 0, f);
  x.state.rolloverOnly = f.claims[0].target.offering_pk;
  const out = await x.run();
  assert(
    out[0].enrollment === "HOLD" && out[0].enrollment_basis === "unknown" &&
      out[1].enrollment === "CONFIRMED",
  );
});

Deno.test("pair pending cannot hide issuer user HOLD or source/scope mismatch", async () => {
  for (const failure of ["issuer_user_hold", "source_hash", "scope_receipt"] as const) {
    const f = await fixture(2);
    f.entries[0].enrollment = "ROLLOVER_ONLY_PENDING";
    if (failure === "issuer_user_hold") f.entries[0].user_hold = true;
    if (failure === "source_hash") f.entries[0].source_row_sha256 = H("9");
    if (failure === "scope_receipt") f.entries[0].scope_receipt_sha256 = H("9");
    await f.seal();
    let issuerCalls = 0;
    const authority: IndependentConditionalOnlyAuthority = {
      classify: (_ctx, _pin, claims) => {
        issuerCalls++;
        return Promise.resolve(
          claims.map(({ target }) => ({ target, decision: "VERIFIED_PENDING" as const })),
        );
      },
      assertCurrent: () => Promise.resolve(),
    };
    const x = await setup(2, -1, f, undefined, authority);
    x.state.rolloverOnly = f.claims[0].target.offering_pk;
    const out = await x.run();
    assert(
      out[0].enrollment === "HOLD" && out[0].enrollment_basis === "unknown" &&
        out[1].enrollment === "CONFIRMED" && issuerCalls === 0,
    );
  }
});
Deno.test("issuer pending alone or pair pending alone cannot hide the target", async () => {
  const f = await fixture(2);
  f.entries[0].enrollment = "ROLLOVER_ONLY_PENDING";
  await f.seal();
  const onlyIssuer = await setup(2, -1, f, undefined, pendingIssuer), a = await onlyIssuer.run();
  assert(a[0].enrollment === "HOLD" && a[0].enrollment_basis === "unknown");
  const onlyPair = await setup(2, -1, f), bkey = f.claims[0].target.offering_pk;
  onlyPair.state.rolloverOnly = bkey;
  const b = await onlyPair.run();
  assert(b[0].enrollment === "HOLD" && b[0].enrollment_basis === "unknown");
});

Deno.test("malformed duplicate conditional proof cannot hide a target", async () => {
  const f = await fixture(2);
  f.entries[0].enrollment = "ROLLOVER_ONLY_PENDING";
  await f.seal();
  const authority: IndependentConditionalOnlyAuthority = {
    classify: (_ctx, _pin, claims) =>
      Promise.resolve([
        { target: claims[0].target, decision: "VERIFIED_PENDING" as const },
        { target: claims[0].target, decision: "VERIFIED_PENDING" as const, extra: "invalid" },
      ]),
    assertCurrent: () => Promise.resolve(),
  };
  const x = await setup(2, -1, f, undefined, authority);
  x.state.rolloverOnly = f.claims[0].target.offering_pk;
  const out = await x.run();
  assert(
    out[0].enrollment === "HOLD" && out[0].enrollment_basis === "unknown" &&
      out[1].enrollment === "CONFIRMED",
  );
});
Deno.test("malformed duplicate campus grant remains unknown without holding recruitment", async () => {
  const f = await missingCampusFixture();
  const campus: SeparateCampusGrantAuthority = {
    classify: (_ctx, _pin, claims) =>
      Promise.resolve([
        {
          target: claims[0].target,
          state: "confirmed_value" as const,
          value: "SYN-CAMPUS",
          provenance_sha256: H("1"),
          guide_presence: "value" as const,
        },
        {
          target: claims[0].target,
          state: "confirmed_value" as const,
          value: "SYN-CAMPUS",
          provenance_sha256: H("1"),
          guide_presence: "value" as const,
          extra: "invalid",
        },
      ]),
    assertCurrent: () => Promise.resolve(),
  };
  const x = await setup(2, -1, f, campus), out = await x.run();
  assert(out[0].enrollment === "CONFIRMED" && out[0].campus_state === "unknown");
});
