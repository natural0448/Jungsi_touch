/** Same-exam student fields shared by production and scoped reference calculators. */
import { examSubjectKey, type NativeExamAnalysis, NativeExamPack } from "../domain/exam_pack.ts";
import { type NativeObject } from "../domain/json_value.ts";
import type { NativeJson } from "../domain/native_json.ts";
import { requireContract as check } from "../domain/exact.ts";
export interface SchoolScoreInputs {
  readonly academicYear: number;
  readonly examId: string;
  readonly packVersion: string;
  readonly examType: string;
  readonly profileVersion: string;
  readonly scoreBasis: "actual_exam" | "mock_exam";
  readonly values: Readonly<NativeObject>;
  readonly reportedSources: Readonly<NativeObject>;
  readonly inquiryCategories: readonly string[];
}
function object(raw: unknown): NativeObject {
  check(raw !== null && typeof raw === "object" && !Array.isArray(raw), "invalid_score_input");
  return raw as NativeObject;
}
export function schoolScoreInputs(
  pack: NativeExamPack,
  analyzed: NativeExamAnalysis,
  scores: Readonly<NativeObject>,
  profileVersion: string,
): SchoolScoreInputs {
  const values: NativeObject = {}, sources: NativeObject = {};
  const entered = [
    object(scores.korean),
    object(scores.math),
    ...(scores.inquiry as NativeJson[]).map(object),
  ];
  const areas = ["korean", "math", "inquiry1", "inquiry2"];
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i], row = entered[i], subject = analyzed.subjects[i];
    const mapped = pack.reportedScore(subject.subject, row.standard_score);
    values[area + "_standard_score"] = row.standard_score;
    for (const field of ["percentile", "grade"]) {
      values[area + "_" + field] =
        (Object.hasOwn(mapped, field) ? mapped[field] : row[field] ?? null) as NativeJson;
      if (values[area + "_" + field] !== null) {
        sources[area + "_" + field] = Object.hasOwn(mapped, field)
          ? "verified_exam_mapping"
          : "student_report";
      }
    }
  }
  values.korean_choice = entered[0].choice == null ? null : examSubjectKey(entered[0].choice);
  values.math_choice = entered[1].choice == null ? null : examSubjectKey(entered[1].choice);
  values.inquiry1_subject = examSubjectKey(analyzed.subjects[2].subject);
  values.inquiry2_subject = examSubjectKey(analyzed.subjects[3].subject);
  values.english_grade = scores.english_grade ?? null;
  values.korean_history_grade = scores.korean_history_grade ?? null;
  return {
    academicYear: analyzed.exam.academic_year as number,
    examId: pack.examId,
    packVersion: pack.packVersion,
    examType: analyzed.exam.exam_type as string,
    profileVersion,
    scoreBasis: analyzed.exam.exam_type === "csat" ? "actual_exam" : "mock_exam",
    values,
    reportedSources: sources,
    inquiryCategories: analyzed.subjects.slice(2).map((s) => pack.inquiryCategory(s.subject)),
  };
}
