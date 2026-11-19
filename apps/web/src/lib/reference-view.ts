import type { AssessmentDto, OfferingDto, OverallResultDto, ReferencePercentileDto, ReferenceUniversityGroupDto, WildcardGroup, YearCutoffDto } from "./dto";
import { fieldGroupOf, groupByField } from "./field-group";
import { referenceAdvantage, type ReferenceAdvantage } from "./reference-advantage";

/*
  3번째 화면(유리한 대학 찾기)의 참고 목록(대표님 결정 2026-11-19 낮·저녁).
  판정이 켜진 대학이 없는 동안: 참고 누백이 나온 학과 가운데 **지난해 합격선(70%컷, 없으면 50%컷)에 내 위치가 닿는 곳만**
  대학 → 계열 → 학과로 보인다. 합격선보다 확실히 아래인 곳과 합격선 자료가 없는 곳은 넣지 않고 숫자만 알린다.
  순서는 합격선과의 여유(내 범위의 불리한 끝 기준)가 큰 순서. 참고 유불리는 보조로 함께 보인다.
  와일드카드도 같은 목록에서 간호·보건·교육 계열을 여유 큰 순서로 최대 4장(앞 3장, 한 장 더 보기).
  판정·순위·담기는 만들지 않는다.
*/
const DEC = /^(\d{1,3})(?:\.(\d+))?$/;
const micro = (s: string | null | undefined): number | null => {
  const m = typeof s === "string" ? DEC.exec(s.trim()) : null;
  if (!m) return null;
  return Number(m[1]) * 1e6 + Number((m[2] ?? "").slice(0, 6).padEnd(6, "0"));
};
const r1 = (v: number) => (Math.round(Math.abs(v) / 1e5) / 10).toFixed(1);

export interface CutoffMargin {
  year: number;
  metric: "70%컷" | "50%컷";
  /** above: 내 범위 전체가 합격선 위, near: 범위가 합격선에 걸침, below: 전체가 아래 */
  side: "above" | "near" | "below";
  /** 예: "2025 70%컷보다 7.2~10.7%p 위" */
  text: string;
  /** 정렬용: 불리한 끝 기준 여유(%p, 위면 +) */
  worst: number;
}

/** 가장 최근 학년도의 70%컷(없으면 50%컷) 합격선과 내 참고 누백을 견준다. 자료가 없으면 null */
export function cutoffMargin(cutoffs: YearCutoffDto[] | null | undefined, p: ReferencePercentileDto | null | undefined): CutoffMargin | null {
  if (!p || p.status !== "reference_estimated") return null;
  const lo = micro(p.estimated_upper_cumulative_percent_all_examinees);
  if (lo === null) return null;
  const upRaw = micro(p.estimated_upper_cumulative_percent_upper_bound ?? null);
  const hi = upRaw !== null && upRaw > lo ? upRaw : lo;
  const years = [...new Set((cutoffs ?? []).map((c) => c.academic_year))].sort((a, b) => b - a);
  for (const y of years) {
    for (const metric of ["70%컷", "50%컷"] as const) {
      const c = (cutoffs ?? []).find((x) => x.academic_year === y && !x.score_component && x.published_metric.replace(/\s+/g, "").endsWith(metric));
      const cut = c ? micro(c.cutoff_top_percent) : null;
      if (cut === null) continue;
      // 위에서 몇 %: 숫자가 작을수록 위. 여유 = 합격선 − 내 값
      const best = cut - lo, worst = cut - hi;
      const label = `${y} ${metric}`;
      if (worst > 0) {
        const t = r1(worst) === r1(best) ? r1(best) : `${r1(worst)}~${r1(best)}`;
        return { year: y, metric, side: "above", text: `${label}보다 ${t}%p 위`, worst: worst / 1e6 };
      }
      if (best < 0) {
        const t = r1(best) === r1(worst) ? r1(best) : `${r1(best)}~${r1(worst)}`;
        return { year: y, metric, side: "below", text: `${label}보다 ${t}%p 아래`, worst: worst / 1e6 };
      }
      return { year: y, metric, side: "near", text: `${label}과 비슷한 위치`, worst: worst / 1e6 };
    }
  }
  return null;
}

export interface ReferenceItem {
  offering: OfferingDto;
  reference_percentile: ReferencePercentileDto | null;
  advantage: ReferenceAdvantage | null;
  margin: CutoffMargin | null;
}
export interface ReferenceField { label: string; provisional: boolean; items: ReferenceItem[]; best: CutoffMargin | null }
export interface ReferenceUniversity { university_id: string; university_name: string; region: string | null; count: number; best: CutoffMargin | null; fields: ReferenceField[] }
export interface ReferencePool { items: ReferenceItem[]; below: number; noCutoff: number; ineligible: number }

