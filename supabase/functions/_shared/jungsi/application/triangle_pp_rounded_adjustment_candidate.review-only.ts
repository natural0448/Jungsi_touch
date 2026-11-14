/** REVIEW ONLY: separately verified percentage-point adjustment to triangular quantiles.
 * The exact enclosing bounds are shifted BEFORE rounding. No forecast/route/authority is wired.
 * Unchanged observed a/c/b and original quantile displays are returned separately. Missing or
 * unverified effects are not treated as a numerical zero. This is no admission probability.
 */
import { AccessError } from "./access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { exact } from "../domain/exact.ts";
import {
  roundedTriangleQuantileWithPp,
  type TriangleDisplayPolicy,
  type TriangleResult,
} from "./historical_triangle_candidate.review-only.v8.ts";

export type BoundDisplayPolicy = Readonly<{
  source: "user_default" | "approved_policy";
  policyId: string | null;
  policySha256: string | null;
  displayPlaces: number;
  roundingMode: TriangleDisplayPolicy["roundingMode"];
}>;
export type RoundedPpEffect = Readonly<{
  effectId: string;
  sourceSha256: string;
  scopeSha256: string;
  policySha256: string;
  delta: string;
  unit: "percentage_point";
}>;
export type RoundedAdjustmentBaseScope = Readonly<{
  request: ApiExecution;
  boundary: ApiExecutionBoundary;
  offeringId: string;
  batchReceipt: object | null;
  cutoffDefinition: string;
  lower: string;
  center: string;
  upper: string;
  originalLowerDisplay: string;
  originalUpperDisplay: string;
  policy: BoundDisplayPolicy;
}>;
export type RoundedAdjustmentScope = Readonly<
  RoundedAdjustmentBaseScope & {
    effect: RoundedPpEffect;
  }
>;
/** Authority independently checks actual source batch/observation values and head, same cutoff,
 * 2027 relations, request/ownership/admission, display policy priority and change evidence.
 * Effect approval must bind exact source/scope/unit/delta and prove no correlated or already
 * incorporated effect. It may use an in-memory receipt, which must be independently verified.
 * No TypeScript value, caller flag or this module itself is an authorization. All I/O stops
 * before the authority promise settles and boundary.signal must be respected.
 */
