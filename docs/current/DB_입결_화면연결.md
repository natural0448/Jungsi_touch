# Supabase 입결 DB와 화면 API 연결

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.23이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

승인된 동결 역사 입결의 제한 표시 검수; 현재 단일 정본 공급자는 별도 준비 단계

계약 2026.10.09.v6 · 코드 runtime_bootstrap_fix_integrated_generic_redeployed_real_cloud_acceptance_pending · production_ready=false. 담당 feature/application-pre-data-platform.

## 연결과 승인 범위

화면/BFF → Supabase Edge 서비스 API → 기존 비공개 입결 DB. Python은 로컬 기준이다. DB 적재·C 로컬 수신·제한 클라우드 검수·운영 발행은 각각 구분한다.

- 표시 purpose 승인과 engine/production/native 전체 발행은 구분한다. 기존 Storage 승인 guard와 원본 false/null 상태는 유지한다.
- 실DB의 승인된 exact source rows를 app role READONLY/TLS로 조회한다. 기존 카탈로그는 공개 설명·정의·출처 메타와 기대 검수에만 쓰며 DB를 조회하지 않은 fixture로 성공을 대체하지 않는다.
- 값·타입·null·원 literal·지표 정의·단위·원척도·모집행 PK·학년도·출처를 보존한다. 다른 컷/모집집단으로 치환하거나 연도 anchor를 과거 행에 덮어쓰지 않는다.
- 누락/중복/추가행·다른 scope/버전/지문·승인 만료/회수·DB 장애는 비밀 없는 503/403으로 거절한다. 미공개·미검수와 실제 0을 구분한다.
- 승인한 명시 source 범위의 동일성이 검증된 경우에만 최적화 PK 조회를 선택할 수 있다. 같은 원형/버전/typed fingerprint를 결속하고 다른 행이나 overlay로 일반화하지 않는다. 불일치 때 전체 view/fixture로 자동 fallback하지 않는다.
- 서버 relay → 실제 Supabase 사용자 → 서버 검증 sub 명부 → 현재 이용권/operation 권한 → 자료 조회 → 재귀 공개 DTO 순서를 유지한다. staff/admin을 paid로 자동 승격하지 않는다.
- Edge function prefix는 배포 transport다. suffix의 기존 API 경로·query·회원·DTO/session v1은 그대로이며 미포팅 operation을 구현 완료로 기록하지 않는다.
- 모집군/인원 중 검수하지 않은 값은 pending/null로 유지한다. 제한된 검수 scope의 빈 결과를 전국 자료 부재로 설명하지 않는다.
- no-store·직접 접근 거절·안전한 오류를 유지한다. 공유 원자적 예산과 실제 JWT/BFF/브라우저의 미인수 상태는 운영 보안 3 gate 완료로 바꾸지 않는다.
- 공개 TS와 공유 의존·검수 소스의 전체 본문 SHA를 같은 스냅샷 색인에 결속한다. 기존 Python AST 검사를 유지하며 Deno 타입/런타임 증거를 별도로 기록한다.
- RLS와 최소 역할 권한을 유지한다. 서버 app 역할은 superuser/BYPASSRLS/자료 소유자가 아니어야 하며 row_security=on, 실제 참조 표의 RLS 정책 적용과 view security_invoker 또는 직접 RLS 표 경로를 확인한다. 이를 확인하지 못하면 응답을 보류한다.
- 모집행·입결·출처와 승인 선택 PK를 파라미터화한 bounded bulk JOIN으로 같은 READONLY snapshot에서 한 번에 조회한다(data query 1회). 학과/지표별 SELECT 반복 N+1, 검수하지 않은 전체 view/다른 버전/fixture fallback은 금지한다. 역할·권한·인증 사전 조회는 data query와 별도 집계한다.
- 원 DB offering_pk와 GUIDE 화면용 offering_id는 두 namespace다. source_offering_pk와 full29 기대행·원형 PK·year:rawPK/승인 lineage를 각각 검증하며 raw 모집군/전형을 GUIDE 표기에 덮어쓰지 않는다.
- TS의 UTC 시각은 Z와 +00:00을 같은 BigInt microseconds로 해석하고 원 catalog 시각 literal은 변경하지 않는다. HTTP는 기존 Z 및 최대6자리 소수초로 정규화한다. UTC 이외 offset·잘못된 날짜·7자리 소수초를 거절하며 issued 포함·expires 제외·최대24h의 정확 경계를 유지한다. legacy 이용권 owner UUID WHERE·현재 활성기간·session v1 세 필드는 그대로다.
- 안전한 오류 enum만 명시 증분한다. Python 재귀 응답 필터는 유지하고 Edge의 오류 code/status도 허용목록 밖 값은 비밀 없는503으로 필터한다.
- 외부 base에는 /functions/v1/함수명 prefix가 있으나 함수 내부 Request path는 /함수명 prefix다. 화면 중계의 encoded 모집행 ID는 원 ID로 1회 복원하고 기존 API suffix·query·DTO를 유지한다.
- 실제 provider 검수에서 SQLSTATE57014를 관측하면 five-second 조회 제한과 원형 source/typed 값·범위·RLS를 유지하며 안전한503으로 닫는다. 파일 수준 keyset 후보 검수와 실제 payload 미실행을 구분하고 성공한 native/값 대조 없이 runtime 최적화로 채택하지 않는다.
- 이전 metadata EXPLAIN(ANALYZE FALSE)의5초57014·계획 미반환 관측과 원본은 보존한다. 최신 사용자 요청의 단일 fresh v5는 같은 SQL/typed 범위/RLS/5초 제한으로 공급자140지표·12모집행과 HTTP 두 페이지100/40을 확인했다. 실제DB+DI 검수와 실JWT·클라우드·브라우저를 구분하고 원인 미확정인 이전 실패를 새 성공으로 지우지 않는다.
- 승인된 OID 메타데이터 최적화는 같은 qualified 관계명 집합을 unnest→to_regclass→pg_class OID JOIN으로 조회한다. 원11컬럼·namespace/app/nonowner·RLS/read-only·권한 함수·view 정의/옵션·기저3표 forced RLS 검수와5초 제한을 유지한다. payload JOIN/선택 명부/숫자 투영/회원/default/flags는 불변이다. v4 metadata57014는 보존하고 fresh v5의 실제 공급자·입결HTTP100/40·각 dataJOIN1 성공과 실제JWT/Edge 운영 미검수를 별도로 기록한다.
- 이전 v4 동결7파일 검수는 role metadata 통과 후 관계 metadata57014·관측execute6968ms·JOIN0/HTTP0/재시도0/DB쓰기0으로 실패한 이력이다. 새 v5는 사용자 요청의1회 original oracle READONLY 검수로 같은5초 제한·SQL·RLS를 유지해140/12와HTTP 대조를 통과했으며 쓰기/재시도0이다. 데이터팀 후속 v35 DiskFull53100 파일 영수증은 별도 관측이고57014의 원인으로 단정하지 않는다. 제한 확대·대체 쿼리·권한 우회·전국/엔진/운영 승인 승격은 하지 않는다.
- 입결 현재 조회·변경은 DATA_ACTIVE_ADMISSION_CURRENT_v1.json의 단일 정본과 jungsi_data_ingest.admission_results_current를 사용한다. v21_1/C140는 당시 승인된 동결 역사 검수에만 쓰고 현재 정본으로 재승격·전량 재적재하지 않는다. 현재 공급자의 미구현을 역사 검수 성공으로 대신하지 않는다.
- 같은 발표 관측의 원본ID들을 하나의 현재 관측ID의 출처 회원으로 연결하고 과거 원본ID로도 출처/정정 이력을 조회할 수 있어야 한다. 동일 원본 재입력을 방지하고 기대 이전해시·현재지문·원문근거·명령ID에 결속한 멱등 정정 뒤 실제 필드·모집행 연결·중복방지/출처 이력을 검수해 포인터를 마지막에 갱신한다.
- 학년도·전형·군·코호트·통계기준·점수성분·만점·반영식연도/과목 정의가 다른 값을 합치지 않는다. 명칭·PK·라벨 정정만으로 현재 관측ID를 새로 만들지 않으며 충돌과 원본/이전버전/실패를 보존한다.
- DB 원문 아카이브는 비공개 목적지의 새 사본·bytes/SHA·출처와 기존 승인해시 결속을 확인하고 currentview와 동결C 참조 범위의 값·타입·bytes 변경0을 검수한다. 아직 허용하지 않은 DB 제거/포인터치환/DDL/VACUUM은 완료로 표시하지 않는다. 일반VACUUM의 내부 재사용과 물리 파일 용량 반환을 구분하며 FULL의 배타잠금·추가공간/서비스영향을 별도 판단한다.
- VACUUM의 내부 재사용 공간과 물리 파일 감소를 구분한다. 일반 VACUUM 완료만으로 전체 DB 공간 반환을 주장하지 않으며, VACUUM FULL의 배타 잠금·추가 사본 공간·정확한 실행 승인은 별도 검토한다.
- Edge 의존 드라이버가 필요한 Node 전역은 별도 bootstrap을 의존 import 앞에서 평가한다. 엔트리 본문의 단순 Buffer 대입이 static import보다 먼저 실행된다고 가정하지 않는다. 기존 전역은 덮어쓰지 않으며 배포용 동일 번들에서 전역이 없는 초기 상태의 실패 재현·수정본 handler 등록을 검수한다. 기동 회귀는 실JWT·hosted SQL·BFF·브라우저 인수를 대신하지 않는다.

