# HTTP API와 학생 DTO 계약

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.147이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

Authorization: Bearer <Supabase access token>. 서버가 /auth/v1/user로 검증한 사용자 UUID와 검증 후 JWT sub/exp를 맞춘다. client/user_metadata의 paid 플래그는 무시하며 DB active/starts_at/expires_at을 UTC 현재 시각과 비교한다.

POST/PUT은 Idempotency-Key 등록 토큰이 필수다. 같은 사용자/작업/키의 동일 요청은 최초 결과를 현재 권한으로 반환하고 다른 본문/경로는 409다. 리포트 갱신은 expected_version CAS와 PostgreSQL 트랜잭션을 사용한다. 2026-10-25 채택 후속: 학교별 산출 결과와 회원별 관심대학 본문은 기존 비공개 Storage JSON으로 분리해 새 DB 결과 테이블/본문 중복 저장을 피한다. 기존 트랜잭션·입력권·멱등/권한 메타데이터·기록은 그대로 유지하며 실제 전환 전까지 기존 저장 경로가 동작한다. JSON의 단순 upsert를 CAS로 가정하지 않고 동시성/장애 복구를 인수한 뒤 활성화한다.

권한은 body·query 검증/자료 조회/멱등 조회보다 먼저 검사한다. unknown field와 중복 query key는 거절한다. 숫자 점수/누적은 엔진의 소수 문자열이며 원자료/전체 분포/가중치/비밀값/로컬 출처 경로는 제공하지 않는다. 모든 응답은 Cache-Control: no-store다.

## 30개 요청과 응답

| API | 메서드/경로 | 본문 | 쿼리 | 응답 DTO | 키 필수 |
| --- | --- | --- | --- | --- | --- |
| history.search | GET /api/v1/admission-history | 없음 | academic_year (2024~2027 선택), university_q, department_q, region, group, cursor, limit (1~100; 기본 50) | catalog_search (items=history_metric); backend_platform_contract.dto_schemas.catalog_search | False |
| recruitment.read | GET /api/v1/offerings/{offering_id}/recruitment | 없음 | 없음 | recruitment; backend_platform_contract.dto_schemas.recruitment | False |
| score-profile.create | POST /api/v1/score-profiles | scores: 기존 overall_analysis_contract 입력; confirmed: boolean; stage?: mock/provisional/final (서버 승인 단계만) | 없음 | profile; backend_platform_contract.dto_schemas.profile | True |
| overall.analyze | POST /api/v1/overall-reports | profile_id: 본인이 저장한 현재 입력 프로필; report_id (선택); expected_version (report_id 사용 시 필수) | 없음 | report; backend_platform_contract.dto_schemas.report | True |
| report.read | GET /api/v1/reports/{report_id} | 없음 | 없음 | report; backend_platform_contract.dto_schemas.report | False |
| offerings.search | GET /api/v1/offerings/search | 없음 | academic_year (2024~2027 선택), university_q, department_q, region, group, cursor, limit (1~100; 기본 50) | catalog_search (items=offering); backend_platform_contract.dto_schemas.catalog_search | False |
| offering.read | GET /api/v1/offerings/{offering_id} | 없음 | 없음 | {status, reason_code, offering, catalog_version}; backend_platform_contract.dto_schemas.offering_detail | False |
| university.analyze | POST /api/v1/reports/{report_id}/university-results | expected_version: positive integer; offering_ids: 서로 다른 등록 ID 1~100개 | 없음 | report (analyses 갱신); backend_platform_contract.dto_schemas.report | True |
| candidates.build | POST /api/v1/reports/{report_id}/candidates | expected_version: positive integer | 없음 | report (analyses/candidates 갱신); backend_platform_contract.dto_schemas.report | True |
| shortlist.update | PUT /api/v1/reports/{report_id}/shortlist/{offering_id} | selected: boolean; expected_version: positive integer | 없음 | report (shortlist 갱신); backend_platform_contract.dto_schemas.report | True |
| report.export | GET /api/v1/reports/{report_id}/print | 없음 | year (optional explicit member shortlist print group; required with expected_report_version/shortlist_revision), expected_report_version (required positive integer with explicit member shortlist print group), shortlist_revision (required nonnegative integer with explicit member shortlist print group), legacy_source_report_id (optional paired with legacy_source_report_version only at shortlist_revision0), legacy_source_report_version (optional positive integer paired with legacy_source_report_id only at shortlist_revision0) | snapshot; backend_platform_contract.dto_schemas.snapshot | False |
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
| score-input.status.read | GET /api/v1/me/score-input-status | 없음 | exam_id, stage? | score_input_status; backend_platform_contract.dto_schemas.score_input_status | False |
| score-input.correction.grant | POST /api/v1/management/score-input-corrections | subject_id; exam_id; stage; ticket_ref; expected_version; reason_code=score_correction | 없음 | score_input_correction; backend_platform_contract.dto_schemas.score_input_correction | True |
| report.sample.read | GET /api/v1/report-sample | 없음 | 없음 | sample_report; backend_platform_contract.dto_schemas.sample_report | False |
| history.snapshot.head | GET /api/v1/admission-history/snapshot/head | 없음 | 없음 | history_snapshot_head; backend_platform_contract.dto_schemas.history_snapshot_head | False |
| history.snapshot.read | GET /api/v1/admission-history/snapshots/{snapshot_id} | 없음 | part_id | history_snapshot_body; backend_platform_contract.dto_schemas.history_snapshot_body | False |
| report.list-own | GET /api/v1/me/reports | 없음 | exam_id, cursor, limit (1~20; default 10) | own_report_list; backend_platform_contract.dto_schemas.own_report_list | False |
| member-shortlist.read | GET /api/v1/me/shortlist | 없음 | year (required 4-digit integer in approved service years), report_id (optional owned selected report context) | member_shortlist; backend_platform_contract.dto_schemas.member_shortlist | False |
| member-shortlist.update | PUT /api/v1/me/shortlist/{offering_id} | selected: boolean; expected_revision: nonnegative safe integer; expected_legacy_source: optional report_id/report_version for uninitialized legacy projection | year (required), report_id (optional owned selected report context) | member_shortlist; backend_platform_contract.dto_schemas.member_shortlist | True |

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

- overall은 저장된 본인의 기존 학생 DTO다.
- 유료 요청은 기존 paid_fields를 유지한다. 만료·무이용권 본인 read/export는 승인된 저장 출처가 있는 결과만 닫힌 read_only_snapshot으로 읽으며 새 계산은 하지 않는다.
- 미확인 legacy 출처는 유료 결과를 임의 확장하거나 first-use 날짜를 추정하지 않는다.
- 정정 새 프로필은 기존 리포트를 덮어쓰지 않고 새 리포트 ID로 보존한다. 동일 계산 버전은 새 점수/리비전 없이 재사용한다.

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
- 평균/50%/70%/75%/최저 등 원문 지표와 점수 종류를 변환·대체하지 않는다. 75%컷을 70%컷·합격권·최저 합격점으로 분류하지 않는다. 미발표는 null과 발표 상태로 보존하며 미전사·미검수와 구분한다.

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

- public.jeongsi_passes의 revoked_at IS NULL 및 starts_at<=now<ends_at로 현재 활성 이용권을 확인한다. 복수 활성 이용권은 MAX(ends_at)를 UTC Z로 반환한다. metadata와 활성 만료를 한 배치 JOIN 질의로 확인하고 같은 요청의 회원 판정·만료 표시에 결속한다. jungsi_backend.entitlements로 장애 대체하지 않는다. 동일 검증 Bearer의 본인 public.profiles.role=admin 및 public.profiles.status=active 및 aal2와 요청 내부 admin-origin이 확인될 때만 관리자 접근 예외를 적용한다. 실제 활성 pass 만료를 우선 보존하고 pass가 없는 예외는 paid+null이다. 일반 paid 만료 누락503, 기존 자료·학교·검수 subject·소유권 범위와3필드는 유지한다. FE-ADMIN-ACCESS-01은 외부 화면팀 표시 요청이다. 별도 status/product 컬럼을 가정하지 않는다.
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

### score_input_status

format: jungsi.score-input-status/v1

필드: format, exam_id, pack_version, academic_year, stage, stage_state, opens_at, closes_at, paid_input_allowed, input_limit_mode, initial_used, initial_remaining, correction_granted, correction_used, correction_request_remaining, effective_save_remaining, entry_version, current_profile_id, current_report_id, last_attempt_outcome, last_rejection_code, legacy_transition_status, current_pass_first_paid_result_at.

- REQ-27 및 score_input_policy_contract; 공개 필드만 닫힌 재귀 스키마로 투영한다. 실제 정책 한도·회원 식별자·비밀/출처 파일은 반환하지 않는다.

### score_input_correction

format: jungsi.score-input-correction/v1

필드: format, command_id, ticket_ref, exam_id, stage, entry_version, granted, correction_request_remaining, effective_save_remaining, previous_entry_id.

- REQ-27 및 score_input_policy_contract; 공개 필드만 닫힌 재귀 스키마로 투영한다. 실제 정책 한도·회원 식별자·비밀/출처 파일은 반환하지 않는다.

### sample_report

format: jungsi.sample-report/v1

필드: format, synthetic, sample_id, label, report.

- REQ-27 및 score_input_policy_contract; 공개 필드만 닫힌 재귀 스키마로 투영한다. 실제 정책 한도·회원 식별자·비밀/출처 파일은 반환하지 않는다.

### history_snapshot_head

format: jungsi.history-snapshot-head/v1

필드: format, status, snapshot_id, publication_sha256, source_head_sha256, generated_at, source_as_of, schema_version, normalization_rules_version, selection_rules_version, counts, delivery_mode, full, parts, expires_at, r27_scope_coverage.

- Closed recursive allowlist in public_response_schemas.json; native scalar and explicit NULL preserved.
- Edge source/synthetic coverage only; Python path and hosted activation NOT_RUN.
- Optional only for pinned partial R27 v2 scope: status=partial with source_rows, included_rows, excluded_rows and review_pending_rows; head and every body part must match the same verified index. A partial-aware consumer receipt and request admission are required.

### history_snapshot_body

format: jungsi.history-snapshot/v1

필드: format, payload_id, part_id, rows, r27_scope_coverage.

- Closed recursive allowlist in public_response_schemas.json; native scalar and explicit NULL preserved.
- Edge source/synthetic coverage only; Python path and hosted activation NOT_RUN.
- Only final_additional_admission_rank has optional service_qualification. Exact authority/receipt and CID/year/PK/selected variant grants come from the existing byte-pinned independent review; raw value/status/unit/URL/date/general identity stay unchanged. Other cells never accept q.
- 서비스용 core 영수증은 jungsi.history-field-qualification-receipt/v1, status=approved_exact_fields이며 정확7키(format,status,authority_sha256,source_head_sha256,scope_sha256,expected_previous_manifest_sha256,subjects)만 받는다. 작성 감사용 rich proof를 서비스 영수증으로 대신하지 않는다.
- core subjects 각 항목의 정확7키는 field,subject,expected_raw_cell_sha256,expected_native_value_type,expected_raw_status,expected_raw_unit,expected_identity_review_sha256이다. field=final_additional_admission_rank, subject는 observation_id/academic_year/offering_pk/identity_variant_index 정확4키이며 string/pending_metadata/null 원형을 결속한다.
- q.qualification_receipt_sha256, review-only descriptor.receipt의 원본 bytes/SHA와 approvals는 같은 service core 바이트 SHA를 가리킨다. jungsi.p1-writer-field-qualification-receipt/v1 rich writer proof는 별도 감사 근거로 보존하고 core 지문을 참조한다. audit 파일을 core로 다시 라벨링하거나 양 형식을 느슨하게 함께 수용하지 않는다.
- 기존 승인 권위·예상 이전 manifest·원셀·선택 variant/독립 검수에서 core를 먼저 고정한 뒤 q·새 parts·새 manifest·별도 assembly/review를 작성한다. core에는 미래 parts/manifest 해시를 넣지 않는다. 기존 권위/원자료 범위가 같으면 이 wire 정렬을 이유로 사용자에게 새 승인을 요구하거나 로컬 준비를 Owner 회신까지 중단하지 않는다.
- Optional row-level historical_cutoff_references stores each historical estimate once by exact observation/year/school/PK. It never changes an original cut, q, value, status, unit or identity; serving requires the byte-pinned independent-review descriptor bound to the same manifest/source/scope.
- Optional only for pinned partial R27 v2 scope: status=partial with source_rows, included_rows, excluded_rows and review_pending_rows; head and every body part must match the same verified index. A partial-aware consumer receipt and request admission are required.

### own_report_list

format: jungsi.own-report-list/v1

필드: format, items, next_cursor, has_more.

