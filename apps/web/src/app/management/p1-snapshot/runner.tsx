"use client";

import { useRef, useState } from "react";
import { runWarmStep, type StepResult } from "./actions";

/** 준비 버튼: 한 단계씩 이어 부르고 진행을 보인다. 실패하면 멈춘다(자동으로 끝없이 다시 하지 않는다) */
export function WarmRunner() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<StepResult | null>(null);
  const stop = useRef(false);

  const run = async () => {
    setBusy(true);
    stop.current = false;
    let tries = 0;
    for (;;) {
      if (stop.current) break;
      const r = await runWarmStep();
      setLast(r);
      if (!r.ok) {
        // 동시 처리 제한·일시 장애는 5초 뒤 같은 단계부터 3번까지만 다시 한다
        if (r.retryable && tries < 3) {
          tries++;
          await new Promise((res) => setTimeout(res, 5000));
          continue;
        }
        break;
      }
      tries = 0;
      if (r.status.state !== "running") break;
      // A different tab/instance owns the short lease. Do not hammer its coordinator.
      const retryAfter = r.status.retry_after_ms;
      if (retryAfter) await new Promise((resolve) => setTimeout(resolve, Math.max(1000, retryAfter)));
    }
    setBusy(false);
  };

  const s = last?.ok ? last.status : null;
  return (
    <div className="mg-warm">
      <div className="acts">
        <button type="button" className="btn p" onClick={run} disabled={busy}>
          {busy ? "준비하는 중…" : "현재판 정리본 준비(받기·검증·저장)"}
        </button>
        {busy && (
          <button type="button" className="btn" onClick={() => (stop.current = true)}>
            멈추기
          </button>
        )}
      </div>
      <p className="mg-state" aria-live="polite">
        {!last
          ? "아직 실행하지 않았습니다."
          : !last.ok
            ? `멈춤 — 사유 코드 ${last.code}. 받은 부분은 보관되고 ready 는 올라가지 않았습니다. 다시 누르면 이어서 합니다.`
            : s?.state === "ready"
              ? `완료 — ${s.ready.snapshot_id} · 행 ${s.ready.counts.rows} · 학교 ${s.ready.counts.schools}. 1페이지에 반영됐습니다.`
              : s?.state === "changed"
                ? "현재판이 바뀌었습니다. 다시 누르면 새 판을 처음부터 준비합니다."
                : s?.state === "running"
                  ? s.phase === "parts"
                    ? s.retry_after_ms ? "다른 준비 작업이나 현재판 확인이 진행 중입니다. 잠시 후 진행 상태를 확인합니다." : `분할 받기·검증 ${s.parts_done} / ${s.parts_total}`
                    : s.phase === "schools"
                      ? `학교별 묶음 저장 ${s.schools_done} / ${s.schools_total}`
                      : "검색 색인 만드는 중"
                  : ""}
      </p>
    </div>
  );
}
