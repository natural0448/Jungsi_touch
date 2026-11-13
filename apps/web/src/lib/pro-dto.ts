/*
  정시터치 전문가용 응답 모양(docs/current/professional_service_api_contract.json, 기획 1.9.99 — NOT_REGISTERED_CONTRACT_ONLY).
  서버 구현(develop 00c8d795, supabase/functions/jungsi-pro-api · professional_projection.ts)과 같은 필드 이름을 쓴다. 기관·학생 권한은 서버가 판단한다.
*/

import type { CandidatesDto, ReportDto, ShortlistEntryDto, SnapshotDto } from "@/lib/dto";

export type ProRole = "org_admin" | "teacher" | "viewer";

/** 모든 전문가용 응답의 겉봉 */
export interface ProEnvelope<T> {
  format: string;
  status: "ready" | "pending";
  org_id: string | null;
  student_id: string | null;
  data: T;
  reason_codes: string[];
  request_id: string;
}

/** organization_item(서버 professional_projection.ts 와 같은 필드) */
export interface ProOrganization {
  org_id: string;
  org_name: string;
  contract_id: string;
  academic_year: number;
  role: ProRole;
  contract_status: "active";
  contract_expires_at: string;
  /** 학생 추가의 expected_contract_version. 서버 계약 행에는 있으나 세션 DTO 에 아직 없다 — 담당자 추가 요청 중(없으면 추가를 열지 않는다) */
  contract_version?: number;
  contracted_student_count: number;
  used_student_count: number;
  remaining_student_count: number;
}

/** pro_session — 내 기관·역할·계약·학생 수 */
export interface ProSessionDto {
  organizations: ProOrganization[];
  /** 기관이 하나면 그 기관, 여럿이면 null(selection_required) */
  org_id: string | null;
  role: ProRole | null;
  contract_status: "active" | "selection_required";
}

/** student — 기관 소유 학생 */
export interface ProStudentDto {
  org_id: string;
  student_id: string;
  display_name: string;
  class_label: string | null;
  class_number: string | null;
  tags: string[];
  memo: string | null;
  archived: boolean;
  version: number;
  assigned_teacher_ids: string[];
  created_at_utc: string;
}

export interface ProStudentPageDto {
  items: ProStudentDto[];
  next_cursor: string | null;
  has_more: boolean;
}

/** student_score_status — 학생×시험×단계 입력권(개인용과 같은 1회+정정 1회) */
export interface ProScoreStatusDto {
  org_id: string;
  student_id: string;
  exam_id: string;
  pack_version: string;
  stage: string;
  initial_used: number;
  initial_remaining: number;
  correction_granted: number;
  correction_used: number;
  entry_version: number;
  current_profile_id: string | null;
  current_report_id: string | null;
  last_rejection_code: string | null;
}

export interface ProStudentInput {
  display_name: string;
  class_label: string | null;
  class_number: string | null;
  tags: string[];
  /** 2026-11-13부터 화면은 메모를 보내지 않는다(빼면 서버가 예전 값을 그대로 둔다) */
  memo?: string | null;
}

/** student_report — 학생별 리포트 판. published_result 는 개인용과 같은 persisted-report 모양 */
export interface ProStudentReportDto {
  org_id: string;
  student_id: string;
  report_id: string;
  revision_id: number;
  exam_id: string;
  stage: string;
  profile_id: string;
  published_result: ReportDto;
  counseling_reasons: ProReason[];
  created_at_utc: string;
}

/**
  상담 tip 근거 하나(서버 pro_reason 모양 + offering_id). 문장은 화면이 코드·값으로 만들고 숫자는 지어내지 않는다.
  서버는 classification_basis 와 offering_id 를 낸다(값 이름 converted_score·acceptance_lower·acceptance_upper). 나머지 코드는 아직 합성에서만 만든다.
  - classification_basis: 서비스 예상 기준구간 참고와 학생 환산점수(조정된 최종 분류의 근거로 단정하지 않음)
  - rule_weight_change: 전년 대비 영역 반영 비율 변화(모집요강 비교, 점수 재계산 아님)
  - subject_weight_strength: 학생의 약한·강한 영역을 이 대학이 많이 반영
  - admission_capacity_change: 모집인원 증감
  - prior_competition: 전년 경쟁률·충원
  - historical_cut_spread: 검증된 3개년 70%컷 변동(실서비스 미연결)
  - demo_prior_year_cut_band: 합성 시연 전용, 한 학년도 50%·70%컷(3개년 변동 아님)
  - comparable_historical_cut_delta: 전년 컷과 같은 척도 비교(학년도 동등화 뒤에만 ready)
  - english_deduction / history_deduction: 영어·한국사 감점
*/
export type ProTipCode =
  | "classification_basis"
  | "rule_weight_change"
  | "subject_weight_strength"
  | "admission_capacity_change"
  | "prior_competition"
  | "historical_cut_spread"
  | "demo_prior_year_cut_band"
  | "comparable_historical_cut_delta"
  | "english_deduction"
  | "history_deduction";

export interface ProReason {
  code: ProTipCode;
  status: "ready" | "pending";
  academic_year: number;
  offering_id: string | null;
  comparison_context: { academic_year: number; reference_year: number | null; metric: string; score_scale: string | null; population_id: string | null; policy_version?: string | null; range_definition?: string | null; range_role?: "baseline_reference" | null } | null;
  values: { name: string; value: string; unit: string | null }[];
  public_basis: { title: string; url: string; source_year: number | null }[];
  missing_reason: string | null;
}

export interface ProStudentReportPageDto {
  org_id: string;
  student_id: string;
  items: ProStudentReportDto[];
  next_cursor: string | null;
  has_more: boolean;
}

/** student_candidates — 유리한 대학 찾기(개인용 candidates 와 같은 모양) */
export interface ProCandidatesDto {
  org_id: string;
  student_id: string;
  candidates: CandidatesDto;
}

/** student_bookmarks — 학생별 담은 학교 */
export interface ProBookmarksDto {
  org_id: string;
  student_id: string;
  shortlist: Record<string, ShortlistEntryDto>;
}

/** student_print_projection — 인쇄본(고정 판)과 워터마크 */
export interface ProPrintDto {
  org_id: string;
  student_id: string;
  snapshot: SnapshotDto;
  watermark: { organization_name: string; teacher_code: string; printed_at_seoul: string; student_name: string };
  /** 같은 고정 판의 상담 tip 근거. 서버 계약 확장 전에는 없을 수 있다(없으면 인쇄본에 tip 을 넣지 않는다) */
  counseling_reasons?: ProReason[];
}

/** member_page — 기관 구성원(이메일·이름 없이 구성원 번호·로그인 ID·역할만) */
export interface ProMemberPageDto {
  org_id: string;
  items: { member_id: string; subject_id: string; role: ProRole; status: "active" | "inactive"; version: number }[];
  next_cursor: string | null;
  has_more: boolean;
}

/** assignment — 학생 담당(교사·열람 전용의 로그인 ID) */
export interface ProAssignmentDto {
  org_id: string;
  student_id: string;
  assigned_teacher_ids: string[];
  version: number;
}
