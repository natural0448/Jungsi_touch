import { AccessDenied, ConnectionError, source, type Caller } from "@/lib/api";
import type { ScoreInputStatusDto } from "@/lib/dto";
import { EXAM } from "@/lib/exam";

/**
 * 전문가용 지금 입력 단계(모의평가·수능 가채점·수능 실채점). 개인용 2페이지와 같은 서버 입력 상태
 * (score-input-status, 단계 미지정)가 정한다(2026-11-13). 읽지 못하면 null — 단계를 짐작하지 않는다.
 */
export async function currentStage(caller: Caller): Promise<ScoreInputStatusDto | null> {
  try {
    return await source().readScoreInputStatus(caller, EXAM.exam_id);
  } catch (e) {
    if (e instanceof ConnectionError || e instanceof AccessDenied) return null;
    throw e;
  }
}

/** 동시에 보내는 요청 수를 묶어 제한한다(계정당 동시 한도 429를 피한다) */
export async function inBatches<T, R>(items: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}
