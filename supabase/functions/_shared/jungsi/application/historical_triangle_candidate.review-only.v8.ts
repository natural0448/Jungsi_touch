/** REVIEW ONLY. Three verified historical references form min/median/max, not a probability,
 * forecast guarantee or applicant rank. No production registration, source or I/O is installed.
 */
import { AccessError } from "./access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { exact, Rational, roundExact } from "../domain/exact.ts";
import { forecastDecimal } from "./forecast_calculation.ts";

export interface TriangleHistoryPoint {
  readonly academicYear: 2024 | 2025 | 2026;
  readonly observationId: string;
  readonly sourceSha256: string;
  readonly relationSha256: string;
  readonly methodSha256: string;
  readonly metric: "estimated_upper_cumulative_percent_all_examinees";
  readonly examId: string;
  readonly examType: "csat" | "june_mock" | "september_mock";
  readonly packVersion: string;
  readonly ruleVersion: string;
  readonly scoreScaleId: string;
  readonly metricDefinition: string;
  readonly cohortDefinition: string;
  readonly value: string;
  readonly unit: "%";
  readonly denominator: "same_year_original_model_whole_exact_mass";
  readonly tiePolicy: "include_equal";
}
export interface TriangleScope {
  readonly request: ApiExecution;
  readonly boundary: ApiExecutionBoundary;
  readonly offeringId: string;
  readonly points: readonly Readonly<TriangleHistoryPoint>[];
  readonly batchReceipt: object | null;
  readonly displayPolicySource: "user_default" | "approved_policy";
}
/** Trusted authority must independently authenticate exact original observation/value/source,
 * same cutoff definition and population/cohort, verified year-to-2027 individual relationship,
 * model, whole-model denominator and tie evidence for every point. It verifies ownership, request
 * admission, current release/head and cancellation. Hashes, input labels and types are not proof.
 * The authority must bind the optional in-memory batch receipt to these exact points and scope,
 * independently confirm whether a higher-priority approved display policy exists, and stop all
 * physical I/O before settling and respect boundary.signal.
 */
