/**
 * 학교 반영 참고백분위를 report.read 응답의 각 분석·후보 항목에 덧붙인다(2026-11-14).
 *
 * 값은 저장하지 않고 읽을 때 계산한다. 필요한 자료(허가 목록·성적 프로필·시험 자료집)가
 * 하나라도 없거나 실패하면 아무 필드도 붙이지 않고 기존 응답을 그대로 돌려준다.
 */
import { schoolScoreInputs } from "./school_score_inputs.ts";
import {
  type ReflectedReferenceResult,
  type ReflectedReferenceRule,
  type ReflectedStudentScores,
  type ReflectedSubjectScore,
  schoolReflectedReference,
} from "./school_reflected_reference.ts";
import type { NativeExamPack } from "../domain/exam_pack.ts";
import type { NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";

/** 대표님이 허가한 모집단위(2027 모집행 PK)별 반영 규칙 */
export interface SchoolReflectedRulesPort {
  rules(): Promise<ReadonlyMap<string, ReflectedReferenceRule> | null>;
}

/**
 * 모집단위(2027 모집행 PK)별 지원 자격 조건(대표님 결정 2026-11-15).
 * 요강 정본에서 데이터팀이 불확실로 표시하지 않은 필드만 담는다. 없는 필드는 null이다.
 */
export interface EligibilityConditions {
  readonly requiredAreas: readonly string[] | null;
  readonly mathChoices: readonly string[] | null;
  readonly mathNote: string | null;
  readonly inquiryDomains: readonly string[] | null;
  readonly inquiryNote: string | null;
}
export interface EligibilityConditionsPort {
  conditions(): Promise<ReadonlyMap<string, EligibilityConditions> | null>;
}

/**
 * 2027 모집단위의 지난 학년도 합격선 누적 백분위(R9 명부, 대표님 결정 2026-11-15).
 * 1페이지 정리본의 합격선 관측값을 담당자 명부로 고른 것만 담는다. 값은 정확한 소수 문자열이다.
 */
export interface YearCutoff {
  readonly academicYear: number;
  readonly observationId: string;
  readonly publishedMetric: string;
  readonly cutoffTopPercent: string;
}
export interface YearCutoffsPort {
  cutoffs(): Promise<ReadonlyMap<string, readonly YearCutoff[]> | null>;
}

const YEAR = 2027, PREFIX = YEAR + ":", MAX_DEPTH = 8;

function object(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof JsonFloat) {
    const n = Number(v.lexeme);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function subject(values: NativeObject, area: string): ReflectedSubjectScore {
  return {
    percentile: num(values[area + "_percentile"]),
    standard: num(values[area + "_standard_score"]),
  };
}
/** 공개 응답 형식(public_response_schemas.json의 school_reflected) */
export function schoolReflectedDto(result: ReflectedReferenceResult): NativeObject {
  return result.status === "reference"
    ? {
      status: "reference",
      value: Math.round(result.value * 10000) / 10000,
      reason_code: null,
      eligibility_note: result.eligibilityNote,
      excluded: [...result.excluded],
    }
    : {
      status: "pending",
      value: null,
      reason_code: result.reason,
      eligibility_note: false,
      excluded: ["english", "korean_history", "bonus"],
    };
}

/** 학생 성적 프로필에서 같은 시험 과목별 백분위·표준점수를 뽑는다. 2027 시험이 아니면 null */
export function reflectedStudentScores(
  pack: NativeExamPack,
  scores: NativeObject,
  profileVersion: string,
): ReflectedStudentScores | null {
  const analyzed = pack.analyze(scores);
  if (analyzed.exam.academic_year !== YEAR) return null;
  const values = schoolScoreInputs(pack, analyzed, scores, profileVersion).values as NativeObject;
  return {
    korean: subject(values, "korean"),
    math: subject(values, "math"),
    inquiry: [subject(values, "inquiry1"), subject(values, "inquiry2")],
  };
}

function attach(
  assessment: unknown,
  rules: ReadonlyMap<string, ReflectedReferenceRule>,
  student: ReflectedStudentScores,
): void {
  if (!object(assessment) || typeof assessment.offering_id !== "string") return;
  const id = assessment.offering_id;
  if (!id.startsWith(PREFIX)) return;
  const rule = rules.get(id.slice(PREFIX.length));
  if (!rule) return;
  assessment.school_reflected = schoolReflectedDto(
    schoolReflectedReference({ ...rule, offeringId: id }, student),
  );
}
function walkCandidates(
  node: unknown,
  rules: ReadonlyMap<string, ReflectedReferenceRule>,
  student: ReflectedStudentScores,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) walkCandidates(item, rules, student, depth + 1);
    return;
  }
  if (!object(node)) return;
  if (object(node.offering) && object(node.assessment)) {
    attach(node.assessment, rules, student);
    return;
  }
  for (const value of Object.values(node)) walkCandidates(value, rules, student, depth + 1);
}

