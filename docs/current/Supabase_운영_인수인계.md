# Supabase 운영 인수인계

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.8.2이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

SUP01은 separate_Jungsi_FastAPI_deployment, SUP02의 목표 단일 원본은 public.jeongsi_passes로 확정했다. 현재 코드는 여전히 jungsi_backend.entitlements를 조회하며 목표 어댑터 전환·실DB/실Auth·배포·보안 인수는 NOT_RUN이다. production_ready=false / NOT_READY를 유지한다.

revision 2026.10.06.v3; 2026-10-06T08:40:54.349322Z 읽기 snapshot; 문서 decisions_and_reply_contract_reviewed_pending_generation_and_commit_validation. SUP01 별도 정시 Python FastAPI 배포와 SUP02 public.jeongsi_passes 단일 이용권 원본의 사용자 확정을 채택하고 여섯 후속 회신 요청·로컬 요청 답변·인수 조건을 준비한다. 과거 HTTP 재점검과 05:32Z 관측은 보존한다. 현재 실행 어댑터/22API/DTO/회원/보안 계약은 변경하지 않으며 실제 DB·로그인·자료 승인·배포·화면 인수는 실행하지 않는다.

## 확정된 구성과 현재 실행 상태

| 계층 | 책임 |
| --- | --- |
| 프레젠테이션 | 기존 화면 서버/BFF가 실제 Supabase 세션·CSRF를 검증해 서버 전용 중계로 22API를 호출하고 브라우저에는 허용 DTO만 전달한다. 브라우저의 분석 원점 직접 호출은 허용하지 않는다. |
| 애플리케이션 | Python FastAPI 엔진과 22개 API가 서버의 권한·소유권·승인 정책과 저장소 포트를 처리한다. |
| 데이터/인프라 | Supabase Auth/PostgreSQL, 전용 서버 role, 승인된 비공개 자료 공급자를 연결한다. |

배포 방식은 separate_Jungsi_FastAPI_deployment로 확정했다. 실제 운영 배포 상태는 NOT_RUN이며 실행 환경과 운영 주소 인수는 별도 작업이다. Supabase 키는 Python 호스팅·사용자 JWT·DB 암호를 대신하지 않는다. 별도 FastAPI 채택은 배포/실권한/보안 인수 완료가 아니다. 기존 EduTouch me DTO와 정시 22API 차이를 어댑터/BFF 계약으로 해결하고 원점 우회 차단을 인수해야 한다.

유료 이용권 단일 기준의 확정 목표는 public.jeongsi_passes다. 현재 실행 어댑터는 jungsi_backend.entitlements를 조회하며, unchanged_target_transition_NOT_RUN 상태다. 기존 session v1과 그 실행 규칙을 보존하고, 원본 DDL을 확인한 별도 어댑터 변경·검증 후에만 목표 기준으로 전환한다.

| 목표 이용권 계약 | 상태 또는 근거 |
| --- | --- |
| table | public.jeongsi_passes |
| decision_status | confirmed_single_authority_target |
| adapter_status | NOT_RUN |
| user_identity_column | user_id |
| active_condition | revoked_at IS NULL AND starts_at <= server_UTC_now < ends_at |
| expiry_projection | {'proposal': '같은 서버 UTC 평가시각에서 활성 행이 1건 이상이면 유료로 판정하고 현재 활성 행의 MAX(ends_at)을 UTC Z 만료로 반환한다.', 'status': 'owner_reported_agreement_original_DDL_and_adapter_verification_pending', 'source_verification': '소유자 회신에서 user_id uuid와 활성 MAX(ends_at)에 동의했다는 보고다. 실제 원본 DDL/타입/nullability/권한 SQL·실DB·어댑터는 아직 검수하지 않았다.'} |
| admin_exception | {'site_rule': '기존 사이트의 관리자 열람 예외를 부정하거나 실제 paid로 가짜 승격하지 않는다.', 'status': 'backend_lookup_operation_scope_and_DTO_CR_pending', 'proposal': 'paid를 위장하지 않는 SSR/BFF 내부 권한 context와 별도 admin_read로 기본 session v1 3필드를 유지하는 안을 우선 제안한다. 독립 브라우저 capability 소비가 필요할 때 opt-in session v2는 별도 CR의 차선안이다. 두 안 모두 미채택이며 5열람 operation·shortlist 예외·owner/forecast scope를 별도 확정한다.', 'boundary': '다른 public 표 접근 제한과 관리자 조회를 양립하도록 확정한다. owner·확인 성적·학교/forecast scope·독립 승인을 우회하지 않고 현재 shortlist.update/report.export/statistics.read의 paid 규칙을 유지한다. shortlist.update 예외는 별도 결정/CR 대상이며 미채택이다. 임의 만료·epoch9999·헤더/함수/권한을 만들지 않는다.'} |
| migration_boundary | 옛 entitlements는 이력으로 보존하며 이중 원본·동기화 fallback·env만으로 자동 전환하지 않는다. |
| user_identity_type | uuid |
| user_identity_status | owner_reported_original_DDL_NOT_REVIEWED |
| user_identity_reference | auth.users 참조는 소유자 보고이며 실제 FK/nullable는 원본 DDL 확인 대기다. |

## 이전 통합 snapshot의 최소 조회와 실제 검수

2026-10-06T05:32Z 읽기 점검 결과다. 이번에 확인한 비공개 설정 파일과 해당 프로세스·루트 환경, 최소 HTTP 조회와 Git 상태에 한정한다. 모든 PC나 전역 환경에서 설정이 없다고 단정하지 않는다.

| 항목 | HTTP | 확인 범위 |
| --- | --- | --- |
| Auth settings | 200 | 최소설정조회 |
| JWKS | 200 | ES256공개키1 |
| JWT없는getUser | 401 | 실로그인아님 |
| secret REST metadata | 200 | SQL/회원권한인수아님 |
| private schema REST | 406 PGRST106 | REST노출설정거절 |

PGRST106은 요청한 schema가 REST API의 db-schemas 노출 설정에 없다는 뜻이다. DB schema가 없거나 SQL 권한이 실패했다는 증거가 아니며, 이 문서 작업에서 private schema 노출 설정을 바꾸지 않는다.

