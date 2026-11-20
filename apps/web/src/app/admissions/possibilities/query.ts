import type { Caller, JungsiSource, OfferingSearchQuery } from "@/lib/api";
import type { CatalogSearchDto, OfferingDto } from "@/lib/dto";

export const GROUPS = ["가", "나", "다"];
export const PATH = "/admissions/possibilities";
/** 3페이지는 올해(2027) 모집행만 본다. 지난 입시결과는 1페이지에서 */
export const YEAR = 2027;
export const LIMIT = 30;

export interface CatalogDestination {
  path: string;
  catalogView: boolean;
}

export interface Query {
  university_q?: string;
  department_q?: string;
  region?: string;
  group?: string;
  cursor?: string; // offerings.search 의 next_cursor. 서버가 정한 불투명한 값
  open?: string; // 펼친 offering_id
  fav?: boolean; // 즐겨찾기(별표)한 모집단위만 보기
}

const one = (v: string | string[] | undefined, max = 40) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, max) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const group = one(sp.group);
  return {
    university_q: one(sp.university),
    department_q: one(sp.unit),
    region: one(sp.region),
    group: group && GROUPS.includes(group) ? group : undefined,
    // 서버 커서는 200자를 넘는다(10-26 운영: 200자에서 잘려 다음 쪽이 400 invalid_cursor). 서버 상한 4096자까지 그대로 보낸다
    cursor: one(sp.cursor, 4096),
    open: one(sp.open, 128),
    fav: one(sp.fav) === "1" ? true : undefined,
  };
}

export function toSearch(q: Query): OfferingSearchQuery {
  return { academic_year: YEAR, university_q: q.university_q, department_q: q.department_q, region: q.region, group: q.group, cursor: q.cursor, limit: LIMIT };
}

/** Keep a continuation when the operation's bounded scan finds only empty pages. */
const EMPTY_PAGE_HOPS = 5;

export async function skipEmptyPages(src: JungsiSource, caller: Caller, q: OfferingSearchQuery): Promise<CatalogSearchDto<OfferingDto>> {
  let page = await src.searchOfferings(caller, q);
  for (let hop = 0; hop < EMPTY_PAGE_HOPS && (page.items ?? []).length === 0 && page.next_cursor; hop++) {
    page = await src.searchOfferings(caller, { ...q, cursor: page.next_cursor });
  }
  return page;
}

/**
 * 펼친 줄(open)을 뺀 주소 조건(정렬). 목록이 새로 계산되는지 가르는 열쇠 — 3·4페이지 본문 Suspense 의 key 로 쓴다
 * (같으면 펼치기만 바뀐 것이라 옛 화면을 두고, 다르면 책 넘김 대기 화면을 다시 보인다, 2026-11-21)
 */
export function listKey(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "open" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  q.sort();
  return q.toString();
}

/** 지금 조건에서 일부만 바꾼 주소. undefined 는 지운다. 검색 조건이 바뀌면 처음 쪽으로 */
export function hrefWith(cur: Query, patch: Partial<Query>, destination: CatalogDestination = { path: PATH, catalogView: false }) {
  const next = { ...cur, ...patch };
  if (!("cursor" in patch) && ("university_q" in patch || "department_q" in patch || "region" in patch || "group" in patch || "fav" in patch)) next.cursor = undefined;
  const u = new URLSearchParams();
  if (destination.catalogView) u.set("view", "catalog");
  const names = { university_q: "university", department_q: "unit", region: "region", group: "group", cursor: "cursor", open: "open" } as const;
  for (const k of Object.keys(names) as (keyof typeof names)[]) {
    const v = next[k];
    if (v) u.set(names[k], v);
  }
  if (next.fav) u.set("fav", "1");
  const s = u.toString();
  return s ? `${destination.path}?${s}` : destination.path;
}