- Closed recursive allowlist in public_response_schemas.json; native scalar and explicit NULL preserved.
- Edge source/synthetic coverage only; Python path and hosted activation NOT_RUN.

### member_shortlist

format: jungsi.member-shortlist/v1

필드: format, year, revision, updated_at, origin, legacy_source, assessment_context, items.

- A안: 선택 보고서/성적 버전의 저장된 허용 assessment만 목록에 함께 붙인다. 없으면 null+명시 상태/사유를 반환한다. report_id가 있으면 그 본인 보고서의 버전을 결속하며, 생략 시 선택한 본인 해당학년도 보고서 문맥을 응답에 명시한다. GET/리포트 열람·목록읽기에서 계산·분석 POST·입력권 차감·결과 쓰기를 하지 않는다. 필요한 표시/판정은 한 번의 제한된 배치/공유 저장본 읽기로 해결하며 학교별 N+1·회원 전체 JSON 순회는 금지한다.
- expected_revision과 이전 JSON SHA/유효한 fencing을 결속해 한 세대만 게시한다. 같은 상태 쓰기는 revision을 올리거나 결과 객체를 다시 쓰지 않는다. 같은 키/동일 본문·경로는 최초 고정 응답을 현재 권한으로 재검증하고 다른 본문은409다. 단순 Storage upsert를 CAS로 가정하지 않는다. 응답 중단·게시 전후 실패·두 기기 충돌을 복구하며 모든 이전 파일과 후보를 보존한다. 원 보고서 revision·응답 지문을 결속하며 카탈로그 변경 등으로 원 응답을 재현할 수 없으면 다른 내용으로 성공시키지 않고409로 닫는다.
- GET에는 쓰기를 넣지 않는다. 새 JSON이 없으면 가장 최근의 본인·해당학년도 보고서 shortlist를 origin=legacy_report, revision=0, legacy_source={report_id,report_version}로 읽기 전용 표시한다. 첫 실제 변경 PUT은 예상 legacy source와 현재 원본/본인 소유권을 확인하고 기존 목록을 보존한 JSON revision1에 그 변경만 적용한다. 동시 legacy 변경은409이며 예전 true만 합쳐 해제 학교를 되살리지 않는다. 이미 초기화한 회원 JSON을 legacy로 덮지 않는다. 동일 상태 no-op는 초기화 쓰기도 하지 않는다.
- 기존 무query report.export 권리는 유지한다. 새 명시 year/expected_report_version/shortlist_revision 요청은 본인 선택 성적 보고서와 정확 관심목록을 독립 결속한다. revision0에서만 optional 쌍 legacy_source_report_id/legacy_source_report_version으로 GET legacy_source의 정확 본인·동일연도 report revision 목록을 읽는다. GET 후 최신 legacy가 바뀌어도 그 목록을 보존하며 JSON 생성·입력권 차감·새 산출은 없다. 쌍을 생략하면 선택보고서가 최신 legacy 원본과 일치할 때만 성공하며 불일치는409다. 쌍 한쪽·잘못된 형식·rev>0의 쌍은422, 타인·다른연도·없는 exact 원본은404다. rev>0은 정확 불변 JSON revision을 사용하고 최신으로 치환하지 않는다.

## 시간 표시

서버 instant는 UTC Z, 날짜는 YYYY-MM-DD다. 화면은 instant만 Asia/Seoul로 변환하고 date-only에 시각을 붙이지 않는다. 401은 재인증, 403은 현재 이용권, 409는 확인 성적/최신 revision·카탈로그/요청 키를 재확인한다. 재시도는 같은 본문·경로·키를 보존한다. UI/인쇄 렌더링은 별도 담당이다.

## 대학별 수능 환산 연결

[대학별 수능환산 엔진](대학별_수능환산_엔진.md)을 따른다. 구현 상태는 accepted_on_develop_synthetic_verified_live_rules_configuration_pending다. conversion.ready와 assessment.pending은 함께 존재할 수 있다. 대학 분포·입결·지원 판단·자격 미확인은 각각의 사유로 보존한다. 프레젠테이션은 독립 conversion 결과와 후속 지원 판단 상태를 표시하며 계산/조회표를 구현하지 않는다.

## 대학별 누백 연결

[대학별 누백 계산](대학별_누백_계산.md)을 따른다. 구현 상태는 implemented_synthetic_verified_live_curve_publication_pending다. conversion.ready / percentile.ready / assessment.pending은 함께 존재할 수 있다. conversion.ready / percentile.pending도 가능하며 환산 성공을 보존한다. 누백 준비만으로 지원 판단·자격·유불리를 승인하지 않는다. 프레젠테이션은 학교 환산 기준 상위 누백과 동점·자료 기준을 표시한다.

## 자체 추정분포 연결

[자체 추정분포 개발](자체_추정분포_개발.md)을 따른다. 상태는 integrated_on_develop_generic_engine_and_private_pilot_verified다. 제공된 공식 시험 자료의 주변도수와 응시/선택 조건, 비교 가능한 참고 총점 곡선을 이용해 공동 성적 조합과 가중치를 자체 추정한다. 이는 전체 학생 실제 점수를 복원했다는 의미가 아니며 실제 도수·관측 분포와 구분한다. 전체 학생의 실제 공동 성적 DB 부재는 작업 중단 조건이 아니다. 전체 누백은 overall.status=estimated, 대학 누백은 percentile.data_kind=estimated_weights로 구분한다. 기존 API 권한·시험 결속·애플리케이션 소유 포트와 프레젠테이션 담당을 유지한다.

## Supabase 운영 인수 상태

보관된 이전 운영 검수 이력: 현재 develop57f74b1daabd2d6a8e94de216f182e8bfe6557b7에 서비스phase2와 승인된 병합 하네스 수정이 통합됐다. 정상precommit/prepush/정확HEAD pushCI/PR병합시험CI/최종developCI각678PASS·실패/오류/skip0이며 main은 보존했다. 최소source-only draft18의신규2 ownerINSERT COMMIT/freshapp18과선별Storage18(fullGET/SHA·비인증72건본문미반환)을확인했다. 최종appTLS READONLY exact18/old16불변/new2exact 독립영수증도PASS이며003/13RLS24policy·공개/Storagebaseline보존을확인했다. 원수능AST source는 보존하고 모평적용child3의 source/applicationContext를 분리 확인했다. engine/production/runtimefalse·publishednull과 기본회원경로유지/명시DI만준비선택은 확정 유지다. 공식입결v2/v3의미실패는보존하고 최소선별v4의일부학교/학교년도local·remote native범위PASS를 수령했다. 신규2개DB메타등록을수령하고최소공식source2의독립native58/frozenRAM39를기록했으며전체draft18/발행0·전국완료false를유지한다. 최종freshapp18독립검수도완료했다. StorageRLS메타는현재보호bucket에클라이언트SELECT허용조건없음을확인했으나실제JWT HTTP/운영SECgate는NOT_RUN이다. v2설계승인·최신v1.1/14경로PLAN_ONLY구현계획은 준비됐으나 코드0·품질/newscopeFE공통계약/모형호환·계산채택은 미완료다. 실제JWT/APIorigin·22API/4페이지/보안운영·live배포는 미인수다. 과거제안/실패/fixture·관측은 보존한다.

2026-10-10 Owner 작업 준수(DEP-IO-01-WINDOW): 대량 작업은 매일 02:00~06:00 KST, 최대 4시간의 조건부 창에서 한 팀의 한 작업만 수행한다. 시작 전 경고가 있으면 그날 SKIP하고 일관된 체크포인트에서 중단하며 기존의 더 짧은 배치·bytes·5초·RLS·subject·승인/만료 한계를 유지한다. 소량 조회 예외는 과거57014 전수 쿼리나 요청 수·limit만으로 적용하지 않는다. CAP-03은 정확한 표·PK·열·영향·비삭제 대안의 별도 제거 승인 전 단계이며 registry/overlays를 보존한다. 정확 관측 시각 UNCONFIRMED·원인/예산 회복 미확정·I/O HOLD·컴퓨트 변경 보류다. Storage·정리·VACUUM·read model·배포·PIN/만료 연장·자동 실행은 이번에 수행하지 않았다. 공식 입결 DB 표시 연결 문서의 같은 ID 준수 절을 함께 따른다. 지표 확장/가산점 요약은 데이터팀·서비스팀의 미채택 CR 준비안 검토까지 완료했고 자료 발행·DTO/엔진/화면·실API/BFF 인수는 NOT_RUN이다.

2026-10-10 읽기 모델 수정 후보(spec1.9.33): 사용자 지시에 따라 개발팀은 현재 정본의 검색용 narrow model과 명시 provider/handler·typed 검증·prepared DDL7파일 후보를 구현하고 데이터팀·독립 검토·native 합성 HTTP를 준비한다. 서명 유효성과 전체 원형 census·source coverage/fence 완전성은 별도 판정이며 실제 trusted baseline receipt 부재는 NOT_READY다. 기존 전수5초57014 실패는 보존하고 실제 DDL/GRANT/RLS·model build·성능·새 승인 PIN4·배포·JWT/BFF/브라우저는 NOT_RUN이다. DB 정리·VACUUM·과금 변경은 수행하지 않는다. fresh UI에서는Healthy와 용량 증가만 확인했으며 IOPS/처리량/연결 그래프는 불러오지 못해 I/O 회복 미확정/HOLD를 유지한다.

[Supabase 운영 인수인계](Supabase_운영_인수인계.md)를 따른다. revision 2026.10.07.v9; HTTP 관측 시각 2026-10-06T08:40:54.349322Z.

[화면팀 최종 회신 요청](화면팀_회신요청_최종.md)의 RF-01~06과 로컬 요청 ①~⑥를 함께 인수한다. 문서 전달 준비 완료는 담당자 회신·실제 연결·운영 검수 완료를 뜻하지 않는다.

[화면팀 후속 작업 지시](화면팀_후속작업_지시.md)의 FE-01~05는 로컬 검수 보고 이후 발견한 결함·증거 보완·승인 자료 대조·후속 PR 통합을 담당한다.

PR13 adc684/74fd/947의493건·b66의530건·PR14 구현429/병합91과 문서816의 정상561건/정확CI는 확인된 이전 코드 인수 이력이다. 이번 문서 후보의 미실행 검사·미래 commit/CI와 실제 운영 완료를 뜻하지 않는다.

## DEV006⑦ 정확한 파일 삭제 승인 검사

기본값은 deny다. develop947 이후 등록·공통 검사는 시스템기획팀, 실제 삭제와 화면 검증은 외부 화면 개발팀의 범위다. 서비스 개발팀은 서비스 계층만 담당한다. 삭제 승인 등록 당시의 역사 관측 상태: observed_completed_external_not_integrated. 이 관측을 현재 PR 통합 상태로 취급하지 않는다. 별도 develop 선행 등록 전에는 후보가 스스로 승인할 수 없다.

| 정확한 경로 | mode | 고정 Git blob | 원본 바이트 SHA256 |
| --- | --- | --- | --- |
| apps/web/src/app/admissions/possibilities/actions.ts | 100644 | c1f0200bec8cdd20f23e49134125a7cff7b17fce | fe2fcf6e3e02c9a08c4d7922babd6e4c8c1d6a10ccdd3b7120493dfb3dfe5c68 |
| apps/web/src/components/pending-page.tsx | 100644 | 2bd4303143db69494460f8740977c90c2e4060c1 | 7fd9a61c79fc4b09296d6140db4318482974ee37a8a47dc034e72c53af08a9ec |
| apps/web/src/lib/api/synthetic-fixtures.ts | 100644 | a8e5bb68743d8f2f5a776964f8c042d09a97dc51 | bdc103cb6059e29f1192d22e40275da77ff17beb17a7414577df40c0fe245ede |
| apps/web/src/lib/contract.ts | 100644 | c12709ab04dba81d6f4748b3fea7a937b5a0d6c9 | 0456daf6671c4c2ba76b932dc7d7cf5022cd96b398a1baa10c219b0013f7e478 |

출발 브랜치: feature/presentation-foundation; 출발 커밋: f46c6635664a6c2315e6c71c4f700aa3e331c60c; 사용자 메시지: 01a10bf5-898b-7180-8442-3bfd4d1c2914; 요청서 SHA256: 686e51deb7f29cc259e5fb8d63e1c16456b16aebfa5fc9f4c04e9988d0d694e3. 원본과 이전 버전은 보존한다. 최초 삭제와 승인된 삭제의 부모 병합 승계를 구분하고 다른 경로·수정/복원 후 재사용·병렬 삭제 origin의 재소비·과거 소급·숨긴 sideparent·ref 삭제·force를 거절한다. 동일한 승인 삭제 origin을 develop/main으로 운반하는 정상 병합과 새로운 삭제 사건은 구분한다.

