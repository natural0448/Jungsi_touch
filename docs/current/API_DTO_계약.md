# HTTP API와 학생 DTO 계약

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.7.1이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

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
| session.read | GET /api/v1/me | 없음 | 없음 | session; backend_platform_contract.dto_schemas.session | False |
| forecast.capabilities | GET /api/v1/forecast-capabilities | 없음 | 없음 | forecast_capabilities; backend_platform_contract.dto_schemas.forecast_capabilities | False |
| forecast.list | GET /api/v1/forecast-drafts | 없음 | university_id (선택) | forecast_list; backend_platform_contract.dto_schemas.forecast_list | False |
| forecast.create | POST /api/v1/offerings/{offering_id}/forecast-drafts | input_id; input_version; policy_id; policy_version | 없음 | forecast_draft; backend_platform_contract.dto_schemas.forecast_draft | True |
| forecast.read | GET /api/v1/forecast-drafts/{draft_id} | 없음 | 없음 | forecast_draft; backend_platform_contract.dto_schemas.forecast_draft | False |
| forecast.adjust | POST /api/v1/forecast-drafts/{draft_id}/adjustments | expected_revision; base_result_hash; policy_version; target: forecast_70/acceptance_range/category_ranges; replacement: 승인 정책이 허용한 동일 단위의 명시적 대체값; reason; evidence_refs: 서버 검증 ID 목록 | 없음 | forecast_draft; backend_platform_contract.dto_schemas.forecast_draft | True |
| forecast.validate | POST /api/v1/forecast-drafts/{draft_id}/validations | expected_revision; base_result_hash; policy_version | 없음 | forecast_draft; backend_platform_contract.dto_schemas.forecast_draft | True |
| forecast.approve | POST /api/v1/forecast-drafts/{draft_id}/approvals | expected_revision; base_result_hash; policy_version; validation_receipt_hash; reason | 없음 | forecast_draft; backend_platform_contract.dto_schemas.forecast_draft | True |
| forecast.publish | POST /api/v1/forecast-drafts/{draft_id}/publications | expected_revision; base_result_hash; policy_version; approval_receipt_hash | 없음 | forecast_draft; backend_platform_contract.dto_schemas.forecast_draft | True |
| forecast.published.read | GET /api/v1/offerings/{offering_id}/forecast | 없음 | 없음 | forecast_public; backend_platform_contract.dto_schemas.forecast_public | False |

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

필드: offering_id, status, reason_code, converted_score, converted_percentile, category, advantage, years, versions, eligibility_status, decision_components, decision_evidence, conversion, percentile, recommendation_reasons.

| 중첩 객체 | 필드 |
| --- | --- |
| years | academic_year, offering_id, score_basis, converted_score, status, reason_code |
| advantage | delta_pp, status, baseline_version |
| decision_components | base_category, adjusted_category, adopted_category, base_policy_version, adjustment_version |
| decision_evidence | version, historical_metrics, forecast_70, expected_acceptance_range, forecast_release_version, basis_summary, issue_summaries, recommendation_reasons, adjustment_summary, context, policy_version, input_version |
| conversion | status, reason_code, score_basis, score_scope, converted_score, official_max_score, academic_year, exam_id, rule_version, release_version, table_versions, profile_version, pack_version |
| percentile | status, reason_code, score_basis, score_scope, academic_year, exam_id, top_percent, inclusive_top_percent, exclusive_top_percent, tie_share_percent, tie_policy, population_id, data_kind, rule_version, curve_version, release_version, source_model_version, profile_version, pack_version, population_scope |
| recommendation_reasons | code, text, evidence_refs |
| decision_evidence.context | offering_id, academic_year, exam_id, source_pack_version, catalog_version, rule_id, rule_version, curve_version, analysis_version, score_scale_id, score_scope, bonus_treatment, population_id, comparison_metric, unit, direction, tie_policy |

