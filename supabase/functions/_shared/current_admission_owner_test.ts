/** Synthetic reviewer, precise wire and SQL-port regressions. No real settings, JWT, DB or network. */
import { DisplayError, sameJson } from "./official_history_display.ts";
import type { Row } from "./official_history_display.ts";
import { EncryptedCurrentCursor } from "./current_admission_display.ts";
import type { CurrentKey } from "./current_admission_display.ts";
import {
  closeCurrentReviewPage,
  createCurrentAdmissionReviewHandler,
  CURRENT_REVIEW_FIELDS,
  CURRENT_REVIEW_OPERATION,
  CURRENT_REVIEW_ROUTE,
  CURRENT_WIRE_FIELDS,
  currentReviewBinding,
  currentReviewKey,
  currentReviewProjectionSha256,
  currentReviewSha256,
  currentReviewWireJson,
  MEMBER_WIRE_FIELDS,
  parseCurrentReviewQuery,
  POPULATION_WIRE_FIELDS,
  validateCurrentReviewDescriptor,
  validateCurrentScalar,
  validateCurrentWireJsonText,
} from "./current_admission_review.ts";
import type {
  CurrentReviewDescriptor,
  CurrentReviewObservation,
  CurrentReviewPorts,
  CurrentReviewRawPage,
} from "./current_admission_review.ts";
import { buildCurrentReviewLivePayloadSql } from "./current_admission_review_sql.ts";
const SUBJECT = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-10-09T00:00:00Z"),
  RELAY = "SYNTHETIC-current-review-relay-not-real-0000",
  PREFIX = "/functions/v1/current-admission-review";
const SECRET = new Uint8Array(32).fill(13);
const assert = (
  value: unknown,
  message = "synthetic review assertion failed",
) => {
  if (!value) throw new Error(message);
};
const equal = (a: unknown, b: unknown) =>
  assert(sameJson(a, b), "synthetic typed equality failed");
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
async function rejects(action: () => unknown | Promise<unknown>, code: string) {
  try {
    await action();
  } catch (e) {
    if (!(e instanceof DisplayError)) {
      throw new Error("synthetic expected safe error");
    }
    equal(e.code, code);
    return;
  }
  throw new Error("synthetic expected rejection");
}
const query = (q = "") =>
  parseCurrentReviewQuery(new URL("https://example.org/synthetic" + q));
