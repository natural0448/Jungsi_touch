import { HistoryCurrentPageService } from "./jungsi/application/history_current_page.ts";
import {
  createGuideSearchPageComposition,
  type GuidePositionCodec,
  type GuideSearchAuthority,
} from "./current_2027_guide_search_review_only.ts";
import {
  comparePublicCatalogKeys,
  type CurrentPublicCatalogPort,
  type PublicCatalogKey,
  type PublicCatalogRecord,
} from "./current_public_catalog.ts";
import type {
  CurrentPagePortContext,
  CurrentPageQuery,
  QuotaDecision,
} from "./jungsi/application/history_current_page.ts";

const assert = (v: unknown) => {
  if (!v) throw new Error("assertion_failed");
};
async function rejects(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("expected_failure");
}
const GUIDE = "a".repeat(64),
  PUBLICATION = "b".repeat(64),
  SNAP = "c".repeat(64),
  CATALOG_HEAD = "9".repeat(64);
function row(pk: string, release: string): PublicCatalogRecord {
  const identity = {
    release_id: release,
    academic_year: 2027,
    offering_pk: pk,
    school_id: "synthetic-school",
    offering_id: `2027:${pk}`,
    source_kind: "current_guide",
    row_fingerprint: "7".repeat(64),
    university: "Synthetic University",
    department: "Synthetic Department",
    track: "Synthetic Track",
    recruit_group: "A",
    campus: "Synthetic Campus",
    location: "Synthetic Region",
  };
  return {
    key: [2027, "synthetic-school", pk, "", `2027:${pk}`],
    row: { ...identity },
    guide: { ...identity },
  };
}
function fixture(limit = 2) {
  const control = new AbortController();
  const state = {
    allowed: true,
    stale: false,
    mutateQuery: false,
    mutateSearchFilter: false,
    scanCovered: true,
    globallyCollisionFree: true,
    projection: new Map<string, "VERIFIED" | "HOLD">(),
    abortOnSearch: false,
    wrongHead: false,
    changedPublication: false,
    emptyProgress: false,
    excludeProof: "EXCLUDE_CONFIRMED" as "EXCLUDE_CONFIRMED" | "HOLD" | "UNKNOWN",
    membership: new Map<string, "VERIFIED" | "HOLD">(),
    targets: new Map<string, "INCLUDE" | "HOLD" | "EXCLUDE">(),
    records: [
      row("A", "release-one"),
      row("B", "release-two"),
      row("C", "release-two"),
      row("D", "release-one"),
    ],
    publications: 0,
    searches: 0,
    lookups: 0,
    preflight: 0,
    classifications: 0,
  };
  const raw = { limit: String(limit) };
  const context = {
    execution: {
      operation: "history.current-page",
      session: {
        user: { subjectId: "synthetic-subject", expiresAtUtc: 900n },
        evaluatedAtUtc: 50n,
        tier: "standard",
        paidUntilUtc: null,
      },
      query: raw,
    },
    boundary: { signal: control.signal, admission: Object.freeze({ synthetic: true }) },
    pins: {
      subject: "synthetic-subject",
      snapshot_id: "snapshot-test",
      snapshot_publication_sha256: SNAP,
      snapshot_source_head_sha256: "d".repeat(64),
      snapshot_scope_sha256: "e".repeat(64),
      guide_publication_sha256: PUBLICATION,
      guide_head_sha256: GUIDE,
      decision_scope_sha256: "f".repeat(64),
      expires_at_utc: 800n,
    },
  } as unknown as CurrentPagePortContext;
  const query: CurrentPageQuery = {
    university_q: "",
    department_q: "",
    region: "",
    group: "",
    limit,
  };
  const catalog: CurrentPublicCatalogPort = {
    publication: async () => {
      await Promise.resolve();
      state.publications++;
      return {
        version: "synthetic",
        sha256: state.changedPublication && state.publications > 1 ? "9".repeat(64) : PUBLICATION,
        expiresAtUtc: 700n,
      };
    },
    search: async (subject, kind, q, after) => {
      await Promise.resolve();
      state.searches++;
      assert(
        subject === "synthetic-subject" && kind === "offerings" && q.academic_year === 2027 &&
          q.limit === limit,
      );
      if (state.mutateQuery) (raw as Record<string, string>).region = "changed";
      if (state.mutateSearchFilter) (q as { region: string }).region = "changed";
      if (state.abortOnSearch) control.abort();
      const records = state.records.filter((r) =>
        !after || comparePublicCatalogKeys(after, r.key) < 0
      );
      return {
        version: "synthetic",
        head: state.wrongHead ? "8".repeat(64) : CATALOG_HEAD,
        asOfUtc: 80n,
        rows: state.emptyProgress ? [] : records.slice(0, q.limit + 1),
        nextAfter: state.emptyProgress ? row("Z", "release-two").key : null,
      };
    },
    lookup: () => {
      state.lookups++;
      return Promise.reject(new Error("unexpected_lookup"));
    },
  };
  const authority: GuideSearchAuthority = {
    begin: () => Promise.resolve(context.pins),
    verifyRelations: (_ctx, claims) =>
      Promise.resolve(claims.map((c) => ({ claim_id: c.claim_id, decision: "HOLD" as const }))),
    authorizeBeforeBegin: () => {
      if (!state.allowed || !state.globallyCollisionFree) throw new Error("not_authorized");
    },
    assertCatalogBinding: (_ctx, pub, head) => {
      if (pub !== PUBLICATION || head !== CATALOG_HEAD) throw new Error("unbound_catalog_head");
    },
    assertScanCoverage: () =>
      state.scanCovered ? Promise.resolve() : Promise.reject(new Error("unknown_scan")),
    classifyGuideProjections: (_ctx, claims) =>
      Promise.resolve(claims.map(({ target }) => ({
        target,
        decision: state.projection.get(target.offering_pk) ?? "VERIFIED",
      }))),
    authorizeBeforeIO: () => {
      state.preflight++;
      if (!state.allowed) throw new Error("not_authorized");
    },
    assertCurrent: async () => {
      await Promise.resolve();
      if (state.stale) throw new Error("stale");
    },
    classifyGuideMembership: async (_ctx, keys) => {
      await Promise.resolve();
      return keys.map((target) => ({
        target,
        decision: state.membership.get(target.offering_pk) ?? "VERIFIED",
      }));
    },
    classifyTargets: async (_ctx, keys) => {
      await Promise.resolve();
      state.classifications++;
      return keys.map((target): QuotaDecision => {
        const decision = state.targets.get(target.offering_pk) ?? "INCLUDE";
        return {
          target,
          decision,
          quota: decision === "INCLUDE"
            ? {
              value: null,
              status: "pending_value_missing",
              stage: "unknown",
              unit: null,
              condition: "unknown",
              condition_text: null,
              source_url: null,
              source_as_of: null,
            }
            : null,
        };
      });
    },
    confirmExclusions: async (_ctx, keys) => {
      await Promise.resolve();
      return keys.map((target) => ({ target, decision: state.excludeProof }));
    },
  };
  const positions = new Map<string, PublicCatalogKey>();
  const codec: GuidePositionCodec = {
    decode: (_ctx, _q, token) => {
      const value = positions.get(token);
      if (!value) throw new Error("bad_cursor");
      return value;
    },
    encode: (_ctx, _q, key) => {
      const token = `position-${positions.size + 1}`;
      positions.set(token, [...key]);
      return token;
    },
  };
  const clock = { nowUtc: () => 100n };
  const composition = createGuideSearchPageComposition(catalog, authority, codec, clock);
  let begun = false;
  const page = {
    page: async (ctx: CurrentPagePortContext, q: CurrentPageQuery, after: string | null) => {
      if (!begun) {
        await composition.authority.begin(ctx.execution, ctx.boundary);
        begun = true;
      }
      return await composition.offerings.page(ctx, q, after);
    },
  };
  return {
    state,
    context,
    query,
    catalog,
    authority,
    codec,
    clock,
    control,
    composition,
    page,
  };
}

