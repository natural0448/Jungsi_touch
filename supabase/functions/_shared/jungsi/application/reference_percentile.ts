/** Same-exam mathematical reference only; never creates a production percentile or judgment. */
import { validateScoreInput } from "./overall_analysis.ts";
import type { StoredProfile } from "./platform_repository.ts";
import { type SchoolScoreInputs, schoolScoreInputs } from "./school_score_inputs.ts";
import { SchoolReferenceScoringService } from "./school_reference_scoring.ts";
import {
  CONVERSION_CONTEXT_FIELDS,
  ScoringResult,
  type UniversityScoringDataPort,
} from "./university_scoring.ts";
import { NativeExamPack } from "../domain/exam_pack.ts";
import { Rational } from "../domain/exact.ts";
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { SavedReferenceTailProjection } from "../domain/saved_reference_projection.ts";

/** Server-selected provider must independently bind the public offering ID to the physical
 * release/year/PK, verified bytes, evidence and current head. It uses the existing request budget. */
export interface ReferenceTailPort {
  getReferenceTail?(
    offeringId: string,
    signal?: AbortSignal,
  ): Promise<ReferenceTailSelection | null>;
  /** Digest of the approved saved-tail selection, or null when none is selected. */
  referenceTailPins?(): Promise<string | null>;
}
export interface ReferenceTailSelection {
  readonly projection: SavedReferenceTailProjection;
  readonly binding: Readonly<NativeObject>;
  /** Verify current exam-pack bytes against model-pack bytes or an independently
   * verified compatibility receipt, plus exact formula/version/score-axis binding. */
  assertCompatible(identity: Readonly<NativeObject>, signal?: AbortSignal): Promise<void>;
  assertCurrent(signal?: AbortSignal): Promise<void>;
}
export class ReferencePercentileService {
  private readonly inputs = new Map<string, SchoolScoreInputs>();
  constructor(private readonly source: ReferenceTailPort & UniversityScoringDataPort) {}
  async calculate(
    offering: Readonly<NativeObject>,
    conversion: ScoringResult,
    profile: Pick<StoredProfile, "profile_id" | "scores">,
    signal?: AbortSignal,
  ): Promise<NativeObject> {
    const pending = (reason: string): NativeObject => ({
      status: "pending",
      reason_code: reason,
      estimated_upper_cumulative_percent_all_examinees: null,
      calculation_review_scope: "same_exam_mathematical_reference",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    });
    try {
      if (signal?.aborted) return pending("reference_tail_unavailable");
      if (!(conversion instanceof ScoringResult)) {
        return pending("reference_conversion_unavailable");
      }
      const s = conversion.state;
      if (
        conversion.ready || s.reason_code !== "reference_conversion_not_production_approved" ||
        s.context.reference_status !== "reference_calculated" || s.converted_score === null ||
        s.profile_version !== profile.profile_id || s.academic_year !== offering.academic_year ||
        s.exam_id !== profile.scores.exam_id || s.pack_version !== profile.scores.pack_version
      ) {
        return pending("reference_conversion_unavailable");
      }
      if (!this.source.getReferenceTail || !this.source.getReference) {
        return pending("reference_tail_missing");
      }
      if (typeof offering.offering_id !== "string") {
        return pending("reference_tail_context_mismatch");
      }
      const selected = await this.source.getReferenceTail(offering.offering_id, signal);
      if (selected === null) return pending("reference_tail_missing");
      if (
        !(selected.projection instanceof SavedReferenceTailProjection) ||
        typeof selected.assertCurrent !== "function" ||
        typeof selected.assertCompatible !== "function" ||
        selected.binding.offering_id !== offering.offering_id ||
        !CONVERSION_CONTEXT_FIELDS.every((k) => selected.binding[k] === offering[k]) ||
        selected.binding.rule_version !== s.rule_version
      ) return pending("reference_tail_context_mismatch");
      await selected.assertCurrent(signal);
      const inputKey = nativeJsonText([profile.profile_id, profile.scores], true);
      let input = this.inputs.get(inputKey);
      if (!input) {
        const pack = await this.source.getExamPack(s.exam_id);
        if (
          !(pack instanceof NativeExamPack) || pack.examId !== s.exam_id ||
          pack.packVersion !== s.pack_version
        ) {
          return pending("reference_exam_context_mismatch");
        }
        input = schoolScoreInputs(
          pack,
          pack.analyze(validateScoreInput(profile.scores)),
          profile.scores,
          profile.profile_id,
        );
        if (inputKey !== nativeJsonText([profile.profile_id, profile.scores], true)) {
          return pending("reference_conversion_context_mismatch");
        }
        this.inputs.set(inputKey, input);
      }
      const reference = await new SchoolReferenceScoringService({
        getReference: (id) => this.source.getReference!(id),
      }).calculate(offering, input);
      if (
        reference.status !== "reference_calculated" ||
        !(reference.exactScore instanceof Rational) ||
        reference.convertedScore !== s.converted_score ||
        reference.ruleVersion !== s.rule_version ||
        reference.releaseVersion !== s.release_version ||
        reference.scoreScaleId !== s.context.score_scale_id ||
        input.scoreBasis !== s.score_basis ||
        nativeJsonText(input.values, true) !== nativeJsonText(s.values, true) ||
        nativeJsonText(input.reportedSources, true) !== nativeJsonText(s.reported_sources, true)
      ) {
        return pending("reference_conversion_context_mismatch");
      }
      const identity = {
        academic_year: s.academic_year,
        exam_id: s.exam_id,
        exam_type: input.examType,
        source_pack_version: s.pack_version,
        rule_version: s.rule_version,
        score_scale_id: reference.scoreScaleId,
        offering_id: offering.offering_id,
      };
      await selected.assertCompatible(identity, signal);
      const result = selected.projection.query(reference.exactScore, identity);
      await selected.assertCurrent(signal);
      if (inputKey !== nativeJsonText([profile.profile_id, profile.scores], true)) {
        return pending("reference_conversion_context_mismatch");
      }
      if (signal?.aborted) return pending("reference_tail_unavailable");
      if (result === null) return pending("reference_score_outside_saved_support");
      return {
        status: result.status,
        metric: result.metric,
        estimated_upper_cumulative_percent_all_examinees:
          result.estimated_upper_cumulative_percent_all_examinees,
        denominator_kind: result.denominator_kind,
        calculation_review_scope: result.calculation_review_scope,
        production_allowed: false,
        actual_admission_full_total_approved: false,
      };
    } catch {
      return pending("reference_tail_unavailable");
    }
  }
}