export interface TriangleDisplayPolicy {
  readonly policyId: string;
  readonly policySha256: string;
  readonly displayPlaces: number;
  readonly roundingMode: "half_up" | "half_even" | "floor" | "ceil" | "truncate";
}
export interface TriangleAuthority {
  verifyHistory(scope: Readonly<TriangleScope>): Promise<boolean>;
  /** Independently verify this exact current policy, scope and request; no implicit default. */
  verifyDisplayPolicy?(
    scope: Readonly<TriangleScope>,
    policy: Readonly<TriangleDisplayPolicy>,
  ): Promise<boolean>;
}
export type TriangleYearValue = Readonly<{ academicYear: 2024 | 2025 | 2026; value: string }>;
export type TriangleResult = Readonly<{
  status: "reference_available" | "pending";
  reason: string | null;
  expectedAcademicYear: 2027;
  cutoffDefinition: string | null;
  modelAssumption: "triangular_reference";
  futureRangeGuaranteed: false;
  actualApplicantRanking: false;
  lower: string | null;
  center: string | null;
  upper: string | null;
  centerMethod: "median_of_three" | null;
  /** Exact rational, internal only; not a rounded public number. */
  triangleReferenceExact: string | null;
  /** 10th/90th quantiles of an assumed triangular model, not an admission probability. */
  interval: Readonly<
    {
      status: "reference_available" | "pending";
      reason: string | null;
      lowerExact: string | null;
      upperExact: string | null;
      lowerDisplay: string | null;
      upperDisplay: string | null;
    }
  >;
  years: readonly TriangleYearValue[];
  unit: "%";
  scope: "historical_reference_only";
  numericCorrectionApplied: false;
  admissionProbability: null;
  admissionDecision: null;
}>;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PERCENT = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
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
  if (typeof v !== "string" || v.length > 128 || !PERCENT.test(v)) return false;
  try {
    return exact(v).compare(exact(0)) >= 0 && exact(v).compare(exact(100)) <= 0;
  } catch {
    return false;
  }
}
function pending(
  reason: string,
  years: readonly TriangleYearValue[] = [],
  cutoffDefinition: string | null = null,
): TriangleResult {
  return Object.freeze({
    status: "pending",
    reason,
    expectedAcademicYear: 2027,
    cutoffDefinition,
    modelAssumption: "triangular_reference",
    futureRangeGuaranteed: false,
    actualApplicantRanking: false,
    lower: null,
    center: null,
    upper: null,
    centerMethod: null,
    triangleReferenceExact: null,
    interval: Object.freeze({
      status: "pending",
      reason,
      lowerExact: null,
      upperExact: null,
      lowerDisplay: null,
      upperDisplay: null,
    }),
    years: Object.freeze([...years]),
    unit: "%",
    scope: "historical_reference_only",
    numericCorrectionApplied: false,
    admissionProbability: null,
    admissionDecision: null,
  });
}
/** No implicit rounding. Return a rational root only when numerator and denominator are squares. */
function integerSqrt(n: bigint): bigint {
  if (n < 0n) unavailable();
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}
function exactRoot(value: Rational): Rational | null {
  if (
    value.numerator < 0n || value.numerator.toString(2).length > 4096 ||
    value.denominator.toString(2).length > 4096
  ) return null;
  const n = integerSqrt(value.numerator), d = integerSqrt(value.denominator);
  return n * n === value.numerator && d * d === value.denominator ? new Rational(n, d) : null;
}
function quantile(a: Rational, c: Rational, b: Rational, p: Rational): Rational | null {
  const width = b.subtract(a);
  if (width.compare(exact(0)) <= 0) return null;
  const left = c.subtract(a), right = b.subtract(c), t = left.divide(width);
  const root = p.compare(t) <= 0
    ? exactRoot(p.multiply(width).multiply(left))
    : exactRoot(exact(1).subtract(p).multiply(width).multiply(right));
  return root === null ? null : p.compare(t) <= 0 ? a.add(root) : b.subtract(root);
}
/** Compute enclosing rational bounds of sqrt(n/d), without floating point. */
function rootBounds(value: Rational, digits: number): readonly [Rational, Rational] | null {
  if (
    value.numerator < 0n || value.numerator.toString(2).length > 4096 ||
    value.denominator.toString(2).length > 4096
  ) return null;
  const scale = 10n ** BigInt(digits);
  const radicand = value.numerator * value.denominator * scale * scale;
  const root = integerSqrt(radicand), denominator = value.denominator * scale;
  const low = new Rational(root, denominator);
  return [low, root * root === radicand ? low : new Rational(root + 1n, denominator)];
}
/** Only return a decimal when both exact enclosing bounds round identically under verified policy. */
function roundedQuantile(
  a: Rational,
  c: Rational,
  b: Rational,
  p: Rational,
  policy: Pick<TriangleDisplayPolicy, "displayPlaces" | "roundingMode">,
): string | null {
  const width = b.subtract(a), left = c.subtract(a), right = b.subtract(c);
  if (width.compare(exact(0)) <= 0) return null;
  const useLeft = p.compare(left.divide(width)) <= 0;
  const radicand = useLeft
    ? p.multiply(width).multiply(left)
    : exact(1).subtract(p).multiply(width).multiply(right);
  // Iteration bounds resource usage, never substitutes a value on failure.
  for (let digits = policy.displayPlaces; digits <= policy.displayPlaces + 64; digits++) {
    const bounds = rootBounds(radicand, digits);
    if (!bounds) return null;
    const low = useLeft ? a.add(bounds[0]) : b.subtract(bounds[1]);
    const high = useLeft ? a.add(bounds[1]) : b.subtract(bounds[0]);
    const roundedLow = roundExact(low, policy.displayPlaces, policy.roundingMode);
    const roundedHigh = roundExact(high, policy.displayPlaces, policy.roundingMode);
    if (roundedLow.compare(roundedHigh) === 0) return forecastDecimal(roundedLow);
  }
  return null;
}
/** Arithmetic-only helper, not an authority. Caller must verify exact source points, current head,
 * original triangle and the selected approved display policy, plus any percentage-point effect.
 * Add the effect to exact enclosing bounds BEFORE rounding; never shift rounded display values.
 */
