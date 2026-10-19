import type { DataKind, PopulationScope, ScoreBasis } from "@/lib/dto";

/* 분석 값이 무엇을 기준으로 했는지 화면에 적는 말(DEV-006 display_rules). 서버 값을 바꾸지 않고 이름만 붙인다 */

export const DATA_KIND: Record<DataKind, { label: string; note: string }> = {
  observed_counts: { label: "관측 도수", note: "공식 발표된 인원 도수로 센 값입니다." },
  estimated_weights: {
    label: "자체 추정",
    note: "공식 과목별 도수와 응시 조건으로 성적 조합을 자체 추정한 분포로 계산했습니다. 전체 학생의 실제 점수를 모은 값이 아닙니다.",
  },
};

export const POPULATION: Record<PopulationScope, { label: string; note: string }> = {
  whole_complete: { label: "국·수·탐2 전체 응시자", note: "국어·수학·탐구 2과목을 모두 본 전체 응시자와 비교했습니다." },
  required_rule_inputs_present: {
    label: "이 대학 반영 성적 보유자",
    note: "이 대학 반영에 필요한 성적을 모두 가진 응시자만 비교했습니다. 전체 응시자와 분모가 달라 전체 위치와의 차이(유불리)는 보류합니다.",
  },
};

export const SCORE_BASIS: Record<ScoreBasis, string> = {
  actual_exam: "실제 수능 기준",
  mock_exam: "모의평가 기준",
  year_equated_estimate: "연도 보정 추정",
};

export const scoreBasisLabel = (b: string | null | undefined) => (b && b in SCORE_BASIS ? SCORE_BASIS[b as ScoreBasis] : b ?? "");

/**
 * 전체 위치(총점 누백)가 비어 있을 때의 짧은 표시. total_model_missing 은 그 시험의 총점 분포 자료가
 * 운영에 연결되지 않은 상태라(담당자 PR43 요청 2026-10-18) '계산 대기'처럼 계산이 진행 중이거나 기다리면
 * 자동으로 끝난다는 인상을 주지 않는다. 다른 보류 코드는 지금 표시를 그대로 둔다(일괄 합치지 않음)
 */
export const overallWaitLabel = (code: string | null | undefined) => (code === "total_model_missing" ? "자료 연결 대기" : "계산 대기");
