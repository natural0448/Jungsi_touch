/*
  표시 형식. 서버의 UTC 시각은 여기서 Asia/Seoul 로 바꾼다.
  날짜만 있는 값(YYYY-MM-DD)은 Date 로 바꾸지 않고 글자 그대로 쓴다(DEV-002 시각 계약).
*/

/** UTC 시각 → 서울 날짜 "2027.02.28" */
export function seoulDate(isoUtc: string | null): string {
  if (!isoUtc) return "─";
  const p = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(isoUtc));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

/** 날짜만 있는 값 "2026-09-10" → "2026.09.10" */
export function plainDate(ymd: string | null): string {
  return ymd ? ymd.replaceAll("-", ".") : "─";
}

/** 변경분 +2 / -1 / 0 */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** UTC 시각 → 서울 날짜·시각 "2027.02.28 14:05" */
export function seoulDateTime(isoUtc: string | null): string {
  if (!isoUtc) return "─";
  const p = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoUtc));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
