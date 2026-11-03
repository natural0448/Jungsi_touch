/** REVIEW ONLY: P1 current-page application candidate; no route, authority or storage adapter.
 * Existing history.snapshot.head/read, their compressed bytes and ETags are unchanged. */
import { AccessError } from "./access.ts";
import type { RequestClockPort } from "./ports.ts";
import { sessionDto, type SessionSnapshot } from "./session_service.ts";
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { hasAsciiControl } from "../domain/text.ts";
import { calendarDate, utcInstant } from "../domain/time.ts";

export type CurrentPageExecution = Readonly<{
  operation: "history.current-page";
  session: SessionSnapshot;
  query: Readonly<Record<string, string>>;
}>;
export type CurrentPageBoundary = Readonly<
  { signal: AbortSignal; admission?: unknown }
>;
export type PhysicalKey = Readonly<{
  release_id: string;
  academic_year: number;
  offering_pk: string;
  /** An attribute, not part of the physical PK. */
  school_id: string;
}>;
export type CurrentPagePins = Readonly<{
  subject: string;
  snapshot_id: string;
  snapshot_publication_sha256: string;
  snapshot_source_head_sha256: string;
  snapshot_scope_sha256: string;
  /** Composite Guide membership is defined by the independently approved head,
   * never by a single row's release_id. */
  guide_publication_sha256: string;
  guide_head_sha256: string;
  decision_scope_sha256: string;
  expires_at_utc: bigint;
}>;
export type CurrentPageQuery = Readonly<{
  university_q: string;
  department_q: string;
  region: string;
  group: string;
  limit: number;
}>;
export type CurrentPageLimits = Readonly<{
  max_cursor_chars: number;
  max_position_chars: number;
  max_text_chars: number;
  max_history_claims: number;
  max_metrics_per_claim: number;
  max_result_bytes: number;
}>;
export type CurrentOffering = Readonly<{
  key: PhysicalKey;
  university_name: string | null;
  region: string | null;
  campus: string | null;
  department: string | null;
  admission_track: string | null;
  group: string | null;
}>;
export type QuotaDecision = Readonly<{
  target: PhysicalKey;
  decision: "INCLUDE" | "HOLD" | "EXCLUDE";
  /** Supplied only by the approved same-head decision provider. */
  quota:
    | Readonly<{
      value: NativeJson;
      status: "verified_official" | "pending_value_missing" | "not_published";
      stage: "initial" | "final" | "unknown";
      unit: string | null;
      condition: "none" | "conditional" | "unknown";
      condition_text: string | null;
      source_url: string | null;
      source_as_of: string | null;
      /** Optional exact pre-existing public quota fields, including absent vs null. */
      source_quota?: Readonly<{
        quota_value?: NativeJson;
        quota_literal_state?: string | null;
        quota_stage?: string | null;
        quota_condition_text?: string | null;
        quota_cell?:
          | Readonly<
            {
              status?: string | null;
              reason_code?: string | null;
              unit?: string | null;
              source_as_of?: string | null;
            }
          >
          | null;
      }>;
    }>
    | null;
}>;
/** The only source context already allowed by the snapshot public contract.
 * Shape validation does not prove approval, snapshot membership, or variant identity. */
export type HistorySourceContext = Readonly<{
  observation_id: string;
  identity_variant_index: number;
  scope_status: "source_consistent" | "review_pending";
}>;
export type HistoryMetricData = Readonly<{
  value: NativeJson;
  status:
    | "verified_official"
    | "pending_metadata"
    | "pending_value_type"
    | "pending_value_missing"
    | "not_published";
  unit: string | null;
  reason_code: string | null;
  statistic_label: string | null;
  cohort: string | null;
  source_url: string | null;
  source_as_of: string | null;
  source_context: HistorySourceContext | null;
  /** Public metadata is optional: preserve whether an original field was absent. */
  metric_definition?: string | null;
  value_json_type?: string | null;
  original_scale?: NativeJson;
  stage?: "initial" | "carryover" | "final" | "unspecified" | null;
  statistic_percent?: number | null;
  basis_code?: string | null;
  basis_label?: string | null;
  cohort_code?: string | null;
  cohort_label?: string | null;
  selection_rule_ref?: string | null;
  score_calculation_context?:
    | Readonly<
      {
        source_result_year: number;
        score_calculation_year: number | null;
        observation_role:
          | "actual_result"
          | "prior_year_recalculated_reference"
          | "unresolved";
      }
    >
    | null;
  publication_context?:
    | Readonly<
      {
        publication_role:
          | "actual_result"
          | "simulation_reference"
          | "unresolved";
        simulation_target_academic_year: number | null;
      }
    >
    | null;
}>;
export type HistoryMetric =
  & HistoryMetricData
  & Readonly<{
    field:
      | "recruitment_count_with_stage"
      | "competition_ratio"
      | "additional_admission_count"
      | "final_additional_admission_rank"
      | "final_50_percent_cut"
      | "final_70_percent_cut"
      | "alternate_cut";
    /** Only the outer alternate-cut cell has a bounded list and omitted count. */
    entries?: readonly HistoryMetricData[];
    omitted_other_basis_count?: number;
  }>;
export type HistoricalCondition = Readonly<{
  stage: "initial" | "final" | "unknown";
  condition: "none" | "conditional" | "unknown";
  condition_text: string | null;
}>;
export type HistoryClaim = Readonly<{
  /** Snapshot-local opaque claim, never a source hash. */
  claim_id: string;
  target: PhysicalKey;
  source: PhysicalKey;
  campus: string | null;
  admission_track: string | null;
  group: string | null;
  /** Approved public observation handle, not a private source ID/hash. */
  observation_id: string;
  metrics: readonly HistoryMetric[];
  /** Original condition and stage from the approved previous-year source, if available. */
  historical_condition: HistoricalCondition | null;
  /** Opaque server proof. Never emitted in a DTO or accepted from a client. */
  relation_proof: unknown;
}>;
export type CurrentPagePortContext = Readonly<{
  execution: CurrentPageExecution;
  boundary: CurrentPageBoundary;
  pins: CurrentPagePins;
}>;
/** Server authority must verify same request, active session/admission, current approved
 * snapshot and composite Guide head independently, scope revision and expiry. */
export interface CurrentPageAuthority {
  begin(
    execution: CurrentPageExecution,
    boundary: CurrentPageBoundary,
  ): Promise<CurrentPagePins>;
  assertCurrent(context: CurrentPagePortContext): Promise<void>;
  /** Classify each physical key against this request's approved composite Guide
   * head. A release string is not proof. HOLD covers unresolved public-ID
   * collisions anywhere in the head, including beyond this page. */
  classifyGuideMembership(
    context: CurrentPagePortContext,
    keys: readonly PhysicalKey[],
  ): Promise<
    readonly Readonly<{ target: PhysicalKey; decision: "VERIFIED" | "HOLD" }>[]
  >;