### 별도 정확 승인 FE-P1-RAW-METRICS-20261020

| 정확한 경로 | mode | 고정 Git blob | 원본 바이트 SHA256 |
| --- | --- | --- | --- |
| apps/web/src/app/admissions/results/raw-metrics.tsx | 100644 | 68ffdd44d08cbcc2e6019166b3cfd2b0541b1eb7 | 1a00f2971e85408ea7ddc6327889594c80822abf65f3f57ffde183475719f121 |

사용자 답: 이 파일 1개 삭제 승인; 근거 질문: call_e73eb92e24064873800e5fd807712c6f; 출발 커밋: f4d0bfc4f8453fc4aaa9d20464556ba845df29a8. 사용자가 정확 1개 삭제를 승인했고 이후 이번 네 동시성 수정과 함께 정상 삭제·검수까지 명시했다. 새 snapshot-table로 대체되어 참조 없는 raw-metrics만 제거한다. 이전 4개 승인 기록은 보존한다. 이 별도 1개에도 선행 develop 등록·정확 원문 지문·최초 삭제 1회·정상 부모 승계 검사를 동일하게 적용한다. 실제 실행 결과는 별도 정확 커밋으로 기록한다.

## 1페이지 추정 2열과 초안 시사

[공식 자료·추정 표기·시사 계약](1페이지_공식자료_추정표기_시사.md)을 따른다. 추정 총 지원자·추정 탈락자 2열을 유지한다. 대학 발표 공식 지표와 분리된 화면 파생값이며 자체 누백/예상컷/개인 분석을 1페이지에 추가하지 않는다. 2026-10-19 사용자 채택: 1페이지의 자료 공급 범위는 현재 단일 정본의 서비스 대상 전국 전체다. 학교별 부분 발행 완료를 기다리는 조건을 이번 연결에 적용하지 않는다. 현재값을 읽는 공개 어댑터·명시 승인 binding과 페이지별 검수는 별도로 완료해야 하며, 자료가 부족한 셀은 보류/null로 보존한다. 2026-11-02 Owner 확인(충원 열): 충원 표시는 최종 합격 예비번호 한 열로 통일하고 원문 명칭이 마지막 순번을 뜻한다고 검증된 경우에만 그 항목에 연결한다. 실제 추가 합격 인원은 내부 산술 입력으로 유지한다. 2026-11-02 사용자 직접 선택(성적 공란): 입결 성적 null은 공식 근거로 해당 조건 미발표 또는 3인 이하가 확인된 경우에만 해당 문구를 구분하며 사유 미확인은 보존한다. 동일 학년도/모집행/통계 분모와 결측·실제0·음수를 검사하고 실제 불합격자수와의 차이를 표시한다. API의 공식 history_metric과 회원 권한은 유지한다. 학교별 부분 발행은 단일 활성 catalog의 누적 불변 판으로 착수하며 source 승격·자동 병합을 하지 않는다. 실제 발행된 과거 입결의 목록/검수 계보·부분 조회를 화면에서 대조하고 승인·선택·수신·브라우저·운영 발행은 별도 인수다.

## 공통 도구의 확인된 이전 인수 기준