당시 확인한 설정 이름: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL. 해당 관측에서 확보하지 못한 설정: DATABASE_URL, JUNGSI_PROBE_ACCESS_TOKEN. 과거에 확인한 사이트 admin 메타데이터 표식은 현재의 실제 로그인, 프로젝트 Console 관리자 권한, 유료 이용권을 증명하지 않는다. 준비된 로컬공개설정은 외부 배포origin/실JWT/브라우저·운영인수가 아니다.

해당 시점의 지정 범위에서 승인 자료 0건과 로컬 후보 1건의 engine_approved=false를 확인했다. 새 자료나 전체 저장소의 현재 승인 현황으로 확대하지 않는다. 미승인 자료·합성 모형의 production_allowed=false를 표시 목적으로 true로 바꾸지 않는 정책과 구분한다. 후보에서 production_allowed 필드를 읽었다는 주장이 아니다.

해당 관측의 외부 화면 PR6 head는 ff2a8e412c7adc16eb61af34a6219a2c5c2d072b, base는 81672e7214e34ff929639492319896420bd62196였다. 당시 PR 상태는 open/unmerged이며 실제 브라우저 검수는 NOT_RUN이다. 그 HEAD의 CI 상태는 NOT_REVIEWED_IN_THIS_HANDOFF로 기록했다. 최신 통합 SHA와 회신 인수는 화면팀 최종 회신 요청에서 별도로 확인한다.

## 최신 HTTP 접근 재점검과 .env 경계

증거 ID SUP-ACCESS-20261006-083858Z-084054Z; 2026-10-06T08:38:58.873951Z ~ 2026-10-06T08:40:54.349322Z. 직전 사용자 요청에서 실행한 읽기 전용 HTTP·환경 존재 여부 점검의 도구 출력. 이번 변경은 관측 기록이며 HTTP 요청을 재실행하지 않는다. 동일 프로젝트의 GET 요청, 공개 인증키·Auth 설정·REST 메타데이터와 public 테이블 0건 요청에 한정한다. 사용자 인증·회원 데이터·비공개 입시자료를 조회하지 않았다.

### 설정 파일·키 없는 조회

| 시각 UTC | 요청 | HTTP | 확인 범위 |
| --- | --- | --- | --- |
| 08:38:58Z | 공개 JWKS | 200 | 설정 파일·키 없이 접근; ES256 공개키 1개 |
| 08:38:58Z | Auth settings | 401 | 설정 파일·키 없이 요청; 인증 설정 접근 거절 |
| 08:38:58Z | Auth user | 401 | 설정 파일·키·사용자 JWT 없이 요청; 사용자 로그인 미검증 |

### 기존 비공개 보관 키를 사용한 조회

파일과 키를 사용하지 않는 공개 조회를 먼저 수행했다. 키가 필요한 단계에서는 이전에 전달받은 설정을 보관한 기존 비공개 파일을 메모리로 읽었다. 새 .env 생성은 0건이다. 무키 조회와 기존 보관 키 조회를 분리한다.

| 시각 UTC | 요청 | HTTP | 확인 범위 |
| --- | --- | --- | --- |
| 08:38:58Z | 공개키 Auth settings | 200 | 기존 보관 공개키로 인증 설정 접근 가능 |
| 08:38:58Z | 공개키 Auth user | 401 | 사용자 JWT 없음; 실제 로그인 미검증 |
| 08:38:58Z | 공개키 REST metadata | 401 | 이 요청의 REST 접근 거절; 일반 사용자 권한 판정 아님 |
| 08:38:58Z | 서버키 REST metadata | 200 | 서버키로 REST 메타데이터 접근; SQL/RLS/회원권한 인수 아님 |
| 08:38:58Z | 비공개 schema REST | 406 / PGRST106 | 현재 REST 비노출; SQL schema 존재·권한은 미검증 |
| 08:40:54Z | public.profiles GET select=*&limit=0 | 200 | 반환 [] 확인; 실제 회원 레코드 취득 0건 |

limit=0의 응답 []는 요청이 0건 반환되었다는 증거다. 테이블의 전체 인원이 0명이라는 뜻이 아니며 실제 레코드 내용·일반 사용자 RLS·유료 이용권·현재 PostgreSQL 어댑터를 검수하지 않았다.

### 설정 보관과 실행 환경

기존 비공개 파일 확인 설정 이름: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL.

이번 프로세스·해당 PC User/Machine 환경변수 미주입 이름: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL, DATABASE_URL, JUNGSI_PROBE_ACCESS_TOKEN.

확인한 기존 비공개 파일에는 위 4개 참조가 있었다. 이번 점검 프로세스·해당 PC의 User/Machine 환경변수에는 위 6개 이름이 없었다. DATABASE_URL과 JUNGSI_PROBE_ACCESS_TOKEN은 확인한 파일과 환경 모두에서 확보하지 못했다. 다른 PC·배포 서버·프로젝트 전체의 부재를 뜻하지 않는다.

.env 파일은 설정 보관·주입 방식 중 하나이며 그 파일 자체는 필수가 아니다. ServerSettings.from_environment는 os.environ만 읽고 .env를 자동으로 읽지 않는다. 파일 보관과 실행 프로세스 환경변수 주입은 별도 작업이다. 배포 서버 환경변수로 같은 필수 설정을 전달할 수 있으며, 설정 없이 보호 API/DB를 사용할 수 있다는 뜻은 아니다.

### 미검증 범위와 운영 상태

| 항목 | 상태 | 이유 |
| --- | --- | --- |
| PostgreSQL SQL 연결·전용 role·RLS | NOT_RUN | 현재 PostgreSQL 어댑터용 DATABASE_URL 미확보 |
| 실제 사용자 로그인 | NOT_RUN | 검수 사용자 Bearer JWT 미확보 |
| 이용권·소유권·staff 범위 | NOT_RUN | 실제 DB·로그인 검수와 단일 이용권 기준 필요 |
| Supabase Console 로그인·관리 권한 | NOT_VERIFIED_TIMEOUT | 브라우저 상태 조회 시간 초과; 계정 권한의 허용·거절을 관측하지 못함 |
| 마이그레이션·운영 쓰기 | NOT_RUN | 이 읽기 점검에서 실행하지 않음 |
| 운영 준비 | NOT_READY | production_ready=false 유지; API 200으로 승격하지 않음 |

실제 레코드 취득 0건; 운영 쓰기 0건; 새 .env 생성 0건. production_ready=false를 유지한다.

