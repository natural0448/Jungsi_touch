import type { OfferingDto, OverallResultDto, ReferencePercentileDto, ReferenceUniversityGroupDto, WildcardGroup } from "./dto";
import { groupByField } from "./field-group";
import { referenceAdvantage, type ReferenceAdvantage } from "./reference-advantage";

/*
  3번째 화면(유리한 대학 찾기)의 참고 목록(대표님 결정 2026-11-19 낮).
  판정이 켜진 대학이 없는 동안: 참고 누백이 나온 대학을 대학 → 계열 → 학과로 묶어 보이고,
  학과마다 참고 유불리(전체 위치 − 이 대학 방식 위치) 요약과 즐겨찾기만 둔다. 판정·순위·담기는 만들지 않는다.
  대학은 가장 유리한 학과의 유불리가 큰 순서, 계열 안 학과도 유불리 큰 순서. 유불리를 계산하지 못한 곳은 뒤로 간다.
  와일드카드도 서버 판정이 없는 동안은 같은 참고 목록에서 간호·보건·교육 계열을 유불리 큰 순서로 고른다.
*/
export interface ReferenceItem {
  offering: OfferingDto;
  reference_percentile: ReferencePercentileDto | null;
  advantage: ReferenceAdvantage | null;
}
export interface ReferenceField { label: string; provisional: boolean; items: ReferenceItem[]; best: ReferenceAdvantage | null }
export interface ReferenceUniversity { university_id: string; university_name: string; region: string | null; count: number; best: ReferenceAdvantage | null; fields: ReferenceField[] }

const mid = (a: ReferenceAdvantage | null) => (a ? a.mid : -Infinity);
const byAdvantage = (a: ReferenceItem, b: ReferenceItem) => mid(b.advantage) - mid(a.advantage);
const bestOf = (items: ReferenceItem[]) => items.reduce<ReferenceAdvantage | null>((m, x) => (mid(x.advantage) > mid(m) ? x.advantage : m), null);

export function referenceUniversities(groups: ReferenceUniversityGroupDto[], overall: OverallResultDto | null | undefined): ReferenceUniversity[] {
  return groups
    .map((g) => {
      const items = g.offerings.map((it) => ({ ...it, advantage: referenceAdvantage(it.reference_percentile, overall) })).sort(byAdvantage);
      const fields = groupByField(items, (x) => x.offering.offering_id).map((f) => ({ ...f, best: bestOf(f.items) }));
      return { university_id: g.university_id, university_name: g.university_name, region: items[0]?.offering.region ?? null, count: items.length, best: bestOf(items), fields };
    })
    .filter((u) => u.count > 0)
    // 같은 값이면 서버 순서를 지킨다(sort 는 안정 정렬)
    .sort((a, b) => mid(b.best) - mid(a.best));
}

export const REFERENCE_WILDCARD_GROUPS: WildcardGroup[] = ["nursing", "health", "education"];
export const REFERENCE_WILDCARD_FEATURED = 3;
export const REFERENCE_WILDCARD_MAX = 12;

/** 참고 목록에서 고른 와일드카드: 간호·보건·교육 계열, 유불리 큰 순서, 최대 12장(앞 3장 펼침) */
export function referenceWildcards(groups: ReferenceUniversityGroupDto[], overall: OverallResultDto | null | undefined): { featured: ReferenceItem[]; rest: ReferenceItem[] } {
  const all = groups
    .flatMap((g) => g.offerings)
    .filter((it) => it.offering.wildcard_group !== null && REFERENCE_WILDCARD_GROUPS.includes(it.offering.wildcard_group))
    .map((it) => ({ ...it, advantage: referenceAdvantage(it.reference_percentile, overall) }))
    .sort(byAdvantage)
    .slice(0, REFERENCE_WILDCARD_MAX);
  return { featured: all.slice(0, REFERENCE_WILDCARD_FEATURED), rest: all.slice(REFERENCE_WILDCARD_FEATURED) };
}
