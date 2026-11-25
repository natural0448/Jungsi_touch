"use client";

import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/jungsi.css";
import { useAutoRetry } from "@/components/use-auto-retry";
import { SUPPORT_HREF, edutouch } from "@/lib/links";

/**
 * 레이아웃 자체가 실패했을 때(로그인 확인 중 예외 등)의 마지막 안내. 레이아웃을 대신하므로 html·body 를 직접 그린다.
 * 연결 실패(ConnectionError)는 레이아웃이 따로 안내하므로 여기에는 그 밖의 예외만 온다.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const auto = useAutoRetry(retry);
  return (
    <html lang="ko">
      <body>
        <div className="et jt">
          <main>
            <div className="wrap pg-body">
              <section className="gate" aria-labelledby="gerr-h">
                <h2 id="gerr-h">{auto === "retrying" ? "정시터치를 다시 불러오고 있습니다" : "정시터치를 열지 못했습니다"}</h2>
                <p>{auto === "retrying" ? "잠시만 기다려 주세요." : "잠시 뒤 다시 시도해 주세요. 에듀터치의 다른 화면은 그대로 쓸 수 있습니다. 계속 열리지 않으면 고객센터에 알려 주세요."}</p>
                <div className="acts">
                  <button type="button" className="btn p" onClick={() => retry()}>
                    다시 시도
                  </button>
                  <a className="btn" href={edutouch("/")}>
                    에듀터치 홈
                  </a>
                  <a className="btn" href={SUPPORT_HREF}>
                    고객센터
                  </a>
                </div>
                {error.digest && (
                  <p className="conn-code">
                    오류 번호 <code>{error.digest}</code>
                  </p>
                )}
              </section>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
