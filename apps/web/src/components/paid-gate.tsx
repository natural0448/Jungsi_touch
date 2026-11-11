import Link from "@/components/link";
import { adminMfaPending } from "@/lib/admin-mfa";
import { PASS_HREF, edutouch, loginHref } from "@/lib/links";
import { page, type PageRoute } from "@/lib/routes";
import { LockIcon } from "./icons";

/** 2단계 인증(OTP)을 마친 뒤 정시터치의 그 화면으로 돌아오는 에듀터치 주소 */
function mfaHref(jungsiPath: string): string {
  return edutouch(`/mfa?next=${encodeURIComponent(`/jeongsi${jungsiPath}`)}`);
}

/** 유료 화면의 막힘 안내. 일반 회원에게 결과·건수를 그리지 않고 이것만 보인다 */
export async function PaidGate({ kind, route, features }: { kind: "login" | "paid"; route: PageRoute; features: string[] }) {
  const p1 = page("PAGE-01");
  // 관리자인데 지금 로그인이 2단계 인증 전(aal1)이면 이용권 안내 대신 2단계 인증 안내(11-11 운영에서 조용히 막힘)
  if (kind === "paid" && (await adminMfaPending())) {
    return (
      <div className="wrap pg-body">
        <section className="gate pass" aria-labelledby="gate-h">
          <div className="ic"><LockIcon size={20} /></div>
          <h2 id="gate-h">관리자 계정은 2단계 인증을 마치면 열립니다</h2>
          <p>지금 로그인은 비밀번호만 거쳤습니다. 2단계 인증(OTP)을 마치면 {route.label}를 관리자 권한으로 볼 수 있습니다.</p>
          <div className="acts">
            <a className="btn p" href={mfaHref(route.path)}>2단계 인증 하기</a>
            <Link className="btn" href={p1.path}>{p1.label} 보기</Link>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="wrap pg-body">
      <section className="gate pass" aria-labelledby="gate-h">
        <div className="ic"><LockIcon size={20} /></div>
        {kind === "login" ? (
          <>
            <h2 id="gate-h">로그인하고 이용권으로 여는 화면입니다</h2>
            <p>{route.label}는 이용권 회원 전용입니다. 먼저 로그인해 주세요.</p>
            <div className="acts">
              <a className="btn p" href={loginHref(route.path)}>에듀터치 로그인</a>
              <Link className="btn" href={p1.path}>{p1.label} 보기</Link>
            </div>
          </>
        ) : (
          <>
            <h2 id="gate-h">{route.label}는 이용권 회원 전용입니다</h2>
            <ul>
              {features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="acts">
              <a className="btn t" href={PASS_HREF}>이용권 보기</a>
              <Link className="btn" href={p1.path}>{p1.label} 보기</Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