### 다음 담당자의 작업

| 담당 | 작업과 경계 |
| --- | --- |
| 서버·DB 담당 | 기존 설정으로 비공개 최소 읽기 점검 가능. 현재 PostgreSQL 어댑터는 DATABASE_URL·전용 role·TLS를 실행 환경에 주입하고 실제 SQL 검수를 별도로 수행한다. REST 0건 성공을 그 검수로 대체하지 않는다. |
| 인증·이용권 담당 | 검수용 실제 일반·유료 사용자 JWT와 단일 이용권 기준을 준비한다. 사이트 admin 표식이나 서버 API 키를 사용자 로그인·유료 권한으로 취급하지 않는다. |
| 외부 화면 담당 | 화면에는 운영 API origin과 공개 Auth 설정만 전달한다. 서버키·DATABASE_URL·비공개 데이터 접근값은 화면·브라우저에 전달하지 않는다. 서버 중계 신원은 BFF의 서버 전용 설정과 분석 서버 검증으로 별도 구현한다. |
| 운영·통합 담당 | SUP-01~11 및 보안 SEC-01~08의 기존 의존관계·NOT_RUN/HOLD를 유지한다. private schema REST 노출 변경·기존 어댑터 교체·DB 쓰기·배포를 이번 API 접근 결과만으로 수행하지 않는다. |

## 현재 코드와 설정 경계

| 항목 | 현재 구현과 미실행 경계 |
| --- | --- |
| settings | .env 파일 자체는 필수가 아니다. ServerSettings.from_environment는 os.environ만 읽으며 .env 자동 로더가 없다. 기존 파일을 보관하는 것과 서버 프로세스에 필요한 환경변수를 주입하는 것은 별도 작업이다. |
| authentication | SupabaseSessionProvider는 getUser로 확인한 사용자와 같은 JWT의 sub/exp를 대조한다. JWKS를 조회한 사실이 직접 서명 검증 구현의 완료를 뜻하지 않는다. |
| entitlement | SessionService는 서버 이용권으로 유료 권한을 판정한다. profile/admin 표식이나 클라이언트 paid 값으로 자동 승격하지 않는다. 결제 취소·회수·동기화 adapter는 별도 구현이 필요하다. |
| postgres | prepare_threshold=None, TLS require, 트랜잭션의 SET LOCAL UTC와 advisory transaction lock을 유지한다. 실제 DB 연결 검수는 NOT_RUN이다. |
| Drive | DriveClient는 주입된 static token으로 Bearer 요청을 만든다. 자동 OAuth refresh는 구현되어 있지 않아 갱신 운영 방법 또는 별도 adapter가 필요하다. |
| health | 운영 /health/ready의 200은 인증·자료·전체 운영의 인수를 뜻하지 않는다. local memory/test auth/DPAPI factory는 production_ready=false이며 공개 배포하지 않는다. |

현재 프로젝트의 URL·publishable 설정을 확인했으므로 새 프로젝트 생성이 필수라고 볼 근거는 없다. .env 예시도 Git에서 제외한다. 파일 보관과 서버 프로세스의 환경변수 주입은 별도 작업이다.

## 공개·서버·검수 설정

| 설정 이름 | 사용 범위 | 용도와 현재 상태 | runtime 분류 |
| --- | --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | 프런트 공개 | local2판 참조/운영담당확인 | frontend_reference_only |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 프런트 공개 | compat 이름에 publishable 참조; secret/JWT 아님 | frontend_reference_only |
| JUNGSI_API_MODE / JUNGSI_API_URL | 외부 화면 | 모드·서버 전용 Caller/운영 연결은 외부 회신; 값 비공개 | mode_contract_pending_no_automatic_live |
| SUPABASE_URL | 서버 | Auth HTTPS URL; 검토 설정범위 존재 | ServerSettings_required |
| SUPABASE_PUBLISHABLE_KEY | 서버 | getUser apikey; 사용자Bearer와별개/검토범위존재 | ServerSettings_required |
| DATABASE_URL | 서버 전용 비밀 | Connect 전용role/TLS; 검토file/process범위없음 | ServerSettings_required |
| GOOGLE_DRIVE_ACCESS_TOKEN | 서버 전용 비밀 | 현재 static token·갱신운영/adapter 별도 | ServerSettings_required |
| GOOGLE_DRIVE_INPUT_FOLDER | 서버 전용 | 승인 input folder/실공급NOT_RUN | ServerSettings_required |
| GOOGLE_DRIVE_OUTPUT_FOLDER | 서버 전용 | 입력과 다른 output/실공급NOT_RUN | ServerSettings_required |
| JUNGSI_DRIVE_REGISTRY | 서버 전용 | 비공개승인명부/approved0/HOLD | ServerSettings_required |
| JUNGSI_ALLOWED_ORIGINS | 서버 | CORS/origin은 인증이 아니며 서버 중계·사용자/서버 신원이 필요 | ServerSettings_optional |
| JUNGSI_PROBE_ACCESS_TOKEN | 검수 전용 비밀 | 실사용자JWT/검토file/process범위없음 | probe_optional_not_ServerSettings_required |
| SUPABASE_SECRET_KEY | 서버 참조/비밀 | 최소REST metadata조회참조/검토범위존재 | reference_not_required_or_auto_used |
| SUPABASE_JWKS_URL | 설정 참조 | 공개키조회참조/검토범위존재·직접JWT검증완료아님 | reference_not_required_or_auto_used |

SUPABASE_SECRET_KEY와 SUPABASE_JWKS_URL은 현재 ServerSettings의 필수 설정이 아니며 자동으로 사용되지 않는다. 프런트 NEXT_PUBLIC_SUPABASE_ANON_KEY는 publishable 참조 값을 보관하는 기존 호환 이름이다. secret key나 사용자 JWT를 뜻하지 않는다. 운영 환경의 변수 이름과 설정 채택은 외부 화면 담당자가 확인해야 한다.

## 담당별 인계 작업

