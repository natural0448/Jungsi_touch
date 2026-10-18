/** Approved-owner inspection only. Historical formula percentiles are not student ranks. */
import { DisplayError, sameJson, utcText } from "./official_history_display.ts";
import type { Json, Row } from "./official_history_display.ts";
import {
  compareCurrentKeys,
  EncryptedCurrentCursor,
} from "./current_admission_display.ts";
import type {
  CurrentKey,
  CurrentPageBinding,
} from "./current_admission_display.ts";
import {
  CURRENT_WIRE_FIELDS,
  currentReviewHeadSha256,
  currentReviewKey,
  currentReviewSha256,
  currentReviewWireRow,
  MEMBER_WIRE_FIELDS,
  parseCurrentReviewQuery,
  POPULATION_WIRE_FIELDS,
  validateCurrentReviewQuery,
  validateCurrentScalar,
} from "./current_admission_review.ts";
import type {
  CurrentReviewDescriptor,
  CurrentReviewQuery,
  CurrentReviewRawPage,
} from "./current_admission_review.ts";

export const OWNER_REVIEW_FORMAT = "jungsi.current-admission-review/v3";

export const OWNER_REVIEW_PAGE_FORMAT =
  "jungsi.current-admission-review-page/v3";

export const OWNER_REVIEW_WIRE_RECIPE =
  "current_review_owner_formula_bounded_v3";

export const OWNER_PERCENTILE_VIEW =
  "jungsi_data_ingest.admission_result_percentiles_current";

export const OWNER_REVIEW_QUERY_FIELDS = [
  "academic_year",
  "university_q",
  "department_q",
  "track",
  "group",
  "metric_kind",
  "cohort",
  "limit",
  "cursor",
  "activity",
  "offering_pk",
  "canonical_result_id",
];

export const OWNER_PERCENTILE_FIELDS = [
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
  "upper_cumulative_percent",
  "strictly_above_percent",
  "tie_share_percent",
  "result_metric",
  "method_id",
  "rule_id",
  "rule_version",
  "score_scale_id",
  "score_scope",
  "model_version",
  "exam_id",
  "population_id",
  "population_definition",
  "data_kind",
  "publication_precision_status",
  "source_definition_ref",
  "release_id",
  "eligibility_ox",
  "reason_code",
  "status",
  "engine_approved",
  "production_allowed",
];

export const OWNER_REVIEW_FIELDS = [
  "observation_token",
  "academic_year",
  "university",
  "department",
  "track",
  "recruit_group",
  "metric_kind",
  "metric_value_literal",
  "metric_value_json_type",
  "metric_value_numeric_text",
  "cohort",
  "statistic_label",
  "source_member_count",
  "link_scopes",
  "official_metadata",
  "review_status",
  "value_availability",
  "hold_reasons",
  "canonical_result_id",
  "source_result_id",
  "offering_pk",
  "active_service",
  "management_status",
  "overlap_review_key",
  "row_fingerprint",
  "source_row_fingerprint",
  "source_reference",
  "diagnostics",
  "calculated_percentiles",
  "percentile_reviews",
  "percentile_state",
];
const fold = (v: unknown) =>
  String(v ?? "").replace(/[A-Z]/g, (c) => c.toLowerCase());
const fail = (code = "current_review_scope_unverified", status = 503) =>
  new DisplayError(code, status);
const object = (v: unknown): v is Row =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const hash = (v: unknown) => text(v) && /^[0-9a-f]{64}$/.test(v);
const identifier = (v: unknown) =>
  text(v) && v.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);

export function isOwnerCurrentReview(d: CurrentReviewDescriptor): boolean {
  return d.format === OWNER_REVIEW_FORMAT;
}

export function parseOwnerCurrentQuery(url: URL): CurrentReviewQuery {
  const base = new URL(url),
    extra = new Set(["activity", "offering_pk", "canonical_result_id"]);
  const values: Record<string, string> = {};
  for (const k of extra) {
    const all = url.searchParams.getAll(k);
    if (all.length > 1) throw fail("duplicate_query_field", 422);
    values[k] = all[0] ?? (k === "activity" ? "all" : "");
    base.searchParams.delete(k);
  }
  const q = { ...parseCurrentReviewQuery(base), ...values };
  validateOwnerCurrentQuery(q);
  return q;
}

export function validateOwnerCurrentQuery(q: CurrentReviewQuery): void {
  if (
    !object(q) || Object.keys(q).length !== OWNER_REVIEW_QUERY_FIELDS.length ||
    !OWNER_REVIEW_QUERY_FIELDS.every((k) => Object.hasOwn(q, k))
  ) throw fail("invalid_query", 400);
  const base = Object.fromEntries(
    Object.entries(q).filter(([k]) =>
      !["activity", "offering_pk", "canonical_result_id"].includes(k)
    ),
  );
  validateCurrentReviewQuery(base as unknown as CurrentReviewQuery);
  if (
    !["all", "active", "inactive"].includes(q.activity ?? "") ||
    ![q.offering_pk, q.canonical_result_id].every((v) =>
      v === "" || identifier(v)
    )
  ) throw fail("invalid_query", 400);
}

