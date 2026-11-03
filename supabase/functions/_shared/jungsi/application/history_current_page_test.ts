/** Synthetic-only candidate tests. No runtime route, DB, Storage, or network. */
import { AccessError } from "./access.ts";
import { readSessionSnapshot } from "./session_service.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import {
  type CurrentOffering,
  type CurrentPageExecution,
  type CurrentPagePins,
  type CurrentPagePorts,
  type CurrentPageQuery,
  type CursorScope,
  type HistoryClaim,
  HistoryCurrentPageService,
  type PhysicalKey,
  type QuotaDecision,
} from "./history_current_page.ts";

function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}
async function rejects(
  fn: () => Promise<unknown>,
  code: string,
  http: number,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    ok(e instanceof AccessError, `unexpected error ${e}`);
    eq(e.code, code);
    eq(e.http, http);
    return;
  }
  throw new Error(`expected ${code}`);
}
const NOW = 1700000000000000n;
const hash = (v: string) => v.repeat(64);
const target = (pk: string, school = "new-school"): PhysicalKey => ({
  release_id: "guide-27",
  academic_year: 2027,
  offering_pk: pk,
  school_id: school,
});
const previous = (pk: string, school: string): PhysicalKey => ({
  release_id: "guide-26",
  academic_year: 2026,
  offering_pk: pk,
  school_id: school,
});
const offering = (pk: string): CurrentOffering => ({
  key: target(pk),
  university_name: "Synthetic university",
  region: null,
  campus: "Synthetic campus",
  department: "Synthetic department",
  admission_track: "Synthetic track",
  group: "A",
});
const quota = (
  pk: string,
  value: number | bigint | string | JsonFloat | null = 5,
): QuotaDecision => ({
  target: target(pk),
  decision: "INCLUDE",
  quota: {
    value,
    status: value === null ? "pending_value_missing" : "verified_official",
    stage: "initial",
    unit: "persons",
    condition: "conditional",
    condition_text: "original condition",
    source_url: "https://example.test/source",
    source_as_of: "2026-10-01",
  },
});
const claim = (
  id: string,
  source: PhysicalKey,
  proof: string,
  pk = "current-1",
): HistoryClaim => ({
  claim_id: id,
  target: target(pk),
  source,
  campus: "Synthetic campus",
  admission_track: "Synthetic track",
  group: "A",
  observation_id: `obs-${id}`,
  historical_condition: {
    stage: "initial",
    condition: "conditional",
    condition_text: "previous original condition",
  },
  metrics: [{
    field: "final_70_percent_cut",
    value: null,
    status: "not_published",
    unit: null,
    reason_code: "not_published",
    source_context: null,
    statistic_label: "70%",
    cohort: "synthetic cohort",
    source_url: null,
    source_as_of: null,
  }],
  relation_proof: proof,
});
const scopeKey = (scope: CursorScope) =>
  JSON.stringify(scope, (_, v) => typeof v === "bigint" ? v.toString() : v);

async function fixture() {
  let now = NOW;
  const session = await readSessionSnapshot("synthetic-session", {
    verifyUserBearer: () =>
      Promise.resolve({
        subjectId: "member-1",
        expiresAtUtc: NOW + 100000000n,
      }),
  }, {
    readCurrent: () =>
      Promise.resolve({
        authority: "public.jeongsi_passes",
        metadataVerified: true,
        subjectId: "member-1",
        evaluatedAtUtc: NOW,
        paidUntilUtc: null,
      }),
  }, NOW);
  const pins: CurrentPagePins = {
    subject: "member-1",
    snapshot_id: "snapshot:2027.v1",
    snapshot_publication_sha256: hash("a"),
    snapshot_source_head_sha256: hash("b"),
    snapshot_scope_sha256: hash("c"),
    guide_publication_sha256: hash("d"),
    guide_head_sha256: hash("e"),
    decision_scope_sha256: hash("f"),
    expires_at_utc: NOW + 50000000n,
  };
  const state: {
    pins: CurrentPagePins;
    rows: CurrentOffering[];
    scope: QuotaDecision[];
    claims: HistoryClaim[];
    complete: PhysicalKey[];
    next: string | null;
    rawIncomplete: boolean;
    beforePage?: (q: CurrentPageQuery) => void;
    relation: (c: HistoryClaim) => "VERIFIED" | "HOLD";
    meaning: (c: HistoryClaim) => {
      relationship_kind:
        | "continuation"
        | "merge"
        | "split"
        | "other_verified"
        | "unknown";
      observation_use: "individual_result" | "shared_reference" | "unknown";
      origin_verification: "single_original_verified" | "unknown";
      published_score_individual_inference_allowed: boolean | null;
    };
    counts: {
      page: number;
      history: number;
      relation: number;
      scope: number;
      current: number;
    };
  } = {
    pins,
    rows: [offering("current-1")],
    scope: [quota("current-1")],
    claims: [],
    complete: [target("current-1")],
    next: null,
    rawIncomplete: false,
    relation: (c) =>
      c.relation_proof === "approved-proof" &&
        c.target.release_id === "guide-27" &&
        c.target.school_id === "new-school" &&
        c.source.release_id === "guide-26" &&
        ["old-school", "new-school"].includes(c.source.school_id) &&
        c.admission_track === "Synthetic track" && c.group === "A"
        ? "VERIFIED"
        : "HOLD",
    meaning: (c) =>
      c.source.offering_pk === "pre-split"
        ? {
          relationship_kind: "split",
          observation_use: "shared_reference",
          origin_verification: "single_original_verified",
          published_score_individual_inference_allowed: false,
        }
        : {
          relationship_kind: "continuation",
          observation_use: "individual_result",
          origin_verification: "single_original_verified",
          published_score_individual_inference_allowed: true,
        },
    counts: { page: 0, history: 0, relation: 0, scope: 0, current: 0 },
  };
  const cursors = new Map<
    string,
    { scope: string; after: string; incomplete: boolean }
  >();
  const ports: CurrentPagePorts = {
    authority: {
      begin: () => Promise.resolve(state.pins),
      assertCurrent: () => {
        state.counts.current++;
        return Promise.resolve();
      },
      classifyGuideMembership: (_ctx, keys) =>
        Promise.resolve(keys.map((key) => ({
          target: key,
          decision: ["guide-27", "guide-27-b"].includes(key.release_id)
            ? "VERIFIED" as const
            : "HOLD" as const,
        }))),
      classifyTargets: (_ctx, keys) => {
        state.counts.scope++;
        return Promise.resolve(
          state.scope.filter((row) =>
            keys.some((key) =>
              row.target.release_id === key.release_id &&
              row.target.academic_year === key.academic_year &&
              row.target.offering_pk === key.offering_pk
            )
          ),
        );
      },
      verifyRelations: (_ctx, claims) => {
        state.counts.relation++;
        return Promise.resolve(claims.map((c) => ({
          claim_id: c.claim_id,
          decision: state.relation(c),
          ...state.meaning(c),
        })));
      },
    },
    offerings: {
      page: (_ctx, q) => {
        state.counts.page++;
        state.beforePage?.(q);
        return Promise.resolve({
          items: state.rows,
          next_position: state.next,
          incomplete_before: state.rawIncomplete,
        });
      },
    },
    histories: {
      read: () => {
        state.counts.history++;
        return Promise.resolve({
          claims: state.claims,
          complete_targets: state.complete,
        });
      },
    },
    cursors: {
      open: (_ctx, scope, cursor) => {
        const v = cursors.get(cursor);
        if (!v || v.scope !== scopeKey(scope)) {
          throw new AccessError("stale_cursor", 409);
        }
        return Promise.resolve({
          after: v.after,
          incomplete_before: v.incomplete,
        });
      },
      seal: (_ctx, scope, after, incomplete) => {
        const id = `cursor:${cursors.size + 1}`;
        cursors.set(id, { scope: scopeKey(scope), after, incomplete });
        return Promise.resolve(id);
      },
    },
  };
  const clock = { nowUtc: () => now };
  const limits = {
    max_cursor_chars: 512,
    max_position_chars: 256,
    max_text_chars: 256,
    max_history_claims: 500,
    max_metrics_per_claim: 20,
    max_result_bytes: 1000000,
  };
  const service = (override: Partial<CurrentPagePorts> = {}) =>
    new HistoryCurrentPageService({ ...ports, ...override }, clock, limits);
  const boundary = {
    signal: new AbortController().signal,
    admission: Object.freeze({ id: "request-admission" }),
  };
  const execute = (
    query: Record<string, string> = {},
  ): CurrentPageExecution => ({
    operation: "history.current-page",
    session,
    query,
  });
  return {
    state,
    ports,
    service,
    boundary,
    execute,
    setNow: (v: bigint) => {
      now = v;
    },
  };
}
const asJson = (v: Awaited<ReturnType<HistoryCurrentPageService["execute"]>>) =>
  JSON.parse(nativeJsonText(v));

