# Supabase 운영 인수인계

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.8.4이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

SUP01은 separate_Jungsi_FastAPI_deployment, SUP02의 목표 단일 원본은 public.jeongsi_passes로 확정했다. 현재 코드는 여전히 jungsi_backend.entitlements를 조회하며 목표 어댑터 전환·실DB/실Auth·배포·보안 인수는 NOT_RUN이다. production_ready=false / NOT_READY를 유지한다.

revision 2026.10.06.v4; 2026-10-06T08:40:54.349322Z 읽기 snapshot; 문서 actual_storage_and_source_intake_reviewed_service_implementation_pending_commit_validation. Supabase actual 신규 private49객체 staging 및 actual owner/app TLS·role/master 읽기 preflight PASS·신규private schema001002 개발 적용영수증을 각 시점으로 기록한다. 13table/RLSenabled·private app정책0·독립 검수 pending과 runtime003/실Auth/업무/Storage승인·default전환/운영 pending을 구분한다. 기존 API22/session3/page4·회원/oldfactory/authority/Drive/security와 모든 dated history는 보존한다.

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
| expiry_projection | {'proposal': '같은 서버 UTC 평가시각에서 활성 행이 1건 이상이면 유료로 판정하고 현재 활성 행의 MAX(ends_at)을 UTC Z 만료로 반환한다.', 'status': 'owner_agreement_and_source_definition_received_SQL_effect_and_adapter_pending', 'source_verification': '활성 MAX(ends_at)은 소유자 동의 수령이고 기간/타입/FK 정의는 source migration 수령으로 확인했다. 실SQL/기간 경계/동일 UTC시각·어댑터 검수는 NOT_RUN이다.'} |
| admin_exception | {'site_rule': '기존 사이트의 관리자 열람 예외를 부정하거나 실제 paid로 가짜 승격하지 않는다.', 'status': 'backend_lookup_operation_scope_and_DTO_CR_pending', 'proposal': 'paid를 위장하지 않는 SSR/BFF 내부 권한 context와 별도 admin_read로 기본 session v1 3필드를 유지하는 안을 우선 제안한다. 독립 브라우저 capability 소비가 필요할 때 opt-in session v2는 별도 CR의 차선안이다. 두 안 모두 미채택이며 5열람 operation·shortlist 예외·owner/forecast scope를 별도 확정한다.', 'boundary': '다른 public 표 접근 제한과 관리자 조회를 양립하도록 확정한다. owner·확인 성적·학교/forecast scope·독립 승인을 우회하지 않고 현재 shortlist.update/report.export/statistics.read의 paid 규칙을 유지한다. shortlist.update 예외는 별도 결정/CR 대상이며 미채택이다. 임의 만료·epoch9999·헤더/함수/권한을 만들지 않는다.'} |
| migration_boundary | 옛 entitlements는 이력으로 보존하며 이중 원본·동기화 fallback·env만으로 자동 전환하지 않는다. |
| user_identity_type | uuid |
| user_identity_status | source_definition_received_current_DB_and_adapter_verification_pending |
| user_identity_reference | source commit f23b15f8ec357ab26053d0ad1078d353a77ade42의 원본 migration에서 user_id UUID NOT NULL/auth.users FK 정의를 읽었다. 실제 운영 FK/owner/RLS·reader는 미검수다. |
| history | {'before_source_intake': {'user_identity_status': 'owner_reported_original_DDL_NOT_REVIEWED', 'user_identity_reference': 'auth.users 참조는 소유자 보고이며 실제 FK/nullable는 원본 DDL 확인 대기다.', 'expiry_projection': {'proposal': '같은 서버 UTC 평가시각에서 활성 행이 1건 이상이면 유료로 판정하고 현재 활성 행의 MAX(ends_at)을 UTC Z 만료로 반환한다.', 'status': 'owner_reported_agreement_original_DDL_and_adapter_verification_pending', 'source_verification': '소유자 회신에서 user_id uuid와 활성 MAX(ends_at)에 동의했다는 보고다. 실제 원본 DDL/타입/nullability/권한 SQL·실DB·어댑터는 아직 검수하지 않았다.'}}} |

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

## 실제 Supabase Storage 업데이트와 DB·운영 경계

최신 사용자 요청 범위에서 신규 private Storage 복사·원본 보존, 실제 owner/app 연결·catalog 사전 읽기 검수 및 신규 private schema 001/002 적용 개발 영수증을 수령했다. 001/002 적용의 독립 원장 검수는 대기이며 private app 정책0·runtime003·사용자Auth/유료권한/default factory·자료/모형·보안·운영은 미인수다. master/public/profiles/기존role owner 변경·DELETE/DROP/TRUNCATE·기존 자료 덮어쓰기0을 분리한다. arbitrary schema/policy/master 변경·삭제·운영배포 권한으로 확대하지 않는다. 과거 미접속/미적용/safety 관측은 각 시점 history로 보존한다. 최신 사용자 지시는 서비스에 필요한 최소 자료만 인입하는 것으로 범위를 한정한다. 모든 소유자료 scan/자동import는 금지하며 기존49archive 보존/자동 runtime채택0·삭제0.