## 기존 API와 구현 경로

| 항목 | 값 |
| --- | --- |
| python_reference | src/jungsi_touch/infrastructure/official_history_display.py |
| edge_entry | supabase/functions/official-history-display/index.ts |
| edge_application | supabase/functions/_shared/official_history_display.ts |
| edge_infrastructure | supabase/functions/_shared/official_history_postgres.ts |
| default_factories_changed | False |
| entitlement_authority | jungsi_backend.entitlements |
| existing_API_count | 22 |
| new_logical_API_or_DTO | False |
| browser_DB_credentials | False |
| relay_header | X-Jungsi-Relay-Token |
| python_factory | create_official_history_display_app |
| edge_factory | createOfficialHistoryDisplayHandler |
| edge_provider | createOfficialHistoryInfrastructure |
| logical_operation_count | 5 |
| edge_node_compatibility_bootstrap | supabase/functions/_shared/node_compat_bootstrap.ts |

논리 작업: history.search, offerings.search, offering.read, recruitment.read, session.read. 기존22 API 중 명시한 조회 부분만 연결하며 전체 엔진 포팅 완료를 뜻하지 않는다.

## 담당 작업

| 작업 | 담당 | 범위 |
| --- | --- | --- |
| DBD-01 | 데이터팀 | exact 원행/curated 기준의 원형·타입·PK·학년도 대조와 필요 최소 app SELECT 권한/성능 검수 |
| DBD-02 | 서비스 개발팀 | 명시 표시 공급자와 Python reference·Edge ports/adapter·인증/오류/DTO 호환 구현 |
| DBD-03 | 시스템기획팀·서비스 개발팀 | 목적별 제한 검수 승인·불변 private descriptor·설정·동일 후보 API 수치 대조 |
| DBD-04 | 외부 화면팀 | API transport prefix와 서버 relay 연결·실제 로그인·1페이지 원지표/보류/오류 브라우저 검수 |
| DBD-05 | 외부 화면 개발팀의 Supabase 관리자 | 사용자가 위임한 비공개 Edge 설정 등록을 담당한다. 비공개 전달/정확 후보 확인 후 등록 증거를 제출한다. 제한 함수의 실제 배포는 별도 승인·검수와 구분하며 계정·DB 권한 변경이나 전체 운영 승인으로 확대하지 않음 |
| DBD-06 | 데이터팀·서비스 개발팀 | 단일 현재 정본 공급자/목적승인·canonical/source ID 및 지문·출처회원·bounded JOIN·app 권한/RLS의 별도 준비와 구현; 현재 미구현 |
| DBD-07 | 데이터팀; 시스템기획팀·화면팀 독립 검수 | 용량 최신 메타데이터 실측·원형 아카이브 명부·현재/C 의존 영향·정확한 제거 승인·전후 bytes/SHA/변경0 및 유지보수 실행 영수증; 실제 정리 미인수 |