| ID/우선순위 | 담당/계층 | 입력 | 선행 | 현재상태 |
| --- | --- | --- | --- | --- |
| SUP-01 P0 | 시스템기획·서버 담당 / 기획/애플리케이션·인프라 | 확정 separate_Jungsi_FastAPI_deployment; 22 API·DTO·엔진 계약; 배포 제공자·Python runtime·BFF 운영 연결 요구(값은 비공개) | 없음 | DECISION_CONFIRMED_DEPLOYMENT_NOT_RUN |
| SUP-02 P0 | 에듀터치 결제·DB 담당·시스템기획 / 기획/애플리케이션·데이터 | 확정 public.jeongsi_passes 단일 원본; 원본 DDL·사용자 식별 컬럼/타입·취소/환불/회수 규칙·권한 SQL 원문(미확보); 현재 포트/조회·session v1 규칙·검사와 같은 어댑터 전환 PR; 기존 사이트 관리자 예외의 서버 조회/권한/DTO 영향 CR | 없음 | DECISION_CONFIRMED_ADAPTER_NOT_RUN |
| SUP-03 P0 | Supabase·서버 설정 담당 / 인프라/데이터 | Dashboard Connect 정보; 전용 server role·TLS·배포환경; 확정 별도 FastAPI 환경의 IPv4/IPv6·연결 유지 요구; master 최소 SELECT와 자체 업무 schema 쓰기/마이그레이션 role을 구분한 권한 계획; RF-03 IN-DB-01A~05B의 정확 원본/권한 입력10종과 role/owner/RLS 효과; 실제 값은 private 인계 | SUP-01 | BLOCKED_MISSING_DATABASE_URL |
| SUP-04 P0 | DB 담당 / 데이터/인프라 | 실DB 기존 상태·승인 backup; 001/002 정의·전용role 권한계획; public.jeongsi_passes 원본 DDL/사용자키/인덱스/RLS·권한 SQL(미확보); runtime/migration role·owner와 관리자 최소 조회 포트 CR; RF-03 IN-DB-01A~05B의 정확 원본/권한 입력10종과 role/owner/RLS 효과; 실제 값은 private 인계 | SUP-02, SUP-03 | NOT_RUN_001_UNCONFIRMED_002_NOT_APPLIED |
| SUP-05 P0 | 인증 담당·서버 개발자 / 애플리케이션/인프라 | 실제 검수 사용자 Bearer JWT·Supabase Auth 공개 설정 | SUP-01 | NOT_RUN_MISSING_TEST_USER_JWT |
| SUP-06 P0 | 권한·서비스 DB 담당 / 애플리케이션/데이터 | 선택한 단일 authority; entitlement·owner·forecast_authorities; SUP-05 실Auth 검수·일반/유료 검수 사용자·별도 editor/approver subject; RF-02 관리자 권한/operation/session CR; RF-03 DDL·사용자키·SQL 권한과 취소/회수 | SUP-02, SUP-04, SUP-05 | NOT_RUN |
| SUP-07 P0 | 서버 담당 / 인프라/애플리케이션 | 선택 실행환경·locked Python runtime; 운영 settings·HTTPS/CORS origin; RF-01 BFF 사용자/서버 전용 신원과 원점 차단; RF-04 synthetic/local_verification/production 모드·전환 승인 | SUP-01, SUP-03, SUP-04, SUP-05 | NOT_RUN_HOSTING_AND_SECURITY_ACCEPTANCE_PENDING |
| SUP-08 P0 | 데이터팀·서버 인프라 담당 / 데이터/인프라 | Drive OAuth/folders/승인발행명부; approved exam/joint curve/catalog/analysis/rule/year bridge/학교누백/forecast 근거; 데이터팀 approved/HOLD 발행 명부·독립 신뢰 version/SHA·승인/수령 영수증; 실제 9월 검수 2~3건·독립 기대값과 보류 목록(실값 비공개); 실제 Drive/local 출처·수신 Windows PC DPAPI 재보호 | SUP-01, SUP-03 | BLOCKED_APPROVED0_DRIVE_NOT_RUN |
| SUP-09 P0 | 외부 화면 개발자 / 프레젠테이션 | 운영 API origin·Supabase 공개설정; 실JWT Caller·22 DTO·승인 기대값; RF-01 BFF 공개 경로·22 operation 매핑·신원/쿠키/CSRF; RF-02 관리자 예외 화면/버튼·session CR; RF-04 모드·RF-05 정확 PR/SHA/인수; SEC-02/03/07/08 및 세 security gate | SUP-06, SUP-07, SUP-08 | NOT_RUN_BROWSER_PR6_MERGED_SOURCE_OBSERVED |
| SUP-10 P1 | 서버·DB 운영 담당 / 인프라/데이터 | 실API/DB/승인자료; backup/restore·장애·통계 계획; 로컬 메모리/운영 PostgreSQL 차이와 재시작 소실 고지; backup/restore·성적/리포트/관심학교/관리 초안/발표 영속성 목록 | SUP-06, SUP-07, SUP-08 | NOT_RUN |
| SUP-11 P0 | 시스템기획·두 개발 담당·데이터팀 / 통합 인수/3티어 | SUP-01~10 개별 증거; 정확 develop SHA/API/자료버전·CI·외부인수 | SUP-01, SUP-02, SUP-03, SUP-04, SUP-05, SUP-06, SUP-07, SUP-08, SUP-09, SUP-10 | BLOCKED_NOT_READY |

### SUP-01 P0 — 시스템기획·서버 담당

업무:

- 별도 정시 Python FastAPI 배포는 확정이다. 기존 namespace adapter 선택 대기는 해소하며 배포 실행/운영 인수는 별도다.
- 배포 제공자·runtime·담당과 브라우저→BFF→분석 서버 경계를 정한다. CORS/origin은 인증이 아니며 기존 EduTouch me DTO가 22API를 대체하지 않는다.

완료조건:

- 확정안·담당·runtime·BFF 연결 설계·22API 매핑을 인수한다. 실제 배포/보안/연결 증거는 SUP-07/09/11에서 별도 충족한다.

### SUP-02 P0 — 에듀터치 결제·DB 담당·시스템기획

업무:

- 목표는 public.jeongsi_passes로 확정한다. 현재 entitlements와 session v1 3필드는 이번 문서에서 보존하고 서비스 PR에서 함께 전이한다.
- DDL/사용자키와 revoked_at·starts_at·ends_at의 실제 정의, 지급·취소·환불·회수 경로를 회신받는다. MAX(활성 ends_at)은 제안이며 구현/원문 검수 완료가 아니다.
- 취소/회수 후 저장된 결과 재조회도 현재 권한으로 재인가한다. 옛 entitlements는 보존하고 이중 authority·동기화 fallback을 만들지 않는다.
- 관리자 열람 예외의 조회·별도 capability·허용 operation·화면/session DTO 영향은 CR로 확정한다. paid=true나 임의 만료로 승격하지 않는다.
- master reader·factory의 session entitlement 주입·readiness/probe·정본 session 규칙/route catalog·checker1284와 회귀를 같은 구현 PR에서 전이한다. 이번 명세 반영에서는 현재 old authority 검사 pin을 유지하고 old OR new로 완화하지 않는다.

