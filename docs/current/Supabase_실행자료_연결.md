# Supabase 실행 자료 연결과 운영 준비

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.157이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

명시 Supabase 보안 앱 구성·공급자별 설정·선택 실행 자료의 사전 검수·최소 readiness 연결과 배포 준비. 원자료·정제 정본과 실행 발행본을 구분한다.

계약 2026.10.07.v2 · 코드 accepted_on_develop_scoped_synthetic_verified · 운영 준비 false. 출발 develop 0b120ff3b4e168b6c724de0b212e221ef8527c3e.

현재 운영 플랫폼은 Google Drive·Supabase로 한정한다. 아래 Python factory·파일 경로·합성 인수는 보존된 로컬 참조 구현이며 Edge 배포 완료를 뜻하지 않는다. [Supabase 전용 배포 후속작업](Supabase_배포_화면_후속작업.md)을 함께 따른다.

## 원자료 등록과 실행 발행본

최신 활성 등록부의 원자료/정제 release·효과적 읽기 관계·버전/해시와 기존 검수 근거를 먼저 확인한다. 과거 source-only 개수/상태를 현재 실행 자료의 상태로 대체하지 않는다. 검증된 CSV/DB 저장 사실은 native 형식·산술·모형·운영 승인을 대신하지 않는다.

최신 비공개 정본 포인터: DATA_ACTIVE_SUPABASE_v1.json, DATA_ACTIVE_CSV_v1.json. 포인터·해시·실제 release/검수 기록은 비공개이며 여기에는 실제 원자료나 수치를 복사하지 않는다.

| 단계 | 담당 | 완료 조건 |
| --- | --- | --- |
| source_registered | 데이터팀 | 정본 버전·원자료/정제·검수 근거를 고정한다. 기존 원본/이력은 보존한다. |
| native_candidate | 서비스 개발팀·데이터팀 | 요청 기능의 최소 의존성만 native 실행 형식으로 별도 변환한다. 값 부족·미확정 산식은 보류한다. |
| scoped_validation | 데이터팀·시스템기획팀·서비스 개발팀 | 원본→native 계보·해시·타입·모집행/시험/산식/곡선 버전·독립 산술/추정 검산을 확인한다. |
| approval_and_immutable_publication | 승인 담당·서버 담당 | 검수한 정확 버전과 승인 근거에 결속한 별도 불변 발행본과 명부를 만든다. source-only의 상태/시각만 바꾸어 실행 자료로 승격하지 않는다. |
| explicit_runtime_selection | 서버 담당 | 승인된 native 최소 명부와 명시 보안 factory로 연결하고 공급자별 readiness를 검수한다. |
| hosting_and_actual_acceptance | 서버 담당·외부 화면 담당 | 배포 대상·운영 설정·실JWT/권한·API/원점·BFF/CSRF·브라우저·공유 사용량 및 세 보안 gate의 실제 증거를 같은 후보에 결속한다. |

## 명시 서버 구성과 공급자별 상태 확인

create_supabase_secured_app를 명시 선택하고 DEV-008 security 구성을 연결한다. 기존 create_app/configured_app·이용권·session v1·Drive·local 경로를 유지한다.

필수 구성: Supabase_Auth_settings, app_role_PostgreSQL, private_Storage_scope, private_runtime_registry, explicit_required_native_selection, relay_security. Supabase 명시 구성의 health에서 Drive token/input/output/registry를 추가 필수로 판단하지 않는다. DB 검증과 명시 선택한 native 실행 자료의 읽기·디코딩·버전/해시 검수가 필요하다.

환경 진입점 configured_supabase_app · 읽기 전 설정 이름 검사 `python -m jungsi_touch.infrastructure.supabase_runtime --check-config`. 설정 이름 검사는 파일/DB/Auth/Storage를 읽지 않는다.

서버 실행 진입점 `python -m uvicorn jungsi_touch.infrastructure.supabase_runtime:configured_supabase_app --factory --host 127.0.0.1 --port 8000 --no-access-log`. 주소/TLS/worker/비밀 명부 mount는 배포 대상에서 확정한다. 이 문서는 배포 실행 증거가 아니다.

비공개 환경변수 이름: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DATABASE_URL, SUPABASE_SECRET_KEY, JUNGSI_SUPABASE_STORAGE_BUCKET, JUNGSI_SUPABASE_STORAGE_PREFIX, JUNGSI_SUPABASE_RUNTIME_REGISTRY, JUNGSI_SUPABASE_RUNTIME_SELECTION, JUNGSI_RELAY_TOKEN. 값은 별도 서버 비밀 설정으로 공급하며 환경 예시 파일·클라이언트 코드에 넣지 않는다.

/health/ready는 relay를 확인하며 status, server_timezone, production_ready, security_boundary만 반환한다. production_ready=false이고 draft/false 승인·누락·잘못된 형식/해시/버전에 안전한503을 반환한다. Detailed missing settings/object references/paths/probe receipts stay in private CLI output; no public readiness leak.