async function rawSha(text: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function syntheticDefinition(relation: string, live: boolean): string {
  if (!live) return "SYNTHETIC definition " + relation;
  if (relation === "admission_results_effective") {
    return "SELECT * FROM jungsi_data_ingest.admission_results";
  }
  if (relation === "admission_results_source_current") {
    return "SELECT * FROM jungsi_data_ingest.admission_observation_registry JOIN jungsi_data_ingest.admission_results_effective ON false";
  }
  if (
    relation === "admission_results_current" ||
    relation === "admission_result_source_members"
  ) {
    return "SELECT * FROM jungsi_data_ingest.admission_results_source_current JOIN jungsi_data_ingest.admission_observation_registry ON false";
  }
  return 'SELECT 1 AS "SYNTHETIC-only"';
}
async function descriptor(live = false): Promise<CurrentReviewDescriptor> {
  const metadata: Row[] = [];
  for (
    const [relation, kind] of [
      ["admission_results_current", "v"],
      ["admission_result_source_members", "v"],
      ["admission_result_population_links_current", "v"],
      ["admission_observation_commands", "r"],
      ...(live
        ? [["admission_results_source_current", "v"], [
          "admission_results_effective",
          "v",
        ]]
        : []),
    ] as [string, "v" | "r"][]
  ) {
    metadata.push({
      schema: "jungsi_data_ingest",
      relation,
      kind,
      columns: [{ name: "SYNTHETIC-column", type: "text", not_null: false }],
      reloptions: kind === "v"
        ? ["security_invoker=true", "security_barrier=true"]
        : null,
      view_definition_sha256: kind === "v"
        ? await rawSha(syntheticDefinition(relation, live))
        : null,
    });
  }
  const definition = { sha256: await currentReviewSha256(metadata), metadata };
  return {
    format: live
      ? "jungsi.current-admission-review/v2"
      : "jungsi.current-admission-review/v1",
    ...(live ? { query_mode: "live_bounded" } : {}),
    purpose: "current_admission_review",
    environment: "local_verification",
    scope: "all_current",
    source_view: "jungsi_data_ingest.admission_results_current",
    allowed_years: [2024, 2025, 2026, 2027],
    source_definition: definition,
    projection: {
      version: "SYNTHETIC-current-review-v1",
      sha256: await currentReviewProjectionSha256(
        live ? "live_bounded" : "exact",
      ),
      wire_recipe: live
        ? "current_review_live_bounded_v2"
        : "current_review_wire_state_v1",
    },
    qualified_state: live
      ? {
        mode: "live_current_head",
        definition_sha256: definition.sha256,
        wire_recipe: "current_review_live_bounded_v2",
      }
      : {
        command_id: "SYNTHETIC-qualified-command",
        payload_sha256: "b".repeat(64),
        definition_sha256: definition.sha256,
        wire_recipe: "current_review_wire_state_v1",
      },
    approval: {
      status: "approved",
      approval_id: "SYNTHETIC-review-approval",
      issued_at: "2026-10-09T00:00:00Z",
      expires_at: "2026-10-09T01:00:00Z",
      revoked: false,
      review_subjects: [SUBJECT],
      operations: [CURRENT_REVIEW_OPERATION],
    },
    engine_approved: false,
    production_allowed: false,
    general_publication_allowed: false,
    nationwide_collection_complete: false,
  };
}
function observation(
  i: number,
  literal = "0.1000000000000000000010",
  type = "number",
  numeric: Row["metric_value_numeric"] = literal,
): CurrentReviewObservation {
  const current: Row = Object.fromEntries(
    CURRENT_WIRE_FIELDS.map((k) => [k, null]),
  );
  Object.assign(current, {
    release_id: "SYNTHETIC-source-release",
    result_id: "SYNTHETIC-canonical-" + i,
    academic_year: 2026,
    school_id: "SYNTHETIC-school",
    university_code: "SYNTHETIC-code",
    university: "SYNTHETIC University",
    recruit_group: "가",
    recruit_group_raw: '{"SYNTHETIC":9007199254740993}',
    department: "SYNTHETIC Department",
    track: "SYNTHETIC Track",
    offering_pk: "SYNTHETIC-private-PK",
    anchor_2027_pks: "[]",
    metric_kind: "SYNTHETIC metric",
    metric_value_literal: literal,
    metric_value_numeric: numeric,
    metric_value_json_type: type,
    cohort: "SYNTHETIC cohort",
    statistic_label: "SYNTHETIC statistic",
    active_service: true,
    source_path: "SYNTHETIC-private-path",
    source_sha256: "c".repeat(64),
    source_location: '{"SYNTHETIC":0.1000000000000000000001}',
    source_review_status: "SYNTHETIC-reviewed",
    original_record_locator: "{}",
    field_presence_types: "{}",
    row_fingerprint: "d".repeat(64),
    curation_release_id: "SYNTHETIC-revision",
    curation_fields: "{}",
    curation_evidence: "{}",
    source_result_id: "SYNTHETIC-original-" + i,
    canonical_result_id: "SYNTHETIC-canonical-" + i,
    source_member_count: 1,
    management_status: "SYNTHETIC-management",
    overlap_review_key: "SYNTHETIC-private-overlap",
    source_row_fingerprint: "d".repeat(64),
  });
  const member = Object.fromEntries(
    MEMBER_WIRE_FIELDS.map(
      (k) => [k, Object.hasOwn(current, k) ? current[k] : null],
    ),
  ) as Row;
  Object.assign(member, {
    result_id: current.source_result_id,
    canonical_result_id: current.canonical_result_id,
    source_all29_sha256: "e".repeat(64),
    is_representative: true,
  });
  const population: Row = {
    result_id: current.canonical_result_id,
    academic_year: 2026,
    population_reference_year: 2027,
    reference_offering_pk: "SYNTHETIC-private-forward-PK",
    link_kind: "official_reorganized_forward_reference",
    active_service: true,
    individual_offering_metric_inference_allowed: false,
  };
  return { current, members: [member], population: [population] };
}
function raw(
  rows: CurrentReviewObservation[],
  extra: Partial<CurrentReviewRawPage> = {},
): CurrentReviewRawPage {
  return {
    commandId: "SYNTHETIC-qualified-command",
    commandSha256: "b".repeat(64),
    asOf: "2026-10-09T00:00:00.123456+00:00",
    matchingObservationCount: String(rows.length),
    matchingSourceSchoolCount: rows.length ? "1" : "0",
    rows,
    ...extra,
  };
}

import {
  OWNER_PERCENTILE_FIELDS,
  OWNER_PERCENTILE_VIEW,
  OWNER_REVIEW_FIELDS,
  OWNER_REVIEW_FORMAT,
  OWNER_REVIEW_WIRE_RECIPE,
  ownerCurrentProjectionSha256,
} from "./current_admission_owner.ts";
import {
  buildOwnerCurrentReviewPayloadSql,
  OWNER_CURRENT_REVIEW_METADATA_SEEDS,
} from "./current_admission_owner_sql.ts";
const PCT_DEF =
  "SELECT c.*, v.upper_cumulative_percent FROM jungsi_data_ingest.admission_percentile_heads_v1 h JOIN jungsi_data_ingest.admission_percentile_reviews_v1 r ON false JOIN jungsi_data_ingest.admission_results_current c ON false LEFT JOIN jungsi_data_ingest.admission_percentile_members_v1 l ON false LEFT JOIN jungsi_data_ingest.admission_percentile_values_v1 v ON false LEFT JOIN jungsi_data_ingest.admission_percentile_methods_v1 m ON false WHERE c.active_service AND r.item='actual_cutoff_percentile_application'";
function head() {
  return {
    release_id: "SYNTHETIC-percentile-current",
    command_id: "SYNTHETIC-percentile-command",
    command_sha256: "1".repeat(64),
    manifest_sha256: "2".repeat(64),
    updated_at: "2026-10-09T00:00:00Z",
  };
}
async function ownerDescriptor() {
  const d = await descriptor(true);
  d.format = OWNER_REVIEW_FORMAT;
  d.percentile_view = OWNER_PERCENTILE_VIEW;
  d.projection.sha256 = await ownerCurrentProjectionSha256();
  d.projection.wire_recipe = OWNER_REVIEW_WIRE_RECIPE;
  d.qualified_state.wire_recipe = OWNER_REVIEW_WIRE_RECIPE;
  const metadata = d.source_definition.metadata as Row[];
  metadata.push({
    schema: "jungsi_data_ingest",
    relation: "admission_result_percentiles_current",
    kind: "v",
    columns: [{ name: "SYNTHETIC-column", type: "text", not_null: false }],
    reloptions: ["security_invoker=true"],
    view_definition_sha256: await rawSha(PCT_DEF),
  });
  for (
    const n of ["heads", "releases", "reviews", "members", "values", "methods"]
  ) {
    metadata.push({
      schema: "jungsi_data_ingest",
      relation: "admission_percentile_" + n + "_v1",
      kind: "r",
      columns: [{ name: "SYNTHETIC-column", type: "text", not_null: false }],
      reloptions: null,
      view_definition_sha256: null,
    });
  }
  d.source_definition.sha256 = await currentReviewSha256(metadata);
  d.qualified_state.definition_sha256 = d.source_definition.sha256;
  return d;
}
const ownerQuery = (suffix = "") =>
  parseCurrentReviewQuery(new URL("https://example.org" + suffix), true);
function ownerObservation(i = 1) {
  return {
    ...observation(i),
    percentiles: [] as Row[],
    percentile_reviews: [] as Row[],
  };
}
function percentile(c: Row): Row {
  const p: Row = Object.fromEntries(
    OWNER_PERCENTILE_FIELDS.map((k) => [k, null]),
  );
  for (
    const k of [
      "canonical_result_id",
      "source_result_id",
      "academic_year",
      "school_id",
      "university",
      "department",
      "track",
      "recruit_group",
      "offering_pk",
      "metric_kind",
      "cohort",
      "statistic_label",
      "metric_value_literal",
      "metric_value_json_type",
      "metric_value_numeric",
    ]
  ) p[k] = c[k];
  return {
    ...p,
    upper_cumulative_percent: "12.500000000000000001",
    strictly_above_percent: "12.4",
    tie_share_percent: "0.100000000000000001",
    result_metric: "university_formula_top_cumulative",
    method_id: "3".repeat(64),
    data_kind: "model_estimated_upper_percentile",
    source_definition_ref: '{"private_formula_ref":"SYNTHETIC-private"}',
    release_id: head().release_id,
    eligibility_ox: "O",
    reason_code: "SYNTHETIC-computed",
    status: "calculated_model_estimate",
    engine_approved: false,
    production_allowed: false,
  };
}
async function ownerFixture() {
  const d = await ownerDescriptor(),
    rows = [ownerObservation(1), ownerObservation(2)];
  let pct: Row | null = head(),
    admission = "SYNTHETIC-qualified-command",
    subject = SUBJECT,
    clock = NOW;
  const ports: CurrentReviewPorts = {
    async verifySession() {
      return { subjectId: subject, expiresAt: NOW + 7200000 };
    },
    async loadDescriptor() {
      return copy(d);
    },
    async search(_d, q, after) {
      return raw(
        rows.filter((r) =>
          after === null || String(r.current.canonical_result_id) > after[4]
        ).slice(0, q.limit + 1),
        {
          commandId: admission,
          matchingObservationCount: null,
          matchingSourceSchoolCount: null,
          scanNextKey: null,
          scannedRows: 2,
          percentileHead: pct,
        },
      );
    },
  };
  const handler = createCurrentAdmissionReviewHandler(ports, {
    relayToken: RELAY,
    cursorKey: SECRET,
    pathPrefix: PREFIX,
    environment: "local_verification",
    now: () => clock,
  });
  const request = (suffix = "", headers: Record<string, string> = {}) =>
    handler(
      new Request(
        "https://example.org" + PREFIX + CURRENT_REVIEW_ROUTE + suffix,
        {
          headers: {
            "X-Jungsi-Relay-Token": RELAY,
            Authorization: "Bearer SYNTHETIC",
            ...headers,
          },
        },
      ),
    );
  return {
    d,
    rows,
    request,
    setHead: (v: Row | null) => {
      pct = v;
    },
    setAdmission: (v: string) => {
      admission = v;
    },
    setSubject: (v: string) => {
      subject = v;
    },
    setClock: (v: number) => {
      clock = v;
    },
  };
}
async function closeOwner(
  rows: CurrentReviewObservation[],
  extra: Partial<CurrentReviewRawPage> = {},
  suffix = "",
) {
  const d = await ownerDescriptor(),
    q = ownerQuery(suffix),
    r = raw(rows, {
      matchingObservationCount: null,
      matchingSourceSchoolCount: null,
      scanNextKey: null,
      scannedRows: rows.length,
      percentileHead: head(),
      ...extra,
    });
  const b = await currentReviewBinding(d, q, SUBJECT, NOW + 7200000, r);
  return closeCurrentReviewPage(r, d, q, b, null, SECRET);
}
function metadata() {
  return [
    "admission_results_effective",
    "admission_results_source_current",
    "admission_results_current",
    "admission_result_source_members",
    "admission_result_percentiles_current",
  ].map((relation) => ({
    schema: "jungsi_data_ingest",
    relation,
    kind: "v",
    definition: relation === "admission_result_percentiles_current"
      ? PCT_DEF
      : syntheticDefinition(relation, true),
  }));
}
Deno.test("owner v3 keeps approved subjects expiry and actual percentile security invoker", async () => {
  await validateCurrentReviewDescriptor(
    await ownerDescriptor(),
    "local_verification",
    NOW,
  );
  for (const key of ["revoked", "expiry", "operation", "public"]) {
    const d = await ownerDescriptor();
    if (key === "revoked") d.approval.revoked = true;
    if (key === "expiry") d.approval.expires_at = "2026-10-10T00:00:00.000001Z";
    if (key === "operation") d.approval.operations = ["history.search"];
    if (key === "public") d.general_publication_allowed = true;
    await rejects(
      () => validateCurrentReviewDescriptor(d, "local_verification", NOW),
      "current_review_scope_unverified",
    );
  }
});
Deno.test("owner query is closed and binds explicit activity and exact current identifiers", async () => {
  equal(ownerQuery().activity, "all");
  equal(
    ownerQuery(
      "?activity=inactive&offering_pk=SYNTHETIC-PK&canonical_result_id=SYNTHETIC-ID",
    ).offering_pk,
    "SYNTHETIC-PK",
  );
  for (
    const x of ["?activity=other", "?offering_pk=SELECT%20x", "?unknown=1"]
  ) await rejects(() => ownerQuery(x), "invalid_query");
  await rejects(
    () => ownerQuery("?activity=all&activity=active"),
    "duplicate_query_field",
  );
  await rejects(() => query("?activity=all"), "invalid_query");
});
Deno.test("owner response includes original metric identity explicit source version and unknown counts", async () => {
  const f = await ownerFixture(),
    r = await f.request("?limit=1"),
    b = await r.json();
  equal(r.status, 200);
  equal(Object.keys(b.items[0]).sort(), [...OWNER_REVIEW_FIELDS].sort());
  equal(b.items[0].canonical_result_id, f.rows[0].current.canonical_result_id);
  equal(b.items[0].metric_value_literal, "0.1000000000000000000010");
  equal(b.matching_observation_count, null);
  equal(b.source_version.percentile_head.release_id, head().release_id);
  assert(r.headers.get("cache-control")?.includes("no-store"));
});
Deno.test("owner relay and explicit subject remain required", async () => {
  const f = await ownerFixture();
  equal((await f.request("", { "X-Jungsi-Relay-Token": "" })).status, 403);
  f.setSubject(OTHER);
  equal((await f.request()).status, 403);
});
Deno.test("owner approval expiry is rechecked on every page", async () => {
  const f = await ownerFixture();
  f.setClock(NOW + 3600000);
  equal((await f.request()).status, 503);
});
Deno.test("owner percentile head changes invalidate next cursor with 409", async () => {
  const f = await ownerFixture(),
    b = await (await f.request("?limit=1")).json();
  assert(b.next_cursor);
  f.setHead({ ...head(), release_id: "SYNTHETIC-next-release" });
  equal((await f.request("?limit=1&cursor=" + b.next_cursor)).status, 409);
});
Deno.test("owner admission head changes invalidate next cursor with 409", async () => {
  const f = await ownerFixture(),
    b = await (await f.request("?limit=1")).json();
  f.setAdmission("SYNTHETIC-changed");
  equal((await f.request("?limit=1&cursor=" + b.next_cursor)).status, 409);
});
Deno.test("owner activity filter changes cannot reuse cursor", async () => {
  const f = await ownerFixture(),
    b = await (await f.request("?limit=1")).json();
  equal(
    (await f.request("?limit=1&activity=active&cursor=" + b.next_cursor))
      .status,
    409,
  );
});
Deno.test("owner inactive observations stay visible with explicit exclusion reason", async () => {
  const r = ownerObservation();
  r.current.active_service = false;
  const b = await closeOwner([r], {}, "?activity=inactive");
  const item = (b.items as Row[])[0];
  equal(item.active_service, false);
  equal(item.percentile_state, "inactive_source");
  assert(
    (item.hold_reasons as string[]).includes("not_in_active_service_scope"),
  );
  await rejects(
    () => closeOwner([r], {}, "?activity=active"),
    "current_review_scope_unverified",
  );
});
Deno.test("owner zero null and missing preserve native meaning", async () => {
  for (
    const [literal, type, numeric, availability] of [
      ["0", "number", "0", "present"],
      ["null", "null", null, "actual_null"],
      [null, null, null, "missing"],
    ]
  ) {
    const r = ownerObservation();
    Object.assign(r.current, {
      metric_value_literal: literal,
      metric_value_json_type: type,
      metric_value_numeric: numeric,
    });
    const b = await closeOwner([r]);
    equal((b.items as Row[])[0].metric_value_literal, literal);
    equal((b.items as Row[])[0].value_availability, availability);
  }
});
Deno.test("owner uncomputed percentile stays missing without fallback student rank", async () => {
  const b = await closeOwner([ownerObservation()]);
  const item = (b.items as Row[])[0];
  equal(item.calculated_percentiles, []);
  equal(item.percentile_state, "not_reviewed_in_current_percentile_release");
  equal(b.engine_approved, false);
  equal(b.production_allowed, false);
  equal(b.expected_offering_roster_anti_join, "NOT_RUN");
});
Deno.test("owner multiple healthy sources are never automatically duplicate errors", async () => {
  const r = ownerObservation();
  r.members.push({
    ...r.members[0],
    result_id: "SYNTHETIC-source-2",
    is_representative: false,
  });
  r.current.source_member_count = 2;
  const b = await closeOwner([r]), item = (b.items as Row[])[0];
  equal(item.source_member_count, 2);
  equal((item.diagnostics as Row).integrity_reasons, []);
  equal((item.diagnostics as Row).multiple_sources_is_duplicate, false);
});
Deno.test("owner formula percentile preserves precise text and hides raw formula evidence", async () => {
  const r = ownerObservation();
  r.percentiles = [percentile(r.current)];
  r.percentile_reviews = [{
    item: "SYNTHETIC-item",
    ox: "O",
    reason_code: "SYNTHETIC-reason",
    evidence_ref: "SYNTHETIC-private-path",
  }];
  const b = await closeOwner([r]),
    item = (b.items as Row[])[0],
    p = (item.calculated_percentiles as Row[])[0];
  equal(p.upper_cumulative_percent, "12.500000000000000001");
  equal(p.comparison_is_actual_applicant_rank, false);
  equal(p.meaning, "과거 입결 점수의 대학식 상위누백");
  assert(!JSON.stringify(b).includes("SYNTHETIC-private-path"));
  assert(!JSON.stringify(b).includes("private_formula_ref"));
});
Deno.test("owner multiple variants and review items remain explicit", async () => {
  const r = ownerObservation(), p = percentile(r.current);
  r.percentiles = [p, { ...p, method_id: "4".repeat(64) }];
  r.percentile_reviews = [{
    item: "item-a",
    ox: "O",
    reason_code: "ok",
    evidence_ref: "a",
  }, { item: "item-b", ox: "X", reason_code: "hold", evidence_ref: "b" }];
  const b = await closeOwner([r]), item = (b.items as Row[])[0];
  equal(item.percentile_state, "multiple_variants");
  equal((item.calculated_percentiles as Row[]).length, 2);
  equal((item.percentile_reviews as Row[]).length, 2);
});
Deno.test("owner stale source hold is preserved without substituting old percentile", async () => {
  const r = ownerObservation(), p = percentile(r.current);
  Object.assign(p, {
    upper_cumulative_percent: null,
    strictly_above_percent: null,
    tie_share_percent: null,
    status: "hold",
    eligibility_ox: "X",
    reason_code:
      "SOURCE_CURRENT_IDENTITY_OR_FINGERPRINT_CHANGED_RECALC_REQUIRED",
  });
  r.percentiles = [p];
  const b = await closeOwner([r]),
    v = ((b.items as Row[])[0].calculated_percentiles as Row[])[0];
  equal(v.upper_cumulative_percent, null);
  equal(v.reason_code, p.reason_code);
});
Deno.test("owner calculated percentile rejects invalid bounds identity and publication flags", async () => {
  for (
    const change of [
      { upper_cumulative_percent: "101" },
      { upper_cumulative_percent: "100.000000000000000001" },
      { strictly_above_percent: "12.500000000000000002" },
      { tie_share_percent: "0.1" },
      { strictly_above_percent: "20" },
      { canonical_result_id: "SYNTHETIC-foreign" },
      { release_id: "SYNTHETIC-old" },
      { engine_approved: true },
      { upper_cumulative_percent: null },
    ] as Row[]
  ) {
    const r = ownerObservation();
    r.percentiles = [{ ...percentile(r.current), ...change }];
    await rejects(() => closeOwner([r]), "current_review_scope_unverified");
  }
});
Deno.test("owner diagnostic overflow is visible and bounded", async () => {
  const r = ownerObservation();
  r.percentile_reviews = Array.from(
    { length: 17 },
    (_, i) => ({
      item: "item-" + i,
      ox: "X",
      reason_code: "hold",
      evidence_ref: "evidence",
    }),
  );
  const b = await closeOwner([r]), item = (b.items as Row[])[0];
  equal((item.percentile_reviews as Row[]).length, 16);
  assert(
    ((item.diagnostics as Row).integrity_reasons as string[]).includes(
      "diagnostic_items_truncated",
    ),
  );
});
Deno.test("owner empty filtered window returns continuation without global no-match claim", async () => {
  const b = await closeOwner([], {
    scannedRows: 128,
    scanNextKey: currentReviewKey(observation(8).current, true),
  });
  equal(b.items, []);
  assert(b.next_cursor);
  equal((b.current_scope as Row).empty_items_is_global_no_match, false);
  equal(b.matching_observation_count, null);
});
Deno.test("owner invalid scan metadata cannot imply complete current coverage", async () => {
  for (const change of [{ scannedRows: 129 }, { scanNextKey: undefined }]) {
    await rejects(
      () => closeOwner([], change),
      "current_review_scope_unverified",
    );
  }
});
Deno.test("owner null percentile head is explicit and never a numeric zero", async () => {
  const b = await closeOwner([ownerObservation()], { percentileHead: null });
  equal(
    (b.items as Row[])[0].percentile_state,
    "percentile_release_not_registered",
  );
});
Deno.test("owner SQL retains canonical C ordering and bounded keys without global counts", () => {
  const s = buildOwnerCurrentReviewPayloadSql(metadata());
  assert(s.includes("LIMIT 129") && s.includes("LIMIT 128"));
  assert(
    s.includes("$14::text") && s.includes("$15::text") &&
      s.includes("$16::text"),
  );
  assert(s.includes('COLLATE "C"'));
  assert(s.includes("count(*)::integer FROM scan_keys"));
  assert(!s.includes("count(DISTINCT") && !s.includes("FROM filtered"));
});
Deno.test("owner SQL joins only page keys with current head and exact reference semantics", () => {
  const s = buildOwnerCurrentReviewPayloadSql(metadata());
  assert(s.includes("bounded_percentile_current"));
  assert(s.includes("h.head_name='current'"));
  assert(s.includes("r.item='actual_cutoff_percentile_application'"));
  assert(s.includes("FROM page_current p"));
  assert(s.includes("LEFT JOIN percentile_variants"));
  assert(s.includes("LIMIT 17"));
  assert(!s.includes("DISTINCT"));
  assert(
    !s.includes("JOIN jungsi_data_ingest.admission_result_percentiles_current"),
  );
});
Deno.test("owner SQL rejects missing or repeated pinned view dependencies", async () => {
  await rejects(
    () =>
      buildOwnerCurrentReviewPayloadSql(
        metadata().filter((r) =>
          r.relation !== "admission_result_percentiles_current"
        ),
      ),
    "current_review_scope_unverified",
  );
  const m = metadata();
  m[m.length - 1].definition = PCT_DEF + " UNION " + PCT_DEF;
  await rejects(
    () => buildOwnerCurrentReviewPayloadSql(m),
    "current_review_scope_unverified",
  );
});
Deno.test("owner nested original JSON remains held and never leaks extra internals", async () => {
  const r = ownerObservation();
  Object.assign(r.current, {
    metric_value_literal: '{"private":"SYNTHETIC-internal"}',
    metric_value_json_type: "object",
    metric_value_numeric: null,
  });
  const b = await closeOwner([r]);
  equal((b.items as Row[])[0].metric_value_literal, null);
  assert(!JSON.stringify(b).includes("SYNTHETIC-internal"));
});

Deno.test("bounded admission definitions preserve SQL regex dollar tokens literally", () => {
  const m = metadata();
  m[0].definition += " WHERE 'SYNTHETIC' ~ '^SYNTHETIC$'";
  const sql = buildCurrentReviewLivePayloadSql(m);
  equal(sql.match(/page_current AS MATERIALIZED/g)?.length, 1);
  assert(sql.includes("'^SYNTHETIC$'"));
});
Deno.test("bounded percentile definitions preserve replacement tokens without duplicating SQL", () => {
  const m = metadata();
  m[m.length - 1].definition += " AND 'SYNTHETIC' ~ '^SYNTHETIC$'";
  const sql = buildOwnerCurrentReviewPayloadSql(m);
  equal(sql.match(/page_current AS MATERIALIZED/g)?.length, 1);
  equal(sql.match(/bounded_percentile_variants AS MATERIALIZED/g)?.length, 1);
  assert(sql.includes("'^SYNTHETIC$'"));
});

Deno.test("owner metadata seeds include the release table directly read outside the current view", () => {
  assert(
    OWNER_CURRENT_REVIEW_METADATA_SEEDS.includes(
      "jungsi_data_ingest.admission_percentile_releases_v1",
    ),
  );
  assert(
    OWNER_CURRENT_REVIEW_METADATA_SEEDS.includes(
      "jungsi_data_ingest.admission_result_percentiles_current",
    ),
  );
  equal(OWNER_CURRENT_REVIEW_METADATA_SEEDS.length, 6);
});
Deno.test("owner full descriptor rejects missing direct release dependency even with valid hash", async () => {
  const d = await ownerDescriptor();
  d.source_definition.metadata = (d.source_definition.metadata as Row[]).filter(
    (x) => x.relation !== "admission_percentile_releases_v1",
  );
  d.source_definition.sha256 = await currentReviewSha256(
    d.source_definition.metadata,
  );
  d.qualified_state.definition_sha256 = d.source_definition.sha256;
  await rejects(
    () => validateCurrentReviewDescriptor(d, "local_verification", NOW),
    "current_review_scope_unverified",
  );
});
