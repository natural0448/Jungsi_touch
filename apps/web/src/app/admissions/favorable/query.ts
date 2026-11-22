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
  past?: boolean; // 9월 모의평가 기준으로 보기(지난 기록, 읽기 전용, 2026-11-22 대표님 결정)
  report?: string; // past 일 때 연 9월 리포트(목록에 있는 것만 연다)
}

/** 리포트 id 로 받을 수 있는 모양(2페이지 지난 기록과 같은 규칙) */
const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 128) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const h = one(sp.has);
  const past = one(sp.past) === "1";
  const r = one(sp.report);
  return {
    has: FILTERS.some((x) => x.v === h) ? (h as Filter) : undefined,
    open: one(sp.open),
    field: one(sp.field),
    past: past || undefined,
    report: past && r && REPORT_ID.test(r) ? r : undefined,
  };
}

export function hrefWith(cur: Query, patch: Partial<Query>) {
  const next = { ...cur, ...patch };
  const u = new URLSearchParams();
  // 9월 기준 보기에서는 거르기·펼치기를 눌러도 9월 기준에 머문다(past·report 를 늘 앞에 둔다)
  if (next.past) {
    u.set("past", "1");
    if (next.report) u.set("report", next.report);
  }
  if (next.has) u.set("has", next.has);
  if (next.open) u.set("open", next.open);
  if (next.open && next.field) u.set("field", next.field);
  const s = u.toString();
  return s ? `${PATH}?${s}` : PATH;
}

/** 3페이지 9월 모의평가 기준 보기 주소. reportId 가 없으면 서버가 마지막 9월 리포트를 고른다 */
export const pastFavorableHref = (reportId?: string) => hrefWith({ past: true, report: reportId }, {});