export function roundedTriangleQuantileWithPp(
  aText: string,
  cText: string,
  bText: string,
  pText: "0.1" | "0.9",
  deltaText: string,
  policy: Pick<TriangleDisplayPolicy, "displayPlaces" | "roundingMode">,
): string | null {
  if (
    !pct(aText) || !pct(cText) || !pct(bText) || !["0.1", "0.9"].includes(pText) ||
    typeof deltaText !== "string" || deltaText.length > 128 ||
    !/^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(deltaText) || !policy ||
    !Number.isSafeInteger(policy.displayPlaces) || policy.displayPlaces < 0 ||
    policy.displayPlaces > 8 ||
    !["half_up", "half_even", "floor", "ceil", "truncate"].includes(policy.roundingMode)
  ) return null;
  const a = exact(aText),
    c = exact(cText),
    b = exact(bText),
    delta = exact(deltaText),
    p = exact(pText);
  if (a.compare(c) > 0 || c.compare(b) > 0 || a.compare(b) >= 0) return null;
  const width = b.subtract(a), left = c.subtract(a), right = b.subtract(c);
  const useLeft = p.compare(left.divide(width)) <= 0;
  const radicand = useLeft
    ? p.multiply(width).multiply(left)
    : exact(1).subtract(p).multiply(width).multiply(right);
  for (let digits = policy.displayPlaces; digits <= policy.displayPlaces + 64; digits++) {
    const bounds = rootBounds(radicand, digits);
    if (!bounds) return null;
    const low = (useLeft ? a.add(bounds[0]) : b.subtract(bounds[1])).add(delta);
    const high = (useLeft ? a.add(bounds[1]) : b.subtract(bounds[0])).add(delta);
    if (low.compare(exact(0)) < 0 || high.compare(exact(100)) > 0) continue;
    const roundedLow = roundExact(low, policy.displayPlaces, policy.roundingMode);
    const roundedHigh = roundExact(high, policy.displayPlaces, policy.roundingMode);
    if (roundedLow.compare(roundedHigh) === 0) return forecastDecimal(roundedLow);
  }
  return null;
}
/** Each year appears at most once. One or two authenticated observations may be shown by year,
 * but only three comparable observations yield the approved min/median/max calculation. Values
 * are compared exactly, not using rounded display values. This does not apply numeric corrections.
 */
