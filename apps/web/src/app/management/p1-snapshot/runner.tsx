"use client";

import { useRef, useState } from "react";
import type { StepResult } from "./actions";

/*
  한 단계 요청의 기한(2026-11-07). 정상 단계는 20~25초(head 확인 + 분할 6개, 서버 함수 로그 기준)다.
  seq21 에서 요청 하나가 서버에 닿지 않아 응답 없이 8분 넘게 멈췄다. 기한이 지나면 그 요청을 끊고 같은 단계부터 다시 보낸다.
  끊긴 요청이 서버에서 늦게 끝나도 서버 임대(lease)가 같은 판을 한 작업만 진행하게 하므로, 다시 보낸 요청은 진행 상태만 받는다.
  분할은 지금처럼 한 단계씩 차례로 받는다(동시에 여러 개 받으면 서버 요청 한도 429 에 걸릴 수 있다, 부담당자 11-07 회신)
*/
const STEP_TIMEOUT_MS = 90_000;
/** 같은 단계에서 연달아 실패(시간 초과·동시 처리 제한·일시 장애)해도 다시 하는 횟수. 넘으면 멈추고 사유를 보인다 */
const MAX_RETRIES = 3;
const STEP_URL = "/jeongsi/management/p1-snapshot/step"; // basePath(/jeongsi)는 fetch 에 자동으로 붙지 않는다
const REBUILD_URL = "/jeongsi/management/p1-snapshot/rebuild";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** 한 단계를 기한 안에 받는다. 기한 초과는 step_timeout, 사람이 멈추면 stopped */
async function step(ctl: AbortController): Promise<StepResult> {
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, STEP_TIMEOUT_MS);
  try {
    const res = await fetch(STEP_URL, { method: "POST", headers: { "x-p1-warm": "1" }, cache: "no-store", credentials: "same-origin", signal: ctl.signal });
    const body = (await res.json().catch(() => null)) as StepResult | null;
    if (body && typeof body === "object" && "ok" in body) return body;
    return { ok: false, code: `http_${res.status}`, retryable: res.status >= 500 || res.status === 429 };
  } catch {
    if (timedOut) return { ok: false, code: "step_timeout", retryable: true };
    if (ctl.signal.aborted) return { ok: false, code: "stopped", retryable: false };
    return { ok: false, code: "request_failed", retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/** 준비 버튼: 한 단계씩 이어 부르고 진행을 보인다. 실패하면 3번까지 같은 단계부터 다시 하고, 그래도 안 되면 멈춘다 */
export function WarmRunner() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<StepResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const stop = useRef(false);
  const live = useRef<AbortController | null>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    // 멈춘 뒤 다시 누르면 첫 결과가 올 때까지 '시작하는 중…'을 보인다
    setLast((p) => (p && !p.ok && p.code === "stopped" ? null : p));
    stop.current = false;
    let tries = 0;
    // 사람이 멈추면 마지막 진행 표시 대신 '멈췄습니다' 안내를 남긴다
    const stopped = () => {
      setNote(null);
      setLast({ ok: false, code: "stopped", retryable: false });
    };
    for (;;) {
      if (stop.current) { stopped(); break; }
      const ctl = new AbortController();
      live.current = ctl;
      const r = await step(ctl);
      live.current = null;
      if (stop.current) { stopped(); break; }
      if (!r.ok) {
        if (r.retryable && tries < MAX_RETRIES) {
          tries++;
          // 진행 표시는 그대로 두고 다시 하는 중임만 알린다
          setNote(r.code === "step_timeout" ? `응답이 ${STEP_TIMEOUT_MS / 1000}초 안에 오지 않아 같은 단계부터 다시 합니다(${tries}/${MAX_RETRIES}).` : `잠시 뒤 같은 단계부터 다시 합니다(사유 코드 ${r.code}, ${tries}/${MAX_RETRIES}).`);
          await sleep(5000);
          continue;
        }
        setLast(r);
        setNote(null);
        break;
      }
      tries = 0;
      setNote(null);
      setLast(r);
      if (r.status.state !== "running") break;
      // A different tab/instance owns the short lease. Do not hammer its coordinator.
      const retryAfter = r.status.retry_after_ms;
      if (retryAfter) await sleep(Math.max(1000, retryAfter));
    }
    setBusy(false);
  };

  /** 정리본 다시 만들기(2026-11-16): 같은 판을 처음부터 다시 만든다. 그동안 1페이지는 이전 정리본을 그대로 쓴다 */
  const rebuild = async () => {
    setBusy(true);
    setNote("다시 만들기를 시작합니다. 끝날 때까지 1페이지는 지금 정리본을 그대로 보여 줍니다.");
    setLast(null);
    let r: StepResult;
    try {
      const res = await fetch(REBUILD_URL, { method: "POST", headers: { "x-p1-rebuild": "1" }, cache: "no-store", credentials: "same-origin" });
      const body = (await res.json().catch(() => null)) as StepResult | null;
      r = body && typeof body === "object" && "ok" in body ? body : { ok: false, code: `http_${res.status}`, retryable: false };
    } catch {
      r = { ok: false, code: "request_failed", retryable: false };
    }
    if (!r.ok) { setNote(null); setLast(r); setBusy(false); return; }
    await run();
  };

  const halt = () => {
    stop.current = true;
    live.current?.abort(); // 기다리던 요청도 바로 끊는다. 받은 부분은 서버에 보관돼 다시 누르면 이어서 한다
  };

  const s = last?.ok ? last.status : null;
  return (
    <div className="mg-warm">
      <div className="acts">
        <button type="button" className="btn p" onClick={run} disabled={busy}>
          {busy ? "준비하는 중…" : "현재판 정리본 준비(받기·검증·저장)"}
        </button>
        {!busy && (
          <button type="button" className="btn" onClick={rebuild} title="같은 판의 정리본을 처음부터 다시 만듭니다. 화면 정리 방식이 바뀌어 새 칸을 채울 때 씁니다.">
            정리본 다시 만들기
          </button>
        )}
        {busy && (
          <button type="button" className="btn" onClick={halt}>
            멈추기
          </button>
        )}
      </div>
      <p className="mg-state" aria-live="polite">
        {!last
          ? busy ? "시작하는 중…" : "아직 실행하지 않았습니다."
          : !last.ok
            ? last.code === "stopped"
              ? "멈췄습니다. 받은 부분은 보관되고 ready 는 올라가지 않았습니다. 다시 누르면 이어서 합니다."
              : `멈춤 — 사유 코드 ${last.code}. 받은 부분은 보관되고 ready 는 올라가지 않았습니다. 다시 누르면 이어서 합니다.`
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
      {note && <p className="mg-state">{note}</p>}
    </div>
  );
}
