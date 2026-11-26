# 정시터치 전문가용 서비스·DB 계약

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.176이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.



## 정시터치 전문가용 · 기관 소유 학생 상담

SOURCE_IMPLEMENTED_ADDITIVE_SCHEMA_VERIFIED_RUNTIME_NOT_ACTIVATED. 기존 개인용 배포와 독립된 확장 계약이다. 기관 DB/API 활성화·운영은 NOT_RUN이다.

DB 적용: APPLIED_ADDITIVE_SCHEMA_READBACK / 별도 소스 등록: CODE_REGISTERED_RUNTIME_NOT_ACTIVATED. 합성 검수와 실제 운영 인수를 구분한다.

요금은 교사 1명이 분석하는 학생 1명당 33,000원이며 계약 학생 수까지 원자적으로 추가한다. 학생별 단계 입력1+고객센터 정정1을 적용하고 기관 관리자에게 정정권을 주지 않는다.

기록은 기관 소유이며 담당 교사는 매 요청 확인한다. 다른 기관/비담당 학생은 같은404로 거절하고 개인 내 리포트와 섞지 않는다. 계약·담당·학생별 권리가 유효한 교사가 20명 이상을 순차 처리해도 개인 계정의 3/10개 성적 한도를 일괄 적용해 차단하지 않는다. 관리자 일일 예외나 무제한으로 대체하지 않는다.

| 표시 경로 | 역할 |
| --- | --- |
| /jeongsi/pro | 기관·계약·잔여 학생 수와 담당 학생 목록 |
| /jeongsi/pro/students/{student_id} | 고정 학생 띠·학생별 기존2~4페이지 기능·저장 전 이름/성적 확인 |
| /jeongsi/pro/students/{student_id}/reports/{report_id} | 학생별 판 목록·재열람·비공개 PDF/인쇄 |
| /jeongsi/pro/management | 기관 관리자 구성원/담당 변경; 성적 정정 기능 없음 |
| /jeongsi/pro/guide | 정시 기본 안내(원문 대조를 마친 공통 안내·출처). 학생별 상담 tip과 별개 |
| /jeongsi/management/pro-score-input-corrections | 고객센터 전용 정정 접수·대상 확인·단일 정정권 승인 |

승인된 엔진/공식 자료 결과에서 검증된 사유 코드+정확 수치+단위+학년도/비교 맥락만 전달하고 화면의 고정 문장 틀로 표시한다. 사유 배열을 비우고 근거 자료 연결 전을 표시; 결측0·합격 단정·다른 집단 누백 비교·임의 산식 금지

파기는 학년도 공식 일정과 계약별 정확 명부·이전 해시·개별 승인 후 수행하며 현재 자동 작업/삭제는 없다. [전문가용 서비스·DB 계약](전문가용_서비스_DB_계약.md)과 [별도 API 계약](professional_service_api_contract.json)을 따른다.

| 담당 | 범위 |
| --- | --- |
| 사용자·DB/환산 담당 | 기관 DB/SQL/RLS·실저장소/정본 writer·암호화/보존 설계·환산/누백/분포/판정·수치 근거 포트 |
| Owner·화면팀 | 서버 서비스·API/DTO·인증/조직 권한·CSRF/relay·입력권/예산 흐름·화면/합성 응답·상담 문장·감사 호출·테스트·기존 Supabase 배포 |
| 에듀터치 본체 Owner | 기관/계약/구성원 원본·초대/담당 관리자 화면·기존 계정·수동 계약 등록·기관 알림 전달 |
| 기획팀 | 공통 계약·라우팅·브랜치/검사 정책; 정상 PR 통합·확정 근거와 NOT_RUN 구분 |

21개 전문가 API와 실제 앱 저장소 소스를 통합했고 007의15개 빈 private 테이블·제약·앱 RLS 및 실제 저장소7항목의 합성 왕복/롤백을 기존 Supabase에서 확인했다. 개인용28/656과 Owner v2를 유지한다. Owner는 허용 application/HTTP/runtime에서 기관 원본·정책/키·최종 BFF/실제JWT·OTP·배포를 독립 진행한다. 원본 SQL/실어댑터·DB/엔진은 기존 담당이다. 실제 기관/학생·계약 임의 생성과 자동 활성화/삭제는 없다. 원본 authority용008은 별도 PREPARED_NOT_APPLIED 후보로 public의 기존 postgres CREATE 범위에 준비했다. set-based 원본 JOIN·계약/회원 version·무시드 승인시험·앱 EXECUTE 한정 및 support/retention 닫힘을 격리24건/바인딩144건/기존기관보안13건으로 확인했다. 실제008 적용·정의SHA/최종바인딩·시험등록·Secrets·실JWT/BFF/배포는 NOT_RUN이며 기존007/개인용28/기관21의 등록과 검증을 유지한다. 2026-10-23 통합 요청: 학년도+모집단위 번호별 정본 규칙의 서버 내부 읽기 포트를 추가하고, 검증된 lineage에만 전년 비교를 결속한다. 영역별 비율·영어/한국사·가산점·탐구 선택조건과 원문/자격을 보존한다. 상담 근거의 실제 모집단/정책 버전·정밀도·충원 인원/예비번호·한해 컷 폭/3개년 변동의 의미를 구분한다. 최신 Owner008 설치 보고는 이전 준비 이력과 별도 수용하며 전체 UPDATE version 트리거를 유지한다. 전문가용 계산 한도는 실제 런타임 카탈로그 범위를 먼저 확인하고 개인용·공유 물리 통제를 보존한다. 새 포트 실DB/설정·전문가용/JWT/OTP/BFF·배포 인수는 각각 NOT_RUN이다.

