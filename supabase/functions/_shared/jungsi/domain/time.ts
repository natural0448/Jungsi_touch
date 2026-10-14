/** UTC microsecond instants; calendar dates remain a separate type. */
import { requireContract } from "./exact.ts";
const MICROSECOND = 1000000n;
function civilMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  requireContract(
    year >= 1 && year <= 9999 && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59,
    "invalid_instant",
  );
  return d.getTime();
}
function seoulOffset(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (name: string) => Number(parts.find((p) => p.type === name)?.value);
  return civilMs(get("year"), get("month"), get("day"), get("hour"), get("minute"), get("second")) -
    ms;
}
export function utcInstant(value: string, sourceTimezone?: string): bigint {
  const m =
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])?$/
      .exec(value);
  requireContract(m, "invalid_instant");
  const local = civilMs(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  let offset = 0;
  if (!m[8]) {
    requireContract(sourceTimezone === "Asia/Seoul", "naive_instant_timezone_required");
    const before = seoulOffset(local - 2 * 86400000), after = seoulOffset(local + 2 * 86400000);
    const candidates = [...new Set([before, after])].map((o) => local - o).filter((t) =>
      t + seoulOffset(t) === local
    ).sort((a, b) => a - b);
    offset = candidates.length ? local - candidates[0] : before;
  } else if (m[8] !== "Z") {
    offset = (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(4, 6))) * 60000 *
      (m[8][0] === "-" ? -1 : 1);
  }
  const result = BigInt(local - offset) * 1000n + BigInt((m[7] ?? "").padEnd(6, "0"));
  utcText(result);
  return result;
}
export function utcText(value: bigint): string {
  // Floor division matters before the Unix epoch, including negative subsecond instants.
  let seconds = value / MICROSECOND, fraction = value % MICROSECOND;
  if (fraction < 0n) {
    seconds--;
    fraction += MICROSECOND;
  }
  const d = new Date(Number(seconds * 1000n));
  requireContract(d.getUTCFullYear() >= 1 && d.getUTCFullYear() <= 9999, "invalid_instant");
  return d.toISOString().slice(0, 19) + (fraction ? "." + String(fraction).padStart(6, "0") : "") +
    "Z";
}
export function calendarDate(value: string): string {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  requireContract(m, "invalid_calendar_date");
  civilMs(Number(m[1]), Number(m[2]), Number(m[3]));
  return value;
}
export function seoulDateRange(start: string, end: string): readonly [bigint, bigint] {
  calendarDate(start);
  calendarDate(end);
  requireContract(start <= end, "reversed_calendar_interval");
  const next = new Date(
    civilMs(Number(end.slice(0, 4)), Number(end.slice(5, 7)), Number(end.slice(8, 10))) + 86400000,
  );
  requireContract(next.getUTCFullYear() <= 9999, "invalid_calendar_date");
  const nextDate = next.toISOString().slice(0, 10);
  return [
    utcInstant(start + "T00:00:00", "Asia/Seoul"),
    utcInstant(nextDate + "T00:00:00", "Asia/Seoul"),
  ];
}
