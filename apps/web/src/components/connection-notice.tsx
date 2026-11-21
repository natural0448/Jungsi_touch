import { apiMode, missingConfig } from "@/lib/api";
import type { ConnectionError } from "@/lib/api";
import { isEdutouchAdmin } from "@/lib/admin";
import { seoulTime } from "@/lib/format";
import { SCORE_INPUT_TRANSITION_NOTICE } from "@/lib/connection-text";
import { AutoReopen } from "./auto-reopen";

/**
 * 우리 서비스 API 에 닿지 못했거나 서버가 요청을 제한했을 때의 안내(DEV-006 mode_rules, SEC-07).
 * 결과·건수·점수를 지어내지 않고, 일반 회원이나 합성 응답으로 대신 보이지도 않는다.
 * 설정값 자체(주소·키)는 화면에 내보내지 않는다. 빠진 설정의 이름은 운영에서는 에듀터치 관리자에게만,
 * 개발·합성 환경에서는 누구에게나 보인다(회원에게는 내부 이름이 뜻 없는 정보라 감춘다). 제한 안내는 사유 코드와 재시도 시각만 보인다.
 */
export async function ConnectionNotice({ e, reopenUnavailable = false }: { e: ConnectionError; reopenUnavailable?: boolean }) {
  const showNames = e.kind === "unconfigured" && (apiMode() !== "live" || (await isEdutouchAdmin().catch(() => false)));
  const missing = showNames ? missingConfig() : [];
  // 서버가 이 기능의 자료를 아직 승인·연결하지 않았다(503 operation_scope_not_approved). 장애나 이용권 문제가 아니다.
  // 이 코드만 따로 안내하고 다른 503(security_policy_unavailable 등)은 아래 일반 문구 그대로 둔다
  const pendingScope = e.code === "operation_scope_not_approved";
  const transitionPending = e.code === "score_input_transition_pending";
  // 요청 겹침 제한은 화면 서버가 풀릴 때까지(약 2분) 조용히 다시 보낸 뒤에야 여기 온다(lib/api/live.ts).
  // 고객에게 제한·문의 번호·재시도 시각을 보이지 않고 차분한 한 줄만 보인 채 스스로 다시 연다(2026-11-21 대표님 지적)
  const contention = e.kind === "rate_limited" && e.code !== "analysis_quota_exceeded";
  if (contention) {
    return (
      <div className="wrap pg-body">
        <section className="gate flat" aria-live="polite">
          <p>지금 이용자가 많아 화면을 여는 데 시간이 더 걸리고 있습니다. 잠시 뒤 이 화면을 자동으로 다시 엽니다.</p>
          <AutoReopen quiet />
        </section>
      </div>
    );
  }
  // 전문가용 서버 연결 전(시범 준비 중, 2026-10-29 사용자 결정): 선생님께는 사유 코드 없이 준비 안내만 보인다
  const proPending = e.code === "pro_api_not_configured";
  const heading = proPending ? "정시터치 전문가용을 준비하고 있습니다" : transitionPending ? "성적 입력 방식을 바꾸는 작업을 하고 있습니다" : pendingScope
    ? "이 화면의 자료를 연결하고 있습니다"
    : e.kind === "unconfigured" ? "정시터치 서버 연결 설정을 기다리고 있습니다" : e.kind === "rate_limited" ? "오늘 분석할 수 있는 한도를 모두 썼습니다" : "정시터치 서버에 잠시 연결할 수 없습니다";
  const body = proPending
    ? "학생 성적 입력과 분석은 시범 운영을 시작할 때 열립니다. 시작 날짜는 에듀터치가 기관 관리자께 메일로 알려 드립니다. 위의 기관·계약 정보는 지금도 확인하실 수 있습니다."
    : transitionPending ? SCORE_INPUT_TRANSITION_NOTICE : pendingScope
    ? "대학 입시결과·모집단위 검색 자료가 아직 서비스에 연결되지 않았습니다. 연결이 끝나면 이 화면에서 바로 보여 드립니다. 이용권이 있어도 연결 전까지는 같은 안내가 나오며, 지원 가능 여부를 뜻하지 않습니다."
    : e.kind === "unconfigured"
      ? "이 화면이 쓸 서비스 연결이 아직 설정되지 않았습니다. 설정이 끝나면 결과를 보여 드립니다."
      : e.kind === "rate_limited" && e.code === "analysis_quota_exceeded"
        ? `오늘 분석할 수 있는 한도를 모두 썼습니다. 이미 저장한 성적과 리포트는 그대로 볼 수 있습니다.${e.retryAt ? ` ${seoulTime(e.retryAt.toISOString())} 이후 다시 분석할 수 있습니다.` : ""}`
      : e.kind === "rate_limited"
        ? // 서버의 재시도 시각은 '최악의 경우 만료 시각'이라 실제 대기(보통 몇 초)보다 훨씬 늦다(담당자 DB 요약). 몇 초 뒤를 먼저 안내한다
          `같은 계정의 요청이 겹쳐 이번 요청을 잠시 제한했습니다. 보통 몇 초 뒤 다시 열면 그대로 이용할 수 있습니다.${e.retryAt ? ` (늦어도 ${seoulTime(e.retryAt.toISOString())} 이후)` : ""}`
        : "로그인 확인이나 자료 서버가 응답하지 않습니다. 잠시 뒤 다시 열어 주세요. 정확하지 않은 결과를 보여 드리지 않으려고 잠시 멈춘 것입니다.";
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="conn-h">
        <h2 id="conn-h">{heading}</h2>
        <p>{body}</p>
        {missing.length > 0 && (
          <p className="conn-missing">
            빠진 설정:{" "}
            {missing.map((m, i) => (
              <span key={m}>
                {i > 0 && " · "}
                <code>{m}</code>
              </span>
            ))}
          </p>
        )}
        {/* 요청 겹침으로 제한된 경우만 스스로 다시 연다. 하루 분석 한도는 기다려도 풀리지 않아 제외한다 */}
        {/* 같은 화면의 다른 요청은 이미 받아 서버가 살아 있는 경우(reopenUnavailable), 일시적인 응답 실패도 같은 횟수 제한으로 다시 연다.
            2026-11-18 운영 관측: 3페이지 다음 쪽에서 목록은 왔는데 내 리포트 읽기만 실패해 30행이 '확인 못 함'으로 멈췄다. 연결·전환 준비 중 안내는 제외한다 */}
        {((e.kind === "rate_limited" && e.code !== "analysis_quota_exceeded") ||
          (reopenUnavailable && e.kind === "unavailable" && !pendingScope && !transitionPending && !proPending)) && <AutoReopen />}
        {(!proPending || showNames) && (
          <p className="conn-code">
            문의 번호 <code>{e.code}</code>
          </p>
        )}
      </section>
    </div>
  );
}
