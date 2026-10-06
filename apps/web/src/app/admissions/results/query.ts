import { ACADEMIC_YEARS, type AcademicYear } from "@/lib/dto";

export const PATH = "/admissions/results";
export const GROUPS = ["가", "나", "다"] as const;
export { REGIONS } from "@/lib/regions";
/**
 * 처음 열 때 보여 줄 학년도. 2027 모집행은 아직 결과가 발표되지 않아(값 null)
 * 결과가 있는 가장 최근 학년도부터 보인다. 1페이지의 실제 조회 네 학년도는 기획에서 확정한다(서비스 기획 1페이지 안내).
 */
export const DEFAULT_YEAR: AcademicYear = 2026;

export interface Query {
  year: AcademicYear;
  university?: string;
  unit?: string;
  region?: string;
  group?: string;
  cursor?: string;
  open?: string;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 80) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const y = Number(one(sp.year));
  const g = one(sp.group);
  return {
    year: ACADEMIC_YEARS.includes(y as AcademicYear) ? (y as AcademicYear) : DEFAULT_YEAR,
    university: one(sp.university)?.slice(0, 40),
    unit: one(sp.unit)?.slice(0, 40),
    region: one(sp.region)?.slice(0, 20),
    group: GROUPS.includes(g as (typeof GROUPS)[number]) ? g : undefined,
    cursor: one(sp.cursor),
    open: one(sp.open),
  };
}

/** 지금 조건에서 일부만 바꾼 주소. 조건이 바뀌면 커서를 버린다(커서는 조건에 묶여 있다) */
export function hrefWith(cur: Query, patch: Partial<Query>) {
  const next = { ...cur, ...patch };
  const conditionChanged = ["year", "university", "unit", "region", "group"].some((k) => k in patch);
  if (conditionChanged && !("cursor" in patch)) next.cursor = undefined;
  const u = new URLSearchParams();
  if (next.year !== DEFAULT_YEAR) u.set("year", String(next.year));
  for (const k of ["university", "unit", "region", "group", "cursor", "open"] as const) {
    const v = next[k];
    if (v) u.set(k, v);
  }
  const s = u.toString();
  return s ? `${PATH}?${s}` : PATH;
}