## 별도 후보 API

| 별도 ID | method | 서비스 경로 | 권한 | 응답 | 효과 | 소스 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| pro.session | GET | /api/v1/pro/session | verified_member | pro_session | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.student.list | GET | /api/v1/pro/organizations/{org_id}/students | assigned_teacher_or_org_admin | student_page | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.student.create | POST | /api/v1/pro/organizations/{org_id}/students | teacher_or_org_admin_with_contract_seat | student | idempotent_seat_reservation_and_create | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.student.read | GET | /api/v1/pro/organizations/{org_id}/students/{student_id} | assigned_teacher_or_org_admin | student | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.student.update | PATCH | /api/v1/pro/organizations/{org_id}/students/{student_id} | assigned_teacher_or_org_admin | student | expected_version_metadata_update_not_score | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.student.archive | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/archive | org_admin_aal2 | student | expected_version_archive_no_delete_or_seat_refund | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.student.assign | PUT | /api/v1/pro/organizations/{org_id}/students/{student_id}/assignments | org_admin_aal2 | assignment | expected_version_assignment_change | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.member.list | GET | /api/v1/pro/organizations/{org_id}/members | org_admin | member_page | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.score.status | GET | /api/v1/pro/organizations/{org_id}/students/{student_id}/score-input-status | assigned_teacher_or_org_admin | student_score_status | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.score.create | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/score-profiles | assigned_teacher | student_profile | idempotent_student_stage_input_right | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.overall.analyze | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/overall-analysis | assigned_teacher | student_overall | reuse_approved_engine_no_new_input_right | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.report.list | GET | /api/v1/pro/organizations/{org_id}/students/{student_id}/reports | assigned_teacher_or_authorized_viewer_or_org_admin | student_report_page | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.report.read | GET | /api/v1/pro/organizations/{org_id}/students/{student_id}/reports/{report_id} | assigned_teacher_or_authorized_viewer_or_org_admin | student_report | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.university.analyze | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/university-analysis | assigned_teacher | student_university_result | reuse_approved_engine | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.candidates | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/candidates | assigned_teacher | student_candidates | reuse_approved_engine | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.bookmark.list | GET | /api/v1/pro/organizations/{org_id}/students/{student_id}/bookmarks | assigned_teacher_or_authorized_viewer_or_org_admin | student_bookmarks | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.bookmark.add | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/bookmarks | assigned_teacher | student_bookmarks | idempotent_bookmark | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.report.export | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/reports/{report_id}/export | assigned_teacher_or_authorized_viewer_or_org_admin | student_print_projection | CSRF_protected_audited_private_output | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.correction.grant | POST | /api/v1/pro/organizations/{org_id}/students/{student_id}/management/score-input-corrections | customer_support_active_admin_aal2_exact_ticket_scope | student_score_status | ticket_expected_version_idempotent_single_correction_grant | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.retention.preview | POST | /api/v1/pro/organizations/{org_id}/management/retention-preview | platform_retention_operator_aal2 | retention_manifest | dry_run_only_no_delete | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |
| pro.retention.notice-targets | GET | /api/v1/pro/organizations/{org_id}/management/retention-notice-targets | platform_retention_operator_aal2 | retention_notice_targets | read_only | CODE_REGISTERED_RUNTIME_NOT_ACTIVATED |

기존 operation 등록과 구현/운영 인수는 그대로이며 다음 계약으로 합성 포트·화면/서비스 개발을 시작한다.

### identity

```json
{
  "login": "existing_EduTouch_same_Bearer_Supabase_Auth",
  "new_student_accounts": false,
  "student_share_links": false,
  "request_authorization_order": [
    "verified_user",
    "active_contract",
    "active_org_membership_and_role",
    "same_org_student",
    "current_assignment_or_org_admin_read_scope",
    "operation_rights"
  ],
  "cross_org_or_unassigned_student_response": "same_404_without_existence_disclosure",
  "client_org_role_or_student_claim_trusted": false,
  "revocation": "fresh per-request authority; deactivation/reassignment/contract expiry applies on next request",
  "support_rule": "고객센터 정정만 검증된 active admin aal2와 해당 기관/학생/시험의 접수번호·명시 지원 범위로 허용한다. 기관 관리자 역할만으로 정정권을 주지 않는다."
}
```

### ownership

```json
{
  "record_owner": "organization",
  "key": [
    "org_id",
    "student_id"
  ],
  "assignment_separate_from_ownership": true,
  "personal_report_mixing_allowed": false,
  "user_impersonation_or_org_id_as_personal_owner_id": false,
  "teacher_departure": "기관 자료 보존; 담당 권한만 회수하고 재배정은 감사/CAS로 처리",
  "repository_boundary": "개인용 owner UUID를 교사/기관 ID로 덮어쓰지 않는다. 별도의 기관 학생 principal과 저장소 포트를 사용하고 실제 DB 구조·SQL·RLS는 사용자 DB 담당이 확정한다."
}
```

### roles

```json
[
  {
    "role": "org_admin",
    "allows": "구성원/담당 관리, 전체 기관 학생 열람, 보관 요청",
    "denies": "고객센터 정정권 발급, 기관 밖 접근"
  },
  {
    "role": "teacher",
    "allows": "담당 학생 추가·입력·분석·목록·인쇄",
    "denies": "비담당 학생, 기관 밖 접근, 정정권 발급"
  },
  {
    "role": "viewer",
    "allows": "명시 배정된 학생 리포트 조회·인쇄",
    "denies": "학생/성적 생성·수정·분석·담당 변경·정정권 발급"
  }
]
```