- 동일 학년도 실제 수능은 독립 승인 환산 포트로 actual_exam을 계산한다. 별도 승인 모평 호환은 mock_exam이며, 다른 학년도 비교는 승인 bridge → 당시 공식 환산식의 year_equated_estimate다.
- 지원 구간과 환산 유불리는 별도다. 유불리는 같은 연도/시험/전체 모집단의 학생 보정총점 상위 누적과 대학 환산 상위 누적의 차이(pp)다.
- category=challenge/core/room/outside/pending/ineligible. 학교 category를 학과에 복사하지 않는다.
- eligibility_status는 입력 등급/선택과목과 승인 요건을 비교한다. 별도 자격 확인 포트가 없는 비성적 요건은 needs_confirmation이다.
- decision_evidence는 승인 정책과 동일한 context/version을 결속한다. 과거 발표 지표의 이름·정의·단위·척도, 올해 forecast_70의 값·정의·단위·version, 지원 판단용 expected_acceptance_range의 lower/upper·정의·unit·policy_version을 구분한다.
- 미발행 forecast_70은 value=null/status=pending이고 승인된 판단 구간으로 학과 판단을 계산할 수 있다. 미승인/불일치 근거는 decision_evidence_unapproved로 보류한다.
- 기본/상담 조정/채택 category와 버전을 분리한다. 조정은 승인 base_version의 최종 구간을 학생 점수로 한 번 평가한다.
- versions에는 profile·pack·source_model·bridge·rule·curve·decision·evidence·population·target_exam·tie_policy·eligibility·선택적 adjustment가 포함된다. 내부 분포·가중치·실행 trace는 반환하지 않는다.
- conversion.ready와 assessment.pending은 함께 존재할 수 있다. 대학 분포·입결·지원 판단·자격 미확인은 각각의 사유로 보존한다.
- 기존 assessment.converted_score는 계산 완료 값과 일치한다. 판단이 pending이어도 환산 성공 값을 없애지 않는다. years는 학년도별 실제/모평/보정 추정 기준과 pending 사유를 구분한다.
- 독립 conversion은 지원 판단·자격·유불리를 승인하지 않는다. 전체 곡선이나 분석 공급 오류가 있어도 conversion.ready 점수는 보존하며 years의 현재 행은 실제/모평 기준으로 표시한다.
- 분포 조회·판단·상담 조정은 지정 노드 반올림까지 적용한 정확 Fraction 점수를 사용한다. 표시 문자열을 후속 계산 입력으로 사용하지 않는다.
- conversion.ready / percentile.ready / assessment.pending은 함께 존재할 수 있다. conversion.ready / percentile.pending도 가능하며 환산 성공을 보존한다. 누백 준비만으로 지원 판단·자격·유불리를 승인하지 않는다. percentile이 ready이면 기존 assessment.converted_percentile은 top_percent와 일치한다. pending인 경우 null과 사유를 보존한다. 기존 승인 보정 경로의 성공 converted_percentile은 같은 의미의 percentile DTO로 노출한다.
- conversion.ready / percentile.ready / assessment.pending은 함께 존재할 수 있다. conversion.ready / percentile.pending도 가능하며 환산 성공을 보존한다. 누백 준비만으로 지원 판단·자격·유불리를 승인하지 않는다.
- percentile이 ready이면 기존 assessment.converted_percentile은 top_percent와 일치한다. pending인 경우 null과 사유를 보존한다. 기존 승인 보정 경로의 성공 converted_percentile은 같은 의미의 percentile DTO로 노출한다.
- 관측 도수 observed_counts와 모형 가중치 estimated_weights를 표시 기준에서 구분한다. 모집단과 시험/학년도/규칙/곡선 버전을 함께 보존한다.
- DEV005 명시적 승인 비교집단의 population_scope를 반환한다. whole_complete와 required_rule_inputs_present를 혼용하지 않고 모집단이 다르면 환산 유불리는 보류한다. 미응시를 최저점으로 치환하지 않는다.
- 반영 방법 설명은 assessment.recommendation_reasons의 등록 code/text/evidence_refs로 반환한다. conversion에 rule_explanations를 별도로 넣지 않는다.
- decision_evidence.context/policy_version/input_version은 채택 발표본 기준이며 forecast_public과 전체가 일치할 때만 같은 근거로 합친다.
- 발표본이 변경되면 이전 학생 판정을 새 기준으로 덮어쓰지 않고 재분석 상태와 사유를 제공한다.

### candidates

필드: status, reason_code, basic_university_groups, wildcards, pending_offerings, catalog_version, outside_offerings, ineligible_offerings.

- 현재 시험의 학년도 모집행을 대상으로 하고 각 assessment.years에는 4개년 비교를 담는다.
- 기본 그룹은 대학별 offerings 배열이며 각 항목에 모집행과 개별 assessment를 포함한다.
- 간호/보건/교육 wildcard와 대기 모집행을 별도 배열로 반환한다. 화면의 2:1 배치는 프레젠테이션 담당이다.
- outside_offerings·ineligible_offerings·pending_offerings는 각각 판단 완료 추천 범위 밖·지원 조건 미충족·판단 보류이며 혼용하지 않는다.
- status는추천학교수의bool이아니다. outside/ineligible만있는계산완료빈추천은ready이며 실제판단보류자료부재는pending으로구분한다.
- 일부완료/일부보류이면완료결과와실제pending_offerings를함께반환한다.

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

