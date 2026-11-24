/*
  2026-11-24 담당자 「개인용 2페이지 가채점 단일 대표값」 web/p2_representative_view.ts 원본 그대로(sha256 9a691e2b…).
  개인용 가채점 내 성적·내 리포트·인쇄에서만 쓴다(전문가용·실채점·9모는 쓰지 않는다).
*/
/** Personal Page 2, provisional CSAT preview, saved report, and print. */
export type RepresentativePayload = Readonly<{
  estimated_standard_score_sum: number | null;
  estimated_top_percent: string | null;
  unavailable_reason: "missing_central_score" | "rank_curve_unavailable" | "outside_central_support" | null;
}>;

type Subject = Readonly<{
  standard_score_range?: Readonly<{ central?: number | string | null }> | null;
  percentile_at_central?: number | string | null;
  representative_grade?: number | string | null;
  grade_range?: Readonly<{ low?: number | null; high?: number | null }> | null;
}>;

const unavailable = {
  missing_central_score: "국어·수학·탐구 두 과목의 대표 표준점수가 필요합니다.",
  rank_curve_unavailable: "이 성적에 적용할 가채점 모형을 확인하지 못했습니다.",
  outside_central_support: "예상 총점이 가채점 모형의 계산 범위를 벗어났습니다.",
};

export function projectP2ProvisionalSummary(
  value: RepresentativePayload | null | undefined,
) {
  const score = value?.estimated_standard_score_sum;
  const percent = value?.estimated_top_percent;

  const scorePoint = typeof score === "number" && Number.isSafeInteger(score) && score >= 0
    ? score
    : null;
  const rankPoint = typeof percent === "string" &&
      /^(?:(?:0|[1-9][0-9]?)\.[0-9]{2}|100\.00)$/u.test(percent)
    ? Number(percent)
    : null;
  const rankText = rankPoint !== null ? "상위 " + percent + "%" :
    percent === "<0.01" ? "상위 0.01% 미만" : "—";

  return {
    scoreLabel: "국어·수학·탐구 2과목 예상 표준점수 합",
    scoreText: scorePoint !== null ? String(scorePoint) + "점" : "—",
    scorePoint,
    rankLabel: "가채점 모형 기준 추정 상위누백",
    rankText,
    rankPoint,
    rankDetail: rankText === "—"
      ? unavailable[value?.unavailable_reason ?? "rank_curve_unavailable"]
      : "총점을 계산할 수 있는 가채점 모형 표본에서, 같은 점수도 포함해 위에서 몇 %인지 추정한 값입니다.",
  } as const;
}

export function projectP2ProvisionalSubject(subject: Subject) {
  const grade = subject.representative_grade ??
    (subject.grade_range?.low === subject.grade_range?.high ? subject.grade_range?.low : null);

  return {
    standardScore: subject.standard_score_range?.central ?? "—",
    percentile: subject.percentile_at_central ?? "—",
    grade: grade ?? "—",
  } as const;
}

/** Pass the representative standard scores from the slots of the existing combination. */
export function projectP2ProvisionalCombination(scores: readonly (number | null)[]): string {
  let sum = 0;
  if (scores.length === 0) return "—";
  for (const score of scores) {
    if (score === null || !Number.isSafeInteger(score) || score < 0) return "—";
    sum += score;
  }
  return Number.isSafeInteger(sum) ? String(sum) + "점" : "—";
}