## 화면팀 연결

- 브라우저·화면 코드·일반 프런트 환경은 기존 API의 공개 응답만 읽는다. app DATABASE_URL/DB CA/Storage secret/descriptor/원자료/전체 DB를 수령하지 않는다. 지정된 Supabase 관리자가 비공개 app-only 기본7 설정을 등록하는 역할은 별도 인계 범위다. migration-owner 접속값·키는 외부 화면 환경에 전달하지 않는다.
- 제한 검수 API가 실제 배포·응답 검수된 후 관측한 base URL과 transport prefix·공개 Auth 설정을 받는다. 예측한 주소로 live 전환하지 않는다.
- relay는 비공개 서버 설정으로 전달하며 사용자 JWT는 BFF에서 재검증해 보낸다. 실제 학생 성적·토큰은 채팅/공유 문서/Git에 넣지 않는다.
- 다른 PC는 같은 candidate에서 실제 원지표·타입·출처·검색 조건·401/403/503·no-store와 전달물 비노출을 검수한다.
- DB 행 수가 늘어도 행별 조회를 추가하지 않는다. 같은 요청의 data JOIN 1회 증거와 실제 RLS 영수증을 별도 확인한다.
- 현재 계정의 Edge Secret 관리권한은 없으며 지정된 화면팀 Supabase Owner/Administrator가 비공개 설정을 등록한다. 함수 generic 코드 배포 권한은 별도로 관측하여 실제 배포와 URL 확인을 완료했다. Secret 권한·DB SELECT·사이트 관리자·함수 배포를 서로 대체하지 않으며 권한 우회는 하지 않는다.
- 이 제한 검수 함수의 base는 5개 GET operation 전용이다. 기존 22API의 전역 base를 일괄 live 전환하지 않는다. 1페이지의 history.search/recruitment.read/session.read와 유료 offerings.search/offering.read에만 명시 operation routing으로 연결한다.
- 미포팅 17API와 2~4페이지의 성적·환산·지원판정 엔진은 이 함수로 준비 완료되지 않았으며 pending/503을 유지한다. 관리자·개발자 계정의 관리 권한을 유료 이용권으로 자동 승격하지 않는다.
- 화면 팀은 기존 페이지 및 operation별 routing과 transport prefix를 대조하여 연결한다. CSS·화면 구현·BFF 및 브라우저 실수신 검수는 외부 화면 팀 담당이며 서비스 소스·합성 검산으로 대신 완료 처리하지 않는다.
- 기본7과 PIN3는 지정 관리자의 영수증·실제 Dashboard·보관 승인값 digest가 모두 일치해 등록 완료다. 제한 함수와 비공개 Storage를 사용한 실제 사용자 JWT·hosted DB·BFF·브라우저·보안3gate 검수는 별도로 미실행이며 등록 완료를 운영 인수로 표시하지 않는다.
- 등록된 PIN3와 실제 관측 URL로 동결 C140 역사 검수 GET5개만 명시 연결한다. 기존22API 전역 live 전환·기본 회원/이용권 변경·2~4페이지 엔진 승격은 하지 않는다. 실제 로그인·두 cursor 페이지·지표 값/타입/근거·no-store/중계/브라우저 비노출을 별도 검수한다.
- C 수신 기계 검수 원영수증 원형과 선택명부·manifest·승인4tuple·경로2필드의 typed/bytes 일치를 독립 검토하고 Root가 정확한 선택명부 SHA의 동결 local_verification 경로 변경을 수용했다. 화면팀은 기존README3~5단계를 실행·회신한다. 수용 기록은 CLI/캐시/세션/API/브라우저의 실제 실행 완료나 새 엔진/운영 권한을 뜻하지 않는다.
- 배포된 함수의 JWTlegacy ON은 그대로 둔다. 실제 ES256 사용자 JWT를 BFF에서 보내 플랫폼/함수 상태를 구분하고, 401을 API 키의 사용자 Bearer 대체나 인증 설정 자동 해제로 해결하지 않는다. 24h 목적 승인 만료 후에는 새 승인판을 요구하며 임의 연장하지 않는다.
- 현재 입결 조회는 비공개 DATA_ACTIVE_ADMISSION_CURRENT_v1.json과 고정 jungsi_data_ingest.admission_results_current를 따른다. 현재 배포 source의 v21_1/C140 공급자는 동결 역사 검수용이며 현재 정본 조회로 안내하지 않는다. 현재 정본 공급자는 canonical/source 관측ID·현재 지문·출처 회원·metadata·목적승인·실제 app SELECT/RLS를 결속하는 별도 구현이 필요하다.
- DB 용량 정리는 데이터팀 소유 schema의 별도 작업이다. csv/support gzip 원형·overlays 검수 근거를 비공개 Storage/Drive 보존하고 사본 bytes/SHA/원래 해시 참조를 대조한 뒤 정확히 허용된 DB 제거만 별도 판단한다. NOT NULL/길이CHECK와 current/C 역사 의존을 먼저 확인하며 포인터만 치환하거나 전량 재적재하지 않는다.
- DB 용량 메타데이터만 실제 앱1연결 READONLY/TLS로 확인했다. 대상3표의 RLS/FORCE·SELECT전용과 gzip NOT NULL·현재/역사 overlay 의존을 확인했지만 사본 원격 bytes/SHA·삭제·VACUUM을 실행한 것은 아니다. 주석 분리 preflight 실패는 접속0으로 보존하고 정정본1회 성공과 구분한다. 최신 실측 bytes와 후보 명부·실행 단계는 별도 비공개 인계 영수증에 보관한다.
- 1차 실제 JWT5GET은 전부500 WORKER_ERROR였고 Root도 Buffer ReferenceError 운영 로그를 확인했다. 호환 초기화 수정·배포 뒤 fresh JWT로 기존5GET, 140지표2페이지, 무료의 유료2GET403, recruitment pending/null, no-store·토큰 비노출을 다시 검수한다. 401은 플랫폼 gate 증거이며 500→503만으로 표시 서비스 성공을 기록하지 않는다. 승인 만료 후 같은 판을 연장하지 않으며 새 승인판이 필요하다.