Deno.test("missing or rejected independent admission fails before every catalog port", async () => {
  const f = fixture();
  await rejects(() =>
    Promise.resolve().then(() =>
      createGuideSearchPageComposition(f.catalog, null, f.codec, f.clock)
    )
  );
  await rejects(() =>
    Promise.resolve().then(() =>
      createGuideSearchPageComposition(f.catalog, f.authority, null, f.clock)
    )
  );
  f.state.allowed = false;
  await rejects(() => f.page.page(f.context, f.query, null));
  assert(f.state.publications === 0 && f.state.searches === 0 && f.state.lookups === 0);
});

Deno.test("one bounded search preserves each physical release and never performs N+1 lookup", async () => {
  const f = fixture();
  const page = await f.page.page(f.context, f.query, null);
  assert(page.items.length === 2 && page.items[0].key.release_id === "release-one");
  assert(page.items[1].key.release_id === "release-two" && page.next_position !== null);
  assert(f.state.preflight === 1 && f.state.searches === 1 && f.state.publications === 2);
  assert(f.state.lookups === 0 && f.state.classifications === 1);
});

Deno.test("exclusion is confirmed before output and keyset does not skip the sentinel", async () => {
  const f = fixture();
  f.state.targets.set("A", "EXCLUDE");
  const first = await f.page.page(f.context, f.query, null);
  assert(first.items.length === 1 && first.items[0].key.offering_pk === "B" && first.next_position);
  const second = await f.page.page(f.context, f.query, first.next_position);
  assert(
    second.items.length === 2 && second.items[0].key.offering_pk === "C" &&
      second.items[1].key.offering_pk === "D",
  );
  assert(f.state.searches === 2 && f.state.lookups === 0);
});

