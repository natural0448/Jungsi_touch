import type { Session } from "./dto";
/**
 * 2026-11-26 대표님 결정: 수능 가채점 판정 무료 공개(11-28~30 시작, 12-13 24시 끝). 기간은 서버가 정한다
 * (session.free_provisional_until — 서버 스위치 JUNGSI_FREE_PROVISIONAL 이 켜져 있고 기간 안일 때만 온다).
 * 화면은 잠금 표시·안내만 바꾸고, 권한 판단과 유료 값 빼기는 서버가 한다.
 */
export function freeProvisionalUntil(session: Session | null | undefined, nowMs = Date.now()): Date | null {
  const v = session?.free_provisional_until;
  if (!session || session.member_tier !== "standard" || typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t > nowMs ? new Date(t) : null;
}
export const isFreeProvisional = (session: Session | null | undefined, nowMs = Date.now()) => freeProvisionalUntil(session, nowMs) !== null;
/** 흐린 칸·잘린 목록에 붙이는 안내(결제 화면은 결제 오픈 전까지 연결하지 않는다) */
export const FREE_LOCK_NOTE = "12월 14일 실채점 공개 때 이용권으로 볼 수 있습니다";