완료조건:

- 원본 DDL/사용자키·UTC 활성/만료·지급/취소/회수·최소 SELECT를 확인하고 어댑터/정본 session 규칙/검사 PR을 인수한다. 관리자 CR·기본 v1 호환도 별도 확정한다.

### SUP-03 P0 — Supabase·서버 설정 담당

업무:

- 기존 비공개 보관 URL/publishable/서버키로 HTTP API와 public 테이블 limit=0 접근을 확인했다. .env 파일 자체는 필수가 아니며 새 프로젝트 생성이 필수라는 전제를 두지 않는다. 현재 SQL 어댑터 검수는 별도다.
- 배포환경에 맞게 direct/session pooler/transaction을 선택하고 Connect의 exact host/사용자/연결 문자열을 복사한다. 지역으로 host를 합성하지 않는다.
- DATABASE_URL·전용role·TLS를 process 환경에 주입한다. ignored .env 보관만으로 자동 load하지 않고 secret API key는 DB 비밀번호가 아니다.
- 현재 psycopg prepare_threshold=None·transaction SET LOCAL UTC·advisory transaction lock을 보존한다.
- 영구 FastAPI의 direct 5432(IPv6 가능 환경), session pooler 5432(IPv4 후보), transaction 6543 제약을 실제 환경에 맞춰 선택한다. 포트 설명은 후보이며 실DB 호환 완료가 아니다.
- master SELECT·자체 업무 schema 쓰기·owner/RLS 마이그레이션 권한을 구분한다. 비밀 DB URL/JWT·전달경로를 공개문서/브라우저에 복사하지 않는다.

완료조건:

- 배포환경 내 비공개 설정 주입·실제 DB/TLS 읽기 검수 증거가 있다.
- Connect 방식·TLS·전용 role·비공개 process 주입·master/자체 schema 권한 분리의 실제 SQL 검수 증거를 갖춘다. REST 200/.env 보관으로 완료하지 않는다.

### SUP-04 P0 — DB 담당

업무:

- 기존 상태 점검·승인 backup 후 001/002 추가 적용 계획을 별도로 승인받는다. 이번 문서는 운영쓰기 실행 승인이 아니다.
- 전용role grants/RLS·anon/authenticated 직접 접근 차단·owner·UTC·11개 timestamptz/date 컬럼·schema_versions를 실DB에서 검수한다.
- 002 CAS·멱등·불변 release·원자적 게시와 동시성을 실제 검수한다. 001 실제적용 UNCONFIRMED/002 NOT_APPLIED를 유지한다.
- reset/drop/delete 금지. REST PGRST106은 DB schema 부재/SQL 권한 실패 증거가 아니다.
- 권한 SQL 원문을 확보해 master SELECT·다른 public 표 제한·자체 업무쓰기·owner/RLS/함수 범위를 대조한다. SELECT만으로 ALTER/RLS 작성 권한이 생긴다고 추정하지 않는다.
- profiles 관리자 판정이 필요하면 다른 public 표 접근 제한과 양립하는 최소 server-only 조회를 별도 확정한다. SQL/DDL을 추정해 실행하지 않는다.

완료조건:

- 적용·권한·소유권·UTC왕복·11컬럼·schema_versions·002 트랜잭션 인수가 끝났다.
- 원본 DDL/SQL·전용 role·RLS·master/자체 schema 거절·관리자 조회와 실제 001/002 증거를 분리해 인수한다.

### SUP-05 P0 — 인증 담당·서버 개발자

업무:

- JWT를 보안 경로로 받아 실제 Auth getUser 응답과 sub/exp 일치, 만료·비정상·불일치 JWT 거절을 검수한다. 유료·staff 권한과 /api/v1/me session DTO 판정은 SUP-04·05 이후 SUP-06에서 인수한다.
- 현재 SupabaseSessionProvider는 getUser 검증 후 sub/exp를 대조한다. JWKS 조회 성공을 직접 signature 검증 구현 완료로 기록하지 않는다.
- 사이트 admin 표식은 현재 실로그인/console admin/paid 권한을 보장하지 않는다. JWT/비밀번호/개인식별정보를 공개문서·로그에 넣지 않는다.
- 키를 넣은 Auth settings200·JWT 없는 getUser401은 실제 사용자 로그인 인수가 아니다. Console 상태 조회 시간 초과는 관리 권한 없음·있음의 증거가 아니다.

완료조건:

- 실제 Auth getUser/sub/exp 확인과 만료·비정상·불일치 Bearer JWT 거절 증거가 있다.

### SUP-06 P0 — 권한·서비스 DB 담당

업무:

- 선택 authority를 구현하고 결제 취소/회수/동기화 adapter 미구현은 별도 개발로 명시한다.
- 일반 PAGE3/4·유료 API403, 다른 학생 report404, UTC 접근기간을 실제 사용자로 검수한다.
- staff와 paid는 독립이다. forecast_authorities 학교 scope·editor/approver 독립·자기 승인403·scope밖404를 유지한다.
- SUP-04 실DB와 SUP-05 실Auth 이후 단일 entitlement authority를 사용한 /api/v1/me의 일반·유료·만료·취소 session DTO와 서버 권한 판정을 함께 검수한다.
- 목표 어댑터·factory·같은 서버 UTC 시각·포트/정본 session 규칙/검사를 같은 PR에 묶는다. 활성 MAX(ends_at)·session v2 opt-in admin_read는 미채택 제안으로 CR을 먼저 확정한다.
- 관리자 열람과 paid·forecast staff를 구분하고 명시 operation만 적용한다. owner·확인성적·학교/forecast scope·독립승인·mutation은 우회하지 않는다. 클라이언트 role/paid는 권위가 아니다.
- 취소/회수/만료 뒤 기존 report·캐시·선택 결과 재응답에도 현재 권한을 검수하고 장애를 일반 회원/허용으로 자동 변환하지 않는다.
- current Postgres probe/ready의 old table/컬럼 가정과 reader 상태를 실제 DDL에 맞춰 같은 PR에서 전이하며 업무 schema 001/002 준비와 이용권 reader 준비를 구분한다.

