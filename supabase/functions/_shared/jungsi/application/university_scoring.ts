/** Same-exam university scoring; no curve dependency, inferred report scores or research promotion. */
import { AccessError } from "./access.ts";
import { validateScoreInput } from "./overall_analysis.ts";
import type { StoredProfile } from "./platform_repository.ts";
import { explainRule } from "./rule_explanations.ts";
import { type NativeExamAnalysis, NativeExamPack } from "../domain/exam_pack.ts";
import { type SchoolScoreInputs, schoolScoreInputs } from "./school_score_inputs.ts";
import {
  type SchoolReferenceFunction,
  type SchoolReferenceResult,
  type SchoolReferenceScoringPort,
  SchoolReferenceScoringService,
} from "./school_reference_scoring.ts";
import { conversionBindingKey, NativeConversionRelease } from "../domain/conversion_release.ts";
import { ContractError, Rational, requireContract as check } from "../domain/exact.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";

export const CONVERSION_CONTEXT_FIELDS = [
  "academic_year",
  "university_id",
  "campus",
  "department",
  "track",
  "group",
] as const;
const AREAS = ["korean", "math", "inquiry1", "inquiry2"] as const;
const SUPPORTED = new Set([
  ...AREAS.flatMap((a) => ["standard_score", "percentile", "grade"].map((f) => a + "_" + f)),
  "korean_choice",
  "math_choice",
  "inquiry1_subject",
  "inquiry2_subject",
  "english_grade",
  "korean_history_grade",
]);
export function publicVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function record(v: unknown): NativeObject {
  check(
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat),
    "conversion_release_invalid",
  );
  return v as NativeObject;
}
function freeze<T extends NativeJson>(v: T): T {
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) v.forEach(freeze);
    else if (!(v instanceof JsonFloat)) Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
export interface UniversityConversionRelease {
  readonly version: string;
  readonly status: string;
  readonly academicYear: number;
  readonly examId: string;
  readonly sourcePackVersion: string;
  readonly examType: string;
  readonly release: NativeConversionRelease;
  readonly bindings: readonly NativeObject[];
  readonly mockCompatibility?: NativeObject | null;
}
export interface UniversityScoringDataPort {
  getExamPack(examId: string): Promise<NativeExamPack | null>;
  getConversion(offeringId: string): Promise<UniversityConversionRelease | null>;
  getReference?(offeringId: string): Promise<SchoolReferenceFunction | null>;
  withScoringBatch?<T>(work: () => Promise<T>): Promise<T>;
}
export interface ScoringState {
  readonly academic_year: number;
  readonly profile_version: string;
  readonly pack_version: string;
  readonly exam_id: string;
  readonly score_basis: "actual_exam" | "mock_exam" | null;
  readonly reason_code: string | null;
  readonly score: Rational | null;
  readonly converted_score: string | null;
  readonly official_max_score: string | number | bigint | null;
  readonly rule_version: string | null;
  readonly release_version: string | null;
  readonly table_versions: readonly string[];
  readonly values: Readonly<NativeObject>;
  readonly reported_sources: Readonly<NativeObject>;
  readonly context: Readonly<NativeObject>;
  readonly required_input_fields: readonly string[];
  readonly explanations: readonly NativeObject[];
}
const REFERENCE_CALCULATIONS = new WeakMap<
  ScoringResult,
  Readonly<{ reference: SchoolReferenceResult; input: SchoolScoreInputs; scoresKey: string }>