| 항목 | 상태 | 증거 범위 |
| --- | --- | --- |
| Storage 관측 | ALL_STAGED_OBJECTS_UPLOADED_HASH_VERIFIED_PUBLIC_ROUTE_ACCESS_DENIED | 2026-10-06T12:48:00.372547Z; 증거 SUP-STORAGE-20261006-PRIVATE-STAGING |
| 신규 private/기존 보존 | False / True | bucket 생성·재조회. 실제 식별자/경로는 private 영수증 |
| 객체 적재/해시 재수신 | 49건 | uploaded_and_readback_hash_verified; 원본 보존 True |
| public 경로 거절 | 98건 / HTTP 400 | Storage object/public 경로의 anonymous 및 publishable-key 요청만 검수 |
| 인증 사용자 raw RLS/signed URL | NOT_RUN / NOT_RUN | public 경로 거절과 별도 검수 |
| Storage 당시 SQL/001/002 | NOT_RUN / UNCONFIRMED / NOT_APPLIED | Storage 관측 시점의 역사. 최신 actual DB 단계는 아래 별도 절 |
| engine/production | False / False | 저장본 채택·숫자·운영 승인 미실행 |
| 독립 sample 검수 | 3객체 / 12거절 | SUP-STORAGE-20261006-SAMPLE-QA; server-secret GET-only 3개 full hash 및 private/public 경로 anonymous/publishable-key no-user-JWT12거절. 실제 paid JWT raw RLS/signed URL/DB 검수가 아니다. |

### 최소 승인 자료 인입 규정

minimal_explicit_approved_allowlist; 요청 operation에 필요한 시험팩·모형·규칙·카탈로그·입결 중 선별 승인 엔트리와 필요한 최소 의존성만 인입한다. 모든 category를 모든 페이지/무료 계산의 필수로 가정하지 않는다.

기존 operation의 정확 guard/503와 자료부족·판단 pending을 유지한다. 없는 곡선/입결을 합성값이나0/승인본으로 대체하지 않으며 승인시험팩 성공 총점·과목결과와 전체판단보류를 구분한다.

Storage49개는 보존용 staging의 관측이며 자동 runtime 채택0/삭제0을 유지한다. 13개 스키마 테이블 생성은 자료 대량 인입과 다르다. 자료팀이 최소 명시 승인 allowlist와 독립 검산을 준비하고 공급자/engine/production은 별도 인수한다.

Runtime 필수로 추정하지 않는 자료: PDF, QA 산출물, DB 덤프, 전체 원표, 소유한 모든 자료

- 실제 업로드·해시 재수신·원본 보존을 확인했다. 저장본은 runtime 승인 릴리스 또는 숫자 정확도 인수가 아니다.
- 공개 경로400 거절은 실제 로그인 사용자의 raw Storage/RLS·signed URL 권한 검수와 다르다. 이 후속 검수는 NOT_RUN이며 private 설정만으로 전체 반출 방지를 완료했다고 주장하지 않는다.
- Storage source·version·bucket/object identity·bytes·원문 SHA와 승인 증거는 private 명부/영수증에만 기록한다. 공개 문서·라우팅·브라우저에 실제 object 경로/원자료 hash/비밀/다운로드 URL을 넣지 않는다.
- 원본/기존 bucket/이력 보존·신규 경로 복사·overwrite/delete0를 유지한다. 표 저장 검증과 engine_approved/production_allowed는 별개다.
- 현재 운영 factory의 자료 공급은 Drive 기반이다. Storage→엔진 공급자는 별도 CR의 explicit 주입으로 준비하며 자동 Drive 변환·env만으로 운영 전환하지 않는다.

### 소유자 source DDL 부분수신

SOURCE_DDL_PARTIALLY_RECEIVED_PRODUCTION_EFFECT_NOT_RUN; 2026-10-06T12:41:50.177522Z; source commit f23b15f8ec357ab26053d0ad1078d353a77ade42. 9 source 파일 수령 / 30 SQL 파일 검토. 원본 source SQL 수령과 실제 운영 DB 적용/최소권한/기간·FK·RLS 효과를 분리한다. 소유자 보고는 일부 source 정의로 확인됐지만 SQL 연결과 현재 운영 정책은 NOT_RUN이다. 소스 SQL의 DROP/DELETE/TRIGGER 표현을 실행 요청으로 해석하거나 기존 파일/행을 삭제하지 않는다.

- user_id는 UUID NOT NULL이며 auth.users(id)를 참조한다.
- starts_at/ends_at은 timestamptz NOT NULL이고 revoked_at은 nullable timestamptz다.
- ends_at > starts_at의 period CHECK 및 user_id/ends_at 인덱스가 소스에 있다.
- master ENABLE RLS 및 auth.uid()/public.is_admin() 기반 기존 정책은 소스 정의다. direct backend role의 신원 context와 효과를 검수한 것이 아니다.
- profiles role/admin·status 제약과 기존 is_admin(auth.uid()) 정의는 reference source다. 검증 subject를 받는 최소 서버 판정 포트로 자동 채택하지 않는다.

### 실제 SQL 사전 검수와 신규 private schema 적용 단계

