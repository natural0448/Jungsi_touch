/** Server-owned pack/model ports; valid subject results survive total-model holds. */
import { AccessError } from "./access.ts";
import type { SessionSnapshot } from "./session_service.ts";
import {
  type ExamRow,
  type NativeExamAnalysis,
  NativeExamPack,
  OVERALL_POPULATION_ID,
} from "../domain/exam_pack.ts";
import { NativeExamTotalModel } from "../domain/total_model.ts";
import {
  ALL_EXAMINEES_POPULATION_ID,
  NativeAllExamineesTotalModel,
} from "../domain/all_examinees_total_model.ts";
import { ContractError } from "../domain/exact.ts";
import { JsonFloat } from "../domain/native_json.ts";

export interface TotalModelBinding {
  readonly model: NativeExamTotalModel | NativeAllExamineesTotalModel;
  readonly distributionId: string;
}
export interface OverallDataPort {
  getExamPack(examId: string): Promise<NativeExamPack | null>;
  getTotalModel(examId: string, packVersion: string): Promise<TotalModelBinding | null>;
}
function record(value: unknown): value is ExamRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof JsonFloat);
}
function invalid(code = "invalid_request"): never {
  throw new AccessError(code, 422);
}
function clone(value: unknown): unknown {
  if (value instanceof JsonFloat) return new JsonFloat(value.lexeme);
  if (Array.isArray(value)) return value.map(clone);
  if (record(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function validateScoreStructure(value: unknown): ExamRow {
  const required = ["exam_id", "pack_version", "korean", "math", "inquiry"],
    allowed = [...required, "english_grade", "korean_history_grade"];
  if (
    !record(value) || required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => !allowed.includes(k)) || typeof value.exam_id !== "string" ||
    !IDENTIFIER.test(value.exam_id) || typeof value.pack_version !== "string" ||
    !IDENTIFIER.test(value.pack_version)
  ) invalid();
  for (const area of ["korean", "math"]) {
    const item = value[area];
    if (
      !record(item) || !Object.hasOwn(item, "standard_score") ||
      Object.keys(item).some((k) =>
        !["standard_score", "choice", "percentile", "grade"].includes(k)
      )
    ) invalid();
  }
  if (
    !Array.isArray(value.inquiry) || value.inquiry.length !== 2 ||
    value.inquiry.some((x) =>
      !record(x) || !Object.hasOwn(x, "subject") || !Object.hasOwn(x, "standard_score") ||
      Object.keys(x).some((k) => !["subject", "standard_score", "percentile", "grade"].includes(k))
    )
  ) invalid();
  const integer = (v: unknown) =>
    typeof v === "bigint" ||
    typeof v === "number" && Number.isSafeInteger(v);
  for (const item of [value.korean, value.math, ...value.inquiry] as ExamRow[]) {
    if (!integer(item.standard_score)) invalid("invalid_integer");
    for (const field of ["percentile", "grade"]) {
      if (Object.hasOwn(item, field) && !integer(item[field])) invalid("invalid_reported_" + field);
    }
  }
  for (const field of ["english_grade", "korean_history_grade"]) {
    if (Object.hasOwn(value, field) && value[field] !== null && !integer(value[field])) invalid();
  }
  return clone(value) as ExamRow;
}
export function validateScoreInput(value: unknown): ExamRow {
  const result = validateScoreStructure(value);
  for (const item of [result.korean, result.math, ...result.inquiry as ExamRow[]] as ExamRow[]) {
    for (const [field, lo, hi] of [["percentile", 0, 100], ["grade", 1, 9]] as const) {
      if (
        Object.hasOwn(item, field) &&
        ((item[field] as number | bigint) < lo || (item[field] as number | bigint) > hi)
      ) {
        invalid("invalid_reported_" + field);
      }
    }
  }
  return result;
}

function pending(reason: string, population = OVERALL_POPULATION_ID): ExamRow {
  return {
    status: "pending",
    reason_code: reason,
    top_percent: null,
    inclusive_top_percent: null,
    exclusive_top_percent: null,
    tie_share_percent: null,
    tie_interval_percent: null,
    tie_policy: "include_equal",
    population_id: population,
    model_version: null,
    data_kind: null,
  };
}
export class OverallAnalysisService {
  constructor(private readonly data: OverallDataPort) {}
  async analyze(actor: SessionSnapshot, input: unknown): Promise<ExamRow> {
    if (
      !actor?.user || typeof actor.user.subjectId !== "string" || !actor.user.subjectId.trim() ||
      typeof actor.evaluatedAtUtc !== "bigint" || typeof actor.user.expiresAtUtc !== "bigint" ||
      actor.user.expiresAtUtc <= actor.evaluatedAtUtc || !["standard", "paid"].includes(actor.tier)
    ) throw new AccessError("authentication_required", 401);
    const payload = validateScoreInput(input);
    let pack;
    try {
      pack = await this.data.getExamPack(payload.exam_id as string);
    } catch {
      throw new AccessError("exam_data_unavailable", 503);
    }
    if (pack === null) throw new AccessError("exam_not_available", 503);
    if (!(pack instanceof NativeExamPack) || pack.examId !== payload.exam_id) {
      throw new AccessError("exam_binding_invalid", 503);
    }
    if (pack.packVersion !== payload.pack_version) {
      throw new AccessError("pack_version_mismatch", 409);
    }
    let analysis: NativeExamAnalysis;
    try {
      analysis = pack.analyze(payload);
    } catch (e) {
      if (e instanceof ContractError) throw new AccessError(e.code, 422);
      throw new AccessError("invalid_scores", 422);
    }
    const overall = await this.total(pack, analysis);
    const areas = ["korean", "math", "inquiry1", "inquiry2"];
    const subjects = analysis.subjects.map((s, index) => {
      const result: ExamRow = {};
      for (
        const k of [
          "subject",
          "standard_score",
          "grade",
          "top_percent_exclusive",
          "top_percent_inclusive",
          "basis",
        ]
      ) result[k] = s[k];
      result.area = areas[index];
      result.choice = index < 2 ? (payload[areas[index]] as ExamRow).choice ?? null : null;
      return result;
    });
    return {
      format: "jungsi.overall-analysis/v1",
      exam: Object.fromEntries(
        ["exam_id", "academic_year", "exam_type"].map((k) => [k, analysis.exam[k]]),
      ),
      pack_version: analysis.packVersion,
      score_basis: analysis.scoreBasis,
      total_standard_score: analysis.totalStandardScore,
      subjects,
      absolute_grades: analysis.absoluteGrades,
      overall,
    };
  }
  private async total(pack: NativeExamPack, analysis: NativeExamAnalysis): Promise<ExamRow> {
    let binding;
    try {
      binding = await this.data.getTotalModel(pack.examId, pack.packVersion);
    } catch (e) {
      if (e instanceof AccessError) {
        const reasons: Record<string, string> = {
          artifact_not_approved: "total_model_not_approved",
          drive_hash_mismatch: "model_provider_hash_mismatch",
          drive_version_mismatch: "model_provider_version_mismatch",
          artifact_version_mismatch: "model_provider_version_mismatch",
        };
        return pending(reasons[e.code] ?? "total_model_unavailable");
      }
      return pending(e instanceof TypeError ? "total_model_invalid" : "total_model_unavailable");
    }
    if (binding === null) return pending("total_model_missing");
    if (
      !binding ||
      !(binding.model instanceof NativeExamTotalModel ||
        binding.model instanceof NativeAllExamineesTotalModel)
    ) {
      return pending("total_model_invalid");
    }
    const population = binding.model instanceof NativeAllExamineesTotalModel
      ? ALL_EXAMINEES_POPULATION_ID
      : OVERALL_POPULATION_ID;
    if (
      typeof binding.distributionId !== "string" || !IDENTIFIER.test(binding.distributionId) ||
      binding.distributionId !== binding.model.distributionId
    ) return pending("model_version_mismatch", population);
    if (binding.model.metadata.status !== "approved") {
      return pending("total_model_not_approved", population);
    }
    try {
      return binding.model.calculate(pack, analysis);
    } catch (e) {
      const allowed = [
        "model_exam_mismatch",
        "model_pack_mismatch",
        "model_population_mismatch",
        "academic_year_mismatch",
        "score_outside_domain",
        "model_not_ready",
      ];
      return pending(
        e instanceof ContractError && allowed.includes(e.code) ? e.code : "total_model_invalid",
        population,
      );
    }
  }
}