Deno.test("unresolved or conflicting exclusion cannot silently remove a row", async () => {
  const f = fixture();
  f.state.targets.set("A", "EXCLUDE");
  f.state.excludeProof = "HOLD";
  const unresolved = await f.page.page(f.context, f.query, null);
  assert(unresolved.items.length === 2 && unresolved.incomplete_before);
  const held = fixture();
  held.state.membership.set("A", "HOLD");
  const page = await held.page.page(held.context, held.query, null);
  assert(
    page.items.length === 2 && page.incomplete_before && page.items[0].key.offering_pk === "A",
  );
});

Deno.test("empty bounded shard progress can still produce a continuation", async () => {
  const f = fixture();
  f.state.emptyProgress = true;
  const page = await f.page.page(f.context, f.query, null);
  assert(page.items.length === 0 && page.next_position !== null);
  await rejects(() => f.page.page(f.context, f.query, page.next_position));
});

Deno.test("head drift, authorization loss and request mutation fail closed", async () => {
  for (
    const scenario of [
      "head",
      "publication",
      "query",
      "search-filter",
      "abort",
      "current",
      "scan",
    ] as const
  ) {
    const f = fixture();
    if (scenario === "head") f.state.wrongHead = true;
    if (scenario === "publication") f.state.changedPublication = true;
    if (scenario === "query") f.state.mutateQuery = true;
    if (scenario === "search-filter") f.state.mutateSearchFilter = true;
    if (scenario === "scan") f.state.scanCovered = false;
    if (scenario === "abort") f.state.abortOnSearch = true;
    if (scenario === "current") f.state.stale = true;
    await rejects(() => f.page.page(f.context, f.query, null));
    assert(f.state.lookups === 0);
  }
});

Deno.test("invalid limit and expired session are rejected before I/O", async () => {
  const f = fixture(101);
  await rejects(() => f.page.page(f.context, f.query, null));
  assert(f.state.publications === 0 && f.state.searches === 0);
  const expired = fixture();
  (expired.context.execution.session.user as unknown as { expiresAtUtc: bigint }).expiresAtUtc =
    100n;
  await rejects(() => expired.page.page(expired.context, expired.query, null));
  assert(expired.state.publications === 0 && expired.state.searches === 0);
});

Deno.test("limit 100 remains a single bounded search", async () => {
  const f = fixture(100);
  const page = await f.page.page(f.context, f.query, null);
  assert(page.items.length === 4 && f.state.searches === 1 && f.state.lookups === 0);
});

Deno.test("public ID collisions retain separate releases as pending candidates", async () => {
  const f = fixture();
  const first = row("A", "release-one"), second = row("A", "release-two");
  second.key[1] = "other-school";
  second.row.school_id = "other-school";
  second.guide!.school_id = "other-school";
  f.state.records = [first, second].sort((a, b) => comparePublicCatalogKeys(a.key, b.key));
  const page = await f.page.page(f.context, f.query, null);
  assert(page.items.length === 2 && page.incomplete_before && f.state.classifications === 0);
  assert(page.items.some((item) => item.key.release_id === "release-one"));
  assert(page.items.some((item) => item.key.release_id === "release-two"));
});

async function integrated(f: ReturnType<typeof fixture>) {
  const service = new HistoryCurrentPageService(
    {
      authority: f.composition.authority,
      offerings: f.composition.offerings,
      histories: { read: (_ctx, keys) => Promise.resolve({ claims: [], complete_targets: keys }) },
      cursors: {
        open: () => Promise.reject(new Error("unexpected")),
        seal: () => Promise.resolve("synthetic-outer-cursor"),
      },
    },
    f.clock,
    {
      max_cursor_chars: 512,
      max_position_chars: 256,
      max_text_chars: 256,
      max_history_claims: 500,
      max_metrics_per_claim: 20,
      max_result_bytes: 1000000,
    },
  );
  return await service.execute(f.context.execution, f.context.boundary);
}

Deno.test("v8 integrated: a membership HOLD cannot flip to ready on repeated authority calls", async () => {
  const f = fixture();
  f.state.membership.set("A", "HOLD");
  const previous = f.authority.classifyGuideMembership;
  f.authority.classifyGuideMembership = async (ctx, keys) => {
    const result = await previous(ctx, keys);
    f.state.membership.clear();
    return result;
  };
  const result = await integrated(f);
  const items = result.items as Array<Record<string, unknown>>;
  assert(items.length === 2 && items[0].status === "pending" && items[0].offering === null);
  assert(items[1].offering !== null && f.state.searches === 1);
});

