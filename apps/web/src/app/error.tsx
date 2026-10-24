"use client";

import { useEffect } from "react";
import { SUPPORT_HREF } from "@/lib/links";

/**
 * 예상하지 못한 오류(연결 안내·권한 안내로 처리되지 않은 예외)의 화면.
 * Next 기본 오류 화면(영어) 대신 다시 시도와 고객센터를 안내한다. 머리글·꼬리말은 레이아웃이 그대로 그린다.
 * 오류 내용은 화면에 내보내지 않고, 서버 기록과 맞춰 볼 수 있게 digest(오류 번호)만 보인다.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="err-h">
        <h2 id="err-h">화면을 그리는 중에 문제가 생겼습니다</h2>
        <p>저장한 성적과 리포트는 그대로 있습니다. 잠시 뒤 다시 시도해 주세요. 계속 같은 화면이 나오면 고객센터에 알려 주세요.</p>
        <div className="acts">
          <button type="button" className="btn p" onClick={() => retry()}>
            다시 시도
          </button>
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
  );
}
