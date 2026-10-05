import { missingConfig } from "@/lib/api";
import type { ConnectionError } from "@/lib/api";

/**
 * 우리 서비스 API 에 닿지 못했을 때의 안내(DEV-006 mode_rules).
 * 결과·건수·점수를 지어내지 않고, 일반 회원이나 합성 응답으로 대신 보이지도 않는다.
 * 설정값 자체(주소·키)는 화면에 내보내지 않고 이름만 적는다.
 */
export function ConnectionNotice({ e }: { e: ConnectionError }) {
  const missing = e.kind === "unconfigured" ? missingConfig() : [];
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="conn-h">
        <h2 id="conn-h">{e.kind === "unconfigured" ? "정시터치 서버 연결 설정을 기다리고 있습니다" : "정시터치 서버에 잠시 연결할 수 없습니다"}</h2>
        <p>
          {e.kind === "unconfigured"
            ? "이 화면이 쓸 서비스 연결이 아직 설정되지 않았습니다. 설정이 끝나면 결과를 보여 드립니다."
            : "로그인 확인이나 자료 서버가 응답하지 않습니다. 잠시 뒤 다시 열어 주세요. 그동안 다른 결과로 대신 보여 드리지 않습니다."}
        </p>
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