  classifyTargets(
    context: CurrentPagePortContext,
    keys: readonly PhysicalKey[],
  ): Promise<readonly QuotaDecision[]>;
  /** Must independently verify each exact pair including source/target release+year+PK,
   * admission/track/group/cohort, approved crosswalk, relationship meaning and whether
   * the referenced observation is the single approved original. One observation linked
   * to multiple targets is not, by itself, an individual result for each target.
   * Authority decisions must cover relationships beyond this page; source claim fields
   * and a status string alone are not themselves authority. */
  verifyRelations(
    context: CurrentPagePortContext,
    claims: readonly HistoryClaim[],
  ): Promise<
    readonly Readonly<{
      claim_id: string;
      decision: "VERIFIED" | "HOLD";
      relationship_kind?:
        | "continuation"
        | "merge"
        | "split"
        | "other_verified"
        | "unknown";
      observation_use?: "individual_result" | "shared_reference" | "unknown";
      origin_verification?: "single_original_verified" | "unknown";
      published_score_individual_inference_allowed?: boolean | null;
    }>[]
  >;
}
export interface CurrentOfferingPagePort {
  /** The approved provider filters confirmed exclusions BEFORE pagination, but HOLD
   * dominates exclusion when scope or relation is unresolved. It may include individually
   * uncertain current candidates as HOLD. Never perform a nationwide count. */
  page(
    context: CurrentPagePortContext,
    query: CurrentPageQuery,
    after: string | null,
  ): Promise<
    Readonly<{
      items: readonly CurrentOffering[];
      next_position: string | null;
      incomplete_before: boolean;
    }>
  >;
}
export interface CurrentHistoryBatchPort {
  /** One bounded batch for this page, not a per-school or per-item lookup. */
  read(
    context: CurrentPagePortContext,
    targets: readonly PhysicalKey[],
  ): Promise<
    Readonly<{
      claims: readonly HistoryClaim[];
      /** Only explicitly complete target entries may be marked complete. */
      complete_targets: readonly PhysicalKey[];
    }>
  >;
}
/** Explicit opt-in when historical relationships have not been reviewed yet.
 * This provider does no I/O and never marks a target complete; it does not grant
 * access or replace the current-row authority, request admission, or head checks.
 * A missing provider remains a configuration error instead of silently falling back. */
export const PENDING_CURRENT_HISTORY: CurrentHistoryBatchPort = Object.freeze({
  read: () =>
    Promise.resolve(Object.freeze({
      claims: Object.freeze([] as HistoryClaim[]),
      complete_targets: Object.freeze([] as PhysicalKey[]),
    })),
});
export type CursorScope = Readonly<
  { pins: CurrentPagePins; query: CurrentPageQuery }
>;
export interface CurrentPageCursorPort {
  /** Existing protected codec must bind purpose, subject, full query, BOTH heads,
   * release/scope and expiry. It must require this request's valid admission on
   * open and seal; mismatch/revocation returns 409. A cursor never grants access. */
  open(
    context: CurrentPagePortContext,
    scope: CursorScope,
    cursor: string,
  ): Promise<
    Readonly<{
      after: string;
      incomplete_before: boolean;
    }>
  >;
  seal(
    context: CurrentPagePortContext,
    scope: CursorScope,
    after: string,
    incomplete: boolean,
  ): Promise<string>;
}
export type VerifiedNullReason = "other_statistic_only" | "three_or_fewer";
export interface CurrentScoreReasonPort {
  /** Optional trusted adapter over the existing independent score-null evidence projector.
   * No port means no asserted reason; generic reason_code/quota is never evidence. */
  project(
    context: CurrentPagePortContext,
    claims: readonly HistoryClaim[],
  ): Promise<
    readonly Readonly<{
      claim_id: string;
      metric_index: number;
      field: "final_50_percent_cut" | "final_70_percent_cut";
      reasons: readonly VerifiedNullReason[];
    }>[]
  >;
}
export interface CurrentConditionComparisonPort {
  /** Independently verify the current and previous-year original conditions, stages and
   * comparison evidence for each exact already-verified relationship. A condition string
   * alone is never a comparison; a missing comparison is always pending. */
  compare(
    context: CurrentPagePortContext,
    current: readonly QuotaDecision[],
    verifiedClaims: readonly HistoryClaim[],
  ): Promise<
    readonly Readonly<{
      claim_id: string;
      status: "changed" | "unchanged" | "pending";
    }>[]
  >;
}
export type VerifiedCarryoverStatus =
  | "unresolved"
  | "confirmed"
  | "not_applicable";
export interface CurrentRecruitmentEvidencePort {
  /** Independent server evidence bound to this request and the exact current Guide
   * physical row. Do not derive carryover from condition text or a numeric literal.
   * `verified_final` requires independent final-stage evidence. */
  verify(
    context: CurrentPagePortContext,
    decisions: readonly QuotaDecision[],
  ): Promise<
    readonly Readonly<{
      target: PhysicalKey;
      finality: "verified_final" | "pending";
      carryover_status: VerifiedCarryoverStatus | "unknown";
    }>[]
  >;
}
export type CurrentPagePorts = Readonly<{
  authority: CurrentPageAuthority | null;
  offerings: CurrentOfferingPagePort | null;
  histories: CurrentHistoryBatchPort | null;
  cursors: CurrentPageCursorPort | null;
  score_reasons?: CurrentScoreReasonPort | null;
  condition_comparisons?: CurrentConditionComparisonPort | null;
  recruitment_evidence?: CurrentRecruitmentEvidencePort | null;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const FIELDS = new Set([
  "recruitment_count_with_stage",
  "competition_ratio",
  "additional_admission_count",
  "final_additional_admission_rank",
  "final_50_percent_cut",
  "final_70_percent_cut",
  "alternate_cut",
]);
const CELL_STATES = new Set([
  "verified_official",
  "pending_metadata",
  "pending_value_type",
  "pending_value_missing",
  "not_published",
]);
function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
function fail(code = "backend_dependency_unavailable", http = 503): never {
  throw new AccessError(code, http);
}
function text(value: unknown, max: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" || value.length === 0 || value.length > max ||
    hasAsciiControl(value)
  ) {
    return fail();
  }
  return value;
}
function publicUrl(value: unknown, max: number): string | null {
  const s = text(value, max, true);
  if (s === null) return null;
  try {
    const u = new URL(s);
    if (
      !["http:", "https:"].includes(u.protocol) || !u.hostname || u.username ||
      u.password ||
      u.hostname.endsWith(".supabase.co") || u.hostname === "localhost" ||
      u.hostname.includes(":") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(
        u.hostname,
      ) ||
      /\/storage\/v1\//.test(decodeURIComponent(u.pathname).toLowerCase()) ||
      [...u.searchParams.keys()].some((k) =>
        /token|authorization|api[_-]?key|signature|credential|secret|password|cookie|^x-amz-|^x-goog-/i
          .test(k)
      ) ||
      /token|api[_-]?key|signature|secret/i.test(u.hash)
    ) throw new Error();
    return s;
  } catch {
    return fail();
  }
}
function nativeScalar(value: unknown): NativeJson {
  if (
    value === null || typeof value === "string" || typeof value === "bigint" ||
    typeof value === "number" && Number.isSafeInteger(value)
  ) return value;
  if (
    value instanceof JsonFloat &&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value.lexeme)
  ) return new JsonFloat(value.lexeme);
  return fail();
}
/** Snapshot server-port DTOs before any subsequent await while retaining native scalar
 * types. Opaque authority proofs are passed separately and never recursively copied. */