### session

format: jungsi.session/v1

필드: format, member_tier, entitlement_expires_at.

- 본인 검증 신원과 서버 활성 이용권만 사용한다. 활성 이용권은 starts_at<=now<expires_at이며 status=active와 정시 서비스 product를 만족한다. 복수 활성 권한은 가장 늦은 만료를 UTC Z로 반환한다.
- 일반 회원 만료는 null. 인증 또는 저장소 장애는 503이며 일반 회원으로 자동 강등하지 않는다. 사용자 ID·등급·역할·JWT·결제 내역을 요청/응답에 포함하지 않는다.

### forecast_capabilities

format: jungsi.forecast-capabilities/v1

필드: format, capabilities, university_ids.

- 서버 관리 권한 포트에서 editor/approver와 허용 학교 ID를 조회한다. 회원 등급과 독립이다. 미허용 사용자는 빈 capability이며 관리 draft 접근은 403/404로 차단한다.

### forecast_draft

format: jungsi.forecast-draft/v1

필드: format, draft_id, offering_id, revision, status, base_result_hash, policy_version, result, adjustments, validation, approval, audit_events, base_result, context, created_at, updated_at.

| 중첩 객체 | 필드 |
| --- | --- |
| context | offering_id, offering_lineage_id, academic_year, university_id, campus, department, track, group, exam_id, source_pack_version, catalog_version, analysis_version, rule_id, rule_version, curve_version, population_id, score_scope, score_scale_id, bonus_treatment, unit |
| result | forecast_70, acceptance_range, category_ranges |
| base_result | forecast_70, acceptance_range, category_ranges |
| result.forecast_70 | status, reason_code, value, unit, definition, version |
| result.acceptance_range | status, reason_code, lower, upper, unit, definition, policy_version |
| result.category_ranges | category, lower, upper |
| base_result.forecast_70 | status, reason_code, value, unit, definition, version |
| base_result.acceptance_range | status, reason_code, lower, upper, unit, definition, policy_version |
| base_result.category_ranges | category, lower, upper |
| adjustments | target, replacement, reason, evidence_refs, actor, at, base_result_hash |
| adjustments.replacement.forecast_70 | value, unit |
| adjustments.replacement.acceptance_range | lower, upper, unit |
| adjustments.replacement.category_ranges | ranges |
| adjustments.replacement.category_ranges.ranges | category, lower, upper |
| validation | status, reason_code, checks, validated_revision, result_hash, receipt_hash, at |
| approval | approved_revision, result_hash, validation_hash, approval_hash, reason, at |
| audit_events | action, actor, at |

- 허용 학교의 관리 사용자만 조회한다. 기본·조정·채택 결과, immutable revision, 근거/출처/정책/보정 버전, 작성/검증/승인/발행 이력을 보존한다.
- 검증과 승인 영수증은 정확한 revision과 채택값 hash에 결속한다. 조정은 새 revision을 만들고 이전 검증/승인을 승계하지 않는다.
- result는 현재 revision의 검증 대상 채택 객체이고 base_result는 조정 전 서버 산출 원본이다. 조정과 검증·승인은 base_result를 수정하지 않는다.
- 관리 권한과 학교 범위를 확인한 사용자만 직원 actor·관리 영수증 해시를 조회한다. 학생/forecast_public 응답에는 반환하지 않는다.
- draft의 최상위 응답은 fields 허용목록으로 투영한다. 내부 record 전체·contributors·created_by·events·상위 input_hash/policy_hash를 암묵적으로 반환하지 않는다.
- 관리 draft.context는 학교·캠퍼스·전형·모집군 등 관리 확인용20필드이며 공개 발표본 context17필드와 같은 객체가 아니다.
- created_at/updated_at은UTC Z 문자열이다. draft 최상위 input_version은 반환하지 않으며 생성 요청의 검수된 input_version과 공개 발표본의 input_version 계약을 구분한다.
- result/base_result는 공개용 기준선·합격권·지원 구간의3필드 projection이다. 내부 exact 저장 객체·원자료·계수·trace를 포함하지 않는다.
- validation/approval의허용목록밖input_hash/policy_hash/actor를암묵적으로반환하지않는다. 감사actor는audit_events와허용조정항목에만포함한다.