### contract_and_price

```json
{
  "currency": "KRW",
  "price_per_analyzed_student": 33000,
  "billing_description": "교사 1명이 분석하는 학생 1명당 33,000원; 최초에는 견적/계약으로 학생 수를 정하고 수동 등록한다.",
  "capacity_authority": "verified_active_organization_contract.contracted_student_count",
  "seat_rule": "학생 추가와 계약 수 소모를 동일 transaction/CAS·멱등키로 처리한다. 담당 변경/보관은 새 학생으로 세지 않으며 임의로 소비 슬롯을 환급해 한도를 우회하지 않는다.",
  "automatic_payment_or_plan_change": false,
  "bulk_payment_UI": "DEFERRED",
  "minimum_design_students_per_teacher": 20
}
```

### score_input

```json
{
  "key": [
    "org_id",
    "student_id",
    "canonical_input_scope",
    "stage"
  ],
  "initial_attempts": 1,
  "support_correction_grants": 1,
  "semantic_impossible_score_rejection_consumes": true,
  "auth_structure_rate_or_known_precommit_failure_consumes": false,
  "org_admin_self_correction_allowed": false,
  "support_requires": [
    "fresh_active_admin_aal2",
    "exact_org_student_ticket_scope",
    "ticket_ref",
    "expected_version",
    "idempotency_key"
  ],
  "partial_success": "저장 성공 후 분리 분석 실패는 기존 profile_id·소비 상태로 재개; 자동 재저장 금지",
  "calendar": "개인용과 같은 승인 시험/pack 및 mock/provisional/final 공식 개방 창. 미연결/미확정 단계 fail closed."
}
```

### budget

```json
{
  "status": "CONTRACT_SCALE_POLICY_DESIGN_ACTUAL_VALUES_NOT_REGISTERED",
  "identity": [
    "org_id",
    "contract_id",
    "verified_teacher_id",
    "student_id",
    "input_scope",
    "stage"
  ],
  "student_rights_not_teacher_daily_distinct_score_limit": true,
  "acceptance": "계약·담당·학생별 권리가 유효한 교사가 20명 이상을 순차 처리해도 개인 계정의 3/10개 성적 한도를 일괄 적용해 차단하지 않는다.",
  "scaling": "학생별 입력권과 계약 학생 수에 따라 업무 예산을 명시 설정한다. 요청 빈도는 교사/기관·전체 단위로, 동시 실행·물리 bytes/시간·반환량은 공유 원자 한도로 보호한다.",
  "administrator_exemption_substitute": false,
  "unlimited_or_null_fallback": false,
  "capacity_twenty_means_twenty_parallel_jobs": false,
  "shared_concurrency_or_physical_limit_change": "별도 근거와 기존 비용 한도 내 검증 전 변경하지 않는다.",
  "owner_followup_20261023": {
    "status": "EXACT_RUNTIME_CATALOG_SCOPE_AND_CONTRACT_SCALE_VALIDATION_IN_PROGRESS",
    "catalog_scope": "Count academic-year/practical_required=false rows in the exact runtime service-catalog object and verify its source pin. Do not substitute the P1 display-row/school counts or a local historical catalog.",
    "design": "Preserve individual policies and positive per-offering physical costs. Contract/student input rights, reuse/idempotency and finite professional workload accounting must support sequential work for the adopted minimum student capacity.",
    "not_authorized": "No automatic common-cap widening, zero/unlimited/null fallback, administrator exemption, new resource or billing-plan change. A new approved policy requires exact values, version, scope, source/binding pins and shared physical/concurrency checks.",
    "readiness": "Do not register professional runtime settings until the exact active catalog, cost reservation and sequential multi-student acceptance have been checked."
  }
}
```

### DTOs

