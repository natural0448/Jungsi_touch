/** Synthetic-only candidate tests. No runtime route, DB, Storage, or network. */
import { AccessError } from "./access.ts";
import { readSessionSnapshot } from "./session_service.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { PublicResponseProjection } from "./public_response.ts";
const registry = JSON.parse(
  new TextDecoder().decode(
    await Deno.readFile(
      new URL("./history_current_page_public_registry.review-only.json", import.meta.url),
    ),
  ),
);
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

const schemaProjection = () =>
  new PublicResponseProjection(registry, [{
    id: "history.current-page",
    contract_ref: "REVIEW_ONLY.history_current_page",
  }]);

async function fullActualResponse() {
  const f = await fixture();
  f.state.rows = [
    offering("current-1"),
    offering("current-2"),
    offering("current-3"),
    offering("current-4"),
  ];
  f.state.scope = [
    {
      ...quota("current-1", 0n),
      quota: {
        ...quota("current-1", 0n).quota!,
        condition: "unknown",
        condition_text: "synthetic original condition",
        source_quota: {
          quota_value: 0n,
          quota_literal_state: "numeric_literal",
          quota_stage: "initial",
          quota_condition_text: "synthetic original condition",
          quota_cell: {
            status: "verified_official",
            reason_code: null,
            unit: "persons",
            source_as_of: "2026-10-01",
          },
        },
      },
    },
    {
      ...quota("current-2", "12.50"),
      quota: {
        ...quota("current-2", "12.50").quota!,
        stage: "unknown",
        condition: "unknown",
        condition_text: "synthetic unknown condition",
      },
    },
    quota("current-3", null),
    { target: target("current-4"), decision: "HOLD", quota: null },
  ];
  f.state.complete = [target("current-1"), target("current-2")];
  const a = claim("a", previous("old-a", "old-school"), "approved-proof");
  const b = claim("b", previous("old-b", "old-school"), "approved-proof");
  const held = claim("held", previous("old-c", "old-school"), "bad-proof");
  const source = {
    observation_id: "observation:" + hash("a"),
    identity_variant_index: 0,
    scope_status: "source_consistent" as const,
  };
  const alternateEntry = {
    value: new JsonFloat("12.50"),
    status: "pending_metadata" as const,
    unit: "points",
    reason_code: "synthetic_pending",
    statistic_label: "synthetic other cut",
    cohort: "synthetic cohort",
    source_url: "https://example.test/source",
    source_as_of: "2026-10-01",
    source_context: source,
    statistic_percent: 70,
    basis_code: "basis",
    basis_label: "basis label",
    cohort_code: "cohort",
    cohort_label: "cohort label",
    selection_rule_ref: "synthetic-rule",
    metric_definition: "synthetic definition",
    value_json_type: "number",
    original_scale: "100.0",
    score_calculation_context: {
      source_result_year: 2026,
      score_calculation_year: 2027,
      observation_role: "prior_year_recalculated_reference" as const,
    },
    publication_context: {
      publication_role: "simulation_reference" as const,
      simulation_target_academic_year: 2028,
    },
  };
  const firstMetric = {
    field: "final_50_percent_cut" as const,
    value: null,
    status: "not_published" as const,
    unit: null,
    reason_code: "synthetic_not_published",
    statistic_label: "50%",
    cohort: "synthetic cohort A",
    source_url: null,
    source_as_of: null,
    source_context: source,
    statistic_percent: 50,
    basis_code: "basis-A",
    basis_label: "basis A",
    cohort_code: "cohort-A",
    cohort_label: "cohort A",
    selection_rule_ref: "rule-A",
    metric_definition: "definition A",
    value_json_type: "null",
    original_scale: 100n,
    score_calculation_context: {
      source_result_year: 2026,
      score_calculation_year: 2026,
      observation_role: "actual_result" as const,
    },
    publication_context: {
      publication_role: "actual_result" as const,
      simulation_target_academic_year: null,
    },
  };
  const alternate = {
    ...firstMetric,
    field: "alternate_cut" as const,
    statistic_percent: 70,
    score_calculation_context: {
      source_result_year: 2026,
      score_calculation_year: 2026,
      observation_role: "actual_result" as const,
    },
    entries: [
      alternateEntry,
      { ...alternateEntry, value: 0n },
      { ...alternateEntry, value: "12.50" },
      { ...alternateEntry, value: null, status: "not_published" as const, source_context: null },
    ],
    omitted_other_basis_count: 2,
  };
  // The top-level alternate cell has no publication_context in the existing snapshot contract.
  const { publication_context: _omit, ...alternateWithoutPublication } = alternate;
  ok(_omit !== null);
  f.state.claims = [
    {
      ...a,
      metrics: [
        firstMetric,
        alternateWithoutPublication,
        {
          ...firstMetric,
          field: "recruitment_count_with_stage",
          stage: "initial",
          statistic_percent: null,
        },
      ],
    },
    { ...b, metrics: [{ ...b.metrics[0], cohort: "synthetic cohort B" }] },
    held,
  ];
  f.state.meaning = (c) =>
    c.claim_id === "b"
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
  const result = await f.service({
    score_reasons: {
      project: () =>
        Promise.resolve([{
          claim_id: "a",
          metric_index: 0,
          field: "final_50_percent_cut",
          reasons: ["other_statistic_only", "three_or_fewer"],
        }]),
    },
    condition_comparisons: {
      compare: () =>
        Promise.resolve([
          { claim_id: "a", status: "pending" as const },
          { claim_id: "b", status: "pending" as const },
        ]),
    },
  }).execute(f.execute(), f.boundary);
  return result;
}

