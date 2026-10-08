# Supabase 입결 DB와 화면 API 연결

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.18이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

이미 적재한 비공개 Supabase 입결을 별도 목적 범위의 공식자료 표시용 공급자로 읽어 기존 화면 API에 명시 연결한다.

계약 2026.10.09.v2 · 코드 implemented_scoped_synthetic_verified_integration_pending · production_ready=false. 담당 feature/application-pre-data-platform.

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
- TS의 소수초 시간은 BigInt microseconds로 비교하고 UTC 최대6자리로 반환한다. legacy 이용권 owner UUID WHERE 및 현재 활성기간 조건·session v1 세 필드는 유지한다.
- 안전한 오류 enum만 명시 증분한다. Python 재귀 응답 필터는 유지하고 Edge의 오류 code/status도 허용목록 밖 값은 비밀 없는503으로 필터한다.
- 외부 base에는 /functions/v1/함수명 prefix가 있으나 함수 내부 Request path는 /함수명 prefix다. 화면 중계의 encoded 모집행 ID는 원 ID로 1회 복원하고 기존 API suffix·query·DTO를 유지한다.
- 실제 provider 검수에서 SQLSTATE57014를 관측하면 five-second 조회 제한과 원형 source/typed 값·범위·RLS를 유지하며 안전한503으로 닫는다. 파일 수준 keyset 후보 검수와 실제 payload 미실행을 구분하고 성공한 native/값 대조 없이 runtime 최적화로 채택하지 않는다.
- metadata의 EXPLAIN(ANALYZE FALSE) 진단도5초 timeout으로 계획을 반환하지 못한 관측은 새 metadata SELECT나 payload 성공 증거가 아니다. 원인 미확정이며 추가 실DB 실행은 중지했다. 기존 성공 source 검수·현재 코드/합성·현재 실제 실패와 환경 준비/등록/배포 인수를 항목별로 분리한다.
- 승인된 OID 메타데이터 최적화는 같은 qualified 관계명 집합을 unnest→to_regclass→pg_class OID JOIN으로 조회한다. 원11컬럼·namespace/app/nonowner·RLS/read-only·4권한 함수·view 정의/옵션·기저3표 forced RLS 검수와5초 제한을 유지한다. payload JOIN/선택 명부/숫자 투영/회원/default/flags는 불변이며 현재 동결 runtime의 실제 검수는 OID 관계 메타데이터 조회57014로 중단되어 입결 payload JOIN과 HTTP 인수는 미실행이다. 단독 OID source 검수 성공을 runtime 성공으로 대체하지 않는다.
- 현재 실제 OID provider 검수는 동결7파일 SHA에 결속한1회 후보로 수행했고 role metadata는 통과했으나 관계 metadata가5초 제한의 QueryCanceled/SQLSTATE57014로 실패했다. 관측 execute6968ms·입결 JOIN0·HTTP0·재시도0·DB쓰기0이며 특정 원인은 미확정이다. 원 실패/단독 source 성공을 보존하고 제한 확대·대체 쿼리·권한 우회·승인 승격은 하지 않는다.

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

논리 작업: history.search, offerings.search, offering.read, recruitment.read, session.read. 기존22 API 중 명시한 조회 부분만 연결하며 전체 엔진 포팅 완료를 뜻하지 않는다.

## 담당 작업

| 작업 | 담당 | 범위 |
| --- | --- | --- |
| DBD-01 | 데이터팀 | exact 원행/curated 기준의 원형·타입·PK·학년도 대조와 필요 최소 app SELECT 권한/성능 검수 |
| DBD-02 | 서비스 개발팀 | 명시 표시 공급자와 Python reference·Edge ports/adapter·인증/오류/DTO 호환 구현 |
| DBD-03 | 시스템기획팀·서비스 개발팀 | 목적별 제한 검수 승인·불변 private descriptor·설정·동일 후보 API 수치 대조 |
| DBD-04 | 외부 화면팀 | API transport prefix와 서버 relay 연결·실제 로그인·1페이지 원지표/보류/오류 브라우저 검수 |
| DBD-05 | 외부 화면 개발팀의 Supabase 관리자 | 사용자가 위임한 비공개 Edge 설정 등록을 담당한다. 비공개 전달/정확 후보 확인 후 등록 증거를 제출한다. 제한 함수의 실제 배포는 별도 승인·검수와 구분하며 계정·DB 권한 변경이나 전체 운영 승인으로 확대하지 않음 |

## 화면팀 연결