```json
{
  "envelope": [
    "format",
    "status",
    "org_id",
    "student_id",
    "data",
    "reason_codes",
    "request_id"
  ],
  "pro_session": [
    "organizations",
    "org_id",
    "role",
    "contract_status",
    "contract_expires_at",
    "contracted_student_count",
    "used_student_count",
    "remaining_student_count"
  ],
  "student": [
    "org_id",
    "student_id",
    "display_name",
    "class_label",
    "class_number",
    "tags",
    "memo",
    "archived",
    "version",
    "assigned_teacher_ids",
    "created_at_utc"
  ],
  "student_page": [
    "items",
    "next_cursor",
    "has_more"
  ],
  "student_score_status": [
    "org_id",
    "student_id",
    "exam_id",
    "pack_version",
    "stage",
    "initial_used",
    "initial_remaining",
    "correction_granted",
    "correction_used",
    "entry_version",
    "current_profile_id",
    "current_report_id",
    "last_rejection_code"
  ],
  "student_report": [
    "org_id",
    "student_id",
    "report_id",
    "revision_id",
    "exam_id",
    "stage",
    "profile_id",
    "published_result",
    "counseling_reasons",
    "created_at_utc"
  ],
  "reason": [
    "code",
    "status",
    "academic_year",
    "offering_id",
    "comparison_context",
    "values",
    "public_basis",
    "missing_reason"
  ],
  "reason_value": [
    "name",
    "value",
    "unit"
  ],
  "rules": "합성 계약으로 먼저 구현한다. 모든 학생 DTO는 org_id/student_id와 버전·소유권을 재검증한다. native 수치·null·미확정 상태를 보존하고 실제 데이터·비밀값·private 모형/분포는 공개 응답에 넣지 않는다.",
  "assignment": [
    "org_id",
    "student_id",
    "assigned_teacher_ids",
    "version"
  ],
  "member_page": [
    "org_id",
    "items",
    "next_cursor",
    "has_more"
  ],
  "student_profile": [
    "org_id",
    "student_id",
    "profile"
  ],
  "student_overall": [
    "org_id",
    "student_id",
    "report"
  ],
  "student_university_result": [
    "org_id",
    "student_id",
    "assessment"
  ],
  "student_candidates": [
    "org_id",
    "student_id",
    "candidates"
  ],
  "student_bookmarks": [
    "org_id",
    "student_id",
    "shortlist"
  ],
  "student_print_projection": [
    "org_id",
    "student_id",
    "snapshot",
    "watermark",
    "counseling_reasons"
  ],
  "student_report_page": [
    "org_id",
    "student_id",
    "items",
    "next_cursor",
    "has_more"
  ],
  "retention_manifest": [
    "org_id",
    "contract_id",
    "academic_year",
    "official_deadline_reference",
    "cutoff_at_utc",
    "manifest_sha256",
    "counts",
    "expected_previous_fingerprints",
    "approval_required"
  ],
  "retention_notice_targets": [
    "org_id",
    "contract_id",
    "due_at_utc",
    "notice_days_before",
    "authorized_member_ids",
    "counts"
  ],
  "organization_item": [
    "org_id",
    "org_name",
    "contract_id",
    "academic_year",
    "contract_version",
    "role",
    "contract_status",
    "contract_expires_at",
    "contracted_student_count",
    "used_student_count",
    "remaining_student_count"
  ],
  "member_item": [
    "member_id",
    "subject_id",
    "role",
    "status",
    "version"
  ],
  "comparison_context": [
    "academic_year",
    "reference_year",
    "metric",
    "score_scale",
    "population_id",
    "policy_version",
    "range_definition",
    "range_role"
  ],
  "public_basis": [
    "title",
    "url",
    "source_year"
  ],
  "watermark": [
    "organization_name",
    "teacher_code",
    "printed_at_seoul",
    "student_name"
  ],
  "retention_fingerprints": [
    "students",
    "profiles",
    "revisions"
  ]
}
```

### DTO_contract_refs

```json
{
  "student_profile": "backend_platform_contract.dto_schemas.profile",
  "student_overall": "backend_platform_contract.dto_schemas.report",
  "student_university_result": "backend_platform_contract.dto_schemas.assessment",
  "student_candidates": "backend_platform_contract.dto_schemas.candidates",
  "student_bookmarks": "backend_platform_contract.dto_schemas.shortlist",
  "student_print_projection": "backend_platform_contract.dto_schemas.snapshot",
  "student_score_status": "backend_platform_contract.dto_schemas.score_input_status"
}
```

### cursor_and_idempotency

```json
"목록 cursor는 목적·현재 subject·org/student·필터·판·만료를 서명에 결속한다. 개인 리포트 cursor를 기관용으로 재사용하지 않는다. 쓰기는 principal+작업+stage+정규화 본문 SHA에 멱등키를 결속하고 재시도에도 fresh 권한/계약/담당·예산을 확인한다."
```

### error_contract

```json
{
  "unauthenticated": 401,
  "other_org_or_unassigned_student": 404,
  "wrong_role_in_known_authorized_scope": 403,
  "contract_expired": 403,
  "contract_or_authority_unavailable": 503,
  "student_seat_limit_reached": 409,
  "expected_version_changed": 409,
  "input_right_exhausted": 409,
  "rate_limited": 429,
  "engine_basis_pending": "normal_pending_response_no_fabricated_values",
  "student_archived": 409,
  "initial_overall_report_required": 409
}
```

### candidate_operations

