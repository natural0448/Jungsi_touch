/** Four-year approved bridge/rule/curve decisions, independent from successful score and tails. */
import { AccessError } from "./access.ts";
import { publicSourceUrl } from "./catalog.ts";
import { publicVersion, ScoringResult } from "./university_scoring.ts";
import { PercentileResult, resultForUniversityCurve } from "./university_percentile.ts";
import { NativeConversionRelease } from "../domain/conversion_release.ts";
import {
  ContractError,
  displayExact,
  exact,
  Rational,
  requireContract as check,
} from "../domain/exact.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { calendarDate } from "../domain/time.ts";
import {
  NativeUniversityScoreDistribution,
  UNIVERSITY_MATCH_FIELDS,
  universityNumber,
} from "../domain/university_distribution.ts";
import {
  EQUATING_AREAS,
  EQUATING_YEARS,
  estimateYear,
  NativeBridgePolicy,
  NativeRankDistribution,
  prepareEquatedProfile,
  type RankBundle,
} from "../domain/year_equating.ts";
function record(v: unknown): NativeObject {
  check(
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat),
    "analysis_release_invalid",
  );
  return v as NativeObject;
}
function present(v: NativeJson | undefined): boolean {
  return v !== undefined && v !== null && v !== false && v !== "" && v !== 0 && v !== 0n &&
    (!Array.isArray(v) || v.length > 0) &&
    (typeof v !== "object" || Array.isArray(v) || v instanceof JsonFloat ||
      Object.keys(v).length > 0);
}
function freeze<T extends NativeJson>(v: T): T {
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) v.forEach(freeze);
    else if (!(v instanceof JsonFloat)) Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function fraction(v: unknown): Rational {
  const r = record(v);
  check(
    [r.numerator, r.denominator].every((x) =>
      typeof x === "bigint" || typeof x === "number" && Number.isSafeInteger(x)
    ),
    "INVALID_NUMBER",
  );
  return new Rational(
    BigInt(r.numerator as number | bigint),
    BigInt(r.denominator as number | bigint),
  );
}
export interface YearBridge {
  readonly source: RankBundle;
  readonly target: RankBundle;
  readonly sourceTotal: NativeRankDistribution;
  readonly targetTotal: NativeRankDistribution;
}
export interface OfferingAnalysisSettings {
  readonly version: string;
  readonly status: string;
  readonly sourcePackVersion: string;
  readonly release: NativeConversionRelease;
  readonly offeringsByYear: Readonly<NativeObject>;
  readonly bridges: ReadonlyMap<number, YearBridge>;
  readonly policy: NativeBridgePolicy;
  readonly curves: ReadonlyMap<number, NativeUniversityScoreDistribution>;
  readonly decisions: ReadonlyMap<number, NativeObject>;
}
export class NativeOfferingAnalysisRelease {
  readonly version: string;
  readonly status: string;
  readonly sourcePackVersion: string;
  readonly release: NativeConversionRelease;
  readonly offeringsByYear: Readonly<NativeObject>;
  readonly policy: NativeBridgePolicy;
  private readonly bridges: ReadonlyMap<number, YearBridge>;
  private readonly curves: ReadonlyMap<number, NativeUniversityScoreDistribution>;
  private readonly decisions: ReadonlyMap<number, NativeObject>;
  constructor(settings: OfferingAnalysisSettings) {
    this.version = settings.version;
    this.status = settings.status;
    this.sourcePackVersion = settings.sourcePackVersion;
    this.release = settings.release;
    this.offeringsByYear = freeze(cloneNativeJson(settings.offeringsByYear));
    this.policy = settings.policy;
    this.bridges = new Map(
      [...settings.bridges].map((
        [y, b],
      ) => [
        y,
        Object.freeze({
          ...b,
          source: Object.freeze({ ...b.source }),
          target: Object.freeze({ ...b.target }),
        }),
      ]),
    );
    this.curves = new Map(settings.curves);
    this.decisions = new Map(
      [...settings.decisions].map(([y, d]) => [y, freeze(cloneNativeJson(d))]),
    );
    Object.freeze(this);
  }
  bridge(year: number): YearBridge | null {
    return this.bridges.get(year) ?? null;
  }
  curve(year: number): NativeUniversityScoreDistribution | null {
    return this.curves.get(year) ?? null;
  }
  decision(year: number): Readonly<NativeObject> | null {
    return this.decisions.get(year) ?? null;
  }
}
export interface OfferingAnalysisDataPort {
  getAnalysis(offeringId: string): Promise<NativeOfferingAnalysisRelease | null>;
}
export function blockedOffering(offeringId: NativeJson, reason: string): NativeObject {
  return {
    offering_id: offeringId,
    status: "pending",
    reason_code: reason,
    converted_score: null,
    converted_percentile: null,
    category: "pending",
    advantage: null,
    years: [],
    versions: {},
    eligibility_status: "needs_confirmation",
  };
}
function same(a: unknown, b: unknown): boolean {
  const number = (v: unknown) =>
    v instanceof JsonFloat
      ? universityNumber(v)
      : typeof v === "boolean"
      ? exact(v ? 1 : 0)
      : typeof v === "bigint" || typeof v === "number" && Number.isSafeInteger(v)
      ? exact(v)
      : null;
  const x = number(a), y = number(b);
  return x !== null && y !== null ? x.compare(y) === 0 : a === b;
}
export function scoreEligibility(scores: Readonly<NativeObject>, raw: unknown): string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat) {
    return "needs_confirmation";
  }
  const p = raw as NativeObject;
  if (p.status !== "approved" || !present(p.version)) return "needs_confirmation";
  const requirements = Object.hasOwn(p, "requirements") ? p.requirements : [];
  if (!Array.isArray(requirements)) return "needs_confirmation";
  for (const raw of requirements) {
    const r = record(raw), field = r.field;
    let value: NativeJson | undefined;
    if (field === "korean_choice" || field === "math_choice") {
      value = record(scores[field.split("_")[0]]).choice;
    } else if (field === "english_grade" || field === "korean_history_grade") value = scores[field];
    else return "needs_confirmation";
    if (value === null || value === undefined) return "needs_confirmation";
    if (r.operator === "in" && Array.isArray(r.values)) {
      if (!r.values.some((v) => same(value, v))) {
        return "ineligible";
      }
    } else if (
      r.operator === "at_most" &&
      (typeof r.value === "bigint" ||
        typeof r.value === "number" && Number.isSafeInteger(r.value)) &&
      (typeof value === "bigint" || typeof value === "number" && Number.isSafeInteger(value))
    ) {
      if (exact(value).compare(exact(r.value)) > 0) return "ineligible";
    } else return "needs_confirmation";
  }
  return "eligible";
}
export function decisionEvidenceDto(decision: Readonly<NativeObject>): NativeObject {
  const evidence = record(decision.evidence);
  check(
    evidence.status === "approved" && present(evidence.version),
    "decision_evidence_unapproved",
  );
  check(
    nativeJsonText(evidence.context, true) === nativeJsonText(decision.context, true),
    "decision_evidence_unapproved",
  );
  const fields = [
    "academic_year",
    "metric_name",
    "metric_definition",
    "value",
    "unit",
    "original_scale",
    "publication_status",
    "source_url",
    "source_as_of",
  ];
  const rows = Object.hasOwn(evidence, "historical_metrics") ? evidence.historical_metrics : [];
  check(Array.isArray(rows), "decision_evidence_unapproved");
  const history: NativeObject[] = [];
  for (const raw of rows) {
    const r = record(raw);
    check(r.verification_status === "verified_official", "decision_evidence_unapproved");
    const item: NativeObject = Object.fromEntries(fields.map((k) => [k, r[k] ?? null]));
    check(
      typeof item.academic_year === "number" && Number.isSafeInteger(item.academic_year) &&
        EQUATING_YEARS.includes(item.academic_year as 2024),
      "decision_evidence_unapproved",
    );
    check(
      Object.values(item).every((v) =>
        v === null || typeof v === "string" || typeof v === "bigint" ||
        typeof v === "number" && Number.isSafeInteger(v)
      ),
      "decision_evidence_unapproved",
    );
    item.source_url = publicSourceUrl(item.source_url);
    if (item.source_as_of !== null) item.source_as_of = calendarDate(item.source_as_of as string);
    history.push(item);
  }
  let forecast: NativeObject;
  if (evidence.forecast_70 == null) {
    forecast = {
      status: "pending",
      reason_code: "forecast_70_not_published",
      value: null,
      unit: null,
      definition: null,
      version: null,
    };
  } else {
    const f = record(evidence.forecast_70);
    check(
      f.status === "approved" && present(f.version) && present(f.definition) && present(f.unit),
      "decision_evidence_unapproved",
    );
    universityNumber(f.value);
    forecast = Object.fromEntries(
      ["value", "unit", "definition", "version"].map((k) => [k, f[k] ?? null]),
    );
    check(
      Object.values(forecast).every((v) =>
        typeof v === "string" || typeof v === "bigint" ||
        typeof v === "number" && Number.isSafeInteger(v)
      ),
      "decision_evidence_unapproved",
    );
    Object.assign(forecast, { status: "ready", reason_code: null });
  }
  const a = record(evidence.expected_acceptance_range);
  check(
    a.status === "approved" && a.policy_version === decision.version && present(a.definition) &&
      present(a.unit) && universityNumber(a.lower).compare(universityNumber(a.upper)) < 0,
    "decision_evidence_unapproved",
  );
  const adopted: NativeObject = Object.fromEntries(
    ["lower", "upper", "unit", "definition", "policy_version"].map((k) => [k, a[k] ?? null]),
  );
  check(
    Object.values(adopted).every((v) =>
      typeof v === "string" || typeof v === "bigint" ||
      typeof v === "number" && Number.isSafeInteger(v)
    ),
    "decision_evidence_unapproved",
  );
  return {
    version: evidence.version,
    historical_metrics: history,
    forecast_70: forecast,
    expected_acceptance_range: adopted,
  };
}
function inner(
  offering: Readonly<NativeObject>,
  profile: { profile_id: string; scores: NativeObject },
  overall: Readonly<NativeObject>,
  bundle: NativeOfferingAnalysisRelease | null,
  conversion: ScoringResult | null,
  percentile: PercentileResult | null,
): NativeObject {
  const oid = offering.offering_id;
  if (!(bundle instanceof NativeOfferingAnalysisRelease)) {
    return blockedOffering(oid, "analysis_release_missing");
  }
  if (!publicVersion(bundle.version)) return blockedOffering(oid, "analysis_release_invalid");
  if (bundle.status !== "approved") return blockedOffering(oid, "analysis_release_not_approved");
  const scores = profile.scores;
  if (bundle.sourcePackVersion !== scores.pack_version) {
    return blockedOffering(oid, "analysis_pack_mismatch");
  }
  const year = offering.academic_year as number;
  if (bundle.offeringsByYear[String(year)] !== oid) {
    return blockedOffering(oid, "offering_binding_mismatch");
  }
  const direct = conversion?.ready === true,
    aggregate = record(overall.overall),
    exam = record(overall.exam);
  if (aggregate.status === "pending" && !direct) {
    return blockedOffering(oid, aggregate.reason_code as string);
  }
  const inquiries = scores.inquiry as NativeObject[],
    marks: NativeObject = {
      korean: record(scores.korean).standard_score,
      math: record(scores.math).standard_score,
      inquiry1: inquiries[0].standard_score,
      inquiry2: inquiries[1].standard_score,
    };
  const profiles = new Map<number, NativeObject>(), failures = new Map<number, string>();
  for (const targetYear of EQUATING_YEARS) {
    if (direct && targetYear === year) {
      profiles.set(targetYear, conversion!.internalProfile());
      continue;
    }
    if (aggregate.status === "pending") {
      failures.set(targetYear, aggregate.reason_code as string);
      continue;
    }
    const b = bundle.bridge(targetYear);
    if (!b) {
      failures.set(targetYear, "target_distribution_missing");
      continue;
    }
    try {
      if (
        b.source.korean.examId !== scores.exam_id ||
        b.source.korean.academicYear !== exam.academic_year || Object.values(b.source).some((d) =>
          d.version !== scores.pack_version
        ) ||
        b.sourceTotal.version !== aggregate.model_version ||
        b.target.korean.academicYear !== targetYear
      ) {
        failures.set(targetYear, "bridge_context_mismatch");
        continue;
      }
      const result = estimateYear(
        marks,
        b.source,
        b.target,
        bundle.policy,
        b.sourceTotal,
        b.targetTotal,
      );
      if (result.public_eligible !== true) {
        failures.set(
          targetYear,
          (result.reason_codes as string[]).find((r) => r !== "ABSOLUTE_GRADES_HELD_CONSTANT") ??
            "bridge_not_approved",
        );
        continue;
      }
      profiles.set(
        targetYear,
        prepareEquatedProfile(
          profile.profile_id,
          result,
          scores.english_grade ?? null,
          scores.korean_history_grade ?? null,
          {
            korean_choice: record(scores.korean).choice ?? null,
            math_choice: record(scores.math).choice ?? null,
            inquiry1_subject: inquiries[0].subject,
            inquiry2_subject: inquiries[1].subject,
          },
        ),
      );
    } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      failures.set(targetYear, e.code);
    }
  }
  const converted = bundle.release.compareYears(bundle.offeringsByYear, profiles),
    years = converted.years as NativeObject[];
  if (direct) {
    const current = years.find((r) => r.academic_year === year);
    check(current, "analysis_release_invalid");
    Object.assign(current, conversion!.internalCalculation());
  }
  const publicYears = years.map((r) => ({
    academic_year: r.academic_year,
    offering_id: r.offering_pk,
    score_basis: r.score_basis ?? "year_equated_estimate",
    converted_score: r.converted_score ?? null,
    status: r.calculation_status === "calculated" ? "ready" : "pending",
    reason_code: r.calculation_status === "calculated"
      ? null
      : failures.get(r.academic_year as number) ?? (r.reason_codes as string[])[0],
  }));
  const current = years.find((r) => r.academic_year === year);
  check(current, "analysis_release_invalid");
  if (current.calculation_status !== "calculated") {
    const r = blockedOffering(oid, failures.get(year) ?? (current.reason_codes as string[])[0]);
    r.years = publicYears;
    return r;
  }
  const result = blockedOffering(oid, "comparison_distribution_missing"),
    versions: NativeObject = {
      analysis: bundle.version,
      profile: profile.profile_id,
      pack: scores.pack_version,
      source_model: aggregate.model_version ?? null,
      bridge: bundle.policy.version,
      rule: current.rule_version,
    };
  Object.assign(result, { converted_score: current.converted_score, years: publicYears, versions });
  const independent = direct && percentile !== null &&
    (percentile.ready || percentile.state.reason_code !== "percentile_release_missing");
  let curve: NativeUniversityScoreDistribution | null, metadata: Readonly<NativeObject>;
  if (independent) {
    if (!percentile!.ready) {
      result.reason_code = percentile!.state.reason_code;
      return result;
    }
    metadata = percentile!.state.context;
    curve = null;
  } else {
    curve = bundle.curve(year);
    if (!curve) return result;
    metadata = curve.metadata;
  }
  try {
    const p = profiles.get(year)!;
    const binding: NativeObject = {
        academic_year: year,
        exam_id: p.exam_id,
        rule_version: current.rule_version,
      },
      rule = bundle.release.rule(current.rule_version as string);
    check(rule, "analysis_release_invalid");
    Object.assign(binding, { rule_id: rule.data.rule_id, score_scope: rule.data.score_scope });
    const decision = bundle.decision(year);
    if (!decision) {
      result.reason_code = "decision_policy_missing";
      return result;
    }
    const context = record(decision.context ?? {});
    if (decision.status !== "approved") {
      result.reason_code = "decision_policy_not_approved";
      return result;
    }
    if (
      context.offering_id !== oid || UNIVERSITY_MATCH_FIELDS.some((k) => context[k] !== metadata[k])
    ) {
      result.reason_code = "decision_context_mismatch";
      return result;
    }
    if (
      context.curve_version !== metadata.curve_version ||
      context.analysis_version !== bundle.version
    ) {
      result.reason_code = "decision_version_mismatch";
      return result;
    }
    try {
      result.decision_evidence = decisionEvidenceDto(decision);
    } catch {
      result.reason_code = "decision_evidence_unapproved";
      return result;
    }
    versions.evidence = (result.decision_evidence as NativeObject).version;
    if (Object.entries(binding).some(([k, v]) => metadata[k] !== v)) {
      result.reason_code = "conversion_curve_context_mismatch";
      return result;
    }
    const score = fraction(current.exact_score),
      recordValue: NativeObject = Object.fromEntries(
        UNIVERSITY_MATCH_FIELDS.map((k) => [k, metadata[k]]),
      );
    Object.assign(recordValue, {
      score_metric: metadata.score_metric,
      score_value: score as unknown as NativeJson,
      publication_precision: { mode: "exact" },
    });
    const rank = independent ? percentile!.internalRank() : curve!.lookup(recordValue);
    result.converted_percentile = record(rank.at_reported_score).above_or_equal_percent;
    if (!independent) {
      const base = new PercentileResult({
        academic_year: year,
        exam_id: current.exam_id as string,
        profile_version: profile.profile_id,
        pack_version: scores.pack_version as string,
        score_basis: current.score_basis as string,
        rule_version: current.rule_version as string,
        reason_code: null,
        inclusive: null,
        exclusive: null,
        population_id: null,
        data_kind: null,
        curve_version: null,
        release_version: null,
        source_model_version: null,
        context: {},
        population_scope: null,
      });
      result.percentile = resultForUniversityCurve(base, curve!, score, bundle.version).dto();
    }
    Object.assign(versions, {
      curve: metadata.curve_version,
      decision: decision.version,
      population: metadata.population_id,
      target_exam: metadata.exam_id,
      tie_policy: "include_equal",
    });
    const eligible = scoreEligibility(scores, decision.eligibility_policy);
    result.eligibility_status = eligible;
    if (eligible === "ineligible") {
      Object.assign(result, {
        status: "ineligible",
        category: "ineligible",
        reason_code: "eligibility_not_met",
      });
      return result;
    }
    if (eligible !== "eligible") {
      result.reason_code = "eligibility_confirmation_required";
      return result;
    }
    versions.eligibility = record(decision.eligibility_policy).version;
    const ranges = decision.ranges ?? [];
    check(Array.isArray(ranges), "analysis_release_invalid");
    const allowed = new Set(["challenge", "core", "room", "outside"]);
    const matches = ranges.map(record).filter((r) =>
      allowed.has(r.category as string) && universityNumber(r.lower).compare(score) <= 0 &&
      score.compare(universityNumber(r.upper)) < 0
    );
    if (matches.length !== 1) {
      result.reason_code = "decision_range_unconfirmed";
      return result;
    }
    let category = matches[0].category;
    const baseCategory = category, adjustment = decision.adjustment;
    const adjusted = present(adjustment);
    if (adjusted) {
      const a = record(adjustment);
      if (
        a.status !== "approved" || a.base_version !== decision.version || !present(a.version) ||
        !Array.isArray(a.ranges)
      ) {
        result.reason_code = "counselor_adjustment_unapproved";
        return result;
      }
      const chosen = a.ranges.map(record).filter((r) =>
        allowed.has(r.category as string) && universityNumber(r.lower).compare(score) <= 0 &&
        score.compare(universityNumber(r.upper)) < 0
      );
      if (chosen.length !== 1) {
        result.reason_code = "counselor_adjustment_range_unconfirmed";
        return result;
      }
      versions.adjustment = a.version;
      category = chosen[0].category;
    }
    result.decision_components = {
      base_category: baseCategory,
      adjusted_category: adjusted ? category : null,
      adopted_category: category,
      base_policy_version: decision.version,
      adjustment_version: adjusted ? record(adjustment).version : null,
    };
    Object.assign(result, { status: "ready", category, reason_code: null });
    const baseline = decision.baseline, targetTotal = bundle.bridge(year)?.targetTotal;
    if (present(baseline) && targetTotal instanceof NativeRankDistribution) {
      const b = record(baseline);
      if (
        ["academic_year", "exam_id", "population_id"].every((k) => b[k] === metadata[k]) &&
        targetTotal.academicYear === metadata.academic_year &&
        targetTotal.examId === metadata.exam_id &&
        targetTotal.populationId === metadata.population_id &&
        targetTotal.status === "validated" && targetTotal.kind !== "synthetic" &&
        b.version === targetTotal.version && b.tie_policy === "include_equal" &&
        b.status === "approved"
      ) {
        const values = record(p.values),
          total = EQUATING_AREAS.reduce(
            (sum, a) => sum + (values[a + "_standard_score"] as number),
            0,
          ),
          basePercent = targetTotal.rank(total).inclusive.multiply(exact(100)),
          delta = basePercent.subtract(
            fraction(record(rank.at_reported_score).above_or_equal_ratio).multiply(exact(100)),
          ),
          sign = delta.compare(exact(0));
        result.advantage = {
          delta_pp: displayExact(delta),
          status: sign > 0 ? "favorable" : sign < 0 ? "unfavorable" : "neutral",
          baseline_version: b.version,
        };
        result.recommendation_reasons = [{
          code: sign > 0
            ? "converted_score_position_gain"
            : sign < 0
            ? "converted_score_position_loss"
            : "converted_score_position_equal",
          text: "같은 시험·모집단·동점 기준의 총점 위치와 비교하면 대학 환산 위치가 " +
            (sign > 0 ? "더 앞섭니다." : sign < 0 ? "더 뒤입니다." : "같습니다."),
          evidence_refs: [b.version, metadata.curve_version],
        }];
      }
    }
    return result;
  } catch (e) {
    if (!(e instanceof ContractError || e instanceof AccessError)) throw e;
    result.reason_code = e.code;
    return result;
  }
}
export function evaluateOffering(
  offering: Readonly<NativeObject>,
  profile: { profile_id: string; scores: NativeObject },
  overall: Readonly<NativeObject>,
  bundle: NativeOfferingAnalysisRelease | null,
  conversion: ScoringResult | null = null,
  percentile: PercentileResult | null = null,
): NativeObject {
  let result: NativeObject;
  try {
    result = inner(offering, profile, overall, bundle, conversion, percentile);
  } catch {
    result = blockedOffering(offering.offering_id, "analysis_release_invalid");
  }
  if (conversion) {
    const referenceCalculated =
      conversion.state.reason_code === "reference_conversion_not_production_approved" &&
      conversion.state.context.reference_status === "reference_calculated" &&
      conversion.state.converted_score !== null;
    if (referenceCalculated) {
      // Preserve the successful same-exam number without adopting a legacy curve or judgment.
      const years = Array.isArray(result.years) ? result.years : [];
      result = {
        ...blockedOffering(offering.offering_id, "reference_conversion_not_production_approved"),
        years,
      };
    }
    result.conversion = conversion.dto();
    result.recommendation_reasons = [
      ...(conversion.ready ? cloneNativeJson([...conversion.state.explanations]) : []),
      ...((result.recommendation_reasons ?? []) as NativeJson[]),
    ];
    if (conversion.ready || referenceCalculated) {
      result.converted_score = conversion.state.converted_score;
      const versions = record(result.versions);
      versions.rule = conversion.state.rule_version;
      versions.conversion = conversion.state.release_version;
      const years = new Map((result.years as NativeObject[]).map((r) => [r.academic_year, r]));
      years.set(conversion.state.academic_year, {
        academic_year: conversion.state.academic_year,
        offering_id: offering.offering_id,
        score_basis: conversion.state.score_basis,
        converted_score: conversion.state.converted_score,
        status: conversion.ready ? "ready" : "pending",
        reason_code: conversion.ready ? null : conversion.state.reason_code,
      });
      result.years = EQUATING_YEARS.map((y) =>
        years.get(y) ??
          {
            academic_year: y,
            offering_id: null,
            score_basis: "year_equated_estimate",
            converted_score: null,
            status: "pending",
            reason_code: "year_bridge_required",
          }
      );
    }
  }
  if (percentile && (percentile.ready || !Object.hasOwn(result, "percentile"))) {
    result.percentile = percentile.dto();
    result.converted_percentile = record(result.percentile).top_percent;
  }
  return result;
}
