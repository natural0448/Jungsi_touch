/**
 * REVIEW ONLY: batch re-evaluation of historical numeric references. Legacy
 * pending_metadata/review_pending labels do not themselves prove a missing source.
 * No source issuer, route, schema, production approval or runtime is installed.
 */
import { AccessError } from "./access.ts";
import { requireVoidDrains } from "./reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { exact } from "../domain/exact.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";

export type HistoricalNumericQuery = Readonly<{
  academicYear: 2024 | 2025 | 2026;
  schoolId: string;
  offeringPk: string;
  cutoff: "final_50_percent_cut" | "final_70_percent_cut" | "alternate_cut";
}>;
export type HistoricalNumericSourceRow = Readonly<{
  query: HistoricalNumericQuery;
  /** Private source identity: never included in the returned DTO. */
  observationId: string;
  /** This is a historical bulk label, not a source verification decision. */
  priorBulkStatus: string | null;
  originalValue: NativeJson;
  originalUnit: string | null;
  /** Exact reference percentile already produced by the existing calculation, if available. */
  referencePercent: string | null;
}>;
export type HistoricalNumericVerdict = Readonly<{
  query: HistoricalNumericQuery;
  /** True only after exact current CID/original/overlay, year/PK relation, cutoff, cohort
   * and service scope have been independently verified against the real source/head. */
  sourceValueVerified: boolean;
  /** True only when the current authoritative source proves the value is actually absent. */
  absenceVerified: boolean;
  /** Also verifies the original score axis/full mark, calculation and model when present. */
  percentileVerified: boolean;
  /** Safe code from the authority; never a student name, object key or source secret. */
  reason:
    | "source_unverified"
    | "scope_unconfirmed"
    | "relation_unconfirmed"
    | "cutoff_or_cohort_unconfirmed"
    | "score_axis_unavailable"
    | "calculation_unavailable"
    | null;
}>;
export interface HistoricalNumericBatchSource {
  /** One bounded batch only; not one SQL request per school/offering. */
  read(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    queries: readonly HistoricalNumericQuery[],
  ): Promise<readonly (HistoricalNumericSourceRow | null)[]>;
}
export interface HistoricalNumericAuthority {
  /** Authenticates the exact request, active budget, allowed scope, source and current head. */
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    source: HistoricalNumericBatchSource,
    queries: readonly HistoricalNumericQuery[],
  ): Promise<void>;
  /** Independently checks exact CID/current source and overlay, original values, explicit
   * PK relationship, cutoff/cohort, score axis and service scope for the entire bounded batch.
   * Caller-provided statuses, booleans, labels or matching hashes alone are not authority. */
  assess(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    source: HistoricalNumericBatchSource,
    queries: readonly HistoricalNumericQuery[],
    rows: readonly (HistoricalNumericSourceRow | null)[],
  ): Promise<readonly HistoricalNumericVerdict[]>;
  /** Must settle only after all source/authority I/O has physically stopped, even on abort. */
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
export type HistoricalNumericResult = Readonly<{
  query: HistoricalNumericQuery;
  state: "reference" | "pending";
  label: "참고·기준 확인 중" | null;
  /** Exact original native numeric representation is preserved; no fabricated zero. */
  originalValue: NativeJson;
  originalUnit: string | null;
  referencePercent: string | null;
  reason:
    | HistoricalNumericVerdict["reason"]
    | "source_value_missing"
    | "source_value_not_numeric"
    | null;
  /** A separate comparable-cut/model authority is required before any prediction. */
  forecastEligible: false;
}>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CID = /^(?:observation|admission):[a-f0-9]{64}$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const REASONS = [
  "source_unverified",
  "scope_unconfirmed",
  "relation_unconfirmed",
  "cutoff_or_cohort_unconfirmed",
  "score_axis_unavailable",
  "calculation_unavailable",
] as const;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function data(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) fail();
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable) fail();
  }
  return value as Record<string, unknown>;
}
function query(raw: unknown): HistoricalNumericQuery {
  const x = data(raw, ["academicYear", "schoolId", "offeringPk", "cutoff"]);
  if (
    ![2024, 2025, 2026].includes(Number(x.academicYear)) ||
    typeof x.academicYear !== "number" || typeof x.schoolId !== "string" || !ID.test(x.schoolId) ||
    typeof x.offeringPk !== "string" || !ID.test(x.offeringPk) ||
    !["final_50_percent_cut", "final_70_percent_cut", "alternate_cut"].includes(String(x.cutoff))
  ) fail();
  return Object.freeze({
    academicYear: x.academicYear as 2024 | 2025 | 2026,
    schoolId: x.schoolId,
    offeringPk: x.offeringPk,
    cutoff: x.cutoff as HistoricalNumericQuery["cutoff"],
  });
}
function key(q: HistoricalNumericQuery): string {
  return JSON.stringify([q.academicYear, q.schoolId, q.offeringPk, q.cutoff]);
}
function numeric(raw: unknown): string | null {
  const value = raw instanceof JsonFloat
    ? raw.lexeme
    : typeof raw === "number" && Number.isSafeInteger(raw) || typeof raw === "bigint"
    ? String(raw)
    : raw;
  if (typeof value !== "string" || value.length > 128 || !DECIMAL.test(value)) return null;
  try {
    exact(value);
    return value;
  } catch {
    return null;
  }
}
function percent(raw: unknown): string | null {
  const n = numeric(raw);
  if (n === null) return null;
  try {
    return exact(n).compare(exact(0)) >= 0 && exact(n).compare(exact(100)) <= 0 ? n : null;
  } catch {
    return null;
  }
}
function pending(
  q: HistoricalNumericQuery,
  reason: HistoricalNumericResult["reason"],
): HistoricalNumericResult {
  return Object.freeze({
    query: q,
    state: "pending",
    label: null,
    originalValue: null,
    originalUnit: null,
    referencePercent: null,
    reason,
    forecastEligible: false,
  });
}

