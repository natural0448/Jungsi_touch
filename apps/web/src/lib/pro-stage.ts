import { AccessDenied, ConnectionError, source, type Caller } from "@/lib/api";
import type { ScoreInputStatusDto } from "@/lib/dto";
import { csatOpen, EXAM } from "@/lib/exam";

/**
 * 전문가용 지금 입력 단계(모의평가·수능 가채점·수능 실채점). 개인용 2페이지와 같은 서버 입력 상태
 * (score-input-status, 단계 미지정)가 정한다(2026-11-13). 읽지 못하면 정해진 일정으로 단계만 정한다(2026-11-23).
 */
export async function currentStage(caller: Caller, budgetMs = STAGE_BUDGET_MS): Promise<ScoreInputStatusDto | null> {
  // 개인용 요청은 요청 한도(429)에 걸리면 화면 서버가 최대 1분 50초까지 조용히 다시 보낸다(live.ts). 그동안 학생 화면 전체가
  // 멈췄다(2026-11-23 운영: 담기 뒤 '담는 중…'). 단계 확인은 상한 안에서만 기다리고, 넘으면 일정으로 정한다.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), budgetMs);
  });
  try {
    const got = await Promise.race([source().readScoreInputStatus(caller, EXAM.exam_id), late]);
    return got === "late" ? scheduledStage() : got;
  } catch (e) {
    // 2026-11-23 운영: 선생님 계정의 개인용 입력 상태 읽기가 요청 한도(429)에 걸려 학생 입력이 '입력 단계를 확인할 수 없어'로
    // 닫혔다(전문가용 화면을 열 때마다 개인용 상태를 한 번 읽는다). 읽지 못하면 정해진 일정으로 단계만 정한다.
    // 학생의 입력 횟수·저장 가부는 전문가용 서버(pro.score.status·pro.score.create)가 따로 확인하므로 이 값으로 열리지 않는다.
    if (e instanceof ConnectionError || e instanceof AccessDenied) return scheduledStage();
    throw e;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
/** 전문가용 학생 화면의 지금 단계 확인 대기 상한 */
export const STAGE_BUDGET_MS = 2500;

/** 가채점 입력 마감(12-10 24:00 KST)·실채점 입력 시작(성적표 배부 3일 뒤 12-14 00:00 KST, 2026-11-13 대표님 결정) */
const PROVISIONAL_CLOSES_AT = Date.parse("2026-12-10T15:00:00Z");
const FINAL_OPENS_AT = Date.parse("2026-12-13T15:00:00Z");

/** 서버 입력 상태를 읽지 못했을 때 일정으로 정한 단계(입력 횟수 칸은 0 — 화면은 학생별 상태를 따로 읽는다) */
export function scheduledStage(now: Date = new Date()): ScoreInputStatusDto | null {
  if (!csatOpen(now)) return null;
  const t = now.getTime();
  const final = t >= PROVISIONAL_CLOSES_AT;
  const state: ScoreInputStatusDto["stage_state"] = !final ? "open" : t >= FINAL_OPENS_AT ? "open" : "not_open";
  return {
    format: "jungsi.score-input-status/v1",
    exam_id: EXAM.exam_id,
    pack_version: EXAM.pack_version,
    academic_year: 2027,
    stage: final ? "final" : "provisional",
    stage_state: state,
    opens_at: null,
    closes_at: null,
    paid_input_allowed: false,
    input_limit_mode: "stage_rights",
    initial_used: 0,
    initial_remaining: 0,
    correction_granted: 0,
    correction_used: 0,
    correction_request_remaining: 0,
    effective_save_remaining: null,
    entry_version: 0,
    current_profile_id: null,
    current_report_id: null,
    last_attempt_outcome: null,
    last_rejection_code: null,
    legacy_transition_status: "scheduled_fallback",
  };
}

/** 동시에 보내는 요청 수를 묶어 제한한다(계정당 동시 한도 429를 피한다) */
export async function inBatches<T, R>(items: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}
