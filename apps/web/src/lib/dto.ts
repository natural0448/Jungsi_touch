/*
  우리 서비스 API 의 실제 응답 모양 — develop 의 docs/current/API_DTO_계약.md (명세 1.2.2) 를 옮긴 것
  ─────────────────────────────────────────────────────────────
  route_catalog.json 의 backend_contract.dto_schemas 가 원본이다. 바뀌면 여기를 맞춘다.
  1페이지(history.search · recruitment.read)가 먼저 이 모양을 쓴다.
  3·4페이지는 아직 contract.ts 의 화면 초안을 쓰며, 이 파일로 옮기는 작업이 남아 있다.

  - 숫자 점수·누적은 엔진의 소수 문자열이다.
  - 자료 대기는 200 + status=pending/reason_code, 값 null. 승인된 0건과 구분한다.
  - 시각(…_at)은 UTC Z, 날짜(…_date, deadline, source_as_of)는 YYYY-MM-DD 이며 시각을 붙이지 않는다.
*/

export type AcademicYear = 2024 | 2025 | 2026 | 2027;
export const ACADEMIC_YEARS: AcademicYear[] = [2027, 2026, 2025, 2024];

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
  wildcard_group: "nursing" | "health" | "education" | null;
}

/** history_metric — offering 필드 + 대학이 발표한 지표 하나 */
export interface HistoryMetricDto extends OfferingDto {
  metric_name: string;
  metric_definition: string | null;
  value: string | null; // 미발표면 null
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

export interface OverallResultDto {
  status: "observed" | "estimated" | "pending";
  reason_code: string | null;
  top_percent: string | null;
  inclusive_top_percent: string | null;
  exclusive_top_percent: string | null;
  tie_share_percent: string | null;
  tie_interval_percent: string[] | string | null;
  tie_policy: string | null;
  population_id: string | null;
  model_version: string | null;
}

/** jungsi.overall-analysis/v1 — 리포트 안의 전체 분석 */
export interface OverallAnalysisDto {
  format: "jungsi.overall-analysis/v1";
  exam: { exam_id: string; academic_year: number; exam_type: string };
  pack_version: string;
  score_basis: string;
  total_standard_score: number; // 국·수·탐2 표준점수 합. 영어·한국사 제외
  subjects: SubjectResultDto[];
  absolute_grades: { 영어?: number; 한국사?: number };
  overall: OverallResultDto;
}

export interface ShortlistEntryDto {
  selected: boolean;
  changed_at: string | null;
  assessment_status: string; // ready·pending·needs_revalidation 등
  profile_id: string | null;
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
  analyses?: Record<string, unknown>;
  candidates?: unknown;
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
