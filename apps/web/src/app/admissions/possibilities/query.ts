import type { OfferingSearchQuery } from "@/lib/api";

export const GROUPS = ["가", "나", "다"];
export const PATH = "/admissions/possibilities";
/** 3페이지는 올해(2027) 모집행만 본다. 지난 입시결과는 1페이지에서 */
export const YEAR = 2027;
export const LIMIT = 30;

export interface Query {
  university_q?: string;
  department_q?: string;
  region?: string;
  group?: string;
  cursor?: string; // offerings.search 의 next_cursor. 서버가 정한 불투명한 값
  open?: string; // 펼친 offering_id
}

const one = (v: string | string[] | undefined, max = 40) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, max) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const group = one(sp.group);
  return {
    university_q: one(sp.university),
    department_q: one(sp.unit),
    region: one(sp.region),
    group: group && GROUPS.includes(group) ? group : undefined,
    cursor: one(sp.cursor, 200),
    open: one(sp.open, 128),
  };
}

export function toSearch(q: Query): OfferingSearchQuery {
  return { academic_year: YEAR, university_q: q.university_q, department_q: q.department_q, region: q.region, group: q.group, cursor: q.cursor, limit: LIMIT };
}

/** 지금 조건에서 일부만 바꾼 주소. undefined 는 지운다. 검색 조건이 바뀌면 처음 쪽으로 */
export function hrefWith(cur: Query, patch: Partial<Query>) {
  const next = { ...cur, ...patch };
  if (!("cursor" in patch) && ("university_q" in patch || "department_q" in patch || "region" in patch || "group" in patch)) next.cursor = undefined;
  const u = new URLSearchParams();
  const names = { university_q: "university", department_q: "unit", region: "region", group: "group", cursor: "cursor", open: "open" } as const;
  for (const k of Object.keys(names) as (keyof typeof names)[]) {
    const v = next[k];
    if (v) u.set(names[k], v);
  }
  const s = u.toString();
  return s ? `${PATH}?${s}` : PATH;
}
