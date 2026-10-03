import type { CatalogSearchDto, HistoryMetricDto, HistorySearchQuery, ProfileDto, RecruitmentDto, ReportDto, ScoresInput, SnapshotDto } from "@/lib/dto";
import type { AnalysisResult, CandidatesResult, OfferingSearchParams, OfferingSearchResult, OfferingStatistics, Session, ShortlistItem } from "@/lib/contract";

/** 로그인한 사람의 신원. 화면 서버는 access token 을 우리 서비스 API 에 전달만 한다 */
export interface Caller {
  accessToken: string | null;
}

/** 쓰기 요청 결과. 실패는 서버 오류 코드(invalid_request·engine_input_code·revision_conflict 등) */
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; status: number };

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
  /** history.search (일반·유료). 대학 발표 지표 한 줄씩 */
  searchHistory(caller: Caller, query: HistorySearchQuery): Promise<CatalogSearchDto<HistoryMetricDto>>;
  /** recruitment.read (일반·유료). 없는 모집행이면 null */
  readRecruitment(caller: Caller, offeringId: string): Promise<RecruitmentDto | null>;
  /** score-profile.create (일반·유료). 새 프로필. 검증 실패는 서버 오류 코드 */
  createScoreProfile(caller: Caller, scores: ScoresInput, confirmed: boolean, idempotencyKey: string): Promise<Result<ProfileDto>>;
  /** overall.analyze (일반·유료). report_id 가 있으면 그 리포트의 새 revision */
  analyzeOverall(caller: Caller, body: { profile_id: string; report_id?: string; expected_version?: number }, idempotencyKey: string): Promise<Result<ReportDto>>;
  /** report.read (본인). 없거나 남의 리포트면 null(서버는 같은 404) */
  readReport(caller: Caller, reportId: string): Promise<ReportDto | null>;
  /** report.export (유료·본인·확인 성적). 일반 회원이면 AccessDenied(403) */
  exportReport(caller: Caller, reportId: string): Promise<SnapshotDto | null>;
  /** session.read. 비회원이면 null */
  getSession(caller: Caller): Promise<Session | null>;
  /** offerings.search (유료). 일반 회원이면 AccessDenied(403) */
  searchOfferings(caller: Caller, params: OfferingSearchParams): Promise<OfferingSearchResult>;
  /** university.analyze (유료·본인). 확인된 성적이 없으면 score_required */
  analyze(caller: Caller, offeringIds: string[]): Promise<AnalysisResult>;
  /** candidates.build (유료·본인). 기본 학교 목록과 와일드카드. 확인된 성적이 없으면 score_required */
  buildCandidates(caller: Caller): Promise<CandidatesResult>;
  /** statistics.read (유료·본인). 모집단위마다 따로 부른다 */
  getStatistics(caller: Caller, offeringIds: string[]): Promise<OfferingStatistics[]>;
  /** 핵심 지원 학교(3·4페이지가 같이 쓰는 목록) */
  listShortlist(caller: Caller): Promise<ShortlistItem[]>;
  /** shortlist.update */
  setShortlist(caller: Caller, offeringId: string, selected: boolean): Promise<void>;
}