function cloneWithSentinels(value: unknown): unknown {
  if (value instanceof JsonFloat) return new JsonFloat(value.lexeme);
  if (Array.isArray(value)) return value.map(cloneWithSentinels);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = { INTERNAL_SECRET_SHOULD_DROP: "synthetic-secret" };
    for (const [k, v] of Object.entries(value)) result[k] = cloneWithSentinels(v);
    return result;
  }
  return value;
}

Deno.test("actual v8 output, all optional metadata and two same-year relations survive both membership projections", async () => {
  const result = await fullActualResponse();
  const projection = schemaProjection();
  const standard = projection.project("history.current-page", "standard", result);
  const paid = projection.project("history.current-page", "paid", result);
  eq(nativeJsonText(standard, true), nativeJsonText(result, true));
  eq(nativeJsonText(paid, true), nativeJsonText(result, true));
  const output = asJson(result);
  eq(output.items.length, 4);
  eq(output.items[0].recruitment.value, 0);
  eq(output.items[1].recruitment.value, "12.50");
  eq(output.items[2].recruitment.value, null);
  eq(output.items[3].offering, null);
  eq(output.items[3].recruitment, null);
  eq(output.items[0].history.items.length, 2);
  eq(output.items[0].history.items[0].academic_year, 2026);
  eq(output.items[0].history.items[1].academic_year, 2026);
  eq(output.items[0].history.items[1].observation_use, "shared_reference");
  const metric = output.items[0].history.items[0].metrics[0];
  eq(metric.reason_code, "synthetic_not_published");
  eq(metric.verified_score_null_reasons.length, 2);
  eq(metric.source_context.scope_status, "source_consistent");
  const alternate = output.items[0].history.items[0].metrics[1];
  eq(alternate.entries.length, 4);
  eq(alternate.omitted_other_basis_count, 2);
  eq(alternate.entries[0].publication_context.simulation_target_academic_year, 2028);
  eq(alternate.entries[2].value, "12.50");
  ok(!Object.hasOwn(alternate.entries[0], "field"));
});

Deno.test("recursive allowlist drops unknown fields at every level and never leaks raw proof", async () => {
  const result = await fullActualResponse();
  const hostile = cloneWithSentinels(result);
  const projection = schemaProjection();
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project("history.current-page", tier, hostile);
    eq(nativeJsonText(projected, true), nativeJsonText(result, true));
    ok(!nativeJsonText(projected).includes("INTERNAL_SECRET_SHOULD_DROP"));
    ok(!nativeJsonText(projected).includes("synthetic-secret"));
    ok(!nativeJsonText(projected).includes("relation_proof"));
  }
});

