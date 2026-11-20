import type { ConnectionError } from "@/lib/api";
import { seoulTime } from "./format";

export const OFFERING_NOT_LINKED_NOTICE = "선택한 모집단위가 분석 자료에 연결되지 않아 계산하지 못했습니다. 저장한 성적과 리포트는 유지됩니다. 자료 연결이 완료된 뒤 다시 확인해 주세요.";

/** 쓰기 요청이 503 으로 끝났을 때 보인다. 서버가 저장을 마친 뒤 응답만 실패했을 수 있어 실패라고 단정하지 않는다 */
export const MAYBE_SAVED = "서버 응답을 끝까지 받지 못해 화면을 다시 불러왔습니다. 지금 화면에 보이는 상태가 실제 저장 상태이니, 반영됐다면 다시 누르지 않으셔도 됩니다.";

export const SCORE_INPUT_TRANSITION_NOTICE = "성적 입력 방식을 바꾸는 작업을 하고 있습니다. 저장된 성적과 리포트는 유지되며, 같은 성적을 다시 입력할 필요가 없습니다. 준비가 끝나면 이 화면에서 안내합니다.";

/**
 * 버튼 옆에 보이는 연결 오류 문구. 서버가 사유 코드를 주면(503 등) '연결할 수 없음'으로 뭉치지 않고 코드를 함께 보인다
 * (10-26 운영 확인: 분석 버튼이 503 score_input_transition_pending 인데 '서버에 연결할 수 없습니다'로만 보였다).
 */
export function connectionText(e: ConnectionError): string {
  if (e.code === "score_input_transition_pending") return `${SCORE_INPUT_TRANSITION_NOTICE} (문의 번호 score_input_transition_pending)`;
  if (e.kind === "rate_limited") {
    const retryTime = e.retryAt ? seoulTime(e.retryAt.toISOString()) : null;
    if (e.code === "analysis_quota_exceeded") {
      return `오늘 분석 한도를 모두 썼습니다. 기존 리포트는 열 수 있습니다.${retryTime ? ` ${retryTime} 이후 다시 분석해 주세요.` : ""}`;
    }
    // 요청 겹침은 화면 서버가 풀릴 때까지(약 2분) 조용히 다시 보낸 뒤에야 여기 온다(lib/api/live.ts).
    // 제한·재시도 시각·문의 번호는 보이지 않고 차분한 한 줄만 보인다(2026-11-21 대표님 지적)
    return "지금 이용자가 많아 처리가 늦어지고 있습니다. 잠시 뒤 다시 눌러 주세요.";
  }
  if (e.code === "backend_unreachable") return "정시터치 서버에 연결할 수 없습니다.";
  return `정시터치 서버가 지금 이 작업을 잠시 받지 않습니다. 나중에 다시 눌러 주세요. (문의 번호 ${e.code})`;
}
