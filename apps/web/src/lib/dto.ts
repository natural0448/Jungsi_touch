/*
  우리 서비스 API 의 실제 응답 모양 — develop 의 docs/current/API_DTO_계약.md (명세 1.2.2) 를 옮긴 것
  ─────────────────────────────────────────────────────────────
  route_catalog.json 의 backend_contract.dto_schemas 가 원본이다. 바뀌면 여기를 맞춘다.
  1~4페이지와 관리 화면이 이 모양을 쓴다. develop 명세 1.7.1(DEV-006·DEV-007) 기준.

  - 숫자 점수·누적은 엔진의 소수 문자열이다.
  - 자료 대기는 200 + status=pending/reason_code, 값 null. 승인된 0건과 구분한다.
  - 시각(…_at)은 UTC Z, 날짜(…_date, deadline, source_as_of)는 YYYY-MM-DD 이며 시각을 붙이지 않는다.
*/

export type AcademicYear = 2024 | 2025 | 2026 | 2027;
export const ACADEMIC_YEARS: AcademicYear[] = [2027, 2026, 2025, 2024];

export type MemberTier = "standard" | "paid";

/** session.read (1.7.0 정식 작업, GET /api/v1/me). 화면의 잠금 표시용이며 권한 판단은 서버가 한다 */
export interface Session {
  format: "jungsi.session/v1";
  member_tier: MemberTier;
  entitlement_expires_at: string | null; // UTC Z
}

/** offering — 모집행 기본 정보 */
export interface OfferingDto {
  offering_id: string;
  academic_year: number;
  university_id: string;
  university_name: string;
  campus: string | null;
  department: string;
  track: string | null;
  group: string; // 가·나·다
  region: string | null;
  wildcard_group: WildcardGroup | null;
  // W5 임시안(담당자 R18 승인 대기): 수능 외 조건 코드 배열. 없거나 빈 배열이면 안내를 숨긴다
  non_csat_conditions?: string[] | null;
}

/** history_metric — offering 필드 + 대학이 발표한 지표 하나 */
export interface HistoryMetricDto extends OfferingDto {
  metric_name: string; // 전국 현재 정본은 원본 지표 종류 코드(예: competition_ratio)
  metric_definition: string | null;
  /** 전국 현재 정본(1.9.90~): 대학 원문 통계 구분(예: 70%컷·평균)과 대상 집단. 이전 묶음에는 없다 */
  statistic_label?: string | null;
  cohort?: string | null;
  value_json_type?: string | null;
  value: string | number | null; // 미발표면 null. 전국 정본은 원문 JSON 스칼라(숫자 포함) 그대로
  unit: string | null;
  original_scale: string | null;
  publication_status: string; // 발표 상태. 미발표 값은 null 과 함께 온다
  source_url: string | null;
  source_as_of: string | null; // YYYY-MM-DD
}

/** catalog_search — history.search / offerings.search 공통 */
export interface CatalogSearchDto<T> {
  status: "ready" | "pending";
  reason_code: string | null;
  items: T[] | null; // 자료 미발행이면 null
  matching_offering_count: number | null;
  matching_school_count: number | null;
  catalog_version: string | null;
  as_of: string | null;
  next_cursor: string | null;
}

export interface HistorySearchQuery {
  academic_year?: AcademicYear;
  university_q?: string;
  department_q?: string;
  region?: string;
  group?: string;
  cursor?: string;
  limit?: number; // 1~100, 기본 50
}

export interface RecruitmentChangeDto {
  kind: string;
  delta: number | null;
  announced_date: string | null; // YYYY-MM-DD
  announced_at: string | null; // UTC Z
  source_url: string | null;
  status: string;
  reason: string | null;
  revision: number;
}

/** recruitment — recruitment.read */
export interface RecruitmentDto {
  status: "ready" | "pending";
  reason_code: string | null;
  offering: OfferingDto | null;
  recruitment: {
    initial_count: number | null; // 최초 0 과 미공개 null 을 구분
    rollover_change: number | null;
    final_count: number | null;
    count_status: string;
    changes: RecruitmentChangeDto[];
    source_url: string | null;
    source_as_of: string | null;
    deadline: string | null; // YYYY-MM-DD
    deadline_at: string | null; // UTC Z
  } | null;
  catalog_version: string | null;
}