## 최소 실행 자료 선택과 검수

명부 형식 jungsi.data-registry/v1 · 종류 exam_pack, total_model, catalog, conversion, percentile, estimate_receipt, analysis, forecast_inputs, forecast_policy, forecast_context. 요청 기능이 필요한 kind/key만 명시 선택한다. 승인 status·engine_approved·production_allowed·archive_only=false와 native decoder·크기/해시/버전 결속을 함께 확인한다.

선택 명부 jungsi.runtime-selection/v1 · required: nonempty [{kind, key}]; duplicate identities rejected; only explicitly required dependencies are read. 빈 선택·중복·알 수 없는 kind와 보호 위치 밖 명부는 거절한다.

명시 선택에 이미 포함된 시험·팩·카탈로그·환산·누백·곡선·모집행의 학년도와 버전/맥락을 서로 대조한다. 불일치는503이며 미선택 자료를 암묵적으로 읽거나 전 자료를 필수로 확장하지 않는다.

원자료/CSV 저장 검수와 실행 산술 검수, 형식 검수와 모형 정확도, native 승인과 예상 기준선 forecast 승인은 각각의 근거로 판단한다. forecast는 기존 독립 editor/approver·revision/입력/정책/context 조건을 유지한다.

## 배포와 화면 담당 인계

별도 Python FastAPI 서버 · 배포 대상 selected_supabase_edge_migration_pending · 실제 배포 NOT_RUN · 화면 feature/presentation-foundation. 서버 UTC, 원자료/화면 Asia/Seoul이며 runtime에는 app role만 사용한다. 서버 비밀과 원자료는 브라우저에 전달하지 않는다.

외부 화면 담당은 확정 API 주소와 공개 Auth 설정, 서버 전용 relay·세션/CSRF 계약 및 같은 native 버전의 기대값을 수령해 실제1~4페이지를 검수한다. API22/DTO·회원·소유권·성공 점수와 판단 pending 조건을 유지한다.

## 검수 상태와 남은 입력

검수 PASS_SCOPED_SYNTHETIC_HTTP · 실제 원자료→native 발행/Auth/DB/BFF/브라우저/배포 NOT_RUN.

확인한 구현 606e8307883ea53340be850ea13674a19baa8f81 · 합성 44 · 독립 합성 11 · 정상 훅 798 · CI https://github.com/natural0448/Jungsi_touch/actions/runs/37582748954. 세부 private probe 영수증은 공개 health에 포함하지 않는다.

develop 인수 493232832d663d7fea7b0fbb350de15055cd9ccf · 통합 훅 799 · https://github.com/natural0448/Jungsi_touch/pull/19 · 병합 CI https://github.com/natural0448/Jungsi_touch/actions/runs/37586473913. 코드 인수와 실제 운영 인수는 각각의 증거로 판단한다.

- latest verified source to compatible native candidate and scoped numerical review
- explicit approval/immutable publication/runtime selection of eligible minimum native artifacts
- Supabase Edge compatibility implementation and private configuration within the existing plan
- approved presentation hosting scope and actual JWT/entitlement/owner/Storage/API/BFF/CSRF/browser acceptance and shared atomic quota
- forecast publication needs its separate independent editor/approver and pinned context; source metadata is not a forecast draft

[작업 항목](../work_items/DEV-009-runtime-connection-preparation.json) · [Supabase 운영 인계](Supabase_운영_인수인계.md) · [필수 보안 기준](외부접근_데이터보호_개발기준.md)

## 현재 운영 플랫폼과 화면 인계

[Google Drive·Supabase 전용 배포 계약](Supabase_배포_화면_후속작업.md)이 이전 별도 FastAPI 호스팅/외부 워커 인계보다 우선한다. Python 검산은 보존하고 Edge 호환과 실제 인수는 후속 작업이다. relay는 X-Jungsi-Relay-Token 확정 계약이며 발행 감지는 최신 승인 native 버전/해시를 사용한다. 화면 제공 범위와 요금제 포함량 검수는 완료 전 상태를 유지한다.

## 기존 입결 DB를 화면 API에 연결

[공식 입결 DB 표시 연결](DB_입결_화면연결.md)의 DEV-011을 따른다. 기존 DB를 별도 목적 범위로 명시 조회하며 기본 이용권·엔진/운영 원형 상태·22API/DTO·보안 gate를 유지한다. 코드 implemented_current_review_local_owner_intake_and_offline_four_page_diagnostics; C_plus_official_exam_local_native_HTTP_partial_success_and_exact_holds_verified; full_calculation_live_and_general_publication_pending; 실제 검수/운영 상태는 같은 문서의 항목별 증거로 확인한다.

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



<!-- jungsi:generated spec_sha256=36674b07325d694365bcb6474f3204ca4f2c8d2cd51de164c2392b0d1c0de8af -->
