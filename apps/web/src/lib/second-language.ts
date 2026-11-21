import { RAW_MAX, SECOND_LANGUAGE_SUBJECTS } from "./exam";

/*
  제2외국어/한문 필수 선택(2026-11-22 대표님 결정). 서울대 유형Ⅰ 등 28곳의 가채점 판정이 응시 여부로 달라진다.
  - 빈 값('')은 '아직 고르지 않음'이다. 미응시로 보지 않는다. 응시하지 않았으면 '미응시'(SL_NONE)를 직접 골라야 한다.
  - 과목을 골랐으면 그 단계가 받는 점수(가채점은 원점수, 9월·실채점은 등급)가 있어야 한다.
  - 화면(확인 창)과 서버 액션이 같은 함수를 써서, 화면 검사를 건너뛴 요청도 서버(jungsi-api)로 보내기 전에 막는다(입력 횟수를 쓰지 않는다).
  - 서버로는 미응시를 second_language: null 로 보낸다(서버 validateRawScoreStructure·validateScoreStructure 의 미응시 표기).
*/

/** '미응시' 선택값. 양식 select 의 value 로 쓴다 */
export const SL_NONE = "none";

export const SL_MESSAGE = {
  choose: "제2외국어/한문을 응시하지 않았으면 '미응시'를 골라 주세요.",
  subject: "제2외국어/한문 과목을 목록에서 골라 주세요.",
  raw: "선택한 과목의 원점수를 입력해 주세요.",
  rawRange: "제2외국어/한문 원점수는 0~50 사이 정수입니다.",
  grade: "선택한 과목의 등급을 입력해 주세요.",
} as const;

/** 칸 옆에 붙는 짧은 안내(표 칸이 좁아 한 줄 안팎) */
export const SL_HINT = {
  sl_subject: "안 봤으면 '미응시' 선택",
  sl_value_raw: "원점수를 넣어 주세요",
  sl_value_grade: "등급을 골라 주세요",
} as const;
export const slHint = (field: string | null | undefined, kind: "raw" | "grade"): string | null =>
  field === "sl_subject" ? SL_HINT.sl_subject : field === "sl_value" ? (kind === "raw" ? SL_HINT.sl_value_raw : SL_HINT.sl_value_grade) : null;

export type SecondLanguageResult =
  | { ok: true; taken: { subject: string; value: number } | null }
  | { ok: false; error: string; field: "sl_subject" | "sl_value" };

/**
 * 고른 값 → 응시 여부. kind 는 그 단계가 받는 점수(raw: 원점수 0~50, grade: 등급 1~9).
 * taken 이 null 이면 '미응시'를 직접 고른 경우다.
 */
export function checkSecondLanguage(subject: string | null | undefined, value: number | null | undefined, kind: "raw" | "grade"): SecondLanguageResult {
  const s = String(subject ?? "").trim();
  if (s === "") return { ok: false, error: SL_MESSAGE.choose, field: "sl_subject" };
  if (s === SL_NONE) return { ok: true, taken: null };
  if (!(SECOND_LANGUAGE_SUBJECTS as readonly string[]).includes(s)) return { ok: false, error: SL_MESSAGE.subject, field: "sl_subject" };
  const missing = value === null || value === undefined || Number.isNaN(value);
  if (kind === "raw") {
    if (missing) return { ok: false, error: SL_MESSAGE.raw, field: "sl_value" };
    if (!Number.isInteger(value) || value < 0 || value > RAW_MAX.second) return { ok: false, error: SL_MESSAGE.rawRange, field: "sl_value" };
  } else if (missing || !Number.isInteger(value) || value < 1 || value > 9) return { ok: false, error: SL_MESSAGE.grade, field: "sl_value" };
  return { ok: true, taken: { subject: s, value: value as number } };
}
