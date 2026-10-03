# HTTP API와 학생 DTO 계약

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.2.2이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

Authorization: Bearer <Supabase access token>. 서버가 /auth/v1/user로 검증한 사용자 UUID와 검증 후 JWT sub/exp를 맞춘다. client/user_metadata의 paid 플래그는 무시하며 DB active/starts_at/expires_at을 UTC 현재 시각과 비교한다.

POST/PUT은 Idempotency-Key 등록 토큰이 필수다. 같은 사용자/작업/키의 동일 요청은 최초 결과를 현재 권한으로 반환하고 다른 본문/경로는 409다. 리포트 갱신은 expected_version CAS와 PostgreSQL 트랜잭션을 사용한다.

권한은 body·query 검증/자료 조회/멱등 조회보다 먼저 검사한다. unknown field와 중복 query key는 거절한다. 숫자 점수/누적은 엔진의 소수 문자열이며 원자료/전체 분포/가중치/비밀값/로컬 출처 경로는 제공하지 않는다. 모든 응답은 Cache-Control: no-store다.

## 12개 요청과 응답

| API | 메서드/경로 | 본문 | 쿼리 | 응답 DTO | 키 필수 |
| --- | --- | --- | --- | --- | --- |
| history.search | GET /api/v1/admission-history | 없음 | academic_year (2024~2027 선택), university_q, department_q, region, group, cursor, limit (1~100; 기본 50) | catalog_search (items=history_metric); backend_platform_contract.dto_schemas.catalog_search | False |
| recruitment.read | GET /api/v1/offerings/{offering_id}/recruitment | 없음 | 없음 | recruitment; backend_platform_contract.dto_schemas.recruitment | False |
| score-profile.create | POST /api/v1/score-profiles | scores: 기존 overall_analysis_contract 입력; confirmed: boolean | 없음 | profile; backend_platform_contract.dto_schemas.profile | True |
| overall.analyze | POST /api/v1/overall-reports | profile_id; report_id (갱신 시 선택); expected_version (report_id 갱신 시 필수); 또는 DEV-001 flat 성적 입력; 이때 unconfirmed 프로필 생성 | 없음 | report; backend_platform_contract.dto_schemas.report | True |
| report.read | GET /api/v1/reports/{report_id} | 없음 | 없음 | report; backend_platform_contract.dto_schemas.report | False |
| offerings.search | GET /api/v1/offerings/search | 없음 | academic_year (2024~2027 선택), university_q, department_q, region, group, cursor, limit (1~100; 기본 50) | catalog_search (items=offering); backend_platform_contract.dto_schemas.catalog_search | False |
| offering.read | GET /api/v1/offerings/{offering_id} | 없음 | 없음 | {status, reason_code, offering, catalog_version}; backend_platform_contract.dto_schemas.offering_detail | False |
| university.analyze | POST /api/v1/reports/{report_id}/university-results | expected_version: positive integer; offering_ids: 서로 다른 등록 ID 1~100개 | 없음 | report (analyses 갱신); backend_platform_contract.dto_schemas.report | True |
| candidates.build | POST /api/v1/reports/{report_id}/candidates | expected_version: positive integer | 없음 | report (analyses/candidates 갱신); backend_platform_contract.dto_schemas.report | True |
| shortlist.update | PUT /api/v1/reports/{report_id}/shortlist/{offering_id} | selected: boolean; expected_version: positive integer | 없음 | report (shortlist 갱신); backend_platform_contract.dto_schemas.report | True |
| report.export | GET /api/v1/reports/{report_id}/print | 없음 | 없음 | snapshot; backend_platform_contract.dto_schemas.snapshot | False |
| statistics.read | GET /api/v1/reports/{report_id}/offerings/{offering_id}/live-statistics | 없음 | 없음 | statistics; backend_platform_contract.dto_schemas.statistics | False |

모든 HTTP 업무 서비스는 PlatformService.execute이며 FastAPI create_app이 경로를 등록한다. 요청은 operations[].http_contract, 응답은 해당 contract_ref를 따른다. overall.analyze의 HTTP 응답은 persisted report이고 내부 overall 필드만 기존 OverallAnalysisService의 jungsi.overall-analysis/v1 엔진 DTO다. 두 객체를 루트 응답으로 혼동하지 않는다.

## 오류와 대기

오류 객체는 {status:error,error:{code},request_id}이며 비밀값·예외 원문을 포함하지 않는다. 자료 대기는 200 응답의 status=pending/reason_code와 값 null로 구분한다. 전체 분석이 pending이어도 입력 총점·과목 결과는 보존한다.