Deno.test("two same-year predecessors and approved school change; unrelated school remains pending", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope.push({
    target: target("current-2"),
    decision: "HOLD",
    quota: null,
  });
  f.state.claims = [
    claim("old-1", previous("predecessor-1", "old-school"), "approved-proof"),
    claim("old-2", previous("predecessor-2", "new-school"), "approved-proof"),
    claim("foreign", previous("unrelated", "foreign-school"), "approved-proof"),
    {
      ...claim(
        "wrong-track",
        previous("different-track", "new-school"),
        "approved-proof",
      ),
      admission_track: "unapproved track",
    },
  ];
  const result = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(result.format, "jungsi.p1-current-page/v1");
  eq(result.status, "pending");
  eq(result.matching_count, null);
  eq(result.items.length, 2);
  eq(result.items[0].history.items.length, 2);
  eq(result.items[0].history.status, "pending");
  eq(result.items[0].history.items[0].university_id, "old-school");
  eq(result.items[0].history.items[1].academic_year, 2026);
  eq(result.items[1].status, "pending");
  eq(result.items[1].offering, null);
  eq(f.state.counts.history, 1);
  eq(f.state.counts.relation, 1);
  eq(f.state.counts.page, 1);
  const printed = JSON.stringify(result);
  ok(!printed.includes("approved-proof"));
  ok(!printed.includes("foreign-school"));
  ok(!printed.includes(hash("b")));
  ok(!printed.includes("release_id"));
});

Deno.test("one previous observation can be referenced by two current targets without duplicate source records", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope.push(quota("current-2"));
  f.state.complete.push(target("current-2"));
  const one = claim(
    "relation-1",
    previous("pre-split", "old-school"),
    "approved-proof",
  );
  const two = {
    ...claim(
      "relation-2",
      previous("pre-split", "old-school"),
      "approved-proof",
      "current-2",
    ),
    observation_id: one.observation_id,
  };
  f.state.claims = [one, two];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(
    out.items[0].history.items[0].observation_id,
    out.items[1].history.items[0].observation_id,
  );
  eq(
    out.items[0].history.items[0].offering_id,
    out.items[1].history.items[0].offering_id,
  );
  eq(out.items[0].offering.offering_id, "2027:current-1");
  eq(out.items[1].offering.offering_id, "2027:current-2");
  eq(out.items[0].history.items[0].relationship_kind, "split");
  eq(out.items[0].history.items[0].observation_use, "shared_reference");
  eq(
    out.items[1].history.items[0].published_score_individual_inference_allowed,
    false,
  );
  eq(
    out.items[1].history.items[0].origin_verification,
    "single_original_verified",
  );
  eq(f.state.counts.history, 1);
  eq(f.state.counts.relation, 1);
});

Deno.test("split references cannot label the same original as separate individual results", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope.push(quota("current-2"));
  f.state.complete.push(target("current-2"));
  const first = claim(
    "relation-1",
    previous("pre-split", "old-school"),
    "approved-proof",
  );
  f.state.claims = [first, {
    ...claim(
      "relation-2",
      previous("pre-split", "old-school"),
      "approved-proof",
      "current-2",
    ),
    observation_id: first.observation_id,
  }];
  f.state.meaning = (c) =>
    c.claim_id === "relation-1"
      ? {
        relationship_kind: "split",
        observation_use: "shared_reference",
        origin_verification: "single_original_verified",
        published_score_individual_inference_allowed: false,
      }
      : {
        relationship_kind: "split",
        observation_use: "individual_result",
        origin_verification: "single_original_verified",
        published_score_individual_inference_allowed: true,
      };
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].history.items.length, 1);
  eq(out.items[0].history.items[0].observation_use, "shared_reference");
  eq(out.items[1].history.status, "pending");
  eq(out.items[1].history.items.length, 0);
  ok(out.items[1].offering);
});

Deno.test("missing individual-inference proof holds only the affected relation", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope.push(quota("current-2"));
  f.state.complete.push(target("current-2"));
  f.state.claims = [
    claim("one", previous("predecessor-1", "old-school"), "approved-proof"),
    claim(
      "two",
      previous("predecessor-2", "old-school"),
      "approved-proof",
      "current-2",
    ),
  ];
  f.state.meaning = (c) => ({
    relationship_kind: "continuation",
    observation_use: "individual_result",
    origin_verification: "single_original_verified",
    published_score_individual_inference_allowed: c.claim_id === "one" ? null : true,
  });
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].history.status, "pending");
  eq(out.items[0].history.items.length, 0);
  ok(out.items[0].offering);
  eq(out.items[1].history.status, "ready");
  eq(
    out.items[1].history.items[0].published_score_individual_inference_allowed,
    true,
  );
});

Deno.test("unknown relationship type or original-observation proof holds the relation", async () => {
  for (const missing of ["relationship", "origin"] as const) {
    const f = await fixture();
    f.state.rows.push(offering("current-2"));
    f.state.scope.push(quota("current-2"));
    f.state.complete.push(target("current-2"));
    f.state.claims = [
      claim("one", previous("predecessor-1", "old-school"), "approved-proof"),
      claim(
        "two",
        previous("predecessor-2", "old-school"),
        "approved-proof",
        "current-2",
      ),
    ];
    f.state.meaning = (c) => ({
      relationship_kind: c.claim_id === "one" && missing === "relationship"
        ? "unknown"
        : "continuation",
      observation_use: "individual_result",
      origin_verification: c.claim_id === "one" && missing === "origin"
        ? "unknown"
        : "single_original_verified",
      published_score_individual_inference_allowed: true,
    });
    const out = asJson(await f.service().execute(f.execute(), f.boundary));
    eq(out.items[0].history.status, "pending");
    eq(out.items[0].history.items.length, 0);
    ok(out.items[0].offering);
    eq(out.items[1].status, "ready");
    eq(out.items[1].history.items.length, 1);
  }
});

Deno.test("same observation with conflicting source values holds each ambiguous reference", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope.push(quota("current-2"));
  f.state.complete.push(target("current-2"));
  const one = claim(
    "one",
    previous("pre-split", "old-school"),
    "approved-proof",
  );
  const two = claim(
    "two",
    previous("pre-split", "old-school"),
    "approved-proof",
    "current-2",
  );
  f.state.claims = [one, {
    ...two,
    observation_id: one.observation_id,
    metrics: [{ ...two.metrics[0], cohort: "different cohort" }],
  }];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].history.status, "pending");
  eq(out.items[1].history.status, "pending");
  eq(out.items[0].history.items.length, 0);
  eq(out.items[1].history.items.length, 0);
});

Deno.test("missing trust, wrong operation, missing admission and aborted request fail closed", async () => {
  const f = await fixture();
  await rejects(
    () => f.service({ authority: null }).execute(f.execute(), f.boundary),
    "security_policy_unavailable",
    503,
  );
  await rejects(
    () => f.service({ histories: null }).execute(f.execute(), f.boundary),
    "security_policy_unavailable",
    503,
  );
  await rejects(
    () =>
      f.service().execute({
        ...f.execute(),
        operation: "history.snapshot.read" as "history.current-page",
      }, f.boundary),
    "security_policy_unavailable",
    503,
  );
  await rejects(
    () => f.service().execute(f.execute(), { signal: f.boundary.signal }),
    "security_policy_unavailable",
    503,
  );
  const abort = new AbortController();
  abort.abort();
  await rejects(
    () => f.service().execute(f.execute(), { signal: abort.signal, admission: {} }),
    "security_policy_unavailable",
    503,
  );
  eq(f.state.counts.page, 0);
});