// ─── 2페이지: 성적 프로필·리포트 ─────────────────────────────

/** overall_analysis_contract 입력. exam_id·pack_version 은 등록 ID 토큰 */
export interface ScoresInput {
  exam_id: string;
  pack_version: string;
  korean: { standard_score: number; choice?: string };
  math: { standard_score: number; choice?: string };
  inquiry: { subject: string; standard_score: number }[]; // 서로 다른 두 과목
  english_grade?: number;
  korean_history_grade?: number;
  /** 제2외국어/한문: 과목과 등급만. null 은 미응시 */
  second_language?: SecondLanguageDto | null;
}

/**
  수능 가채점 입력(제안 계약 — 서버 미구현, 수능 뒤 연결 예정). 원점수만 보낸다.
  표준점수·백분위·상대평가 등급은 서버가 예상 등급컷 자료로 추정하고, 절대평가 등급은 서버가 고정 구간으로 정한다.
*/
export interface ProvisionalScoresInput {
  exam_id: string;
  pack_version: string;
  korean: { raw_score: number; choice?: string };
  math: { raw_score: number; choice?: string };
  inquiry: { subject: string; raw_score: number }[];
  english_raw?: number;
  korean_history_raw?: number;
  second_language?: { subject: string; raw_score: number } | null;
}

/** 제2외국어/한문 결과. 절대평가 등급이라 총점·전체 위치에 넣지 않는다 */
export interface SecondLanguageDto {
  subject: string;
  grade: number;
}

/** profile — score-profile.create. 새 입력은 새 profile_id, 기존 성적은 고치지 않는다 */
export interface ProfileDto {
  profile_id: string;
  profile_version: number;
  confirmed: boolean; // 사용자가 입력을 확인했다는 뜻. 이용권·자료 승인·자격이 아니다
  created_at: string; // UTC Z
}

export interface SubjectResultDto {
  area: "korean" | "math" | "inquiry1" | "inquiry2";
  subject: string;
  choice: string | null;
  standard_score: number;
  grade: number | null;
  top_percent_exclusive: string | null;
  top_percent_inclusive: string | null;
  basis: string | null;
}

/**
 * 제안(백엔드 계약 미반영, 2026-10-07): 반영 조합별 전체 위치. 조합마다 승인된 결합분포로
 * 서버가 계산해 줄 때만 채워진다. 응답에 없으면 화면은 '자료 대기' 안내만 보이고, 화면이
 * 조합 수치를 직접 계산하지 않는다(SEC 기준). 계약 채택 요청서를 담당자에게 별도 전달한다.
 */
export interface ComboPositionDto {
  combo_id: string; // 예: korean_math
  label: string; // 예: 국어+수학
  total_standard_score: number | null; // 그 조합의 표준점수 합(서버 계산)
  status: "observed" | "estimated" | "pending";
  reason_code: string | null; // pending 사유. 예: combo_model_missing
  inclusive_top_percent: string | null;
  exclusive_top_percent: string | null;
  data_kind?: DataKind | null;
}

export interface OverallResultDto {
  status: "observed" | "estimated" | "pending";
  reason_code: string | null;
  top_percent: string | null;
  inclusive_top_percent: string | null;
  exclusive_top_percent: string | null;
  tie_share_percent: string | null;
  tie_interval_percent: { lower: string; upper: string } | null; // 동점 구간(상위 %)
  tie_policy: string | null;
  population_id: string | null;
  model_version: string | null;
  data_kind?: DataKind | null; // 1.7.0: 관측 도수인지 자체 추정 가중치인지
}

/** 누적의 근거. observed_counts=실제 도수, estimated_weights=공식 주변도수로 자체 추정한 가중치 */
export type DataKind = "observed_counts" | "estimated_weights";
/** 대학 누백의 비교집단. whole_complete=국·수·탐2 전체 응시자, required_rule_inputs_present=그 대학 반영 성적을 모두 가진 응시자 */
export type PopulationScope = "whole_complete" | "required_rule_inputs_present";
/** 환산 기준. actual_exam=같은 학년도 실제 수능, mock_exam=승인된 모의평가 호환, year_equated_estimate=연도 보정 추정 */
export type ScoreBasis = "actual_exam" | "mock_exam" | "year_equated_estimate";

