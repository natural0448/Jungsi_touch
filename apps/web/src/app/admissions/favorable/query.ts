import type { Category } from "@/lib/dto";

export const PATH = "/admissions/favorable";

/**
 * 학교를 거르는 기준. candidates DTO 에는 학교 분류(도전학교·핵심학교·여유 후보)가 없어서
 * '그 판단을 받은 학과가 있는 학교'로 거른다. 학교 분류를 학과에 복사하지 않는 원칙(REQ-05)은 그대로다.
 */
export const FILTERS: { v: Extract<Category, "challenge" | "core" | "room">; label: string }[] = [
  { v: "challenge", label: "도전 학과가 있는 학교" },
  { v: "core", label: "핵심 검토 학과가 있는 학교" },
  { v: "room", label: "여유 후보 학과가 있는 학교" },
];
export type Filter = (typeof FILTERS)[number]["v"];

export interface Query {
  has?: Filter;
  open?: string; // 펼친 학교 university_id
  field?: string; // 펼친 학교 안에서 열어 둔 계열(계열 이름 또는 '기타')
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 128) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const h = one(sp.has);
  return { has: FILTERS.some((x) => x.v === h) ? (h as Filter) : undefined, open: one(sp.open), field: one(sp.field) };
}

export function hrefWith(cur: Query, patch: Partial<Query>) {
  const next = { ...cur, ...patch };
  const u = new URLSearchParams();
  if (next.has) u.set("has", next.has);
  if (next.open) u.set("open", next.open);
  if (next.open && next.field) u.set("field", next.field);
  const s = u.toString();
  return s ? `${PATH}?${s}` : PATH;
}