완료조건:

- 실DB/JWT 및 단일 entitlement authority에 결속된 /api/v1/me 일반·유료·만료·취소 DTO, 이용권·소유권·UTC·staff 학교 범위·독립 승인 거절 매트릭스를 인수했다.
- 실제 사용자키·UTC/취소/회수/만료·재조회 재인가·관리자 최소 capability/operation·v1 호환 또는 승인 v2 소비·scope/독립 승인의 실제 거절 증거를 인수한다.

### SUP-07 P0 — 서버 담당

업무:

- configured_app을 locked Python runtime에 배포하고 HTTPS/CORS·제한 health·log/redaction을 검수한다.
- /health/ready200은 Auth/data/전체 운영 PASS가 아니다. localhost/test allowlist/memory/DPAPI factory를 public 배포하지 않는다.
- static환경에 Python 실행준비가 없으면 별도 서버 runtime이 필요하다.
- 사용자 Bearer와 별도 서버 신원을 모두 검증한다. HMAC/헤더/서명·nonce/회수 방식은 미채택 제안이며 개발팀이 충돌 없이 확정한다.
- 운영/preview BFF·원점 거절·공유 예산·실권한·승인 자료 gate 전에 live 전환하지 않는다. local allowlist token/메모리/DPAPI factory를 운영에서 선택하거나 공개 배포하지 않는다.
- 모드·health 실패/HOLD를 명시하고 설정/Auth/DB/Drive 부족을 ready/paid/수치로 바꾸지 않는다. 안전한503/부분보류를 유지한다.

완료조건:

- 확정 origin·운영factory·22 API·HTTPS/CORS·비공개 진단 증거가 있다.
- 운영 factory·실JWT/서버 신원·원점 우회·preview 공유 예산/안전한 오류·모드 거절 및 세 security gate의 실제 scope 증거를 인수한다.

### SUP-08 P0 — 데이터팀·서버 인프라 담당

업무:

- 현재 DriveClient는 주입된 static token으로 Bearer 요청하며 자동 OAuth refresh는 없다. 토큰 갱신 운영방법/필요 adapter는 별도 개발이다.
- 자료/모형 승인과 버전 결속 후 실제 read 및 입력을 덮지 않는 비중복 별도 output write를 검수한다.
- approved0가 병목이다. engine_approved=false/production_allowed=false를 표시용 true로 승격하지 않는다.
- 원문 수치 QA는 모델 승인이 아니며 marginal 분포만으로 joint curve 완성을 판정하지 않는다. 승인 곡선 없음은 HOLD/null/pending과 총점 보존이다.
- 데이터팀이 kind/key/version/exam/pack/context/hash/승인증거를 공급한다. 화면팀은 가상 곡선/approved를 만들지 않는다. 자료 정리와 엔진/모형 승인을 구분한다.
- 독립 신뢰 명부 SHA·receipt에 결속한다. local에 가짜 Drive ID/version을 만들지 않는다. DPAPI는 수신 사용자/PC에서 재보호하고 RAM 복호화·평문 신규 저장 금지를 유지한다.
- 요청 시험팩 엔트리가 없거나 MissingDataProvider가 None을 반환하면 overall.analyze는 exam_not_available/HTTP503이다. 엔트리가 등록됐지만 미채택이면 provider의 artifact_not_approved/503을 overall이 exam_data_unavailable/HTTP503으로 변환한다. 승인·유효 시험팩 계산 성공 후 모형 없음/미승인에서만 total_standard_score/subjects를 보존하고 total_model_missing/total_model_not_approved pending/null을 구분한다. approved_count=0만으로 두503 중 하나를 결정하지 않는다.

완료조건:

- 승인 명부/곡선/규칙/모형·버전·실Drive read/갱신/별도 write·독립 수치 증거가 있다.
- 명부/버전/SHA·수령/출처·독립 기대값·실자료를 인수하거나 수치 미승인 HOLD를 명시한다. HOLD 연결 성공은 수치 정확도/운영 승인 완료가 아니다.
- 요청 시험팩 엔트리가 없거나 MissingDataProvider가 None을 반환하면 overall.analyze는 exam_not_available/HTTP503이다. 엔트리가 등록됐지만 미채택이면 provider의 artifact_not_approved/503을 overall이 exam_data_unavailable/HTTP503으로 변환한다. 승인·유효 시험팩 계산 성공 후 모형 없음/미승인에서만 total_standard_score/subjects를 보존하고 total_model_missing/total_model_not_approved pending/null을 구분한다. approved_count=0만으로 두503 중 하나를 결정하지 않는다. 정적 코드 판독과 실제HTTP 인수를 구분한다.

### SUP-09 P0 — 외부 화면 개발자

업무:

- 기존 Supabase 공개 설정은 확인돼 있으므로 같은 설정을 다시 요청할 필요는 없다. 운영 API/공개설정으로 실제 JWT Caller/22 DTO/4페이지·브라우저를 검수한다. 서버키·DATABASE_URL을 화면에 전달하지 않는다. 이번 문서팀은 화면 코드를 수정하지 않는다.
- PAGE1 발표입결/개인성적 불필요, PAGE2 무료 전체누백까지, PAGE3 유료검색·환산·가능성·유불리, PAGE4 유료2:1 학교·학과/와일드카드를 유지한다.
- 409 학과기준 조회는 해당 부분만 보류하며 성공점수 보존. release/policy/input 모두 nonempty string일 때 exact equality·context17 존재/값/타입/null 동일성을 검수한다.
- PR6는 develop2624에 merged·정확 head CI2 success를 읽기 확인했지만 이번 브라우저 독립 인수는 NOT_RUN/pending이다. source/CI·로컬 공개설정을 운영/브라우저 인수로 확대하지 않는다.
- 출력 검수는 기존 report.export 계약의 응답을 소비하는 범위에 한정한다. 리포트·인쇄 기능의 확장은 이번 운영 준비 범위에서 제외하며 새 인쇄 기능을 완료조건으로 추가하지 않는다.
- 화면팀은 BFF 실제 session·HttpOnly/Secure/SameSite 쿠키/CSRF를 검증하고 사용자/서버 신원을 분석 서버로 중계한다. 경로·22 mapping·헤더/서명은 회신/CR로 확정한다. CORS/origin은 인증이 아니다.
- SEC-02 HTML/JS/source map·RSC/hydration/JSON·다운로드/오류/로그/캐시를 검수하여 원자료·모형·직원감사·서버키/token이 브라우저로 전달되지 않게 한다. SEC-01 재귀 DTO는 서비스팀 담당이다.
- SEC-03 직접 원점·사용자만/서버만·일반/만료/취소·다른 report/학교 scope를 preview/운영에서 검수한다. SEC-07 429/Retry-After·안전한503/no-store와 기존 성공 점수/HOLD를 소비하고 다른 오류를 가리지 않는다.
- SEC-05/06 공유 원자적 예산은 서비스/인프라팀이 검색/상세/분석/후보/shortlist 반환/출력에 공통 적용하고 화면팀은 반복수집·preview 우회를 검수한다. 무료 전체누백·유료 전체 대학/학과 검색을 폐지하거나 임의 고정 수치로 제한하지 않는다.
- SEC-08 세 security gate의 같은 snapshot 실제 browser/HTTP 증거를 결속한다. 문서/단위 PASS는 실제 반출/우회/수집 방어 인수가 아니다.
- 로컬 메모리의 성적·리포트·관심학교·관리 초안/발표는 재시작 시 소실한다. 로컬 성공을 운영 영속성으로 표시하지 않으며 SUP-10 실DB 복구를 선행한다.
- 요청 시험팩 엔트리가 없거나 MissingDataProvider가 None을 반환하면 overall.analyze는 exam_not_available/HTTP503이다. 엔트리가 등록됐지만 미채택이면 provider의 artifact_not_approved/503을 overall이 exam_data_unavailable/HTTP503으로 변환한다. 승인·유효 시험팩 계산 성공 후 모형 없음/미승인에서만 total_standard_score/subjects를 보존하고 total_model_missing/total_model_not_approved pending/null을 구분한다. approved_count=0만으로 두503 중 하나를 결정하지 않는다.
- head6b2 merged와347 비포함을 분리하며 FE-05의 최신 develop 후속 PR·fullSHA/CI·browser 증거를 제출하기 전 빈 학교 표시 fix가 통합됐다고 기록하지 않는다.

완료조건:

- 실JWT/운영 API·일반/유료·소유권·점수/HOLD·발표본 결속·4페이지 및 기존 report.export 응답 소비를 실제 브라우저로 인수했다. 리포트·인쇄 기능 확장은 제외한다.
- BFF/22 매핑·실세션/CSRF/서버 신원·브라우저 전달물/재귀 DTO·원점/권한 우회·공유 예산/429/503/no-store·preview 및 세 security gate의 실제 인수 증거를 같은 SHA에 결속한다. 담당 경계·미채택 admin/session/헤더 CR은 분리한다.

### SUP-10 P1 — 서버·DB 운영 담당

업무:

- 승인 범위 최소 backup/restore·재시작 영속성·동시성·통계범위/갱신 latency·설정 refresh를 검수한다.
- Auth/DB/Drive 장애 HOLD/안전한 실패·민감로그 배제·UTC/서울시각 구분을 검수한다.
- Kafka/Redis 미채택. 서비스 추천/선택 집계·순위를 전국 실제 지원인원/전국순위로 표시하지 않는다.
- LocalMemoryRepository/MemoryForecastRepository 결과는 재시작 시 소실한다. DPAPI 자료 캐시는 이 업무 결과를 영속화하지 않는다.
- 같은 owner/권한/발표본 결속을 유지한 운영DB 재시작·backup/restore를 승인 검수 범위에서 대조한다. 준비 목적으로 DB 초기화/원본 삭제를 하지 않는다.

완료조건:

- 영속성·복구·장애·통계범위·갱신 측정·비밀/개인정보 로그배제 증거가 있다.
- 로컬 소실 경고와 실제 DB 재시작/backup/restore/owner·발표본 영속성 증거를 구분한다. 로컬 PASS로 운영 저장 인수를 완료하지 않는다.

### SUP-11 P0 — 시스템기획·두 개발 담당·데이터팀

업무:

- 개별 gate 완료 후 정확 SHA/API/승인자료버전·CI·privateexclude·문서일치·외부인수를 고정해 develop→main PR을 검토한다.
- main 반영과 운영 배포는 별도 승인이다. 현재 main/release not_ready를 유지하고 이번 문서를 DB쓰기·모형 승인·배포 승인으로 확대하지 않는다.

완료조건:

- 개별 gate·정확 SHA/CI·문서/자료/외부인수와 별도 배포승인 여부를 기록했다.

## 화면팀 최종 회신 인수

[화면팀 회신 요청](화면팀_회신요청_최종.md)의 RF-01~06 및 원래 로컬 요청 ①~⑥를 함께 확인한다. 전달 문서 완성과 실제 회신·연결·보안 검수는 별도 상태다.

## 실행 순서와 의존관계

| 단계 | 작업 | 실행경계 |
| --- | --- | --- |
| 1 확정 목표·남은 상세 계약 | SUP-01/02·RF-01~06 | 별도 FastAPI/master 목표는 확정. DDL/SQL·관리자 CR·BFF/모드·제공자/Connect는 회신·인수 필요 |
| 2 비공개입력·자료준비 | SUP-03/05/08 | depends_on충족후병행/단순env·원문QA는승인아님 |
| 3 DB·권한·운영API | SUP-04/06/07 | 별도 적용 승인·실DB/실Auth·목표 어댑터·UTC/owner·BFF/서버신원·보안 실제 증거 선행 |
| 4 화면·최소운영 | SUP-09/10 | 승인자료/운영API·권한 결속 후 preview·3security gate·브라우저/실DB 재시작·복구 각각 인수 |
| 5 최종SHA·mainPR | SUP-11 | 모든gate증거·CI/제외·외부인수/배포별도승인 |

각depends_on을먼저충족한다. env/원문QA/안전한HOLD준비와실자료·운영인수를구분한다.

## 운영 인수 완료 조건