/** jungsi.overall-analysis/v1 — 리포트 안의 전체 분석 */
export interface OverallAnalysisDto {
  format: "jungsi.overall-analysis/v1";
  exam: { exam_id: string; academic_year: number; exam_type: string };
  pack_version: string;
  score_basis: string;
  total_standard_score: number; // 국·수·탐2 표준점수 합. 영어·한국사 제외
  subjects: SubjectResultDto[];
  absolute_grades: { 영어?: number; 한국사?: number };
  /** 없거나 null 이면 미응시. 이 필드가 생기기 전(2026-11-12)에 저장된 리포트에는 없다 → 미응시로 본다 */
  second_language?: SecondLanguageDto | null;
  overall: OverallResultDto;
  combinations?: ComboPositionDto[] | null; // 제안 필드(위 ComboPositionDto 설명). 서버가 줄 때만 존재
}

export interface ShortlistEntryDto {
  selected: boolean;
  changed_at: string | null;
  assessment_status: string; // ready·pending·needs_revalidation 등
  profile_id: string | null;
  catalog_version: string | null;
}

// ─── 3·4페이지: 모집단위 분석·후보·집계 ──────────────────────

/** 학과(모집단위)마다의 지원 판단. 학교 분류를 학과에 복사하지 않는다 */
export type Category = "challenge" | "core" | "room" | "outside" | "pending" | "ineligible";

export interface HistoricalMetricDto {
  academic_year: number;
  metric_name: string;
  metric_definition: string | null;
  value: string | number | null;
  unit: string | null;
  original_scale: string | null;
  publication_status: string | null;
  source_url: string | null;
  source_as_of: string | null; // YYYY-MM-DD
}

/** eligibility_conditions — 모집단위의 필수 응시 영역·지정 과목(서버 public_response_schemas 와 같은 모양) */
export interface EligibilityConditionsDto {
  required_areas: string[] | null; // [] 이면 별도 지정 없음
  math_choices: string[] | null; // 목록이면 그 과목 중 하나
  math_note: string | null; // 요강 문구 그대로
  inquiry_domains: string[] | null; // 사회·과학·직업
  inquiry_note: string | null; // 요강 문구 그대로
}

/** assessment — 모집단위 하나의 개인 분석 (report.analyses[offering_id]) */
export interface AssessmentDto {
  offering_id: string;
  status: "ready" | "pending" | "ineligible";
  reason_code: string | null;
  converted_score: string | null; // 올해 공식 반영식으로 환산한 내 점수
  converted_percentile: string | null; // 이 대학 환산 분포에서 위에서 몇 %(동점 포함)
  category: Category;
  advantage: { delta_pp: string; status: "favorable" | "unfavorable" | "neutral"; baseline_version: string } | null;
  years: { academic_year: number; offering_id: string; score_basis: string; converted_score: string | null; status: string; reason_code: string | null }[];
  versions: Record<string, string>;
  eligibility_status: "eligible" | "needs_confirmation" | "ineligible";
  decision_components?: { base_category: Category; adjusted_category: Category | null; adopted_category: Category; base_policy_version: string; adjustment_version: string | null };
  decision_evidence?: {
    version: string;
    historical_metrics: HistoricalMetricDto[];
    forecast_70: { status: "ready" | "pending"; reason_code: string | null; value: string | number | null; unit: string | null; definition: string | null; version: string | null };
    expected_acceptance_range: { status?: "ready" | "pending"; reason_code?: string | null; lower: string | number; upper: string | number; unit: string; definition: string; policy_version: string };
    // 1.7.1 (DEV-007): 채택 발표본의 공개 근거. context·policy_version·input_version 이 forecast_public 과 모두 같을 때만 같은 근거다
    forecast_release_version?: string | null;
    basis_summary?: string | null;
    issue_summaries?: IssueSummaryDto[] | null;
    recommendation_reasons?: ReasonDto[] | null;
    adjustment_summary?: AdjustmentSummaryDto | null;
    context?: ForecastPublicContextDto | null;
    policy_version?: string | null;
    input_version?: string | null;
  };
  // 1.7.0: 환산·누백·판단은 각자 준비 상태를 가진다
  conversion?: ConversionDto | null;
  percentile?: PercentileDto | null;
  recommendation_reasons?: ReasonDto[] | null;
  // 참고 누백(추정). 서버는 승인된 곡선의 값만 보내고, 계산이 안 되면 칸을 뺀다
  reference_percentile?: ReferencePercentileDto | null;
  // 학교 반영 백분위(참고, 2026-11-14). 허가된 2027 모집단위만, 읽을 때 서버가 계산해 붙인다
  school_reflected?: SchoolReflectedDto | null;
  // 지원 자격 조건(유료 report.read, 2026-11-15). 요강 정본에서 확정된 필드만 온다. 판정은 eligibility_status 그대로
  eligibility_conditions?: EligibilityConditionsDto | null;
}