export interface RoundedPpAuthority {
  verifyBase(scope: RoundedAdjustmentBaseScope): Promise<boolean>;
  verifyEffect(scope: RoundedAdjustmentScope): Promise<boolean>;
}
export type RoundedAdjustmentResult = Readonly<{
  status: "applied_reference_only" | "not_applied" | "pending";
  reason: string | null;
  expectedAcademicYear: 2027;
  cutoffDefinition: string | null;
  original: Readonly<{ lower: string | null; upper: string | null }>;
  adjusted: Readonly<{ lower: string; upper: string }> | null;
  deltaPp: string | null;
  unit: "%";
  modelAssumption: "triangular_reference";
  futureRangeGuaranteed: false;
  actualApplicantRanking: false;
  admissionProbability: null;
  admissionDecision: null;
}>;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DECIMAL = /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function own(o: unknown, k: string): unknown {
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  const d = Object.getOwnPropertyDescriptor(o, k);
  return d && "value" in d ? d.value : undefined;
}
function token(v: unknown): v is string {
  return typeof v === "string" && TOKEN.test(v);
}
function hash(v: unknown): v is string {
  return typeof v === "string" && HASH.test(v);
}
function pct(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 128 || !DECIMAL.test(v)) return false;
  try {
    return exact(v).compare(exact(0)) >= 0 && exact(v).compare(exact(100)) <= 0;
  } catch {
    return false;
  }
}
function result(
  status: RoundedAdjustmentResult["status"],
  reason: string | null,
  cutoffDefinition: string | null,
  lower: string | null,
  upper: string | null,
  adjusted: RoundedAdjustmentResult["adjusted"] = null,
  deltaPp: string | null = null,
): RoundedAdjustmentResult {
  return Object.freeze({
    status,
    reason,
    expectedAcademicYear: 2027,
    cutoffDefinition,
    original: Object.freeze({ lower, upper }),
    adjusted,
    deltaPp,
    unit: "%",
    modelAssumption: "triangular_reference",
    futureRangeGuaranteed: false,
    actualApplicantRanking: false,
    admissionProbability: null,
    admissionDecision: null,
  });
}
function snapshotPolicy(raw: unknown): BoundDisplayPolicy | null {
  const source = own(raw, "source"), id = own(raw, "policyId"), sha = own(raw, "policySha256");
  const places = own(raw, "displayPlaces"), mode = own(raw, "roundingMode");
  if (
    (source !== "user_default" && source !== "approved_policy") ||
    typeof places !== "number" || !Number.isSafeInteger(places) || places < 0 || places > 8 ||
    !["half_up", "half_even", "floor", "ceil", "truncate"].includes(String(mode))
  ) return null;
  if (
    source === "user_default" && (id !== null || sha !== null || places !== 2 || mode !== "half_up")
  ) return null;
  if (source === "approved_policy" && (!token(id) || !hash(sha))) return null;
  return Object.freeze({
    source,
    policyId: id as string | null,
    policySha256: sha as string | null,
    displayPlaces: places,
    roundingMode: mode as TriangleDisplayPolicy["roundingMode"],
  });
}
/** At most one verified effect is applied. Multiple effects require a separate overlap policy. */
export async function applyVerifiedPpToRoundedTriangle(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  offeringId: string,
  base: TriangleResult,
  rawEffects: readonly RoundedPpEffect[],
  rawPolicy: BoundDisplayPolicy,
  batchReceipt: object | null,
  authority: RoundedPpAuthority,
): Promise<RoundedAdjustmentResult> {
  if (
    !request || !boundary || !boundary.admission || !boundary.signal || boundary.signal.aborted ||
    !token(offeringId) || !Array.isArray(rawEffects) || rawEffects.length > 16 || !authority ||
    typeof authority.verifyBase !== "function" || typeof authority.verifyEffect !== "function" ||
    (batchReceipt !== null && (typeof batchReceipt !== "object" || !Object.isFrozen(batchReceipt)))
  ) unavailable();
  const signal = boundary.signal, admission = boundary.admission;
  const operation = request.operation, subject = request.session?.user?.subjectId;
  if (!token(subject)) unavailable();
  const check = () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.operation !== operation || request.session?.user?.subjectId !== subject
    ) unavailable();
  };
  const a = own(base, "lower"), c = own(base, "center"), b = own(base, "upper");
  const cutoff = own(base, "cutoffDefinition"), interval = own(base, "interval");
  const policy = snapshotPolicy(rawPolicy);
  if (
    own(base, "status") !== "reference_available" || own(base, "expectedAcademicYear") !== 2027 ||
    own(base, "scope") !== "historical_reference_only" ||
    own(base, "modelAssumption") !== "triangular_reference" ||
    own(base, "futureRangeGuaranteed") !== false || own(base, "actualApplicantRanking") !== false ||
    own(base, "admissionProbability") !== null || own(base, "admissionDecision") !== null ||
    own(interval, "status") !== "reference_available" || !token(cutoff) || !policy ||
    !pct(a) || !pct(c) || !pct(b) || exact(a).compare(exact(c)) > 0 ||
    exact(c).compare(exact(b)) > 0 || exact(a).compare(exact(b)) >= 0
  ) {
    return result("pending", "verified_original_triangle_unavailable", null, null, null);
  }
  // Internal delta zero recomputes the original, not an assertion that a real-world effect is zero.
  const originalLower = roundedTriangleQuantileWithPp(a, c, b, "0.1", "0", policy);
  const originalUpper = roundedTriangleQuantileWithPp(a, c, b, "0.9", "0", policy);
  if (originalLower === null || originalUpper === null) {
    return result("pending", "original_rounding_unresolved", cutoff, null, null);
  }
  const baseScope: RoundedAdjustmentBaseScope = Object.freeze({
    request,
    boundary,
    offeringId,
    batchReceipt,
    cutoffDefinition: cutoff,
    lower: a,
    center: c,
    upper: b,
    originalLowerDisplay: originalLower,
    originalUpperDisplay: originalUpper,
    policy,
  });
  if (await authority.verifyBase(baseScope) !== true) {
    check();
    return result("pending", "original_triangle_unverified", null, null, null);
  }
  check();
  if (rawEffects.length === 0) {
    if (await authority.verifyBase(baseScope) !== true) {
      check();
      return result("pending", "original_triangle_stale", null, null, null);
    }
    check();
    return result(
      "not_applied",
      "approved_adjustment_absent",
      cutoff,
      originalLower,
      originalUpper,
    );
  }
  if (rawEffects.length !== 1) {
    return result(
      "pending",
      "multiple_effects_require_independent_policy",
      cutoff,
      originalLower,
      originalUpper,
    );
  }
  const raw = rawEffects[0], effectId = own(raw, "effectId"), source = own(raw, "sourceSha256");
  const scopeSha256 = own(raw, "scopeSha256"),
    policySha256 = own(raw, "policySha256"),
    delta = own(raw, "delta");
  if (
    !token(effectId) || !hash(source) || !hash(scopeSha256) || !hash(policySha256) ||
    typeof delta !== "string" || delta.length > 128 || !DECIMAL.test(delta) ||
    own(raw, "unit") !== "percentage_point"
  ) {
    return result("pending", "adjustment_evidence_invalid", cutoff, originalLower, originalUpper);
  }
  const effect: RoundedPpEffect = Object.freeze({
    effectId,
    sourceSha256: source,
    scopeSha256,
    policySha256,
    delta,
    unit: "percentage_point",
  });
  const scope: RoundedAdjustmentScope = Object.freeze({ ...baseScope, effect });
  if (await authority.verifyEffect(scope) !== true) {
    check();
    return result("pending", "adjustment_unverified", cutoff, originalLower, originalUpper);
  }
  check();
  const lower = roundedTriangleQuantileWithPp(a, c, b, "0.1", delta, policy);
  const upper = roundedTriangleQuantileWithPp(a, c, b, "0.9", delta, policy);
  if (lower === null || upper === null || exact(lower).compare(exact(upper)) > 0) {
    return result(
      "pending",
      "adjusted_range_or_rounding_unresolved",
      cutoff,
      originalLower,
      originalUpper,
    );
  }
  if (
    await authority.verifyBase(baseScope) !== true || await authority.verifyEffect(scope) !== true
  ) {
    check();
    return result("pending", "adjustment_or_original_stale", null, null, null);
  }
  check();
  return result(
    "applied_reference_only",
    null,
    cutoff,
    originalLower,
    originalUpper,
    Object.freeze({ lower, upper }),
    delta,
  );
}