Deno.test("cursor requires same scope and preserves earlier incomplete status", async () => {
  const f = await fixture();
  f.state.scope = [{
    target: target("current-1"),
    decision: "HOLD",
    quota: null,
  }];
  f.state.next = "p2";
  const first = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(first.status, "pending");
  ok(first.next_cursor);
  f.state.rows = [offering("current-2")];
  f.state.scope = [quota("current-2")];
  f.state.complete = [target("current-2")];
  f.state.next = null;
  const second = asJson(
    await f.service().execute(
      f.execute({ cursor: first.next_cursor }),
      f.boundary,
    ),
  );
  eq(second.items[0].status, "ready");
  eq(second.status, "pending");
  eq(second.next_cursor, null);
  await rejects(
    () =>
      f.service().execute(
        f.execute({ cursor: first.next_cursor, region: "different" }),
        f.boundary,
      ),
    "stale_cursor",
    409,
  );
  f.state.pins = { ...f.state.pins, guide_head_sha256: hash("9") };
  await rejects(
    () => f.service().execute(f.execute({ cursor: first.next_cursor }), f.boundary),
    "stale_cursor",
    409,
  );
});

Deno.test("quota missing, initial zero and final zero keep distinct meanings", async () => {
  const f = await fixture();
  f.state.scope = [quota("current-1", null)];
  let out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].recruitment.value, null);
  eq(out.items[0].recruitment.status, "pending_value_missing");
  eq(out.items[0].status, "pending");
  f.state.scope = [quota("current-1", 0)];
  out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].recruitment.value, 0);
  eq(out.items[0].recruitment.stage, "initial");
  eq(out.items[0].recruitment.source_stage, "initial");
  f.state.scope = [{
    ...quota("current-1", new JsonFloat("0.0e-900")),
    quota: {
      ...quota("current-1").quota!,
      value: new JsonFloat("0.0e-900"),
      stage: "final",
    },
  }];
  out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].status, "pending");
  eq(out.items[0].recruitment.status, "pending_finality");
  eq(out.items[0].recruitment.finality, "pending");
  eq(out.items[0].recruitment.stage, "unknown");
  eq(out.items[0].recruitment.source_stage, "final");
  eq(out.items[0].recruitment.value, 0);
  ok(
    nativeJsonText(await f.service().execute(f.execute(), f.boundary)).includes(
      "0.0e-900",
    ),
  );
  await rejects(
    () =>
      f.service({
        recruitment_evidence: {
          verify: () =>
            Promise.resolve([{
              target: target("current-1"),
              finality: "verified_final" as const,
              carryover_status: "not_applicable" as const,
            }]),
        },
      }).execute(f.execute(), f.boundary),
    "backend_dependency_unavailable",
    503,
  );
  f.state.scope = [{
    ...quota("current-1"),
    quota: {
      ...quota("current-1").quota!,
      value: new JsonFloat("1e-900"),
      stage: "final",
    },
  }];
  const retained = nativeJsonText(
    await f.service().execute(f.execute(), f.boundary),
  );
  ok(retained.includes("1e-900"));
});

