import type { ScoreInputStatusDto } from "./dto";

/*
  수능 성적표 배부일(에듀터치 public.jeongsi_csat_schedule, 본체 마이그레이션 77, 2026-10-29 사용자 결정).
  관리자가 에듀터치 관리자 페이지(/admin/jeongsi/schedule)에서 학년도별로 넣는다.
  배부일(한국 날짜) 당일부터 수능 가채점 정정이 닫힌다: 정정 요청, 관리자 승인, 승인받은 정정 입력.
  날짜를 넣기 전에는 이 규칙으로 막지 않는다(입력 기간은 서버 설정 그대로).
*/

export type CsatRelease = { academic_year: number; score_release_on: string };

/** 한국 날짜 'YYYY-MM-DD' */
export function seoulDay(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** 이 학년도의 배부일. 학년도를 모르면(정정 요청 줄) 가장 최근 학년도 — 한 시즌에 수능은 하나다 */
export function releaseFor(rows: CsatRelease[], year?: number): string | null {
  const hit = year === undefined ? undefined : rows.find((r) => r.academic_year === year);
  if (hit) return hit.score_release_on;
  if (year !== undefined && rows.length > 0) return null;
  return [...rows].sort((a, b) => b.academic_year - a.academic_year)[0]?.score_release_on ?? null;
}

/** 배부일이 지났는지(당일 포함). 날짜가 없으면 false */
export function provisionalClosed(releaseOn: string | null, now: Date = new Date()): boolean {
  return !!releaseOn && seoulDay(now) >= releaseOn;
}

/** 'YYYY-MM-DD' 하루 전 — 회원에게 '이날까지 정정할 수 있습니다'로 보인다 */
export function lastCorrectionDay(releaseOn: string): string {
  const d = new Date(`${releaseOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, ".");
}

/** 지금 남은 입력이 승인받은 정정뿐인 가채점 단계인데 배부일이 지났다 → 입력을 열지 않는다 */
export function correctionInputClosed(st: Pick<ScoreInputStatusDto, "stage" | "initial_remaining" | "correction_granted" | "correction_used"> | null, releaseOn: string | null, now: Date = new Date()): boolean {
  if (!st || st.stage !== "provisional" || !provisionalClosed(releaseOn, now)) return false;
  return st.initial_remaining <= 0 && st.correction_granted > st.correction_used;
}