```json
[
  {
    "id": "pro.session",
    "method": "GET",
    "path": "/api/v1/pro/session",
    "access": "verified_member",
    "response_schema": "pro_session",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [],
      "body_fields": [],
      "query_fields": [],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.student.list",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/students",
    "access": "assigned_teacher_or_org_admin",
    "response_schema": "student_page",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id"
      ],
      "body_fields": [],
      "query_fields": [
        "limit",
        "cursor",
        "q",
        "class_label"
      ],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.student.create",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students",
    "access": "teacher_or_org_admin_with_contract_seat",
    "response_schema": "student",
    "effect": "idempotent_seat_reservation_and_create",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id"
      ],
      "body_fields": [
        "display_name",
        "class_label",
        "class_number",
        "tags",
        "memo",
        "expected_contract_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.student.read",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}",
    "access": "assigned_teacher_or_org_admin",
    "response_schema": "student",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [],
      "query_fields": [],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.student.update",
    "method": "PATCH",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}",
    "access": "assigned_teacher_or_org_admin",
    "response_schema": "student",
    "effect": "expected_version_metadata_update_not_score",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "display_name",
        "class_label",
        "class_number",
        "tags",
        "memo",
        "expected_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.student.archive",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/archive",
    "access": "org_admin_aal2",
    "response_schema": "student",
    "effect": "expected_version_archive_no_delete_or_seat_refund",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "expected_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.student.assign",
    "method": "PUT",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/assignments",
    "access": "org_admin_aal2",
    "response_schema": "assignment",
    "effect": "expected_version_assignment_change",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "assigned_teacher_ids",
        "expected_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.member.list",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/members",
    "access": "org_admin",
    "response_schema": "member_page",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id"
      ],
      "body_fields": [],
      "query_fields": [
        "limit",
        "cursor"
      ],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.score.status",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/score-input-status",
    "access": "assigned_teacher_or_org_admin",
    "response_schema": "student_score_status",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [],
      "query_fields": [
        "exam_id",
        "pack_version",
        "stage"
      ],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.score.create",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/score-profiles",
    "access": "assigned_teacher",
    "response_schema": "student_profile",
    "effect": "idempotent_student_stage_input_right",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "exam_id",
        "pack_version",
        "stage",
        "scores",
        "confirmed",
        "expected_entry_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.overall.analyze",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/overall-analysis",
    "access": "assigned_teacher",
    "response_schema": "student_overall",
    "effect": "reuse_approved_engine_no_new_input_right",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "profile_id",
        "expected_profile_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.report.list",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/reports",
    "access": "assigned_teacher_or_authorized_viewer_or_org_admin",
    "response_schema": "student_report_page",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [],
      "query_fields": [
        "limit",
        "cursor"
      ],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.report.read",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/reports/{report_id}",
    "access": "assigned_teacher_or_authorized_viewer_or_org_admin",
    "response_schema": "student_report",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id",
        "report_id"
      ],
      "body_fields": [],
      "query_fields": [],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.university.analyze",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/university-analysis",
    "access": "assigned_teacher",
    "response_schema": "student_university_result",
    "effect": "reuse_approved_engine",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "profile_id",
        "offering_id",
        "expected_profile_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.candidates",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/candidates",
    "access": "assigned_teacher",
    "response_schema": "student_candidates",
    "effect": "reuse_approved_engine",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "profile_id",
        "filters",
        "expected_profile_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.bookmark.list",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/bookmarks",
    "access": "assigned_teacher_or_authorized_viewer_or_org_admin",
    "response_schema": "student_bookmarks",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [],
      "query_fields": [
        "report_id"
      ],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.bookmark.add",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/bookmarks",
    "access": "assigned_teacher",
    "response_schema": "student_bookmarks",
    "effect": "idempotent_bookmark",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "report_id",
        "offering_id"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.report.export",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/reports/{report_id}/export",
    "access": "assigned_teacher_or_authorized_viewer_or_org_admin",
    "response_schema": "student_print_projection",
    "effect": "CSRF_protected_audited_private_output",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id",
        "report_id"
      ],
      "body_fields": [
        "revision_id"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.correction.grant",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/students/{student_id}/management/score-input-corrections",
    "access": "customer_support_active_admin_aal2_exact_ticket_scope",
    "response_schema": "student_score_status",
    "effect": "ticket_expected_version_idempotent_single_correction_grant",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id",
        "student_id"
      ],
      "body_fields": [
        "exam_id",
        "stage",
        "ticket_ref",
        "expected_version"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.retention.preview",
    "method": "POST",
    "path": "/api/v1/pro/organizations/{org_id}/management/retention-preview",
    "access": "platform_retention_operator_aal2",
    "response_schema": "retention_manifest",
    "effect": "dry_run_only_no_delete",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id"
      ],
      "body_fields": [
        "contract_id",
        "academic_year",
        "official_deadline_reference",
        "cutoff_at_utc"
      ],
      "query_fields": [],
      "Idempotency_Key_required": true,
      "BFF_CSRF_required": true,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  },
  {
    "id": "pro.retention.notice-targets",
    "method": "GET",
    "path": "/api/v1/pro/organizations/{org_id}/management/retention-notice-targets",
    "access": "platform_retention_operator_aal2",
    "response_schema": "retention_notice_targets",
    "effect": "read_only",
    "runtime_registration": "CODE_REGISTERED_RUNTIME_NOT_ACTIVATED",
    "request": {
      "path_parameters": [
        "org_id"
      ],
      "body_fields": [],
      "query_fields": [],
      "Idempotency_Key_required": false,
      "BFF_CSRF_required": false,
      "unknown_fields": "reject",
      "tenant_and_actor_from_client_body": "forbidden"
    }
  }
]
```

### ports

```json
[
  {
    "name": "ProfessionalAuthorityPort",
    "responsibility": "same Bearer user + active org contract/member/assignment fresh snapshot; platform support exact ticket scope"
  },
  {
    "name": "OrganizationStudentRepositoryPort",
    "responsibility": "parameterized scoped list/read/create/update/archive/assignment; contract seat CAS/idempotency in same transaction"
  },
  {
    "name": "StudentScoreInputPort",
    "responsibility": "student-scoped stage rights/attempts/corrections and profile transaction; preserve old records/known partial success"
  },
  {
    "name": "StudentReportPort",
    "responsibility": "same-org same-student profile/report revision/basis linkage, stable cursor, owner recheck at every read/export"
  },
  {
    "name": "ApprovedAnalysisPort",
    "responsibility": "call unchanged approved engine/exam pack/model; return typed ready/pending evidence; no private model in browser"
  },
  {
    "name": "ProfessionalUsagePort",
    "responsibility": "approved contract-scale policy; atomic reserve/finish and global physical/concurrency fail closed"
  },
  {
    "name": "ProfessionalAuditPort",
    "responsibility": "opaque IDs/action/result/request_id/ticket/time; no names, scores, tokens or free-text payload in logs"
  },
  {
    "name": "ProfessionalRetentionPort",
    "responsibility": "deadline evidence, scoped preview/counts/fingerprints/approvals; execution requires exact approved manifest and no global file deletion"
  }
]
```

