# Supabase 입결 DB와 화면 API 연결

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.17이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

이미 적재한 비공개 Supabase 입결을 별도 목적 범위의 공식자료 표시용 공급자로 읽어 기존 화면 API에 명시 연결한다.

계약 2026.10.08.v1 · 코드 planned · production_ready=false. 담당 feature/application-pre-data-platform.

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

논리 작업: history.search, offerings.search, offering.read, recruitment.read, session.read. 기존22 API 중 명시한 조회 부분만 연결하며 전체 엔진 포팅 완료를 뜻하지 않는다.

## 담당 작업

| 작업 | 담당 | 범위 |
| --- | --- | --- |
| DBD-01 | 데이터팀 | exact 원행/curated 기준의 원형·타입·PK·학년도 대조와 필요 최소 app SELECT 권한/성능 검수 |
| DBD-02 | 서비스 개발팀 | 명시 표시 공급자와 Python reference·Edge ports/adapter·인증/오류/DTO 호환 구현 |
| DBD-03 | 시스템기획팀·서비스 개발팀 | 목적별 제한 검수 승인·불변 private descriptor·설정·동일 후보 API 수치 대조 |
| DBD-04 | 외부 화면팀 | API transport prefix와 서버 relay 연결·실제 로그인·1페이지 원지표/보류/오류 브라우저 검수 |

## 화면팀 연결

- 화면은 기존 API 응답만 읽는다. DATABASE_URL/secret 키/descriptor/원자료/전체 DB는 수령하지 않는다.
- 제한 검수 API가 실제 배포·응답 검수된 후 관측한 base URL과 transport prefix·공개 Auth 설정을 받는다. 예측한 주소로 live 전환하지 않는다.
- relay는 비공개 서버 설정으로 전달하며 사용자 JWT는 BFF에서 재검증해 보낸다. 실제 학생 성적·토큰은 채팅/공유 문서/Git에 넣지 않는다.
- 다른 PC는 같은 candidate에서 실제 원지표·타입·출처·검색 조건·401/403/503·no-store와 전달물 비노출을 검수한다.
- DB 행 수가 늘어도 행별 조회를 추가하지 않는다. 같은 요청의 data JOIN 1회 증거와 실제 RLS 영수증을 별도 확인한다.

## 증거와 미실행 범위

| 항목 | 상태 |
| --- | --- |
| source_db_read_only | PASS_READONLY_TYPED_140_SOURCE_ROWS; runtime_RLS_and_new_JOIN_pending |
| python_reference_HTTP | NOT_RUN |
| Deno_check_test | NOT_RUN |
| restricted_cloud_API | NOT_RUN |
| actual_user_JWT | NOT_RUN |
| frontend_BFF_browser | NOT_RUN |
| operational_security_three_gates | NOT_RUN |
| effective_RLS | NOT_RUN |
| bulk_JOIN_query_count | NOT_RUN |

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

<!-- jungsi:generated spec_sha256=1d2285b0453f7e156ecd190557484be129a29d65111f03ec097f4f6e7594f05d -->
