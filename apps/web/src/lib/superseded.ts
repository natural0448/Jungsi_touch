import type { OwnReportListDto, ScoreInputStatusDto } from "./dto";

/*
  정정 입력 뒤에는 그 단계의 현재 리포트 하나만 보인다(2026-10-28 사용자 결정).
  정정 전 리포트는 목록·열기·인쇄에서 모두 빠진다. 서버에서 지우는 일은 담당자 몫(요청서 2026-10-28)이고,
  지워지기 전까지 화면이 막는다. 입력 상태를 읽지 못하면 아무것도 숨기지 않는다(현재 리포트를 추정하지 않는다).
  목록에는 아직 시험 단계가 없어, 지금은 열린 단계 하나만 있다는 전제다 — 실채점을 열기 전에 단계 표시를 받아야 한다.
*/
/**
 * '내 리포트' 목록에 보일 항목. 새 서버는 항목마다 stage·is_current 키를 늘 보낸다(값은 true·false·null).
 * 키가 있으면(새 서버) false 인 항목만 숨긴다. null 은 '모름'이라 숨기지 않는다 — 모든 값이 null 이어도 같다.
 * 키가 하나도 없으면(지금 운영 서버) 입력 상태의 현재 리포트 하나로 거른다. 빈 목록은 판단할 것이 없다.
 * (담당자 서비스 후보 v5 REPORT_LIST_NULL_CONTRACT, 2026-10-29)
 */
export function visibleOwnItems(items: OwnReportListDto["items"], only: string | null): { items: OwnReportListDto["items"]; byServer: boolean } {
  const byServer = items.some((it) => Object.hasOwn(it, "is_current"));
  if (byServer) return { items: items.filter((it) => it.is_current !== false), byServer };
  return { items: only ? items.filter((it) => it.report_id === only) : items, byServer };
}

export function onlyReportAfterCorrection(st: Pick<ScoreInputStatusDto, "correction_used" | "current_report_id"> | null): string | null {
  return st && st.correction_used > 0 && st.current_report_id ? st.current_report_id : null;
}

/** 이 단계의 정정 입력을 다 썼나(승인받은 정정을 모두 쓰고 더 요청할 수도 없음). 상태를 모르면 붙이지 않는다(2026-11-04 사용자 결정) */
export function correctionExhausted(st: Pick<ScoreInputStatusDto, "correction_used" | "correction_granted" | "correction_request_remaining"> | null): boolean {
  return !!st && st.correction_used > 0 && st.correction_used >= st.correction_granted && st.correction_request_remaining <= 0;
}