>();
/** The exact reference calculation that produced this result object, if any. */
export function referenceCalculationOf(
  result: ScoringResult,
):
  | Readonly<{ reference: SchoolReferenceResult; input: SchoolScoreInputs; scoresKey: string }>
  | null {
  return REFERENCE_CALCULATIONS.get(result) ?? null;
}
export class ScoringResult {
  readonly state: Readonly<ScoringState>;
  constructor(state: ScoringState) {
    this.state = Object.freeze({
      ...state,
      values: freeze(cloneNativeJson(state.values)),
      reported_sources: freeze(cloneNativeJson(state.reported_sources)),
      context: freeze(cloneNativeJson(state.context)),
      table_versions: Object.freeze([...state.table_versions]),
      required_input_fields: Object.freeze([...state.required_input_fields]),
      explanations: freeze(cloneNativeJson([...state.explanations])),
    });
    Object.freeze(this);
  }
  get ready(): boolean {
    return this.state.score !== null && this.state.reason_code === null;
  }
  with(patch: Partial<ScoringState>): ScoringResult {
    return new ScoringResult({ ...this.state, ...patch });
  }
  dto(): NativeObject {
    const s = this.state;
    return {
      status: this.ready ? "ready" : "pending",
      reason_code: s.reason_code,
      score_basis: s.score_basis,
      score_scope: "csat_component",
      converted_score: s.converted_score,
      official_max_score: s.official_max_score,
      academic_year: s.academic_year,
      exam_id: s.exam_id,
      rule_version: s.rule_version,
      release_version: s.release_version,
      table_versions: [...s.table_versions],
      profile_version: s.profile_version,
      pack_version: s.pack_version,
    };
  }
  internalProfile(): NativeObject {
    const s = this.state;
    return {
      academic_year: s.academic_year,
      exam_id: s.exam_id,
      profile_version: s.profile_version,
      score_basis: s.score_basis,
      values: cloneNativeJson(s.values),
      reported_score_sources: cloneNativeJson(s.reported_sources),
    };
  }
  internalCalculation(): NativeObject {
    const s = this.state;
    check(this.ready && s.score, "conversion_not_ready");
    return {
      academic_year: s.academic_year,
      exam_id: s.exam_id,
      profile_version: s.profile_version,
      score_basis: s.score_basis,
      rule_version: s.rule_version,
      calculation_status: "calculated",
      converted_score: s.converted_score,
      score_scope: "csat_component",
      exact_score: { numerator: s.score.numerator, denominator: s.score.denominator },
    };
  }
}
export class UniversityScoringService {
  private readonly reference?: SchoolReferenceScoringPort;
  private preparedInBatch?: Map<
    string,
    { pack: NativeExamPack; analyzed: NativeExamAnalysis; input: SchoolScoreInputs }
  >;
  constructor(
    private readonly data: UniversityScoringDataPort,
    reference?: SchoolReferenceScoringPort,
  ) {
    this.reference = reference ??
      (data.getReference
        ? new SchoolReferenceScoringService({ getReference: data.getReference.bind(data) })
        : undefined);
  }
  async batch<T>(work: () => Promise<T>): Promise<T> {
    if (this.preparedInBatch) throw new AccessError("analysis_release_invalid", 503);
    const run = async () => {
      this.preparedInBatch = new Map();
      try {
        return await work();
      } finally {
        this.preparedInBatch = undefined;
      }
    };
    return this.data.withScoringBatch ? await this.data.withScoringBatch(run) : await run();
  }
  async calculate(
    offering: Readonly<NativeObject>,
    profile: Pick<StoredProfile, "profile_id" | "scores">,
  ): Promise<ScoringResult> {
    const scores = profile.scores;
    let result = new ScoringResult({
      academic_year: offering.academic_year as number,
      profile_version: profile.profile_id,
      pack_version: scores.pack_version as string,
      exam_id: scores.exam_id as string,
      score_basis: null,
      reason_code: "conversion_release_missing",
      score: null,
      converted_score: null,
      official_max_score: null,
      rule_version: null,
      release_version: null,
      table_versions: [],
      values: {},
      reported_sources: {},
      context: {},
      required_input_fields: [],
      explanations: [],
    });
    try {
      const cacheKey = this.preparedInBatch
        ? nativeJsonText([profile.profile_id, scores], true)
        : null;
      let facts = cacheKey ? this.preparedInBatch!.get(cacheKey) : undefined;
      if (!facts) {
        const payload = validateScoreInput(scores),
          pack = await this.data.getExamPack(scores.exam_id as string);
        check(pack instanceof NativeExamPack, "conversion_exam_unavailable");
        check(
          pack.examId === scores.exam_id && pack.packVersion === scores.pack_version,
          "conversion_pack_mismatch",
        );
        const analyzed = pack.analyze(payload);
        facts = {
          pack,
          analyzed,
          input: schoolScoreInputs(pack, analyzed, scores, profile.profile_id),
        };
        if (cacheKey) this.preparedInBatch!.set(cacheKey, facts);
      }
      const { pack, analyzed } = facts,
        exam = analyzed.exam,
        basis = exam.exam_type === "csat" ? "actual_exam" : "mock_exam";
      result = result.with({ score_basis: basis });
      check(exam.academic_year === offering.academic_year, "year_bridge_required");
      const loaded = await this.data.getConversion(offering.offering_id as string);
      if (loaded === null && this.reference) {
        const input = facts.input;
        const reference = await this.reference.calculate(offering, input);
        if (reference.reasonCode === "reference_conversion_missing") return result;
        const referenced = result.with({
          reason_code: reference.reasonCode,
          converted_score: reference.convertedScore,
          // A reference calculation never becomes a production-ready ScoringResult.
          score: null,
          official_max_score: reference.officialMaxScore,
          rule_version: reference.ruleVersion,
          release_version: reference.releaseVersion,
          table_versions: reference.tableVersions,
          required_input_fields: reference.requiredFields,
          values: input.values,
          reported_sources: input.reportedSources,
          context: {
            reference_status: reference.status,
            score_scale_id: reference.scoreScaleId,
            calculation_review_scope: "same_exam_mathematical_reference",
          },
        });
        // Same request: the reference-percentile step reuses this exact result instead of
        // recomputing it (identity-keyed, never serialized or shared across requests).
        REFERENCE_CALCULATIONS.set(
          referenced,
          Object.freeze({
            reference,
            input,
            scoresKey: nativeJsonText([profile.profile_id, scores], true),
          }),
        );
        return referenced;
      }
      check(loaded !== null && typeof loaded === "object", "conversion_release_missing");
      const bundle = {
        ...loaded,
        bindings: cloneNativeJson([...loaded.bindings]),
        mockCompatibility: loaded.mockCompatibility == null
          ? null
          : cloneNativeJson(loaded.mockCompatibility),
      };
      check(bundle.status === "approved", "conversion_release_not_approved");
      check(
        publicVersion(bundle.version) && bundle.release instanceof NativeConversionRelease,
        "conversion_release_invalid",
      );
      check(bundle.academicYear === offering.academic_year, "conversion_year_mismatch");
      check(
        publicVersion(bundle.examId) && publicVersion(bundle.sourcePackVersion) &&
          bundle.examType === "csat",
        "conversion_exam_mismatch",
      );
      if (basis === "actual_exam") {
        check(
          bundle.examId === pack.examId && bundle.sourcePackVersion === pack.packVersion,
          "conversion_exam_mismatch",
        );
      } else {
        const c = bundle.mockCompatibility,
          expected = {
            source_exam_id: pack.examId,
            source_pack_version: pack.packVersion,
            source_exam_type: exam.exam_type,
            rule_exam_id: bundle.examId,
            rule_pack_version: bundle.sourcePackVersion,
          };
        check(
          c !== null && c.status === "approved" && publicVersion(c.version) &&
            Object.entries(expected).every(([k, v]) => c[k] === v),
          "mock_compatibility_not_approved",
        );
      }
      const seen = new Set<string>();
      let binding: NativeObject | null = null;
      for (const raw of bundle.bindings) {
        const b = record(raw), key = conversionBindingKey(b.academic_year, b.offering_pk);
        check(!seen.has(key), "RULE_BINDING_AMBIGUOUS");
        seen.add(key);
        check(
          bundle.release.binding(b.academic_year as number, b.offering_pk as string) ===
            b.rule_version,
          "conversion_binding_mismatch",
        );
        if (key === conversionBindingKey(offering.academic_year, offering.offering_id)) binding = b;
      }
      check(binding !== null, "conversion_binding_missing");
      check(
        CONVERSION_CONTEXT_FIELDS.every((k) =>
          Object.hasOwn(offering, k) && binding[k] === offering[k]
        ),
        "conversion_context_mismatch",
      );
      const rule = bundle.release.rule(binding.rule_version as string);
      check(rule !== null, "conversion_release_invalid");
      const tables = record(rule.data.tables), tableRows = Object.values(tables).map(record);
      check(
        publicVersion(rule.data.rule_version) && publicVersion(bundle.release.releaseId) &&
          tableRows.every((t) => publicVersion(t.version)),
        "conversion_release_invalid",
      );
      for (const m of [rule.data, ...tableRows]) {
        check(
          [["exam_id", bundle.examId], ["source_pack_version", bundle.sourcePackVersion], [
            "rule_version",
            rule.data.rule_version,
          ]]
            .every(([k, v]) => !Object.hasOwn(m, k as string) || m[k as string] === v),
          "conversion_rule_context_mismatch",
        );
      }
      check(tableRows.every((t) => t.status === "verified"), "CONVERSION_TABLE_PENDING");
      const inputs = record(rule.data.inputs);
      check(Object.keys(inputs).every((k) => SUPPORTED.has(k)), "unsupported_conversion_input");
      const prepared = facts.input,
        values = prepared.values,
        sources = prepared.reportedSources;
      result = result.with({
        rule_version: rule.data.rule_version as string,
        release_version: bundle.version,
        table_versions: tableRows.map((t) => t.version as string),
        values,
        reported_sources: sources,
        required_input_fields: Object.keys(inputs).sort(),
      });
      const calculated = rule.calculate(result.internalProfile()),
        maximum = rule.data.official_max_score ?? null;
      check(
        maximum === null || typeof maximum === "string" || typeof maximum === "bigint" ||
          typeof maximum === "number" && Number.isSafeInteger(maximum),
        "conversion_release_invalid",
      );
      check(
        rule.data.score_scale_id == null || publicVersion(rule.data.score_scale_id),
        "conversion_rule_context_mismatch",
      );
      check(
        rule.data.bonus_treatment == null ||
          ["included", "excluded"].includes(rule.data.bonus_treatment as string),
        "conversion_rule_context_mismatch",
      );
      const context: NativeObject = Object.fromEntries(
        CONVERSION_CONTEXT_FIELDS.map((k) => [k, offering[k]]),
      );
      Object.assign(context, {
        offering_pk: offering.offering_id,
        rule_id: rule.data.rule_id,
        rule_version: rule.data.rule_version,
        score_scope: rule.data.score_scope,
        score_scale_id: rule.data.score_scale_id ?? null,
        bonus_treatment: rule.data.bonus_treatment ?? null,
        exam_id: pack.examId,
        source_pack_version: pack.packVersion,
        exam_type: exam.exam_type,
        rule_exam_id: bundle.examId,
        rule_pack_version: bundle.sourcePackVersion,
        mock_compatibility_version: basis === "mock_exam"
          ? bundle.mockCompatibility!.version
          : null,
      });
      check(
        Object.values(context).every((v) =>
          v === null || typeof v === "string" || typeof v === "bigint" ||
          typeof v === "number" && Number.isSafeInteger(v)
        ),
        "conversion_rule_context_mismatch",
      );
      return result.with({
        reason_code: null,
        score: calculated.score,
        converted_score: calculated.convertedScore,
        official_max_score: maximum,
        context,
        explanations: explainRule(rule.data, values, calculated.trace),
      });
    } catch (e) {
      return result.with({
        reason_code: e instanceof ContractError || e instanceof AccessError
          ? e.code
          : "conversion_release_invalid",
      });
    }
  }
}
