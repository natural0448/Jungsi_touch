import type { ConnectionError } from "@/lib/api";

export const OFFERING_NOT_LINKED_NOTICE = "선택한 모집단위가 분석 자료에 연결되지 않아 계산하지 못했습니다. 저장한 성적과 리포트는 유지됩니다. 자료 연결이 완료된 뒤 다시 확인해 주세요.";

/** 쓰기 요청이 503 으로 끝났을 때 보인다. 서버가 저장을 마친 뒤 응답만 실패했을 수 있어 실패라고 단정하지 않는다 */
export const MAYBE_SAVED = "서버 응답을 끝까지 받지 못해 화면을 다시 불러왔습니다. 지금 화면에 보이는 상태가 실제 저장 상태이니, 반영됐다면 다시 누르지 않으셔도 됩니다.";

export const SCORE_INPUT_TRANSITION_NOTICE = "성적 입력 정책 전환을 준비하고 있습니다. 저장된 성적과 리포트는 유지되며, 같은 성적을 다시 입력할 필요가 없습니다. 준비가 끝나면 이 화면에서 안내합니다.";

/**
 * 버튼 옆에 보이는 연결 오류 문구. 서버가 사유 코드를 주면(503 등) '연결할 수 없음'으로 뭉치지 않고 코드를 함께 보인다
 * (10-26 운영 확인: 분석 버튼이 503 score_input_transition_pending 인데 '서버에 연결할 수 없습니다'로만 보였다).
 */
export function connectionText(e: ConnectionError): string {
  if (e.code === "score_input_transition_pending") return `${SCORE_INPUT_TRANSITION_NOTICE} (사유 코드 score_input_transition_pending)`;
  if (e.kind === "rate_limited") return "요청이 겹쳤습니다. 몇 초 뒤 다시 눌러 주세요.";
  if (e.code === "backend_unreachable") return "정시터치 서버에 연결할 수 없습니다.";
  return `정시터치 서버가 지금 이 작업을 잠시 받지 않습니다. 나중에 다시 눌러 주세요. (사유 코드 ${e.code})`;
}
