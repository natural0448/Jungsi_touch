import type { OwnReportListDto, ScoreInputStatusDto } from "./dto";

/*
  정정 입력 뒤에는 그 단계의 현재 리포트 하나만 보인다(2026-10-28 사용자 결정).
  정정 전 리포트는 목록·열기·인쇄에서 모두 빠진다. 서버에서 지우는 일은 담당자 몫(요청서 2026-10-28)이고,
  지워지기 전까지 화면이 막는다. 입력 상태를 읽지 못하면 아무것도 숨기지 않는다(현재 리포트를 추정하지 않는다).
  목록에는 아직 시험 단계가 없어, 지금은 열린 단계 하나만 있다는 전제다 — 실채점을 열기 전에 단계 표시를 받아야 한다.
*/
/**
 * '내 리포트' 목록에 보일 항목. 서버가 항목마다 is_current 를 주면 그것으로 단계마다 현재 리포트만 남긴다
 * (실채점 정정이 가채점 리포트를 숨기지 않는다). 주지 않으면(지금 운영) 입력 상태의 현재 리포트 하나로 거른다.
 * 서버가 is_current 를 null(모름)로 준 항목은 숨기지 않는다.
 */
export function visibleOwnItems(items: OwnReportListDto["items"], only: string | null): { items: OwnReportListDto["items"]; byServer: boolean } {
  const byServer = items.some((it) => typeof it.is_current === "boolean");
  if (byServer) return { items: items.filter((it) => it.is_current !== false), byServer };
  return { items: only ? items.filter((it) => it.report_id === only) : items, byServer };
}

export function onlyReportAfterCorrection(st: Pick<ScoreInputStatusDto, "correction_used" | "current_report_id"> | null): string | null {
  return st && st.correction_used > 0 && st.current_report_id ? st.current_report_id : null;
}