| 관측 | 상태 | 범위 |
| --- | --- | --- |
| 읽기 preflight | PASS_READONLY_CONNECTION_ROLE_MASTER_SCHEMA_ABSENCE | 2026-10-06T13:12:00.846782Z; SUP-DB-20261006-READONLY-PREFLIGHT; TLS 양계정/least role/master9컬럼·2 SELECT policy/당시schema0 |
| 001·002 적용 | actual_applied_verified_by_development_receipt_independent_review_pending | 2026-10-06T13:17:14.729580Z; SUP-DB-20261006-001002-APPLY; 신규13 RLS tables/owner·schema_versions |
| 독립 원장검수 | pending | 개발 적용 영수증 이후 별도 검수; runtime app정책 0건 |
| runtime003/실업무 | NOT_APPLIED / NOT_RUN | Auth/paid/defaultfactory/운영승인 미인수 |

실제 SQL catalog 읽기·TLS/role·master 최소 SELECT와 당시 private schema/table0만 확인했다. 기존 001/002 미적용 관측은 이후 적용 영수증과 시점을 나누며, 실사용자/JWT·master 사용자별 유료판정·private 업무CRUD/권한·runtime factory·Storage signed URL/유료 raw RLS·숫자/운영을 증명하지 않는다. 전용 master SELECT는 PERMISSIVE USING(true)여서 app/owner 행 접근범위가 넓다. reader SQL filter/검증subject·별도 runtime 권한 검수 전 사용자별 master RLS 인수를 주장하지 않는다.

001/002 는 owner 단일 transaction의 신규 private schema 추가·13 tables·RLS enabled·schema_versions 반영 개발 영수증이다. 독립 실원장 검수는 pending이다. FORCE RLS/앱 업무 policy·runtime003·실제 사용자/유료권한/CAS·멱등·발표 원자성·22API·배포/운영 인수가 아니며 master/profiles/기존 owner·role은 변경하지 않았다.

CR-SERVICE-SUP04-20261006-01; adopted_for_implementation_actual_policy_preflight_received. runtime current_user=jungsi_backend_app; migration owner runtime 거절; 기존 master9컬럼 SELECT 임의 REVOKE 금지. 実際の own/admin·backend read 두 SELECT policy를 바탕으로 검사 계약을 개정한다. 임의 public REVOKE나 migration owner 런타임 사용으로 해결하지 않는다. SQL 계약/권한 구조만 공개하며 실행 설정값/실제 사용자/자료는 공개하지 않는다. 전용 app/owner 정책의 PERMISSIVE USING(true)는 기존 PUBLIC own/admin와 OR 결합되므로 DB RLS가 verified UUID만의 행으로 좁혀준다는 주장은 금지한다. reader의 WHERE user_id=%s 및 서버 검증 UUID parameter로 조회범위를 강제하고 transaction local claim을 결속한다. 추가/변경 정책·role·predicate는 거절한다.

OpenAPI metadata HTTP 200, 9컬럼; OpenAPI definition/GET metadata만 실제 조회. nullable/FK/default/CHECK/trigger/index/GRANT/RLS 및 적용 이력의 실제 SQL 인수는 아니다.

| 입력 | 현재 수신/검수 상태 | 받은 범위 | 남은 범위 |
| --- | --- | --- | --- |
| IN-DB-01A | source_original_and_live_catalog_received_history_partial | 원장 source9파일과 actual master9컬럼/기간·키 catalog·SELECT policy preflight를 수령했다. | source 이후 변경 전수 이력·실사용자/active MAX 독립reader 검수 및 최소 admin 계약 |
| IN-DB-01B | live_catalog_partial_history_pending | actual SQL catalog의 PostgreSQL17.6/현재 role·master schema/policy metadata와001002 신규 이력을 수령했다. | 기존 master/profiles 전체 ALTER·적용 이력 전수성과 실사용자권한 검수 |
| IN-DB-02A | partial_source_received_production_effect_NOT_RUN | profiles 초기/인증 source 정의 부분수신. 현재 적용/최소 관리자 port·role효과는 미검수. | source와 현재 운영 DB의 효과를 구분하며 미수신 권한/이력/실접속은 후속 입력으로 남긴다. |
| IN-DB-02B | target_SQL_candidate_pending_NOT_REVIEWED | 기존 is_admin(auth.uid()) source는 참고로 수령. 검증 subject 최소 서버 boolean/권한 SQL CR은 미확정. | source와 현재 운영 DB의 효과를 구분하며 미수신 권한/이력/실접속은 후속 입력으로 남긴다. |
| IN-DB-03A | live_role_master_privileges_verified_original_SQL_pending | app/owner 연결/TLS·CREATE 차이·super/BYPASSRLS/membership 없음·masterSELECT와 쓰기없음 actual preflight. | 전용 권한 SQL 원문·private app runtime003/업무GRANT·least role 실권한 시나리오 |
| IN-DB-03B | live_two_master_SELECT_policies_verified_reader_pending | master 기존 own/admin 및 backend app/owner read의 정확2 SELECT policy actual catalog 확인. | CR-SERVICE-SUP04 app-only reader 검수·raw 사용자별 유료판정·기존 master 정책 전수 이력 |
| IN-DB-04A | 001002_applied_development_receipt_independent_review_pending | owner 신규 schema/13tables RLSenabled·001002 schema_versions 적용 영수증, master/profiles/기존owner 변경0. | 독립 원장 인수·private runtime policy003·UTC/CAS/멱등/원자성/업무권한 검수 |
| IN-DB-04B | runtime_RLS003_candidate_pending_NOT_APPLIED | 001002 적용 영수증의 private app 정책0 확인. runtime003은 별도 서비스CR 작업. | app 전용정책/업무GRANT/최소함수 원문·검수·비파괴 적용과 실제 거절 인수 |
| IN-DB-05A | actual_TLS_connections_and_role_preflight_PASS_runtime_pending | 양계정 session5432 실제TLS/현재role·UTC/PostgreSQL17.6 catalog 읽기 PASS. | 배포 환경 process/연결예산·transaction대안·default runtime factory 실인수 |
| IN-DB-05B | update_purpose_confirmed_execution_plan_and_evidence_pending | 사용자 업데이트 목적 범위에서001002 owner 단일 비파괴transaction 영수증·원본/공개master 보존 수신. | 독립 after catalog·백업복구/재시작영속성·runtime003/실사용자/전체 release 인수 |