function snapshotPlain<T>(value: T, depth = 0): T {
  if (depth > 12) return fail();
  if (
    value === null || typeof value === "string" || typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "number" && Number.isFinite(value)
  ) return value;
  if (value instanceof JsonFloat) return nativeScalar(value) as T;
  if (Array.isArray(value)) {
    if (value.length > 10000 || Object.keys(value).length !== value.length) {
      return fail();
    }
    return Object.freeze(value.map((v) => snapshotPlain(v, depth + 1))) as T;
  }
  if (
    typeof value !== "object" || value === null ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return fail();
  const entries = Object.entries(value);
  if (entries.length > 100) return fail();
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of entries) {
    result[key] = snapshotPlain(item, depth + 1);
  }
  return Object.freeze(result) as T;
}
function zero(value: NativeJson): boolean {
  if (typeof value === "number" || typeof value === "bigint") {
    return value === 0 || value === 0n;
  }
  const raw = value instanceof JsonFloat ? value.lexeme : typeof value === "string" ? value : null;
  if (
    raw === null ||
    !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)
  ) return false;
  const mantissa = raw.replace(/^-/, "").split(/[eE]/, 1)[0].replace(".", "");
  return /^0+$/.test(mantissa);
}
function sourceDate(value: unknown): string | null {
  if (value === null) return null;
  try {
    if (typeof value !== "string") return fail();
    if (value.length === 10) calendarDate(value);
    else utcInstant(value);
    return value;
  } catch {
    return fail();
  }
}
/** Matches the existing history snapshot's required evidence for official values. */
function quotaMetadataPending(q: NonNullable<QuotaDecision["quota"]>): boolean {
  return q.status === "verified_official" &&
    (q.value === null || q.unit === null || q.source_url === null ||
      q.source_as_of === null ||
      typeof q.value === "string" && !q.value.trim());
}
/** Finality and rollover are independent of generic condition text or literal. */
function finalProofPending(
  stage: "initial" | "final" | "unknown",
  evidence:
    | Readonly<{
      finality: "verified_final" | "pending";
      carryover_status: VerifiedCarryoverStatus | "unknown";
    }>
    | undefined,
): boolean {
  return stage === "final" &&
    (evidence?.finality !== "verified_final" ||
      (evidence?.carryover_status !== "confirmed" &&
        evidence?.carryover_status !== "not_applicable"));
}
function sourceQuota(
  value: NonNullable<QuotaDecision["quota"]>["source_quota"],
  quota: NonNullable<QuotaDecision["quota"]>,
  max: number,
): Readonly<{ source: NativeObject; conflict: boolean }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail();
  }
  const result: NativeObject = {};
  let conflict = false;
  if (Object.hasOwn(value, "quota_value")) {
    const raw = nativeScalar(value.quota_value);
    if (typeof raw === "string" && (raw.length > max || hasAsciiControl(raw))) {
      return fail();
    }
    if (nativeJsonText(raw) !== nativeJsonText(nativeScalar(quota.value))) {
      conflict = true;
    }
    result.quota_value = raw;
  }
  for (
    const name of [
      "quota_literal_state",
      "quota_stage",
      "quota_condition_text",
    ] as const
  ) {
    if (Object.hasOwn(value, name)) result[name] = text(value[name], max, true);
  }
  if (
    typeof value.quota_stage === "string" && quota.stage !== "unknown" &&
    value.quota_stage !== quota.stage
  ) conflict = true;
  if (
    Object.hasOwn(value, "quota_condition_text") &&
    value.quota_condition_text !== quota.condition_text
  ) conflict = true;
  // Descriptive source text alone does not classify a rollover condition.
  if (
    ["conditional_transfer", "conditional_carryover", "conditional_rollover"]
      .includes(value.quota_literal_state ?? "") &&
    quota.condition === "none"
  ) conflict = true;
  if (
    value.quota_literal_state === "numeric_literal" &&
    Object.hasOwn(value, "quota_value")
  ) {
    const raw = value.quota_value;
    const numeric = typeof raw === "bigint" ||
      typeof raw === "number" && Number.isSafeInteger(raw) ||
      raw instanceof JsonFloat ||
      typeof raw === "string" &&
        /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw);
    if (!numeric) conflict = true;
  }
  if (Object.hasOwn(value, "quota_cell")) {
    if (value.quota_cell === null) result.quota_cell = null;
    else {
      const cell = value.quota_cell;
      if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
        return fail();
      }
      const safe: NativeObject = {};
      for (const name of ["status", "reason_code", "unit"] as const) {
        if (Object.hasOwn(cell, name)) safe[name] = text(cell[name], max, true);
      }
      if (Object.hasOwn(cell, "source_as_of")) {
        safe.source_as_of = sourceDate(cell.source_as_of);
      }
      result.quota_cell = safe;
    }
  }
  return Object.freeze({ source: result, conflict });
}
function metricDto(
  metric: HistoryMetric,
  sourceYear: number,
  max: number,
  reasons: readonly VerifiedNullReason[],
  alternateEntry = false,
): NativeObject {
  if (
    !metric || !FIELDS.has(metric.field) || !CELL_STATES.has(metric.status) ||
    !Object.hasOwn(metric, "reason_code") ||
    !Object.hasOwn(metric, "source_context") ||
    metric.status !== "verified_official" && metric.reason_code === null ||
    ["pending_value_type", "pending_value_missing", "not_published"].includes(
        metric.status,
      ) && metric.value !== null ||
    metric.status === "verified_official" &&
      (metric.value === null ||
        typeof metric.value === "string" && !metric.value.trim() ||
        metric.unit === null || metric.source_url === null ||
        metric.source_as_of === null) ||
    metric.status === "verified_official" &&
      (metric.field === "final_additional_admission_rank" &&
          metric.unit !== "번" ||
        metric.field === "additional_admission_count" && metric.unit !== "명")
  ) return fail();
  const value = nativeScalar(metric.value);
  if (
    typeof value === "string" && (value.length > max || hasAsciiControl(value))
  ) return fail();
  const reason = text(metric.reason_code, max, true);
  if (typeof reason === "string" && !reason.trim()) return fail();
  let sourceContext: NativeObject | null = null;
  if (metric.source_context !== null) {
    const c = metric.source_context;
    if (
      !c || typeof c !== "object" || Array.isArray(c) ||
      Object.keys(c).length !== 3 ||
      !Object.hasOwn(c, "observation_id") ||
      !Object.hasOwn(c, "identity_variant_index") ||
      !Object.hasOwn(c, "scope_status") ||
      typeof c.observation_id !== "string" ||
      !/^(?:observation|admission):[a-f0-9]{64}$/.test(c.observation_id) ||
      !Number.isSafeInteger(c.identity_variant_index) ||
      c.identity_variant_index < 0 || c.identity_variant_index > 15 ||
      !["source_consistent", "review_pending"].includes(c.scope_status)
    ) return fail();
    sourceContext = {
      observation_id: c.observation_id,
      identity_variant_index: c.identity_variant_index,
      scope_status: c.scope_status,
    };
  }
  if (alternateEntry && value !== null && sourceContext === null) return fail();
  const result: NativeObject = {
    ...(alternateEntry ? {} : { field: metric.field }),
    value,
    status: metric.status,
    unit: text(metric.unit, max, true),
    reason_code: reason,
    statistic_label: text(metric.statistic_label, max, true),
    cohort: text(metric.cohort, max, true),
    source_url: publicUrl(metric.source_url, max),
    source_as_of: sourceDate(metric.source_as_of),
    source_context: sourceContext,
    ...(alternateEntry ? {} : { verified_score_null_reasons: [...reasons] }),
  };
  if (alternateEntry) {
    if (
      metric.field !== "alternate_cut" || Object.hasOwn(metric, "stage") ||
      Object.hasOwn(metric, "entries") ||
      Object.hasOwn(metric, "omitted_other_basis_count")
    ) return fail();
  } else if (metric.field === "alternate_cut") {
    if (
      !Array.isArray(metric.entries) || metric.entries.length > 16 ||
      !Number.isSafeInteger(metric.omitted_other_basis_count) ||
      metric.omitted_other_basis_count! < 0
    ) return fail();
    result.entries = metric.entries.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return fail();
      }
      // Set the discriminator ourselves; never emit arbitrary nested input fields.
      return metricDto(
        { ...entry, field: "alternate_cut" },
        sourceYear,
        max,
        [],
        true,
      );
    });
    result.omitted_other_basis_count = metric.omitted_other_basis_count!;
  } else if (
    Object.hasOwn(metric, "entries") ||
    Object.hasOwn(metric, "omitted_other_basis_count")
  ) return fail();
  if (
    metric.field === "recruitment_count_with_stage" &&
    !Object.hasOwn(metric, "stage")
  ) return fail();
  if (Object.hasOwn(metric, "stage")) {
    if (
      metric.field !== "recruitment_count_with_stage" ||
      !["initial", "carryover", "final", "unspecified"].includes(
        metric.stage ?? "",
      )
    ) return fail();
    result.stage = metric.stage!;
  }
  if (Object.hasOwn(metric, "statistic_percent")) {
    const p = metric.statistic_percent;
    if (
      p !== null && (!Number.isSafeInteger(p) || p! < 1 || p! > 100 ||
        metric.field === "final_50_percent_cut" && p !== 50 ||
        metric.field === "final_70_percent_cut" && p !== 70)
    ) return fail();
    result.statistic_percent = p!;
  }
  for (
    const name of [
      "basis_code",
      "basis_label",
      "cohort_code",
      "cohort_label",
      "selection_rule_ref",
    ] as const
  ) {
    if (Object.hasOwn(metric, name)) {
      result[name] = text(metric[name], max, true);
    }
  }
  for (const name of ["metric_definition", "value_json_type"] as const) {
    if (Object.hasOwn(metric, name)) {
      result[name] = text(metric[name], max, true);
    }
  }
  if (Object.hasOwn(metric, "original_scale")) {
    const scale = nativeScalar(metric.original_scale);
    if (
      typeof scale === "string" &&
      (scale.length > max || hasAsciiControl(scale))
    ) return fail();
    result.original_scale = scale;
  }
  if (Object.hasOwn(metric, "score_calculation_context")) {
    const c = metric.score_calculation_context;
    if (c === null) return fail();
    else {
      if (
        !c || c.source_result_year !== sourceYear ||
        !["actual_result", "prior_year_recalculated_reference", "unresolved"]
          .includes(c.observation_role) ||
        c.score_calculation_year !== null &&
          (!Number.isSafeInteger(c.score_calculation_year) ||
            c.score_calculation_year < 1 || c.score_calculation_year > 9999) ||
        c.observation_role !== "unresolved" &&
          c.score_calculation_year === null ||
        c.observation_role === "actual_result" &&
          c.score_calculation_year !== sourceYear ||
        c.observation_role === "unresolved" &&
          !alternateEntry && metric.value !== null ||
        c.observation_role === "prior_year_recalculated_reference" &&
          (!alternateEntry || c.score_calculation_year! <= sourceYear)
      ) return fail();
      result.score_calculation_context = {
        source_result_year: c.source_result_year,
        score_calculation_year: c.score_calculation_year,
        observation_role: c.observation_role,
      };
    }
  }
  if (Object.hasOwn(metric, "publication_context")) {
    const c = metric.publication_context;
    if (c === null || metric.field === "alternate_cut" && !alternateEntry) {
      return fail();
    } else {
      if (
        !c ||
        !["actual_result", "simulation_reference", "unresolved"].includes(
          c.publication_role,
        ) ||
        c.simulation_target_academic_year !== null &&
          (!Number.isSafeInteger(c.simulation_target_academic_year) ||
            c.simulation_target_academic_year < 1 ||
            c.simulation_target_academic_year > 9999) ||
        c.publication_role !== "simulation_reference" &&
          c.simulation_target_academic_year !== null ||
        c.publication_role === "simulation_reference" && !alternateEntry ||
        c.publication_role === "unresolved" &&
          !alternateEntry && metric.value !== null ||
        c.publication_role === "actual_result" &&
          metric.score_calculation_context?.observation_role ===
            "prior_year_recalculated_reference" ||
        c.publication_role === "simulation_reference" &&
          metric.score_calculation_context?.observation_role === "actual_result"
      ) return fail();
      result.publication_context = {
        publication_role: c.publication_role,
        simulation_target_academic_year: c.simulation_target_academic_year,
      };
    }
  }
  return result;
}
function physical(key: PhysicalKey, year: number | null): PhysicalKey {
  if (
    !key || typeof key !== "object" || !validId(key.release_id) ||
    !validId(key.offering_pk) ||
    !validId(key.school_id) || !Number.isSafeInteger(key.academic_year) ||
    (year !== null ? key.academic_year !== year : ![2024, 2025, 2026].includes(key.academic_year))
  ) return fail();
  return Object.freeze({
    release_id: key.release_id,
    academic_year: key.academic_year,
    offering_pk: key.offering_pk,
    school_id: key.school_id,
  });
}
/** Physical identity intentionally excludes school_id. */
function keyOf(key: PhysicalKey): string {
  return JSON.stringify([key.release_id, key.academic_year, key.offering_pk]);
}
function targetMatches(a: PhysicalKey, b: PhysicalKey): boolean {
  return keyOf(a) === keyOf(b) && a.school_id === b.school_id;
}
function checkPins(
  raw: CurrentPagePins,
  subject: string,
  clock: RequestClockPort,
): CurrentPagePins {
  if (
    !raw || raw.subject !== subject || !validId(raw.snapshot_id) ||
    ![
      raw.snapshot_publication_sha256,
      raw.snapshot_source_head_sha256,
      raw.snapshot_scope_sha256,
      raw.guide_publication_sha256,
      raw.guide_head_sha256,
      raw.decision_scope_sha256,
    ].every((x) => typeof x === "string" && HASH.test(x)) ||
    typeof raw.expires_at_utc !== "bigint" ||
    raw.expires_at_utc <= clock.nowUtc()
  ) return fail();
  // The two source/head lineages are deliberately validated independently.
  return Object.freeze({ ...raw });
}
function queryOf(
  raw: Readonly<Record<string, string>>,
  max: number,
  maxCursor: number,
): { query: CurrentPageQuery; cursor: string | null } {
  if (
    !raw || typeof raw !== "object" ||
    Object.keys(raw).some((k) =>
      !["university_q", "department_q", "region", "group", "limit", "cursor"]
        .includes(k)
    )
  ) return fail("invalid_request", 422);
  const get = (key: string) => {
    const v = raw[key] ?? "";
    if (typeof v !== "string" || v.length > max || hasAsciiControl(v)) {
      return fail("invalid_request", 422);
    }
    return v;
  };
  const limitText = raw.limit ?? "50";
  if (
    typeof limitText !== "string" ||
    !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitText)
  ) return fail("invalid_request", 422);
  const cursor = raw.cursor === undefined ? null : raw.cursor;
  if (
    cursor !== null &&
    (typeof cursor !== "string" || cursor === "" || cursor.length > maxCursor ||
      hasAsciiControl(cursor))
  ) return fail("invalid_request", 422);
  return {
    query: Object.freeze({
      university_q: get("university_q"),
      department_q: get("department_q"),
      region: get("region"),
      group: get("group"),
      limit: Number(limitText),
    }),
    cursor,
  };
}
function limitsOf(v: CurrentPageLimits): CurrentPageLimits {
  if (
    !v || !Number.isSafeInteger(v.max_cursor_chars) || v.max_cursor_chars < 1 ||
    v.max_cursor_chars > 8192 ||
    !Number.isSafeInteger(v.max_position_chars) || v.max_position_chars < 1 ||
    v.max_position_chars > 8192 ||
    !Number.isSafeInteger(v.max_text_chars) || v.max_text_chars < 1 ||
    v.max_text_chars > 4096 ||
    !Number.isSafeInteger(v.max_history_claims) || v.max_history_claims < 1 ||
    v.max_history_claims > 10000 ||
    !Number.isSafeInteger(v.max_metrics_per_claim) ||
    v.max_metrics_per_claim < 1 || v.max_metrics_per_claim > 100 ||
    !Number.isSafeInteger(v.max_result_bytes) || v.max_result_bytes < 1 ||
    v.max_result_bytes > 8 * 1024 * 1024
  ) return fail();
  return Object.freeze({ ...v });
}

