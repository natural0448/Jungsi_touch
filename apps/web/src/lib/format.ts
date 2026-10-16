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

/**
 * 상위 % 표시용 문자열. 서버는 소수 여러 자리 문자열("7.051665")을 보내므로 둘째 자리까지 반올림해 보인다.
 * 0 보다 크고 0.01 미만이면 "0.01 미만"처럼 0 으로 보이지 않게 한다. 숫자가 아니면 받은 그대로.
 */
export function pctText(v: string | number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n > 0 && n < 0.01) return "<0.01";
  return n.toFixed(2);
}

/** 변경분 +2 / -1 / 0 */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * UTC 시각 → 서울 시각 (요청 제한 재시도 안내용).
 * 오늘이면 "14:05:30"(초 단위 제한이 흔해 초까지), 내일이면 "내일 09:00", 그 뒤면 "10월 18일 09:00".
 * 시각만 보이면 오늘인지 내일인지 알 수 없다(2026-10-16 하루 한도 안내에서 실측).
 */
export function seoulTime(isoUtc: string, now: Date = new Date()): string {
  const parts = (d: Date) => {
    const p = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute"), ss: get("second") };
  };
  const t = parts(new Date(isoUtc));
  const today = parts(now);
  const tomorrow = parts(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const same = (a: typeof t, b: typeof t) => a.y === b.y && a.m === b.m && a.d === b.d;
  if (same(t, today)) return `${t.hh}:${t.mm}:${t.ss}`;
  if (same(t, tomorrow)) return `내일 ${t.hh}:${t.mm}`;
  return `${t.m}월 ${t.d}일 ${t.hh}:${t.mm}`;
}

/** UTC 시각 → 서울 날짜·시각 "2027.02.28 14:05" */
export function seoulDateTime(isoUtc: string | null): string {
  if (!isoUtc) return "─";
  const p = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoUtc));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