### counseling_tips

```json
{
  "student_specific": "승인된 엔진/공식 자료 결과에서 검증된 사유 코드+정확 수치+단위+학년도/비교 맥락만 전달하고 화면의 고정 문장 틀로 표시한다.",
  "codes": [
    {
      "code": "subject_weight_strength",
      "basis": "당해 반영 비율·영역별 위치·환산 기준/전체 기준의 같은 집단 비교",
      "numeric_owner": "DB_engine_owner"
    },
    {
      "code": "comparable_historical_cut_delta",
      "basis": "동일 모집행/전형/척도/코호트의 과거 컷·당해 학생 환산값",
      "numeric_owner": "DB_engine_owner"
    },
    {
      "code": "admission_capacity_change",
      "basis": "연결이 검증된 모집행의 학년도별 공식 모집인원",
      "numeric_owner": "DB_engine_owner"
    },
    {
      "code": "historical_cut_spread",
      "basis": "같은 의미·척도의 검증된 3개년 컷; 누락/변경은 보류",
      "numeric_owner": "DB_engine_owner"
    },
    {
      "code": "english_deduction",
      "basis": "당해 영어 반영 규칙의 실제 엔진 적용 결과",
      "numeric_owner": "DB_engine_owner"
    },
    {
      "code": "history_deduction",
      "basis": "당해 한국사 반영 규칙의 실제 엔진 적용 결과",
      "numeric_owner": "DB_engine_owner"
    },
    {
      "code": "classification_basis",
      "basis": "엔진이 채택한 판단 구간(expected_acceptance_range)·학생 환산점수를 그대로 옮기고, 판단 근거에 들어 있는 검증된 전년 공식 발표 원문을 공개 근거로 붙인다. 새 산출 없음",
      "numeric_owner": "DB_engine_owner"
    }
  ],
  "current_basis_connection": "2027 대학별 환산·누백·판정 연결 범위의 실제 영수증 전 NOT_RUN; ready로 만들지 않는다.",
  "missing_basis": "사유 배열을 비우고 근거 자료 연결 전을 표시; 결측0·합격 단정·다른 집단 누백 비교·임의 산식 금지",
  "general_guide": "Owner/화면팀이 원문·출처 대조 후 버전별 공개. 개인 학생 실명·성적을 외부 모델로 전송하지 않는다.",
  "AI_external_generation": false,
  "yearly_rule_read": {
    "format": "jungsi.yearly-offering-rule-read/v1",
    "status": "INTERNAL_READ_PORT_SOURCE_SYNTHETIC_VERIFIED_SQL_POINT_ACCEPTED_OWNER_PENDING",
    "requirements": [
      "REQ-31",
      "REQ-24",
      "REQ-25",
      "REQ-26"
    ],
    "kind": "SERVER_APPLICATION_PORT_NOT_NEW_PUBLIC_HTTP_OPERATION",
    "identity": [
      "academic_year",
      "offering_pk"
    ],
    "academic_years": [
      2024,
      2025,
      2026,
      2027
    ],
    "source": "Current approved guide repository and exact rule/qualification references. Locally prepared fields do not silently supersede the current DB release.",
    "fields": [
      "area_reflection_weights_and_original_unit",
      "english_reflection_method_and_grade_values",
      "history_reflection_method_and_grade_values",
      "math_and_inquiry_bonus_conditions",
      "inquiry_subject_count_and_selection_method",
      "original_text_and_official_source_url",
      "source_academic_year_and_as_of",
      "rule_version_and_current_guide_head",
      "field_qualification_and_missingness",
      "approved_lineage_reference"
    ],
    "native_preservation": "Preserve strings, integers and decimal lexemes, field presence, actual zero, null, unknown and not-applicable distinctly. Preserve percentage versus score/deduction/bonus units and all conditional rules. Stored JSONB native values and retained field-presence/type metadata are distinct from pre-DB source bytes; JSONB cannot reconstruct an original numeric lexeme or original JSON-string encoding.",
    "bounded_read": "Parameterized exact year+PK lookup with the existing approved read role, source-head/qualification guard, request budget and finite response bound. No all-school raw table, private model, coefficients or review history in the response.",
    "lineage": "Cross-year comparison requires the existing verified lineage_button_link_allowed=true relation. Similar names or equal PK text across years do not establish a relation.",
    "consumers": "Owner server services compose comparison and display sentences from approved fields; the data/scoring owner retains SQL, repository adapters and conversion/percentile/decision engines.",
    "interpretation": "A changed weight alone does not prove a particular student gained or lost. Student-specific statements require the separately verified current-year evidence contract.",
    "acceptance": [
      "exact identity and source head; wrong year/PK rejected",
      "native type/unit and null/zero distinctions preserved",
      "partial/source-unverified rules remain explicitly pending",
      "same-year rule exceptions and cross-year lineage preserved",
      "no model/raw source/review payload or new authorization exposure"
    ],
    "native_DB_acceptance": "REUSED_THREE_UNCHANGED_SQL_BRANCHES_AND_NATIVE_DTO_PASS_SYNTHETIC_AUTHORITY_RETURN_RECHECK_SYNTHETIC_OWNER_NOT_RUN",
    "Owner_consumption_and_deployment": "NOT_RUN",
    "test_registration_policy": {
      "format": "jungsi.professional-guide-registration-policy/v1",
      "state": "COMMON_VALIDATOR_PREPARED_GUIDE_SOURCE_NOT_INTEGRATED",
      "canonical_verification": "professional_service_contract.counseling_tips.yearly_rule_read.verification",
      "test_path": "tests/edge/test_guide_rule_reference.ts",
      "separate_suite_entry": "supabase/functions/_shared/professional_guide_rule_test.ts",
      "required_requirements": [
        "REQ-24",
        "REQ-25",
        "REQ-26",
        "REQ-31"
      ],
      "rule": "Valid exact registration, existing professional source registry, verification layer/source/index SHA and selected-snapshot static import must all pass. Only this Guide test is excluded from public read3 classification. Unregistered neighbors, metadata or snapshot drift and native/operating promotion fail closed.",
      "count": "Positive native integer matches additive_guide_tests; actual separate suite JUnit count and existing21 operation-test names remain mandatory. Do not fix future total131/142 in common code.",
      "foundation_count_preserved": 656,
      "validation": "Synthetic metadata/snapshot counterexamples only; no service data, SQL writes, native acceptance, new HTTP operation or Owner permission."
    },
    "source_files": [
      "supabase/functions/_shared/jungsi/application/guide_rule_reference.ts",
      "supabase/functions/_shared/jungsi/infrastructure/current_guide_rule_postgres.ts"
    ],
    "verification": {
      "additive_guide_tests": 69,
      "retained_foundation_tests": 656,
      "private_native_SQL_receipt_sha256": "0c6310c7537acebc87487f893fb45e1739621bc96cff1917d6470a55692097db",
      "native_overlay_SQL_acceptance": "THREE_CURRENT_SQL_BRANCHES_PASS",
      "migration_Secrets_deployment_changes": 0,
      "format": "jungsi.professional-guide-verification/v1",
      "coverage": "PROFESSIONAL_GUIDE_REFERENCE_SYNTHETIC",
      "test_paths": [
        "tests/edge/test_guide_rule_reference.ts"
      ],
      "suite_entry": "supabase/functions/_shared/professional_guide_rule_test.ts",
      "test_count": 69,
      "baseline_foundation_count": 656,
      "source_bindings": [
        {
          "path": "tests/edge/test_guide_rule_reference.ts",
          "sha256": "d33e86d5fee396bba1486c0e00d0e39ce299882427f82861b9138615b0f4d86f"
        },
        {
          "path": "supabase/functions/_shared/professional_guide_rule_test.ts",
          "sha256": "8a645f334e9e32f18b107e4991efb204b6e4387641c9a00d357dc9e093e39fba"
        }
      ],
      "native_acceptance": "NOT_VERIFIED_BY_SOURCE_SUITE",
      "activation_status": "NOT_RUN",
      "operating_writes": 0
    },
    "server_composition": {
      "construct": "new GuideRuleReferenceService(new CurrentGuideRulePostgres(sql, loadSourceApproval, clock), clock, professionalPolicy)",
      "read": "await guideRules.read(existingProfessionalScope, academicYear, offeringPk)",
      "location": "Existing authorized and budgeted Owner server operation after current organization/member/student authorization. NativeProfessionalRuntime request-local SQL, clock and approved ProfessionalPolicy are the composition dependencies.",
      "source_approval": "verifyGuideRuleSourceApproval(bytes, serverPinnedSha256, clock) validates an independently approved private source descriptor; no request-supplied fingerprint, new HTTP route, Secret registration or automatic runtime wiring.",
      "dedicated_read": "Use a separate read-only SQL frame; surrounding write transactions are rejected.",
      "output": "jungsi.guide-rule-reference/v1; field present/original_field_type/qualification/projection_status/value and approved_lineage. Unsafe required conditions withhold the whole field; unsafe identity metadata rejects the request."
    },
    "pending": [
      "Owner approval-loader composition and real JWT/org/member/student/BFF acceptance",
      "Per-field official-source qualification remains independent; missing URL or unverified source is not ready",
      "No claim of all-school guide qualification or local V33 DB synchronization"
    ],
    "internal_DTO": {
      "format": "jungsi.guide-rule-reference/v1",
      "status": [
        "collected_reference",
        "pending"
      ],
      "field_reference": [
        "present",
        "original_field_type",
        "qualification",
        "source_uncertainties",
        "verification_status",
        "projection_status",
        "value_when_preserved"
      ],
      "source_qualification": [
        "canonical_rule_status",
        "original_source_census_complete",
        "verification_status"
      ],
      "verification_status": "pending_independent_qualification",
      "source_url_missing": "null; do not infer an official URL or promote the source to ready",
      "unsafe_required_qualification": "withhold the entire field value; preserve presence and a missing reason",
      "native_type_scope": "Current stored JSONB values and retained original-field type metadata; no reconstruction of pre-DB original bytes"
    },
    "source_revalidation": "No repeatable-read promise is inferred from the existing SQL pool interface. Before return, requery and compare exact bounded metadata/ACL/view definitions, current year-PK header, native binding, selected rule projection and lineage; separately check all command states and approval expiry. This is a read-only double observation, not a new writer lock or a deployment acceptance."
  },
  "owner_tip_followup_20261023": {
    "status": "FEATURE_SOURCE_REVIEW_NOT_INTEGRATED_OR_OPERATING_ACCEPTANCE",
    "feature_commit": "effa3f51895fd1e3ac4d72fd5657316b5c0c5a52",
    "classification_basis": "Copy only the approved engine converted score and adopted expected range with the same offering/year/scale. The verified prior official publication URL is a source reference; it does not make the service expected range a university announcement.",
    "population_and_policy": "comparison_context.population_id identifies the actual verified student population. Do not fill it with a decision-policy version; preserve policy_version under its own explicit contract field.",
    "precision": "Do not derive counseling differences by converting exact native decimal strings to a JavaScript Number. Preserve the original score/range or use the existing exact arithmetic.",
    "additional_codes": "rule_weight_change and prior_competition remain separate proposed contracts until source/schema/tests are synchronized. Current ready-only filtering is retained; unimplemented pending reasons do not bypass it.",
    "reserve_and_count": "Last admitted reserve number (번) and actual additional admitted people (명) are distinct metrics. Never use one as the other in prior_competition.",
    "historical_spread": "A within-year 50%-to-70% gap is different from a three-year 70%-cut movement. Keep separate code/label/axis definitions and do not pool incomparable cohorts/scales.",
    "print": "Only the same fixed report revision and authorized org/student evidence may be included in the print projection; no new unapproved calculation or customer data logging."
  },
  "advantage_definition": {
    "format": "jungsi.converted-position-advantage-definition/v1",
    "definition": "delta_pp = approved baseline inclusive upper-cumulative percentile minus the university-converted-score inclusive upper-cumulative percentile; positive=favorable, negative=unfavorable, zero=neutral.",
    "baseline": "The engine baseline is the approved current-year target total distribution for Korean+math+inquiry1+inquiry2 standard scores; it is not an arbitrary prior-year raw score or a score/max ratio.",
    "guards": "Same academic year, exam, actual population, validated nonsynthetic distribution, approved baseline version and include_equal tie policy. Missing or incompatible evidence returns null/pending; no zero substitution.",
    "limitation": "This is a percentage-point position difference, not admission probability or an assurance that last-year results repeat.",
    "source": "supabase/functions/_shared/jungsi/application/offering_analysis.ts"
  },
  "owner_tip_semantics_source_review_20261023": {
    "status": "SOURCE_SYNTHETIC_ONLY_NOT_DEPLOYED",
    "baseline": "effa3f51895fd1e3ac4d72fd5657316b5c0c5a52",
    "scope": "classification baseline context and exact decimal display; neutral rule-weight comparison; three-year historical code separate from demo_prior_year_cut_band synthetic display only",
    "tests": "existing professional74 plus semantic11; presentation tip7; normal hooks and exact CI recorded separately",
    "operating_requests": 0,
    "DB_or_engine_changes": 0
  }
}
```