Deno.test("projection preserves scalar type and decimal lexeme before JSON transport", async () => {
  const result = await fullActualResponse();
  const projection = schemaProjection();
  const projected = projection.project("history.current-page", "standard", result);
  const items = (projected as {
    items: Array<{
      recruitment: { value: unknown } | null;
      history: { items: Array<{ metrics: Array<{ entries?: Array<{ value: unknown }> }> }> };
    }>;
  }).items;
  eq(typeof items[0].recruitment!.value, "bigint");
  eq(items[0].recruitment!.value, 0n);
  eq(typeof items[1].recruitment!.value, "string");
  eq(items[1].recruitment!.value, "12.50");
  eq(items[2].recruitment!.value, null);
  const entries = items[0].history.items[0].metrics[1].entries!;
  ok(entries[0].value instanceof JsonFloat);
  eq(entries[0].value.lexeme, "12.50");
  eq(typeof entries[1].value, "bigint");
  eq(entries[1].value, 0n);
  eq(typeof entries[2].value, "string");
  eq(entries[3].value, null);
  ok(nativeJsonText(projected).includes('"value":12.50'));
  ok(nativeJsonText(projected).includes('"value":"12.50"'));
});

Deno.test("missing required fields, invalid nested types and unregistered operation fail closed", async () => {
  const result = await fullActualResponse();
  const clean = JSON.parse(nativeJsonText(result));
  const projection = schemaProjection();
  const inputs = [
    { ...clean, format: "unexpected" },
    { ...clean, items: [{ ...clean.items[0], history: { status: "ready" } }] },
    {
      ...clean,
      items: [{ ...clean.items[0], recruitment: { ...clean.items[0].recruitment, value: true } }],
    },
  ];
  for (const invalid of inputs) {
    await rejects(
      () => Promise.resolve(projection.project("history.current-page", "standard", invalid)),
      "security_policy_unavailable",
      503,
    );
  }
  await rejects(
    () => Promise.resolve(projection.project("history.snapshot.read", "standard", clean)),
    "security_policy_unavailable",
    503,
  );
});

Deno.test("the existing numeric projection rejects nonfinite JSON-number interpretations", async () => {
  const result = await fullActualResponse();
  const clean = JSON.parse(nativeJsonText(result));
  clean.items[0].recruitment.value = new JsonFloat("1e900");
  await rejects(
    () => Promise.resolve(schemaProjection().project("history.current-page", "standard", clean)),
    "security_policy_unavailable",
    503,
  );
});

Deno.test("all current recruitment pending outcomes retain the full actual v8 response", async () => {
  for (const mode of ["source_conflict", "metadata", "finality", "not_published"] as const) {
    const f = await fixture();
    const original = quota("current-1", mode === "not_published" ? null : 7);
    const q = original.quota!;
    const changed = mode === "source_conflict"
      ? { ...q, source_quota: { quota_stage: "final" } }
      : mode === "metadata"
      ? { ...q, unit: null }
      : mode === "finality"
      ? { ...q, stage: "final" as const, condition: "none" as const }
      : { ...q, status: "not_published" as const };
    f.state.scope = [{ ...original, quota: changed }];
    const result = await f.service().execute(f.execute(), f.boundary);
    const projected = schemaProjection().project("history.current-page", "standard", result);
    eq(nativeJsonText(projected, true), nativeJsonText(result, true));
    const out = asJson(result);
    eq(
      out.items[0].recruitment.status,
      mode === "source_conflict"
        ? "pending_source_conflict"
        : mode === "metadata"
        ? "pending_metadata"
        : mode === "finality"
        ? "pending_finality"
        : "not_published",
    );
  }
});