### 채택한 서비스 구현 준비와 남은 인수

CR-SERVICE-SUP03; adopted_for_service_implementation_verification_pending. API22/session v1 세필드/4페이지·무료누백/유료후보·본인소유권·확인성적·학교 scope·독립승인·기존 Drive/local 경로·security 계약을 보존한다. 실제 서비스 구현/기본 factory 전환/DB 권한/수치/운영은 후속 증거로 별도 인수한다.

create_app의 entitlement port를 업무 저장소와 독립 주입하는 구현 준비를 채택한다. 기존 호출과 default factory는 보존한다.

- 수신 source9컬럼·UUID·timestamptz/UTC·period CHECK/FK 정의와 현재DB의 일치를 검수한다.
- 서버 검증 subject만 조회하며 동일 서버 UTC 평가시각의 활성 revoked_at/starts_at/ends_at·MAX(활성 ends_at) 의미를 검수한다.
- 전용 최소 SELECT role·CONNECT/USAGE·owner/RLS/effective privileges·raw psycopg context를 검수한다. auth.uid() 자동 주입을 가정하지 않는다.
- master에 INSERT/UPDATE/DELETE하지 않고 실제 paid와 관리자/staff capability를 분리한다.
- reader/factory/probe/session 규칙/검사 전이를 같은 구현 PR에서 인수한다. 현재 default는 old authority·session v1 3필드다.
- nullable metadata는 명시 YES/NO만 해석하고 미확인/잘못된 타입은 거절한다. bool 승인필드도 정확 bool을 요구한다. source/API metadata를 실제 DB 효과로 추론하지 않는다.
- CR-SERVICE-SUP04-20261006-01: 실제 두 SELECT 정책(기존 own/admin·전용 backend app/owner read)을 정확히 대조하고 runtime reader current_user는 jungsi_backend_app만 허용한다. migration owner는 runtime reader에서 거절하며 기존 public9컬럼 SELECT를 임의 REVOKE하지 않는다.
- master trusted backend SELECT는 실제 RLS USING(true)로 넓다. WHERE user_id=%s 검증UUID parameter를 필수로 하고 claim만으로 사용자격리를 증명하지 않는다. 실제 두 policy signature의 role/predicate/PERMISSIVE를 대조하고 unknown 추가/변경은 거절한다.

SupabaseStorageDataProvider와 GET-only Client의 explicit 주입 구현 준비를 채택한다. 현재 Drive 공급자/default configured_app은 자동 전환하지 않는다.

공급 명부 jungsi.data-registry/v1 / supabase_storage_explicit_injection; 필드 kind, key, bucket, object_key, bytes, sha256, version, payload_version, approved, engine_approved, production_allowed, archive_only; proposed_transport_shape_subject_to_same_implementation_PR_validation. 서버 전용 apikey·private bucket. 사용자 Bearer와 서버 Storage 비밀은 서로 대체하지 않으며 브라우저/응답/로그에 전달하지 않는다.

- GET-only 공급자·private bucket·신뢰 명부 SHA·entry identity/version/bytes/원문 SHA·최대32MiB를 결속한다.
- approved·engine_approved·production_allowed는 정확 bool과 실행 scope의 승인 근거로 검사하며 staging false를 임의 true로 승격하지 않는다.
- bucket/object_key는 private 명부에만 있고 허용 경로/버전·키 경로 정규화를 검수한다. 승인 엔트리 외 payload를 읽거나 키 traversal/공개 signed URL을 노출하지 않는다.
- 원문 CSV/후보 자료가 업로드됐다는 이유로 runtime envelope를 만들거나 실제 Drive ID/version으로 자동 변환하지 않는다.
- current factory 자동전환·누락설정의 메모리/합성/다른 사용자/미승인 자료 fallback을 금지한다.
- 새 Storage 명부 archive_only는 명시된 정확 bool false만 허용한다. 누락/null/0/문자열과 미확인 상태는 거절하고 archive 저장본을 runtime 승인본으로 승격하지 않는다. 기존 Drive명부를 자동 변환하지 않는다.

codepath service_candidate_files_created_feature_PR_integration_pending; 합성 service_team_reported_27_PASS_final_typeguards_and_same_snapshot_pending; 실제Auth/DB/Storage권한 NOT_RUN. 구현 준비 채택은 현재 default 전환/운영 PASS가 아니다.

서비스팀 후보에서 파일 생성 보고를 수령했다. develop implementation 참조에 추가하지 않으며 같은 공통계약·서비스6파일 snapshot의 PR/검수/통합 후 실제 참조로 전이한다.

