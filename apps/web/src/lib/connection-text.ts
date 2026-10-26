import type { ConnectionError } from "@/lib/api";

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