Deno.test("source JSON null and SQL null literal states remain distinct from zero and from absence", async () => {
  for (const literal of ["json_null", "sql_null"] as const) {
    const f = await fixture();
    const original = quota("current-1", null);
    f.state.scope = [{
      ...original,
      quota: {
        ...original.quota!,
        stage: "unknown",
        condition: "unknown",
        source_quota: { quota_value: null, quota_literal_state: literal, quota_cell: null },
      },
    }];
    const result = await f.service().execute(f.execute(), f.boundary);
    const projected = schemaProjection().project("history.current-page", "paid", result);
    eq(nativeJsonText(projected, true), nativeJsonText(result, true));
    const out = asJson(result).items[0].recruitment;
    eq(out.value, null);
    eq(out.source_quota.quota_literal_state, literal);
    eq(out.source_quota.quota_cell, null);
    ok(!Object.hasOwn(out.source_quota, "quota_stage"));
    ok(!Object.hasOwn(out.source_quota, "quota_condition_text"));
  }
});

Deno.test("the actual-output fixture exercises every property of every new schema definition", async () => {
  const actual = asJson(await fullActualResponse());
  const schema = registry.schemas;
  const items = actual.items;
  const offerings = items.map((x: { offering: unknown }) => x.offering).filter(Boolean);
  const recruitment = items.map((x: { recruitment: unknown }) => x.recruitment).filter(Boolean);
  const histories = items.map((x: { history: unknown }) => x.history);
  const historyItems = histories.flatMap((x: { items: unknown[] }) => x.items);
  const metrics = historyItems.flatMap((x: { metrics: unknown[] }) => x.metrics);
  const entries = metrics.flatMap((x: { entries?: unknown[] }) => x.entries ?? []);
  const sourceQuota = recruitment.map((x: { source_quota?: unknown }) => x.source_quota).filter(
    Boolean,
  );
  const cells = sourceQuota.map((x: { quota_cell?: unknown }) => x.quota_cell).filter(Boolean);
  const contexts = [...metrics, ...entries].map((x: { source_context?: unknown }) =>
    x.source_context
  ).filter(Boolean);
  const scoreContexts = [...metrics, ...entries].map((x: { score_calculation_context?: unknown }) =>
    x.score_calculation_context
  ).filter(Boolean);
  const publicationContexts = [...metrics, ...entries].map((x: { publication_context?: unknown }) =>
    x.publication_context
  ).filter(Boolean);
  const historicalConditions = historyItems.map((x: { historical_condition?: unknown }) =>
    x.historical_condition
  ).filter(Boolean);
  const toObjects = (values: unknown[]): object[] =>
    values.filter((value): value is object => value !== null && typeof value === "object");
  const groups: Array<[string, { properties: object }, object[]]> = [
    ["response", schema.p1_current_page_response, [actual]],
    ["item", schema.p1_current_page_item, items],
    ["offering", schema.p1_current_page_offering, offerings],
    ["recruitment", schema.p1_current_page_recruitment, recruitment],
    ["source quota", schema.p1_current_page_source_quota, sourceQuota],
    ["source quota cell", schema.p1_current_page_source_quota_cell, cells],
    ["history", schema.p1_current_page_history, histories],
    ["history item", schema.p1_current_page_history_item, historyItems],
    ["historical condition", schema.p1_current_page_historical_condition, historicalConditions],
    ["metric", schema.p1_current_page_metric, metrics],
    ["alternate entry", schema.p1_current_page_alternate_entry, entries],
    ["source context", schema.p1_current_page_source_context, toObjects(contexts)],
    ["score context", schema.p1_current_page_score_context, toObjects(scoreContexts)],
    [
      "publication context",
      schema.p1_current_page_publication_context,
      toObjects(publicationContexts),
    ],
  ];
  for (const [label, definition, examples] of groups) {
    const missing = Object.keys(definition.properties).filter((key) =>
      !examples.some((item) => Object.hasOwn(item, key))
    );
    ok(missing.length === 0, label + " fixture did not exercise: " + missing.join(", "));
  }
});
