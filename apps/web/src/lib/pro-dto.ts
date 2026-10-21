/*
  정시터치 전문가용 응답 모양(docs/current/professional_service_api_contract.json, 기획 1.9.99 — NOT_REGISTERED_CONTRACT_ONLY).
  서버(jungsi-pro-api)는 개발 중이고 화면은 이 계약의 필드 이름으로 합성 응답과 연결한다. 기관·학생 권한은 서버가 판단한다.
*/

export type ProRole = "org_admin" | "teacher" | "viewer";

/** 모든 전문가용 응답의 겉봉 */
export interface ProEnvelope<T> {
  format: string;
  status: "ok" | "pending";
  org_id: string | null;
  student_id: string | null;
  data: T;
  reason_codes: string[];
  request_id: string;
}

export interface ProOrganization {
  org_id: string;
  org_name: string;
  role: ProRole;
  contract_status: "active" | "expired" | "not_started" | "unavailable";
  contract_expires_at: string | null;
  /** 학생 추가 때 기대 계약 판(expected_contract_version). 계약 문서의 create 본문 필드에 대응 */
  contract_version: number;
  contracted_student_count: number;
  used_student_count: number;
  remaining_student_count: number;
}

/** pro_session — 내 기관·역할·계약·학생 수 */
export interface ProSessionDto {
  organizations: ProOrganization[];
}

/** student — 기관 소유 학생 */
export interface ProStudentDto {
  org_id: string;
  student_id: string;
  display_name: string;
  class_label: string | null;
  class_number: number | null;
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
  class_number: number | null;
  tags: string[];
  memo: string | null;
}