/** 학교 반영 백분위(참고). value 는 0~100, 영어·한국사·가산점 제외 */
export interface SchoolReflectedDto {
  status: "reference" | "pending";
  value: number | null;
  reason_code: string | null;
  eligibility_note: boolean;
  excluded: ("english" | "korean_history" | "bonus")[];
}

/** 참고 누백(추정) — 9월 모의평가 응시자 전체 기준 추정 위치. 합격 가능성·지원 판정이 아니다 */
export interface ReferencePercentileDto {
  status: "reference_estimated";
  estimated_upper_cumulative_percent_all_examinees: string; // 정확한 소수 문자열, 화면은 소수 첫째 자리
  metric: string;
  denominator_kind: string;
  calculation_review_scope: string;
  production_allowed: boolean;
  actual_admission_full_total_approved: boolean;
}

/** candidates.reference_university_groups — 순위 없는 참고 묶음. basic_university_groups 와 섞지 않는다 */
export interface ReferenceUniversityGroupDto {
  university_id: string;
  university_name: string;
  offerings: { offering: OfferingDto; reference_percentile: ReferencePercentileDto | null }[];
}

/** assessment.conversion — 대학 공식 반영식 환산. 판단이 보류여도 성공한 환산은 남는다 */
export interface ConversionDto {
  status: "ready" | "pending" | "reference_calculated"; // reference_calculated: 참고 점수(운영 확정본 아님)
  reason_code: string | null;
  score_basis: ScoreBasis | null;
  score_scope: string | null;
  converted_score: string | null;
  official_max_score: string | null;
  academic_year: number | null;
  exam_id: string | null;
  rule_version: string | null;
  release_version: string | null;
  table_versions: Record<string, string> | null;
  profile_version: number | string | null;
  pack_version: string | null;
}

/** assessment.percentile — 학교 환산 분포에서의 상위 누백 */
export interface PercentileDto {
  status: "ready" | "pending";
  reason_code: string | null;
  score_basis: ScoreBasis | null;
  score_scope: string | null;
  academic_year: number | null;
  exam_id: string | null;
  top_percent: string | null;
  inclusive_top_percent: string | null;
  exclusive_top_percent: string | null;
  tie_share_percent: string | null;
  tie_policy: string | null;
  population_id: string | null;
  data_kind: DataKind | null;
  rule_version: string | null;
  curve_version: string | null;
  release_version: string | null;
  source_model_version: string | null;
  profile_version: number | string | null;
  pack_version: string | null;
  population_scope: PopulationScope | null;
}

/** 올해 이슈. 숫자 효과가 확인되지 않은 이슈는 numeric_effect_applied=false 로 남는다 */
export interface IssueSummaryDto {
  issue_id: string;
  title: string;
  summary: string;
  numeric_effect_applied: boolean;
}

/** 상담 조정이 반영됐는지 */
export interface AdjustmentSummaryDto {
  applied: boolean;
  reason: string | null;
  version: string | null;
}

/** 발표본의 공개 기준 묶음(17필드). 비교 지표·단위·방향이 함께 온다 */
export interface ForecastPublicContextDto {
  offering_id: string;
  academic_year: number;
  exam_id: string;
  source_pack_version: string;
  catalog_version: string;
  rule_id: string;
  rule_version: string;
  curve_version: string;
  analysis_version: string;
  score_scale_id: string;
  score_scope: string;
  bonus_treatment: string;
  population_id: string;
  comparison_metric: "converted_score" | "university_top_percent";
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  tie_policy: string | null;
}

