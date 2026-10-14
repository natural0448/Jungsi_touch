/** Same-exam student tails; complete whole-population and verified restricted-population contracts. */
import { AccessError } from "./access.ts";
import { CONVERSION_CONTEXT_FIELDS, publicVersion, ScoringResult } from "./university_scoring.ts";
import {
  ContractError,
  displayExact,
  exact,
  Rational,
  requireContract as check,
} from "../domain/exact.ts";
import { OVERALL_POPULATION_ID } from "../domain/exam_pack.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { pythonDefaultStrJsonSha256 } from "../domain/python_json_digest.ts";
import {
  NativeUniversityScoreDistribution,
  UNIVERSITY_MATCH_FIELDS,
  universityNumber,
} from "../domain/university_distribution.ts";
function row(v: unknown): NativeObject {
  check(
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat),
    "percentile_release_invalid",
  );
  return v as NativeObject;
}
function eqList(a: unknown, b: readonly string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}
function freeze<T extends NativeJson>(v: T): T {
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) v.forEach(freeze);
    else if (!(v instanceof JsonFloat)) Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
export interface UniversityPercentileRelease {
  readonly version: string;
  readonly status: string;
  readonly releaseId: string;
  readonly academicYear: number;
  readonly examId: string;
  readonly sourcePackVersion: string;
  readonly examType: string;
  readonly ruleVersion: string;
  readonly curve: NativeUniversityScoreDistribution;
  readonly bindings: readonly NativeObject[];
  readonly comparisonPopulation?: NativeObject | null;
  readonly validationReceipt?: NativeObject | null;
}
export interface UniversityPercentileDataPort {
  getPercentile(offeringId: string): Promise<UniversityPercentileRelease | null>;
}
export interface PercentileState {
  readonly academic_year: number;
  readonly exam_id: string;
  readonly profile_version: string;
  readonly pack_version: string;
  readonly score_basis: string | null;
  readonly rule_version: string | null;
  readonly reason_code: string | null;
  readonly inclusive: Rational | null;
  readonly exclusive: Rational | null;
  readonly population_id: string | null;
  readonly data_kind: string | null;
  readonly curve_version: string | null;
  readonly release_version: string | null;
  readonly source_model_version: string | null;
  readonly context: Readonly<NativeObject>;
  readonly population_scope: string | null;
}
export class PercentileResult {
  readonly state: Readonly<PercentileState>;
  constructor(state: PercentileState) {
    this.state = Object.freeze({ ...state, context: freeze(cloneNativeJson(state.context)) });
    Object.freeze(this);
  }
  get ready(): boolean {
    return this.state.inclusive !== null && this.state.reason_code === null;
  }
  with(patch: Partial<PercentileState>): PercentileResult {
    return new PercentileResult({ ...this.state, ...patch });
  }
  dto(): NativeObject {
    const s = this.state,
      inclusive = this.ready ? displayExact(s.inclusive!.multiply(exact(100))) : null,
      exclusive = this.ready ? displayExact(s.exclusive!.multiply(exact(100))) : null,
      tie = this.ready
        ? displayExact(s.inclusive!.subtract(s.exclusive!).multiply(exact(100)))
        : null;
    return {
      status: this.ready ? "ready" : "pending",
      reason_code: s.reason_code,
      score_basis: s.score_basis,
      score_scope: "csat_component",
      academic_year: s.academic_year,
      exam_id: s.exam_id,
      top_percent: inclusive,
      inclusive_top_percent: inclusive,
      exclusive_top_percent: exclusive,
      tie_share_percent: tie,
      tie_policy: "include_equal",
      population_id: s.population_id,
      population_scope: s.population_scope,
      data_kind: s.data_kind,
      rule_version: s.rule_version,
      curve_version: s.curve_version,
      release_version: s.release_version,
      source_model_version: s.source_model_version,
      profile_version: s.profile_version,
      pack_version: s.pack_version,
    };
  }
  internalRank(): NativeObject {
    check(this.ready && this.state.inclusive, "conversion_not_ready");
    const n = this.state.inclusive;
    return {
      at_reported_score: {
        above_or_equal_percent: displayExact(n.multiply(exact(100))),
        above_or_equal_ratio: { numerator: n.numerator, denominator: n.denominator },
      },
    };
  }
}
export function resultForUniversityCurve(
  base: PercentileResult,
  curve: NativeUniversityScoreDistribution,
  score: Rational,
  releaseVersion: string,
  populationScope = "whole_complete",
): PercentileResult {
  check(score instanceof Rational, "percentile_score_invalid");
  const m = curve.metadata;
  check(
    m.status === "approved" && m.rule_review_status === "calculation_verified",
    "percentile_curve_not_approved",
  );
  check(m.population_verified === true && m.complete === true, "percentile_population_unverified");
  check(
    populationScope === "whole_complete" && m.population_id === OVERALL_POPULATION_ID ||
      populationScope === "required_rule_inputs_present" &&
        m.population_id !== OVERALL_POPULATION_ID,
    "percentile_population_mismatch",
  );
  check(
    publicVersion(m.curve_version) && publicVersion(m.source_model_version) &&
      publicVersion(releaseVersion),
    "percentile_release_invalid",
  );
  const context: NativeObject = {};
  for (const k of [...UNIVERSITY_MATCH_FIELDS, "score_metric", "curve_version"]) context[k] = m[k];
  return base.with({
    reason_code: null,
    inclusive: curve.tail(score, true),
    exclusive: curve.tail(score, false),
    population_id: m.population_id as string,
    data_kind: m.kind as string,
    curve_version: m.curve_version,
    release_version: releaseVersion,
    source_model_version: m.source_model_version,
    context,
    population_scope: populationScope,
  });
}
async function comparisonScope(
  bundle: UniversityPercentileRelease,
  conversion: ScoringResult,
  curve: NativeUniversityScoreDistribution,
): Promise<string> {
  const m = curve.metadata,
    c = bundle.comparisonPopulation ?? null,
    r = bundle.validationReceipt ?? null;
  if (m.population_id === OVERALL_POPULATION_ID) {
    check(c === null, "percentile_population_mismatch");
    return "whole_complete";
  }
  check(c !== null && r !== null, "percentile_population_receipt_missing");
  check(
    (c.format ?? "jungsi.university-comparison-population/v1") ===
        "jungsi.university-comparison-population/v1" &&
      c.status === "approved" &&
      c.scope === "required_rule_inputs_present" &&
      c.base_population_id === OVERALL_POPULATION_ID && publicVersion(c.population_id),
    "percentile_population_not_approved",
  );
  const expected: NativeObject = { source_pack_version: conversion.state.pack_version };
  for (const k of ["population_id", "academic_year", "exam_id", "rule_version", "curve_version"]) {
    expected[k] = m[k];
  }
  check(
    Object.entries(expected).every(([k, v]) => c[k] === v) &&
      eqList(c.required_input_fields, conversion.state.required_input_fields) &&
      publicVersion(c.validation_receipt_version),
    "percentile_population_context_mismatch",
  );
  check(
    r.format === "jungsi.estimate-release-receipt/v1" && r.status === "approved" &&
      r.version === c.validation_receipt_version &&
      Object.entries(expected).every(([k, v]) => r[k] === v) &&
      eqList(r.required_input_fields, conversion.state.required_input_fields) &&
      r.source_model_version === m.source_model_version &&
      r.curve_sha256 === await pythonDefaultStrJsonSha256(curve.data) &&
      r.validation_status === "self_validated_estimate",
    "percentile_population_receipt_mismatch",
  );
  const checks = row(Object.hasOwn(r, "checks") ? r.checks : {}), validation = r.validation_checks;
  check(
    ["model_validation", "filter_complete", "rule_replay", "serialization"].every((k) =>
      checks[k] === true
    ) && validation !== null && typeof validation === "object" && !Array.isArray(validation) &&
      !(validation instanceof JsonFloat) && Object.keys(validation).length > 0 &&
      Object.values(validation).every((v) => v === true),
    "percentile_population_unverified",
  );
  const ledger = row(r.population_ledger),
    full = universityNumber(ledger.total_complete_weight),
    kept = universityNumber(ledger.retained_weight),
    lost = universityNumber(ledger.excluded_weight);
  check(
    full.compare(kept) > 0 && kept.compare(exact(0)) > 0 && lost.compare(exact(0)) > 0 &&
      full.compare(kept.add(lost)) === 0 && kept.compare(curve.total) === 0,
    "percentile_population_weight_mismatch",
  );
  const exclusions = ledger.exclusions;
  check(
    Array.isArray(exclusions) && exclusions.length > 0,
    "percentile_population_exclusion_missing",
  );
  let sum = exact(0);
  for (const item of exclusions) {
    const e = row(item), weight = universityNumber(e.weight), fields = e.missing_input_fields;
    check(
      weight.compare(exact(0)) > 0 && Array.isArray(fields) && fields.length > 0 &&
        fields.every((f) =>
          typeof f === "string" && conversion.state.required_input_fields.includes(f)
        ),
      "percentile_population_exclusion_mismatch",
    );
    sum = sum.add(weight);
  }
  check(sum.compare(lost) === 0, "percentile_population_exclusion_mismatch");
  return "required_rule_inputs_present";
}
export class UniversityPercentileService {
  constructor(private readonly data: UniversityPercentileDataPort) {}
  async calculate(
    offering: Readonly<NativeObject>,
    conversion: ScoringResult,
  ): Promise<PercentileResult> {
    const s = conversion.state;
    const base = new PercentileResult({
      academic_year: offering.academic_year as number,
      exam_id: s.exam_id,
      profile_version: s.profile_version,
      pack_version: s.pack_version,
      score_basis: s.score_basis,
      rule_version: s.rule_version,
      reason_code: "percentile_release_missing",
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
    try {
      check(conversion instanceof ScoringResult && conversion.ready, "conversion_not_ready");
      const context = s.context;
      check(
        CONVERSION_CONTEXT_FIELDS.every((k) =>
          !Object.hasOwn(context, k) || context[k] === offering[k]
        ) &&
          (!Object.hasOwn(context, "offering_pk") || context.offering_pk === offering.offering_id),
        "percentile_conversion_context_mismatch",
      );
      const loaded = await this.data.getPercentile(offering.offering_id as string);
      check(loaded !== null, "percentile_release_missing");
      const required = [
        ...CONVERSION_CONTEXT_FIELDS,
        "offering_pk",
        "rule_id",
        "rule_version",
        "score_scope",
        "score_scale_id",
        "bonus_treatment",
        "exam_id",
        "source_pack_version",
        "exam_type",
      ];
      check(
        required.every((k) => Object.hasOwn(context, k) && context[k] !== null),
        "percentile_conversion_context_missing",
      );
      check(
        CONVERSION_CONTEXT_FIELDS.every((k) => context[k] === offering[k]) &&
          context.offering_pk === offering.offering_id,
        "percentile_conversion_context_mismatch",
      );
      check(
        ["actual_exam", "mock_exam"].includes(s.score_basis as string) &&
          s.academic_year === context.academic_year && s.exam_id === context.exam_id &&
          s.pack_version === context.source_pack_version && s.rule_version === context.rule_version,
        "percentile_conversion_context_mismatch",
      );
      if (s.score_basis === "mock_exam") {
        check(publicVersion(context.mock_compatibility_version), "mock_compatibility_not_approved");
      }
      const bundle = {
        ...loaded,
        bindings: cloneNativeJson([...loaded.bindings]),
        comparisonPopulation: loaded.comparisonPopulation == null
          ? null
          : cloneNativeJson(loaded.comparisonPopulation),
        validationReceipt: loaded.validationReceipt == null
          ? null
          : cloneNativeJson(loaded.validationReceipt),
      };
      check(bundle.status === "approved", "percentile_release_not_approved");
      check(
        publicVersion(bundle.version) && publicVersion(bundle.releaseId),
        "percentile_release_invalid",
      );
      check(
        bundle.academicYear === s.academic_year && bundle.examId === s.exam_id &&
          bundle.sourcePackVersion === s.pack_version &&
          bundle.examType === context.exam_type && bundle.ruleVersion === s.rule_version,
        "percentile_release_context_mismatch",
      );
      check(bundle.curve instanceof NativeUniversityScoreDistribution, "percentile_curve_invalid");
      const curve = new NativeUniversityScoreDistribution(bundle.curve.data), m = curve.metadata;
      check(
        UNIVERSITY_MATCH_FIELDS.filter((k) => k !== "population_id").every((k) =>
          m[k] === context[k]
        ),
        "percentile_curve_context_mismatch",
      );
      check(
        [["source_pack_version", s.pack_version], ["offering_pk", offering.offering_id]].every((
          [k, v],
        ) => !Object.hasOwn(m, k as string) || m[k as string] === v),
        "percentile_curve_context_mismatch",
      );
      const seen = new Set<string>();
      let binding: NativeObject | null = null;
      for (const raw of bundle.bindings) {
        const b = row(raw);
        check(
          typeof b.academic_year === "number" && Number.isSafeInteger(b.academic_year) &&
            (typeof b.offering_pk === "string" || typeof b.offering_pk === "bigint" ||
              typeof b.offering_pk === "number" && Number.isSafeInteger(b.offering_pk)),
          "percentile_binding_mismatch",
        );
        const key = String(b.academic_year) + "\0" + String(b.offering_pk);
        check(!seen.has(key), "percentile_binding_ambiguous");
        seen.add(key);
        check(
          b.academic_year === bundle.academicYear && b.rule_version === bundle.ruleVersion &&
            b.curve_version === m.curve_version,
          "percentile_binding_mismatch",
        );
        if (key === String(offering.academic_year) + "\0" + String(offering.offering_id)) {
          binding = b;
        }
      }
      check(binding !== null, "percentile_binding_missing");
      check(
        CONVERSION_CONTEXT_FIELDS.every((k) => binding[k] === offering[k]) &&
          binding.rule_version === s.rule_version && binding.curve_version === m.curve_version,
        "percentile_binding_mismatch",
      );
      const scope = await comparisonScope(bundle, conversion, curve);
      return resultForUniversityCurve(base, curve, s.score!, bundle.version, scope);
    } catch (e) {
      return base.with({
        reason_code: e instanceof ContractError || e instanceof AccessError
          ? e.code
          : "percentile_release_invalid",
      });
    }
  }
}
