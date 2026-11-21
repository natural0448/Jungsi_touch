import type { OverallAnalysisDto, ProvisionalScoresInput, ProvisionalTopRangeDto, ProvisionalTripleDto, ReportDto } from "./dto";
import { isProvisionalOverall } from "./dto";
import { INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES } from "./exam";
import { checkSecondLanguage } from "./second-language";

/*
  수능 가채점(2026-11-23 전환) 입력·표시 규칙. 화면 부품과 서버 액션이 같이 쓰고, 시험(tests/provisional-report.test.mjs)이 그대로 실행한다.
  - 입력: 서버 validateRawScoreStructure 와 같은 모양. 국어·수학 선택과목은 변환표를 고르는 데 필요해 필수다.
  - 표시: 서버가 준 범위를 그대로 적는다. 화면이 다시 계산하지 않는다(전체 범위는 0.01% 단위 문자열).
*/

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
  /** 제2외국어/한문 과목. 'none'(SL_NONE)은 미응시를 직접 고른 것, 비어 있으면 아직 고르지 않은 것 */
  sl_subject?: string;
  sl_raw?: number;
}

const INQ = new Set(INQUIRY_SUBJECTS.flatMap((g) => g.subjects));
const inRange = (v: number | undefined, max: number) => v !== undefined && Number.isInteger(v) && v >= 0 && v <= max;

/** 양식 값 → 서버로 보낼 원점수. 고칠 곳이 있으면 고객에게 보일 문장을 돌려준다 */
export function buildProvisionalScores(
  values: ProvisionalValues,
  exam: { exam_id: string; pack_version: string },
): { ok: true; scores: ProvisionalScoresInput } | { ok: false; error: string; field?: "sl_subject" | "sl_value" } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!values.korean_choice || !(KOREAN_CHOICES as readonly string[]).includes(values.korean_choice) || !values.math_choice || !(MATH_CHOICES as readonly string[]).includes(values.math_choice))
    return fail("국어·수학 선택과목을 골라 주세요. 선택과목마다 예상 점수가 다릅니다.");
  if (!values.inq1 || !values.inq2 || !INQ.has(values.inq1) || !INQ.has(values.inq2)) return fail("탐구 두 과목을 골라 주세요.");
  if (values.inq1 === values.inq2) return fail("탐구 두 과목은 서로 달라야 합니다.");
  if (![values.korean, values.math, values.english].every((v) => inRange(v, 100))) return fail("국어·수학·영어 원점수는 0~100 사이 정수입니다.");
  if (![values.history, values.inq1_raw, values.inq2_raw].every((v) => inRange(v, 50))) return fail("한국사·탐구 원점수는 0~50 사이 정수입니다.");
  // 제2외국어/한문은 반드시 고른다(2026-11-22 대표님 결정). 빈 값은 미응시가 아니라 '고르지 않음'이다
  const sl = checkSecondLanguage(values.sl_subject, values.sl_raw, "raw");
  if (!sl.ok) return { ok: false as const, error: sl.error, field: sl.field };
  return {
    ok: true,
    scores: {
      exam_id: exam.exam_id,
      pack_version: exam.pack_version,
      korean: { raw_score: values.korean!, choice: values.korean_choice },
      math: { raw_score: values.math!, choice: values.math_choice },
      inquiry: [
        { subject: values.inq1, raw_score: values.inq1_raw! },
        { subject: values.inq2, raw_score: values.inq2_raw! },
      ],
      english_raw: values.english!,
      korean_history_raw: values.history!,
      // 미응시를 직접 고른 경우만 null(서버의 미응시 표기)
      second_language: sl.taken ? { subject: sl.taken.subject, raw_score: sl.taken.value } : null,
    },
  };
}

/** 이 리포트가 수능 가채점 원점수로 만든 리포트인가 */
export const isProvisionalReport = (r: ReportDto | null | undefined): boolean => !!r && isProvisionalOverall(r.overall);

/** 정수 범위 'a~b'. 끝이 같으면 한 숫자. 없으면 null */
export function spanText(r: { low: number; high: number } | null | undefined): string | null {
  if (!r || !Number.isFinite(r.low) || !Number.isFinite(r.high)) return null;
  return r.low === r.high ? String(r.low) : `${r.low}~${r.high}`;
}

/** 표준점수 추정 범위 'a~b'(낮음~높음). 가운데 값은 따로 적는다 */
export const tripleText = (t: ProvisionalTripleDto | null | undefined) => spanText(t ? { low: t.low, high: t.high } : null);

/** 서버의 0.01% 문자열을 그대로 두 자리로. 숫자가 아니면 null */
function cent(v: string | null | undefined): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/** 전체 상위 누백 범위 'best~worst'(좋은 쪽이 앞). 끝이 같으면 한 숫자. 읽을 수 없으면 null */
export function topRangeText(r: ProvisionalTopRangeDto | null | undefined): string | null {
  if (!r) return null;
  const a = cent(r.best), b = cent(r.worst);
  if (a === null || b === null) return null;
  return a === b ? a : `${a}~${b}`;
}

/** 전체 위치를 내지 않은 사유 → 고객 문장(계산이 진행 중이라는 인상을 주지 않는다) */
export const PROVISIONAL_REASON: Record<string, string> = {
  provisional_conversion_unavailable:
    "입력한 원점수 가운데 가채점 변환표에 표준점수 추정이 없는 점수가 있어, 그 과목의 표준점수 범위와 전체 위치는 계산하지 않았습니다. 다른 과목의 결과는 그대로 보입니다.",
  provisional_total_outside_axis:
    "예상 표준점수 합이 가채점 전체 분포표의 범위 밖이라 전체 위치는 계산하지 않았습니다. 과목별 예상 점수는 그대로 보입니다.",
  provisional_stage_unavailable: "가채점 성적은 표준점수가 확정되기 전이라 학교별 환산과 지원가능성 판정을 하지 않습니다.",
};
export const provisionalReason = (code: string | null | undefined) =>
  (code && PROVISIONAL_REASON[code]) ?? "가채점 기준으로는 전체 위치를 계산하지 않았습니다. 과목별 예상 점수는 그대로 보입니다.";

/** 가채점 전체 위치 한 줄 요약(3·4페이지 기준 줄). 범위가 없으면 null */
export function provisionalTopText(a: OverallAnalysisDto): string | null {
  const o = a.overall;
  return o.status === "estimated_range" ? topRangeText(o.top_percent_range) : null;
}

/** 정정 입력 양식을 지난 가채점 리포트의 원점수로 채운다 */
export function provisionalDefaults(r: ReportDto): ProvisionalValues {
  const by = Object.fromEntries(r.overall.subjects.map((s) => [s.area, s]));
  const raw = (v: number | undefined) => (typeof v === "number" ? v : undefined);
  return {
    korean_choice: by.korean?.choice ?? undefined,
    korean: raw(by.korean?.raw_score),
    math_choice: by.math?.choice ?? undefined,
    math: raw(by.math?.raw_score),
    inq1: by.inquiry1?.subject,
    inq1_raw: raw(by.inquiry1?.raw_score),
    inq2: by.inquiry2?.subject,
    inq2_raw: raw(by.inquiry2?.raw_score),
  };
}