export async function ownerCurrentProjectionSha256(): Promise<string> {
  return await currentReviewSha256({
    format: "jungsi.current-review-projection/v3",
    recipe: OWNER_REVIEW_WIRE_RECIPE,
    query_fields: OWNER_REVIEW_QUERY_FIELDS,
    public_fields: OWNER_REVIEW_FIELDS,
    percentile_fields: OWNER_PERCENTILE_FIELDS,
    scan_rows: 128,
    count_status: "unknown",
    current_source: "admission_results_current",
    percentile_source: OWNER_PERCENTILE_VIEW,
    heads: ["admission_command", "percentile_release"],
    activity: "explicit_owner_filter",
    percentile_meaning:
      "historical_admission_university_formula_top_cumulative",
    review_items: "bounded_all_items_no_distinct_or_latest",
    approval_hours: 24,
  });
}

export function validatePercentileHead(head: Json | undefined): void {
  if (head === null) return;
  if (
    !object(head) ||
    !sameJson(Object.keys(head).sort(), [
      "command_id",
      "command_sha256",
      "manifest_sha256",
      "release_id",
      "updated_at",
    ]) || !identifier(head.release_id) || !text(head.command_id) ||
    !head.command_id || head.command_id.length > 256 ||
    !hash(head.command_sha256) || !hash(head.manifest_sha256) ||
    !text(head.updated_at)
  ) throw fail("current_review_state_unapproved");
  try {
    utcText(head.updated_at);
  } catch {
    throw fail("current_review_state_unapproved");
  }
}
function safeSourceUrl(raw: Json): string | null {
  if (!text(raw)) return null;
  try {
    const x = JSON.parse(raw);
    if (!object(x)) return null;
    const value = x.source_url ?? x.url;
    if (!text(value)) return null;
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !u.username &&
        !u.password &&
        !/supabase\.(?:co|in)|localhost|127\.0\.0\.1/i.test(u.hostname) &&
        !/[?&](?:token|key|signature|apikey)=/i.test(u.search)
      ? u.href
      : null;
  } catch {
    return null;
  }
}

