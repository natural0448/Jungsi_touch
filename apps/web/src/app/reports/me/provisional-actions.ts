"use server";

import type { ProvisionalScoresInput } from "@/lib/dto";
import { EXAM, RAW_MAX, SECOND_LANGUAGE_SUBJECTS } from "@/lib/exam";

/** 가채점 양식 값(실패하면 넣었던 값으로 다시 그린다) */
export interface ProvisionalValues {
  korean_choice?: string;
  korean?: number;
  math_choice?: string;
  math?: number;
  inq1?: string;
  inq1_raw?: number;
  inq2?: string;
  inq2_raw?: number;
  english?: number;
  history?: number;
  sl_subject?: string;
  sl_raw?: number;
}
export type ProvisionalFormState = { error: string; values: ProvisionalValues; attempt: number } | null;

const int = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? undefined : Number(v);
};
const inRange = (v: number | undefined, max: number) => v !== undefined && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * 수능 가채점 저장(2026-11-12 최종관리자 결정: 원점수 입력).
 * 가채점 분석 자료(예상 등급컷)와 서버 저장 계약은 수능 뒤에 연결한다. 그 전까지는 값을 검사만 하고
 * 서버로 보내지 않는다 — 입력 횟수도 쓰지 않는다. 연결되면 아래 scores 를 그대로 서버에 보낸다.
 */
export async function submitProvisional(prev: ProvisionalFormState, fd: FormData): Promise<ProvisionalFormState> {
  const values: ProvisionalValues = {
    korean_choice: String(fd.get("korean_choice") ?? "") || undefined,
    korean: int(fd, "korean"),
    math_choice: String(fd.get("math_choice") ?? "") || undefined,
    math: int(fd, "math"),
    inq1: String(fd.get("inq1") ?? "") || undefined,
    inq1_raw: int(fd, "inq1_raw"),
    inq2: String(fd.get("inq2") ?? "") || undefined,
    inq2_raw: int(fd, "inq2_raw"),
    english: int(fd, "english"),
    history: int(fd, "history"),
    sl_subject: String(fd.get("sl_subject") ?? "") || undefined,
    sl_raw: int(fd, "sl_raw"),
  };
  const fail = (error: string): ProvisionalFormState => ({ error, values, attempt: (prev?.attempt ?? 0) + 1 });
  if (!values.inq1 || !values.inq2) return fail("탐구 두 과목을 골라 주세요.");
  if (values.inq1 === values.inq2) return fail("탐구 두 과목은 서로 달라야 합니다.");
  if (![values.korean, values.math, values.english].every((v) => inRange(v, 100))) return fail("국어·수학·영어 원점수는 0~100 사이 정수입니다.");
  if (![values.history, values.inq1_raw, values.inq2_raw].every((v) => inRange(v, 50))) return fail("한국사·탐구 원점수는 0~50 사이 정수입니다.");
  if (values.sl_subject && (!(SECOND_LANGUAGE_SUBJECTS as readonly string[]).includes(values.sl_subject) || !inRange(values.sl_raw, RAW_MAX.second)))
    return fail("제2외국어/한문 원점수는 0~50 사이 정수입니다. 보지 않았으면 과목을 '미응시'로 두세요.");
  if (fd.get("confirm") !== "on") return fail("저장 전 확인 창에서 입력값을 확인하고 '이대로 저장'을 눌러 주세요.");

  const scores: ProvisionalScoresInput = {
    exam_id: EXAM.exam_id,
    pack_version: EXAM.pack_version,
    korean: { raw_score: values.korean!, ...(values.korean_choice ? { choice: values.korean_choice } : {}) },
    math: { raw_score: values.math!, ...(values.math_choice ? { choice: values.math_choice } : {}) },
    inquiry: [
      { subject: values.inq1, raw_score: values.inq1_raw! },
      { subject: values.inq2, raw_score: values.inq2_raw! },
    ],
    english_raw: values.english,
    korean_history_raw: values.history,
    second_language: values.sl_subject ? { subject: values.sl_subject, raw_score: values.sl_raw! } : null,
  };
  void scores;
  return fail("가채점 분석은 수능 뒤에 연결됩니다. 지금은 저장하지 않았고 입력 횟수도 쓰이지 않았습니다.");
}
