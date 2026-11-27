import type { OverallResultDto, ReferencePercentileDto } from "./dto";

/**
 * 참고 유불리(담당자 v13 R16 정의, 대표님 결정 2026-11-16):
 *   유불리(%p) = 전체 상위 누백 − 이 대학 방식 상위 누백.  양수면 이 대학 방식에서 내 위치가 더 위.
 *   둘 중 하나라도 범위면 [전체 하한 − 대학 상한, 전체 상한 − 대학 하한] 범위로 보인다.
 * 서버가 유불리(advantage)를 주지 않고, 같은 시험의 대학 참고 누백(reference_estimated)과
 * 전체 위치(observed/estimated)가 모두 있을 때만 계산한다. 두 값은 서버가 준 정확한 소수 문자열이고,
 * 화면은 빼기만 한다(새 추정을 만들지 않는다). 숫자는 소수 6자리 정수로 센다.
 */
const DEC = /^(\d{1,3})(?:\.(\d+))?$/;
const SCALE = BigInt(1000000), ZERO = BigInt(0), TEN = BigInt(10), HALF = BigInt(50000);

function micro(s: string | null | undefined): bigint | null {
  const m = typeof s === "string" ? DEC.exec(s.trim()) : null;
  if (!m) return null;
  const frac = m[2] ?? "";
  const up = frac.length > 6 && frac[6] >= "5" ? BigInt(1) : ZERO;
  const v = BigInt(m[1]) * SCALE + BigInt(frac.slice(0, 6).padEnd(6, "0")) + up;
  return v > BigInt(100) * SCALE ? null : v;
}
/** 부호 있는 소수 첫째 자리(0에서 먼 쪽으로 반올림). 0.0 은 부호 없이 */
function signed1(v: bigint): string {
  const neg = v < ZERO, a = neg ? -v : v;
  const tenth = (a + HALF) / (SCALE / TEN);
  if (tenth === ZERO) return "0.0";
  return `${neg ? "−" : "+"}${tenth / TEN}.${tenth % TEN}`;
}

export interface ReferenceAdvantage {
  /** 예: "+1.2", "−0.4~+1.2" (%p 는 붙이지 않음) */
  text: string;
  /** up: 범위 전체가 0보다 큼, down: 전체가 0보다 작음, even: 0을 걸치거나 0 */
  tone: "up" | "down" | "even";
  /** 막대 길이용 대표값(범위 가운데, %p) */
  mid: number;
}

export function referenceAdvantage(
  r: ReferencePercentileDto | null | undefined,
  overall: OverallResultDto | null | undefined,
): ReferenceAdvantage | null {
  if (!r || r.status !== "reference_estimated" || !overall) return null;
  if (overall.status !== "observed" && overall.status !== "estimated") return null;
  const rLo = micro(r.estimated_upper_cumulative_percent_all_examinees);
  if (rLo === null) return null;
  const rUpRaw = micro(r.estimated_upper_cumulative_percent_upper_bound ?? null);
  const rHi = rUpRaw !== null && rUpRaw >= rLo ? rUpRaw : rLo;
  const oMid = micro(overall.top_percent);
  const oLoRaw = micro(overall.exclusive_top_percent) ?? oMid, oHiRaw = micro(overall.inclusive_top_percent) ?? oMid;
  if (oLoRaw === null || oHiRaw === null) return null;
  const oLo = oLoRaw <= oHiRaw ? oLoRaw : oHiRaw, oHi = oLoRaw <= oHiRaw ? oHiRaw : oLoRaw;
  const lo = oLo - rHi, hi = oHi - rLo;
  const a = signed1(lo), b = signed1(hi);
  const tone = lo > ZERO && a !== "0.0" ? "up" : hi < ZERO && b !== "0.0" ? "down" : "even";
  return { text: a === b ? a : `${a}~${b}`, tone, mid: Number(lo + hi) / 2 / Number(SCALE) };
}
