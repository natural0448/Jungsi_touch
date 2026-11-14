import type { AssessmentDto, SchoolReflectedDto } from "./dto";

/**
 * 학교 반영 백분위(참고) — 학생의 국어·수학·탐구 백분위를 이 모집단위 반영비율로 평균한 참고값(2026-11-14 대표님 결정).
 * 영어·한국사·가산점은 빼고 계산한다. 대학 환산점수·상위누백·합격 가능성이 아니다.
 */
export const SCHOOL_REFLECTED_TITLE = "학교 반영 백분위(참고)";
export const SCHOOL_REFLECTED_NOTE =
  "국어·수학·탐구 백분위를 이 모집단위 반영비율로 평균한 참고값입니다. 영어·한국사·가산점은 빼고 계산했으며, 대학 환산점수나 합격 가능성이 아닙니다.";
export const SCHOOL_REFLECTED_ELIGIBILITY = "지원 자격(필수 응시 영역·과목 지정)은 모집요강에서 확인하세요.";

const PENDING: Record<string, string> = {
  korean_missing: "국어 백분위가 없어 계산하지 않았습니다.",
  math_missing: "수학 백분위가 없어 계산하지 않았습니다.",
  inquiry_missing: "탐구 백분위가 없어 계산하지 않았습니다.",
  inquiry_two_subjects_required: "탐구 2과목 성적이 있어야 계산합니다.",
};

/** 소수 둘째 자리(셋째 자리에서 반올림). 숫자가 아니거나 0~100 밖이면 null */
export function reflectedPercentText(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return null;
  const hundredths = Math.round(v * 100 + 1e-9);
  return (hundredths / 100).toFixed(2);
}

export type SchoolReflectedView =
  | { kind: "value"; text: string; eligibility: boolean }
  | { kind: "pending"; reason: string };

/** 화면에 보일 상태. 칸이 없거나 알 수 없는 대기 사유면 null(아무것도 보이지 않음) */
export function schoolReflectedView(s: SchoolReflectedDto | null | undefined): SchoolReflectedView | null {
  if (!s) return null;
  if (s.status === "reference") {
    const text = reflectedPercentText(s.value);
    return text ? { kind: "value", text, eligibility: s.eligibility_note === true } : null;
  }
  if (s.status === "pending" && s.reason_code && PENDING[s.reason_code]) {
    return { kind: "pending", reason: PENDING[s.reason_code] };
  }
  return null;
}

export function schoolReflectedOf(a: AssessmentDto | null | undefined): SchoolReflectedView | null {
  return schoolReflectedView(a?.school_reflected);
}
