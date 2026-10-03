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

/** 오류 객체 {status:error, error:{code}, request_id} */
export interface ApiErrorDto {
  status: "error";
  error: { code: string };
  request_id: string;
}
