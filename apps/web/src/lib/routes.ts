import catalog from "../../route_catalog.json";
import type { MemberTier, Session } from "./dto";

/*
  화면 경로·회원 범위는 생성된 경로 계약(apps/web/route_catalog.json)에서 읽는다.
  이 파일에 경로나 회원 등급을 따로 적지 않는다. 바뀌면 service_spec.json 에서 바뀐다.
*/

export interface PageRoute {
  id: string;
  number: number;
  label: string;
  path: string;
  member_tiers: MemberTier[];
}

/**
 * 소비자 화면의 표시 순서(대표님 결정 2026-11-15): '유리한 대학 찾기'(PAGE-04)가 성적대·유리한 성적 구성으로
 * 검토할 대학을 추천하고, '전체 대학·학과 가능성 보기'(PAGE-03)에서 학과마다 검토한다. 그래서 탭·화면 번호는
 * 이 순서로 매긴다. 화면 ID·주소·회원 범위는 경로 계약 그대로다(명세의 화면 번호 정리는 따로 한다).
 */
const DISPLAY_ORDER = ["PAGE-01", "PAGE-02", "PAGE-04", "PAGE-03"] as const;
const byId = new Map(catalog.pages.map((p) => [p.id, p]));
if (catalog.pages.length !== DISPLAY_ORDER.length || DISPLAY_ORDER.some((id) => !byId.has(id))) {
  throw new Error("경로 계약의 소비자 화면과 표시 순서가 다릅니다");
}
export const PAGES: PageRoute[] = DISPLAY_ORDER.map((id, i) => {
  const p = byId.get(id)!;
  return {
    id: p.id,
    number: i + 1,
    label: p.label,
    path: p.path,
    member_tiers: p.member_tiers as MemberTier[],
  };
});

export const ROOT_REDIRECT = catalog.redirects.find((r) => r.path === "/")?.target ?? "/admissions/results";

export function page(id: string): PageRoute {
  const p = PAGES.find((x) => x.id === id);
  if (!p) throw new Error(`경로 계약에 없는 화면: ${id}`);
  return p;
}

/** 화면 표시용 잠금. 실제 차단은 각 API 의 401·403 */
export type Lock = "login" | "paid" | null;
export function lockFor(session: Session | null, route: PageRoute): Lock {
  if (!session) return "login";
  return route.member_tiers.includes(session.member_tier) ? null : "paid";
}

/**
 * 관리 화면(management_pages · ADMIN-FORECAST). 소비자 4개 화면의 번호·탭에는 넣지 않는다.
 * 접근은 회원 등급이 아니라 서버의 관리 권한(forecast.capabilities)으로 정해진다.
 */
const admin = catalog.management_pages.find((p) => p.id === "ADMIN-FORECAST");
if (!admin) throw new Error("경로 계약에 없는 관리 화면: ADMIN-FORECAST");
export const MANAGEMENT_FORECASTS = { id: admin.id, label: admin.label, path: admin.path } as const;