| 오류 코드 | HTTP | 의미 |
| --- | --- | --- |
| authentication_required | 401 | 인증 누락/거부/만료 |
| paid_required | 403 | 일반회원 유료 작업 차단; 결과/건수 없음 |
| report_not_found / profile_not_found / offering_not_found | 404 | 본인 범위의 리소스 없음; 타인 리포트도 같은 404 |
| score_confirmation_required / revision_conflict / idempotency_conflict / cursor_version_mismatch | 409 | 확인 성적 또는 요청/리포트/카탈로그 버전 재확인 |
| invalid_request / invalid_identifier / invalid_json / duplicate_query_field / engine_input_code | 422 | 허용 필드·성적·ID·형식 검증 실패 |
| request_too_large | 413 | 200000 byte 요청 제한 |
| storage_not_configured / storage_unavailable / auth_not_configured / auth_unavailable / catalog_release_not_approved / backend_dependency_unavailable | 503 | 의존 서비스/자료 미준비; 비밀값·원성적·예외 원문 제외 |

대학 계산의 개별 자료 해시/버전/승인 불일치는 해당 assessment의 pending이다. 카탈로그 전체 형식/승인 실패와 공급 서비스 실패는 503이다.

## 응답 객체

### profile

필드: profile_id, profile_version, confirmed, created_at.

- confirmed는 입력 성적을 사용자가 확인했다는 뜻이며 서버 이용권·자료 승인·입시 자격을 뜻하지 않는다.
- 새 입력은 새 profile_id다. 기존 성적을 수정하지 않는다.

### report

format: jungsi.persisted-report/v1

필드: format, report_id, report_version, profile_id, updated_at, overall.

유료 추가 필드: analyses, candidates, shortlist, analysis_status.

- overall은 기존 jungsi.overall-analysis/v1 학생 DTO다.
- 일반회원 응답은 paid_fields를 제외한다. 조회와 멱등 재응답에서도 현재 이용권을 다시 적용한다.
- report_version은 정수 revision이며 갱신 요청의 expected_version과 비교한다.
- 성적 변경은 새 프로필을 연결한 리포트 revision을 만들고 기존 분석/후보를 무효화하며 선택 항목은 needs_revalidation으로 보존한다.

### catalog_search

필드: status, reason_code, items, matching_offering_count, matching_school_count, catalog_version, as_of, next_cursor.

- 대학·학과·지역·군 조건은 같은 모집행에 AND 적용한다.
- cursor는 카탈로그 버전·조회 조건·위치를 결속한다. 다른 조건/버전의 재사용은 409다.
- 자료 미발행은 items=null와 건수 null이다. 실제 승인 카탈로그의 0건과 구분한다.
- history.search는 items에 공식 지표를 포함하고 offerings.search는 모집행 기본 정보만 제공한다.

### offering

필드: offering_id, academic_year, university_id, university_name, campus, department, track, group, region, wildcard_group.

- 학과명이 아니라 검수된 practical_required로 실제 실기 반영 모집행을 제외한다.
- wildcard_group은 승인 자료의 nursing/health/education 분류를 사용한다.

### history_metric

필드: offering 모집행 필드, metric_name, metric_definition, value, unit, original_scale, publication_status, source_url, source_as_of.

- verification_status=verified_official인 자료만 반환한다. 승인 플래그 자체·원문·로컬 경로·해시는 반환하지 않는다.
- 평균/50%/70%/최저와 점수 종류를 변환·대체하지 않는다. 미발표는 null과 발표 상태로 보존한다.

### recruitment

필드: status, reason_code, offering, recruitment, catalog_version.

| 중첩 객체 | 필드 |
| --- | --- |
| recruitment | initial_count, rollover_change, final_count, count_status, changes, source_url, source_as_of, deadline, deadline_at |
| changes | kind, delta, announced_date, announced_at, source_url, status, reason, revision |

- initial_count·rollover_change·final_count는 정수 또는 null이다. 최초 0과 미공개 null을 구분한다.
- deadline/announced_date는 date-only, deadline_at/announced_at는 UTC instant다.
- 변경 이력을 모두 포함하되 원문·비공개 메타데이터는 허용 필드 목록에서 제외한다.

### assessment

필드: offering_id, status, reason_code, converted_score, converted_percentile, category, advantage, years, versions, eligibility_status, decision_components, decision_evidence.

| 중첩 객체 | 필드 |
| --- | --- |
| years | academic_year, offering_id, score_basis, converted_score, status, reason_code |
| advantage | delta_pp, status, baseline_version |
| decision_components | base_category, adjusted_category, adopted_category, base_policy_version, adjustment_version |
| decision_evidence | version, historical_metrics, forecast_70, expected_acceptance_range |