### forecast_list

format: jungsi.forecast-list/v1

필드: format, items.

- 허용 학교만 조회한다. 목록은 실제 draft가 없을 때 []이며 저장소 장애는 503이다. 페이지/limit 계약은 후속 대규모 운영 검증에서 확장한다.

### forecast_public

format: jungsi.forecast-public/v1

필드: format, status, reason_code, offering_id, release_version, forecast_70, expected_acceptance_range, category_ranges, basis_summary, issue_summaries, recommendation_reasons, adjustment_summary, context, policy_version, input_version.

| 중첩 객체 | 필드 |
| --- | --- |
| context | offering_id, academic_year, exam_id, source_pack_version, catalog_version, rule_id, rule_version, curve_version, analysis_version, score_scale_id, score_scope, bonus_treatment, population_id, comparison_metric, unit, direction, tie_policy |
| recommendation_reasons | code, text, evidence_refs |
| issue_summaries | issue_id, title, summary, numeric_effect_applied |
| adjustment_summary | applied, reason, version |
| forecast_70 | status, reason_code, value, unit, definition, version |
| expected_acceptance_range | status, reason_code, lower, upper, unit, definition, policy_version |
| category_ranges | category, lower, upper |

- 발행된 정확한 모집행/시험/규칙/곡선/정책 버전만 공개한다. 미발행은 pending/null과 사유이다. 내부 원자료·가중치·trace·담당자 ID와 내부 감사 기록은 제외한다.
- 이 조회는 대학 유료 분석의 근거 조회이며 실제 지원자 확률이나 최저 합격점으로 표시하지 않는다.
- status는 published|pending이다. pending이면 release_version/context/policy_version/input_version/forecast_70/expected_acceptance_range는 null이다.
- context는 승인 발표본의 공개 허용 projection이며 학생 decision_evidence와 동일하다. 없는 값을 기본값으로 가공하지 않는다.

## 시간 표시

서버 instant는 UTC Z, 날짜는 YYYY-MM-DD다. 화면은 instant만 Asia/Seoul로 변환하고 date-only에 시각을 붙이지 않는다. 401은 재인증, 403은 현재 이용권, 409는 확인 성적/최신 revision·카탈로그/요청 키를 재확인한다. 재시도는 같은 본문·경로·키를 보존한다. UI/인쇄 렌더링은 별도 담당이다.

## 대학별 수능 환산 연결

[대학별 수능환산 엔진](대학별_수능환산_엔진.md)을 따른다. 구현 상태는 accepted_on_develop_synthetic_verified_live_rules_configuration_pending다. conversion.ready와 assessment.pending은 함께 존재할 수 있다. 대학 분포·입결·지원 판단·자격 미확인은 각각의 사유로 보존한다. 프레젠테이션은 독립 conversion 결과와 후속 지원 판단 상태를 표시하며 계산/조회표를 구현하지 않는다.

## 대학별 누백 연결

[대학별 누백 계산](대학별_누백_계산.md)을 따른다. 구현 상태는 implemented_synthetic_verified_live_curve_publication_pending다. conversion.ready / percentile.ready / assessment.pending은 함께 존재할 수 있다. conversion.ready / percentile.pending도 가능하며 환산 성공을 보존한다. 누백 준비만으로 지원 판단·자격·유불리를 승인하지 않는다. 프레젠테이션은 학교 환산 기준 상위 누백과 동점·자료 기준을 표시한다.

## 자체 추정분포 연결

[자체 추정분포 개발](자체_추정분포_개발.md)을 따른다. 상태는 integrated_on_develop_generic_engine_and_private_pilot_verified다. 제공된 공식 시험 자료의 주변도수와 응시/선택 조건, 비교 가능한 참고 총점 곡선을 이용해 공동 성적 조합과 가중치를 자체 추정한다. 이는 전체 학생 실제 점수를 복원했다는 의미가 아니며 실제 도수·관측 분포와 구분한다. 전체 학생의 실제 공동 성적 DB 부재는 작업 중단 조건이 아니다. 전체 누백은 overall.status=estimated, 대학 누백은 percentile.data_kind=estimated_weights로 구분한다. 기존 API 권한·시험 결속·애플리케이션 소유 포트와 프레젠테이션 담당을 유지한다.

<!-- jungsi:generated spec_sha256=bc92ff9e0727a608d34891d08de04cf65c92ba5e07a9ed91c54e99c7b63fd0fc -->