export async function closeOwnerCurrentPage(
  raw: CurrentReviewRawPage,
  d: CurrentReviewDescriptor,
  q: CurrentReviewQuery,
  b: CurrentPageBinding,
  after: CurrentKey | null,
  secret: Uint8Array,
): Promise<Row> {
  validateOwnerCurrentQuery(q);
  validatePercentileHead(raw.percentileHead);
  if (
    !Number.isSafeInteger(raw.scannedRows) ||
    typeof raw.scannedRows !== "number" || raw.scannedRows < 0 ||
    raw.scannedRows > 128
  ) throw fail();
  if (
    await currentReviewHeadSha256(d, raw) !== b.sourceStateSha256 ||
    raw.matchingObservationCount !== null ||
    raw.matchingSourceSchoolCount !== null || !Array.isArray(raw.rows) ||
    raw.rows.length > q.limit + 1
  ) throw fail();
  const items: Row[] = [], keys: CurrentKey[] = [];
  let previous = after;
  const seen = new Set<string>(),
    cipher = new EncryptedCurrentCursor(secret, "observation");
  for (const selected of raw.rows) {
    const c = currentReviewWireRow(selected.current, CURRENT_WIRE_FIELDS),
      key = currentReviewKey(c, true);
    if (
      c.result_id !== c.canonical_result_id ||
      !identifier(c.canonical_result_id) ||
      previous && compareCurrentKeys(previous, key) >= 0 ||
      seen.has(c.canonical_result_id as string) ||
      !Array.isArray(selected.members) || !Array.isArray(selected.population) ||
      !Array.isArray(selected.percentiles) ||
      !Array.isArray(selected.percentile_reviews)
    ) throw fail();
    if (
      !d.allowed_years.includes(c.academic_year as number) ||
      typeof c.active_service !== "boolean" ||
      q.academic_year !== null && c.academic_year !== q.academic_year ||
      !["university", "department"].every((k) =>
        fold(c[k]).includes(
          q[k === "university" ? "university_q" : "department_q"],
        )
      ) || !(["track", "group", "metric_kind", "cohort"] as const).every((k) =>
        !q[k] || fold(c[k === "group" ? "recruit_group" : k]) === q[k]
      )
    ) {
      throw fail();
    }
    if (
      q.activity === "active" && c.active_service !== true ||
      q.activity === "inactive" && c.active_service !== false ||
      q.offering_pk && c.offering_pk !== q.offering_pk ||
      q.canonical_result_id && c.canonical_result_id !== q.canonical_result_id
    ) throw fail();
    previous = key;
    seen.add(c.canonical_result_id as string);
    keys.push(key);
    const reasons = ["review_only_not_published"], diagnostics: string[] = [];
    let reps = 0;
    for (const source of selected.members) {
      currentReviewWireRow(source, MEMBER_WIRE_FIELDS, true);
      if (source.canonical_result_id !== c.canonical_result_id) throw fail();
      if (source.is_representative === true) {
        reps++;
        if (
          source.result_id !== c.source_result_id ||
          source.row_fingerprint !== c.source_row_fingerprint
        ) diagnostics.push("representative_identity_mismatch");
      }
    }
    if (reps !== 1 || c.source_member_count !== selected.members.length) {
      diagnostics.push("source_membership_incomplete_or_ambiguous");
    }
    const scopes: Row[] = [];
    for (const link of selected.population) {
      currentReviewWireRow(link, POPULATION_WIRE_FIELDS, false, true);
      if (
        link.result_id !== c.canonical_result_id ||
        link.academic_year !== c.academic_year
      ) throw fail();
      scopes.push({
        reference_offering_pk: link.reference_offering_pk,
        link_kind: link.link_kind,
        population_reference_year: link.population_reference_year,
        individual_offering_metric_inference_allowed:
          link.individual_offering_metric_inference_allowed,
      });
    }
    const value = validateCurrentScalar(
      c.metric_value_literal,
      c.metric_value_json_type,
      c.metric_value_numeric,
    );
    reasons.push(...value.reasons);
    if (c.active_service === false) reasons.push("not_in_active_service_scope");
    const missing = [
      "offering_pk",
      "track",
      "recruit_group",
      "cohort",
      "statistic_label",
    ].filter((k) => c[k] === null);
    const variants: Row[] = [];
    if (
      selected.percentiles.length > 17 ||
      selected.percentile_reviews.length > 17
    ) throw fail("current_review_diagnostics_overflow");
    for (const p of selected.percentiles.slice(0, 16)) {
      if (
        !object(p) ||
        !sameJson(Object.keys(p).sort(), [...OWNER_PERCENTILE_FIELDS].sort()) ||
        p.canonical_result_id !== c.canonical_result_id ||
        p.academic_year !== c.academic_year ||
        p.source_result_id !== c.source_result_id ||
        p.engine_approved !== false || p.production_allowed !== false ||
        p.result_metric !== "university_formula_top_cumulative"
      ) throw fail();
      for (
        const k of [
          "upper_cumulative_percent",
          "strictly_above_percent",
          "tie_share_percent",
        ]
      ) {
        if (
          p[k] !== null &&
          (!text(p[k]) || !/^\d+(?:\.\d+)?$/.test(p[k] as string) ||
            (p[k] as string).length > 128)
        ) throw fail();
      }
      if (
        !["O", "X"].includes(p.eligibility_ox as string) ||
        !["hold", "calculated_model_estimate"].includes(p.status as string) ||
        p.status === "calculated_model_estimate" &&
          (p.upper_cumulative_percent === null ||
            p.strictly_above_percent === null ||
            p.data_kind !== "model_estimated_upper_percentile") ||
        !object(raw.percentileHead) ||
        p.release_id !== raw.percentileHead.release_id
      ) throw fail();
      const fixed = (v: Json): bigint | null => {
        if (v === null) return null;
        const [whole, fraction = ""] = String(v).split(".");
        return BigInt(whole + fraction.padEnd(128, "0"));
      };
      const upper = fixed(p.upper_cumulative_percent),
        above = fixed(p.strictly_above_percent),
        tie = fixed(p.tie_share_percent),
        maximum = 100n * 10n ** 128n;
      if (
        [upper, above, tie].some((n) =>
          n !== null && (n < 0n || n > maximum)
        ) || upper !== null && above !== null && above > upper ||
        upper !== null && above !== null && tie !== null &&
          tie !== upper - above
      ) throw fail();
      const { source_definition_ref, ...safe } = p;
      variants.push({
        ...safe,
        source_definition_fingerprint: source_definition_ref === null
          ? null
          : await currentReviewSha256(source_definition_ref),
        meaning: "과거 입결 점수의 대학식 상위누백",
        comparison_is_actual_applicant_rank: false,
      });
    }
    const reviews: Row[] = [];
    for (const r of selected.percentile_reviews.slice(0, 16)) {
      if (
        !object(r) ||
        !sameJson(Object.keys(r).sort(), [
          "evidence_ref",
          "item",
          "ox",
          "reason_code",
        ]) || !text(r.item) || !["O", "X"].includes(r.ox as string) ||
        !text(r.reason_code) || !text(r.evidence_ref)
      ) throw fail();
      reviews.push({
        item: r.item,
        ox: r.ox,
        reason_code: r.reason_code,
        evidence_fingerprint: await currentReviewSha256(r.evidence_ref),
      });
    }
    if (
      selected.percentiles.length > 16 ||
      selected.percentile_reviews.length > 16
    ) diagnostics.push("diagnostic_items_truncated");
    const state = variants.length > 1
      ? "multiple_variants"
      : variants.length === 1
      ? String(variants[0].status)
      : c.active_service === false
      ? "inactive_source"
      : raw.percentileHead === null
      ? "percentile_release_not_registered"
      : "not_reviewed_in_current_percentile_release";
    if (variants.length === 0) reasons.push(state);
    const digest = await currentReviewSha256({
      current: c,
      members: selected.members,
      population: selected.population,
      percentiles: selected.percentiles,
      reviews: selected.percentile_reviews,
      heads: b.sourceStateSha256,
    });
    items.push({
      observation_token: await cipher.seal(
        { ...b, sourceStateSha256: digest },
        key,
      ),
      academic_year: c.academic_year,
      university: c.university,
      department: c.department,
      track: c.track,
      recruit_group: c.recruit_group,
      metric_kind: c.metric_kind,
      metric_value_literal:
        ["object", "array"].includes(c.metric_value_json_type as string)
          ? null
          : c.metric_value_literal,
      metric_value_json_type: c.metric_value_json_type,
      metric_value_numeric_text: c.metric_value_numeric,
      cohort: c.cohort,
      statistic_label: c.statistic_label,
      source_member_count: c.source_member_count,
      link_scopes: scopes,
      official_metadata: {
        metric_definition: null,
        unit: null,
        original_scale: null,
        source_url: safeSourceUrl(c.source_location),
        source_as_of: null,
        publication_status: null,
      },
      review_status: "owner_inspection_only",
      value_availability: value.availability,
      hold_reasons: reasons,
      canonical_result_id: c.canonical_result_id,
      source_result_id: c.source_result_id,
      offering_pk: c.offering_pk,
      active_service: c.active_service,
      management_status: c.management_status,
      overlap_review_key: c.overlap_review_key,
      row_fingerprint: c.row_fingerprint,
      source_row_fingerprint: c.source_row_fingerprint,
      source_reference: {
        source_sha256: c.source_sha256,
        source_review_status: c.source_review_status,
      },
      diagnostics: {
        missing_current_fields: missing,
        integrity_reasons: diagnostics,
        overlap_marker_present: c.overlap_review_key !== null &&
          c.overlap_review_key !== "",
        multiple_sources_is_duplicate: false,
        expected_offering_roster_anti_join: "NOT_RUN",
      },
      calculated_percentiles: variants,
      percentile_reviews: reviews,
      percentile_state: state,
    });
  }
  if (!Object.hasOwn(raw, "scanNextKey") || raw.scanNextKey === undefined) {
    throw fail();
  }
  if (raw.scanNextKey !== null && raw.scanNextKey !== undefined) {
    const k = raw.scanNextKey;
    if (
      k[0] !== 2024 || k[1] !== "CURRENT_REVIEW_LIVE" ||
      k[2] !== "CANONICAL_OBSERVATIONS" || k[3] !== "" ||
      after && compareCurrentKeys(after, k) >= 0
    ) throw fail();
  }
  let resume: CurrentKey | null = null;
  if (raw.rows.length > q.limit) resume = keys[q.limit - 1];
  else if (raw.scanNextKey !== undefined && raw.scanNextKey !== null) {
    resume = raw.scanNextKey;
    if (previous && compareCurrentKeys(resume, previous) < 0) throw fail();
  }
  const next = resume === null
    ? null
    : await new EncryptedCurrentCursor(secret).seal(b, resume);
  return {
    format: OWNER_REVIEW_PAGE_FORMAT,
    status: "review",
    query_mode: "live_bounded",
    count_status: "unknown",
    items: items.slice(0, q.limit),
    matching_observation_count: null,
    matching_source_school_count: null,
    review_version: d.projection.version,
    as_of: utcText(raw.asOf),
    next_cursor: next,
    publication_status: "not_published",
    source_version: {
      admission_command_id: raw.commandId,
      admission_command_sha256: raw.commandSha256,
      percentile_head: raw.percentileHead ?? null,
    },
    current_scope: {
      mode: "all_current",
      activity_filter: q.activity ?? "all",
      scan_rows: 128,
      scanned_rows: raw.scannedRows ?? null,
      window_complete: next === null,
      empty_items_is_global_no_match: next === null,
    },
    approval_expires_at: d.approval.expires_at,
    expected_offering_roster_anti_join: "NOT_RUN",
    engine_approved: false,
    production_allowed: false,
  };
}