/** The route/dispatcher and all real server authorities must be registered separately. */
export class HistoryCurrentPageService {
  private readonly limits: CurrentPageLimits;
  constructor(
    private readonly ports: CurrentPagePorts,
    private readonly clock: RequestClockPort,
    limits: CurrentPageLimits,
  ) {
    this.limits = limitsOf(limits);
  }
  async execute(
    execution: CurrentPageExecution,
    boundary: CurrentPageBoundary,
  ): Promise<NativeObject> {
    const p = this.ports, l = this.limits;
    if (
      !execution || execution.operation !== "history.current-page" ||
      !execution.session?.user ||
      !boundary || !(boundary.signal instanceof AbortSignal) ||
      boundary.signal.aborted || !boundary.admission ||
      !p?.authority ||
      typeof p.authority.classifyGuideMembership !== "function" ||
      !p.offerings || !p.histories || !p.cursors
    ) return fail("security_policy_unavailable");
    const session = execution.session,
      user = session.user,
      subject = user.subjectId;
    const signal = boundary.signal,
      admission = boundary.admission,
      originalQuery = execution.query;
    let queryEntries: readonly (readonly [string, string])[] | null = null;
    const check = () => {
      if (
        execution.operation !== "history.current-page" ||
        execution.query !== originalQuery ||
        execution.session !== session || session.user !== user ||
        user.subjectId !== subject ||
        boundary.signal !== signal || signal.aborted ||
        boundary.admission !== admission
      ) return fail();
      if (
        queryEntries &&
        (Object.keys(originalQuery).length !== queryEntries.length ||
          queryEntries.some(([key, value]) =>
            !Object.hasOwn(originalQuery, key) || originalQuery[key] !== value
          ))
      ) return fail();
      sessionDto(session, this.clock.nowUtc());
    };
    check();
    const input = queryOf(
      execution.query,
      l.max_text_chars,
      l.max_cursor_chars,
    );
    queryEntries = Object.freeze(
      Object.entries(originalQuery).map(([k, v]) => Object.freeze([k, v] as const)),
    );
    check();
    const pins = checkPins(
      await p.authority.begin(execution, boundary),
      subject,
      this.clock,
    );
    const context = Object.freeze({ execution, boundary, pins });
    const current = async () => {
      check();
      if (await p.authority!.assertCurrent(context) !== undefined) {
        return fail();
      }
      check();
      if (pins.expires_at_utc <= this.clock.nowUtc()) return fail();
    };
    const scope = Object.freeze({ pins, query: input.query });
    await current();
    let after: string | null = null, incompleteBefore = false;
    if (input.cursor !== null) {
      const decoded = await p.cursors.open(context, scope, input.cursor);
      check();
      if (!decoded || typeof decoded.incomplete_before !== "boolean") {
        return fail();
      }
      after = text(decoded.after, l.max_position_chars)!;
      incompleteBefore = decoded.incomplete_before;
    }
    const rawPage = await p.offerings.page(context, input.query, after);
    check();
    if (
      !rawPage || !Array.isArray(rawPage.items) ||
      rawPage.items.length > input.query.limit ||
      typeof rawPage.incomplete_before !== "boolean" ||
      !(rawPage.next_position === null ||
        typeof rawPage.next_position === "string")
    ) return fail();
    const next = rawPage.next_position === null
      ? null
      : text(rawPage.next_position, l.max_position_chars);
    if (next !== null && next === after) return fail();
    const page = rawPage.items.map((row) => {
      if (!row || typeof row !== "object") return fail();
      const key = physical(row.key, 2027);
      return Object.freeze({ ...row, key });
    });
    const keys = page.map((r) => r.key), keySet = new Set(keys.map(keyOf));
    if (keySet.size !== keys.length) return fail();
    // A public-ID collision is one ambiguous target, not two individual results.
    const publicId = (key: PhysicalKey) => JSON.stringify([key.academic_year, key.offering_pk]);
    const publicCounts = new Map<string, number>();
    for (const key of keys) {
      publicCounts.set(
        publicId(key),
        (publicCounts.get(publicId(key)) ?? 0) + 1,
      );
    }
    const memberships = keys.length
      ? await p.authority.classifyGuideMembership(context, Object.freeze(keys))
      : [];
    check();
    if (!Array.isArray(memberships) || memberships.length !== keys.length) {
      return fail();
    }
    const byMembership = new Map<string, "VERIFIED" | "HOLD">();
    for (const membership of memberships) {
      if (!membership || !["VERIFIED", "HOLD"].includes(membership.decision)) {
        return fail();
      }
      const target = physical(membership.target, 2027), id = keyOf(target);
      const original = keys.find((key) => keyOf(key) === id);
      if (
        !original || !targetMatches(target, original) || byMembership.has(id)
      ) return fail();
      byMembership.set(id, membership.decision);
    }
    await current();
    const admittedKeys = keys.filter((key) =>
      byMembership.get(keyOf(key)) === "VERIFIED" &&
      publicCounts.get(publicId(key)) === 1
    );
    const scopeRows = admittedKeys.length
      ? await p.authority.classifyTargets(context, Object.freeze(admittedKeys))
      : [];
    check();
    if (!Array.isArray(scopeRows) || scopeRows.length !== admittedKeys.length) {
      return fail();
    }
    const decisions = new Map<string, QuotaDecision>();
    for (const value of scopeRows) {
      if (!value || !["INCLUDE", "HOLD", "EXCLUDE"].includes(value.decision)) {
        return fail();
      }
      const target = physical(value.target, 2027),
        k = keyOf(target),
        original = admittedKeys.find((x) => keyOf(x) === k);
      if (
        !original || !targetMatches(target, original) || decisions.has(k) ||
        value.decision === "EXCLUDE"
      ) return fail();
      if (
        value.decision === "HOLD" && value.quota !== null ||
        value.decision === "INCLUDE" && !value.quota
      ) return fail();
      decisions.set(k, snapshotPlain(value));
    }
    const stableScopeRows = Object.freeze([...decisions.values()]);
    const sourceQuotaByTarget = new Map<
      string,
      Readonly<{ source: NativeObject; conflict: boolean }>
    >();
    for (const row of stableScopeRows) {
      if (
        row.decision === "INCLUDE" && row.quota &&
        Object.hasOwn(row.quota, "source_quota")
      ) {
        sourceQuotaByTarget.set(
          keyOf(row.target),
          sourceQuota(row.quota.source_quota, row.quota, l.max_text_chars),
        );
      }
    }
    const recruitmentEvidence = p.recruitment_evidence && stableScopeRows.length
      ? await p.recruitment_evidence.verify(context, stableScopeRows)
      : [];
    check();
    if (
      !Array.isArray(recruitmentEvidence) ||
      recruitmentEvidence.length > keys.length
    ) return fail();
    const evidenceByTarget = new Map<
      string,
      {
        finality: "verified_final" | "pending";
        carryover_status: VerifiedCarryoverStatus | "unknown";
      }
    >();
    for (const evidence of recruitmentEvidence) {
      if (
        !evidence ||
        !["verified_final", "pending"].includes(evidence.finality) ||
        !["unresolved", "confirmed", "not_applicable", "unknown"].includes(
          evidence.carryover_status,
        )
      ) return fail();
      const target = physical(evidence.target, 2027), key = keyOf(target);
      const expected = keys.find((k) => keyOf(k) === key);
      if (
        !expected || !targetMatches(target, expected) ||
        decisions.get(key)?.decision !== "INCLUDE" || evidenceByTarget.has(key)
      ) return fail();
      evidenceByTarget.set(
        key,
        Object.freeze({
          finality: evidence.finality,
          carryover_status: evidence.carryover_status,
        }),
      );
    }
    await current();
    const eligible = admittedKeys.filter((k) => decisions.get(keyOf(k))?.decision === "INCLUDE");
    const history = eligible.length
      ? await p.histories.read(context, Object.freeze(eligible))
      : { claims: [], complete_targets: [] };
    check();
    if (
      !history || !Array.isArray(history.claims) ||
      history.claims.length > l.max_history_claims ||
      !Array.isArray(history.complete_targets) ||
      history.complete_targets.length > eligible.length
    ) return fail();
    const eligibleMap = new Map(eligible.map((x) => [keyOf(x), x]));
    const complete = new Set<string>();
    for (const raw of history.complete_targets) {
      const k = physical(raw, 2027),
        id = keyOf(k),
        target = eligibleMap.get(id);
      if (!target || !targetMatches(k, target) || complete.has(id)) {
        return fail();
      }
      complete.add(id);
    }
    const claimIds = new Set<string>(), relationIds = new Set<string>();
    const claims: HistoryClaim[] = history.claims.map((claim: HistoryClaim) => {
      if (
        !claim || typeof claim !== "object" || !validId(claim.claim_id) ||
        !validId(claim.observation_id) ||
        claimIds.has(claim.claim_id) || !Array.isArray(claim.metrics) ||
        claim.metrics.length > l.max_metrics_per_claim ||
        claim.relation_proof === null || claim.relation_proof === undefined
      ) return fail();
      // Bound nested work before copying any provider object; 16 is the snapshot limit.
      let metricCells = claim.metrics.length;
      for (const metric of claim.metrics) {
        if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
          return fail();
        }
        if (metric.field === "alternate_cut") {
          if (!Array.isArray(metric.entries) || metric.entries.length > 16) {
            return fail();
          }
          metricCells += metric.entries.length;
        }
      }
      if (metricCells > l.max_metrics_per_claim) return fail();
      const target = physical(claim.target, 2027),
        source = physical(claim.source, null),
        k = keyOf(target);
      const expected = eligibleMap.get(k);
      if (!expected || !targetMatches(target, expected)) return fail();
      const relation = JSON.stringify([k, keyOf(source), claim.observation_id]);
      if (relationIds.has(relation)) return fail();
      relationIds.add(relation);
      claimIds.add(claim.claim_id);
      return Object.freeze({
        ...claim,
        target,
        source,
        metrics: Object.freeze(
          claim.metrics.map((metric: HistoryMetric) => snapshotPlain(metric)),
        ),
        historical_condition: snapshotPlain(claim.historical_condition),
      });
    });
    const proofs = claims.length
      ? await p.authority.verifyRelations(context, Object.freeze(claims))
      : [];
    check();
    if (!Array.isArray(proofs) || proofs.length !== claims.length) {
      return fail();
    }
    const proofById = new Map<string, "VERIFIED" | "HOLD">();
    const relationMeaning = new Map<
      string,
      Readonly<{
        relationship_kind:
          | "continuation"
          | "merge"
          | "split"
          | "other_verified";
        observation_use: "individual_result" | "shared_reference";
        origin_verification: "single_original_verified";
        published_score_individual_inference_allowed: boolean;
      }>
    >();
    for (const proof of proofs) {
      if (
        !proof || !claimIds.has(proof.claim_id) ||
        proofById.has(proof.claim_id) ||
        !["VERIFIED", "HOLD"].includes(proof.decision)
      ) return fail();
      const meaningful = proof.decision === "VERIFIED" &&
        ["continuation", "merge", "split", "other_verified"].includes(
          proof.relationship_kind ?? "",
        ) &&
        ["individual_result", "shared_reference"].includes(
          proof.observation_use ?? "",
        ) &&
        proof.origin_verification === "single_original_verified" &&
        (proof.observation_use === "individual_result" &&
            proof.published_score_individual_inference_allowed === true ||
          proof.observation_use === "shared_reference" &&
            proof.published_score_individual_inference_allowed === false);
      proofById.set(proof.claim_id, meaningful ? "VERIFIED" : "HOLD");
      if (meaningful) {
        relationMeaning.set(
          proof.claim_id,
          Object.freeze({
            relationship_kind: proof.relationship_kind!,
            observation_use: proof.observation_use!,
            origin_verification: proof.origin_verification!,
            published_score_individual_inference_allowed: proof
              .published_score_individual_inference_allowed!,
          }),
        );
      }
    }
    // Defend against claiming the same original is multiple individual results in
    // this page. An authority must also perform this verification across pages.
    const observationGroups = new Map<string, HistoryClaim[]>();
    for (const claim of claims) {
      if (proofById.get(claim.claim_id) !== "VERIFIED") continue;
      const group = observationGroups.get(claim.observation_id) ?? [];
      group.push(claim);
      observationGroups.set(claim.observation_id, group);
    }
    for (const group of observationGroups.values()) {
      if (group.length < 2) continue;
      const sources = new Set(group.map((c) => keyOf(c.source)));
      const metrics = new Set(
        group.map((c) => nativeJsonText(c.metrics, true)),
      );
      const targets = new Set(group.map((c) => keyOf(c.target)));
      for (const claim of group) {
        if (
          sources.size > 1 || metrics.size > 1 || targets.size > 1 &&
            relationMeaning.get(claim.claim_id)?.observation_use ===
              "individual_result"
        ) {
          proofById.set(claim.claim_id, "HOLD");
          relationMeaning.delete(claim.claim_id);
        }
      }
    }
    const verified = claims.filter((x) => proofById.get(x.claim_id) === "VERIFIED");
    const rawReasons = p.score_reasons && verified.length
      ? await p.score_reasons.project(context, Object.freeze(verified))
      : [];
    check();
    if (
      !Array.isArray(rawReasons) ||
      rawReasons.length > verified.length * l.max_metrics_per_claim
    ) return fail();
    const reasons = new Map<string, readonly VerifiedNullReason[]>();
    for (const r of rawReasons) {
      const claim = verified.find((x) => x.claim_id === r?.claim_id);
      const metric = claim && Number.isSafeInteger(r.metric_index) && r.metric_index >= 0
        ? claim.metrics[r.metric_index]
        : undefined;
      const key = JSON.stringify([r?.claim_id, r?.metric_index]);
      if (
        !claim || !metric || metric.field !== r.field ||
        !["final_50_percent_cut", "final_70_percent_cut"].includes(r.field) ||
        metric.value !== null ||
        !["pending_value_missing", "not_published"].includes(metric.status) ||
        !Array.isArray(r.reasons) || r.reasons.length > 2 ||
        new Set(r.reasons).size !== r.reasons.length ||
        r.reasons.some((x: VerifiedNullReason) =>
          !["other_statistic_only", "three_or_fewer"].includes(x)
        ) || reasons.has(key)
      ) return fail();
      reasons.set(key, Object.freeze([...r.reasons]));
    }
    const comparisons = p.condition_comparisons && verified.length
      ? await p.condition_comparisons.compare(
        context,
        stableScopeRows,
        Object.freeze(verified),
      )
      : [];
    check();
    if (!Array.isArray(comparisons) || comparisons.length > verified.length) {
      return fail();
    }
    const comparisonsByClaim = new Map<
      string,
      "changed" | "unchanged" | "pending"
    >();
    for (const comparison of comparisons) {
      const claim = verified.find((x) => x.claim_id === comparison?.claim_id);
      const currentQuota = claim ? decisions.get(keyOf(claim.target))?.quota : null;
      const recruitmentProof = claim ? evidenceByTarget.get(keyOf(claim.target)) : undefined;
      const finalPending = currentQuota
        ? finalProofPending(currentQuota.stage, recruitmentProof)
        : false;
      const sourceConflict = claim &&
        sourceQuotaByTarget.get(keyOf(claim.target))?.conflict === true;
      if (
        !claim || comparisonsByClaim.has(claim.claim_id) ||
        !["changed", "unchanged", "pending"].includes(comparison.status)
      ) return fail();
      if (
        // A verified older relation may still be displayed as historical data,
        // but it cannot stand in for the exact previous academic year.
        claim.source.academic_year !== claim.target.academic_year - 1 ||
        finalPending || sourceConflict ||
        currentQuota && quotaMetadataPending(currentQuota)
      ) {
        comparisonsByClaim.set(claim.claim_id, "pending");
        continue;
      }
      if (
        comparison.status !== "pending" &&
        (!claim.historical_condition ||
          claim.historical_condition.stage === "unknown" ||
          claim.historical_condition.condition === "unknown" ||
          !currentQuota || currentQuota.stage === "unknown" ||
          currentQuota.condition === "unknown")
      ) {
        // A comparison claim cannot prove missing current or previous conditions.
        // Hold this relation only; unrelated verified recruitment rows remain usable.
        comparisonsByClaim.set(claim.claim_id, "pending");
        continue;
      }
      comparisonsByClaim.set(claim.claim_id, comparison.status);
    }
    let incomplete = incompleteBefore || rawPage.incomplete_before;
    const seenPublicIds = new Set<string>();
    const visiblePage = page.filter((row) => {
      const id = publicId(row.key);
      if (seenPublicIds.has(id)) return false;
      seenPublicIds.add(id);
      return true;
    });
    const items: NativeJson[] = visiblePage.map((row) => {
      const heldByMembership = byMembership.get(keyOf(row.key)) !== "VERIFIED" ||
        publicCounts.get(publicId(row.key)) !== 1;
      const decision = decisions.get(keyOf(row.key));
      if (heldByMembership || decision?.decision === "HOLD") {
        incomplete = true;
        return {
          status: "pending",
          offering: null,
          recruitment: null,
          history: { status: "pending", items: [] },
        };
      }
      if (!decision) return fail();
      const q = decision.quota!;
      const evidence = evidenceByTarget.get(keyOf(row.key));
      const sourceProjection = sourceQuotaByTarget.get(keyOf(row.key));
      const sourceConflict = sourceProjection?.conflict === true;
      const metadataPending = quotaMetadataPending(q);
      const carryover = evidence?.carryover_status ?? "unknown";
      const needsFinalProof = q.stage === "final";
      const finalPending = finalProofPending(q.stage, evidence);
      if (
        !["verified_official", "pending_value_missing", "not_published"]
          .includes(q.status) ||
        !["initial", "final", "unknown"].includes(q.stage) ||
        !["none", "conditional", "unknown"].includes(q.condition) ||
        q.status !== "verified_official" && q.value !== null ||
        q.stage === "final" && zero(q.value) && !finalPending &&
          !sourceConflict && !metadataPending
      ) return fail();
      const value = nativeScalar(q.value);
      if (
        typeof value === "string" &&
        (value.length > l.max_text_chars || hasAsciiControl(value))
      ) return fail();
      const recruitment: NativeObject = {
        value,
        status: sourceConflict
          ? "pending_source_conflict"
          : metadataPending
          ? "pending_metadata"
          : finalPending && q.status === "verified_official"
          ? "pending_finality"
          : q.status,
        source_status: q.status,
        stage: finalPending || sourceConflict || metadataPending ? "unknown" : q.stage,
        source_stage: sourceProjection &&
            Object.hasOwn(sourceProjection.source, "quota_stage")
          ? sourceProjection.source.quota_stage
          : q.stage,
        decision_stage: q.stage,
        unit: text(q.unit, l.max_text_chars, true),
        condition: sourceConflict ? "unknown" : q.condition,
        decision_condition: q.condition,
        condition_text: text(q.condition_text, l.max_text_chars, true),
        source_url: publicUrl(q.source_url, l.max_text_chars),
        source_as_of: sourceDate(q.source_as_of),
        carryover_status: carryover,
        finality: sourceConflict || finalPending || metadataPending
          ? "pending"
          : needsFinalProof
          ? evidence?.finality ?? "pending"
          : "not_required",
      };
      if (sourceProjection) recruitment.source_quota = sourceProjection.source;
      const currentClaims = claims.filter((c) => keyOf(c.target) === keyOf(row.key));
      const historyPending = !complete.has(keyOf(row.key)) ||
        currentClaims.some((c) =>
          proofById.get(c.claim_id) !== "VERIFIED" ||
          c.metrics.some((m) =>
            ["pending_metadata", "pending_value_type", "pending_value_missing"]
              .includes(m.status)
          )
        );
      const historyItems: NativeJson[] = [];
      for (const claim of currentClaims) {
        if (proofById.get(claim.claim_id) !== "VERIFIED") continue;
        const originalCondition = claim.historical_condition;
        if (
          originalCondition !== null &&
          (!originalCondition ||
            !["initial", "final", "unknown"].includes(
              originalCondition.stage,
            ) ||
            !["none", "conditional", "unknown"].includes(
              originalCondition.condition,
            ))
        ) return fail();
        const historicalCondition: NativeObject | null = originalCondition === null ? null : {
          stage: originalCondition.stage,
          condition: originalCondition.condition,
          condition_text: text(
            originalCondition.condition_text,
            l.max_text_chars,
            true,
          ),
        };
        const metrics: NativeJson[] = claim.metrics.map((
          metric: HistoryMetric,
          index: number,
        ) =>
          metricDto(
            metric,
            claim.source.academic_year,
            l.max_text_chars,
            reasons.get(JSON.stringify([claim.claim_id, index])) ?? [],
          )
        );
        historyItems.push({
          academic_year: claim.source.academic_year,
          university_id: claim.source.school_id,
          offering_id: `${claim.source.academic_year}:${claim.source.offering_pk}`,
          campus: text(claim.campus, l.max_text_chars, true),
          admission_track: text(claim.admission_track, l.max_text_chars, true),
          group: text(claim.group, l.max_text_chars, true),
          observation_id: claim.observation_id,
          relationship_kind: relationMeaning.get(claim.claim_id)!.relationship_kind,
          observation_use: relationMeaning.get(claim.claim_id)!.observation_use,
          origin_verification: relationMeaning.get(claim.claim_id)!.origin_verification,
          published_score_individual_inference_allowed: relationMeaning.get(claim.claim_id)!
            .published_score_individual_inference_allowed,
          historical_condition: historicalCondition,
          condition_comparison: comparisonsByClaim.get(claim.claim_id) ??
            "pending",
          metrics,
        });
      }
      if (
        historyPending || q.status !== "verified_official" ||
        q.stage === "unknown" || q.condition === "unknown" || finalPending ||
        sourceConflict || metadataPending ||
        carryover === "unresolved"
      ) incomplete = true;
      return {
        status: historyPending || q.status !== "verified_official" ||
            q.stage === "unknown" || q.condition === "unknown" ||
            finalPending || sourceConflict || metadataPending ||
            carryover === "unresolved"
          ? "pending"
          : "ready",
        offering: {
          offering_id: `2027:${row.key.offering_pk}`,
          academic_year: 2027,
          university_id: row.key.school_id,
          university_name: text(row.university_name, l.max_text_chars, true),
          region: text(row.region, l.max_text_chars, true),
          campus: text(row.campus, l.max_text_chars, true),
          department: text(row.department, l.max_text_chars, true),
          admission_track: text(row.admission_track, l.max_text_chars, true),
          group: text(row.group, l.max_text_chars, true),
        },
        recruitment,
        history: {
          status: historyPending ? "pending" : "ready",
          items: historyItems,
        },
      };
    });
    await current();
    const nextCursor = next === null
      ? null
      : await p.cursors.seal(context, scope, next, incomplete);
    check();
    if (nextCursor !== null) text(nextCursor, l.max_cursor_chars);
    await current();
    const result: NativeObject = {
      format: "jungsi.p1-current-page/v1",
      status: incomplete ? "pending" : "ready",
      items,
      next_cursor: nextCursor,
      matching_count: null,
    };
    if (
      new TextEncoder().encode(nativeJsonText(result)).length >
        l.max_result_bytes
    ) return fail();
    return result;
  }
}