Deno.test("only independently confirmed final stage can be public or used by a condition comparison", async () => {
  const f = await fixture();
  f.state.claims = [
    claim("one", previous("predecessor", "old-school"), "approved-proof"),
  ];
  f.state.scope = [{
    ...quota("current-1", 7),
    quota: { ...quota("current-1", 7).quota!, stage: "final" },
  }];
  const comparison = {
    compare: () => Promise.resolve([{ claim_id: "one", status: "changed" as const }]),
  };
  const pending = asJson(
    await f.service({ condition_comparisons: comparison }).execute(
      f.execute(),
      f.boundary,
    ),
  );
  eq(pending.items[0].recruitment.stage, "unknown");
  eq(pending.items[0].history.items[0].condition_comparison, "pending");
  const out = asJson(
    await f.service({
      condition_comparisons: comparison,
      recruitment_evidence: {
        verify: () =>
          Promise.resolve([{
            target: target("current-1"),
            finality: "verified_final" as const,
            carryover_status: "not_applicable" as const,
          }]),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].recruitment.value, 7);
  eq(out.items[0].recruitment.stage, "final");
  eq(out.items[0].recruitment.source_stage, "final");
  eq(out.items[0].history.items[0].condition_comparison, "changed");
});

Deno.test("condition comparison requires verified relation and evidence, no inference from text", async () => {
  const f = await fixture();
  f.state.claims = [
    claim("one", previous("predecessor", "old-school"), "approved-proof"),
  ];
  let out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].recruitment.condition_text, "original condition");
  eq(
    out.items[0].history.items[0].historical_condition.condition_text,
    "previous original condition",
  );
  eq(out.items[0].history.items[0].condition_comparison, "pending");
  out = asJson(
    await f.service({
      condition_comparisons: {
        compare: (_c, _q, claims) =>
          Promise.resolve(
            claims.map((c) => ({
              claim_id: c.claim_id,
              status: "changed" as const,
            })),
          ),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].history.items[0].condition_comparison, "changed");
  f.state.claims = [{ ...f.state.claims[0], historical_condition: null }];
  out = asJson(
    await f.service({
      condition_comparisons: {
        compare: () => Promise.resolve([{ claim_id: "one", status: "changed" as const }]),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].history.items[0].condition_comparison, "pending");
});

Deno.test("2024 or 2025 observations never substitute for the 2026 condition comparison", async () => {
  for (const year of [2024, 2025] as const) {
    const f = await fixture();
    const source: PhysicalKey = {
      release_id: `guide-${year}`,
      academic_year: year,
      offering_pk: `pre-${year}`,
      school_id: "old-school",
    };
    f.state.claims = [claim("older", source, "approved-proof")];
    f.state.relation = (c) =>
      c.relation_proof === "approved-proof" &&
        c.source.release_id === `guide-${year}` &&
        c.source.academic_year === year
        ? "VERIFIED"
        : "HOLD";
    for (const proposed of ["changed", "unchanged"] as const) {
      const out = asJson(
        await f.service({
          condition_comparisons: {
            compare: (_c, _q, claims) =>
              Promise.resolve(
                claims.map((c) => ({ claim_id: c.claim_id, status: proposed })),
              ),
          },
        }).execute(f.execute(), f.boundary),
      );
      const row = out.items[0].history.items[0];
      eq(row.academic_year, year);
      eq(row.condition_comparison, "pending");
      eq(row.metrics[0].status, "not_published");
      eq(out.items[0].offering.offering_id, "2027:current-1");
    }
  }
});

Deno.test("2026 relation HOLD cannot be replaced by a verified 2025 comparison", async () => {
  const f = await fixture();
  const older: PhysicalKey = {
    release_id: "guide-2025",
    academic_year: 2025,
    offering_pk: "pre-2025",
    school_id: "old-school",
  };
  f.state.claims = [
    claim("older", older, "approved-proof"),
    claim("previous", previous("pre-2026", "old-school"), "unapproved"),
  ];
  f.state.relation = (c) => c.claim_id === "older" ? "VERIFIED" : "HOLD";
  const out = asJson(
    await f.service({
      condition_comparisons: {
        compare: (_c, _q, claims) =>
          Promise.resolve(
            claims.map((c) => ({
              claim_id: c.claim_id,
              status: "changed" as const,
            })),
          ),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].history.status, "pending");
  eq(out.items[0].history.items.length, 1);
  eq(out.items[0].history.items[0].academic_year, 2025);
  eq(out.items[0].history.items[0].condition_comparison, "pending");
  eq(out.items[0].offering.offering_id, "2027:current-1");
});

Deno.test("only the approved 2026 crosswalk can finalize comparison while 2025 stays pending", async () => {
  const f = await fixture();
  const older: PhysicalKey = {
    release_id: "guide-2025",
    academic_year: 2025,
    offering_pk: "pre-2025",
    school_id: "old-school",
  };
  f.state.claims = [
    claim("older", older, "approved-proof"),
    claim("previous", previous("pre-2026", "old-school"), "approved-proof"),
  ];
  f.state.relation = (c) =>
    c.relation_proof === "approved-proof" &&
      c.source.school_id === "old-school" && c.target.school_id === "new-school"
      ? "VERIFIED"
      : "HOLD";
  const out = asJson(
    await f.service({
      condition_comparisons: {
        compare: (_c, _q, claims) =>
          Promise.resolve(
            claims.map((c) => ({
              claim_id: c.claim_id,
              status: "changed" as const,
            })),
          ),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].history.items.length, 2);
  eq(out.items[0].history.items[0].academic_year, 2025);
  eq(out.items[0].history.items[0].condition_comparison, "pending");
  eq(out.items[0].history.items[1].academic_year, 2026);
  eq(out.items[0].history.items[1].university_id, "old-school");
  eq(out.items[0].history.items[1].condition_comparison, "changed");
});

Deno.test("multiple 2026 predecessors retain independent comparison and HOLD states", async () => {
  const f = await fixture();
  f.state.claims = [
    claim("pre-a", previous("pre-a", "old-school"), "approved-proof"),
    claim("pre-b", previous("pre-b", "new-school"), "approved-proof"),
  ];
  f.state.meaning = () => ({
    relationship_kind: "merge",
    observation_use: "individual_result",
    origin_verification: "single_original_verified",
    published_score_individual_inference_allowed: true,
  });
  const comparison = {
    compare: (_c: unknown, _q: unknown, claims: readonly HistoryClaim[]) =>
      Promise.resolve(
        claims.map((c) => ({
          claim_id: c.claim_id,
          status: c.claim_id === "pre-a" ? "changed" as const : "unchanged" as const,
        })),
      ),
  };
  let out = asJson(
    await f.service({ condition_comparisons: comparison }).execute(
      f.execute(),
      f.boundary,
    ),
  );
  eq(out.items[0].history.items.length, 2);
  eq(out.items[0].history.items[0].condition_comparison, "changed");
  eq(out.items[0].history.items[1].condition_comparison, "unchanged");
  f.state.relation = (c) => c.claim_id === "pre-b" ? "HOLD" : "VERIFIED";
  out = asJson(
    await f.service({ condition_comparisons: comparison }).execute(
      f.execute(),
      f.boundary,
    ),
  );
  eq(out.items[0].history.status, "pending");
  eq(out.items[0].history.items.length, 1);
  eq(out.items[0].history.items[0].condition_comparison, "changed");
});

Deno.test("score null reasons attach only to the exact verified metric slot", async () => {
  const f = await fixture();
  const first = claim(
    "one",
    previous("predecessor", "old-school"),
    "approved-proof",
  );
  f.state.claims = [{
    ...first,
    metrics: [first.metrics[0], {
      ...first.metrics[0],
      cohort: "other cohort",
    }],
  }];
  let out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(
    out.items[0].history.items[0].metrics[0].verified_score_null_reasons.length,
    0,
  );
  out = asJson(
    await f.service({
      score_reasons: {
        project: () =>
          Promise.resolve([{
            claim_id: "one",
            metric_index: 1,
            field: "final_70_percent_cut",
            reasons: ["three_or_fewer"],
          }]),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(
    out.items[0].history.items[0].metrics[0].verified_score_null_reasons.length,
    0,
  );
  eq(
    out.items[0].history.items[0].metrics[1].verified_score_null_reasons[0],
    "three_or_fewer",
  );
  await rejects(
    () =>
      f.service({
        score_reasons: {
          project: () =>
            Promise.resolve([{
              claim_id: "one",
              metric_index: 0,
              field: "final_50_percent_cut",
              reasons: ["three_or_fewer"],
            }]),
        },
      }).execute(f.execute(), f.boundary),
    "backend_dependency_unavailable",
    503,
  );
});

Deno.test("preserve native quota missingness and public year, basis and simulation metadata", async () => {
  const f = await fixture();
  f.state.scope = [{
    ...quota("current-1", null),
    quota: {
      ...quota("current-1", null).quota!,
      source_quota: {
        quota_value: null,
        quota_literal_state: "json_null",
        quota_cell: null,
      },
    },
  }];
  const first = claim(
    "one",
    previous("predecessor", "old-school"),
    "approved-proof",
  );
  f.state.claims = [{
    ...first,
    metrics: [{
      field: "alternate_cut",
      value: new JsonFloat("12.50"),
      status: "pending_metadata",
      unit: "points",
      reason_code: "pending_metadata",
      source_context: null,
      statistic_label: "synthetic cut",
      cohort: "cohort A",
      source_url: "https://example.test/source",
      source_as_of: "2026-10-01T10:11:12Z",
      statistic_percent: 70,
      basis_code: "basis-A",
      cohort_code: "cohort-A",
      score_calculation_context: {
        source_result_year: 2026,
        score_calculation_year: 2026,
        observation_role: "actual_result",
      },
      entries: [{
        value: "12.50",
        status: "pending_metadata",
        reason_code: "pending_metadata",
        unit: "points",
        source_context: {
          observation_id: "observation:" + hash("a"),
          identity_variant_index: 0,
          scope_status: "source_consistent",
        },
        statistic_label: "synthetic alternate",
        cohort: "cohort A",
        source_url: "https://example.test/source",
        source_as_of: "2026-10-01",
        score_calculation_context: {
          source_result_year: 2026,
          score_calculation_year: 2027,
          observation_role: "prior_year_recalculated_reference",
        },
        publication_context: {
          publication_role: "simulation_reference",
          simulation_target_academic_year: 2028,
        },
      }],
      omitted_other_basis_count: 3,
    }],
  }];
  const rendered = nativeJsonText(
    await f.service().execute(f.execute(), f.boundary),
  );
  const out = JSON.parse(rendered);
  eq(out.items[0].recruitment.source_quota.quota_value, null);
  eq(out.items[0].recruitment.source_quota.quota_literal_state, "json_null");
  ok(!Object.hasOwn(out.items[0].recruitment.source_quota, "quota_stage"));
  eq(out.items[0].recruitment.source_quota.quota_cell, null);
  const metric = out.items[0].history.items[0].metrics[0];
  ok(rendered.includes("12.50"));
  eq(metric.statistic_percent, 70);
  eq(metric.basis_code, "basis-A");
  eq(metric.score_calculation_context.source_result_year, 2026);
  eq(metric.score_calculation_context.score_calculation_year, 2026);
  eq(metric.entries[0].score_calculation_context.score_calculation_year, 2027);
  eq(
    metric.entries[0].publication_context.simulation_target_academic_year,
    2028,
  );
  eq(metric.entries[0].reason_code, "pending_metadata");
  eq(metric.entries[0].source_context.identity_variant_index, 0);
  eq(metric.omitted_other_basis_count, 3);
  eq(metric.status, "pending_metadata");
  eq(out.items[0].history.status, "pending");
  ok(!Object.hasOwn(metric, "basis_label"));
});

Deno.test("public nested source URLs cannot expose private endpoints or signatures", async () => {
  const f = await fixture();
  for (
    const url of [
      "https://tenant.supabase.co/storage/v1/object/a",
      "http://127.0.0.1/source",
      "https://example.test/data?X-Amz-Signature=synthetic",
      "https://example.test/data#token=synthetic",
    ]
  ) {
    f.state.scope = [{
      ...quota("current-1"),
      quota: { ...quota("current-1").quota!, source_url: url },
    }];
    await rejects(
      () => f.service().execute(f.execute(), f.boundary),
      "backend_dependency_unavailable",
      503,
    );
  }
});

Deno.test("native quota scalar types survive before serialization", async () => {
  const f = await fixture();
  for (const value of ["5", 5, 5n, new JsonFloat("5.00"), null]) {
    f.state.scope = [quota("current-1", value)];
    const result = await f.service().execute(f.execute(), f.boundary);
    const items = result.items as Array<{ recruitment: { value: unknown } }>;
    const actual = items[0].recruitment.value;
    if (value instanceof JsonFloat) {
      ok(actual instanceof JsonFloat);
      eq(actual.lexeme, "5.00");
    } else {
      eq(typeof actual, typeof value);
      eq(actual, value);
    }
  }
});

Deno.test("independently verified unresolved carryover is preserved alongside numeric initial quota", async () => {
  const f = await fixture();
  f.state.scope = [quota("current-1", 5)];
  let out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].recruitment.value, 5);
  eq(out.items[0].recruitment.carryover_status, "unknown");
  out = asJson(
    await f.service({
      recruitment_evidence: {
        verify: () =>
          Promise.resolve([{
            target: target("current-1"),
            finality: "pending" as const,
            carryover_status: "unresolved" as const,
          }]),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].recruitment.value, 5);
  eq(out.items[0].recruitment.stage, "initial");
  eq(out.items[0].recruitment.carryover_status, "unresolved");
  eq(out.items[0].status, "pending");
});

Deno.test("unresolved carryover overrides claimed finality per row for zero and positive quotas", async () => {
  for (const condition of ["none", "conditional"] as const) {
    for (const value of [0, 7]) {
      const f = await fixture();
      f.state.rows.push(offering("current-2"));
      const base = quota("current-1", value).quota!;
      f.state.scope = [{
        target: target("current-1"),
        decision: "INCLUDE",
        quota: {
          ...base,
          stage: "final",
          condition,
          condition_text: condition === "none" ? null : base.condition_text,
        },
      }, quota("current-2", 5)];
      f.state.complete.push(target("current-2"));
      f.state.claims = [
        claim("one", previous("first", "old-school"), "approved-proof"),
        claim(
          "two",
          previous("second", "old-school"),
          "approved-proof",
          "current-2",
        ),
      ];
      const out = asJson(
        await f.service({
          recruitment_evidence: {
            verify: () =>
              Promise.resolve([
                {
                  target: target("current-1"),
                  finality: "verified_final" as const,
                  carryover_status: "unresolved" as const,
                },
                {
                  target: target("current-2"),
                  finality: "pending" as const,
                  carryover_status: "not_applicable" as const,
                },
              ]),
          },
          condition_comparisons: {
            compare: (_c, _q, claims) =>
              Promise.resolve(
                claims.map((c) => ({
                  claim_id: c.claim_id,
                  status: "changed" as const,
                })),
              ),
          },
        }).execute(f.execute(), f.boundary),
      );
      eq(out.status, "pending");
      eq(out.items[0].status, "pending");
      eq(out.items[0].recruitment.value, value);
      eq(out.items[0].recruitment.stage, "unknown");
      eq(out.items[0].recruitment.source_stage, "final");
      eq(out.items[0].recruitment.finality, "pending");
      eq(out.items[0].history.items[0].condition_comparison, "pending");
      eq(out.items[1].status, "ready");
      eq(out.items[1].recruitment.value, 5);
      eq(out.items[1].history.items[0].condition_comparison, "changed");
    }
  }
});

Deno.test("source quota conflicts hold only the affected row without discarding either value", async () => {
  const cases = [
    {
      quota_value: 8,
      quota_stage: "initial",
      quota_condition_text: "original condition",
      quota_literal_state: "numeric_literal",
    },
    {
      quota_value: 7,
      quota_stage: "final",
      quota_condition_text: "original condition",
      quota_literal_state: "numeric_literal",
    },
    {
      quota_value: 7,
      quota_stage: "initial",
      quota_condition_text: "different condition",
      quota_literal_state: "numeric_literal",
    },
    {
      quota_value: "not-numeric",
      quota_stage: "initial",
      quota_condition_text: "original condition",
      quota_literal_state: "numeric_literal",
    },
  ];
  for (const source of cases) {
    const f = await fixture();
    f.state.rows.push(offering("current-2"));
    f.state.scope = [{
      target: target("current-1"),
      decision: "INCLUDE",
      quota: { ...quota("current-1", 7).quota!, source_quota: source },
    }, quota("current-2", 5)];
    f.state.complete.push(target("current-2"));
    f.state.claims = [
      claim("one", previous("first", "old-school"), "approved-proof"),
      claim(
        "two",
        previous("second", "old-school"),
        "approved-proof",
        "current-2",
      ),
    ];
    const out = asJson(
      await f.service({
        condition_comparisons: {
          compare: (_c, _q, claims) =>
            Promise.resolve(
              claims.map((c) => ({
                claim_id: c.claim_id,
                status: "changed" as const,
              })),
            ),
        },
      }).execute(f.execute(), f.boundary),
    );
    eq(out.items[0].status, "pending");
    eq(out.items[0].recruitment.status, "pending_source_conflict");
    eq(out.items[0].recruitment.stage, "unknown");
    eq(out.items[0].recruitment.value, 7);
    eq(out.items[0].recruitment.source_quota.quota_value, source.quota_value);
    eq(out.items[0].recruitment.source_stage, source.quota_stage);
    eq(out.items[0].recruitment.decision_stage, "initial");
    eq(out.items[0].history.items[0].condition_comparison, "pending");
    eq(out.items[1].status, "ready");
    eq(out.items[1].history.items[0].condition_comparison, "changed");
  }
});

Deno.test("conflicting original stage prevents final zero exclusion without blocking another row", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope = [{
    target: target("current-1"),
    decision: "INCLUDE",
    quota: {
      ...quota("current-1", 0).quota!,
      stage: "final",
      condition: "none",
      condition_text: null,
      source_quota: {
        quota_value: 0,
        quota_stage: "initial",
        quota_literal_state: "numeric_literal",
      },
    },
  }, quota("current-2", 5)];
  f.state.complete.push(target("current-2"));
  const out = asJson(
    await f.service({
      recruitment_evidence: {
        verify: () =>
          Promise.resolve([{
            target: target("current-1"),
            finality: "verified_final" as const,
            carryover_status: "not_applicable" as const,
          }]),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].status, "pending");
  eq(out.items[0].recruitment.status, "pending_source_conflict");
  eq(out.items[0].recruitment.stage, "unknown");
  eq(out.items[0].recruitment.value, 0);
  eq(out.items[0].recruitment.source_stage, "initial");
  eq(out.items[0].recruitment.decision_stage, "final");
  eq(out.items[1].status, "ready");
  eq(out.items[1].recruitment.value, 5);
});

Deno.test("conditional source literal cannot be projected as definitely unconditional", async () => {
  const f = await fixture();
  f.state.scope = [{
    target: target("current-1"),
    decision: "INCLUDE",
    quota: {
      ...quota("current-1", 7).quota!,
      condition: "none",
      condition_text: null,
      source_quota: {
        quota_value: 7,
        quota_stage: "initial",
        quota_literal_state: "conditional_carryover",
      },
    },
  }];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].status, "pending");
  eq(out.items[0].recruitment.condition, "unknown");
  eq(out.items[0].recruitment.decision_condition, "none");
  eq(
    out.items[0].recruitment.source_quota.quota_literal_state,
    "conditional_carryover",
  );
});

Deno.test("independently verified final zero is filtered before pagination while initial zero remains", async () => {
  const f = await fixture();
  const source = [{ row: offering("current-1"), verifiedFinalZero: true }, {
    row: offering("current-2"),
    verifiedFinalZero: false,
  }];
  f.state.scope = [quota("current-2", 0)];
  f.state.complete = [target("current-2")];
  const offerings = {
    page: () =>
      Promise.resolve({
        items: source.filter((x) => !x.verifiedFinalZero).map((x) => x.row),
        next_position: null,
        incomplete_before: false,
      }),
  };
  const out = asJson(
    await f.service({ offerings }).execute(f.execute(), f.boundary),
  );
  eq(out.items.length, 1);
  eq(out.items[0].offering.offering_id, "2027:current-2");
  eq(out.items[0].recruitment.stage, "initial");
  eq(out.items[0].recruitment.value, 0);
  eq(out.items[0].status, "ready");
});

Deno.test("official quota without unit, source or date remains pending per row", async () => {
  for (const missing of ["unit", "source_url", "source_as_of"] as const) {
    const f = await fixture();
    f.state.rows.push(offering("current-2"));
    f.state.scope = [{
      target: target("current-1"),
      decision: "INCLUDE",
      quota: { ...quota("current-1", 0).quota!, [missing]: null },
    }, quota("current-2", 5)];
    f.state.complete.push(target("current-2"));
    const out = asJson(await f.service().execute(f.execute(), f.boundary));
    eq(out.items[0].status, "pending");
    eq(out.items[0].recruitment.status, "pending_metadata");
    eq(out.items[0].recruitment.stage, "unknown");
    eq(out.items[0].recruitment.value, 0);
    eq(out.items[1].status, "ready");
    eq(out.items[1].recruitment.value, 5);
  }
});

Deno.test("a final zero without required official metadata is not a verified exclusion", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope = [{
    target: target("current-1"),
    decision: "INCLUDE",
    quota: {
      ...quota("current-1", 0).quota!,
      stage: "final",
      condition: "none",
      condition_text: null,
      unit: null,
    },
  }, quota("current-2", null)];
  f.state.complete.push(target("current-2"));
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].status, "pending");
  eq(out.items[0].recruitment.status, "pending_metadata");
  eq(out.items[0].recruitment.stage, "unknown");
  eq(out.items[0].recruitment.value, 0);
  eq(out.items[1].status, "pending");
  eq(out.items[1].recruitment.value, null);
  eq(out.items[1].recruitment.status, "pending_value_missing");
});

Deno.test("official status with a null value is held per row without inventing zero", async () => {
  const f = await fixture();
  f.state.rows.push(offering("current-2"));
  f.state.scope = [{
    target: target("current-1"),
    decision: "INCLUDE",
    quota: { ...quota("current-1", null).quota!, status: "verified_official" },
  }, quota("current-2", 5)];
  f.state.complete.push(target("current-2"));
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].status, "pending");
  eq(out.items[0].recruitment.value, null);
  eq(out.items[0].recruitment.status, "pending_metadata");
  eq(out.items[0].recruitment.source_status, "verified_official");
  eq(out.items[1].status, "ready");
  eq(out.items[1].recruitment.value, 5);
});

Deno.test("request query and operation cannot change after admission", async () => {
  const f = await fixture();
  const query: Record<string, string> = { region: "original" };
  const request = f.execute(query);
  f.state.beforePage = () => {
    query.region = "changed";
  };
  await rejects(
    () => f.service().execute(request, f.boundary),
    "backend_dependency_unavailable",
    503,
  );
});

Deno.test("later trusted-port calls cannot mutate the already captured metric and source quota", async () => {
  const f = await fixture();
  const c = claim(
    "one",
    previous("predecessor", "old-school"),
    "approved-proof",
  );
  const metric = { ...c.metrics[0] };
  f.state.claims = [{ ...c, metrics: [metric] }];
  const q = { ...quota("current-1").quota! };
  f.state.scope = [{
    target: target("current-1"),
    decision: "INCLUDE",
    quota: q,
  }];
  const out = asJson(
    await f.service({
      score_reasons: {
        project: () => {
          metric.cohort = "mutated after verification";
          q.condition_text = "mutated condition";
          return Promise.resolve([]);
        },
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items[0].history.items[0].metrics[0].cohort, "synthetic cohort");
  eq(out.items[0].recruitment.condition_text, "original condition");
});

Deno.test("bounded page and exclusion are checked without draining pages", async () => {
  const f = await fixture();
  f.state.next = "next";
  f.state.beforePage = (q) => eq(q.limit, 100);
  const out = asJson(
    await f.service().execute(f.execute({ limit: "100" }), f.boundary),
  );
  ok(out.next_cursor);
  eq(f.state.counts.page, 1);
  eq(out.matching_count, null);
  await rejects(
    () => f.service().execute(f.execute({ limit: "101" }), f.boundary),
    "invalid_request",
    422,
  );
  await rejects(
    () => f.service().execute(f.execute({ cursor: "" }), f.boundary),
    "invalid_request",
    422,
  );
  f.state.beforePage = undefined;
  f.state.scope = [{
    target: target("current-1"),
    decision: "EXCLUDE",
    quota: null,
  }];
  await rejects(
    () => f.service().execute(f.execute(), f.boundary),
    "backend_dependency_unavailable",
    503,
  );
});

Deno.test("reject stale admission-time heads and incorrect physical target school", async () => {
  const f = await fixture();
  f.state.pins = { ...f.state.pins, expires_at_utc: NOW };
  await rejects(
    () => f.service().execute(f.execute(), f.boundary),
    "backend_dependency_unavailable",
    503,
  );
  f.state.pins = { ...f.state.pins, expires_at_utc: NOW + 50000000n };
  f.state.scope = [{
    ...quota("current-1"),
    target: target("current-1", "different-school"),
  }];
  await rejects(
    () => f.service().execute(f.execute(), f.boundary),
    "backend_dependency_unavailable",
    503,
  );
  f.state.scope = [quota("current-1")];
  f.setNow(NOW + 100000001n);
  await rejects(
    () => f.service().execute(f.execute(), f.boundary),
    "authentication_required",
    401,
  );
});

Deno.test("public snapshot reason and source context survive on cells without inventing score reasons", async () => {
  const f = await fixture();
  const first = claim(
    "reason",
    previous("predecessor", "old-school"),
    "approved-proof",
  );
  const context = {
    observation_id: "admission:" + hash("b"),
    identity_variant_index: 15,
    scope_status: "review_pending" as const,
  };
  f.state.claims = [{
    ...first,
    metrics: [{
      ...first.metrics[0],
      reason_code: "synthetic_not_released",
      source_context: context,
    }],
  }];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  const metric = out.items[0].history.items[0].metrics[0];
  eq(metric.reason_code, "synthetic_not_released");
  eq(metric.source_context.observation_id, context.observation_id);
  eq(metric.source_context.identity_variant_index, 15);
  eq(metric.source_context.scope_status, "review_pending");
  eq(metric.verified_score_null_reasons.length, 0);
  eq(metric.value, null);
  eq(metric.status, "not_published");
});

Deno.test("alternate cut entries and omitted count retain independent native values and exact public cells", async () => {
  const f = await fixture();
  const first = claim(
    "alternate",
    previous("predecessor", "old-school"),
    "approved-proof",
  );
  const sourceContext = {
    observation_id: "observation:" + hash("a"),
    identity_variant_index: 1,
    scope_status: "source_consistent" as const,
  };
  const cell = {
    status: "pending_metadata" as const,
    reason_code: "synthetic_metadata",
    unit: "points",
    statistic_label: "synthetic score",
    cohort: "synthetic cohort",
    source_url: "https://example.test/source",
    source_as_of: "2026-10-01",
    source_context: sourceContext,
    statistic_percent: 70,
    basis_code: "synthetic-basis",
    basis_label: "synthetic basis",
    cohort_code: "synthetic-cohort",
    cohort_label: "synthetic cohort",
    selection_rule_ref: "synthetic-rule",
  };
  f.state.claims = [{
    ...first,
    metrics: [{
      ...cell,
      field: "alternate_cut",
      value: null,
      entries: [
        { ...cell, value: 0 },
        { ...cell, value: 0n },
        { ...cell, value: "12.50" },
        { ...cell, value: new JsonFloat("12.50") },
        {
          ...cell,
          value: null,
          status: "not_published",
          reason_code: "synthetic_unpublished",
          source_context: null,
        },
      ],
      omitted_other_basis_count: 2,
    }],
  }];
  const result = await f.service().execute(f.execute(), f.boundary);
  const metric = (result.items as unknown as Array<{
    history: {
      items: Array<{
        metrics: Array<{
          reason_code: string;
          entries: Array<
            {
              value: unknown;
              reason_code: string;
              source_context: { observation_id: string } | null;
            }
          >;
          omitted_other_basis_count: number;
        }>;
      }>;
    };
  }>)[0].history.items[0].metrics[0];
  eq(metric.reason_code, "synthetic_metadata");
  eq(metric.entries.length, 5);
  eq(metric.entries[0].value, 0);
  eq(metric.entries[1].value, 0n);
  eq(metric.entries[2].value, "12.50");
  ok(metric.entries[3].value instanceof JsonFloat);
  eq(metric.entries[3].value.lexeme, "12.50");
  eq(metric.entries[4].value, null);
  eq(metric.entries[4].reason_code, "synthetic_unpublished");
  eq(metric.entries[4].source_context, null);
  eq(
    metric.entries[2].source_context?.observation_id,
    sourceContext.observation_id,
  );
  eq(metric.omitted_other_basis_count, 2);
  ok(!Object.hasOwn(metric.entries[0], "field"));
  ok(!Object.hasOwn(metric.entries[0], "verified_score_null_reasons"));
  const rendered = nativeJsonText(result);
  ok(rendered.includes('"value":12.50'));
  ok(rendered.includes('"value":"12.50"'));
});

Deno.test("missing snapshot public reasons, invalid source contexts and unbounded alternate entries fail closed", async () => {
  const f = await fixture();
  const first = claim(
    "invalid-cell",
    previous("predecessor", "old-school"),
    "approved-proof",
  );
  const base = first.metrics[0];
  const invalid: unknown[] = [
    { ...base, reason_code: null },
    { ...base, reason_code: "   " },
    { ...base, reason_code: undefined },
    {
      ...base,
      source_context: {
        observation_id: "private-source",
        identity_variant_index: 0,
        scope_status: "source_consistent",
      },
    },
    {
      ...base,
      source_context: {
        observation_id: "observation:" + hash("a"),
        identity_variant_index: 16,
        scope_status: "source_consistent",
      },
    },
    {
      ...base,
      source_context: {
        observation_id: "observation:" + hash("a"),
        identity_variant_index: 0,
        scope_status: "source_consistent",
        secret: "not-public",
      },
    },
    {
      ...base,
      field: "alternate_cut",
      entries: [],
      omitted_other_basis_count: -1,
    },
    {
      ...base,
      field: "alternate_cut",
      entries: Array(17).fill(base),
      omitted_other_basis_count: 0,
    },
    {
      ...base,
      field: "alternate_cut",
      entries: [],
      omitted_other_basis_count: null,
    },
    { ...base, field: "final_70_percent_cut", entries: [] },
    {
      ...base,
      field: "alternate_cut",
      entries: [{ ...base, value: 0, source_context: null }],
      omitted_other_basis_count: 0,
    },
  ];
  for (const item of invalid) {
    f.state.claims = [{ ...first, metrics: [item as typeof base] }];
    await rejects(
      () => f.service().execute(f.execute(), f.boundary),
      "backend_dependency_unavailable",
      503,
    );
  }
});

Deno.test("a later authority callback cannot mutate a captured alternate public cell", async () => {
  const f = await fixture();
  const first = claim(
    "capture-alternate",
    previous("predecessor", "old-school"),
    "approved-proof",
  );
  const sourceContext = {
    observation_id: "observation:" + hash("a"),
    identity_variant_index: 0,
    scope_status: "source_consistent" as const,
  };
  const entry = {
    ...first.metrics[0],
    value: null,
    source_context: sourceContext,
    reason_code: "original-reason",
  };
  const alternate = {
    ...first.metrics[0],
    field: "alternate_cut" as const,
    entries: [entry],
    omitted_other_basis_count: 0,
  };
  f.state.claims = [{ ...first, metrics: [alternate] }];
  const prior = f.ports.authority!;
  const result = await f.service({
    authority: {
      ...prior,
      verifyRelations: async (ctx, claims) => {
        entry.reason_code = "later-mutated";
        return await prior.verifyRelations(ctx, claims);
      },
    },
  }).execute(f.execute(), f.boundary);
  const metric = asJson(result).items[0].history.items[0].metrics[0];
  eq(metric.entries[0].reason_code, "original-reason");
  eq(metric.omitted_other_basis_count, 0);
});

Deno.test("a composite Guide head accepts verified distinct keys from multiple releases", async () => {
  const f = await fixture();
  const keyA = target("first-pk");
  const keyB = { ...target("second-pk"), release_id: "guide-27-b" };
  f.state.rows = [
    { ...offering("first-pk"), key: keyA },
    { ...offering("second-pk"), key: keyB },
  ];
  f.state.scope = [
    { ...quota("first-pk", 0), target: keyA },
    { ...quota("second-pk", 7), target: keyB },
  ];
  f.state.complete = [keyA, keyB];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items.length, 2);
  eq(out.items[0].recruitment.value, 0);
  eq(out.items[1].recruitment.value, 7);
  eq(f.state.counts.page, 1);
  eq(f.state.counts.history, 1);
});

Deno.test("an unknown release is held without blocking confirmed rows, and missing authority fails closed", async () => {
  const f = await fixture();
  f.state.rows = [
    {
      ...offering("uncertain"),
      key: { ...target("uncertain"), release_id: "outsider" },
    },
    offering("current-1"),
  ];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items.length, 2);
  eq(out.items[0].status, "pending");
  eq(out.items[0].offering, null);
  eq(out.items[1].offering.offering_id, "2027:current-1");
  eq(out.items[1].recruitment.value, 5);
  const authority = {
    ...f.ports.authority!,
    classifyGuideMembership: undefined,
  } as unknown as NonNullable<CurrentPagePorts["authority"]>;
  await rejects(
    () => f.service({ authority }).execute(f.execute(), f.boundary),
    "security_policy_unavailable",
    503,
  );
});

Deno.test("same public ID across releases becomes one anonymous pending target without blocking another", async () => {
  const f = await fixture();
  const a = target("same-pk");
  const b = { ...target("same-pk"), release_id: "guide-27-b" };
  f.state.rows = [
    { ...offering("same-pk"), key: a },
    { ...offering("same-pk"), key: b },
    offering("current-1"),
  ];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items.length, 2);
  eq(out.items[0].status, "pending");
  eq(out.items[0].offering, null);
  eq(out.items[0].recruitment, null);
  eq(out.items[1].offering.offering_id, "2027:current-1");
  eq(out.items[1].recruitment.value, 5);
  eq(f.state.counts.history, 1);
});

Deno.test("a head-wide collision returned as membership HOLD does not disclose or suppress the other row", async () => {
  const f = await fixture();
  f.state.rows = [offering("ambiguous-other-page"), offering("current-1")];
  const authority = f.ports.authority!;
  const out = asJson(
    await f.service({
      authority: {
        ...authority,
        classifyGuideMembership: (_ctx, keys) =>
          Promise.resolve(keys.map((key) => ({
            target: key,
            decision: key.offering_pk === "ambiguous-other-page" ? "HOLD" : "VERIFIED",
          }))),
      },
    }).execute(f.execute(), f.boundary),
  );
  eq(out.items.length, 2);
  eq(out.items[0].status, "pending");
  eq(out.items[0].offering, null);
  eq(out.items[1].offering.offering_id, "2027:current-1");
});

Deno.test("membership decisions must bind every exact key once and cannot be invented", async () => {
  const f = await fixture();
  const authority = f.ports.authority!;
  for (
    const classify of [
      () => Promise.resolve([]),
      (_ctx: unknown, keys: readonly PhysicalKey[]) =>
        Promise.resolve([
          {
            target: { ...keys[0], school_id: "wrong-school" },
            decision: "VERIFIED" as const,
          },
        ]),
      (_ctx: unknown, keys: readonly PhysicalKey[]) =>
        Promise.resolve([
          { target: keys[0], decision: "MAYBE" as "VERIFIED" },
        ]),
    ]
  ) {
    await rejects(
      () =>
        f.service({
          authority: { ...authority, classifyGuideMembership: classify },
        }).execute(f.execute(), f.boundary),
      "backend_dependency_unavailable",
      503,
    );
  }
});

Deno.test("structured condition is never inferred from source text and unknown affects only its own row", async () => {
  const f = await fixture();
  f.state.rows = [offering("current-1"), offering("current-2")];
  f.state.complete = [target("current-1"), target("current-2")];
  f.state.scope = [
    {
      ...quota("current-1", 3),
      quota: {
        ...quota("current-1", 3).quota!,
        condition: "none",
        condition_text: "general source information",
        source_quota: { quota_condition_text: "general source information" },
      },
    },
    {
      ...quota("current-2", 4),
      quota: {
        ...quota("current-2", 4).quota!,
        condition: "unknown",
        condition_text: "general source information",
        source_quota: { quota_condition_text: "general source information" },
      },
    },
  ];
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].status, "ready");
  eq(out.items[0].recruitment.condition, "none");
  eq(out.items[0].recruitment.condition_text, "general source information");
  eq(out.items[1].status, "pending");
  eq(out.items[1].recruitment.condition, "unknown");
  eq(out.items[1].recruitment.value, 4);
  f.state.scope[1] = {
    ...quota("current-2", 4),
    quota: {
      ...quota("current-2", 4).quota!,
      condition: "conditional",
      condition_text: null,
      source_quota: { quota_condition_text: null },
    },
  };
  const classified = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(classified.items[1].recruitment.condition, "conditional");
  eq(classified.items[1].recruitment.condition_text, null);
  eq(classified.items[0].status, "ready");
});

Deno.test("all final stages need independent finality and carryover evidence, never inferred from general text or numeric literal", async () => {
  for (const condition of ["none", "conditional", "unknown"] as const) {
    for (const value of [0, 7, null]) {
      const f = await fixture();
      f.state.rows = [offering("current-1"), offering("current-2")];
      f.state.scope = [
        {
          ...quota("current-1", value),
          quota: {
            ...quota("current-1", value).quota!,
            stage: "final",
            condition,
            condition_text: "general source information",
            source_quota: {
              quota_value: value,
              quota_literal_state: value === null ? "json_null" : "numeric_literal",
              quota_stage: "final",
              quota_condition_text: "general source information",
            },
          },
        },
        quota("current-2", 0),
      ];
      f.state.complete = [target("current-1"), target("current-2")];
      f.state.claims = [
        claim("old", previous("old", "old-school"), "approved-proof"),
      ];
      const compare = {
        compare: () => Promise.resolve([{ claim_id: "old", status: "changed" as const }]),
      };
      for (
        const evidence of [
          undefined,
          {
            finality: "verified_final" as const,
            carryover_status: "unknown" as const,
          },
          {
            finality: "verified_final" as const,
            carryover_status: "unresolved" as const,
          },
          {
            finality: "pending" as const,
            carryover_status: "confirmed" as const,
          },
        ]
      ) {
        const opts = evidence
          ? {
            condition_comparisons: compare,
            recruitment_evidence: {
              verify: () => Promise.resolve([{ target: target("current-1"), ...evidence }]),
            },
          }
          : { condition_comparisons: compare };
        const out = asJson(
          await f.service(opts).execute(f.execute(), f.boundary),
        );
        eq(out.items[0].status, "pending");
        eq(out.items[0].recruitment.value, value);
        eq(out.items[0].recruitment.stage, "unknown");
        eq(out.items[0].recruitment.finality, "pending");
        eq(out.items[0].history.items[0].condition_comparison, "pending");
        eq(out.items[1].status, "ready");
        eq(out.items[1].recruitment.stage, "initial");
        eq(out.items[1].recruitment.value, 0);
      }
    }
  }
});

Deno.test("verified final positive values remain available when independent rollover is confirmed or not applicable", async () => {
  for (const carryover of ["confirmed", "not_applicable"] as const) {
    const f = await fixture();
    f.state.scope = [{
      ...quota("current-1", 7),
      quota: {
        ...quota("current-1", 7).quota!,
        stage: "final",
        condition: "none",
        condition_text: "general source information",
      },
    }];
    const out = asJson(
      await f.service({
        recruitment_evidence: {
          verify: () =>
            Promise.resolve([{
              target: target("current-1"),
              finality: "verified_final" as const,
              carryover_status: carryover,
            }]),
        },
      }).execute(f.execute(), f.boundary),
    );
    eq(out.items[0].status, "ready");
    eq(out.items[0].recruitment.value, 7);
    eq(out.items[0].recruitment.stage, "final");
    eq(out.items[0].recruitment.finality, "verified_final");
  }
});

Deno.test("same-year verified predecessors keep individual/shared meanings and cohorts while only an unverified relation is held", async () => {
  const f = await fixture();
  const a = claim(
    "prior-a",
    previous("predecessor-a", "old-school"),
    "approved-proof",
  );
  const b = claim(
    "prior-b",
    previous("predecessor-b", "old-school"),
    "approved-proof",
  );
  const held = claim(
    "prior-held",
    previous("predecessor-c", "old-school"),
    "approved-proof",
  );
  f.state.claims = [
    { ...a, metrics: [{ ...a.metrics[0], cohort: "synthetic cohort A" }] },
    { ...b, metrics: [{ ...b.metrics[0], cohort: "synthetic cohort B" }] },
    {
      ...held,
      metrics: [{ ...held.metrics[0], cohort: "synthetic cohort C" }],
    },
  ];
  f.state.relation = (c) => c.claim_id === "prior-held" ? "HOLD" : "VERIFIED";
  f.state.meaning = (c) =>
    c.claim_id === "prior-b"
      ? {
        relationship_kind: "merge",
        observation_use: "shared_reference",
        origin_verification: "single_original_verified",
        published_score_individual_inference_allowed: false,
      }
      : {
        relationship_kind: "merge",
        observation_use: "individual_result",
        origin_verification: "single_original_verified",
        published_score_individual_inference_allowed: true,
      };
  const out = asJson(await f.service().execute(f.execute(), f.boundary));
  eq(out.items[0].offering.offering_id, "2027:current-1");
  eq(out.items[0].recruitment.value, 5);
  eq(out.items[0].history.status, "pending");
  eq(out.items[0].history.items.length, 2);
  eq(out.items[0].history.items[0].academic_year, 2026);
  eq(out.items[0].history.items[1].academic_year, 2026);
  eq(out.items[0].history.items[0].offering_id, "2026:predecessor-a");
  eq(out.items[0].history.items[1].offering_id, "2026:predecessor-b");
  eq(out.items[0].history.items[0].observation_use, "individual_result");
  eq(out.items[0].history.items[1].observation_use, "shared_reference");
  eq(
    out.items[0].history.items[1].published_score_individual_inference_allowed,
    false,
  );
  eq(out.items[0].history.items[0].metrics[0].cohort, "synthetic cohort A");
  eq(out.items[0].history.items[1].metrics[0].cohort, "synthetic cohort B");
});

Deno.test("confirmed current recruitment keeps its own numeric literal or null without inventing stage or borrowing old values", async () => {
  for (const value of [0, 7, null]) {
    const f = await fixture();
    f.state.rows = [offering("current-1"), offering("current-2")];
    f.state.scope = [
      {
        ...quota("current-1", value),
        quota: {
          ...quota("current-1", value).quota!,
          stage: "unknown",
          condition: "unknown",
          condition_text: "unclassified original source condition",
          source_quota: {
            quota_value: value,
            quota_literal_state: value === null ? "json_null" : "numeric_literal",
            quota_stage: "unknown",
            quota_condition_text: "unclassified original source condition",
          },
        },
      },
      quota("current-2", 5),
    ];
    f.state.claims = [];
    f.state.complete = [target("current-2")];
    const out = asJson(await f.service().execute(f.execute(), f.boundary));
    eq(out.items[0].offering.offering_id, "2027:current-1");
    eq(out.items[0].status, "pending");
    eq(out.items[0].recruitment.value, value);
    eq(out.items[0].recruitment.source_quota.quota_value, value);
    eq(out.items[0].recruitment.stage, "unknown");
    eq(out.items[0].recruitment.condition, "unknown");
    eq(
      out.items[0].recruitment.condition_text,
      "unclassified original source condition",
    );
    eq(out.items[0].history.status, "pending");
    eq(out.items[0].history.items.length, 0);
    eq(out.items[1].status, "ready");
    eq(out.items[1].recruitment.value, 5);
    if (value === null) {
      eq(out.items[0].recruitment.status, "pending_value_missing");
    }
  }
});

Deno.test("missing condition comparison evidence holds only that relationship and preserves another verified row", async () => {
  for (
    const missing of [
      "history",
      "old_stage",
      "old_condition",
      "current_stage",
      "current_condition",
    ] as const
  ) {
    const f = await fixture();
    f.state.rows = [offering("current-1"), offering("current-2")];
    f.state.scope = [
      {
        ...quota("current-1"),
        quota: {
          ...quota("current-1").quota!,
          stage: missing === "current_stage" ? "unknown" : "initial",
          condition: missing === "current_condition" ? "unknown" : "conditional",
        },
      },
      quota("current-2"),
    ];
    f.state.complete = [target("current-1"), target("current-2")];
    const first = claim(
      "uncertain",
      previous("old-a", "old-school"),
      "approved-proof",
    );
    const second = claim(
      "confirmed",
      previous("old-b", "old-school"),
      "approved-proof",
      "current-2",
    );
    f.state.claims = [
      {
        ...first,
        historical_condition: missing === "history" ? null : {
          stage: missing === "old_stage" ? "unknown" : "initial",
          condition: missing === "old_condition" ? "unknown" : "conditional",
          condition_text: "source condition",
        },
      },
      second,
    ];
    const out = asJson(
      await f.service({
        condition_comparisons: {
          compare: () =>
            Promise.resolve([
              { claim_id: "uncertain", status: "changed" as const },
              { claim_id: "confirmed", status: "changed" as const },
            ]),
        },
      }).execute(f.execute(), f.boundary),
    );
    eq(out.items.length, 2);
    eq(out.items[0].offering.offering_id, "2027:current-1");
    eq(out.items[0].history.items[0].condition_comparison, "pending");
    eq(out.items[1].status, "ready");
    eq(out.items[1].offering.offering_id, "2027:current-2");
    eq(out.items[1].history.items[0].condition_comparison, "changed");
  }
});
