import type { AssessmentDto, OverallResultDto, ReferencePercentileDto } from "./dto";
import { cutoffMargin, type CutoffMargin } from "./reference-view";

/*
  판정 경계가 없는 모집단위의 종료 표시(대표님 결정 2026-11-20 저녁, 11-23 3페이지).
  - 지난해 합격선(70%컷, 없으면 50%컷)이 있으면: 7단계를 만들지 않고 "2025 70%컷보다 ○%p 위/비슷/아래"(참고)
  - 합격선 근거가 없으면: 내 위치 + "판정 근거 부족"
  '판단 보류'를 남기지 않는다(사유가 분명한 종료 표시는 허용). 이 표시는 추천·순위·와일드카드에 쓰지 않는다.
  정식 판정(ready)·참고 7단계 판정·지원 조건 미충족, 그리고 내 입력 때문에 계산하지 않은 경우에는 쓰지 않는다.
*/

/** 내 입력(시험·과목) 때문에 판단하지 않은 이유. 이때는 기존 이유 문장을 그대로 보인다 */
const INPUT_REASONS = new Set([
  "designated_subject_not_taken",
  "eligibility_not_met",
  "analysis_pack_mismatch",
  "reference_exam_context_mismatch",
  "reference_required_input_missing",
  "reference_inquiry_category_unsupported",
  "total_model_missing",
]);

export type PositionNote =
  | { kind: "line"; margin: CutoffMargin; basis: "school" | "overall" }
  | { kind: "none" };

export const POSITION_NONE_LABEL = "판정 근거 부족";
export const POSITION_NONE_DESC =
  "지난해 합격선을 내 위치와 같은 기준(전체 응시자 누적 백분위)으로 옮긴 자료가 없어 지원 판정을 만들지 않았습니다. 대학이 합격선을 발표하지 않았거나, 발표한 값(대학 자체 점수·백분위 평균 등)을 이 기준으로 옮길 수 없는 모집단위입니다. 위의 내 위치와 아래 연도별 근거의 대학 발표 입시결과를 함께 보고 판단하세요.";
export const POSITION_LINE_DESC =
  "이 모집단위는 지난해 합격선이 하나만 있어 7단계 판정을 만들지 않고, 그 합격선과 내 위치를 견준 결과만 보여 드립니다. 합격 가능성 판정이 아니며 추천 목록에는 쓰이지 않습니다.";

export const positionSideWord = { above: "위", near: "비슷", below: "아래" } as const;

/** 전체 성적(국·수·탐 표준점수 합) 위치를 참고 누백 모양으로. 연도별 근거(year-cutoffs.ts)와 같은 대체 규칙 */
function overallAsReference(o: OverallResultDto | null | undefined): ReferencePercentileDto | null {
  if (!o || (o.status !== "observed" && o.status !== "estimated")) return null;
  const lo = o.exclusive_top_percent ?? o.top_percent;
  const hi = o.inclusive_top_percent ?? o.top_percent;
  if (lo === null || lo === undefined) return null;
  return {
    status: "reference_estimated",
    estimated_upper_cumulative_percent_all_examinees: lo,
    ...(hi ? { estimated_upper_cumulative_percent_upper_bound: hi } : {}),
    metric: "overall",
    denominator_kind: "overall",
    calculation_review_scope: "overall",
    production_allowed: false,
    actual_admission_full_total_approved: false,
  };
}

/** 판정 경계가 없는 모집단위의 종료 표시. 쓰지 않는 경우 null */
export function positionNoteOf(a: AssessmentDto, overall?: OverallResultDto | null): PositionNote | null {
  if (a.status === "ready" || a.status === "ineligible") return null;
  if (a.reference_band) return null;
  if (a.reason_code && INPUT_REASONS.has(a.reason_code)) return null;
  const school = cutoffMargin(a.year_cutoffs, a.reference_percentile);
  if (school) return { kind: "line", margin: school, basis: "school" };
  // 이 대학 기준 내 위치가 없으면 전체 성적 위치로 견준다(연도별 근거와 같은 규칙, 참고)
  if (!a.reference_percentile) {
    const all = cutoffMargin(a.year_cutoffs, overallAsReference(overall));
    if (all) return { kind: "line", margin: all, basis: "overall" };
  }
  return { kind: "none" };
}

/** 목록 칸에 보일 짧은 글자. 예: "70%컷 대비 위" */
export function positionNoteShort(n: PositionNote): string {
  return n.kind === "none" ? POSITION_NONE_LABEL : `${n.margin.metric} 대비 ${positionSideWord[n.margin.side]}`;
}
