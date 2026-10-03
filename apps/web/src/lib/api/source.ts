import type { Session } from "@/lib/contract";
import type {
  CatalogSearchDto,
  HistoryMetricDto,
  HistorySearchQuery,
  OfferingDetailDto,
  OfferingDto,
  ProfileDto,
  RecruitmentDto,
  ReportDto,
  ScoresInput,
  SnapshotDto,
  StatisticsDto,
} from "@/lib/dto";

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

/** offerings.search 쿼리 (history.search 와 같은 조건, 기본 정보만) */
export type OfferingSearchQuery = HistorySearchQuery;

/**
 * 화면이 데이터를 얻는 유일한 창구. 경로·모양은 develop 의 API_DTO 계약(lib/dto.ts)을 따른다.
 * 합성(synthetic)과 실제(live)가 같은 모양을 돌려주므로 화면은 어느 쪽인지 모른다.
 * 권한 판단은 서버가 한다. 화면의 잠금 표시는 안내일 뿐이다.
 * POST/PUT 은 Idempotency-Key 와(리포트 갱신이면) expected_version 을 함께 보낸다.
 */
export interface JungsiSource {
  readonly kind: "synthetic" | "live";
  /** session.read (제안, PR #5). 비회원이면 null */
  getSession(caller: Caller): Promise<Session | null>;

  /** history.search (일반·유료). 대학 발표 지표 한 줄씩 */
  searchHistory(caller: Caller, query: HistorySearchQuery): Promise<CatalogSearchDto<HistoryMetricDto>>;
  /** recruitment.read (일반·유료). 없는 모집행이면 null */
  readRecruitment(caller: Caller, offeringId: string): Promise<RecruitmentDto | null>;

  /** score-profile.create (일반·유료). 새 프로필. 검증 실패는 서버 오류 코드 */
  createScoreProfile(caller: Caller, scores: ScoresInput, confirmed: boolean, idempotencyKey: string): Promise<Result<ProfileDto>>;
  /** overall.analyze (일반·유료). report_id 가 있으면 그 리포트의 새 revision */
  analyzeOverall(caller: Caller, body: { profile_id: string; report_id?: string; expected_version?: number }, idempotencyKey: string): Promise<Result<ReportDto>>;
  /** report.read (본인). 없거나 남의 리포트면 null(서버는 같은 404). 일반 회원 응답에는 유료 필드가 없다 */
  readReport(caller: Caller, reportId: string): Promise<ReportDto | null>;
  /** report.export (유료·본인·확인 성적). 일반 회원이면 AccessDenied(403) */
  exportReport(caller: Caller, reportId: string): Promise<SnapshotDto | null>;

  /** offerings.search (유료). 서비스 카탈로그 전체의 모집행 기본 정보. 일반 회원이면 AccessDenied(403) */
  searchOfferings(caller: Caller, query: OfferingSearchQuery): Promise<CatalogSearchDto<OfferingDto>>;
  /** offering.read (유료). 검증된 카탈로그에 없는 번호면 null */
  readOffering(caller: Caller, offeringId: string): Promise<OfferingDetailDto | null>;
  /** university.analyze (유료·본인·확인 성적). report.analyses 를 갱신한 리포트 */
  analyzeUniversities(caller: Caller, reportId: string, expectedVersion: number, offeringIds: string[], idempotencyKey: string): Promise<Result<ReportDto>>;
  /** candidates.build (유료·본인·확인 성적). report.candidates 를 갱신한 리포트 */
  buildCandidates(caller: Caller, reportId: string, expectedVersion: number, idempotencyKey: string): Promise<Result<ReportDto>>;
  /** shortlist.update (유료·본인). report.shortlist 를 갱신한 리포트. 해제도 selected=false 로 남는다 */
  updateShortlist(caller: Caller, reportId: string, offeringId: string, selected: boolean, expectedVersion: number, idempotencyKey: string): Promise<Result<ReportDto>>;
  /** statistics.read (유료·본인·확인 성적). 모집단위마다 따로 부른다 */
  readStatistics(caller: Caller, reportId: string, offeringId: string): Promise<StatisticsDto | null>;
}