| 범위 | 확인한 증거 |
| --- | --- |
| 공통 Git/CI 검사·명세·생성 문서 | b66c2274f0b0a27dc174555adde181cd16c68188; tree bd23bf5bd1ec0a05fed7c7f8db7db39621bf2748 |
| 정상 commit/push 훅 | 530건 PASS; 실패 0·오류 0·건너뜀 0 |
| 정확한 HEAD GitHub CI | [project-consistency](https://github.com/natural0448/Jungsi_touch/actions/runs/37324278331/job/111810898785): success |
| 서비스·DB 역사 기준 | adc684/74fd 구현과 develop947 통합의 493 PASS는 별도의 역사 인수 증거로 유지한다. |
| 당시 외부 프런트 관측 | d7b0279b2725a81ecd734cdec957c485ae5d6172; 4cc에서 필수3버전의 비어 있지 않은 문자열·정확동일성 보완과context17비교유지를관측했다. 실제Caller/브라우저/운영로그인인수는NOT_RUN이다. |
| 승인 등록 당시 외부 삭제 관측 | observed_completed_external_not_integrated; 이후 develop 통합과 실제 브라우저 인수는 각각의 정확한 증거로 구분한다. |
| 운영/외부 인수 | verification_pending; DB .env 추후; main not_ready |

확인된 이전 baseline b66까지만 증거로 명시한다. 후속 문서 커밋 자신의 미래 SHA나 미실행 CI 성공을 기록하지 않는다. 공통 Git/CI 검사·명세·생성 문서 인수 및 전체 합성 회귀. 운영 DB·외부 프런트·실제 데이터·모형 운영 승인을 뜻하지 않는다. 이전 e12/676 버전값 보완 pending은 역사이며 최신 소스 관측과 실제 프런트 인수 대기를 구분한다. 최소 profile 조건 읽기와 실제 로그인 JWT NOT_RUN, 실제 자료·모형 운영 미승인 상태를 유지한다.

## 외부 접근 데이터 보호: 개발 시작 전 필수

[외부접근 데이터보호 개발기준](외부접근_데이터보호_개발기준.md)을 작업 전에 반드시 읽는다. 정본은 service_spec.json의 security_contract와 workflow.development_harness이며 보안 revision은 2026.10.06.v1이다. REQ-24~26 / SEC-01~08은 화면·API·DB 개발의 공통 기준이다. 공개 응답의 재귀 허용목록, 서버 중계와 사용자 권한, 공유 누적 사용량 통제를 함께 구현한다. 기획·라우팅·route_catalog와 AGENTS 필수 참조는 동일 Git 스냅샷에서 하네스가 검사한다. 현재 운영 인수는 production_ready=false이고 3개 보안 release gate는 pending이다. 문서/계약 검사 통과는 런타임 차단 구현·브라우저·운영 DB 검수 완료와 구분한다.

## 2026-10-14 오픈 전 최신 확정

유료 이용권 원본은 public.jeongsi_passes이며 관리자 접근 예외는 동일 검증 Bearer·본인 role=admin/status=active·aal2·요청 내부 origin이 모두 필요하다. 실제 만료 우선, 예외만 paid+null, 일반 paid 만료 누락503과 FE-ADMIN-ACCESS-01을 따른다. 관리 8경로의 검증 aal2·본인 active 상태·기존 학교 권한을 결합한다. 이 문서에 남은 과거 어댑터/명시 연결 전용 결정은 당시 이력이다. 현재 변경 범위와 검수 상태는 [오픈 전 보안운영 변경](오픈전_보안운영_변경.md)와 opening_security_operations_contract를 우선한다. API22/session3·자료 승인/보존 경계는 유지한다.



<!-- jungsi:generated spec_sha256=aaae9da74044fa890f9924e6fb24aacb4bf7793f99dabf658ed9ed0d97433e20 -->


## 회원별 관심대학 JSON API

MEMBER-SHORTLIST-01 / SOURCE_REGISTERED_NOT_ACTIVATED. 회원·대상 학년도별 비공개 JSON 관심대학을 기존 리포트와 분리한다. 저장 판정 동봉 A안을 채택하고 기존 report-bound API와 전문가용은 유지한다.

| 항목 | 계약 |
| --- | --- |
| storage | 기존 Supabase 비공개 Storage 불변 JSON/리비전과 작은 기존 원자 메타데이터를 사용한다. 새 결과/관심대학 DB 테이블·신규 서비스·키·과금은 만들지 않는다. 기존 성적/리포트/입력권·원본은 보존한다. |
| access | 검증 JWT에서 본인 UUID를 결정한다. 두 신규 경로는 기존 paid 판정과 active·aal2 관리자 예외를 따르며, 클라이언트 UUID/파일 경로는 받지 않는다. 공개 DB/Storage 직접 접근·서명 URL 노출 없이 기존 relay·CSRF·RLS/소유권·현재 권한·공유 예산·no-store를 유지한다. |
| legacy | 기존 PUT /api/v1/reports/{report_id}/shortlist/{offering_id}와 shortlist.update의 의미·권한·DTO는 바꾸지 않는다. 신규 두 operation만 명시 등록한 뒤 28→30이며 계약 준비만으로 현재 binding/배포를 넓히지 않는다. /pro 학생별 고정 리포트는 이번 범위에서 제외한다. |
| assessment | A안: 선택 보고서/성적 버전의 저장된 허용 assessment만 목록에 함께 붙인다. 없으면 null+명시 상태/사유를 반환한다. report_id가 있으면 그 본인 보고서의 버전을 결속하며, 생략 시 선택한 본인 해당학년도 보고서 문맥을 응답에 명시한다. GET/리포트 열람·목록읽기에서 계산·분석 POST·입력권 차감·결과 쓰기를 하지 않는다. 필요한 표시/판정은 한 번의 제한된 배치/공유 저장본 읽기로 해결하며 학교별 N+1·회원 전체 JSON 순회는 금지한다. |
| concurrency | expected_revision과 이전 JSON SHA/유효한 fencing을 결속해 한 세대만 게시한다. 같은 상태 쓰기는 revision을 올리거나 결과 객체를 다시 쓰지 않는다. 같은 키/동일 본문·경로는 최초 고정 응답을 현재 권한으로 재검증하고 다른 본문은409다. 단순 Storage upsert를 CAS로 가정하지 않는다. 응답 중단·게시 전후 실패·두 기기 충돌을 복구하며 모든 이전 파일과 후보를 보존한다. 원 보고서 revision·응답 지문을 결속하며 카탈로그 변경 등으로 원 응답을 재현할 수 없으면 다른 내용으로 성공시키지 않고409로 닫는다. |
| retry | revision_conflict는 한 번 다시 GET한 뒤 새 expected_revision과 새 Idempotency-Key로 같은 selected 의도를 한 번만 재시도한다. 통신 결과가 불명확하면 원래 키와 동일 본문으로 먼저 복구한다. 이미 확정된 명령의 본문을 같은 키로 바꾸지 않는다. |
| error | 기존 {status:error,error:{code},request_id} 봉투를 유지한다. current_revision 오류 추가 필드는 필수가 아니며 재조회 응답으로 확인한다. 선언된 사용자표시 상한만 공개 가능하고 내부 요청/동시성/물리 한도는 반환하지 않는다. 개수/본문 초과는 shortlist_limit_exceeded로 원래 상태를 보존한다. 실제 수치 상한·허용 학년도·물리 비용은 기존 승인 정책을 재사용/결속하며 임의 값·null→무제한을 만들지 않는다. |
| migration | GET에는 쓰기를 넣지 않는다. 새 JSON이 없으면 가장 최근의 본인·해당학년도 보고서 shortlist를 origin=legacy_report, revision=0, legacy_source={report_id,report_version}로 읽기 전용 표시한다. 첫 실제 변경 PUT은 예상 legacy source와 현재 원본/본인 소유권을 확인하고 기존 목록을 보존한 JSON revision1에 그 변경만 적용한다. 동시 legacy 변경은409이며 예전 true만 합쳐 해제 학교를 되살리지 않는다. 이미 초기화한 회원 JSON을 legacy로 덮지 않는다. 동일 상태 no-op는 초기화 쓰기도 하지 않는다. |
| printing | 기존 무query report.export 권리는 유지한다. 새 명시 year/expected_report_version/shortlist_revision 요청은 본인 선택 성적 보고서와 정확 관심목록을 독립 결속한다. revision0에서만 optional 쌍 legacy_source_report_id/legacy_source_report_version으로 GET legacy_source의 정확 본인·동일연도 report revision 목록을 읽는다. GET 후 최신 legacy가 바뀌어도 그 목록을 보존하며 JSON 생성·입력권 차감·새 산출은 없다. 쌍을 생략하면 선택보고서가 최신 legacy 원본과 일치할 때만 성공하며 불일치는409다. 쌍 한쪽·잘못된 형식·rev>0의 쌍은422, 타인·다른연도·없는 exact 원본은404다. rev>0은 정확 불변 JSON revision을 사용하고 최신으로 치환하지 않는다. |
| frontend | 화면팀 shortlist.ts의 selectedIds/readPicks/setPick를 전환 지점으로 삼는다. 2·3·4페이지·와일드카드·트레이·인쇄가 같은 회원 목록을 쓰며, 판정 없음은 미산출 안내로 유지하고 GET 진입에 숨은 분석 요청을 붙이지 않는다. 새 operation·설정·정확 배포판의 Owner 영수증 전까지 기존 연결을 유지한다. |

| operation | method | path |
| --- | --- | --- |
| member-shortlist.read | GET | /api/v1/me/shortlist |
| member-shortlist.update | PUT | /api/v1/me/shortlist/{offering_id} |

검수 기준:

- 본인/타인 UUID·만료/일반·paid·active aal2와 relay/CSRF·RLS 검수
- GET/로그인/동일상태 no-op의 계산0·객체 PUT0·큰 DB본문 쓰기0·입력권 차감0
- 표시/assessment 배치조회 횟수가 관심대학 수에 비례해 증가하지 않음
- 빈 목록·실제0·null·pending·참고 환산을 구분하고 native 값을 보존
- legacy 최초복사·동시변경·무목록·원본보존·새JSON우선 검수
- 두기기 한세대 게시·멱등타임아웃·stale fence·키/본문충돌 검수
- 인쇄 후 관심대학/성적변경에도 요청 당시 두 revision·정확목록 보존
- 새2 API·실저장 어댑터·실제 런타임·허용 DTO·현재성 검사 종단 검수
- 기존28 API/기존656와 전용추가시험·정확SHA 정상CI 유지
- Owner 실제 객체/권한/소스/설정/정문 검수 전 운영완료 표시 금지

## P1·P2 화면 변경의 한정 수용

cde233fc026116b99b2289b2886b6158e75f71b0 / ACCEPTED_SCOPED_SOURCE_AND_REPORTED_GET_ONLY_BROWSER_RECEIPT_NOT_DEVELOP_MERGE. Frontend reports new worker serving that commit, frontdoor P1 small frozen supply and own P2 saved report GET-only PASS; Root independent current-browser rerun NOT_RUN. Private receipt binds worker/time and observations.

Preserve original year/PK,only2024-2026 result rows,exact same IDs for cross-year grouping. Six-page remaining cursor means incomplete; withhold last incomplete offering and never conclude empty/no result while cursor remains. Unverified2027 target stays pending with no per-card historical recruitment call.

Only total_model_missing says 자료 연결 대기 / 전체 누백 분포 자료 연결 대기. Explain that no total-model computation is in progress and no score re-save is needed; preserve scores/subjects and other pending-code distinctions.

One observed small-binding frontdoor result, not an SLA, nationwide coverage or server-only latency claim. Actual timing and result cardinality stay in private evidence.

| 후속 | 상태 | 조건 |
| --- | --- | --- |
| FE-P1-NATIONAL-BOUNDARY | NOT_RUN | After nationwide provider: exactly full6 pages with/no cursor,empty items with remaining cursor,last incomplete offering,head409 and permission/quota failures; explicit filters and original PK/year preserved. |
| FE-P1-ASOF-KST | ASSIGNED_NEXT_FRONTEND_CHANGE | Render validated ISO instant using explicit Asia/Seoul YYYY.MM.DD, preserve original source instant; missing/invalid remains pending,never current-day fallback. Date-only official values remain date-only without invented timezone shift. No standalone redeploy required for this intake. |
| FE-P1-VERIFIED-2027 | CONTRACT_AND_DATA_PENDING | Use only exact qualified target metadata; propose compatible optional public DTO/versioned mapping through normal PR before connecting recruitment. No ID prefix/name guesses or N+1. |
| FE-RECEIPT-CARDINALITY | CLARIFICATION_REQUESTED | Correct ambiguous listed department labels versus unit cardinality using observed actual offering IDs; no new score or data save. |

PR 통합/전국 binding/9월 total_model/REQ27·보안 인수는 이 영수증 수용으로 완료되지 않는다.


## 현재 정본 전국 공개 연결 · 최신 채택

CR-CURRENT-NATIONAL-PUBLIC-20261019-01 / ADOPTED_SOURCE_IMPLEMENTED_NORMAL_SOURCE_CI_PASS_HOSTED_ACTIVATION_PENDING. 2026-10-19 사용자 채택: 1페이지의 자료 공급 범위는 현재 단일 정본의 서비스 대상 전국 전체다. 학교별 부분 발행 완료를 기다리는 조건을 이번 연결에 적용하지 않는다. 현재값을 읽는 공개 어댑터·명시 승인 binding과 페이지별 검수는 별도로 완료해야 하며, 자료가 부족한 셀은 보류/null로 보존한다.

적용 경로: /admissions/results, /admissions/possibilities. 기존 작업: history.search, offerings.search, offering.read, recruitment.read. P1 standard/paid without a personal score; P3 offerings/search/detail remains paid, existing active+aal2 admin exception and ownership/auth/relay rules unchanged

All currently available eligible national canonical rows, not only an approved school subset; preserve active_service=false and actual-practical exclusions. All searchable does not mean a single unbounded response or automatic bulk retrieval.

No DB production_allowed/engine_approved/source release flag rewrite; authorise the explicit read provider and public projection separately. Missing unpublished fields remain distinct from source eligibility.

Existing public history/offering/recruitment DTO and recursive allowlist. Preserve original statistic/cohort/score kind/scale/unit/year/source and scalar types allowed by that DTO; unrepresentable source fields are explicit pending, not fabricated.

Missing value, unread/unqualified metadata, officially unpublished, inapplicable and actual zero are distinct. Never fill missing cells with 0 or estimates. Final reserve number is not additional admitted count. 2024-2026 observations are not 2027 offerings. Target recruitment only uses the exact verified target PK; no prefix/name replacement, automatic lineage merge, or invented future-year quota.

기존 P1 원문 경로는 history.search에서 academic_year를 생략해 2024·2025·2026을 함께 읽는다. 해당 경로의 UI는 최대6페이지×100=600지표이며 기존 서버 요청별 상한과 계정 공유 예산을 보존한다. 잔여 cursor는 조회 미완료이며 마지막 미완전 모집행을 보류한다. 이 한계를 없애는 판별 화면 정리본은 별도 채택/구현/운영 상태를 따르며 원문 경로에 전수 cursor를 추가해 대신하지 않는다.

Parameterized bounded page query and selected-page IDs JOIN, stable deterministic cursor sorting with query/user/source binding and head-change409. No per-row DB fetch, N+1, hidden cursor drain, COUNT(*) census, full payload download or implicit new materialization.

Fresh verified JWT, relay, public.jeongsi_passes, active+aal2 admin exception, RLS app role, no-store, recursive output filtering, shared atomic quota and timeout/read/result caps unchanged. No bypass to repair409.

기존 학교별 부분 발행/C 묶음 설명은 이전 절차의 보존 이력이다. 이번 전국 검색 공급의 선행 조건으로 다시 적용하지 않는다. Source registration/006a/profile migration/usage-v2/new policy activation remain separate and are not accepted by this read-provider change.

Existing DB stays readable while national numerical supplementation is prepared locally and cross-reviewed, followed by one final authorised writer batch. No per-school DB upload/recombine/COPY/full reread for this request.

현재 구현 SOURCE_COMMITTED_NORMAL_HOOKS_CI_AND_PRIVATE_BOUNDED_DB_AND_KEY_COVERAGE_VERIFIED · hosted 전환 OWNER_REPORTED_V15_REGISTERED_EXACT_BUNDLE_AND_SETTINGS · 전국 브라우저 인수 PEER_REPORTED_FIRST_RANGE_SEARCH_PASS_FULL_DOMAIN_UI_PENDING_SNAPSHOT. 자료 보완 중인 상태와 연결 구현/배포 완료를 혼동하지 않는다.

### 서비스 어댑터 후보와 최종 결속 경계

EXACT_SOURCE_ACCEPTED_EXACT_PUBLICATION_BINDING_OWNER_REGISTRATION_AND_HOSTED_INTAKE_PENDING. 점수·정원 원값 없이 키·검색 메타데이터만 분할한다. 요청마다 최대101개 키를 선택해 같은 READ ONLY 트랜잭션에서 현재 DB를 일괄 JOIN한다. 기존 5초·객체 byte·페이지·요청 공유 예산과 fresh head 검사는 유지한다. 별도 root/lookup v3는 두 hash 버킷과 엄격한 가역 guide tuple2(학년도/학교 코드, 원래 PK 문자열) 및 기존 사전 tuple8 fallback으로 중복 주소만 제거한다. v1/v2 파서·행·byte 검사는 보존하며 v3 전체 lookup 논리 상한도 종전과 같다. namespace·schema·8종 guide command 상태가 어긋나면 첫503/후속409다. 503 대응 descriptor 재결속 서비스 함수는 이전 descriptor와 V3 root의 head·metadata·guide·canonical coverage 지문을 대조해 HOLD 검토 후보만 만든다.

전국 현재 정본 공급 범위는 사용자 채택 상태다. 이번 키 인덱스 v2의 정확 snapshot·coverage 검수·불변 객체와 publication/v2 결속 및 hosted 전환은 최종 운영 승인으로 분리한다. 준비·표본 실제 읽기는 DB 전체 값 인수나 브라우저 인수를 대신하지 않는다.

설치032의 정확 runtime_composition/index 두 입력을 패치하고, P2 v2는 exam_pack/overall_analysis/native_data_provider 세 입력의 정확032 해시를 따로 확인한다. 새 domain 한 파일만 기존 exact/native_json/percentile/exam_pack/time 의존성에 연결한다. 최신 platform 전체를 반입하지 않고 consumer14·usage-v1·기존032 입력검증/프로필/역할/소유권을 보존한다. REQ27·006a·profile migration·usage-v2 활성화는 별도다.

원래 DB offering_pk는 보존한다. 현재 DB 조회의 공개 offering_id는 실제 academic_year와 native PK의 가역 주소(year:PK)로 학년도 사이 중복을 구분하며 2027 계보를 만들지 않는다. PK 없는 관측은 기존 current-public-observation|year|canonical ID의 SHA 주소를 쓴다. guide tuple의 다섯째 키는 같은 공개 주소이며 버전은 별도 head/command 상태에 결속한다. 미검증 지표 정의/단위/출처는 pending_metadata이고 의미가 다른 충원인원·예비번호·컷을 임의 별칭으로 통합하지 않는다. 제어문자 이름은 기존 공개 필드의 null/빈 검색 처리와 동일하게 보류하고 원자료는 바꾸지 않는다.

요청당 최대12개 키 shard, shard당256개 키, 반환 최대100개+다음 판정1개다. 물리 읽기 상한에 닿으면 빈 결과에도 다음 cursor를 보존하며 전체 무결과로 표시하지 않는다. 이 제한과 UI 최대6페이지/600지표의 드문 검색어·부분 모집행 동작은 실제 인수 대기다. 12개 lookup shard를 넘는 새 ID 배치는 false404 대신 fail closed다.

최종 exact source CI·전국 coverage 검토·객체 readback·승인 publication/binding 등록과 실제 P1/P3/보안·만료·예산/화면 인수. 현재 정본 수정·새 DB 스키마/writer/운영 배포는 이 소스 검증에 포함하지 않는다. 재결속 후보의 caller 지문은 독립 승인·현재 시각/head/consumer·Storage readback·전체 coverage를 입증하지 않는다. 실제 등록과 화면 인수는 별도다.


## 전체 응시자 추정 모형의 별도 v2 계약

CR-OVERALL-ALL-EXAMINEES-V2-20261020-01 / FORMAT_IMPLEMENTED_SELECTION_AND_HOSTED_ACTIVATION_PENDING. 기존 완전응답 교집합 모형과 공식 전체 응시자 분모의 추정 모형을 별도 형식으로 검증한다. 사용자가 지정한 전체 분모 자체와 모형 시나리오/운영 채택은 구분한다.

jungsi.exam-total-model/v1·exam_population·complete-response population ID·pack.populationBounds·approved population_verified=true 검사는 그대로 유지한다. 원래 시험팩 bytes/버전/target_population은 수정하지 않는다. 같은 pack participants.total을 읽는 readonly getter만 추가한다.

jungsi.exam-total-model/v2·official_all_examinees_estimate는 정확6필드 봉투와 닫힌27필드 population_policy, 기존 distribution3/metadata13/row2 필드만 허용한다. source/정책/시나리오 검수 해시를 필수로 검증하며 명시된 시나리오 외 기본 선택은 없다.

population_id=official_all_examinees·kind=estimated_weights만 허용한다. official_total_verified=true와 joint_scores_observed=false·population_verified=false를 구분한다. 전체 modeled weight 합, 완전응답+결측모형 인원 합과 같은 시험팩 participants.total이 정확히 같아야 한다. complete는 모형 질량 완결이며 관측 공동분포 완결이 아니다. null/-1·결측모형 정책을 보존한다.

2026-10-20 사용자가 정확한 base 추정 모형 채택을 직접 승인했다. 원래 연구/시나리오 파일의 바이트와 과거 PENDING 표시는 보존하고, 현재 채택 결정은 별도 비공개 승인 영수증과 새 approval에 결속한다. registry/selection/runtime binding 등록·배포·실사용자 재분석은 NOT_RUN이다. reference/synthetic 모형을 자동 승격하지 않고 기존 승인·선택 경계를 유지한다. 같은 기존 공개 필드(status/data_kind/population_id/model_version 및 동점 포함/제외·구간)를 사용한다. 실제 분모·모형 SHA·가중치·운영키는 공개 명세에 기록하지 않는다.

report.read는 저장 snapshot을 읽고 계산하지 않는다. 기존 profile_id로 overall.analyze를 명시 호출하고 새 request key와 현재 report_id/expected_version을 보낸다. 같은 key의 과거 응답은 보존하며 새 분석은 새 report revision에 저장한다. 프로필/점수를 다시 저장하거나 입력권을 차감하지 않는다. 자료 채택에는 registry/selection/context 변경과 fresh head 검증이 필요하며 percentile DB head 변화만으로 캐시가 자동 갱신되지는 않는다.

설치032의 세 파일 exact hash를 확인하는 v2 패치와 새 domain closure만 추가한다. consumer14·usage-v1·기존 응답/역할/소유권·입력권 경로를 유지한다. 최신 platform·REQ27/006a/25operation으로 전환하지 않는다.

공개 응답은 기존 overall 필드만 사용한다. 원자료·모형 가정·분포·정책·출처 해시는 서버에만 보관한다. 별도 합성14건은 기존 foundation656·Owner36·public-provider58 및 legacy22+extension3 등록과 구분한다. 실제 모형 채택·운영 binding·배포·저장 리포트 화면 인수는 별도 근거가 필요하다.


## 판별 입결 정리본·관리자 반복 검수·본인 리포트 찾기

P1-DISPLAY-SNAPSHOT-01 / BASELINE_OWNER_ACTIVATION_RECEIVED_NEW_STATISTICS_SOURCE_INTEGRATED_SEQ2_PENDING. 신규 API는 구현/확장 등록과 Owner 활성화 전에는 사용할 수 없다.

| 항목 | 계약 |
| --- | --- |
| 원천·단위 | DATA_ACTIVE_ADMISSION_CURRENT_v1.json / jungsi_data_ingest.admission_results_current; trusted local current caches and school source evidence reused; no request-path full view aggregate one display row per academic_year:original_PK_string with verified identity/year links; observations without a verified PK keep original null and their existing opaque observation address in an explicitly counted mapping_pending domain; never fabricate an offering PK or inferred 2027 ID |
| 고정 칸 | recruitment_count_with_stage, competition_ratio, additional_admission_count, final_additional_admission_rank, final_50_percent_cut, final_70_percent_cut |
| 추정 열 | Estimated applicant/rejected counts remain frontend display-only under the approved compatible valid-input rules. Never substitute final reserve rank for additional admitted headcount. |
| manifest | Deterministic semantic version/content SHA, rule version/SHA, input current-head binding, payload bytes/encoding/decompressed size, actual school/row/year counts and creation time. Shared source/basis/cohort definitions are references, not repeated audit bodies. Separate source observations, mapped display rows and unmapped held observations; reconcile all included/excluded selections to the declared source head. Measure gzip/decompressed sizes; a proposed estimate is not a physical bound or acceptance result. |
| 읽기 API | Two explicit read-only operations: small current head and a version-bound gzip/full or bounded-part body. Final routes/DTO/bounds are registered with implementation. No direct browser Storage permission. |
| 갱신·신뢰 | New current head/rules produce one cross-reviewed immutable snapshot; identical content reuses existing bytes. Stable trust anchor, publisher scope, expected-head CAS and rollback must be defined; never remove pins to trust arbitrary mutable content. |
| 공유 서버 cache | Only approved public projection is reusable in the authenticated server BFF/KV by snapshot SHA/rules/scope. Verify user session on every page/cache hit; never store report/profile/score/JWT/relay/private model/cursor or authorization decisions in shared cache. HTTP/browser responses keep no-store. Bounded head revalidation; head/auth/scope failure is not indefinite stale authorization. Actual authenticated head/body API calls retain request/result accounting; a BFF/KV hit with no API call is not charged a fictional full-body API read. Existing personal/engine logical cache accounting stays unchanged. No cache_delivery intent or client quota waiver flag is introduced. FE-CONC-01~04의 화면 소스는 불변 KV 키와 native SQLite 조정자(JT_P1_COORDINATOR/P1SnapshotCoordinator)로 준비한다. head/progress/ready를 KV 잠금으로 처리하지 않고, 복수 인스턴스의 head 재확인·관리자 단일 준비·만료 fence를 원자적으로 조정한다. 최종 색인 작성 직후 최신 head를 다시 확인하며 live/synthetic 조정 상태는 서버 고정 이름으로 분리한다. 필수 KV·조정 바인딩이 없는 실연결/배포는 실패로 표시하고, 명시 synthetic+development/test에서만 같은 상태 기계의 메모리 저장소를 허용한다. 동시 합성36건과 기존 전체 후보의 로컬 재생은 통과했지만 native 자원 생성·worker packaging·실제 배포·운영 혼합 부하는 NOT_RUN이다. CPU 멀티스레딩이나 이용자 무대기를 확정하지 않는다. 사용자 P1-DO-ONLY-20261021에 따라 해당 조정자만 예외 허용됐으며, 실제 계정의 비용 검수·자원 등록·배포·정문 인수는 별도 영수증 전까지 NOT_RUN이다. 회원 표시 getUser 전환과 방문 기록 헤더 조건 보완의 소스 검토를 수용하되 영역 표지나 정상 관측만으로 중계 인증을 완료 처리하지 않는다. 학교가 여러 입력 조각에 걸쳐 있으면 기존 단계당 원문6조각·학교완료12개·고유 fragment읽기20개 한도 안에서 여러 fenced step으로 조립한다. 미완성 학교 rows는 현재 발행본/세대에 결속한 불변 KV key에만 두며 조정 progress에는 학교ID·다음조각 offset·키·이전쓰기prefix·step 메타데이터만 둔다. offset 범위·이전 fence/step·발행본·세대·원래 fragment 순서를 검증하며 완성 전에는 school_keys/학교완료수·ready에 노출하지 않는다. 부분 KV 전파지연·head변경·만료 writer는 fail closed/새 fence 재개로 처리하고 원문 재읽기나 한도 확대·새 자원을 요구하지 않는다. 이 후속의 실제 모듈/SQLite 합성62 및 최소 framework ambient 경계 strict noEmit 통과는 운영 배포나 실제 후보 전수 검수 완료를 뜻하지 않는다. 별도 Root 비공개 전체후보 모듈 재생 PASS는 동결 source hash와 최종 commit blob 동일성에만 결속하며 Worker 용량·실제 인증·배포 인수를 대신하지 않는다. 숫자 전달 PASS는 원래 pending_metadata와 unit=null을 ready로 승격하거나 보류를 해소한 검수가 아니다. 별도 필드별 출처 자격 refs의 계약/DTO 연동/검수와 새 판 운영 인수는 본 조립 수정에 포함하지 않는다. |
| 목록·검색 | Snapshot-backed page/search covers its entire manifest domain with server-side university paging and exact filtered counts. Legacy history.search retains its original bounded cursor and six-page UI behavior until the new path is live; no claim that a partial600 metric result is a whole snapshot. |
| 성능 목표 | Frontend target first page within2s and local search within1s; separate cold version acquisition from warm server-cache page/search timing. These are acceptance targets, not measured PASS. |

정규화·선택 규칙:

- Keep original values/native scalar types, statistic_label/cohort/unit/definition and provenance; normalized codes and display labels are separate.
- Direct university official source precedes official adiga submission only where source authority is established. Select compatible score basis and final-registrant cohort before choosing 50/70 cuts.
- Do not combine subject-specific cuts, average/lowest, registered/admitted cohorts or different score axes based on text resemblance.
- A 75% cut never becomes a 70% cut. Carry an explicitly labelled alternate cut and retain missing true70 status.
- Equivalent display observations may share a selected cell only with compatible value/type/basis/cohort/unit and preserved alternative provenance. Conflicts remain null+reason, not first-row wins.
- Initial recruitment, carryover increment and final recruitment are separate stages. A carryover increment is never a final total.
- Missing units/official qualification are not upgraded from numbers or labels alone. Definition-backed display units retain original null and derivation evidence.
- Unknown metric kinds remain a data review item with neutral display label and original code preserved for inspection; no guessed official score definition.
- Each cell retains verified_official/pending_metadata/pending_value_type/pending_value_missing/not_published and a precise missing/held reason. No null-to-zero, rank-to-count or unsupported ready conversion.
- Apply established direct-university versus official-adiga source priority only to qualified comparable observations. Same-priority conflicting values remain held; retain lower-priority conflicting provenance rather than silently dropping it.
- A metadata-only export deliberately omits original value/source fields. Missing metadata in that export is not proof that the native original lacks it. Reuse full immutable native references and qualified overlays.
- 대학 발표 점수 통계를 50/70/75라는 이유만으로 선필터링하지 않는다. 기존 current/source reader에서 이미 수집된 통계와 원문 근거를 재사용하고, 조회 대상 모집행·학년도와 원문 기준을 유지해 별도 entries에 연결한다.
- 50/70 대표 컷의 기존 동일 점수 기준·최종등록자 자격은 유지한다. 다른 코호트·평균·최저·다른 과목 축은 별도 발표 목록으로만 표시하며 50/70의 결측을 채우지 않는다.
- 별도 발표 통계의 실제 비율은 1~100 정수 또는 null이다. 평균·최저 등 비백분위 통계는 null을 보존하고 원래 통계 라벨로 표시한다. 새 DTO의 닫힌 필드·개별 항목 수·전체 bytes/행 경계는 계속 검증한다.
- 기존 수집된 예비순위와 최종 발표 범위의 근거를 관측별로 확인한다. 날짜·URL metadata 결측만으로 이미 확인된 숫자를 지우지 않으며, 최종 예비번호 자격 미확정·다른 차수/전형 충돌은 원문 독립 검수 후에만 해소한다. 순위를 인원으로 치환하지 않는다.
- 2026-11-01 화면 정책: 최종 합격 예비번호 단일 열, 추가합격 인원은 내부에서 보존한다. 같은 뜻으로 검증된 원문 표현만 해당 관측에 연결한다. 기존 발행물 전체에 별칭이 소급 적용됐다고 추정하지 않는다.

인수 기준:

- Exact manifest/payload SHA and observed row/school/year counts; no duplicate academic_year:original_PK row
- Ten diverse named school/offering samples match current source and selection rules; independently review conflicting/multiple-basis/75cut/stage cases
- Zero null-to-zero, reserve-rank-to-headcount, source/type loss, unauthorized source/normalization status upgrades
- No full current-view COUNT/GROUP/FETCH or N+1 in request path; preserve existing dataset and RLS
- JWT/relay/ownership/current role, public-cache segregation, response allowlist/no-store, physical bounds and new operation negative cases
- Exact candidate source/normal hooks/CI; private final artifact proof; Owner upload/readback/settings; fresh deployed BFF/browser observations remain distinct
- 최종 합격 예비번호 단일 열·행 정렬, 실제 인원 only·null·0·명시 근거 없는 사유·기존 추정 탈락 산식과 동일 report/source ID를 합성·운영에서 각각 검증한다.

ADMIN-VERIFY-QUOTA-01 / SOURCE_IMPLEMENTED_SYNTHETIC_VERIFIED_OPERATING_POLICY_NOT_REGISTERED. Fresh same-Bearer Supabase Auth verification, own profiles role=admin/status=active and aal2; server internal origin only, revalidated each request. No client admin flag or cached privilege.

Explicit policy semantics for confirmed administrator, not null/huge-capacity coercion. Counters and policy keys for normal/paid users are preserved; no reset through role/JWT/profile/key rotation. 보존: shared atomic concurrent_jobs; per-request physical reads/bytes and timeout; current approvals/head/pins; ownership and RLS; idempotency; score-input/correction rights and activation boundary; normal and paid member quotas; security storage fail closed. Prepare bounded resource-safe handling of overlapping ordinary P1 read requests, preferably the snapshot path and reuse. Any queue/concurrency policy change is explicit and tested; no unbounded in-process wait.

REPORT-LOCATOR-01 / SOURCE_IMPLEMENTED_SYNTHETIC_VERIFIED_ACTUAL_PATH_NOT_RUN. 제안 report.list-own / GET /api/v1/me/reports. Only current verified subject; bounded exam-filtered keyset query joining report/profile ownership and existing RLS. No new table/index assumed.

report_id, nullable exam_id, report_version, updated_at; next_cursor/has_more. AES-GCM purpose-bound owner/filter/high-water cursor; limit+1 max21 rows; C/ASCII order. No COUNT or report body. Frontend server validates selected report ownership and CSRF before setting existing HttpOnly cookie. Empty/new-PC list is not permission failure; no automatic POST analysis or score save.

작성 팀과 실행 계층은 다르다. 화면팀의 승인 포트/엔진 결과 조회·조합·입력/DTO/오류 흐름은 기존 서버 application 서비스 공동 개발 정책을 따르며 DB·SQL·자료 어댑터·정본 writer·산출 본체는 기존 담당 범위다. 신규 Secret·DB 역할·배포 권한은 이 문서로 부여하지 않는다.

### 조회 전용 확장의 엄격 등록 검사

COMMON_HARNESS_PREPARED_NO_NEW_OPERATION_REGISTERED. current operations stay25 until service implementation and exact source/runtime/test registration; then exactly28, not an arbitrary operation set

legacy22 and REQ27 extension3 remain exact; their activation and counters are not changed by read3 source registration new read/admin/locator cases run as a separate exact retained-snapshot suite; foundation656/Owner36/public58/whole14 and oracle993 remain separately counted exact method/path/tiers/requirements, application source SHA, runtime/test SHA, no alias/writer/operational promotion, no unregistered or double-counted separate test source

| operation | method | 경로 |
| --- | --- | --- |
| history.snapshot.head | GET | /api/v1/admission-history/snapshot/head |
| history.snapshot.read | GET | /api/v1/admission-history/snapshots/{snapshot_id} |
| report.list-own | GET | /api/v1/me/reports |

현재 준비 상태: NOT_RUN_NEW_SERVICE_SOURCE_ON_THIS_PLANNING_COMMIT / NOT_RUN_NEW_OPERATING_BINDING.

Existing TypeScript policy/schema fixtures retain exact legacy22+REQ27policy3=25, while the actual catalog/schema registry stays28 after strict read3 registration. Validate complete28 schema operation IDs and all references before producing legacy closure; preserve error/readiness and legacy auxiliary public_error_code. New read3 is exercised in the separate suite using the real complete registry. No arbitrary operation/schema filter or skipped execution is permitted.

### 표시 선택과 원문 검수의 구분

ADOPTED_DISPLAY_ONLY_NOT_NUMERICAL_OR_IDENTITY_EQUIVALENCE_APPROVAL. Adopt the candidate's explicit 20-kind order as a display preference only after eligibility and exact signature grouping. It does not establish numerical scale equivalence or authorize a new score formula.

Use an explicitly identified aggregate score basis, same fullmark/component/scope/mean-basis signature and qualified final-registrant cohort. A kind name alone does not prove an aggregate. Subject-specific/same-rank-subject values cannot fill the primary two cuts. Choose one exact eligible basis for both50/70. Missing50 stays missing even if another basis has50.75 stays an explicitly labelled alternate. Hold the affected selected cell with a precise reason and retained alternatives/provenance; no first-row or maximum-score winner.

Do not declare different names/tracks/groups equivalent merely because the current PK matches. Prefer an exact-year/PK authoritative guide display label if verified. Otherwise use a clearly marked display label and retain distinct original identity variants for search/review. Mark identity review pending; do not silently choose one source label and imply that all selected cells are scope-verified. Retain each selected cell's original source context by public-safe identity/provenance references and an explicit identity-scope review reason where necessary. Known source-track/PK conflicts remain alternative-only with a warning. No estimate or analysis may use a cell whose required identity compatibility is held.

Missing publication date remains null and is not a numeric-value review failure. Selected known values remain visible as pending_metadata with precise reasons. Do not promote verified_official, invent a date/unit or recompute native values to clear a display hold. 2026-10-22 사용자 요청으로 대학이 실제 발표하고 현재 정본에 수집된 점수 통계도 표시 범위에 포함한다. 50/70 고정 칸 밖의 비율·평균·최저·최고·중앙값·원문 정의 통계를 기존 alternate_cut.entries로 구분해 보인다. 원문 기준·점수 축·대상 집단·단위·native 값과 검수 상태를 유지하고 비율이 없는 통계에 백분위를 만들지 않는다. 별도 통계를 대표50/70 또는 학생의 합격판정 근거로 자동 승격하지 않는다.

Preserve original normal line-feed U+000A only in explicitly identified human department/track/statistic fields under the closed public DTO. Keep ID/URL/header/code control-character rules and secret/private URL protection strict. Do not strip source originals, invent PKs or suppress otherwise known values to satisfy a string check.

For an approved estimated_weights/official_all_examinees result use a neutral human label such as 공식 전체 응시자 기준 채택 추정 누백 모형. Keep exact model_version and immutable model bytes; do not hardcode a real model ID/hash or numerical model into frontend source.

| 보류 코드 | 화면 안내 |
| --- | --- |
| SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING | 발표 지표의 기준·단위·출처 정보를 확인하고 있습니다. |
| NO_QUALIFIED_CANDIDATE_IN_CURRENT_SOURCE_SCOPE | 현재 연결된 자료에서 이 표시 기준에 맞는 값을 확인하지 못했습니다. |
| FINAL_WAITLIST_SOURCE_QUALIFICATION_UNCONFIRMED | 최종 합격 예비번호인지 확인하고 있습니다. |
| NO_CUT_ALTERNATIVE_IN_SELECTED_SCOPE | 선택한 표시 범위에서 별도의 대체 컷을 확인하지 못했습니다. |
| MULTIPLE_SAME_PRIORITY_BASIS_DEFINITIONS_UNRESOLVED | 서로 다른 점수 기준이 있어 대표값을 확인하고 있습니다. |
| OTHER_BASIS_OR_EXPLICIT75_RETAINED_NOT70_BACKFILL | 다른 점수 기준 또는 별도 비율의 발표값이며 70%컷을 대신하지 않습니다. |
| NO_FINAL_REGISTRANT_SAME_BASIS_CUT50 | 선택한 점수 기준의 최종등록자 50%컷을 확인하지 못했습니다. |
| NO_FINAL_REGISTRANT_SAME_BASIS_CUT70 | 선택한 점수 기준의 최종등록자 70%컷을 확인하지 못했습니다. |
| MULTIPLE_CURRENT_CANDIDATES_DEFINITION_EVENT_OR_VALUE_CONFLICT | 발표 근거나 값이 여러 가지여서 확인하고 있습니다. |
| NONNUMERIC_LITERAL_REQUIRES_SOURCE_REVIEW | 원문 표기를 확인하고 있습니다. |
| UNCLASSIFIED_BASIS_NEEDS_SOURCE_DEFINITION_NO_TOTAL_CUT_PROMOTION | 점수 기준이 확인되지 않아 대표 컷으로 표시하지 않습니다. |
| IDENTITY_SCOPE_REVIEW_PENDING | 모집단위 명칭·전형·모집군의 연결을 확인하고 있습니다. |
| SOURCE_TRACK_PK_CONFLICT | 원문 전형과 연결된 모집행이 달라 확인하고 있습니다. |
| OFFERING_MAPPING_PENDING | 이 자료의 모집행 연결을 확인하고 있습니다. |

### 대학 발표 통계의 원형 노출

P1-PUBLISHED-STATISTICS-20261022 / SOURCE118_SEQ2_SCOPED_ACTIVATION_VERIFIED_SIX_SOURCE_SEMANTIC_QA_AND_NEW_2027_METADATA_PENDING.

| 항목 | 확정 범위 |
| --- | --- |
| 공개 표현 | 기존 alternate_cut.entries를 대학 발표 통계 목록으로 확장한다. 통계 라벨·실제 비율(비백분위는 null)·점수 기준·대상 집단·원문 단위·값/native 자료형·출처/기준일·검수 상태/사유를 함께 유지한다. 기존 explicit75 판 수신과 true50/70 의미를 보존한다. |
| 관측 선택 | 현재 정본의 모집행·학년도에 연결된 실제 점수 관측을 사용한다. 출처·통계·코호트·척도·과목/성분·발표 범위가 다른 관측은 합치지 않는다. 같은 관측을 기준별로 복제하지 않으며 동등한 값 선택과 충돌 근거를 보존한다. |
| 화면 | 대학 발표 통계를 별도 영역에 원래 명칭·비율·점수 기준·집단별로 표시한다. 값이 있고 metadata만 미확인이면 값과 확인 사유를 함께 보인다. 현재 선택 범위 제외를 대학 미발표로 표현하지 않는다. 화면 소스의 합성38건·실제 SDK 표 엄격 타입·실제 React 표 렌더 검수는 통과했다. 비율/코호트/기준일을 보존하고 entries가 없더라도 실제 잔여건수가 있으면 영역을 유지한다. 원자료의 내부 관측 ID를 새 브라우저 props에 추가하지 않는다. 새 발행판·운영 빌드/배포/실자료 화면은 별도 미실행이다. 원문 결속·지표/집단/표시 문맥을 확인한 알려진 값은 세부정의가 공란이어도 pending_metadata로 표시한다. inline basis_definition 텍스트가 없다는 사실만으로 다른 발표 통계를 일괄 제외하지 않는다. 기존 exact-kind 표시 사전의 파생명과 검증된 대학 원문 제목은 구분하고, 불완전한 척도 정의를 같은50/70 기준이나 verified_official로 승격하지 않는다. |
| 결측/충돌 | 실제0, null, 원자료 없음, 선택 범위 제외, 자격 미확정, 값/정의 충돌, 공식 미발표를 구분한다. 평균→50/최저→70/75→70/등급→환산점수 변환은 하지 않는다. |
| 보안/상한 | 닫힌 DTO·기존 entries 수/행/객체 bytes 제한·현재 user/relay/승인/만료/공유 예산/no-store를 유지한다. 항목 상한으로 일부가 빠지면 잔여를 정확히 표시하고 완료·미발표로 표현하지 않는다. 원자료·전체 검수 본문·비밀·내부 파일 경로는 브라우저로 보내지 않는다. |
| 자료 담당 | 기존 학교별 원문·불변 native 참조·O/X 검수를 재사용한다. 대상 통계의 upstream50/70/75 선필터와 source qualification을 좁혀 보완한다. 전국 누백 로컬 일괄 준비/단일 writer 및 다른 팀의 live 제어를 변경하지 않는다. |
| 코드/자료/새 발행/실제 화면 | SOURCE118_FULL_INSTALLED_SOURCE_RELOADED_AND_MATCHED_NO_NEW_RUNTIME_CODE_IN_THIS_PLANNING_CHANGE / SEALED_TYPED_REFS_COMPLETE_SELECTED_NEW_CID_ASSEMBLY_AND_INDEPENDENT_PROJECTION_REVIEW_IN_PROGRESS / OWNER_SEQ2_COMMITTED_ROOT_CURRENT_METADATA_HASH_MATCH / ROOT_EXACT_QUALIFIED_FIELDS_PASS_SIX_OWNER_QA_DISPLAY_REPORTS_REPRODUCED_NOT_SEMANTIC_APPROVAL |

검수 조건:

- 50/70 고정 칸과 기존75 판은 이전과 같은 의미로 수신
- 실제 다른 비율과 비백분위 통계가 원문 라벨/축/집단/native 값·타입을 보존하고 API→화면으로 이어짐
- 서로 다른 cohort/과목/만점/척도 통계의 혼합 및75→70/평균→50/최저→70 변환0
- 정확 SHA 소스/훅/CI와 불변 새 발행판의 독립 검수·Owner 적용·표적 실제 화면 검수 분리

### 현재 정리본 읽기 관측

READ_ONLY_BASELINE_PUBLICATION_AND_TARGET_RENDERING_OBSERVED. 기존 DB 발행 head approved와 로그인된 P1 전국 요약·대상 모집단위의 연도별 자격 보류/결측 표시를 대조했다. 과거 head0/소수 학교 화면 관측은 역사다. 실제 사용자 JWT·토큰/계정/실제 자료 지문을 공개하지 않는다. 배포 source/Storage 직접GET/전체 보안·전체학교 인수는 이 읽기 증거만으로 PASS로 바꾸지 않는다.

별도 조회 소스 등록: SOURCE_REGISTERED_NOT_ACTIVATED / history.snapshot.head, history.snapshot.read, report.list-own. 전체 논리 API28개, 기존22·입력권3·조회3의 소스/시험 증거를 분리한다. 다음 NOT_RUN은 등록 소스의 합성/별도 인수 기록이며 현재 combined 운영 보고는 아래 날짜별 Owner 영수증을 따른다. 별도 시험 306개이며 실제 인수 NOT_VERIFIED_BY_SOURCE_SUITE, 새 binding 활성화 NOT_RUN다.


현재 운영 기준: This supersedes the earlier deployment-pending status for the limited 503 repair only. Preserve previous runtime and acceptance receipts as history; retain independent data and engine gates.

### 최신 Owner·화면팀 운영 영수증의 한정 수용

OWNER_V21_SCOPED_REPAIR_FULL_HOSTED_SOURCE_INDEPENDENTLY_VERIFIED_NEW_FOLLOWUP_ACCEPTANCE_PENDING. 비공개 영수증 SHA256 d605c280477ff96365d2ab56986b0ee0826857cf4de4f3605f5e23d176b16260 / 소스 a678badcd7e4bd03409f3203f5549785e834719d / 파생 배포 번들 6dfe2d296b10219140b4c06083893fcee0b48457a7d09df2c4909e18c66b8c0f.

No new Root authenticated Storage read or source publication in this task. The maintenance receipt reports no Storage/configuration change.. Owner reports matching eight-character digest prefixes for the existing five settings. Full digest columns and values were not freshly read by Root; no registration change is reported.. New historical-reference edition is not activated by this receipt; preserve existing qualified data and use the current independently pinned source tuple for preparation.. Owner reports the existing input-right state preserved. No new score save or transition SQL was run in this acceptance..

Root 독립 live 재실행: Fresh installed-source identity PASS. Login and the existing P1 screen were observed read-only; current screens are not evidence that an unpublished local candidate was deployed. Exact successful business HTTP, row reasons, old-report/print and full security acceptance remain separate and unverified.. 형식상 native/deployment PASS는 전체 인수 조건의 증거가 있을 때만 기록하며, 실제 배포/부분 화면 관측 사실은 아래 현재 원장으로 구분한다.

| 기존 operation | 현재 배포 보고 | 이번 화면 관측 | 공식 인수 경계 |
| --- | --- | --- | --- |
| history.search | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| recruitment.read | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| score-profile.create | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| overall.analyze | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| report.read | EXISTING_SOURCE118_BACKEND_UNCHANGED_OWNER_PR66_FRONTEND_RECEIPT_BOUND | ROOT_CURRENT_OWN_REPORT_AND_OWN_LIST_RENDERED_OLD_REVISIONS_PRESERVED | SCOPED_ACTUAL_BROWSER_AND_STORED_RESULT_PASS_FULL_NATIVE_SECURITY_CASES_NOT_RUN |
| offerings.search | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| offering.read | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| university.analyze | OWNER_REPORTED_V21_LIMITED_MAINTENANCE_OVERLAY_FULL_SOURCE_PIN_MATCHED | OWNER_REPORTED_SCOPED_UI_SUCCESS_AND_NO_NON2XX_WARNING; EXACT_SUCCESSFUL_HTTP_CAPTURE_NOT_RUN | NOT_RUN_FULL_OPERATION_SECURITY_ACCEPTANCE; DO_NOT_INFER_FROM_SCOPED_OWNER_REPORT |
| candidates.build | EXISTING_SOURCE118_BACKEND_UNCHANGED_OWNER_PR66_FRONTEND_RECEIPT_BOUND | ROOT_EXPLICIT_BUILD_AND_REFRESH_PASS_DATA_PENDING_PRESERVED_SAVED_RESULT_READBACK_INPUT_ATTEMPTS_UNCHANGED | SCOPED_ACTUAL_BROWSER_AND_STORED_RESULT_PASS_FULL_NATIVE_SECURITY_CASES_NOT_RUN |
| shortlist.update | OWNER_REPORTED_V21_LIMITED_MAINTENANCE_OVERLAY_FULL_SOURCE_PIN_MATCHED | OWNER_REPORTED_SCOPED_UI_SUCCESS_AND_NO_NON2XX_WARNING; EXACT_SUCCESSFUL_HTTP_CAPTURE_NOT_RUN | NOT_RUN_FULL_OPERATION_SECURITY_ACCEPTANCE; DO_NOT_INFER_FROM_SCOPED_OWNER_REPORT |
| report.export | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| statistics.read | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| session.read | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.capabilities | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.list | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.create | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.read | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.adjust | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.validate | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.approve | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.publish | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |
| forecast.published.read | OWNER_V19_SOURCE118_ROOT_FULL_SOURCE_HASH_MATCH_NOT_ALL_OPERATION_ACCEPTANCE | NO_NEW_OPERATION_TRACE_FROM_READONLY_PAGE_OPEN_RECEIPT | NOT_RUN_RESIDUAL_SECURITY_AND_BUSINESS_CASES |

남은 인수: explicit successful HTTP evidence for the specified final candidate; print/previous-report and no-token/other-owner regression; full operation-specific security acceptance; current-year conversion/domain adapter readiness; new P1 edition preparation and separate activation.

### 2027 부분 발행과 현재성 검토 후보

소스 후보 0129488f3078b25c7d915d5c0aecefe9b5883111 / SOURCE_CANDIDATE_SYNTHETIC_ONLY_RUNTIME_AND_PUBLICATION_NOT_RUN. 미병합 소스와 합성 검수의 기획 검토이며 실제 DB·승인·발행·화면·운영 배포를 완료로 표시하지 않는다.

| 구분 | 검토 계약 |
| --- | --- |
| 기획 참고 | P1-OFFERING-2027-INDEPENDENT-SCOPE-02 / REVIEW_ONLY_HOLD_UNPUBLISHED |
| 화면·경로 | /admissions/results / history.snapshot.head, history.snapshot.read |
| 부분 범위 | Partial R27 v2 scope exposes only independently reviewed eligible_non_practical rows; excluded and held rows are counted, not included. Both head and every body part carry matching partial coverage. Full and partial global receipts require an in-process sealed source-bound candidate/index and exact ordered rows. |
| 권한·소비자 | Separate server-controlled descriptor and dedicated relay credential, plus independently pinned partial-aware consumer receipt; missing or invalid optional settings leave v1 available and v2 fail-closed. |
| 원문·미확정 | preserve absent, explicit null, zero, original literal, uncertainty and conditional rollover separately; never infer final or initial from unknown stage keep standalone 2027 rows, link past years only where authorized scope and evidence match; unresolved history does not drop the 2027 row Reviewed links v2 requires separately approved exact source and target scope field states (confirmed_value or confirmed_null) and an evidence-pinned trusted descriptor. A missing or unknown field never becomes confirmed null. Historical matching uses the exact target identity and a unique mapped historical row; cross-school and competing grants remain held. Legacy v1 matching remains unchanged. These assertions do not authenticate the issuer or establish actual evidence. V2 must bind source head, previous publication and source head, scope, and authority digest through a separately trusted descriptor; compose rejects a head or scope mismatch. Hash matches do not authenticate an issuer. |
| DB 대조 | 현재 정본 head·writer·동일 스냅샷·앱 역할/RLS·전체 출처와 미반환/중복을 대조하고 실행계획·실측 부하를 검증한다. 미확인 값은 보류한다. |
| 승인 현재성 | 서버가 실제 사용자·중계 신원 및 공유 원자적 예산을 유지하고 발행판·원천·범위·소비자·만료·취소와 revision을 일관되게 확인한다. 확인 경로 미구현은 v2 전달을 차단한다. |
| 연결·화면 | 검토된 연도별 연결만 묶는다. 보류·미확인 연결, 복수 전형·모집군, 조건부 이월과 발표 단계를 구분하고 모집인원을 임의로 채우지 않는다. |
| 미인수 | actual_source_head_and_scope, independent_descriptor_authority, relay_build_and_secret_isolation, publisher_q_reference_rebind, operating_budget, DB_Storage_publication, deployment, consumer_UI; 실제 정본 및 출처·권한·승인·부하·DB 발행·배포·Owner/브라우저 인수 NOT_RUN; 기존 인증·요금제·예산 보존 |

### 화면팀 운영 영향 회신 검토 (미인수)

OWNER_UI_AND_TWO_SCOPED_APP_SESSIONS_OBSERVED_BROADER_VALIDATION_NOT_RUN. 2026-10-31 화면팀 Owner의 시점별 보고 및 배포 소스 정적 검토, 사용자의 Owner 적용 확인, 기획팀의 읽기 전용 관리 화면 관측과 두 시점의 단일 읽기 전용 앱 역할 세션을 구분한다. 이는 모든 DB 연결과 결제·인증 동작을 독립 인수한 결과가 아니다.

| 구분 | 확인·후속 상태 |
| --- | --- |
| SSL 현황 | 화면팀 Owner는 2026-10-31 13:00 KST SSL 강제가 OFF였고 14:58:53 KST ON으로 적용한 뒤 15:5x KST 다시 OFF로 되돌렸다고 보고했다. 사용자는 ON의 적용 주체가 Owner라고 확인했다. 기획팀의 15:30경 읽기 전용 대시보드 두 차례 표시는 당시 disabled / Value 1(ON)이었고, 15:58 KST 읽기 전용 재확인 표시는 disabled / Value 0(OFF)였다. 14:58:54 KST DB 프로세스 기동과 설정 변경의 인과관계 및 OFF 복귀의 정확한 시각은 미확인이다. 기획팀은 설정 토글이나 DB 재시작을 수행하지 않았다. |
| 연결 코드 보고 | 2026-10-31 15:30:34 KST 당시 ON 기간의 단일 읽기 전용 앱 역할 세션에서 데이터팀은 클라이언트 verify-full·libpq SSL 사용과 DB 백엔드 pg_stat_ssl=true, 세 테이블 SELECT·RLS·FORCE RLS 및 앱 역할 nonowner·nonBYPASS를 확인했다. 16:00:18 KST OFF 표시 후 별도 단일 읽기 전용 앱 세션은 CA·verify-full 사용과 클라이언트 TLS=true였으나 공유 풀러에서 DB까지의 pg_stat_ssl=false 및 TLS version null을 보여 주었고 롤백·연결 종료했다. 각 관측은 해당 시점의 해당 연결에 한정하며 설정 변경과 연결 상태의 인과관계, 내부 peer hostname, 다른 연결과 후속 세션으로 확대하지 않는다. Owner는 운영 배포 소스를 정적으로 읽어 current-admission-review와 official-history-display의 인증서 확인 TLS 및 본체 본인인증·결제 승인·환불 세 함수의 TLS require 설정을 보고했다. 이는 해당 함수의 실제 호출·전환 후 정상 동작을 입증하지 않는다. 별도 서비스 브랜치의 1.9.139 기준 로컬 1.9.140 후보는 PC probe의 verify-full이 require로 낮아질 가능성을 보완했고, 기획팀의 별도 합성 실행에서 어댑터 46건과 이용권 5건이 통과했다. 시험 전 파일 지문은 미수집이며 사후 지문은 현재 관련 파일 세 개 및 개발팀 보존 후보·기준 Git 파일과 대조됐으나 시험 전 동일성을 입증하지 않는다. 서비스 작업 트리의 기존 CRLF 관련 검사 6건은 실패했고 Git blob을 사용한 748파일 격리 정합성 통과는 별도 결과이므로 원래 작업 트리나 CI 통과를 뜻하지 않는다. 기획 로컬 정본 1.9.137에는 미통합이며 실제 DB·기존 GSS 전용 연결 호환성·실제 사용 여부·정확 SHA CI·배포는 NOT_RUN이다. |
| 강제 전환 조건 | 15:58 KST 기획팀의 읽기 전용 화면은 OFF로 표시됐다. 설정을 임의로 변경하거나 되돌리지 않는다. 재적용 전 함수 밖 직접 DB 연결 목록, 각 연결의 TLS·인증서 및 재연결 호환성과 영향 범위를 확인하고 Owner와 작업 시간·전환·복구 절차를 정한다. 일부 세션의 관측이나 일정 기간 비암호화 접속 0건은 표본·미실행 경로의 한계 때문에 전체 호환성 완료로 간주하지 않는다. Owner 회신 v2의 함수 밖 직접 연결 도구 목록과 재적용 시간은 부분 확인·후보이며 다른 도구·자동화와 최종 일정은 확인되지 않았다. |
| 대조 부하 | DB 대조는 실제 계정 권한과 RLS, 승인된 head·writer, 조회 계획 및 자료 전체성·자료형을 먼저 확인한다. 화면팀과 사전 조율한 낮은 부하 시간의 소규모 읽기 전용 묶음, 타임아웃과 묶음 간 휴지 및 중단 기준을 계획하되 미검증 처리량·허용 예산을 확정하거나 완료를 주장하지 않는다. 15:30:34 세션은 메타데이터 점검이며 실제 EXPLAIN 호출과 자료 읽기는 없었다. 실제 EXPLAIN 실행기 후보에는 같은 연결의 SSL 사용 확인과 수행 후 writer 상태 확인 가드가 누락돼 있어, 이를 고치고 독립 검수하기 전까지 실행과 대조는 HOLD다. |
| 2027 발행 | 2027 자료는 원문 불일치와 중복, 학년도·전형·조건 및 발행 범위, 승인 원문과 현재성, DB 재조회 및 화면 인수 전까지 HOLD다. 특정 승인에 대해 확인되지 않은 근거를 만들어 내지 않는다. |
| 3페이지 head 결속 | 입결 head 또는 검색 descriptor 개정으로 3페이지 조회 기준이 바뀌는 발행은 해당 descriptor와 키 색인을 새 head에 함께 결속하고 불일치 중에는 안전하게 차단한다. 실제 3페이지 검색과 대상 연도·전형·조건을 검수하며 운영 재결속 완료는 실행 영수증으로만 표시한다. |
| 화면·API·권한 | P1: history.snapshot.head GET /api/v1/admission-history/snapshot/head, history.snapshot.read GET /api/v1/admission-history/snapshots/{snapshot_id}. P3: history.search GET /api/v1/admission-history, offerings.search GET /api/v1/offerings/search. 기존 사용자·이용권·소유권·relay·조회 예산은 유지한다. |
| 미실행 | 다른 연결과 후속 세션의 실제 TLS 호환성, 내부 peer hostname 검증, SSL 강제 변경 뒤 본인인증·결제·환불 정상 동작 검수, DB 프로세스 기동과 설정 변경·두 세션 차이의 인과관계 확인, 기획팀의 설정 변경 및 DB 재시작, PC probe의 실제 DB·GSS 연결 호환성과 실제 사용·수정 배포, 실제 EXPLAIN 및 상용 부하 대조, 승인 원문 확인, 발행·색인 재결속 및 실제 화면 인수는 NOT_RUN이다. |

### 2026-11-01 화면 Owner 재적용 회신과 선택 시간

OWNER_REPORT_RECEIVED_USER_WINDOW_SELECTED_REAPPLY_NOT_RUN

| 구분 | 확인·후속 상태 |
| --- | --- |
| Owner 보고 | 2026-11-01 화면 Owner는 SSL 강제 재적용을 허용 가능한 것으로 판정하고 기존 Python probe TLS 보완 배포는 재적용 선행 조건이 아니라고 설명했다. 2026-10-31 14:51 세 본체 함수의 503은 포트원 설정 전의 자체 점검 not_configured였고 고객 영향이 없었으며, 14:58 연결 종료 기록은 SSL 강제 적용에 따른 DB 재시작 결과라는 설명은 Owner 보고다. 14:48 권한 오류의 실제 주체는 확인되지 않았다. |
| 원시 파일 정합성 | 서비스 후보의 기존 검수 등록 소스 중 내용은 HEAD와 같고 CRLF만 달랐던 56개 텍스트 경로에 LF 체크아웃을 지정한다. 기존 원시 바이트를 보존한 후 해당 개발 작업본만 LF로 맞췄다. 정책은 기획 로컬 후보이며 GitHub 반영·다른 PC의 기존 체크아웃 수정은 별도다. |
| GitHub CI | 기존 서비스 PR #70의 기준 커밋 0129488f3078b25c7d915d5c0aecefe9b5883111은 2026-11-01 GitHub Actions run 41041366639 재실행에 성공했다. 이는 이후 미커밋 Python TLS 후보의 새 정확 커밋이나 CI 성공을 뜻하지 않는다. |
| 증거 범위 | 10-31 ON 시 앱 역할 단일 세션의 클라이언트 TLS와 백엔드 SSL=true, OFF 시 별도 세션의 클라이언트 TLS=true·백엔드 SSL=false라는 제한된 관측은 유지한다. Owner는 운영 두 표시 함수 코드의 인증서 검증 TLS와 본체 세 함수의 require를 확인했다고 보고했으나 각 함수의 실제 운영 인수를 의미하지 않는다. |
| 선택 시간 | 사용자가 2026-11-01 23:00~23:15 KST를 선택했다. 기획·데이터팀은 이 시간에 대조·적재·발행을 실행하거나 예약하지 않는다. 다른 PC·Owner의 작업 중단과 실제 전환은 별도 확인한다. 스위치 조작은 사용자와 지정된 Owner의 운영 절차를 따른다. |
| 다른 접속 도구 | 사용자는 다른 PC·별도 도구의 sslmode=disable 설정 유무를 확인해야 한다고 답했다. 이미 확인한 일부 프로그램의 verify-full 또는 require와 그 외 도구·예약 작업 미확인을 분리한다. 일부 SSL 호환 확인을 모든 클라이언트의 성공 증거로 확대하지 않는다. |
| 전환 후 검수 | Owner는 재적용 후 함수 6개, 정시터치 1~4페이지, 정문, pg_hba 거절과 본체 연결 집계를 확인할 예정이다. 담당자는 전환 후 한 앱 역할 읽기 전용 세션에서 클라이언트 TLS와 pg_stat_ssl을 확인한다. 실결제·실환불을 발생시키지 않고 변경·복구는 지정 운영자가 관리한다. |
| 오프라인 자료 검수 | 데이터팀은 기존 고정 입력 28개 지문과 2027 검토 명부 1,625행을 재검증했다. 직접 원문 참조는 기존 287건과 추가 323건의 범위로 구분하고 명시 HOLD 144행과 외부 HOLD 12건은 유지한다. 재사용·합성 검증은 실제 DB 174,655건 대조, 전국 원문 전수 또는 자료 발행의 완료가 아니다. |
| 기존 자료와 승인 | 전국 174,655건 실제 DB 대조는 head·원문·승인·안전한 제한 조회 및 사전 통지가 남아 있다. 2027 자료 발행과 충원 분류 HOLD를 유지한다. 연말 descriptor 11월 20일까지 갱신 및 11월 22일 00:00 UTC 만료는 Owner 보고이며 각각 유효한 운영 증거로 확인한다. |
| 경로·권한 | 기존 P1 history.snapshot.head/read 및 P3 history.search·offerings.search, 회원·소유권·relay·공유 예산과 3페이지 descriptor·키색인 결속을 유지한다. 재적용 시 인증·권한 완화나 유료 자원 신설은 없다. |
| 미실행 | SSL 재적용·전환 후 실제 6함수/1~4페이지·DB 재조회·다른 PC 전체 연결 검증·운영 배포·174,655건 실제 비교·2027 발행과 descriptor 갱신은 수행 전이다. |

### 2026-11-01 화면 배포 보고와 대조 준비

OWNER_REPORT_RECEIVED_GITHUB_HEAD_MATCHED_RUNTIME_NOT_INDEPENDENTLY_ACCEPTED

| 구분 | 확인·후속 상태 |
| --- | --- |
| 배포 보고 | 화면팀은 2026-11-01 13:04 KST 화면 Worker 14a4653a 배포와 비율 100%, 기존 preview·live 연결 유지를 보고했다. GitHub 화면 브랜치 head는 8e6ca9e37fbb889b87a552dc7595ec568596944a와 일치했다. 운영 Worker 버전·비율은 별도 관측하지 않았다. |
| 합성·운영 기간 | 화면 제작용 paid 합성 세션의 날짜는 2027-01-07 23:59:59 KST다. 이는 합성 값이며 운영 세션·DB 권리의 갱신 증거가 아니다. 시즌 종료 후보 2027-01-08 00:00 KST의 배타 경계와 더 이른 개별 이용권 만료는 별도다. 실제 서버 배포판·경계와 화면 합성 값의 기능상 비교 여부를 각각 검수한다. |
| 화면 관측 범위 | Owner는 관리자 P1·P3의 화면 점검과 일부 연결 확인 중 상태 및 비로그인 404를 보고했다. 기획팀의 비로그인 브라우저는 404 안내 화면을 관찰했으나 관리자 결과·HTTP 상태·Worker 버전은 독립 확인하지 않았다. 구체적인 자료 집계는 비공개 운영 영수증에만 보관하며 2027 발행이나 전체 DB 대조의 증거가 아니다. |
| 대조 연결 준비 | 데이터팀은 기존 서비스 SQL 변환기를 직접 재사용해 대조 SQL의 네 뷰 구간을 로컬 연결했고, 네트워크 차단 합성 PG17에서 관측 2·출처회원 3을 직접 뷰 조회와 대조했다. 승인 metadata·head·writer·RLS·실부하 및 174655건 실대조는 미확인이다. 추가로 같은 스냅샷 대조 절차의 합성 검수 38건을 통과했으며 운영 진입점은 HOST_RUNTIME_NOT_BOUND로 차단한다. 기존 메타데이터 검증·네 뷰 변환·무손실 해독·비공개 메타데이터 비교기를 재사용했으나 실제 발급자·동일 네이티브 연결 TLS·RLS·현재 head·writer·부하 확인은 미구현 또는 미검증이다. 숫자 일치와 원천 전체성은 확인되지 않았다. |
| 후속 일정 | 선택한 SSL 시간 2026-11-01 23:00~23:15 KST에는 대조·적재·발행을 하지 않는다. 다른 PC의 SSL 끄기 설정은 확인 필요로 Owner에게 전달한다. Owner가 보고한 연말 descriptor 갱신 기한은 11-20이며 정확한 승인·설정의 운영 증거를 재확인한다. 기획 develop 4f5ecaa와 서비스 브랜치 1330dde8은 각각 정확한 SHA의 GitHub CI를 통과했다. PR 70의 공통 명세 충돌 해결과 이후 통합 커밋의 CI·실제 운영 배포는 아직 남아 있다. |
| 경로·권한 | 기존 P1 history.snapshot.head/read·P3 history.search와 offerings.search, 회원·이용권·소유권·relay·조회 예산을 유지한다. 실제 입결 head 또는 검색 descriptor가 바뀌는 발행은 descriptor·key index·coverage를 같은 판에 결속한다. |
| 미실행 | 관리자 화면 독립 인수, 실제 사용자 이용권 및 운영 종료 경계, 재적용 후 TLS·함수 검수, 실제 DB 174655건 대조·2027 발행·descriptor 갱신은 이 보고만으로 완료되지 않았다. |

### 2027 모집인원 단계 계약 검토 후보

REVIEW_ONLY_SYNTHETIC_HOLD_NO_OPERATIONAL_ACCEPTANCE. 서비스 후보와 화면 후보의 코드 및 합성 시험을 기준으로 모집인원 단계 계약을 검토한다. 실제 운영 DB·화면·발행의 상태를 검증한 결과가 아니다.

| 구분 | 현재 후보와 검토 조건 |
| --- | --- |
| 입결 snapshot 조합 | 입결 정리본 조합 후보는 원천의 단일 모집인원 값을 사용하며 조합 상태를 pending_metadata, 단계는 unspecified로 둔다. 검토 시점의 1페이지 화면 후보에는 해당 연도 요약 연결이 null이라 준비 중으로 표시되는 경로가 있다. 이는 실제 운영 화면의 배포 상태 관측이 아니다. |
| 별도 모집정보 경로 | recruitment.read GET /api/v1/offerings/{offering_id}/recruitment는 별도 계약이다. 후보는 단일 원천값을 해당 최초 또는 최종 한쪽의 initial_count·final_count 칸으로 투영하나 이월 조건 설명을 반환하지 않으며, 없는 다른 단계의 값을 만들어 주지 않는다. |
| 표시·계산 안전 | 후보 화면의 일부 상세 경로는 pending 수치에 확인 표시를 붙이거나 추정 계산에 사용할 여지가 있어 소비자 수정·검수가 필요하다. pending은 확정 수치나 추정 계산 입력으로 사용하지 않으며, 기존 단계명 숨김 결정과 최초·최종·조건 표시의 관계를 화면 Owner와 함께 검토한다. |
| 단계·결측 의미 | 최초 관측, 이월 등 조건과 최종 관측은 각각의 공식 근거와 단계가 확인될 때만 연결한다. 단계가 없는 단일 값에서 다른 단계를 추정하지 않고 0, 미확정 null, 값 누락 및 원문 자료형을 구분한다. 독립 근거 없는 최종 숫자를 생성하거나 최초 값을 최종으로 복사하지 않는다. |
| 기존 소비자 호환 | 현재 정리본 v1/v2는 닫힌 계약이므로 임의로 필드를 추가하지 않는다. 재사용할 숫자 칸, 조건 설명과 단계 근거를 전달하는 버전·소비자·권한·허용 응답 계약을 별도로 협의하고 기존 소비자의 호환성을 검수한다. 새로운 API나 발행 승인은 이 검토에 포함하지 않는다. |
| 검증·발행 상태 | 별도 서비스 계층 검토 모델과 기존 조합 함수의 합성 검증 보고만 있다. 독립 원문 검토 결과를 실제 DB 현재값이나 전국 전수 검수로 확대하지 않는다. 실 DB 비교·원천과 소비자 승인·실제 화면·배포·발행은 NOT_RUN이며 기존 HOLD를 유지한다. |


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