후속 PR 후보 경로: src/jungsi_touch/infrastructure/http_api.py, src/jungsi_touch/infrastructure/postgres_entitlements.py, src/jungsi_touch/infrastructure/supabase_storage.py, tests/test_http_entitlement_injection.py, tests/test_postgres_entitlements.py, tests/test_supabase_storage.py

### 신규 DB role 발급 요청과 실제 권한 대기

| 항목 | 보고된 목표/남은 검수 |
| --- | --- |
| format | jungsi.database-role-target/v1 |
| status | actual_connection_role_master_read_preflight_PASS_runtime_privileges_pending |
| owner_role | jungsi_backend_owner |
| owner_scope | 이관/schema 객체 소유·001/002 적용 전용. 실제 객체 owner의 구조 변경 권한을 runtime 제한과 혼동하지 않는다. |
| app_role | jungsi_backend_app |
| app_scope | runtime private schema USAGE/SELECT/INSERT/UPDATE 및 master read-only. DELETE/TRUNCATE 권한 없음이 목표이며 실제 GRANT/RLS/effective privileges 검수 필요. |
| master_read_only | True |
| runtime_DELETE_allowed | False |
| runtime_TRUNCATE_allowed | False |
| owner_has_schema_management_authority | True |
| owner_is_migration_only | True |
| owner_runtime_reuse_allowed | False |
| profiles_minimum_lookup | 별도 예외 계약 이후 최소 조회 부여 여부 미정 |
| connection_selection | 지속 FastAPI/IPv4는 session5432 우선안. IPv6 direct5432 대안 및 transaction6543 실제 호환 검수는 별도. |
| actual_role_exists_verified | True |
| actual_effective_privileges_verified | True |
| boundary | 신규 연결설정과 실제 TLS/role/master metadata 사전 검수로 계정 존재·최소 SELECT·쓰기없음을 확인했다. owner는 이관/schema 소유·구조변경 권한을 갖고 runtime 재사용하지 않는다. private 업무 app 정책은 001/002 적용 영수증에서0이며 runtime003/CRUD/권한 인수는 pending이다. 기존 발급중 보고와 credential 미확보 관측은 history로 보존한다. |
| actual_privilege_scope | 13:12 preflight master SELECT/쓰기없음·CREATE·비super/BYPASSRLS/membership 검수만. 신규 private app CRUD/policies/runtime003·운영승인 NOT_RUN |

신규 연결설정과 실제 TLS/role/master metadata 사전 검수로 계정 존재·최소 SELECT·쓰기없음을 확인했다. owner는 이관/schema 소유·구조변경 권한을 갖고 runtime 재사용하지 않는다. private 업무 app 정책은 001/002 적용 영수증에서0이며 runtime003/CRUD/권한 인수는 pending이다. 기존 발급중 보고와 credential 미확보 관측은 history로 보존한다.

### private 연결설정 수령과 실제 preflight 경계

credentials_received_connection_preflight_PASS_private_migration_review_pending; 증거 SUP-CREDENTIALS-20261006-OWNER-APP; 설정 수령 후 실제 SQL 읽기 연결/TLS·role/master preflight PASS와001/002 개발 적용 영수증을 별도로 확인했다. independent 원장 검수/runtime003·실 사용자권한·default factory/운영 process 배포·자료승인은 대기다. 설정값/host/프로젝트ID/비공개 경로는 public 문서/라우팅으로 전달하지 않는다.

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
| DATABASE_URL | 서버 전용 비밀 | app private 설정 수령·실TLS/role/master preflight PASS. 배포process/default private업무권한·runtime003 인수pending | ServerSettings_required |
| GOOGLE_DRIVE_ACCESS_TOKEN | 서버 전용 비밀 | 현재 static token·갱신운영/adapter 별도 | ServerSettings_required |
| GOOGLE_DRIVE_INPUT_FOLDER | 서버 전용 | 승인 input folder/실공급NOT_RUN | ServerSettings_required |
| GOOGLE_DRIVE_OUTPUT_FOLDER | 서버 전용 | 입력과 다른 output/실공급NOT_RUN | ServerSettings_required |
| JUNGSI_DRIVE_REGISTRY | 서버 전용 | 비공개승인명부/approved0/HOLD | ServerSettings_required |
| JUNGSI_ALLOWED_ORIGINS | 서버 | CORS/origin은 인증이 아니며 서버 중계·사용자/서버 신원이 필요 | ServerSettings_optional |
| JUNGSI_PROBE_ACCESS_TOKEN | 검수 전용 비밀 | 실사용자JWT/검토file/process범위없음 | probe_optional_not_ServerSettings_required |
| SUPABASE_SECRET_KEY | 서버 참조/비밀 | 최소REST metadata조회참조/검토범위존재 | reference_not_required_or_auto_used |
| SUPABASE_JWKS_URL | 설정 참조 | 공개키조회참조/검토범위존재·직접JWT검증완료아님 | reference_not_required_or_auto_used |
| JUNGSI_MIGRATION_DATABASE_URL | 이관 전용 비밀 | owner private 수령·실TLS/role preflight·001002 개발 적용영수증. 이관전용/독립검수·runtime003 별도 | migration_reference_not_current_ServerSettings_or_runtime |