/**
 * Existing bulk review labels are deliberately not used to reject a present value. Only the
 * separately issued per-CID source verdict may permit a value to be shown. This helper never
 * promotes any observation to a forecast, reverses a missing value, or changes the snapshot.
 */
export async function readHistoricalNumericReferencesCandidate(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  rawQueries: readonly HistoricalNumericQuery[],
  source: HistoricalNumericBatchSource,
  authority: HistoricalNumericAuthority,
): Promise<readonly HistoricalNumericResult[]> {
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    !Array.isArray(rawQueries) || !rawQueries.length || rawQueries.length > 100 ||
    !source || typeof source.read !== "function" || !authority ||
    typeof authority.assertCurrent !== "function" || typeof authority.assess !== "function" ||
    typeof authority.awaitQuiescence !== "function"
  ) fail();
  const signal = boundary.signal, admission = boundary.admission, session = request.session;
  const subject = session.user.subjectId, operation = request.operation;
  const queries = Object.freeze(rawQueries.map(query));
  if (new Set(queries.map(key)).size !== queries.length) fail();
  const live = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session !== session || request.session.user.subjectId !== subject ||
      request.operation !== operation
    ) fail();
  };
  try {
    await authority.assertCurrent(request, boundary, source, queries);
    live();
    const raw = await source.read(request, boundary, queries);
    live();
    if (!Array.isArray(raw) || raw.length !== queries.length) fail();
    // Convert only primitive numeric values and immutable scalar identity before awaiting again.
    const rows = Object.freeze(raw.map((row, i): HistoricalNumericSourceRow | null => {
      if (row === null) return null;
      const r = data(row, [
        "query",
        "observationId",
        "priorBulkStatus",
        "originalValue",
        "originalUnit",
        "referencePercent",
      ]);
      const q = query(r.query);
      if (
        key(q) !== key(queries[i]) || typeof r.observationId !== "string" ||
        !CID.test(r.observationId) ||
        !(r.priorBulkStatus === null ||
          typeof r.priorBulkStatus === "string" && r.priorBulkStatus.length <= 128) ||
        !(r.originalUnit === null ||
          typeof r.originalUnit === "string" && r.originalUnit.length <= 64 &&
            !Array.from(r.originalUnit).some((char) =>
              char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127
            )) ||
        !(r.referencePercent === null || typeof r.referencePercent === "string") ||
        !(r.originalValue === null || typeof r.originalValue === "string" ||
          typeof r.originalValue === "bigint" ||
          typeof r.originalValue === "number" && Number.isSafeInteger(r.originalValue) ||
          r.originalValue instanceof JsonFloat)
      ) fail();
      return Object.freeze({
        query: q,
        observationId: r.observationId,
        priorBulkStatus: r.priorBulkStatus as string | null,
        originalValue: r.originalValue as NativeJson,
        originalUnit: r.originalUnit as string | null,
        referencePercent: r.referencePercent as string | null,
      });
    }));
    const verdicts = await authority.assess(request, boundary, source, queries, rows);
    live();
    if (!Array.isArray(verdicts) || verdicts.length !== queries.length) fail();
    const stableVerdicts = Object.freeze(verdicts.map((rawVerdict, i): HistoricalNumericVerdict => {
      const v = data(rawVerdict, [
          "query",
          "sourceValueVerified",
          "absenceVerified",
          "percentileVerified",
          "reason",
        ]),
        q = query(v.query);
      if (
        key(q) !== key(queries[i]) || typeof v.sourceValueVerified !== "boolean" ||
        typeof v.absenceVerified !== "boolean" || typeof v.percentileVerified !== "boolean" ||
        !(v.reason === null || REASONS.includes(v.reason as typeof REASONS[number])) ||
        v.percentileVerified === true && v.sourceValueVerified !== true ||
        v.absenceVerified === true && v.sourceValueVerified === true
      ) fail();
      return Object.freeze({
        query: q,
        sourceValueVerified: v.sourceValueVerified,
        absenceVerified: v.absenceVerified,
        percentileVerified: v.percentileVerified,
        reason: v.reason as HistoricalNumericVerdict["reason"],
      });
    }));
    const output = Object.freeze(stableVerdicts.map((v, i): HistoricalNumericResult => {
      const q = v.query;
      const row = rows[i];
      if (row === null || row.originalValue === null || row.originalValue === "") {
        return pending(
          q,
          v.absenceVerified ? "source_value_missing" : v.reason ?? "source_unverified",
        );
      }
      if (v.sourceValueVerified !== true) return pending(q, v.reason ?? "source_unverified");
      if (numeric(row.originalValue) === null) return pending(q, "source_value_not_numeric");
      const calculated = v.percentileVerified === true ? percent(row.referencePercent) : null;
      // Missing axis/full mark or calculation leaves the percentile pending without hiding the
      // independently confirmed original number or turning it into a forecast input.
      const reason = calculated === null ? (v.reason ?? "calculation_unavailable") : v.reason;
      return Object.freeze({
        query: q,
        state: "reference",
        label: "참고·기준 확인 중",
        originalValue: row.originalValue,
        originalUnit: row.originalUnit,
        referencePercent: calculated,
        reason,
        forecastEligible: false,
      });
    }));
    await authority.assertCurrent(request, boundary, source, queries);
    live();
    const rechecked = await authority.assess(request, boundary, source, queries, rows);
    live();
    if (
      !Array.isArray(rechecked) || rechecked.length !== stableVerdicts.length ||
      rechecked.some((value, i) => {
        const a = stableVerdicts[i], b = value;
        return !b || key(query(b.query)) !== key(query(a.query)) ||
          b.sourceValueVerified !== a.sourceValueVerified ||
          b.absenceVerified !== a.absenceVerified ||
          b.percentileVerified !== a.percentileVerified || b.reason !== a.reason;
      })
    ) fail();
    await authority.assertCurrent(request, boundary, source, queries);
    live();
    return output;
  } finally {
    await requireVoidDrains([() => authority.awaitQuiescence(signal)]);
  }
}
