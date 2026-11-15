import type { AssessmentDto, YearCutoffDto } from "./dto";

/**
 * 연도별 근거(대표님 결정 2026-11-15): 지난 학년도 합격선의 누적 백분위와 내 누적 백분위를 견준다.
 * 둘 다 '전체 응시자 중 위에서 몇 %'라서 해가 달라도 같은 기준이다. 숫자는 문자열 정수로 계산한다.
 */
const DEC = /^(\d{1,3})(?:\.(\d{1,6}))?$/;
const SCALE = BigInt(1000000), ZERO = BigInt(0), TEN = BigInt(10), TWO = BigInt(2), HUNDRED = BigInt(100);

function micro(s: string | null | undefined): bigint | null {
  const m = typeof s === "string" ? DEC.exec(s.trim()) : null;
  if (!m) return null;
  return BigInt(m[1]) * SCALE + BigInt((m[2] ?? "").padEnd(6, "0"));
}
/** 소수 첫째 자리(둘째 자리에서 반올림) */
function round1(v: bigint): string {
  const tenth = (v * TEN + SCALE / TWO) / SCALE;
  return `${tenth / TEN}.${tenth % TEN}`;
}

export interface CutoffLine {
  metric: string;
  cutoff: string; // 소수 첫째 자리
  /** 내 누적 백분위와의 차이 문장. 내 값이 없으면 null */
  gap: string | null;
  side: "above" | "below" | "same" | null;
}

/** 합격선 하나와 내 누적 백분위(같은 기준)를 견준 줄 */
export function cutoffLine(c: YearCutoffDto, mine: string | null): CutoffLine | null {
  const cut = micro(c.cutoff_top_percent);
  if (cut === null || cut > HUNDRED * SCALE) return null;
  const me = micro(mine);
  if (me === null) return { metric: c.published_metric, cutoff: round1(cut), gap: null, side: null };
  const d = cut - me;
  const diff = round1(d < ZERO ? -d : d);
  if (diff === "0.0") return { metric: c.published_metric, cutoff: round1(cut), gap: "합격선과 같은 위치", side: "same" };
  return d > ZERO
    ? { metric: c.published_metric, cutoff: round1(cut), gap: `내가 ${diff}%p 위`, side: "above" }
    : { metric: c.published_metric, cutoff: round1(cut), gap: `내가 ${diff}%p 아래`, side: "below" };
}

/** 학년도별 합격선 줄(최신 학년도부터). 자료가 없으면 빈 배열 */
export function yearCutoffLines(a: AssessmentDto): { year: number; lines: CutoffLine[] }[] {
  const r = a.reference_percentile;
  const mine = r && r.status === "reference_estimated" ? r.estimated_upper_cumulative_percent_all_examinees : null;
  const by = new Map<number, CutoffLine[]>();
  for (const c of a.year_cutoffs ?? []) {
    const line = cutoffLine(c, mine);
    if (!line) continue;
    by.set(c.academic_year, [...(by.get(c.academic_year) ?? []), line]);
  }
  return [...by.entries()].sort((x, y) => y[0] - x[0]).map(([year, lines]) => ({ year, lines }));
}