SUPABASE_SECRET_KEY와 SUPABASE_JWKS_URL은 현재 ServerSettings의 필수 설정이 아니며 자동으로 사용되지 않는다. 프런트 NEXT_PUBLIC_SUPABASE_ANON_KEY는 publishable 참조 값을 보관하는 기존 호환 이름이다. secret key나 사용자 JWT를 뜻하지 않는다. 운영 환경의 변수 이름과 설정 채택은 외부 화면 담당자가 확인해야 한다.

## 담당별 인계 작업

| ID/우선순위 | 담당/계층 | 입력 | 선행 | 현재상태 |
| --- | --- | --- | --- | --- |
| SUP-01 P0 | 시스템기획·서버 담당 / 기획/애플리케이션·인프라 | 확정 separate_Jungsi_FastAPI_deployment; 22 API·DTO·엔진 계약; 배포 제공자·Python runtime·BFF 운영 연결 요구(값은 비공개) | 없음 | DECISION_CONFIRMED_DEPLOYMENT_NOT_RUN |
| SUP-02 P0 | 에듀터치 결제·DB 담당·시스템기획 / 기획/애플리케이션·데이터 | 확정 public.jeongsi_passes 단일 원본; 원본 DDL·사용자 식별 컬럼/타입·취소/환불/회수 규칙·권한 SQL 원문(source DDL 부분수신·현재권한/적용 미검수); 현재 포트/조회·session v1 규칙·검사와 같은 어댑터 전환 PR; 기존 사이트 관리자 예외의 서버 조회/권한/DTO 영향 CR | 없음 | DECISION_CONFIRMED_ADAPTER_NOT_RUN |
| SUP-03 P0 | Supabase·서버 설정 담당 / 인프라/데이터 | Dashboard Connect 정보; 전용 server role·TLS·배포환경; 확정 별도 FastAPI 환경의 IPv4/IPv6·연결 유지 요구; master 최소 SELECT와 자체 업무 schema 쓰기/마이그레이션 role을 구분한 권한 계획; RF-03 IN-DB-01A~05B의 정확 원본/권한 입력10종과 role/owner/RLS 효과; 실제 값은 private 인계; source schema-only 원문 부분수신/OpenAPI9컬럼 metadata와 실제DB/TLS/role 검수의 분리 | SUP-01 | actual_DB_TLS_role_master_preflight_PASS_deployment_runtime_pending |
| SUP-04 P0 | DB 담당 / 데이터/인프라 | 실DB 기존 상태·승인 backup; 001/002 정의·전용role 권한계획; public.jeongsi_passes source DDL 일부수신·현재 사용자키/FK/인덱스/RLS·전용 권한 SQL 미검수; runtime/migration role·owner와 관리자 최소 조회 포트 CR; RF-03 IN-DB-01A~05B의 정확 원본/권한 입력10종과 role/owner/RLS 효과; 실제 값은 private 인계; 신규 owner/app private 설정 수령 이후 real catalog/preflight·001002 비파괴 적용·runtime RLS003 계획(미실행) | SUP-02, SUP-03 | 001002_applied_development_receipt_independent_review_runtime003_pending |
| SUP-05 P0 | 인증 담당·서버 개발자 / 애플리케이션/인프라 | 실제 검수 사용자 Bearer JWT·Supabase Auth 공개 설정 | SUP-01 | NOT_RUN_MISSING_TEST_USER_JWT |
| SUP-06 P0 | 권한·서비스 DB 담당 / 애플리케이션/데이터 | 선택한 단일 authority; entitlement·owner·forecast_authorities; SUP-05 실Auth 검수·일반/유료 검수 사용자·별도 editor/approver subject; RF-02 관리자 권한/operation/session CR; RF-03 DDL·사용자키·SQL 권한과 취소/회수; CR-SERVICE-SUP03의 read-only reader/preflight·source user_id UUID/FK/period와 actual DB 일치 | SUP-02, SUP-04, SUP-05 | NOT_RUN |
| SUP-07 P0 | 서버 담당 / 인프라/애플리케이션 | 선택 실행환경·locked Python runtime; 운영 settings·HTTPS/CORS origin; RF-01 BFF 사용자/서버 전용 신원과 원점 차단; RF-04 synthetic/local_verification/production 모드·전환 승인 | SUP-01, SUP-03, SUP-04, SUP-05 | NOT_RUN_HOSTING_AND_SECURITY_ACCEPTANCE_PENDING |
| SUP-08 P0 | 데이터팀·서버 인프라 담당 / 데이터/인프라 | Drive OAuth/folders/승인발행명부; approved exam/joint curve/catalog/analysis/rule/year bridge/학교누백/forecast 근거; 데이터팀 approved/HOLD 발행 명부·독립 신뢰 version/SHA·승인/수령 영수증; 실제 9월 검수 2~3건·독립 기대값과 보류 목록(실값 비공개); 실제 Drive/local 출처·수신 Windows PC DPAPI 재보호; SUP-STORAGE-20261006-PRIVATE-STAGING의 신규 private 저장/해시 재수신 증거·원본 보존; CR-SERVICE-SUP03 Storage explicit 공급자와 승인된 runtime envelope/신뢰명부(미준비) | SUP-01, SUP-03 | PRIVATE_STORAGE_STAGED_ENGINE_AND_PROVIDER_ADOPTION_PENDING_DRIVE_NOT_RUN |
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
- CR-SERVICE-SUP03의 독립 entitlement 주입·read-only master reader 구현 준비를 채택한다. source DDL 수령은 실제 DB preflight·default factory 전환 인수가 아니며 old 실행 pin은 유지한다.

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
- 양계정 actual TLS/현재role/UTC/PostgreSQL17.6·masterSELECT·쓰기없음·owner/app CREATE·비super/BYPASS/membership를 preflight에서 확인했다. 배포 process·runtime private policy·실Auth는 별도로 인수하고 과거 credential 부재/발급중 관측은 history로 보존한다.