| gate | 담당 | 현재상태 | 완료증거 |
| --- | --- | --- | --- |
| 실DB | SUP-03/04 | NOT_RUN_001_UNCONFIRMED_002_NOT_APPLIED | 실DB의 001/002 schema_versions·TLS·전용 role·owner·UTC·CAS/멱등·불변 발표본 원자성 검수 영수증 |
| Bearer 로그인 | SUP-05 | NOT_RUN | 실제 Auth getUser/sub/exp와 만료·비정상·불일치 JWT 거절 영수증 |
| 유료·staff 권한 | SUP-02/06 | NOT_RUN_TARGET_CONFIRMED_ADAPTER_PENDING | 확정 master의 어댑터·사용자키/UTC/취소/회수·관리자 CR·session v1 호환·owner/학교 scope/독립승인 실제 증거 |
| 실approved 자료 | SUP-08 | HOLD_APPROVED0 | 권한 있는 joint curve/규칙/연도보정/학교누백/forecast·독립검산 |
| Drive 실제공급 | SUP-08 | NOT_RUN | OAuth/갱신·승인명부·실read·별도write |
| Jungsi22 API | SUP-01/07 | NOT_RUN | 확정 별도 FastAPI의 실제 배포·운영factory·HTTPS·BFF/서버신원·실권한·원점 차단 증거 |
| 외부4페이지 | SUP-09 | NOT_RUN_BROWSER_PR6_MERGED_SOURCE_OBSERVED | 통합2624/PR6 source·CI 관측 이후 정확 actual자료/권한/세security gate/수신PC·브라우저/429503 증거를 별도 인수 |
| 운영·최종release | SUP-10/11 | NOT_READY | 영속성/복구/장애·정확SHA/CI·main/별도배포승인 |
| 브라우저·응답 전달물 | SEC-08/security_response_artifacts | NOT_RUN | 기존 security_contract/workflow 필수 gate의 같은 snapshot 실제 scope 증거. 문서/합성 PASS는 런타임 인수가 아니다. |
| 중계·실권한·원점 차단 | SEC-08/security_direct_authorization | NOT_RUN | 기존 security_contract/workflow 필수 gate의 같은 snapshot 실제 scope 증거. 문서/합성 PASS는 런타임 인수가 아니다. |
| 공유 원자적 수집 예산 | SEC-08/security_harvest_controls | NOT_RUN | 기존 security_contract/workflow 필수 gate의 같은 snapshot 실제 scope 증거. 문서/합성 PASS는 런타임 인수가 아니다. |

실DB/Bearer로그인/유료·staff/실approved자료/22API/외부4페이지는각각NOT_RUN/HOLD다. production_ready=false/NOT_READY·mainnot_ready를각증거인수전유지한다. 이번문서작성은DB쓰기/migration/모형등록/main/배포승인이아니다. reset/drop/delete금지.

## 이전 코드 인수와 이번 후보

PR13 adc684/74fd/947의493건·b66의530건·PR14 구현429/병합91과 문서816의 정상561건/정확CI는 확인된 이전 코드 인수 이력이다. 이번 문서 후보의 미실행 검사·미래 commit/CI와 실제 운영 완료를 뜻하지 않는다.

확인된이전baseline 81672e7214e34ff929639492319896420bd62196, tree c44d0dc9381e01a2d02ccd1ee18739f549aef9be; normalhooks 561건. [이전정확CI](https://github.com/natural0448/Jungsi_touch/actions/runs/37417096001/job/112118000627).

## 공식 primary 참고

실행환경에 따라direct/session/transaction을 고르고 Dashboard Connect 문자열을 사용한다. transaction prepared/session-state 제약을 실제환경에서 검수한다. [Supabase PostgreSQL 연결](https://supabase.com/docs/guides/database/connecting-to-postgres).

publishable와secret 역할을 구분하고secret은서버전용이다. 사용자JWT/DB비밀번호를대체하지않는다. .env예시도Git제외규칙을유지한다. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Data API 노출schema설정과SQL grants를구분한다. private schema를자동노출하지않는다. [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas).

PGRST106/406은요청schema가db-schemas API노출설정에없는경우다. SQL schema부재/권한실패로확대하지않는다. [PostgREST 오류](https://docs.postgrest.org/en/stable/references/errors.html).

TypeScript/Deno runtime이다. 현재PythonFastAPI/NumPy의별도backend권장은runtime차이의추론이며아직미선택이다. [Supabase Edge Functions](https://supabase.com/docs/guides/functions).

별도 FastAPI와 이용권 단일 기준은 확정 목표이며 운영 배포·DB·어댑터 전환은 미실행이다. 제공자 무료 plan 가격·제한 수치를 단정하지 않는다. 공개 문서에 실제 project URL/id/key/JWT/개인식별/자료 hash/비공개 PC 경로를 넣지 않는다.

## Supabase 운영 인수 상태

별도 정시 Python FastAPI 배포와 public.jeongsi_passes 단일 이용권 원본을 확정 목표로 채택했다. 배포 제공자·BFF 상세 계약·DB 연결·어댑터 전환·관리자 예외 표현은 후속 회신/개발/검수가 필요하다. 현재 session v1 3필드·jungsi_backend.entitlements 실행·22API·4페이지·무료 전체 누백/유료 대학 후보 정책은 불변이다. 기존 보관 키의 HTTP 접근/limit=0 관측은 과거 범위이며 실제 로그인·SQL/RLS·이용권·승인 수치·Drive·운영 API·화면/보안 인수가 아니다. 승인 자료 0건은 05:32Z 관측이고 새 자료 승인 검수는 실행하지 않았다. production_ready=false / NOT_READY다. PR6는 develop2624에 통합됐고 head6b2 CI2 success를 root가 읽기 확인했다. 새 로컬 보고는 독립 문서 범위 검토를 마쳤으며 네 역할/HOLD·503/HTML검색0·경고의 document_reported pass다. 직접 root 브라우저·전체 전달물/실429/수치/운영/보안은 NOT_RUN/PENDING이다. 347의 빈 학교 표시 fix는 현재 develop에 포함되지 않아 FE-05로 통합해야 한다.

[Supabase 운영 인수인계](Supabase_운영_인수인계.md)를 따른다. revision 2026.10.06.v3; HTTP 관측 시각 2026-10-06T08:40:54.349322Z.

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

<!-- jungsi:generated spec_sha256=378b82832ee3adcedc8ff403d28e079839de01e43afc90b55f2f88606e73c302 -->