### privacy_and_retention

```json
{
  "collect": [
    "display_name",
    "class_label",
    "class_number",
    "tags",
    "memo"
  ],
  "reject": [
    "phone",
    "resident_registration_number",
    "student_email_login"
  ],
  "storage_design_owner": "user_DB_owner; encrypted student names and scoped lookup/key lifecycle design before live",
  "print": "기관명·교사 코드·서울 출력시각 워터마크, 이름은 본인 전달 출력물만. 공개 링크/공유 캐시/URL/로그에 실명·성적을 넣지 않는다.",
  "policy": "해당 학년도 정시 원서접수 종료일 다음날 학생 이름·성적·리포트 파기",
  "deadline_timezone": "Asia/Seoul; persist instants UTC",
  "official_deadline_source": "https://kcue.or.kr/news/sub02/sub01.php?at=view&idx=2764313",
  "official_deadline_status": "2027 공식 개정본 위치 확인; 계약 적용 날짜/범위 전사·검수 전 자동 실행 금지",
  "notices_days_before": [
    14,
    3
  ],
  "notice_sender": "EduTouch; recipients only under verified tenant authority",
  "execution": "파기 정책 합의와 개별 실행 승인을 구분한다. 정확 계약/학년도/학생·profile/report ID·DB행·Storage/캐시·백업 범위, 건수/이전 해시/보존 제외 근거의 dry-run 명부를 확정하고 기존 A–F/단일 writer 절차로 실행한다. 이번 기획은 파일·폴더·과거 원문·이전 버전·모형의 삭제 허용이 아니다.",
  "result_receipt": "파기 건수·시각·승인 명부 지문·실제 재조회 결과만 보존; 학생 식별 본문을 감사 기록에 복제하지 않는다.",
  "automatic_job_created": false
}
```

### acceptance_cases

```json
[
  "two_orgs_same_teacher_no_cross_tenant_or_personal_report_leak",
  "teacher_unassigned_student_404_even_known_ID",
  "viewer_and_org_admin_cannot_grant_score_correction",
  "fresh_support_aal2_ticket_expected_version_idempotent_only",
  "contract_last_seat_two_concurrent_creates_one_commit",
  "teacher_with_20_authorized_students_sequential_input_without_personal_distinct_limit",
  "same_student_second_initial_rejected_correction_exactly_once",
  "semantic_rejection_consumes_structure_auth_429_precommit_failure_does_not",
  "reassignment_revocation_expiry_checked_next_request",
  "partial_profile_success_analysis_5xx_no_resave",
  "report_cursor_bind_org_student_subject_scope_no_swap",
  "browser_artifact_no_private_names_models_keys_scores_or_shared_personal_cache",
  "tip_pending_missing_incomparable_basis_no_fabricated_numeric_or_admission_guarantee",
  "retention_preview_official_date_scoped_approval_no_automatic_global_delete"
]
```

<!-- jungsi:generated spec_sha256=9ca38fd61c8ba016370aad049f11794c43fbf400e6dfb1388fe95633213262fe -->
