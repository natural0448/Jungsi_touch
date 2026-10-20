import Link from "@/components/link";
import { PASS_HREF, loginHref } from "@/lib/links";
import { page, type PageRoute } from "@/lib/routes";
import { LockIcon } from "./icons";

/** 유료 화면의 막힘 안내. 일반 회원에게 결과·건수를 그리지 않고 이것만 보인다 */
export function PaidGate({ kind, route, features }: { kind: "login" | "paid"; route: PageRoute; features: string[] }) {
  const p1 = page("PAGE-01");
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
