import type { AssessmentDto, YearCutoffDto } from "./dto";

/**
 * 연도별 근거(대표님 결정 2026-11-15): 지난 학년도 합격선의 누적 백분위와 내 누적 백분위를 견준다.
 * 둘 다 '전체 응시자 중 위에서 몇 %'라서 해가 달라도 같은 기준이다. 숫자는 문자열 정수로 계산한다.
 */
// 내 누적 백분위는 서버가 정확한 소수(6자리 넘음)로 보낸다. 6자리까지 반올림해 견준다(11-16 운영: 6자리 초과를 버려 '내 누적 백분위 없음'으로 나옴)
const DEC = /^(\d{1,3})(?:\.(\d+))?$/;
const SCALE = BigInt(1000000), ZERO = BigInt(0), TEN = BigInt(10), TWO = BigInt(2), HUNDRED = BigInt(100);

function micro(s: string | null | undefined): bigint | null {
  const m = typeof s === "string" ? DEC.exec(s.trim()) : null;
  if (!m) return null;
  const frac = m[2] ?? "";
  const up = frac.length > 6 && frac[6] >= "5" ? BigInt(1) : ZERO;
  return BigInt(m[1]) * SCALE + BigInt(frac.slice(0, 6).padEnd(6, "0")) + up;
}
/** 소수 첫째 자리(둘째 자리에서 반올림) */
function round1(v: bigint): string {
  const tenth = (v * TEN + SCALE / TWO) / SCALE;
  return `${tenth / TEN}.${tenth % TEN}`;
}

const COMPONENT: Record<string, string> = { csat_converted: "수능 환산점수", selection_total: "전형 총점" };
/** 평균은 점수 성분이 있으면 '수능 환산점수 평균'·'전형 총점 평균'으로 나눠 부른다(두 값을 합치지 않음) */
function metricName(c: YearCutoffDto): string {
  const part = c.score_component ? COMPONENT[c.score_component] : undefined;
  return part ? `${part} ${c.published_metric}` : c.published_metric;
}

export interface CutoffLine {
  metric: string;
  /** 전형 통합 발표면 '전형 통합 발표', 아니면 null */
  scope: string | null;
  cutoff: string; // 소수 첫째 자리
  /** 내 누적 백분위와의 차이 문장. 내 값이 없으면 null */
  gap: string | null;
  side: "above" | "below" | "same" | null;
}

/**
 * 합격선 하나와 내 누적 백분위(같은 기준)를 견준 줄.
 * 내 값이 범위(하한~상한, 대표님 결정 2026-11-16)면 차이도 범위로 보인다. 범위가 합격선에 걸치면 '비슷한 위치'.
 */
export function cutoffLine(c: YearCutoffDto, mine: string | null, mineUpper: string | null = null): CutoffLine | null {
  const cut = micro(c.cutoff_top_percent);
  if (cut === null || cut > HUNDRED * SCALE) return null;
  const me = micro(mine);
  const base = { metric: metricName(c), scope: c.published_scope === "combined_tracks" ? "전형 통합 발표" : null, cutoff: round1(cut) };
  if (me === null) return { ...base, gap: null, side: null };
  const up = micro(mineUpper);
  const hi = up !== null && up > me ? up : me;
  // 차이 = 합격선 - 내 값. 내 값이 클수록(아래쪽) 차이가 작다
  const far = cut - me, near = cut - hi;
  const abs = (v: bigint) => (v < ZERO ? -v : v);
  if (near > ZERO || far < ZERO) {
    const above = near > ZERO;
    const a = round1(above ? near : abs(far)), b = round1(above ? far : abs(near));
    if (a === "0.0" && b === "0.0") return { ...base, gap: "합격선과 같은 위치", side: "same" };
    const text = a === b ? a : `${a}~${b}`;
    return { ...base, gap: `내가 ${text}%p ${above ? "위" : "아래"}`, side: above ? "above" : "below" };
  }
  if (hi === me) return { ...base, gap: "합격선과 같은 위치", side: "same" };
  return { ...base, gap: `합격선과 비슷한 위치(내 범위가 걸침)`, side: "same" };
}

/** 학년도별 합격선 줄(최신 학년도부터). 자료가 없으면 빈 배열 */
export function yearCutoffLines(a: AssessmentDto): { year: number; lines: CutoffLine[] }[] {
  const r = a.reference_percentile;
  const mine = r && r.status === "reference_estimated" ? r.estimated_upper_cumulative_percent_all_examinees : null;
  const mineUpper = r && r.status === "reference_estimated" ? r.estimated_upper_cumulative_percent_upper_bound ?? null : null;
  const by = new Map<number, CutoffLine[]>();
  // 같은 발표가 관측 두 개로 들어온 경우(학년도·지표·값이 모두 같음) 한 줄만 보인다(2026-11-16)
  const seen = new Set<string>();
  for (const c of a.year_cutoffs ?? []) {
    const line = cutoffLine(c, mine, mineUpper);
    if (!line) continue;
    const key = `${c.academic_year}|${line.metric}|${line.scope ?? ""}|${c.cutoff_top_percent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    by.set(c.academic_year, [...(by.get(c.academic_year) ?? []), line]);
  }
  return [...by.entries()].sort((x, y) => y[0] - x[0]).map(([year, lines]) => ({ year, lines }));
}
