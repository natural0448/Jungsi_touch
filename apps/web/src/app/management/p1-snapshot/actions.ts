"use server";

import { isEdutouchAdmin } from "@/lib/admin";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { rebuildStart, warmStep, type WarmStatus } from "@/lib/p1-snapshot";

export type StepResult = { ok: true; status: WarmStatus } | { ok: false; code: string; retryable: boolean };

/**
 * 정리본 준비 한 단계(관리자만). 화면이 ready 가 될 때까지 이어 부른다. 실패하면 멈추고 사유 코드만 보인다 —
 * 일부만 받은 판을 ready 로 올리지 않는다. 동시 처리 제한(429)은 잠시 뒤 같은 단계부터 다시 하면 된다
 */
export async function runWarmStep(): Promise<StepResult> {
  if (!(await isEdutouchAdmin())) return { ok: false, code: "admin_required", retryable: false };
  try {
    return { ok: true, status: await warmStep(source(), await getCaller()) };
  } catch (e) {
    if (e instanceof ConnectionError) return { ok: false, code: e.code, retryable: e.kind === "rate_limited" || e.kind === "unavailable" };
    if (e instanceof AccessDenied) return { ok: false, code: e.code, retryable: false };
    const m = e instanceof Error ? /^(p1_[a-z0-9_]+)/.exec(e.message)?.[1] : undefined;
    return { ok: false, code: m ?? "warm_failed", retryable: false };
  }
}

/**
 * '정리본 다시 만들기' 시작(관리자만, 2026-11-16). 같은 판의 정리본을 처음부터 다시 만든다. 다시 만드는 동안
 * 1페이지는 이전 준비본을 그대로 쓴다. 시작한 뒤 화면이 runWarmStep 을 끝까지 이어 부른다
 */
export async function runRebuildStart(): Promise<StepResult> {
  if (!(await isEdutouchAdmin())) return { ok: false, code: "admin_required", retryable: false };
  try {
    return { ok: true, status: await rebuildStart(source(), await getCaller()) };
  } catch (e) {
    if (e instanceof ConnectionError) return { ok: false, code: e.code, retryable: false };
    if (e instanceof AccessDenied) return { ok: false, code: e.code, retryable: false };
    return { ok: false, code: "rebuild_failed", retryable: false };
  }
}
