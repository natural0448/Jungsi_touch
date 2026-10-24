import { apiMode, missingConfig } from "@/lib/api";
import type { ConnectionError } from "@/lib/api";
import { isEdutouchAdmin } from "@/lib/admin";
import { seoulTime } from "@/lib/format";

/**
 * 우리 서비스 API 에 닿지 못했거나 서버가 요청을 제한했을 때의 안내(DEV-006 mode_rules, SEC-07).
 * 결과·건수·점수를 지어내지 않고, 일반 회원이나 합성 응답으로 대신 보이지도 않는다.
 * 설정값 자체(주소·키)는 화면에 내보내지 않는다. 빠진 설정의 이름은 운영에서는 에듀터치 관리자에게만,
 * 개발·합성 환경에서는 누구에게나 보인다(회원에게는 내부 이름이 뜻 없는 정보라 감춘다). 제한 안내는 사유 코드와 재시도 시각만 보인다.
 */
export async function ConnectionNotice({ e }: { e: ConnectionError }) {
  const showNames = e.kind === "unconfigured" && (apiMode() !== "live" || (await isEdutouchAdmin().catch(() => false)));
  const missing = showNames ? missingConfig() : [];
  // 서버가 이 기능의 자료를 아직 승인·연결하지 않았다(503 operation_scope_not_approved). 장애나 이용권 문제가 아니다.
  // 이 코드만 따로 안내하고 다른 503(security_policy_unavailable 등)은 아래 일반 문구 그대로 둔다
  const pendingScope = e.code === "operation_scope_not_approved";
  const heading = pendingScope
    ? "이 화면의 자료를 연결하고 있습니다"
    : e.kind === "unconfigured" ? "정시터치 서버 연결 설정을 기다리고 있습니다" : e.kind === "rate_limited" ? "요청이 많아 잠시 제한되었습니다" : "정시터치 서버에 잠시 연결할 수 없습니다";
  const body = pendingScope
    ? "대학 입시결과·모집단위 검색 자료가 아직 서비스에 연결되지 않았습니다. 연결이 끝나면 이 화면에서 바로 보여 드립니다. 이용권이 있어도 연결 전까지는 같은 안내가 나오며, 지원 가능 여부를 뜻하지 않습니다."
    : e.kind === "unconfigured"
      ? "이 화면이 쓸 서비스 연결이 아직 설정되지 않았습니다. 설정이 끝나면 결과를 보여 드립니다."
      : e.kind === "rate_limited" && e.code === "analysis_quota_exceeded"
        ? `오늘 분석할 수 있는 한도를 모두 썼습니다. 이미 저장한 성적과 리포트는 그대로 볼 수 있습니다.${e.retryAt ? ` ${seoulTime(e.retryAt.toISOString())} 이후 다시 분석할 수 있습니다.` : ""}`
      : e.kind === "rate_limited"
        ? // 서버의 재시도 시각은 '최악의 경우 만료 시각'이라 실제 대기(보통 몇 초)보다 훨씬 늦다(담당자 DB 요약). 몇 초 뒤를 먼저 안내한다
          `같은 계정의 요청이 겹쳐 이번 요청을 잠시 제한했습니다. 보통 몇 초 뒤 다시 열면 그대로 이용할 수 있습니다.${e.retryAt ? ` (늦어도 ${seoulTime(e.retryAt.toISOString())} 이후)` : ""}`
        : "로그인 확인이나 자료 서버가 응답하지 않습니다. 잠시 뒤 다시 열어 주세요. 그동안 다른 결과로 대신 보여 드리지 않습니다.";
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
        <p className="conn-code">
          사유 코드 <code>{e.code}</code>
        </p>
      </section>
    </div>
  );
}