Deno.test("v8 integrated: target HOLD and unverified source projection remain anonymous", async () => {
  for (const scenario of ["target", "projection", "fingerprint"] as const) {
    const f = fixture();
    if (scenario === "target") {
      f.state.targets.set("A", "HOLD");
      const previous = f.authority.classifyTargets;
      f.authority.classifyTargets = async (ctx, keys) => {
        const result = await previous(ctx, keys);
        f.state.targets.clear();
        return result;
      };
    }
    if (scenario === "projection") f.state.projection.set("A", "HOLD");
    if (scenario === "fingerprint") f.state.records[0].row.row_fingerprint = null;
    const result = await integrated(f);
    const items = result.items as Array<Record<string, unknown>>;
    assert(items[0].status === "pending" && items[0].offering === null);
    assert(items[1].offering !== null);
  }
});

Deno.test("an unproven same-key release collision blocks before initial I/O", async () => {
  const f = fixture(1);
  f.state.records = [row("A", "release-one"), row("A", "release-two")];
  f.state.globallyCollisionFree = false;
  await rejects(() => f.page.page(f.context, f.query, null));
  assert(f.state.publications === 0 && f.state.searches === 0);
  const inconsistent = fixture(2);
  inconsistent.state.records = [row("A", "release-one"), row("A", "release-two")];
  await rejects(() => inconsistent.page.page(inconsistent.context, inconsistent.query, null));
});

Deno.test("active-service and practical exclusions cannot leak through a direct search", async () => {
  for (const scenario of ["inactive", "practical"] as const) {
    const f = fixture();
    if (scenario === "inactive") f.state.records[0].guide!.active_service = false;
    if (scenario === "practical") f.state.records[0].guide!.practical_required = true;
    await rejects(() => integrated(f));
  }
});

Deno.test("a mismatched composition authority fails before catalog access", async () => {
  const f = fixture();
  const service = new HistoryCurrentPageService(
    {
      authority: f.authority,
      offerings: f.composition.offerings,
      histories: { read: () => Promise.resolve({ claims: [], complete_targets: [] }) },
      cursors: {
        open: () => Promise.reject(new Error("unexpected")),
        seal: () => Promise.resolve("cursor"),
      },
    },
    f.clock,
    {
      max_cursor_chars: 512,
      max_position_chars: 256,
      max_text_chars: 256,
      max_history_claims: 500,
      max_metrics_per_claim: 20,
      max_result_bytes: 1000000,
    },
  );
  await rejects(() => service.execute(f.context.execution, f.context.boundary));
  assert(f.state.publications === 0 && f.state.searches === 0);
});

Deno.test("verified recruitment with unknown quota remains visible, never zero or excluded", async () => {
  const f = fixture();
  const result = await integrated(f);
  const items = result.items as Array<Record<string, unknown>>;
  const recruitment = items[0].recruitment as Record<string, unknown>;
  assert(items[0].offering !== null && recruitment.value === null);
  assert(recruitment.status === "pending_value_missing" && recruitment.stage === "unknown");
});

Deno.test("independently confirmed final zero is excluded before pagination", async () => {
  const f = fixture();
  f.state.targets.set("A", "EXCLUDE");
  f.authority.confirmExclusions = (_ctx, keys) =>
    Promise.resolve(keys.map((target) => {
      assert(target.offering_pk === "A");
      // Synthetic authority stands for separately verified finality and resolved rollover.
      return { target, decision: "EXCLUDE_CONFIRMED" as const };
    }));
  const result = await integrated(f);
  const items = result.items as Array<Record<string, unknown>>;
  const offering = items[0].offering as Record<string, unknown>;
  assert(items.length === 1 && offering.offering_id === "2027:B");
  assert(result.next_cursor !== null && f.state.searches === 1);
});

Deno.test("v8 integrated: unresolved exclusion holds only that row", async () => {
  for (const status of ["HOLD", "UNKNOWN"] as const) {
    const f = fixture();
    f.state.targets.set("A", "EXCLUDE");
    f.state.excludeProof = status;
    const result = await integrated(f);
    const items = result.items as Array<Record<string, unknown>>;
    assert(items.length === 2 && items[0].status === "pending" && items[0].offering === null);
    assert(items[1].offering !== null);
  }
});

Deno.test("non-void scan-coverage responses do not count as proof", async () => {
  for (const result of [false, null] as const) {
    const f = fixture();
    f.authority.assertScanCoverage = () => Promise.resolve(result) as unknown as Promise<void>;
    await rejects(() => integrated(f));
  }
});

Deno.test("false practical flag alone does not resolve independently held scope", async () => {
  const f = fixture();
  f.state.records[0].guide!.practical_required = false;
  f.state.targets.set("A", "HOLD");
  const result = await integrated(f);
  const items = result.items as Array<Record<string, unknown>>;
  assert(items[0].status === "pending" && items[0].offering === null);
  assert(items[1].offering !== null);
});