완료조건:

- 배포환경 내 비공개 설정 주입·실제 DB/TLS 읽기 검수 증거가 있다.
- Connect 방식·TLS·전용 role·비공개 process 주입·master/자체 schema 권한 분리의 실제 SQL 검수 증거를 갖춘다. REST 200/.env 보관으로 완료하지 않는다.

### SUP-04 P0 — DB 담당

업무:

- 기존 상태 점검·승인 backup 후 001/002 추가 적용 계획을 별도로 승인받는다. 이번 문서는 운영쓰기 실행 승인이 아니다.
- 전용role grants/RLS·anon/authenticated 직접 접근 차단·owner·UTC·11개 timestamptz/date 컬럼·schema_versions를 실DB에서 검수한다.
- reset/drop/delete 금지. REST PGRST106은 DB schema 부재/SQL 권한 실패 증거가 아니다.
- 권한 SQL 원문을 확보해 master SELECT·다른 public 표 제한·자체 업무쓰기·owner/RLS/함수 범위를 대조한다. SELECT만으로 ALTER/RLS 작성 권한이 생긴다고 추정하지 않는다.
- profiles 관리자 판정이 필요하면 다른 public 표 접근 제한과 양립하는 최소 server-only 조회를 별도 확정한다. SQL/DDL을 추정해 실행하지 않는다.
- source9파일/30SQL검토와 repo001/002 존재는 실제 적용 증거가 아니다. 사용자 요청의 비파괴적 업데이트 목적과 credential/owner/RLS·보존 backup·구체 적용계획 미충족을 분리한다.
- owner는 이관/schema소유/001002용, app은 runtime private USAGE/SELECT/INSERT/UPDATE·masterreadonly/DELETE·TRUNCATE없음 목표다. owner의 소유·구조 변경 권한이 없다고 주장하거나 runtime에 owner 계정을 재사용하지 않는다. 전용 권한 SQL 원문·runtime003은 미수신/미적용이다. role/master catalog와001002 개발 영수증은 수신했다.
- 13:12 private schema/table0 preflight 이후13:17 owner 단일transaction의 신규 jungsi_backend/13RLS tables·001002 schema_versions 적용 개발 영수증을 수령했다. 독립 검수 pending·private app 정책0/runtime003 미적용·실업무/CAS/멱등/권한 인수 미실행을 분리한다. public/master/profiles/기존owner 변경·DELETE/DROP/TRUNCATE0.

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
- 목표 어댑터·factory·같은 서버 UTC 시각·포트/정본 session 규칙/검사를 같은 PR에 묶는다. 활성 MAX(ends_at)은 소유자 동의와 CR-SERVICE-SUP03 구현 준비로 결속하되 실제 동일UTC/reader 검수는 pending이다. session v2 opt-in/admin_read 상세는 기존 미채택 제안이며 별도 CR이다.
- 관리자 열람과 paid·forecast staff를 구분하고 명시 operation만 적용한다. owner·확인성적·학교/forecast scope·독립승인·mutation은 우회하지 않는다. 클라이언트 role/paid는 권위가 아니다.
- 취소/회수/만료 뒤 기존 report·캐시·선택 결과 재응답에도 현재 권한을 검수하고 장애를 일반 회원/허용으로 자동 변환하지 않는다.
- current Postgres probe/ready의 old table/컬럼 가정과 reader 상태를 실제 DDL에 맞춰 같은 PR에서 전이하며 업무 schema 001/002 준비와 이용권 reader 준비를 구분한다.
- source user_id UUID/FK/기간정의 수령 이후에도 실제 단일 reader/factory/probe/session·권한 거절 전이를 같은 구현 PR에서 검수한다. 자료 업로드로 유료/관리자 권한이 생기지 않는다.

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
- 실제 Storage49객체 업로드·SHA 재수신·원본 보존과 public 경로98거절을 인수했다. 실제 로그인 사용자의 raw Storage/RLS·signed URL·runtime read·자료/모형 채택은 별도 NOT_RUN/pending이다.
- 현재 default는 Drive다. CR-SERVICE-SUP03의 Storage GET-only 공급자 준비를 explicit 주입으로 검수하고 저장 CSV/후보를 runtime 승인본이나 가짜 Drive identity로 자동 치환하지 않는다.
- 최신 최소 인입 규정(minimal_explicit_approved_allowlist)을 따른다. 요청 operation에 필요한 시험팩/모형/규칙/학교카탈로그/입결 중 최소 승인 entries만 선택하고 모든 보유자료 scan·자동채택/PDF·QA·dump·전체원표 필수추정을 금지한다. 자료가 없으면 기존 guard/503·pending을 보존하고49archive는 삭제 없이 유지한다.