- 브라우저·화면 코드·일반 프런트 환경은 기존 API의 공개 응답만 읽는다. app DATABASE_URL/DB CA/Storage secret/descriptor/원자료/전체 DB를 수령하지 않는다. 지정된 Supabase 관리자가 비공개 app-only 기본7 설정을 등록하는 역할은 별도 인계 범위다. migration-owner 접속값·키는 외부 화면 환경에 전달하지 않는다.
- 제한 검수 API가 실제 배포·응답 검수된 후 관측한 base URL과 transport prefix·공개 Auth 설정을 받는다. 예측한 주소로 live 전환하지 않는다.
- relay는 비공개 서버 설정으로 전달하며 사용자 JWT는 BFF에서 재검증해 보낸다. 실제 학생 성적·토큰은 채팅/공유 문서/Git에 넣지 않는다.
- 다른 PC는 같은 candidate에서 실제 원지표·타입·출처·검색 조건·401/403/503·no-store와 전달물 비노출을 검수한다.
- DB 행 수가 늘어도 행별 조회를 추가하지 않는다. 같은 요청의 data JOIN 1회 증거와 실제 RLS 영수증을 별도 확인한다.
- 프로젝트의 Edge Function secret 관리 권한이 없는 현재 계정으로 클라우드 설정/배포를 우회하지 않는다. 권한 있는 프로젝트 담당자가 검토한 불변 descriptor와 app-only 비공개 설정을 받아 제한 검수 함수만 배포하고 실제 URL/응답을 제출해야 한다. 기존 사이트 관리자와 DB SELECT 권한은 Edge secret 관리 권한을 대신하지 않는다.
- 이 제한 검수 함수의 base는 5개 GET operation 전용이다. 기존 22API의 전역 base를 일괄 live 전환하지 않는다. 1페이지의 history.search/recruitment.read/session.read와 유료 offerings.search/offering.read에만 명시 operation routing으로 연결한다.
- 미포팅 17API와 2~4페이지의 성적·환산·지원판정 엔진은 이 함수로 준비 완료되지 않았으며 pending/503을 유지한다. 관리자·개발자 계정의 관리 권한을 유료 이용권으로 자동 승격하지 않는다.
- 화면 팀은 기존 페이지 및 operation별 routing과 transport prefix를 대조하여 연결한다. CSS·화면 구현·BFF 및 브라우저 실수신 검수는 외부 화면 팀 담당이며 서비스 소스·합성 검산으로 대신 완료 처리하지 않는다.
- 사용자 결정에 따라 비공개 Edge 설정 등록은 화면 개발팀의 Supabase 관리자가 맡는다. 값은 채팅·공개 문서·Git으로 전달하지 않고 검토한 비공개 app-only 설정 묶음만 별도 전달한다. 현재 계정의 권한 확대·기본 DB 접속값 우회는 하지 않는다. 기본7 설정의 등록 완료는 등록 영수증으로 별도 판정하고 descriptor PIN3개의 HOLD는 유지한다. 함수 배포는 최종 승인·정확 코드/descriptor PIN·실제 URL과 API 응답 검수로, 실화면 인수는 실제 JWT/BFF/브라우저 증거로 각각 판정한다. 등록 증거만으로 배포·실화면 완료를 표시하지 않는다. 현재 기본7 설정의 실제 등록·함수 배포·실사용자 JWT/BFF·브라우저 인수는 NOT_RUN이다. 로컬 실제 OID provider 검수는 관계 메타데이터 조회57014로 중단됐으며 입결 payload·HTTP 응답은 아직 미실행이다. 단위 검수나 단독 source 성공을 전체5GET·유료 실제 요청 완료로 표시하지 않는다.
- 설정 인계는 2단계다. Supabase 관리자에게는 준비된 기본 서버 설정7개를 비공개로 전달하고, 아직 제안 상태인 descriptor PATH/SHA/BYTES3개는 최종 승인·PIN이 정해질 때까지 HOLD한다. 일반 화면 담당에게는 서버 relay-only와 공개 Auth 설정만 전달한다. 3개 미결·descriptor 미승인 상태의503은 기대 차단이며 가짜 대체값이나 자체 승인으로 통과시키지 않는다. 실제 환경 등록은NOT_RUN이고 등록만으로 DB 조회/배포/화면 인수가 완료되지 않는다.

## 증거와 미실행 범위

