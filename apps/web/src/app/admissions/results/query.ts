export const PATH = "/admissions/results";
export const GROUPS = ["가", "나", "다"] as const;
export { REGIONS } from "@/lib/regions";

/** 1페이지 검색 조건. 학년도는 더 받지 않는다(2024~2026 결과 + 2027 모집을 한 화면에 보인다. 옛 ?year 링크는 무시) */
export interface Query {
  university?: string;
  unit?: string;
  region?: string;
  group?: string;
  /** 대학 20곳 단위 쪽 번호(1부터) */
  page?: string;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 80) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const g = one(sp.group);
  return {
    university: one(sp.university)?.slice(0, 40),
    unit: one(sp.unit)?.slice(0, 40),
    region: one(sp.region)?.slice(0, 20),
    group: GROUPS.includes(g as (typeof GROUPS)[number]) ? g : undefined,
    page: /^[1-9]\d{0,3}$/.test(one(sp.page) ?? "") ? one(sp.page) : undefined,
  };
}

/** 지금 조건에서 일부만 바꾼 주소. 조건이 바뀌면 첫 쪽으로 돌아간다 */
export function hrefWith(cur: Query, patch: Partial<Query>) {
  const next = { ...cur, ...patch };
  const conditionChanged = ["university", "unit", "region", "group"].some((k) => k in patch);
  if (conditionChanged && !("page" in patch)) next.page = undefined;
  const u = new URLSearchParams();
  for (const k of ["university", "unit", "region", "group", "page"] as const) {
    const v = next[k];
    if (v) u.set(k, v);
  }
  const s = u.toString();
  return s ? `${PATH}?${s}` : PATH;
}
