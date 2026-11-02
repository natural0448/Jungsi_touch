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

/**
 * 서버 as_of 를 '자료 기준' 날짜로. 날짜만 있는 원문("2026-09-10")은 시간대 변환 없이 그대로 쓰고,
 * 시각이 붙은 값은 Asia/Seoul 날짜로 바꾼다. 형식이 맞지 않으면 null — 오늘 날짜로 채우지 않는다
 */
export function asOfDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return plainDate(raw);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(new Date(raw).getTime())) return null;
  return seoulDate(raw);
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

/**
 * 경쟁률 표시(2026-11-02 사용자 결정): 소수 셋째 자리 이상이면 둘째 자리까지 반올림(half-up)한다.
 * "5.0999999999999996" → "5.1", "4.567" → "4.57". 둘째 자리 이하 원문("3.3"·"4.50")과 숫자가 아닌 원문은 그대로 둔다.
 * 부동소수 변환 없이 십진 문자열로 계산한다.
 */
export function ratioText(v: string): string {
  const t = /^(\d+)\.(\d{3,})$/.exec(v.trim());
  if (!t) return v;
  let n = BigInt(t[1] + t[2].slice(0, 2));
  if (t[2][2] >= "5") n += BigInt(1);
  const d = n.toString().padStart(3, "0");
  const frac = d.slice(-2).replace(/0+$/, "");
  return frac ? `${d.slice(0, -2)}.${frac}` : d.slice(0, -2);
}

/**
 * 이용권 '…까지' 날짜. 서버가 끝 시각을 '그 시각 전까지'(예: 2027-01-07T15:00:00Z = 1월 8일 0시 KST)로 보내도
 * 마지막 이용일(1월 7일)이 보이게 1ms 앞 시각의 서울 날짜를 쓴다. 23:59:59 로 오는 값은 그대로 같은 날이다.
 */
export function untilDate(isoUtc: string | null): string {
  if (!isoUtc) return "─";
  const t = Date.parse(isoUtc);
  return Number.isNaN(t) ? "─" : seoulDate(new Date(t - 1).toISOString());
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
