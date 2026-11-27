import type { ReportDto } from "./dto";

/**
 * 유리한 대학 찾기: 판단 보류 모집단위 중 '환산 완료·판정 대기'인 곳(담당자 인계 2026-11-15).
 * 서버 후보 계산이 지원 판단용 분석 자료가 없어(analysis_release_missing) 보류로 둔 모집단위 가운데
 * 대학 공식 반영식 환산(assessment.conversion)이 ready 이고 점수가 있는 곳만 고른다.
 * 상향·적정·안정이나 합격 확률을 만들지 않는다. 참고 환산(reference_calculated)이나 pending 은 넣지 않는다.
 */
export function convertedPending(report: Pick<ReportDto, "candidates" | "analyses">): { offeringId: string; score: string }[] {
  const out: { offeringId: string; score: string }[] = [];
  for (const p of report.candidates?.pending_offerings ?? []) {
    if (p.reason_code !== "analysis_release_missing") continue;
    const conv = report.analyses?.[p.offering_id]?.conversion;
    const score = conv?.converted_score;
    if (conv?.status !== "ready" || typeof score !== "string" || score.trim() === "") continue;
    out.push({ offeringId: p.offering_id, score });
  }
  return out;
}