## 증거와 미실행 범위

| 항목 | 상태 |
| --- | --- |
| source_db_read_only | PASS_FRESH_V5_SCOPED_APP_ROLE_TLS_READONLY_PROVIDER_140_METRICS_12_ANNUAL_OFFERINGS; ORIGINAL_V4_57014_PRESERVED; NOT_FULL_SERVICE_ACCEPTANCE |
| python_reference_HTTP | PASS_17_NATIVE_SCOPED_SYNTHETIC_AND_FRESH_V5_ACTUAL_DB_HTTP_WITH_SYNTHETIC_DI_AUTH_HISTORY_100_40_ME_3_FIELDS_NEGATIVE_PAYLOAD_ZERO; REAL_JWT_CLOUD_BFF_BROWSER_NOT_RUN |
| Deno_check_test | PASS_NATIVE_DENO2_9_7_CACHED_ONLY_CHECK6_SOURCE_AND_TEST_FILES_AND_TEST36_33_EXISTING_PLUS3_BOOTSTRAP; NO_ACTUAL_AUTH_PRIVATE_SETTINGS_DB_OR_NETWORK; OFFLINE_FULL_BUNDLE_BOOT_RECEIPT_SEPARATE; FIXED_HOSTED_RETEST_NOT_RUN |
| restricted_cloud_API | FIXED_COMMITTED_BUNDLE_REDEPLOYED_AFTER_NATIVE_AND_OFFLINE_BOOT_REGRESSION; OLD_FRONTEND_REAL_JWT_5_GET_500_WORKER_ERROR_PRESERVED; FIXED_REAL_JWT_HOSTED_DB_BFF_BROWSER_SECURITY_RETEST_PENDING |
| actual_user_JWT | FRONTEND_REAL_STANDARD_USER_JWT_5_GET_ATTEMPTED_500_WORKER_ERROR; ROOT_DASHBOARD_BUFFER_REFERENCE_ERROR_LOG_MATCH; FIXED_REVISION_RETEST_NOT_RUN |
| frontend_BFF_browser | NOT_RUN |
| operational_security_three_gates | NOT_RUN |
| effective_RLS | PASS_FRESH_V5_ACTUAL_PROVIDER_NONOWNER_NONSUPER_NONBYPASS_APP_ROLE_READONLY_ROW_SECURITY_ON_19_PINNED_INVOKER_VIEWS_3_ENABLE_AND_FORCE_RLS_TABLES; HOSTED_EDGE_RLS_NOT_RUN |
| bulk_JOIN_query_count | PASS_FRESH_V5_ACTUAL_PROVIDER_DATA_JOIN_1_HISTORY_HTTP_PAGE_100_JOIN_1_PAGE_40_JOIN_1; TOTAL_DATA_JOINS_3; AUTH_ROLE_ENTITLEMENT_METADATA_COUNTED_SEPARATELY_NO_N_PLUS_1 |
| cloud_deployment | PASS_EXISTING_FUNCTION_REDEPLOYMENT_VISIBLE_UPDATED_EDITOR_READBACK_LF_BYTES_SHA_EXACT_COMMITTED_SOURCE_BUNDLE_JWT_ON_UNCHANGED; SOURCE_DEPLOYMENT_ONLY_NOT_REAL_USER_HOSTED_SQL_OR_BROWSER_ACCEPTANCE |
| keyset_optimization | PRIVATE_PROPOSAL_SCOPE_EQUIVALENCE_ONLY; REAL_METADATA_TIMEOUT_BEFORE_NEW_PAYLOAD; NOT_ADOPTED_IN_RUNTIME |
| cloud_configuration_registration | PASS_BASE7_AND_PIN3_DESIGNATED_OWNER_REGISTRATION_ROOT_EXPECTED_RECEIPT_DASHBOARD_DIGEST_MATCH; NO_SECRET_VALUES_OR_ROLE_RLS_CHANGES; NOT_RUNTIME_ACCEPTANCE |
| base_configuration_registration | PASS_OWNER_RECEIPT_V2_AND_ROOT_DASHBOARD_7_NAMES_TIMESTAMPS_WITH_PRIVATE_EXPECTED_VALUE_DIGESTS_ALL_7_EXACT_MATCH; NO_SECRET_VALUE_EXPOSURE; NOT_RUNTIME_ACCEPTANCE |
| final_descriptor_configuration | APPROVED_PRIVATE_STORAGE_FILE_READBACK_AND_PIN3_REGISTRATION_DIGEST_MATCH; ISOLATED_FROZEN_HISTORY_REVIEW_ONLY; NOT_CURRENT_CANONICAL_OR_PRODUCTION |
| metadata_plan_diagnostic | FAILED_SQLSTATE_57014_FIVE_SECOND_BOUND; EXPLAIN_ANALYZE_FALSE_RETURNED_NO_PLAN; METADATA_SELECT_AND_PAYLOAD_NOT_RUN_IN_THIS_DIAGNOSTIC; CAUSE_UNCONFIRMED_NO_RETRY |
| further_real_database_execution | FRESH_USER_REQUEST_AUTHORIZED_SINGLE_V5_ORIGINAL_ORACLE_PROBE_PASS; ATTEMPTS_1_RETRIES_0_WRITES_0; NO_UNBOUNDED_RETRY_TIMEOUT_EXTENSION_FALLBACK_KEYSET_OR_AUTHORITY_CHANGE |
| before_metadata_optimization_actual_provider | FAILED_SCOPED_ORIGINAL_PROVIDER_OR_METADATA_DIAGNOSTIC_SQLSTATE_57014_WITH_FIVE_SECOND_BOUND; ORIGINAL_FAILURES_PRESERVED |
| metadata_lookup_optimization | QUALIFIED_NAMES_UNNEST_TO_REGCLASS_PG_CLASS_OID_JOIN_SAME_PREDICATE; FRESH_V5_ACTUAL_PROVIDER_GUARDS_AND_PAYLOAD_HTTP_PASS_WITH_5_SECOND_BOUND; PRIOR_V4_TIMEOUT_PRESERVED_CAUSE_UNCONFIRMED |
| current_actual_provider_v4 | HISTORICAL_FAIL_AT_OID_RELATION_METADATA_QUERYCANCELED_SQLSTATE_57014_UNDER_CONFIGURED_5_SECOND_BOUND; OBSERVED_EXECUTE_6968MS_ROLE_METADATA_PASS_2172MS_PAYLOAD_JOIN_0_HTTP_0_ATTEMPTS_1_RETRIES_0_WRITES_0_PRESERVED |
| current_actual_provider_v4_receipt_sha256 | d20051ca7c47ff679702cfa0d86c1ee8697b130972c4fd17aa1813f96771ec9d |
| current_actual_provider_v4_source_binding | HISTORICAL_SEVEN_FROZEN_RUNTIME_SCHEMA_TEST_SHA256_EXACT_MATCH_SYNTHETIC_DI_AUTH_ONLY; ORIGINAL_FAILURE_PRESERVED_NOT_REPLACED_BY_NEW_SUCCESS |
| base_configuration_receipt_sha256 | 0c3e2b0f3de09dd2566da17a9619e1d6c0476110cdd0d2bc4de33f5eae01f657 |
| current_actual_provider_v5 | PASS_SINGLE_FRESH_ORIGINAL_ORACLE_READONLY_140_METRICS_12_ANNUAL_OFFERINGS_PROVIDER_2532MS; HISTORY_HTTP_100_40_TYPED_CLOSED_DTO_NO_STORE_ME_3_FIELDS_STANDARD; RELAY_MISSING_403_BEARER_MISSING_401_OTHER_SUBJECT_403_DATA_ZERO; RETRIES_0_WRITES_0 |
| current_actual_provider_v5_receipt_sha256 | c69d5311bbb4752c5aea9f3629bdc85eedc09151ffc6588477bbc2c20163b028 |
| current_actual_provider_v5_source_binding | BASELINE_3C47B07_SEVEN_ORIGINAL_SOURCE_HASHES_FROZEN_BEFORE_UTC_TS_DELTA; UNCHANGED_PYTHON_PROVIDER_SQL_RLS_AND_HTTP_WITH_SYNTHETIC_DI_AUTH_PASS; NEW_TS_FILE_VALIDATION_AND_SYNTHETIC_TESTS_ARE_SEPARATE_NO_REAL_JWT_CLOUD_SQL_BROWSER |
| UTC_timestamp_compatibility | Z_AND_POSITIVE_ZERO_OFFSET_PLUS_00_00_EQUAL_BIGINT_MICROSECONDS; ORIGINAL_CATALOG_AS_OF_LITERAL_UNCHANGED; HTTP_NORMALIZED_Z_WITH_UP_TO_6_FRACTION_DIGITS; NONZERO_OR_NEGATIVE_ZERO_OFFSET_INVALID_DATE_7_DIGIT_FRACTION_AND_EXCESS_TTL_REJECT; EXACT_ISSUE_EXPIRY_BOUNDARIES_PRESERVED |
| UTC_TS_file_validation_receipt_sha256 | f7e561ead524fd55b855122f0a06c6959f221921c04043d9b8021473ed86e0e1 |
| UTC_TS_approved_descriptor_validation | PASS_FILE_ONLY_APPROVED_DESCRIPTOR_AND_EXPIRED_REVOKED_WRONG_ENV_PROPOSED_TTL_ABOVE_24H_NEGATIVE_CASES; COMPONENT_BYTES_UNCHANGED_DB_0_NETWORK_0; ACTUAL_CLOUD_SQL_AND_JWT_NOT_RUN |
| data_team_intake_observation | PRIOR_DISKFULL_FAILURES_AND_SCREEN_915MB_REPORT_PRESERVED_AS_HISTORICAL; NEW_DASHBOARD_ORGANIZATION_PRO_BADGE_OBSERVED_NOT_CURRENT_CAPACITY_QUOTA_PROOF |
| generic_bundle | PASS_COMMITTED_SOURCE_ONLY_FIXED_POSTGRES_DEPENDENCY_WITH_NODE_BOOTSTRAP_111398_BYTES_NATIVE36_AND_OFFLINE_FULL_BUNDLE_REGRESSION; OLD_HOSTED_REVISION_BUFFER_FAILURE_PRESERVED; FIXED_REAL_JWT_HOSTED_RETEST_NOT_RUN |
| generic_bundle_sha256 | b7edc2961bed3fcc333b09d174efeb45fdf794fa470b294178fe51373f1c0f92 |
| generic_bundle_bytes | 111398 |
| local_C_receiver_acceptance | PASS_ROOT_ACK_EXACT_PATH_ONLY_RECEIVER_SELECTION_ORIGINAL_MECHANICAL_RECEIPT_AND_APPROVAL4TUPLE_TYPED_BYTES; FRONTEND_LOCAL_README3_TO5_21_OF21_140_TYPED_RENDER_PASS_REPORT_RECEIVED; ROOT_RERUN_0_CLOUD_BROWSER_ACCEPTANCE_SEPARATE |
| observed_function_url | https://ksrpnhvyfdwysrexdhrd.supabase.co/functions/v1/official-history-display |
| private_descriptor_storage | PASS_PRIVATE_STORAGE_ONLY_SINGLE_ATTEMPT_RETRIES_0_EXISTING_OVERWRITES_0_PRIVATE_BUCKET_FALSE_AUTHENTICATED_READBACK_EXACT_ANONYMOUS_DENIED; NO_DB_RLS_OR_SOURCE_FLAG_CHANGES |
| cloud_anonymous_endpoint | PASS_SINGLE_NATIVE_HTTPS_GET_ME_401_AND_DATA_ZERO_PLATFORM_GATE_ONLY; HANDLER_NO_STORE_REAL_JWT_SQL_NOT_PROVEN |
| cloud_JWT_gateway | DASHBOARD_VERIFY_JWT_WITH_LEGACY_SECRET_ON_UNCHANGED_PUBLIC_JWKS_ES256_1_KEY_OBSERVED; DOCUMENTATION_AND_DASHBOARD_WORDING_DIFFER_SO_REAL_JWT_INTAKE_REQUIRED_BEFORE_COMPATIBILITY_CLAIM; NO_AUTO_DISABLE_OR_API_KEY_BEARER_SUBSTITUTION |
| integration_commit | e086a6b571caa8ac758b7280c6d3538fb682c47a |
| service_source_commit | 30cf5686330cdacc3d60d7a98f512ed107288c1f |
| integration_CI | PASS_EXACT_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_PROJECT_CONSISTENCY_247; NORMAL_PRECOMMIT_853_PREPUSH_853_SNAPSHOT_GIT_BLOB_BINDING; EXACT_DEVELOP_MERGE_e086a6b571caa8ac758b7280c6d3538fb682c47a_PROJECT_CONSISTENCY_249; CURRENT_PLANNING_STATUS_COMMIT_CHECKS_SEPARATE |
| source_integration | PR21_MERGE_COMMIT_DEVELOP_ONLY_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_INTEGRATION_e086a6b571caa8ac758b7280c6d3538fb682c47a; BRANCHES_PRESERVED_MAIN_UNCHANGED; SOURCE_INTEGRATION_NOT_OPERATIONAL_ACCEPTANCE |
| current_canonical_provider | NOT_IMPLEMENTED; CURRENT_VIEW_ADMISSION_RESULTS_CURRENT_AND_CANONICAL_SOURCE_ID_BINDING_PERMISSION_RLS_REVIEW_REQUIRE_NEW_PURPOSE_ADAPTER; HISTORICAL_C_SOURCE_NOT_PROMOTED |
| DB_capacity_preservation | PREPARATION_ONLY_AFTER_FRESH_BOUNDED_METADATA_PASS; CURRENT_AND_HISTORICAL_C_DIRECT_OVERLAY_DEPENDENCIES_AND_BYTEA_NOT_NULL_REQUIRE_ADAPTER_SCHEMA_REVIEW; NO_DB_SOURCE_REMOVAL_ARCHIVE_WRITE_OR_VACUUM_ACCEPTANCE |
| previous_planning_status_CI | PASS_EXACT_DEVELOP_A59F370_PROJECT_CONSISTENCY_241_NORMAL_PRECOMMIT_853_PREPUSH_853; CURRENT_NEW_STATUS_COMMIT_CHECKS_SEPARATE |
| DB_capacity_metadata_probe | PASS_SINGLE_ACTUAL_APP_CONNECTION_TLS_VERIFY_FULL_READONLY_ROW_SECURITY_NO_SUPER_BYPASS; TARGET3_SELECT_ONLY_FORCE_RLS; SETUP5_METADATA5_COMMIT1; FIVE_SECOND_STATEMENT_TWO_SECOND_LOCK_BOUNDS; NO_PAYLOAD_DB_STORAGE_WRITE_VACUUM_OR_PRIVILEGE_CHANGE; NOT_ARCHIVE_ACCEPTANCE |
| historical_cloud_runtime_before_bootstrap | {'restricted_cloud_API': 'GENERIC_FUNCTION_DEPLOYED_PRIVATE_DESCRIPTOR_READBACK_AND_BASE7_PLUS_PIN3_INDEPENDENT_DIGEST_MATCH; REAL_JWT_HOSTED_DB_BFF_BROWSER_SECURITY_PENDING', 'actual_user_JWT': 'NOT_RUN', 'cloud_deployment': 'PASS_DASHBOARD_GENERIC_FUNCTION_DEPLOYMENT_AND_OBSERVED_URL_ONLY; EDITOR_CRLF_113451_BYTES_NORMALIZED_TO_COMMITTED_LF_110796_BYTES_EXACT; NOT_HOSTED_DB_OR_REAL_JWT_ACCEPTANCE', 'generic_bundle': 'PASS_CACHED_OFFICIAL_ESBUILD_0_25_5_SOURCE_ONLY_ESM_THREE_SERVICE_SOURCES_FIXED_POSTGRES_3_4_5_IMPORT_EXPORT_AND_NODE_BUILTIN_ALIAS; PRIOR_DENO_BUNDLE_OS_ERROR_2_FAILURES_PRESERVED_NO_CONFIRMED_CAUSE; HOSTED_RUNTIME_NOT_RUN', 'generic_bundle_sha256': 'b3068379af4a4625113e99be4f5ef10a76f1852a8ffe7e9e68011e66c4728c74', 'generic_bundle_bytes': 110796} |
| worker_runtime_failure | ROOT_DASHBOARD_EVENT_LOOP_REFERENCE_ERROR_BUFFER_NOT_DEFINED_AFTER_BOOT_20_TO_26MS; FRONTEND_5_GET_ALL_500_REPORT; IMPORT_EVALUATION_BEFORE_HANDLER_REGISTRATION; EXACT_SOURCE_MAP_EQUIVALENCE_NOT_CLAIMED |
| worker_runtime_bootstrap | PASS_NATIVE_DENO2_9_7_CHECK_AND_36_TESTS_33_EXISTING_PLUS3; UNDEFINED_ONLY_NO_EXISTING_GLOBAL_OVERWRITE; FLAT_BUNDLE_BOOTSTRAP_PRECEDES_FIRST_POSTGRES_BUFFER_INITIALIZATION |
| worker_fixed_bundle | PASS_OFFLINE_ACTUAL_ORIGINAL_DEPLOYED_BUNDLE_BUFFER_REFERENCE_ERROR_HANDLER0_AND_NEW_FULL_BUNDLE_ALL4_GLOBALS_MISSING_HANDLER1_BUFFER_PROCESS_ENV_TIMER_SCHEDULE_CANCEL; EMPTY_SYNTHETIC_SETTINGS503_SECURITY_POLICY_UNAVAILABLE_NO_STORE_FETCH0_DB0; NOT_HOSTED_AUTH_DB_ACCEPTANCE |
| worker_fix_source_integration | PASS_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_NORMAL_PRECOMMIT_AND_PREPUSH_853_EACH_EXACT_SOURCE_CI; PR21_MERGE_COMMIT_e086a6b571caa8ac758b7280c6d3538fb682c47a_EXACT_MERGE_CI_SUCCESS; BRANCHES_PRESERVED_MAIN_UNCHANGED |
| worker_fix_cloud_deployment | PASS_EXISTING_FUNCTION_REDEPLOYMENT_VISIBLE_UPDATED_EDITOR_READBACK_LF_BYTES_SHA_EXACT_COMMITTED_SOURCE_BUNDLE_JWT_ON_UNCHANGED; SOURCE_DEPLOYMENT_ONLY_NOT_REAL_USER_HOSTED_SQL_OR_BROWSER_ACCEPTANCE |
| worker_fixed_real_JWT_retest | NOT_RUN_FRONTEND_OWNER_RETRY_WITH_FRESH_USER_JWT_EXISTING_RELAY_5_GET_140_TYPED_METRICS_NO_STORE_STANDARD_PAID_GET_403_RECRUITMENT_PENDING_BEFORE_VALID_APPROVAL_EXPIRY |
| frontend_local_C_report | RECEIVED_AND_READ_FRONTEND_RECEIVER_LOCAL_README_STEPS_3_TO_5_21_OF_21_API_CASES_AND_140_TYPED_FIELDS_RENDER_REPORTED_PASS; ROOT_RECEIPT_REVIEW_NOT_ROOT_RERUN_OR_CLOUD_ACCEPTANCE |
| frontend_local_C_report_sha256 | 2cc4da7e063fad95dbf5fe9a8af486d4ed7c0cf3ce6a3ee841c6d5afd02b9372 |
| historical_local_C_receiver_acceptance_before_frontend_report | PASS_ROOT_ACK_EXACT_PATH_ONLY_RECEIVER_SELECTION_AND_ORIGINAL_MECHANICAL_RECEIPT_MANIFEST_APPROVAL4TUPLE_TYPED_BYTES_BINDING; FROZEN_LOCAL_VERIFICATION_ONLY; RECEIVER_CLI_CACHE_SESSION_API_BROWSER_NOT_RUN |
| worker_bootstrap_verification_receipt_sha256 | 6f598ab7cfad3f5758a9f546dbffd590124fc280c4dd129df26c4fe357ca5085 |
| generic_bundle_role | COMMITTED_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_SIX_FILE_GIT_BLOB_BINDING_NATIVE36_AND_OFFLINE_FULL_BUNDLE_REGRESSION; EXISTING_FUNCTION_REDEPLOYED_EDITOR_READBACK_EXACT; REAL_JWT_HOSTED_DB_BFF_BROWSER_RETEST_NOT_RUN |
| generic_bundle_parent_commit | e8c6847cdff98ce3f4fd428251daf877f86a2b0d |
| generic_bundle_source_pins | [{'path': 'supabase/functions/official-history-display/index.ts', 'bytes': 1383, 'sha256': '94843a1e45d903cd8d5086e2e2e6745c6870b3c34eea19de01a42365ac652da2'}, {'path': 'supabase/functions/_shared/official_history_display.ts', 'bytes': 25760, 'sha256': '91def2f8a5755f9ea53e1164b689a27f769957a8d6c1fa110611d6c1addb413f'}, {'path': 'supabase/functions/_shared/official_history_postgres.ts', 'bytes': 13791, 'sha256': '60a8ad0f855168614e16da04ee8f962c84bd623de9cb9336140a5dd95d66c4f4'}, {'path': 'supabase/functions/_shared/node_compat_bootstrap.ts', 'bytes': 985, 'sha256': '18736bcf332f8cc4a9b708e05383326a5f3992c9a260c8bcb6b7fab9a861a13f'}] |
| worker_boot_probe_permissions | NO_ENV_NET_RUN_WRITE_GRANTED; DYNAMIC_FILE_IMPORT_READ_GRANTED_ONLY_TO_EACH_EXACT_GENERIC_JS; DENO_ENV_GET_STUB_RETURNS_EMPTY; FETCH_STUB_AND_ENV_SETTINGS_DO_NOT_CALL_REAL_SERVICES |
| worker_bootstrap_preparation_failures_preserved | PRIVATE_OUTPUT_V1_LF_PREPARATION_ASSERT_AND_V2_DYNAMIC_IMPORT_READ_PERMISSION_DENIAL_PRESERVED; V3_WITH_EXACT_FILE_READ_PASS; NO_SERVICE_SOURCE_CHANGE_REQUIRED_FOR_PROBE_FAILURES |
| historical_Deno_check_test_before_bootstrap | PASS_NATIVE_Deno_2.9.7_SHARED_APPLICATION_AND_TEST_CHECK_33_SCOPED_SYNTHETIC_TESTS_EXISTING_28_PLUS_5_UTC_COMPATIBILITY; NO_DB_AUTH_ENV_NETWORK |
| historical_worker_fix_pending_before_redeploy | {'generic_bundle': 'PASS_UNCOMMITTED_BOOTSTRAP_REVIEW_CANDIDATE_SOURCE_FROZEN_NATIVE36_AND_OFFLINE_FULL_BUNDLE_BOOT; OLD_HOSTED_REVISION_FAILED_BUFFER; FIXED_REAL_JWT_HOSTED_RETEST_NOT_RUN', 'generic_bundle_role': 'UNCOMMITTED_REVIEW_CANDIDATE_NOT_DEPLOYED; FINAL_COMMITTED_BUILD_READBACK_BINDING_REQUIRED', 'service_source_commit': '472052546dc8672167c7576bde7f758c6964e186', 'integration_commit': '9ed5102a656859ca0ef5136cb3c4bd8009d0cb8f', 'integration_CI': 'PASS_EXACT_DEVELOP_MERGE_COMMIT_PROJECT_CONSISTENCY_238; SOURCE_HEAD_4720525_PRECOMMIT_853_PREPUSH_853_DENO_33_AND_CI_237_SUCCESS; CURRENT_PLANNING_STATUS_COMMIT_CHECKS_SEPARATE', 'source_integration': 'PR20_MERGE_COMMIT_DEVELOP_ONLY_BRANCHES_PRESERVED_MAIN_UNCHANGED; CODE_ACCEPTANCE_NOT_OPERATIONAL_ACCEPTANCE', 'worker_fix_source_integration': 'PENDING_NORMAL_COMMIT_PUSH_HOOKS_EXACT_SHA_CI_AND_DEVELOP_PR; NO_MAIN_MERGE_OR_OPERATIONAL_ACCEPTANCE', 'worker_fix_cloud_deployment': 'NOT_RUN_PENDING_COMMITTED_SOURCE_BUILD_READBACK_SHA_AND_EXISTING_FUNCTION_REDEPLOYMENT; OLD_GENERIC_DEPLOYMENT_ONLY_EVIDENCE_PRESERVED'} |
| worker_committed_bundle_verification_receipt_sha256 | 63d319c6c692f6ce4568e4dbc4c58bf63787f84dccc42a39e92a9d13b7994e01 |

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

<!-- jungsi:generated spec_sha256=2324a42d7b24112e1631d168ce623698713491ccdf246d0a3eaafd18225c24c6 -->