const worstOf = (m: CutoffMargin | null) => (m ? m.worst : -Infinity);
const byMargin = (a: ReferenceItem, b: ReferenceItem) => worstOf(b.margin) - worstOf(a.margin);
const bestOf = (items: ReferenceItem[]) => items.reduce<CutoffMargin | null>((m, x) => (worstOf(x.margin) > worstOf(m) ? x.margin : m), null);

/** 참고 누백이 나온 학과 중 지난해 합격선에 닿는 곳(위·비슷)만 고른다. 빠진 곳은 숫자로 센다 */
export function referencePool(groups: ReferenceUniversityGroupDto[], overall: OverallResultDto | null | undefined, analyses: Record<string, AssessmentDto> | null | undefined): ReferencePool {
  let below = 0, noCutoff = 0, ineligible = 0;
  const items: ReferenceItem[] = [];
  for (const it of groups.flatMap((g) => g.offerings)) {
    // 지원 필수 조건이 확인된 모집단위에서 내가 조건을 못 채우면 넣지 않는다(지원 조건 미충족)
    if (analyses?.[it.offering.offering_id]?.status === "ineligible") { ineligible++; continue; }
    const margin = cutoffMargin(analyses?.[it.offering.offering_id]?.year_cutoffs, it.reference_percentile);
    if (!margin) { noCutoff++; continue; }
    if (margin.side === "below") { below++; continue; }
    items.push({ ...it, advantage: referenceAdvantage(it.reference_percentile, overall), margin });
  }
  return { items: items.sort(byMargin), below, noCutoff, ineligible };
}

export function referenceUniversities(pool: ReferencePool): ReferenceUniversity[] {
  const by = new Map<string, ReferenceItem[]>();
  for (const it of pool.items) by.set(it.offering.university_id, [...(by.get(it.offering.university_id) ?? []), it]);
  return [...by.entries()]
    .map(([id, items]) => {
      const fields = groupByField(items, (x) => x.offering.offering_id).map((f) => ({ ...f, items: [...f.items].sort(byMargin), best: bestOf(f.items) }));
      fields.sort((a, b) => worstOf(b.best) - worstOf(a.best));
      return { university_id: id, university_name: items[0].offering.university_name, region: items[0].offering.region ?? null, count: items.length, best: bestOf(items), fields };
    })
    .sort((a, b) => worstOf(b.best) - worstOf(a.best));
}

export const REFERENCE_WILDCARD_GROUPS: WildcardGroup[] = ["nursing", "health", "education"];
export const REFERENCE_WILDCARD_FEATURED = 3;
export const REFERENCE_WILDCARD_MAX = 4;

/**
 * 와일드카드 계열. 서버가 준 표시(wildcard_group)가 간호·보건·교육이면 그것을 쓰고, 운영 자료처럼 비었거나 다른 표기면
 * 계열과 학과 이름으로 가린다: 이름에 '간호' → 간호, 교육 계열·'○○교육과' → 교육,
 * 의약 계열(의예·치의예·한의예·약학·수의예 제외) → 보건.
 */
const MEDICAL = /의예|의학과|약학|수의/;
export function referenceWildcardGroup(o: OfferingDto): WildcardGroup | null {
  // 서버 값이 세 계열 가운데 하나일 때만 그대로 쓴다. 비었거나 다른 표기(운영 정본의 원문 표기 등)면 이름으로 가린다
  if (typeof o.wildcard_group === "string" && REFERENCE_WILDCARD_GROUPS.includes(o.wildcard_group)) return o.wildcard_group;
  const dept = o.department ?? "";
  const field = fieldGroupOf(o.offering_id)?.name ?? null;
  if (dept.includes("간호")) return "nursing";
  if (field === "교육" || /교육(과|학과|학부|전공)/.test(dept)) return "education";
  if (field === "의약" && !MEDICAL.test(dept)) return "health";
  return null;
}

/** 와일드카드: 같은 목록(합격선에 닿는 곳)의 간호·보건·교육 계열, 여유 큰 순서로 최대 4장(앞 3장, 한 장 더 보기) */
export function referenceWildcards(pool: ReferencePool): { featured: ReferenceItem[]; rest: ReferenceItem[] } {
  const all = pool.items
    .flatMap((it) => {
      const wg = referenceWildcardGroup(it.offering);
      return wg ? [{ ...it, offering: { ...it.offering, wildcard_group: wg } }] : [];
    })
    .slice(0, REFERENCE_WILDCARD_MAX);
  return { featured: all.slice(0, REFERENCE_WILDCARD_FEATURED), rest: all.slice(REFERENCE_WILDCARD_FEATURED) };
}