/** 서버가 만든 추천·판단 이유. 화면은 문장을 지어내지 않는다 */
export interface ReasonDto {
  code: string;
  text: string;
  evidence_refs: string[];
}

export interface CandidateItemDto {
  offering: OfferingDto;
  assessment: AssessmentDto;
}

/** 와일드카드 계열. contract·maritime·railway 는 서버 선택(wildcard_selection) 운영 연결 뒤에 나온다 */
export type WildcardGroup = "nursing" | "health" | "education" | "contract" | "maritime" | "railway";

/** candidates.wildcard_selection — 서버가 고른 와일드카드(최대 4장)의 순서 확정 상태. 없거나 null 이면 옛 방식 */
export interface WildcardSelectionDto {
  status: "ready" | "partial" | "pending";
  reason_code: "wildcard_evidence_unavailable" | "wildcard_assessment_pending" | "wildcard_comparison_unverified" | null;
  card_stability: { offering_id: string; status: "verified" | "pending" }[]; // wildcards 와 같은 순서·같은 길이
}

/** candidates — candidates.build. 대학별 묶음과 와일드카드, 판단 보류 목록 */
export interface CandidatesDto {
  status: "ready" | "pending";
  reason_code: string | null;
  basic_university_groups: { university_id: string; university_name: string; offerings: CandidateItemDto[] }[];
  wildcards: CandidateItemDto[]; // wildcard_selection 이 있으면 서버 순서 그대로, 최대 4장
  wildcard_selection?: WildcardSelectionDto | null;
  reference_university_groups?: ReferenceUniversityGroupDto[] | null; // 없거나 비면 영역을 숨긴다
  pending_offerings: OfferingStateDto[]; // 판단 보류(자료 부재 등)
  outside_offerings?: OfferingStateDto[]; // 판단 완료 · 추천 범위 밖 (1.7.1)
  ineligible_offerings?: OfferingStateDto[]; // 판단 완료 · 지원 조건 미충족 (1.7.1)
  catalog_version: string | null;
}

export interface OfferingStateDto {
  offering_id: string;
  category: Category;
  reason_code: string | null;
}

export interface RankDto {
  rank: number;
  tie_count: number;
  population_count: number;
  tie_policy: string;
}

/** statistics — statistics.read. 서비스 이용자 집계이며 실제 대학 지원자가 아니다 */
export interface StatisticsDto {
  status: "ready" | "pending";
  reason_code: string | null;
  recommended_count: number | null;
  selected_count: number | null;
  recommended_rank: RankDto | null;
  selected_rank: RankDto | null;
  updated_at: string | null; // UTC Z
  scope: string;
  versions?: Record<string, string>;
}

/** offering_detail — offering.read */
export interface OfferingDetailDto {
  status: "ready" | "pending";
  reason_code: string | null;
  offering: OfferingDto | null;
  catalog_version: string | null;
}

/** report — jungsi.persisted-report/v1. 유료 필드는 일반 회원 응답에서 빠진다 */
export interface ReportDto {
  format: "jungsi.persisted-report/v1";
  report_id: string;
  report_version: number;
  profile_id: string;
  updated_at: string; // UTC Z
  overall: OverallAnalysisDto;
  analyses?: Record<string, AssessmentDto>;
  candidates?: CandidatesDto | null;
  shortlist?: Record<string, ShortlistEntryDto>;
  analysis_status?: { status: string; reason_code: string | null };
}

/** snapshot — report.export. 고정된 revision 의 상담 리포트 */
export interface SnapshotDto {
  format: "jungsi.counseling-snapshot/v1";
  status: string;
  snapshot_version: number;
  generated_at: string; // UTC Z
  report: ReportDto;
}

/** 오류 객체 {status:error, error:{code}, request_id} */
export interface ApiErrorDto {
  status: "error";
  error: { code: string };
  request_id: string;
}

// ─── 1.7.0 관리: 학과별 예상 기준(DEV-007) ─────────────────────