/** 공개 응답 형식(public_response_schemas.json의 eligibility_conditions) */
export function eligibilityConditionsDto(c: EligibilityConditions): NativeObject {
  return {
    required_areas: c.requiredAreas === null ? null : [...c.requiredAreas],
    math_choices: c.mathChoices === null ? null : [...c.mathChoices],
    math_note: c.mathNote,
    inquiry_domains: c.inquiryDomains === null ? null : [...c.inquiryDomains],
    inquiry_note: c.inquiryNote,
  };
}
function attachConditions(
  assessment: unknown,
  conditions: ReadonlyMap<string, EligibilityConditions>,
): void {
  if (!object(assessment) || typeof assessment.offering_id !== "string") return;
  const id = assessment.offering_id;
  if (!id.startsWith(PREFIX)) return;
  const found = conditions.get(id.slice(PREFIX.length));
  if (found) assessment.eligibility_conditions = eligibilityConditionsDto(found);
}
/** 공개 응답 형식(public_response_schemas.json의 year_cutoff) */
export function yearCutoffDto(c: YearCutoff): NativeObject {
  return {
    academic_year: c.academicYear,
    published_metric: c.publishedMetric,
    cutoff_top_percent: c.cutoffTopPercent,
    observation_id: c.observationId,
  };
}
/** report.read 결과(유료 등급)의 분석 항목에 지난 학년도 합격선 누적 백분위를 붙인다. 판정은 바꾸지 않는다 */
export function attachYearCutoffs(
  result: NativeObject,
  cutoffs: ReadonlyMap<string, readonly YearCutoff[]>,
): void {
  if (!object(result.analyses)) return;
  for (const assessment of Object.values(result.analyses)) {
    if (!object(assessment) || typeof assessment.offering_id !== "string") continue;
    const id = assessment.offering_id;
    if (!id.startsWith(PREFIX)) continue;
    const found = cutoffs.get(id.slice(PREFIX.length));
    if (found && found.length) assessment.year_cutoffs = found.map(yearCutoffDto);
  }
}

/** report.read 결과(유료 등급)의 분석 항목에 지원 자격 조건을 붙인다. 판정(eligibility_status)은 바꾸지 않는다 */
export function attachEligibilityConditions(
  result: NativeObject,
  conditions: ReadonlyMap<string, EligibilityConditions>,
): void {
  if (!object(result.analyses)) return;
  for (const assessment of Object.values(result.analyses)) attachConditions(assessment, conditions);
}

/** report.read 결과(유료 등급)의 analyses·candidates 항목에 값을 붙인다. 원본 저장 결과는 바꾸지 않는다 */
export function attachSchoolReflected(
  result: NativeObject,
  rules: ReadonlyMap<string, ReflectedReferenceRule>,
  student: ReflectedStudentScores,
): void {
  if (object(result.analyses)) {
    for (const assessment of Object.values(result.analyses)) attach(assessment, rules, student);
  }
  if (result.candidates !== undefined) walkCandidates(result.candidates, rules, student, 0);
}
