import type {
  CatalogSearchDto,
  ForecastAdjustInput,
  ForecastCapabilitiesDto,
  ForecastDraftDto,
  ForecastListDto,
  ForecastPublicDto,
  HistoryMetricDto,
  HistorySearchQuery,
  OfferingDetailDto,
  OfferingDto,
  OwnReportListDto,
  ProfileDto,
  RecruitmentDto,
  ReportDto,
  SampleReportDto,
  ScoreInputStatusDto,
  ScoresInput,
  Session,
  SnapshotDto,
  SnapshotHeadDto,
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

/**
 * 우리 서비스 API 에 닿지 못했거나 서버가 요청을 잠시 제한했을 때.
 * 결과를 지어내지 않고 안내만 보인다(DEV-006 mode_rules, SEC-07).
 * - unconfigured: 연결 방식(JUNGSI_API_MODE)·API 주소·로그인 설정이 없다
 * - unavailable: 서버가 503 을 돌려주었거나 연결이 끊겼다(인증·저장소·자료 미준비 포함)
 * - rate_limited: 서버가 429 로 제한했다(rate_limit_exceeded·analysis_quota_exceeded 등).
 *   retryAt 이 있으면 재시도 시각만 안내한다. 제한을 성공이나 영구 차단으로 보이지 않는다.
 * 일반 회원이나 합성 응답으로 바꿔 보이지 않는다.
 */
export class ConnectionError extends Error {
  constructor(public kind: "unconfigured" | "unavailable" | "rate_limited", public code: string, public retryAt: Date | null = null) {
    super(`${kind} ${code}`);
  }
}

/** 정리본 현재판이 바뀌었다(409 publication_changed). 받던 판을 버리고 처음부터 다시 준비한다 */
export class SnapshotChanged extends Error {
  constructor() {
    super("publication_changed");
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
  /** history.snapshot.head (일반·유료). 1페이지 전국 정리본의 현재 발행판 머리 */
  readSnapshotHead(caller: Caller): Promise<SnapshotHeadDto>;
  /** history.snapshot.read (일반·유료). manifest 에 열거된 분할 하나의 받은 bytes 그대로(검증은 호출한 쪽). 판이 바뀌었으면 SnapshotChanged */
  readSnapshotPart(caller: Caller, snapshotId: string, partId: string): Promise<Uint8Array>;
  /** recruitment.read (일반·유료). 없는 모집행이면 null */
  readRecruitment(caller: Caller, offeringId: string): Promise<RecruitmentDto | null>;

  /** score-profile.create (일반·유료). 새 프로필. 검증 실패는 서버 오류 코드 */
  createScoreProfile(caller: Caller, scores: ScoresInput, confirmed: boolean, idempotencyKey: string): Promise<Result<ProfileDto>>;
  /** overall.analyze (일반·유료). report_id 가 있으면 그 리포트의 새 revision */
  analyzeOverall(caller: Caller, body: { profile_id: string; report_id?: string; expected_version?: number }, idempotencyKey: string): Promise<Result<ReportDto>>;
  /** report.read (본인). 없거나 남의 리포트면 null(서버는 같은 404). 일반 회원 응답에는 유료 필드가 없다 */
  readReport(caller: Caller, reportId: string): Promise<ReportDto | null>;
  /** report.list-own (일반·유료). 현재 로그인한 본인 리포트 요약만. cursor 는 받은 그대로 되돌려 준다 */
  listOwnReports(caller: Caller, q: { exam_id?: string; cursor?: string; limit?: number }): Promise<OwnReportListDto>;
  /** score-input.status.read (일반·유료). 이 시험·단계의 입력권 상태 */
  readScoreInputStatus(caller: Caller, examId: string, stage?: string): Promise<ScoreInputStatusDto>;
  /** score-input.correction.grant (고객센터·관리자 aal2). 접수 번호·대상·기대 판으로 정정권 1회 */
  grantScoreCorrection(caller: Caller, body: { subject_id: string; exam_id: string; stage: string; ticket_ref: string; expected_version: number }, key: string): Promise<Result<ScoreInputStatusDto>>;
  /** report.sample.read (일반·유료). 가상 학생 견본 리포트 */
  readReportSample(caller: Caller): Promise<SampleReportDto>;
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

  /** forecast.capabilities. 관리 권한(editor·approver)과 허용 학교. 회원 등급과 무관하다 */
  readForecastCapabilities(caller: Caller): Promise<ForecastCapabilitiesDto>;
  /** forecast.list. 허용 학교의 draft 목록 */
  listForecastDrafts(caller: Caller, universityId?: string): Promise<ForecastListDto>;
  /** forecast.read. 범위 밖이면 없는 draft 와 같은 404 → null */
  readForecastDraft(caller: Caller, draftId: string): Promise<ForecastDraftDto | null>;
  /** forecast.create (editor) */
  createForecastDraft(caller: Caller, offeringId: string, body: { input_id: string; input_version: string; policy_id: string; policy_version: string }, key: string): Promise<Result<ForecastDraftDto>>;
  /** forecast.adjust (editor). 새 revision 을 만들고 이전 검증·승인을 잇지 않는다 */
  adjustForecastDraft(caller: Caller, draftId: string, body: ForecastAdjustInput, key: string): Promise<Result<ForecastDraftDto>>;
  /** forecast.validate (editor) */
  validateForecastDraft(caller: Caller, draftId: string, body: ForecastRevisionRef, key: string): Promise<Result<ForecastDraftDto>>;
  /** forecast.approve (approver) */
  approveForecastDraft(caller: Caller, draftId: string, body: ForecastRevisionRef & { validation_receipt_hash: string; reason: string }, key: string): Promise<Result<ForecastDraftDto>>;
  /** forecast.publish (approver). 새 불변 발행 */
  publishForecastDraft(caller: Caller, draftId: string, body: ForecastRevisionRef & { approval_receipt_hash: string }, key: string): Promise<Result<ForecastDraftDto>>;
  /** forecast.published.read (유료). 발행 전이면 pending */
  readPublishedForecast(caller: Caller, offeringId: string): Promise<ForecastPublicDto | null>;
}

/** 관리 요청이 묶는 revision. 다른 사람이 먼저 바꿨으면 409 */
export interface ForecastRevisionRef {
  expected_revision: number;
  base_result_hash: string;
  policy_version: string;
}
