import type { AttendanceConfirmation } from "./reference_attendance.ts";
/** Same-exam mathematical reference only; never creates a production percentile or judgment. */
import { validateScoreInput } from "./overall_analysis.ts";
import type { StoredProfile } from "./platform_repository.ts";
import { type SchoolScoreInputs, schoolScoreInputs } from "./school_score_inputs.ts";
import { SchoolReferenceScoringService } from "./school_reference_scoring.ts";
import {
  CONVERSION_CONTEXT_FIELDS,
  referenceCalculationOf,
  ScoringResult,
  type UniversityScoringDataPort,
} from "./university_scoring.ts";
import { NativeExamPack } from "../domain/exam_pack.ts";
import { Rational } from "../domain/exact.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { SavedReferenceTailProjection } from "../domain/saved_reference_projection.ts";
import { ChunkedReferenceTailProjection } from "../domain/chunked_reference_projection.ts";
import { NativeReferenceCdfProjection } from "../domain/native_reference_cdf_projection.ts";

/** Server-selected provider must independently bind the public offering ID to the physical
 * release/year/PK, verified bytes, evidence and current head. It uses the existing request budget. */
export interface ReferenceTailPort {
  getReferenceTail?(
    offeringId: string,
    signal?: AbortSignal,
  ): Promise<ReferenceTailSelection | null>;
  getChunkedReferenceTail?(
    offeringId: string,
    signal?: AbortSignal,
  ): Promise<ChunkedReferenceTailSelection | null>;
  getNativeReferenceTail?(
    offeringId: string,
    signal?: AbortSignal,
  ): Promise<NativeReferenceTailSelection | null>;
  /** Retain the Owner cache key for an already approved reference selection. */
  referenceTailPins?(): Promise<string | null>;
  /** Optional warm-up of selected tails. Cancellation or scope failures propagate to the caller. */
  prefetchReferenceTails?(offeringIds: readonly string[], signal?: AbortSignal): Promise<void>;
}
export interface ReferenceTailSelection {
  readonly projection: SavedReferenceTailProjection;
  readonly binding: Readonly<NativeObject>;
  /** Verify current exam-pack bytes against model-pack bytes or an independently
   * verified compatibility receipt, plus exact formula/version/score-axis binding. */
  assertCompatible(identity: Readonly<NativeObject>, signal?: AbortSignal): Promise<void>;
  assertCurrent(signal?: AbortSignal): Promise<void>;
  /** Server-only proof, issued only after independent current/compatibility checks. */
  verifiedProvenance?(
    identity: Readonly<NativeObject>,
    signal?: AbortSignal,
  ): Promise<Readonly<NativeObject>>;
}
export interface ChunkedReferenceTailSelection {
  readonly projection: ChunkedReferenceTailProjection;
  readonly binding: Readonly<NativeObject>;
  assertCompatible(identity: Readonly<NativeObject>, signal?: AbortSignal): Promise<void>;
  assertCurrent(signal?: AbortSignal): Promise<void>;
  verifiedProvenance?(
    identity: Readonly<NativeObject>,
    signal?: AbortSignal,
  ): Promise<Readonly<NativeObject>>;
}
export interface NativeReferenceTailSelection {
  readonly projection: NativeReferenceCdfProjection;
  readonly binding: Readonly<NativeObject>;
  assertCompatible(identity: Readonly<NativeObject>, signal?: AbortSignal): Promise<void>;
  assertCurrent(signal?: AbortSignal): Promise<void>;
  verifiedProvenance?(
    identity: Readonly<NativeObject>,
    signal?: AbortSignal,
  ): Promise<Readonly<NativeObject>>;
}
export class ReferencePercentileService {
  private readonly inputs = new Map<string, SchoolScoreInputs>();
  private readonly evidence = new Map<string, NativeObject>();
  /** Private writer material only; never add this to a public response. */
  evidenceFor(offeringId: string): NativeObject | null {
    const value = this.evidence.get(offeringId);
    return value ? cloneNativeJson(value) : null;
  }
  constructor(private readonly source: ReferenceTailPort & UniversityScoringDataPort) {}
  async calculate(
    offering: Readonly<NativeObject>,
    conversion: ScoringResult,
    profile: Pick<StoredProfile, "profile_id" | "scores">,
    signal?: AbortSignal,
    attendance?: AttendanceConfirmation | null,
  ): Promise<NativeObject> {
    const pending = (reason: string): NativeObject => ({
      status: "pending",
      reason_code: reason,
      estimated_upper_cumulative_percent_all_examinees: null,
      calculation_review_scope: "same_exam_mathematical_reference",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    });
    if (typeof offering.offering_id === "string") this.evidence.delete(offering.offering_id);
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
      if (
        (!this.source.getReferenceTail && !this.source.getChunkedReferenceTail &&
          !this.source.getNativeReferenceTail) ||
        !this.source.getReference
      ) return pending("reference_tail_missing");
      if (typeof offering.offering_id !== "string") {
        return pending("reference_tail_context_mismatch");
      }
      let selected:
        | ReferenceTailSelection
        | ChunkedReferenceTailSelection
        | NativeReferenceTailSelection
        | null = this.source.getReferenceTail
          ? await this.source.getReferenceTail(offering.offering_id, signal)
          : null;
      if (selected === null && this.source.getChunkedReferenceTail) {
        selected = await this.source.getChunkedReferenceTail(offering.offering_id, signal);
      }
      if (selected === null && this.source.getNativeReferenceTail) {
        selected = await this.source.getNativeReferenceTail(offering.offering_id, signal);
      }
      if (selected === null) return pending("reference_tail_missing");
      if (
        !(selected.projection instanceof SavedReferenceTailProjection) &&
          !(selected.projection instanceof ChunkedReferenceTailProjection) &&
          !(selected.projection instanceof NativeReferenceCdfProjection) ||
        typeof selected.assertCurrent !== "function" ||
        typeof selected.assertCompatible !== "function" ||
        selected.binding.offering_id !== offering.offering_id ||
        !CONVERSION_CONTEXT_FIELDS.every((k) => selected.binding[k] === offering[k]) ||
        selected.binding.rule_version !== s.rule_version
      ) return pending("reference_tail_context_mismatch");
      await selected.assertCurrent(signal);
      const inputKey = nativeJsonText([profile.profile_id, profile.scores], true);
      // Reuse the exact reference calculation of this same conversion object when it was
      // made from these exact scores; otherwise recompute and cross-check as before.
      const prior = referenceCalculationOf(conversion);
      const reused = prior !== null && prior.scoresKey === inputKey &&
          nativeJsonText(prior.input.attendanceConfirmation ?? null, true) ===
            nativeJsonText(attendance ?? null, true)
        ? prior
        : null;
      let input = reused?.input ?? this.inputs.get(inputKey);
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
      const referenceInput = attendance ? { ...input, attendanceConfirmation: attendance } : input;
      const reference = reused?.reference ??
        await new SchoolReferenceScoringService({
          getReference: (id) => this.source.getReference!(id),
        }).calculate(offering, referenceInput);
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
      const identity = Object.freeze({
        academic_year: s.academic_year,
        exam_id: s.exam_id,
        exam_type: input.examType,
        source_pack_version: s.pack_version,
        rule_version: s.rule_version,
        score_scale_id: reference.scoreScaleId,
        offering_id: offering.offering_id,
      });
      await selected.assertCompatible(identity, signal);
      if (selected.projection instanceof NativeReferenceCdfProjection && !signal) {
        return pending("reference_tail_unavailable");
      }
      const result = selected.projection instanceof NativeReferenceCdfProjection
        ? await selected.projection.query(reference.exactScore, identity, signal!)
        : await selected.projection.query(reference.exactScore, identity);
      await selected.assertCurrent(signal);
      if (inputKey !== nativeJsonText([profile.profile_id, profile.scores], true)) {
        return pending("reference_conversion_context_mismatch");
      }
      if (signal?.aborted) return pending("reference_tail_unavailable");
      if (result === null) return pending("reference_score_outside_saved_support");
      const output: NativeObject = {
        status: result.status,
        metric: result.metric,
        estimated_upper_cumulative_percent_all_examinees:
          result.estimated_upper_cumulative_percent_all_examinees,
        // 상한(점수를 낼 수 없는 질량을 모두 위로 둔 값). 옛 결과에는 없다
        ...(typeof result.estimated_upper_cumulative_percent_upper_bound === "string"
          ? {
            estimated_upper_cumulative_percent_upper_bound:
              result.estimated_upper_cumulative_percent_upper_bound,
          }
          : {}),
        denominator_kind: result.denominator_kind,
        calculation_review_scope: result.calculation_review_scope,
        production_allowed: false,
        actual_admission_full_total_approved: false,
      };
      if (selected.verifiedProvenance) {
        const provenance = cloneNativeJson(
          await selected.verifiedProvenance(identity, signal) as NativeObject,
        );
        const hashes = [
          "release_sha256",
          "selection_sha256",
          "tail_sha256",
          "compatibility_sha256",
        ];
        const fields = [
          ...hashes,
          "academic_year",
          "exam_id",
          "source_pack_version",
          "rule_version",
          "score_scale_id",
          "offering_id",
        ];
        if (
          Object.keys(provenance).sort().join(",") !== fields.sort().join(",") ||
          hashes.some((k) =>
            typeof provenance[k] !== "string" || !/^[a-f0-9]{64}$/.test(provenance[k] as string)
          ) ||
          fields.filter((k) => !hashes.includes(k)).some((k) =>
            provenance[k] !== identity[k as keyof typeof identity]
          )
        ) {
          return pending("reference_tail_context_mismatch");
        }
        const valueSha256 = await nativeJsonSha256(output);
        await selected.assertCurrent(signal);
        if (signal?.aborted) return pending("reference_tail_unavailable");
        this.evidence.set(offering.offering_id, { value_sha256: valueSha256, provenance });
      }
      return output;
    } catch {
      return pending("reference_tail_unavailable");
    }
  }
}