| 항목 | 상태 |
| --- | --- |
| source_db_read_only | PASS_PRIOR_SCOPED_QUALIFIED_SOURCE_140_AND_INDEPENDENT_BULK_JOIN_RLS; CURRENT_FROZEN_OID_PROVIDER_METADATA_FAILED_57014_PAYLOAD_HTTP_NOT_RUN |
| python_reference_HTTP | PASS_17_NATIVE_SCOPED_SYNTHETIC_WITH_QUALIFIED_OID_PARAMS_AND_MISSING_METADATA_PAYLOAD_ZERO; ACTUAL_DB_HTTP_JWT_BFF_BROWSER_NOT_RUN |
| Deno_check_test | PASS_NATIVE_Deno_2.9.7_ENTRY_AND_TEST_TYPECHECK_AND_28_SCOPED_SYNTHETIC_WITH_QUALIFIED_OID_METADATA_GUARDS; NO_DB_AUTH_ENV_NETWORK |
| restricted_cloud_API | NOT_RUN_BLOCKED_EDGE_FUNCTION_SECRET_MANAGEMENT_PERMISSION; AUTHORIZED_FRONTEND_SUPABASE_ADMIN_CONFIGURATION_INTAKE_PENDING |
| actual_user_JWT | NOT_RUN |
| frontend_BFF_browser | NOT_RUN |
| operational_security_three_gates | NOT_RUN |
| effective_RLS | PASS_PRIOR_QUALIFIED_OID_METADATA_SOURCE_PROBE_22_RELATIONS_11_TYPED_FIELDS_SAME_GUARDS; CURRENT_RUNTIME_METADATA_TIMEOUT_PREVENTED_COMPLETE_RLS_AND_HTTP_ACCEPTANCE |
| bulk_JOIN_query_count | PASS_PRIOR_SCOPED_SOURCE_1_AND_SYNTHETIC_CONCRETE_1; CURRENT_ACTUAL_OID_PROBE_PAYLOAD_JOIN_0_HTTP_0_METADATA_FAILURE; PAYLOAD_SQL_UNCHANGED |
| cloud_deployment | NOT_RUN; prepared source, bundle and private settings are not an applied or deployed service |
| keyset_optimization | PRIVATE_PROPOSAL_SCOPE_EQUIVALENCE_ONLY; REAL_METADATA_TIMEOUT_BEFORE_NEW_PAYLOAD; NOT_ADOPTED_IN_RUNTIME |
| cloud_configuration_registration | USER_ASSIGNED_TO_FRONTEND_TEAM_SUPABASE_ADMIN; CURRENT_ACCOUNT_NO_PERMISSION_CHANGE_OR_BYPASS; ACTUAL_REGISTRATION_NOT_RUN |
| base_configuration_registration | PREPARED_7_SERVER_SETTINGS_PRIVATE_ADMIN_INTAKE_ONLY; ACTUAL_REGISTRATION_NOT_RUN |
| final_descriptor_configuration | PATH_SHA_BYTES_3_HELD_PENDING_SEPARATE_APPROVAL_AND_FINAL_IMMUTABLE_PINS; MISSING_OR_UNAPPROVED_DESCRIPTOR_EXPECTED_503 |
| metadata_plan_diagnostic | FAILED_SQLSTATE_57014_FIVE_SECOND_BOUND; EXPLAIN_ANALYZE_FALSE_RETURNED_NO_PLAN; METADATA_SELECT_AND_PAYLOAD_NOT_RUN_IN_THIS_DIAGNOSTIC; CAUSE_UNCONFIRMED_NO_RETRY |
| further_real_database_execution | STOP_AFTER_ONE_FROZEN_OID_CANDIDATE_FAILURE; NO_RETRY_TIMEOUT_EXTENSION_FALLBACK_KEYSET_ADOPTION_OR_AUTHORITY_CHANGE |
| before_metadata_optimization_actual_provider | FAILED_SCOPED_ORIGINAL_PROVIDER_OR_METADATA_DIAGNOSTIC_SQLSTATE_57014_WITH_FIVE_SECOND_BOUND; ORIGINAL_FAILURES_PRESERVED |
| metadata_lookup_optimization | QUALIFIED_NAMES_UNNEST_TO_REGCLASS_PG_CLASS_OID_JOIN_SAME_PREDICATE; PRIOR_INDEPENDENT_SOURCE_PROBE_PASS_UNDER_5_SECONDS_AND_PYTHON_DENO_REGRESSION_PASS; CURRENT_ACTUAL_PROVIDER_METADATA_FAILED_57014_PAYLOAD_HTTP_NOT_RUN |
| current_actual_provider_v4 | FAIL_AT_OID_RELATION_METADATA_QUERYCANCELED_SQLSTATE_57014_UNDER_CONFIGURED_5_SECOND_BOUND; OBSERVED_EXECUTE_6968MS; ROLE_METADATA_PASS_2172MS; PAYLOAD_JOIN_0_HTTP_0_ATTEMPTS_1_RETRIES_0_WRITES_0 |
| current_actual_provider_v4_receipt_sha256 | d20051ca7c47ff679702cfa0d86c1ee8697b130972c4fd17aa1813f96771ec9d |
| current_actual_provider_v4_source_binding | SEVEN_FROZEN_RUNTIME_SCHEMA_TEST_SHA256_EXACT_MATCH; SYNTHETIC_DI_AUTH_ONLY; ACTUAL_JWT_CLOUD_BFF_BROWSER_AND_ALL_5_GET_ACCEPTANCE_NOT_RUN |

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

<!-- jungsi:generated spec_sha256=7227f221a7eb5060be74235f4e2e17217153bc97544b52b7b4f04057b7c22ed6 -->
