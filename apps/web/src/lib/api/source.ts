import type { AnalysisResult, OfferingSearchParams, OfferingSearchResult, Session, ShortlistItem } from "@/lib/contract";

/** 로그인한 사람의 신원. 화면 서버는 access token 을 우리 서비스 API 에 전달만 한다 */
export interface Caller {
  accessToken: string | null;
}

/** 서버가 401·403 으로 막았을 때. 화면은 결과·건수를 그리지 않고 안내만 보인다 */
export class AccessDenied extends Error {
  constructor(public status: 401 | 403, public code: string) {
    super(`${status} ${code}`);
  }
}

/**
 * 화면이 데이터를 얻는 유일한 창구.
 * 합성(synthetic)과 실제(live)가 같은 모양을 돌려주므로 화면은 어느 쪽인지 모른다.
 * 권한 판단은 서버가 한다. 화면의 잠금 표시는 안내일 뿐이다.
 */
export interface JungsiSource {
  readonly kind: "synthetic" | "live";
  /** session.read. 비회원이면 null */
  getSession(caller: Caller): Promise<Session | null>;
  /** offerings.search (유료). 일반 회원이면 AccessDenied(403) */
  searchOfferings(caller: Caller, params: OfferingSearchParams): Promise<OfferingSearchResult>;
  /** university.analyze (유료·본인). 확인된 성적이 없으면 score_required */
  analyze(caller: Caller, offeringIds: string[]): Promise<AnalysisResult>;
  /** 핵심 지원 학교(3·4페이지가 같이 쓰는 목록) */
  listShortlist(caller: Caller): Promise<ShortlistItem[]>;
  /** shortlist.update */
  setShortlist(caller: Caller, offeringId: string, selected: boolean): Promise<void>;
}
