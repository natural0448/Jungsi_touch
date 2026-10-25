/** Scoped mathematical references. Never manufacture a production conversion approval. */
import { ContractError, exact, Rational, requireContract as check } from "../domain/exact.ts";
import { type NativeConversionRule } from "../domain/conversion_release.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import type { SchoolScoreInputs } from "./school_score_inputs.ts";
export interface ReferenceDerivation {
  readonly field: string;
  readonly operation: "observed_max" | "observed_sum" | "observed_average";
  readonly inputs: readonly string[];
  readonly minimumPresent: number;
}
export interface SchoolReferenceFunction {
  readonly version: string;
  readonly academicYear: number;
  readonly examId: string;
  readonly packVersion: string;
  readonly examType: string;
  readonly binding: Readonly<NativeObject>;
  readonly sourceSha256: string;
  readonly independentSha256: string;
  readonly scoreScaleId: string;
  readonly requiredFields: readonly string[];
  readonly inquiryCategories: readonly string[];
  readonly minimumInquiry: number;
  readonly positiveScoreRequired: boolean;
  readonly mixedSocialScienceAllowed?: boolean;
  readonly mathChoices?: readonly string[];
  readonly inquirySubjects?: readonly string[];
  readonly derivations: readonly ReferenceDerivation[];
  readonly rule: NativeConversionRule;
}
export interface SchoolReferenceDataPort {
  /** Only the exact selected offering. Source verifies current head and pinned bytes. */
  getReference(offeringId: string): Promise<SchoolReferenceFunction | null>;
}
export interface SchoolReferenceResult {
  readonly status: "reference_calculated" | "pending";
  readonly reasonCode: string;
  readonly convertedScore: string | null;
  readonly exactScore: Rational | null;
  readonly ruleVersion: string | null;
  readonly releaseVersion: string | null;
  readonly officialMaxScore: string | number | bigint | null;
  readonly tableVersions: readonly string[];
  readonly requiredFields: readonly string[];
  readonly scoreScaleId: string | null;
}
export interface SchoolReferenceScoringPort {
  calculate(
    offering: Readonly<NativeObject>,
    input: SchoolScoreInputs,
  ): Promise<SchoolReferenceResult>;
}
const BASE = new Set([
  "korean_standard_score",
  "math_standard_score",
  "inquiry1_standard_score",
  "inquiry2_standard_score",
  "korean_percentile",
  "math_percentile",
  "inquiry1_percentile",
  "inquiry2_percentile",
  "korean_grade",
  "math_grade",
  "inquiry1_grade",
  "inquiry2_grade",
  "korean_choice",
  "math_choice",
  "inquiry1_subject",
  "inquiry2_subject",
  "english_grade",
  "korean_history_grade",
]);
const DERIVED = new Set([
  "inquiry_best_percentile",
  "inquiry_sum_percentile",
  "inquiry_average_percentile",
  "korean_math_best_percentile",
]);
const CONTEXT = ["academic_year", "university_id", "campus", "department", "track", "group"];
function numeric(value: unknown): Rational {
  check(
    typeof value === "number" && Number.isSafeInteger(value) || typeof value === "bigint" ||
      typeof value === "string" || value instanceof JsonFloat,
    "reference_input_invalid",
  );
  return exact(value instanceof JsonFloat ? value.lexeme : value);
}
function percentile(value: unknown): Rational {
  const p = numeric(value);
  check(
    p.denominator === 1n && p.compare(exact(0)) >= 0 && p.compare(exact(100)) <= 0,
    "reference_percentile_invalid",
  );
  return p;
}
/** Domain supplied by reviewed reference package; source values are never rewritten. */
export function projectReferenceInputs(
  f: SchoolReferenceFunction,
  input: SchoolScoreInputs,
): NativeObject {
  const values = cloneNativeJson(input.values) as NativeObject, present: number[] = [];
  check(
    f.minimumInquiry >= 0 && f.minimumInquiry <= 2 && Number.isSafeInteger(f.minimumInquiry),
    "reference_domain_invalid",
  );
  const names = new Set<string>();
  const usesInquiry = f.minimumInquiry > 0 ||
    f.derivations.some((d) => d.field.startsWith("inquiry_")) ||
    [...f.requiredFields, ...Object.keys(f.rule.data.inputs as NativeObject)].some((k) =>
      k.startsWith("inquiry")
    );
  for (let i = 0; usesInquiry && i < 2; i++) {
    const prefix = "inquiry" + (i + 1),
      name = values[prefix + "_subject"],
      p = values[prefix + "_percentile"];
    if (name == null && p == null) continue;
    check(typeof name === "string" && name.length > 0 && p != null, "reference_inquiry_incomplete");
    check(!names.has(name), "reference_duplicate_inquiry");
    names.add(name);
    check(
      f.inquiryCategories.includes(input.inquiryCategories[i]),
      "reference_inquiry_category_unsupported",
    );
    check(
      !f.inquirySubjects || f.inquirySubjects.includes(name),
      "reference_inquiry_category_unsupported",
    );
    percentile(p);
    present.push(i);
  }
  check(present.length >= f.minimumInquiry, "reference_required_input_missing");
  if (f.mixedSocialScienceAllowed === false) {
    check(
      !present.some((i) => input.inquiryCategories[i] === "social") ||
        !present.some((i) => input.inquiryCategories[i] === "science"),
      "reference_inquiry_category_unsupported",
    );
  }
  if (f.mathChoices) {
    check(
      typeof values.math_choice === "string" && f.mathChoices.includes(values.math_choice),
      "reference_required_input_missing",
    );
  }
  for (const field of f.requiredFields) {
    check(BASE.has(field) && values[field] != null, "reference_required_input_missing");
    if (field.endsWith("_grade")) {
      const grade = numeric(values[field]);
      check(
        grade.denominator === 1n && grade.compare(exact(1)) >= 0 && grade.compare(exact(9)) <= 0,
        "reference_grade_invalid",
      );
    }
  }
  const seen = new Set<string>();
  for (const d of f.derivations) {
    check(
      DERIVED.has(d.field) && !seen.has(d.field) && !Object.hasOwn(values, d.field) &&
        Number.isSafeInteger(d.minimumPresent) && d.minimumPresent >= 1 && d.minimumPresent <= 2,
      "reference_derivation_invalid",
    );
    seen.add(d.field);
    const expected = d.field === "korean_math_best_percentile"
      ? ["korean_percentile", "math_percentile"]
      : ["inquiry1_percentile", "inquiry2_percentile"];
    check(
      d.inputs.length === 2 && d.inputs.every((v, i) => v === expected[i]),
      "reference_derivation_invalid",
    );
    check(
      d.operation ===
        (d.field === "inquiry_sum_percentile"
          ? "observed_sum"
          : d.field === "inquiry_average_percentile"
          ? "observed_average"
          : "observed_max"),
      "reference_derivation_invalid",
    );
    const operands = expected.filter((k) => values[k] != null).map((k) => percentile(values[k]));
    check(operands.length >= d.minimumPresent, "reference_required_input_missing");
    let result: Rational;
    if (d.operation === "observed_max") {
      result = operands.reduce((a, b) => a.compare(b) >= 0 ? a : b);
    } else {
      check(
        d.operation === "observed_sum" || d.operation === "observed_average",
        "reference_derivation_invalid",
      );
      result = operands.reduce((a, b) => a.add(b), exact(0));
      if (d.operation === "observed_average") result = result.divide(exact(operands.length));
    }
    // Decimal strings preserve exact values for the kernel; no binary floating conversion.
    check(result.denominator === 1n || result.denominator === 2n, "reference_derivation_invalid");
    values[d.field] = result.denominator === 1n
      ? result.numerator.toString()
      : (result.numerator / 2n).toString() + ".5";
  }
  return values;
}
export class SchoolReferenceScoringService implements SchoolReferenceScoringPort {
  constructor(private readonly data: SchoolReferenceDataPort) {}
  async calculate(
    offering: Readonly<NativeObject>,
    input: SchoolScoreInputs,
  ): Promise<SchoolReferenceResult> {
    const pending = (reasonCode: string): SchoolReferenceResult => ({
      status: "pending",
      reasonCode,
      convertedScore: null,
      exactScore: null,
      ruleVersion: null,
      releaseVersion: null,
      officialMaxScore: null,
      tableVersions: [],
      requiredFields: [],
      scoreScaleId: null,
    });
    try {
      const f = await this.data.getReference(String(offering.offering_id));
      check(f !== null, "reference_conversion_missing");
      check(
        f.academicYear === offering.academic_year && f.academicYear === input.academicYear &&
          f.examId === input.examId && f.packVersion === input.packVersion &&
          f.examType === input.examType,
        "reference_exam_context_mismatch",
      );
      check(
        f.binding.offering_pk === offering.offering_id &&
          CONTEXT.every((k) => Object.hasOwn(offering, k) && f.binding[k] === offering[k]),
        "reference_offering_context_mismatch",
      );
      check(
        f.rule.data.academic_year === f.academicYear &&
          f.rule.data.score_scale_id === f.scoreScaleId &&
          f.rule.data.score_axis === "native_csat_points" &&
          f.rule.data.engine_approved === false &&
          f.rule.data.production_allowed === false && f.rule.data.data_kind === "official_rule" &&
          ["source_verified", "calculation_verified"].includes(String(f.rule.data.review_status)) &&
          f.binding.rule_version === f.rule.data.rule_version,
        "reference_rule_context_mismatch",
      );
      const values = projectReferenceInputs(f, input),
        fields = Object.keys(f.rule.data.inputs as NativeObject);
      check(fields.every((v) => BASE.has(v) || DERIVED.has(v)), "reference_rule_input_unsupported");
      const tables = Object.values(f.rule.data.tables as NativeObject) as NativeObject[];
      check(
        tables.every((t) => t.status === "verified" && typeof t.version === "string"),
        "reference_table_pending",
      );
      for (const component of [f.rule.data, ...tables]) {
        check(
          [["academic_year", f.academicYear], ["exam_id", f.examId], [
            "source_pack_version",
            f.packVersion,
          ], ["rule_version", f.rule.data.rule_version]].every(([key, value]) =>
            !Object.hasOwn(component, key as string) || component[key as string] === value
          ),
          "reference_rule_context_mismatch",
        );
      }
      const calculated = f.rule.calculate({
        academic_year: input.academicYear,
        exam_id: input.examId,
        profile_version: input.profileVersion,
        score_basis: input.scoreBasis,
        values,
      }, true);
      check(
        !f.positiveScoreRequired || calculated.score.compare(exact(0)) > 0,
        "reference_score_outside_domain",
      );
      const maximum = f.rule.data.official_max_score ?? null;
      check(
        maximum === null || typeof maximum === "string" || typeof maximum === "bigint" ||
          typeof maximum === "number" && Number.isSafeInteger(maximum),
        "reference_rule_context_mismatch",
      );
      return {
        status: "reference_calculated",
        reasonCode: "reference_conversion_not_production_approved",
        convertedScore: calculated.convertedScore,
        exactScore: calculated.score,
        ruleVersion: f.rule.data.rule_version as string,
        releaseVersion: f.version,
        officialMaxScore: maximum,
        tableVersions: tables.map((t) => t.version as string),
        requiredFields: [...new Set([...f.requiredFields, ...fields])].sort(),
        scoreScaleId: f.scoreScaleId,
      };
    } catch (e) {
      const known = e instanceof ContractError && /^reference_[a-z0-9_]+$/.test(e.code);
      return pending(known ? e.code : "reference_conversion_unavailable");
    }
  }
}