- 각 모집행의 2024~2027 승인 연도보정 → 당시 공식 환산식 → 전용 모집단 분포를 기존 엔진으로 계산한다. 현재 점수를 과거 공식식에 직접 대입하지 않는다.
- 지원 구간과 환산 유불리는 별도다. 유불리는 같은 연도/시험/전체 모집단의 학생 보정총점 상위 누적과 대학 환산 상위 누적의 차이(pp)다.
- category=challenge/core/room/outside/pending/ineligible. 학교 category를 학과에 복사하지 않는다.
- eligibility_status는 입력 등급/선택과목과 승인 요건을 비교한다. 별도 자격 확인 포트가 없는 비성적 요건은 needs_confirmation이다.
- decision_evidence는 승인 정책과 동일한 context/version을 결속한다. 과거 발표 지표의 이름·정의·단위·척도, 올해 forecast_70의 값·정의·단위·version, 지원 판단용 expected_acceptance_range의 lower/upper·정의·unit·policy_version을 구분한다.
- 미발행 forecast_70은 value=null/status=pending이고 승인된 판단 구간으로 학과 판단을 계산할 수 있다. 미승인/불일치 근거는 decision_evidence_unapproved로 보류한다.
- 기본/상담 조정/채택 category와 버전을 분리한다. 조정은 승인 base_version의 최종 구간을 학생 점수로 한 번 평가한다.
- versions에는 profile·pack·source_model·bridge·rule·curve·decision·evidence·population·target_exam·tie_policy·eligibility·선택적 adjustment가 포함된다. 내부 분포·가중치·실행 trace는 반환하지 않는다.

### candidates

필드: status, reason_code, basic_university_groups, wildcards, pending_offerings, catalog_version.

- 현재 시험의 학년도 모집행을 대상으로 하고 각 assessment.years에는 4개년 비교를 담는다.
- 기본 그룹은 대학별 offerings 배열이며 각 항목에 모집행과 개별 assessment를 포함한다.
- 간호/보건/교육 wildcard와 대기 모집행을 별도 배열로 반환한다. 화면의 2:1 배치는 프레젠테이션 담당이다.

### shortlist

필드: selected, changed_at, assessment_status, profile_id, catalog_version.

- report.shortlist는 offering_id를 키로 한 객체다. 해제도 selected=false로 보존한다.
- 같은 상태 쓰기는 revision을 올리지 않지만 요청 키/결과는 보존한다. 이후 상태가 바뀌어도 이전 키의 응답은 고정된다.

### snapshot

format: jungsi.counseling-snapshot/v1

필드: format, status, snapshot_version, generated_at, report.

- snapshot_version은 고정된 report_version이고 report는 현재 권한을 적용한 상담 DTO다. GET은 Drive 쓰기를 수행하지 않는다.
- 서버 내부 ReportPublicationService는 같은 revision의 updated_at을 generated_at으로 채택하여 재시도 내용 해시를 고정하고 별도 비공개 폴더에 새 파일을 기록한다.
- 인쇄/PDF 렌더링은 별도 UI 담당이다.

### statistics

필드: status, reason_code, recommended_count, selected_count, recommended_rank, selected_rank, updated_at, scope, versions.

| 중첩 객체 | 필드 |
| --- | --- |
| rank | rank, tie_count, population_count, tie_policy |

- 같은 모집행·시험/모집단·자료/환산/보정/판단 버전의 학생별 최신 리포트만 집계한다. profile_id는 학생마다 다르므로 비교 context에서 제외하고 각 선택의 최신 profile 결속은 따로 확인한다.
- 추천은 승인 후보에 포함된 학생, 선택은 최신 프로필의 유효 선택 학생이다. 두 집단을 각각 학생 중복 제거한다.
- 본인 rank=1+본인보다 높은 점수의 인원이며 동점자는 같은 competition 순위다. 본인이 해당 집단에 없으면 rank=null이다.
- 다른 학생 ID/성적/리포트 목록은 반환하지 않는다. 미분석은 건수/순위 null이다. scope는 service_users_not_actual_university_applicants다.

### offering_detail

필드: status, reason_code, offering, catalog_version.

- offering은 모집행 기본 DTO다. 개인 환산/지원 판단은 report.analyses로 구분한다.
- 미발행 자료는 status=pending/offering=null이다. 검증된 카탈로그에 없는 ID는 404다.

## 시간 표시

서버 instant는 UTC Z, 날짜는 YYYY-MM-DD다. 화면은 instant만 Asia/Seoul로 변환하고 date-only에 시각을 붙이지 않는다. 401은 재인증, 403은 현재 이용권, 409는 확인 성적/최신 revision·카탈로그/요청 키를 재확인한다. 재시도는 같은 본문·경로·키를 보존한다. UI/인쇄 렌더링은 별도 담당이다.

<!-- jungsi:generated spec_sha256=cf7348bc2caa2afb19b88969d6d04e9fa7f340f7d895e7bf34ea2392c537cc93 -->
