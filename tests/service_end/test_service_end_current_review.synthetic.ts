/** Synthetic reviewer, precise wire and SQL-port regressions. No real settings, JWT, DB or network. */
import { sameJson } from "../../supabase/functions/_shared/official_history_display.ts";
import type { Row } from "../../supabase/functions/_shared/official_history_display.ts";
import {
  createCurrentAdmissionReviewHandler,
  CURRENT_REVIEW_OPERATION,
  CURRENT_REVIEW_ROUTE,
  CURRENT_WIRE_FIELDS,
  currentReviewProjectionSha256,
  currentReviewSha256,
  MEMBER_WIRE_FIELDS,
} from "../../supabase/functions/_shared/current_admission_review.ts";
import type {
  CurrentReviewDescriptor,
  CurrentReviewObservation,
  CurrentReviewPorts,
  CurrentReviewRawPage,
} from "../../supabase/functions/_shared/current_admission_review.ts";
const SUBJECT = "00000000-0000-0000-0000-000000000001";
const NOW = Date.parse("2026-10-09T00:00:00Z"),
  RELAY = "SYNTHETIC-current-review-relay-not-real-0000",
  PREFIX = "/functions/v1/current-admission-review";
const SECRET = new Uint8Array(32).fill(13);
const assert = (value: unknown, message = "synthetic review assertion failed") => {
  if (!value) throw new Error(message);
};
const equal = (a: unknown, b: unknown) => assert(sameJson(a, b), "synthetic typed equality failed");
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
async function rawSha(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
}
function syntheticDefinition(relation: string, live: boolean): string {
  if (!live) return "SYNTHETIC definition " + relation;
  if (relation === "admission_results_effective") {
    return "SELECT * FROM jungsi_data_ingest.admission_results";
  }
  if (relation === "admission_results_source_current") {
    return "SELECT * FROM jungsi_data_ingest.admission_observation_registry JOIN jungsi_data_ingest.admission_results_effective ON false";
  }
  if (relation === "admission_results_current" || relation === "admission_result_source_members") {
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
        ? [["admission_results_source_current", "v"], ["admission_results_effective", "v"]]
        : []),
    ] as [string, "v" | "r"][]
  ) {
    metadata.push({
      schema: "jungsi_data_ingest",
      relation,
      kind,
      columns: [{ name: "SYNTHETIC-column", type: "text", not_null: false }],
      reloptions: kind === "v" ? ["security_invoker=true", "security_barrier=true"] : null,
      view_definition_sha256: kind === "v"
        ? await rawSha(syntheticDefinition(relation, live))
        : null,
    });
  }
  const definition = { sha256: await currentReviewSha256(metadata), metadata };
  return {
    format: live ? "jungsi.current-admission-review/v2" : "jungsi.current-admission-review/v1",
    ...(live ? { query_mode: "live_bounded" } : {}),
    purpose: "current_admission_review",
    environment: "local_verification",
    scope: "all_current",
    source_view: "jungsi_data_ingest.admission_results_current",
    allowed_years: [2024, 2025, 2026, 2027],
    source_definition: definition,
    projection: {
      version: "SYNTHETIC-current-review-v1",
      sha256: await currentReviewProjectionSha256(live ? "live_bounded" : "exact"),
      wire_recipe: live ? "current_review_live_bounded_v2" : "current_review_wire_state_v1",
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
  const current: Row = Object.fromEntries(CURRENT_WIRE_FIELDS.map((k) => [k, null]));
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
    MEMBER_WIRE_FIELDS.map((k) => [k, Object.hasOwn(current, k) ? current[k] : null]),
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
async function fixture(live = false) {
  const d = await descriptor(live), rows = [observation(1), observation(2)], calls: string[] = [];
  let subject = SUBJECT, clock = NOW, changed = false;
  const ports: CurrentReviewPorts = {
    async verifySession(token) {
      calls.push("verify");
      return await Promise.resolve(
        token === "SYNTHETIC-verified" ? { subjectId: subject, expiresAt: NOW + 7200000 } : null,
      );
    },
    async loadDescriptor() {
      calls.push("descriptor");
      return await Promise.resolve(copy(d));
    },
    async search(_d, q, after) {
      calls.push("search");
      const selected = rows.filter((r) =>
        (q.academic_year === null || q.academic_year === r.current.academic_year) &&
        String(r.current.department).toLowerCase().includes(q.department_q)
      );
      return await Promise.resolve(raw(
        selected.filter((r) => after === null || String(r.current.canonical_result_id) > after[4])
          .slice(0, q.limit + 1),
        {
          matchingObservationCount: live ? null : String(selected.length),
          matchingSourceSchoolCount: live ? null : selected.length ? "1" : "0",
          ...(live ? { scanNextKey: null } : {}),
          ...(changed ? { commandId: "SYNTHETIC-unapproved-command" } : {}),
        },
      ));
    },
  };
  const handler = createCurrentAdmissionReviewHandler(ports, {
    relayToken: RELAY,
    cursorKey: SECRET,
    pathPrefix: PREFIX,
    environment: "local_verification",
    now: () => clock,
  });
  const request = (
    suffix = "",
    headers: Record<string, string> = {},
    method = "GET",
    route = CURRENT_REVIEW_ROUTE,
  ) =>
    handler(
      new Request("https://example.org" + PREFIX + route + suffix, {
        method,
        headers: {
          "X-Jungsi-Relay-Token": RELAY,
          Authorization: "Bearer SYNTHETIC-verified",
          ...headers,
        },
      }),
    );
  return {
    d,
    rows,
    calls,
    ports,
    request,
    setSubject: (v: string) => {
      subject = v;
    },
    setTime: (v: number) => {
      clock = v;
    },
    setChanged: () => {
      changed = true;
    },
  };
}

Deno.test("current-review end admission prevents session and source lookup", async () => {
  const f = await fixture(), end = Date.parse("2027-01-07T15:00:00Z");
  const handler = createCurrentAdmissionReviewHandler(f.ports, {
    relayToken: RELAY,
    cursorKey: SECRET,
    pathPrefix: PREFIX,
    environment: "local_verification",
    now: () => end,
  });
  const r = await handler(
    new Request("https://synthetic.invalid" + PREFIX + CURRENT_REVIEW_ROUTE, {
      headers: { "X-Jungsi-Relay-Token": RELAY },
    }),
  );
  equal(r.status, 403);
  equal((await r.json()).error.code, "service_ended");
  equal(f.calls, []);
});
Deno.test("current-review accepted before cutoff completes its already authorized review after it", async () => {
  const f = await fixture(), end = Date.parse("2027-01-07T15:00:00Z");
  let clock = end - 1;
  f.d.approval.issued_at = "2027-01-07T14:00:00Z";
  f.d.approval.expires_at = "2027-01-07T16:00:00Z";
  f.ports.verifySession = async () => {
    clock = end + 1000;
    return await Promise.resolve({ subjectId: SUBJECT, expiresAt: end + 3600000 });
  };
  const handler = createCurrentAdmissionReviewHandler(f.ports, {
    relayToken: RELAY,
    cursorKey: SECRET,
    pathPrefix: PREFIX,
    environment: "local_verification",
    now: () => clock,
  });
  const r = await handler(
    new Request("https://synthetic.invalid" + PREFIX + CURRENT_REVIEW_ROUTE, {
      headers: { "X-Jungsi-Relay-Token": RELAY, Authorization: "Bearer SYNTHETIC-verified" },
    }),
  );
  equal(r.status, 200);
  equal((await r.json()).status, "review");
  equal(clock, end + 1000);
});
Deno.test("current-review relay failure remains first after cutoff", async () => {
  const f = await fixture();
  const handler = createCurrentAdmissionReviewHandler(f.ports, {
    relayToken: RELAY,
    cursorKey: SECRET,
    pathPrefix: PREFIX,
    environment: "local_verification",
    now: () => Date.parse("2027-01-07T15:00:00Z"),
  });
  const r = await handler(new Request("https://synthetic.invalid" + PREFIX + CURRENT_REVIEW_ROUTE));
  equal(r.status, 403);
  equal((await r.json()).error.code, "relay_authentication_failed");
  equal(f.calls, []);
});