완료조건:

- 승인 명부/곡선/규칙/모형·버전·실Drive read/갱신/별도 write·독립 수치 증거가 있다.
- 명부/버전/SHA·수령/출처·독립 기대값·실자료를 인수하거나 수치 미승인 HOLD를 명시한다. HOLD 연결 성공은 수치 정확도/운영 승인 완료가 아니다.
- 요청 시험팩 엔트리가 없거나 MissingDataProvider가 None을 반환하면 overall.analyze는 exam_not_available/HTTP503이다. 엔트리가 등록됐지만 미채택이면 provider의 artifact_not_approved/503을 overall이 exam_data_unavailable/HTTP503으로 변환한다. 승인·유효 시험팩 계산 성공 후 모형 없음/미승인에서만 total_standard_score/subjects를 보존하고 total_model_missing/total_model_not_approved pending/null을 구분한다. approved_count=0만으로 두503 중 하나를 결정하지 않는다. 정적 코드 판독과 실제HTTP 인수를 구분한다.
- Storage 저장본의 bytes/version/원문SHA·승인명부/엔진 scope·공급자 검수를 각각 인수한다. staging hash PASS만으로 engine_approved/production_allowed·실DB·학생 수치·운영 gate를 승격하지 않는다.

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
- Storage의 원본 파일 보존/원격 재수신과 리포트/성적의 DB 영속성·재시작/복구는 다른 검수다. 로컬 memory 재시작 소실 경고를 유지한다.

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
| 2 비공개입력·자료준비 | SUP-03/05/08 | depends_on충족후병행/단순env·원문QA는승인아님; private Storage 저장·source DDL 부분수신은 실제 진행. runtime envelope/자료승인·DB연결/권한은 별도 대기 |
| 3 DB·권한·운영API | SUP-04/06/07 | 별도 적용 승인·실DB/실Auth·목표 어댑터·UTC/owner·BFF/서버신원·보안 실제 증거 선행 |
| 4 화면·최소운영 | SUP-09/10 | 승인자료/운영API·권한 결속 후 preview·3security gate·브라우저/실DB 재시작·복구 각각 인수 |
| 5 최종SHA·mainPR | SUP-11 | 모든gate증거·CI/제외·외부인수/배포별도승인 |

각depends_on을먼저충족한다. env/원문QA/안전한HOLD준비와실자료·운영인수를구분한다.

## 운영 인수 완료 조건

| gate | 담당 | 현재상태 | 완료증거 |
| --- | --- | --- | --- |
| 실DB | SUP-03/04 | 001002_APPLIED_DEVELOPMENT_RECEIPT_INDEPENDENT_AND_RUNTIME_PENDING | 실DB의 001/002 schema_versions·TLS·전용 role·owner·UTC·CAS/멱등·불변 발표본 원자성 검수 영수증 |
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

실DB의 preflight/001002 개발 적용영수증과 독립·runtime 인수를 구분한다. Bearer로그인/유료·staff/실approved자료/22API/외부4페이지는NOT_RUN/HOLD다. production_ready=false/NOT_READY·mainnot_ready를각증거인수전유지한다. 이번문서작성은DB쓰기/migration/모형등록/main/배포승인이아니다. reset/drop/delete금지.

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

신규 private Storage49객체 hash readback/원본보존·public경로98거절, source9DDL/30SQL·OpenAPI9컬럼 부분수신 이후 private 설정수령·실제 양계정 TLS/role/master catalog preflight PASS와001002 신규 schema/13RLS tables 적용 개발 영수증을 수령했다. 현재 001002는 actual_applied_verified_by_development_receipt이며 독립 원장검수 pending·private app정책0/runtime003 미적용·실Auth/유료권한/기본factory/자료승인/운영은 미인수다. master/profiles/기존roleowner 변경·DELETE/DROP/TRUNCATE0. CR-SERVICE-SUP03/04 구현준비·서비스후보27검수보고와 PR15 정적fix/CI2는 각각 same snapshot 구현/통합 및 실제 검수대기다. FE-01R HTTP-date 문법 잔여를 별도 후속으로 요청한다. API22/session3/page4·무료누백/유료후보·보안3gate·production_ready=false/NOT_READY와 모든 이전 관측/원본을 보존한다. 최신 PR15 head243d2cd7의 exactCI2/28M/noD·정확 allowedOrigins 관측은 이전339 기록과 분리하며 증분review/merge/보안운영gate는 pending이다. 최신PR15 증분은 임시preview용으로 수용했으며 FE-ORIGIN 실도메인전환/환경분리·유효action/실세션 조건은 pending이다. 최신 인입 규정은 minimal_explicit_approved_allowlist다. 요청별 최소 승인자료만 선택하며 전체소유자료/PDF·QA·dump·전체원표의 자동runtime 인입을 금지한다. 기존49archive와13table schema는 보존·자료인입과 분리한다.

[Supabase 운영 인수인계](Supabase_운영_인수인계.md)를 따른다. revision 2026.10.06.v4; HTTP 관측 시각 2026-10-06T08:40:54.349322Z.

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

<!-- jungsi:generated spec_sha256=325e8aa479c57681a37aa2abf5db60adf25352a1070478f7fbb194e23bc8a8e8 -->