export type ForecastCapability = "editor" | "approver";

/** forecast_capabilities — 서버 관리 권한. 회원 등급과 무관하다 */
export interface ForecastCapabilitiesDto {
  format: "jungsi.forecast-capabilities/v1";
  capabilities: ForecastCapability[];
  university_ids: string[];
}

export type ForecastStatus = "draft" | "validated" | "approved" | "published";
export type ForecastTarget = "forecast_70" | "acceptance_range" | "category_ranges";

export interface ForecastValueDto {
  status: "ready" | "pending";
  reason_code: string | null;
  value: string | null;
  unit: string | null;
  definition: string | null;
  version: string | null;
}

export interface ForecastRangeDto {
  status: "ready" | "pending";
  reason_code: string | null;
  lower: string | null;
  upper: string | null;
  unit: string | null;
  definition: string | null;
  policy_version: string | null;
}

export interface CategoryRangeDto {
  category: Category;
  lower: string;
  upper: string;
}

/** 기준선·합격권·지원 구간 3필드 투영. 내부 정확값·계수·trace 는 오지 않는다 */
export interface ForecastResultDto {
  forecast_70: ForecastValueDto;
  acceptance_range: ForecastRangeDto;
  category_ranges: CategoryRangeDto[];
}

/** 조정 대체값: 같은 단위로 명시한다 */
export type ForecastReplacement = { value: string; unit: string } | { lower: string; upper: string; unit: string } | { ranges: CategoryRangeDto[] };

/** forecast_draft — 관리 사용자 전용. 쓰기마다 revision 이 1 오르고 base_result_hash 는 생성 때 값 그대로다 */
export interface ForecastDraftDto {
  format: "jungsi.forecast-draft/v1";
  draft_id: string;
  offering_id: string;
  revision: number;
  status: ForecastStatus;
  base_result_hash: string;
  policy_version: string;
  context: {
    offering_id: string;
    offering_lineage_id: string | null;
    academic_year: number;
    university_id: string;
    campus: string | null;
    department: string;
    track: string | null;
    group: string;
    exam_id: string;
    source_pack_version: string;
    catalog_version: string;
    analysis_version: string;
    rule_id: string;
    rule_version: string;
    curve_version: string;
    population_id: string;
    score_scope: string;
    score_scale_id: string;
    bonus_treatment: string;
    unit: string;
  };
  result: ForecastResultDto; // 현재 revision 의 채택값
  base_result: ForecastResultDto; // 조정 전 서버 산출 원본
  created_at: string; // UTC Z
  updated_at: string; // UTC Z
  adjustments: { target: ForecastTarget; replacement: ForecastReplacement; reason: string; evidence_refs: string[]; actor: string; at: string; base_result_hash: string }[];
  validation: { status: "passed" | "failed"; reason_code: string | null; checks: unknown; validated_revision: number; result_hash: string; receipt_hash: string; at: string } | null;
  approval: { approved_revision: number; result_hash: string; validation_hash: string; approval_hash: string; reason: string; at: string } | null;
  audit_events: { action: string; actor: string; at: string }[];
}

export interface ForecastListDto {
  format: "jungsi.forecast-list/v1";
  items: ForecastDraftDto[];
}

export interface ForecastAdjustInput {
  expected_revision: number;
  base_result_hash: string;
  policy_version: string;
  target: ForecastTarget;
  replacement: ForecastReplacement;
  reason: string;
  evidence_refs: string[]; // 서버에 승인된 근거 ID
}

/** forecast_public — 발행된 학과 기준과 공개 근거. 합격 확률·최저점이 아니다. 발행 전이면 pending 과 null */
export interface ForecastPublicDto {
  format: "jungsi.forecast-public/v1";
  status: "published" | "pending";
  reason_code: string | null;
  offering_id: string;
  release_version: string | null;
  context: ForecastPublicContextDto | null;
  policy_version: string | null;
  input_version: string | null;
  forecast_70: ForecastValueDto | null;
  expected_acceptance_range: ForecastRangeDto | null;
  category_ranges: CategoryRangeDto[];
  basis_summary: string | null;
  issue_summaries: IssueSummaryDto[];
  recommendation_reasons: ReasonDto[];
  adjustment_summary: AdjustmentSummaryDto;
}

