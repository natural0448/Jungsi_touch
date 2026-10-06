import { apiMode } from "@/lib/api";

/**
 * 로컬 검증 연결(JUNGSI_API_MODE=local)로 보는 중임을 알리는 띠.
 * 역할 이름만 보여 주고 토큰 값·파일 경로는 그리지 않는다.
 * 역할 전환은 Git 제외 .env.local 의 JUNGSI_LOCAL_ROLE 을 바꾸고 다시 시작한다.
 */
export function LocalBar() {
  if (apiMode() !== "local") return null;
  const role = process.env.JUNGSI_LOCAL_ROLE?.toLowerCase();
  return (
    <aside className="synbar" aria-label="로컬 검증 연결">
      <div className="wrap">
        <span className="tag">로컬 검증</span>
        <span className="txt">
          담당자 로컬 서버(127.0.0.1)의 시험 사용자{role ? ` · 역할 ${role}` : ""}로 보는 중입니다. 운영 서비스·실제 회원이 아니며, 승인되지 않은 자료는 보류로 나옵니다.
        </span>
      </div>
    </aside>
  );
}
