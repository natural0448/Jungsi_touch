import type { Group, OfferingSearchParams } from "@/lib/contract";

export const GROUPS: Group[] = ["가", "나", "다"];
export const PATH = "/admissions/possibilities";

export interface Query extends OfferingSearchParams {
  open?: string;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 40) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const group = one(sp.group);
  const page = Number(one(sp.page));
  return {
    university: one(sp.university),
    unit: one(sp.unit),
    region: one(sp.region),
    group: GROUPS.includes(group as Group) ? (group as Group) : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    open: one(sp.open),
  };
}

/** 지금 조건에서 일부만 바꾼 주소. undefined 는 지운다 */
export function hrefWith(cur: Query, patch: Partial<Query>) {
  const next = { ...cur, ...patch };
  if (!("page" in patch) && ("university" in patch || "unit" in patch || "region" in patch || "group" in patch)) next.page = undefined;
  const u = new URLSearchParams();
  for (const k of ["university", "unit", "region", "group", "page", "open"] as const) {
    const v = next[k];
    if (v !== undefined && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `${PATH}?${s}` : PATH;
}