/* ── 1페이지 전국 정리본(history.snapshot.*, 기획 1.9.95) ── */

/** 정리본 분할 하나의 고정값(pins). 받은 bytes 의 길이·SHA 를 이 값과 대조한다 */
export interface SnapshotPartPin {
  part_id: string;
  payload_id: string;
  gzip_bytes: number;
  gzip_sha256: string;
  decoded_bytes: number;
  decoded_sha256: string;
  rows: number;
  mapped_rows: number;
  mapping_pending_rows: number;
}

/** Optional q on history_snapshot_row.final_additional_admission_rank only.
 * Server-only raw DTO; authority verification stays in the backend publication loader. */
export interface SnapshotRankServiceQualificationDto {
  format: "jungsi.history-field-service-qualification/v1";
  authority_sha256: string;
  qualification_receipt_sha256: string;
  subject: { observation_id: string; academic_year: AcademicYear; offering_pk: string; identity_variant_index: number };
  normalized_service_fields: { status: "verified_official"; unit: "번" };
}

/** history_snapshot_head — 현재 발행판의 작은 머리 */
export interface SnapshotHeadDto {
  format: "jungsi.history-snapshot-head/v1";
  status: "approved";
  snapshot_id: string;
  publication_sha256: string;
  source_head_sha256: string;
  generated_at: string;
  source_as_of: string | null;
  schema_version: string;
  normalization_rules_version: string;
  selection_rules_version: string;
  counts: { rows: number; mapped_rows: number; mapping_pending_rows: number; schools: number; observations?: number };
  delivery_mode: "full" | "parts";
  full: SnapshotPartPin | null;
  parts: SnapshotPartPin[];
  expires_at: string;
  /** 2027 부분 발행 때만(schema v2). 화면 수신 영수증을 낸 뒤에만 온다(담당자 1.9.141) */
  r27_scope_coverage?: { status: "partial"; source_rows: number; included_rows: number; excluded_rows: number; review_pending_rows: number };
}

/* ── 2페이지 입력권·본인 목록·예시(기획 1.9.95, 결합 20) ── */

/** own_report_list — 현재 로그인한 본인의 리포트 요약 */
export interface OwnReportListDto {
  format: "jungsi.own-report-list/v1";
  /** stage·is_current: 담당자 서비스 후보(2026-10-28 cross-PC v4). 아직 운영 응답에 없을 수 있어 선택 필드다. null 은 서버가 모름 */
  items: { report_id: string; exam_id: string | null; report_version: number; updated_at: string; stage?: string | null; is_current?: boolean | null }[];
  next_cursor: string | null;
  has_more: boolean;
}

/** score_input_status — 이 시험·단계의 입력권 상태. 숫자는 서버 값 그대로 쓴다(추정 금지) */
export interface ScoreInputStatusDto {
  format: "jungsi.score-input-status/v1";
  exam_id: string;
  pack_version: string;
  academic_year: number;
  stage: string;
  stage_state: "open" | "not_open" | "closed";
  opens_at: string | null;
  closes_at: string | null;
  paid_input_allowed: boolean;
  input_limit_mode: "stage_rights" | "preview_exempt";
  initial_used: number;
  initial_remaining: number;
  correction_granted: number;
  correction_used: number;
  correction_request_remaining: number;
  effective_save_remaining: number | null;
  entry_version: number;
  current_profile_id: string | null;
  current_report_id: string | null;
  last_attempt_outcome: string | null;
  last_rejection_code: string | null;
  legacy_transition_status: string;
}

/** sample_report — 무료 회원에게 보이는 가상 학생 견본. 실제 개인 성적이 아니다 */
export interface SampleReportDto {
  format: "jungsi.sample-report/v1";
  synthetic: true;
  sample_id: string;
  label: string;
  report: {
    format: "jungsi.sample-analysis/v1";
    source_kind: "synthetic";
    total_standard_score: number;
    subjects: { area: string; standard_score: number }[];
    overall: { status: string; reason_code: string | null; top_percent: string | number | null };
    input_editable: false;
    persisted: false;
  };
}