export async function buildHistoricalTriangleCandidate(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  offeringId: string,
  rawPoints: readonly TriangleHistoryPoint[],
  authority: TriangleAuthority,
  requestedDisplayPolicy: TriangleDisplayPolicy | null = null,
  batchReceipt: object | null = null,
): Promise<TriangleResult> {
  if (
    !request || !boundary || !boundary.signal || boundary.signal.aborted || !boundary.admission ||
    !token(offeringId) || !Array.isArray(rawPoints) || rawPoints.length > 3 ||
    !authority || typeof authority.verifyHistory !== "function" ||
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
  const points: Readonly<TriangleHistoryPoint>[] = [];
  const seenYears = new Set<number>(), seenObservations = new Set<string>();
  for (const raw of rawPoints) {
    const y = own(raw, "academicYear"), id = own(raw, "observationId");
    const source = own(raw, "sourceSha256"),
      rel = own(raw, "relationSha256"),
      method = own(raw, "methodSha256");
    const metricName = own(raw, "metric"),
      examId = own(raw, "examId"),
      examType = own(raw, "examType");
    const packVersion = own(raw, "packVersion"),
      ruleVersion = own(raw, "ruleVersion"),
      scoreScaleId = own(raw, "scoreScaleId");
    const metric = own(raw, "metricDefinition"),
      cohort = own(raw, "cohortDefinition"),
      value = own(raw, "value");
    if (
      (y !== 2024 && y !== 2025 && y !== 2026) || !token(id) ||
      seenYears.has(y) || seenObservations.has(id) || !hash(source) || !hash(rel) ||
      !hash(method) ||
      metricName !== "estimated_upper_cumulative_percent_all_examinees" || !token(examId) ||
      !["csat", "june_mock", "september_mock"].includes(String(examType)) ||
      !token(packVersion) || !token(ruleVersion) || !token(scoreScaleId) ||
      !token(metric) || !token(cohort) || !pct(value) || own(raw, "unit") !== "%" ||
      own(raw, "denominator") !== "same_year_original_model_whole_exact_mass" ||
      own(raw, "tiePolicy") !== "include_equal"
    ) return pending("historical_reference_unverified");
    seenYears.add(y);
    seenObservations.add(id);
    points.push(
      Object.freeze({
        academicYear: y,
        observationId: id,
        sourceSha256: source,
        relationSha256: rel,
        methodSha256: method,
        metric: "estimated_upper_cumulative_percent_all_examinees",
        examId,
        examType: examType as TriangleHistoryPoint["examType"],
        packVersion,
        ruleVersion,
        scoreScaleId,
        metricDefinition: metric,
        cohortDefinition: cohort,
        value,
        unit: "%",
        denominator: "same_year_original_model_whole_exact_mass",
        tiePolicy: "include_equal",
      }),
    );
  }
  if (!points.length) return pending("comparable_history_missing");
  if (
    points.some((p) =>
      p.metricDefinition !== points[0].metricDefinition ||
      p.cohortDefinition !== points[0].cohortDefinition
    )
  ) return pending("historical_comparison_mismatch");
  const scope: Readonly<TriangleScope> = Object.freeze({
    request,
    boundary,
    offeringId,
    points: Object.freeze(points),
    batchReceipt,
    displayPolicySource: requestedDisplayPolicy === null ? "user_default" : "approved_policy",
  });
  if (await authority.verifyHistory(scope) !== true) {
    check();
    return pending("historical_reference_unverified");
  }
  check();
  const yearly = points.map((p) => Object.freeze({ academicYear: p.academicYear, value: p.value }))
    .sort((a, b) => a.academicYear - b.academicYear);
  if (await authority.verifyHistory(scope) !== true) {
    check();
    return pending("historical_reference_unverified");
  }
  check();
  if (points.length < 3) {
    return pending("comparable_history_insufficient", yearly, points[0].metricDefinition);
  }
  const ordered = [...points].sort((a, b) => exact(a.value).compare(exact(b.value)));
  const a = exact(ordered[0].value), c = exact(ordered[1].value), b = exact(ordered[2].value);
  if (a.compare(b) >= 0) {
    return pending("historical_range_degenerate", yearly, points[0].metricDefinition);
  }
  const q10 = quantile(a, c, b, exact("0.1")), q90 = quantile(a, c, b, exact("0.9"));
  let approvedPolicy: Readonly<TriangleDisplayPolicy> | null = null;
  if (requestedDisplayPolicy !== null && typeof authority.verifyDisplayPolicy === "function") {
    const policyId = own(requestedDisplayPolicy, "policyId"),
      policySha256 = own(requestedDisplayPolicy, "policySha256");
    const displayPlaces = own(requestedDisplayPolicy, "displayPlaces"),
      roundingMode = own(requestedDisplayPolicy, "roundingMode");
    if (
      token(policyId) && hash(policySha256) && typeof displayPlaces === "number" &&
      Number.isSafeInteger(displayPlaces) && displayPlaces >= 0 && displayPlaces <= 8 &&
      ["half_up", "half_even", "floor", "ceil", "truncate"].includes(String(roundingMode))
    ) {
      const candidate = Object.freeze({
        policyId,
        policySha256,
        displayPlaces,
        roundingMode: roundingMode as TriangleDisplayPolicy["roundingMode"],
      });
      if (await authority.verifyDisplayPolicy(scope, candidate) === true) {
        approvedPolicy = candidate;
      }
      check();
    }
  }
  // User-selected fallback only when the authority confirms there is no approved display policy.
  const display = requestedDisplayPolicy === null
    ? Object.freeze({ displayPlaces: 2, roundingMode: "half_up" as const })
    : approvedPolicy;
  const lowerDisplay = display ? roundedQuantile(a, c, b, exact("0.1"), display) : null;
  const upperDisplay = display ? roundedQuantile(a, c, b, exact("0.9"), display) : null;
  if (
    approvedPolicy && (await authority.verifyDisplayPolicy!(scope, approvedPolicy) !== true ||
      await authority.verifyHistory(scope) !== true)
  ) {
    check();
    return pending("precision_or_history_stale");
  }
  check();
  if (await authority.verifyHistory(scope) !== true) {
    check();
    return pending("historical_reference_stale");
  }
  check();
  const exactAvailable = q10 !== null && q90 !== null;
  const displayAvailable = lowerDisplay !== null && upperDisplay !== null;
  const interval = exactAvailable || displayAvailable
    ? Object.freeze({
      status: "reference_available" as const,
      reason: null,
      lowerExact: exactAvailable ? q10!.toString() : null,
      upperExact: exactAvailable ? q90!.toString() : null,
      lowerDisplay: displayAvailable ? lowerDisplay : null,
      upperDisplay: displayAvailable ? upperDisplay : null,
    })
    : Object.freeze({
      status: "pending" as const,
      reason: "exact_sqrt_or_approved_rounding_unavailable",
      lowerExact: null,
      upperExact: null,
      lowerDisplay: null,
      upperDisplay: null,
    });
  // User-adopted supporting reference: (a + c + b) / 3, exact and unrounded.
  const triangleReference = exact(ordered[0].value).add(exact(ordered[1].value))
    .add(exact(ordered[2].value)).divide(exact(3));
  return Object.freeze({
    status: "reference_available",
    reason: null,
    expectedAcademicYear: 2027,
    cutoffDefinition: points[0].metricDefinition,
    modelAssumption: "triangular_reference",
    futureRangeGuaranteed: false,
    actualApplicantRanking: false,
    lower: ordered[0].value,
    center: ordered[1].value,
    upper: ordered[2].value,
    centerMethod: "median_of_three",
    triangleReferenceExact: triangleReference.toString(),
    interval,
    years: Object.freeze(yearly),
    unit: "%",
    scope: "historical_reference_only",
    numericCorrectionApplied: false,
    admissionProbability: null,
    admissionDecision: null,
  });
}
