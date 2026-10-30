# Google Drive·Supabase 전용 배포와 화면 후속작업

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.139이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

기존 Supabase 기반 실제 인증·기존22와 신규6 논리 API 계약의 코드·선택 연결·운영 배포를 구분한다. Google Drive와 기존 Supabase를 사용하고 P1 조정 메타데이터 Durable Object 한정 예외만 적용한다. 현재 결합20 후보·기존14 운영판·미연결8을 혼동하지 않는다.

계약 2026.10.14.v2 · 코드 planned · 전체 운영 인수 미완료 · production_ready=false. 현재 부분 배포·검수는 live_execution 원장을 따른다. 출발 develop 73f4a4866c3edfae3ed6b6c7e9f2a1055c643117.

## 현재 소스·실제 연결·배포 상태

| 담당/범위 | 단일 정본 | 현재 상태 | 해석과 다음 조건 |
| --- | --- | --- | --- |
| 22 API 코드 등록 | live_execution.operations.*.code | PORTED 22/22 | 등록 소스와 해시 범위이며 실제 실행 조립·연결·배포 완료와 구분한다. |
| 22 API 실제 연결 검수 | live_execution.operations.*.native | PASS 0/22 | 동일 후보·실제 검수 영수증이 있는 operation만 PASS로 센다. |
| 22 API 배포 인수 | live_execution.operations.*.deployment | PASS 0/22 | 같은 후보의 배포·실 HTTP 인수 영수증을 별도로 요구한다. |
| 실제 Auth·본인 profiles 연결 — 화면팀 기능 통과 보고 / 반례 검수 진행 | live_execution.stages.auth_connection | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 실 JWT·만료·변조·타인 소유권 반례 | live_execution.stages.jwt_negative_checks | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 계정 주인의 /admin TOTP 등록·aal2 관리 검수 | live_execution.stages.owner_totp_verification | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 기존 22 API의 업무 처리·DTO·정밀 계산 이식 | live_execution.stages.api_22_port | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 보고서·초안·멱등·버전 충돌 실제 트랜잭션 | live_execution.stages.native_business_transactions | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 기존 요금제·포함량·Spend Cap·승인된 원자적 예산 | live_execution.stages.existing_plan_and_quotas | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 기존 프로젝트의 동일 후보 Edge 배포·실 HTTP 인수 | live_execution.stages.edge_deployment | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 허용 플랫폼 BFF·세션/CSRF·브라우저 비노출 | live_execution.stages.bff_browser_acceptance | IN_PROGRESS | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |
| 응답·직접 권한·수집 방지 세 보안 gate | live_execution.stages.security_gates | NOT_RUN | 해당 단계의 후보·범위·영수증 조건을 따른다. 다른 단계의 PASS를 대용하지 않는다. |

## 플랫폼과 비용 범위

사용자 최신 지시가 별도 FastAPI 유료 호스팅 제안보다 우선한다. 기존 요금제·포함 사용량·Spend Cap을 확인하며 추가 서버·DB·Redis·유료 도메인·요금제 업그레이드를 도입하지 않는다. 포함량 초과를 추가 과금으로 자동 전환하거나 무제한 기본값으로 해석하지 않는다. 2026-10-21 사용자 결정 P1-DO-ONLY-20261021은 기존 화면의 P1 조정 메타데이터용 Durable Object 하나만 허용하는 한정 예외다. 기본 서버/DB/자료 배포는 기존 Supabase이며, 요금제 변경·추가 과금 금지와 실제 비용 검수 조건은 유지한다.

허용 플랫폼: google_drive, supabase · 기존 요금제/Spend Cap 검수 NOT_RUN. 추가 비용 없이 사용할 수 있는 범위를 먼저 확인한다.

## 3티어와 기존 Python 구현

| 계층/기준 | 구성 |
| --- | --- |
| 프레젠테이션 | 담당 화면/BFF; 제공 방식의 플랫폼 범위 확인 중 |
| 애플리케이션 | Supabase Edge Functions의 TypeScript/Deno 업무 서비스·환산/누백 엔진·저장소 포트 |
| 데이터 | 기존 Supabase Auth/PostgreSQL/private Storage; Google Drive 원본·검수 계보 보관 |
| 기존 검산 | 현재 Python/FastAPI 코드와 검산을 로컬 기준으로 보존 |

Edge Functions가 Python ASGI 서버를 그대로 실행한다고 가정하지 않는다. 기존22 API·DTO/session v1·권한·현재 이용권·성공 점수/판단 pending을 보존하고 포팅한 정확한 Git 후보와 독립 수치/응답 검산을 확인한 뒤 운영에 채택한다.

서버 UTC · 원자료/화면 Asia/Seoul. 실제 요금제와 포함량은 비공개 운영 확인 대상이다. BFF/내부 호출·재시도도 사용량에 포함하므로 사전 집계·정확 버전의 결과 재사용·공유 예산을 사용한다. CPU/메모리/포함량 초과를 외부 유료 서버로 우회하지 않는다. 현재 플랫폼 상한은 메모리256MiB, 요청 active CPU2초, Free worker wall clock150초, 유료 worker wall clock400초, 요청 idle timeout150초다. 공식 플랫폼 상한인 worker 수명 Free150초/유료400초, 요청 idle timeout150초, active CPU2초를 구분한다. 실제 운영 요금제에 맞는 worker 최대 수명과 시계 오차 여유보다 긴 동시작업 lease를 사용하고 클라이언트의 응답 대기 만료나 재시도가 아직 실행 중인 서버 계산의 동시 lease를 초기화하지 않도록 검수한다. 이 수치는 애플리케이션 요청량·계산량 한도나 승인된 실제 운영값을 대신하지 않는다.

## 수치와 응답의 호환 검산

환산·누백의 유리수/정확 소수·명시 반올림과 경계값을 Python 기준과 독립 대조한다. TypeScript Number/Math.round만으로 동등성을 가정하지 않는다. JSON 정수 키·불리언/비유한 값·버전/학년도/시험/모집행 결속과 UTC/서울 변환을 함께 비교한다. 대규모 모형 생성은 보존된 오프라인 검수 작업과 발행본으로 구분하고 Edge 요청에 그대로 넣지 않는다.

## 서버 계약과 자료 발행

relay 계약은 이미 확정됐다. 화면 서버/BFF가 정확한 단일 헤더와 실제 사용자 Bearer를 전달하며 분석 API는 현재 이용권·소유권·관리 범위를 다시 검사한다. 공개 liveness와 보호된 readiness를 구분하고 쿠키/CSRF·재귀 DTO·실브라우저·공유 원자적 예산 및 세 보안 gate를 인수한다.

정확 헤더 `X-Jungsi-Relay-Token` · 서버 전용 `JUNGSI_RELAY_TOKEN` · 실제 사용자 Authorization Bearer. relay만으로 사용자 권한이 생기지 않는다. /health/live는 최소 공개 생존 확인, /health/ready는 relay 보호 검수다.

발행 감지 기준은 최신 활성 포인터와 기능별 native 명부의 승인·발행 버전/해시/선택 변경이다. 과거 draft 개수·DB 적재·source-only 승인 시각만으로 live 전환하지 않는다. catalog/환산/누백/판단은 각각 최소 의존성과 검수 범위를 기록하며 미공개·미확인·0·판단 pending을 보존한다.

Edge에서 사용할 private Storage 명부/환경 이름은 서버 담당의 구현 계약과 후보 증거로 확정한다. Python의 로컬 파일 경로·factory 실행 명령을 Edge 배포 명령으로 사용하지 않는다.

## 담당별 후속 단계

| 단계 | 담당 | 상태 | 산출물 |
| --- | --- | --- | --- |
| DEP-01 | 서비스 개발팀·시스템기획팀 | in_progress | 기존22 operation·저장소/native 종류·수치/반올림/시각·권한을 Edge 구현에 대응한 변경 경계와 재사용 검산 목록 |
| DEP-02 | 서비스 개발팀 | in_progress | Edge 명시 구성·relay/실사용자 권한·private Storage 명부·DB 포트·안전한 health 및 정밀 계산의 단계적 호환 구현 |
| DEP-03 | 데이터팀·서비스 개발팀·시스템기획팀 | in_progress | 기존 검수/변환 캐시를 재사용한 기능별 최소 native 후보·독립 검산·승인·불변 발행·명시 선택 |
| DEP-04 | 화면 담당 | planned | 허용된 화면 제공 방식·BFF relay/세션/CSRF·발행 감지와 기대값·실브라우저 검수 |
| DEP-05 | 서버 담당·시스템기획팀 | in_progress | 현재 Supabase 요금제/포함량/Spend Cap 확인, 실제 Auth/DB/Storage/공유 예산/Edge 후보 배포와 세 보안 gate 인수 |

## 화면 담당에게 전달할 작업

화면 제공 범위 comparison_received_corrections_required_operating_host_unselected · Drive Apps Script 후보 user_approved_for_feasibility_review_only. 기존 외부 preview와 파일은 이력으로 보존한다. 새 플랫폼으로 채택하지 않는다.

- 최신 develop의 공통 명세를 자기 브랜치에 정상 merge하고 화면 변경을 보존해 생성 문서와 정확 HEAD CI를 갱신한다.
- relay는 예고가 아니라 X-Jungsi-Relay-Token 확정 계약이다. 서버 전용 비밀은 브라우저에 넣지 않고 사용자 Bearer·세션/CSRF·현재 권한을 함께 검수한다.
- 발행 감지의 과거 draft 개수 기준선을 최신 native 명부의 승인·발행 버전/해시와 기능별 기대값으로 교체한다.
- API 기본 주소·공개 Auth 설정·비공개 relay 전달·native 기대값은 같은 승인 후보에서 받는다. 주소를 임의로 만들거나 source-only 응답으로 live 전환하지 않는다.
- Google Drive Apps Script 웹앱은 검토 후보 포함이 승인됐다. 기존 Next.js/쿠키 세션·사용자 JWT·BFF/CSRF·relay·HTTP 계약·호출 제한의 호환성을 먼저 검토하고 실제 배포는 별도 결정한다.
- 실제 브라우저 HTML/JS/JSON/source map/저장소·401/403/503·성공 점수와 판단 pending·서울 시각 표시를 같은 후보로 검수한다.
- DEP-04 비교의 사실 정정과 FE-SEC03 live 송신 증거를 반영한다. Supabase Edge의 API 구현 후보와 현행 Next.js 화면 서빙은 별도 문제며 기본 도메인 HTML 제한/추가 비용/인증·서버 중계 인수를 확인한다.
- 최종 Secrets는 화면 담당 Owner/Administrator가 등록한다. 기획/개발은 자리표시 없는 설정·기존 성적 전환/보존·006a 적용과 권한 회수 복귀 SQL·객체 closure·정확 소스/해시·적용 순서를 먼저 준비한다. 새 코드와 구형 설정을 분리 선배포하지 않는다. 관리자 정정 POST 화면은 fresh active admin aal2·ticket_ref·expected_version·멱등키 계약을 지키며 별도 구현/인수 상태를 기록한다.



## 화면 제공 방식 비교 회신의 검토

현재 Next.js 화면을 Apps Script로 그대로 이전하는 안은 미채택이다. 내부 보조 도구의 후보 검토는 유지하며 운영 화면/정적 서빙/로그인·relay 비용/호환성은 별도 인수한다.

| 항목 | 확인·정정 기준 |
| --- | --- |
| API 방법 | 현재 공통22 API는 GET12/POST9/PUT1이며 DELETE0이다. Apps Script 웹앱의 inbound doGet/doPost 제약과 UrlFetchApp outbound GET/DELETE/PATCH/POST/PUT 능력을 구분한다. |
| HTTP 상태/헤더 | TextOutput/HtmlOutput의 사용자 정의 status·Retry-After 전달 수단이 없다는 제약을 적는다. 플랫폼 모든 응답이 200이라는 보장은 아니다. 본문에 상태를 감싸는 방식은 실제 HTTP 상태/헤더 계약을 대체하지 않는다. |
| 실행량 | Google 공식 제한은 실행당6분, 동시 실행 사용자당30/스크립트당1000이다. 실행자/방문자 모드에 따라 소진 주체를 확인해야 한다. URLFetch 일일 쿼터는 consumer2만/Workspace10만이며 계정/공유 사용량/정책 검수와 구분한다. |
| 인증/중계 | script.google.com으로 기존 에듀터치 same-origin 쿠키가 자동 공유된다고 가정하지 않는다. 별도 인증/CSRF/세션 갱신/서버 relay 설계가 필요하며 JWT/비밀을 URL·HTML·브라우저에 노출하는 방식은 채택하지 않는다. 현재 화면 relay 송신 완료 주장은 정확한 소스/후보로 검수한다. |
| Supabase 화면 서빙 | Supabase Edge는 현재 Python/FastAPI·Next 서버를 그대로 배포하는 호스트가 아니다. 공식 제한상 custom domain 없는 GET text/html은 text/plain으로 재작성된다. Storage 공개 bucket은 웹 앱 인증/BFF/비공개 자료 보호의 대체가 아니며 HTML 서빙/요금제도 별도 확인한다. 무료 기본 Edge/Storage만으로 현행 화면 제공 가능이 확정됐다고 적지 않는다. |
| 비용/보안 | 최종 운영 화면 호스팅은 미선택이다. 기존 Google Drive·Supabase만/추가 비용 없음 정책을 유지하고 유료 custom domain·외부 Worker/새서버를 이번 비교로 자동 승인하지 않는다. 공개 자산과 비공개 catalog/곡선/환산표/비밀을 분리한다. |

실제 호환성/브라우저/비용 NOT_RUN. 비교 수신은 배포·화면교체 승인이 아니다.

- [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [Google Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Google Apps Script UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)
- [Google Apps Script TextOutput](https://developers.google.com/apps-script/reference/content/text-output)
- [Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase Storage serving assets](https://supabase.com/docs/guides/storage/serving/downloads)

## 초기 준비 검증 이력

당시 Edge 구현 NOT_RUN · 당시 실제 Auth/DB/Storage/Edge/BFF/브라우저/배포 NOT_RUN · 당시 실제 비용/요금제 NOT_RUN. 현재 부분 배포·검수는 live_execution 원장을 따른다. 기존 Python 합성 인수는 Edge 포팅/실운영 인수를 대신하지 않는다.



## 실제 인증·22 API·배포 진행

사용자가 실제 인증 연결·JWT/OTP 검수·22개 API 이식·운영 배포를 요청했다. 기존 Google Drive와 Supabase만 사용하며 코드 통합·합성 검산·실 연결·배포·공개 인수를 각각 기록한다.

Python990·Deno116·독립 oracle993 및 세션/관리 권한 foundation. 실제 Auth·업무22 API·TOTP·공개 배포 인수를 대신하지 않는다.

| 검수 단계 | 상태 |
| --- | --- |
| 실제 Auth·본인 profiles 연결 — 화면팀 기능 통과 보고 / 반례 검수 진행 | IN_PROGRESS |
| 실 JWT·만료·변조·타인 소유권 반례 | IN_PROGRESS |
| 계정 주인의 /admin TOTP 등록·aal2 관리 검수 | IN_PROGRESS |
| 기존 22 API의 업무 처리·DTO·정밀 계산 이식 | IN_PROGRESS |
| 보고서·초안·멱등·버전 충돌 실제 트랜잭션 | IN_PROGRESS |
| 기존 요금제·포함량·Spend Cap·승인된 원자적 예산 | IN_PROGRESS |
| 기존 프로젝트의 동일 후보 Edge 배포·실 HTTP 인수 | IN_PROGRESS |
| 허용 플랫폼 BFF·세션/CSRF·브라우저 비노출 | IN_PROGRESS |
| 응답·직접 권한·수집 방지 세 보안 gate | NOT_RUN |

| operation | 계약 경로 | Edge 코드 | 실 연결 검수 | 배포 인수 |
| --- | --- | --- | --- | --- |
| history.search | GET /api/v1/admission-history | PORTED | NOT_RUN | NOT_RUN |
| recruitment.read | GET /api/v1/offerings/{offering_id}/recruitment | PORTED | NOT_RUN | NOT_RUN |
| score-profile.create | POST /api/v1/score-profiles | PORTED | NOT_RUN | NOT_RUN |
| overall.analyze | POST /api/v1/overall-reports | PORTED | NOT_RUN | NOT_RUN |
| report.read | GET /api/v1/reports/{report_id} | PORTED | NOT_RUN | NOT_RUN |
| offerings.search | GET /api/v1/offerings/search | PORTED | NOT_RUN | NOT_RUN |
| offering.read | GET /api/v1/offerings/{offering_id} | PORTED | NOT_RUN | NOT_RUN |
| university.analyze | POST /api/v1/reports/{report_id}/university-results | PORTED | NOT_RUN | NOT_RUN |
| candidates.build | POST /api/v1/reports/{report_id}/candidates | PORTED | NOT_RUN | NOT_RUN |
| shortlist.update | PUT /api/v1/reports/{report_id}/shortlist/{offering_id} | PORTED | NOT_RUN | NOT_RUN |
| report.export | GET /api/v1/reports/{report_id}/print | PORTED | NOT_RUN | NOT_RUN |
| statistics.read | GET /api/v1/reports/{report_id}/offerings/{offering_id}/live-statistics | PORTED | NOT_RUN | NOT_RUN |
| session.read | GET /api/v1/me | PORTED | NOT_RUN | NOT_RUN |
| forecast.capabilities | GET /api/v1/forecast-capabilities | PORTED | NOT_RUN | NOT_RUN |
| forecast.list | GET /api/v1/forecast-drafts | PORTED | NOT_RUN | NOT_RUN |
| forecast.create | POST /api/v1/offerings/{offering_id}/forecast-drafts | PORTED | NOT_RUN | NOT_RUN |
| forecast.read | GET /api/v1/forecast-drafts/{draft_id} | PORTED | NOT_RUN | NOT_RUN |
| forecast.adjust | POST /api/v1/forecast-drafts/{draft_id}/adjustments | PORTED | NOT_RUN | NOT_RUN |
| forecast.validate | POST /api/v1/forecast-drafts/{draft_id}/validations | PORTED | NOT_RUN | NOT_RUN |
| forecast.approve | POST /api/v1/forecast-drafts/{draft_id}/approvals | PORTED | NOT_RUN | NOT_RUN |
| forecast.publish | POST /api/v1/forecast-drafts/{draft_id}/publications | PORTED | NOT_RUN | NOT_RUN |
| forecast.published.read | GET /api/v1/offerings/{offering_id}/forecast | PORTED | NOT_RUN | NOT_RUN |

계정 주인이 /admin에서 휴대폰 인증 앱으로 등록·입력한다. 검수 계정 식별자·비밀번호·JWT·QR·OTP 비밀키는 공개 명세에 저장하지 않는다. 2026-10-14 계정 주인의 Codex 브라우저 직접 로그인·MFA 완료 회신과 관리자 화면 진입을 수령했다. 입력 대기는 해소됐으며 서버의 실제 getUser·aal2·본인 상태·학교 권한 검수는 계속 진행한다. 이 회신이나 화면 진입만으로 실제 JWT/TOTP 검수 PASS를 기록하지 않는다.

승인된 비공개 운영 한도와 기존 요금제 근거가 필요하다. null·미확정 값을 무제한 또는 실제 0으로 치환하지 않는다. 애플리케이션 내부 quota만으로 플랫폼 추가 과금을 방지했다고 판정하지 않는다. 기존 조직의 요금제·모든 프로젝트 사용량·포함량과 해당되는 Spend Cap 범위를 확인한다. Free는 추가 과금하지 않으며 Spend Cap은 Pro에서 적용 가능한 일부 사용량만 대상으로 한다. 실패한 Edge 호출도 invocation 사용량에 포함되므로 신규 요금제·유료 항목·초과 과금 허용을 자동 선택하지 않는다. 공식 플랫폼 상한인 worker 수명 Free150초/유료400초, 요청 idle timeout150초, active CPU2초를 구분한다. 실제 운영 요금제에 맞는 worker 최대 수명과 시계 오차 여유보다 긴 동시작업 lease를 사용하고 클라이언트의 응답 대기 만료나 재시도가 아직 실행 중인 서버 계산의 동시 lease를 초기화하지 않도록 검수한다. 이 수치는 애플리케이션 요청량·계산량 한도나 승인된 실제 운영값을 대신하지 않는다.

2026-10-26: current frontend deployment follows effective_current_frontend_deployment_ref; scoped actual input transition and Root browser recovery follow effective_current_score_transition_ref. effective_current_runtime_ref remains the exact unchanged Source118 backend installation. Earlier transition_pending observations are pre-adoption history; full native/security acceptance remains separate. 2026-10-24 current installed scoped evidence follows effective_current_runtime_ref (Source118/Owner v19/seq2). Earlier v17 and frozen current_* records are retained history. Current P1 publication, qualified-field browser evidence, old-report read, input-right transition, new 2027 metadata and all22/security acceptance are distinct. 2026-10-22 현재 설치와 기존 전국 P1 전환은 effective_current_runtime_ref의 날짜별 Owner 영수증을 따른다. 아래 source032 등 날짜별 상태와 동결 current_* 객체는 당시의 보존된 회귀 기준이며 현재 v17을 덮어쓰는 기준이 아니다. 새 통계 seq2는 기존 전환 완료와 분리하며 미발행이다. 동일 operation의 구현은 등록된 Edge 파일·SHA에 연결한다. 실제 검수·배포 PASS는 해당 후보 커밋과 비공개 영수증 SHA 및 검사 범위에 결속한다. 검증한 공통 명세에서 기획·라우팅·3티어·배포 문서를 함께 생성한다. 다음 에이전트는 최신 근거 이후의 Git 차이부터 확인한다. 최초 synthetic 화면 검수는 과거 이력이다. 현재 정상 /jeongsi의 Worker relay·live·실제 Bearer 세션 기능 통과는 2026-10-16 화면팀 보고로 수용한다. 보고된 부분 관측과 업무22 API·소유권/CSRF·배포 인수는 구분한다. 새 오류 분류를 포함한 고정 cb500f7/동일 tree develop1ba331c 번들을 기존 함수에 실제 배포하고 editor 전체 재조회를 확인했다. 새 코드 준비 health·거절 경계는 별도 실제 영수증으로 확인했다. 같은 BFF의 안전 오류 코드 표시만 부분 관측했으며 실제 HTTP·관리 aal2·업무 인수는 미완료다. P2 단일 제출 실패는 current_P2_attempt로 구분하고 성공으로 세지 않는다. 배포 영수증의 소스·tree·번들 해시를 결속하며 소스 배포를 검색 활성화나 operation별 배포 인수로 승격하지 않는다. 정상 Edge 소스 시험은 선택된 Git 스냅샷에서 operation의 등록 소스·해시 범위를 따로 기록한다. CODE_REGISTERED/PARTIAL_CODE_REGISTERED는 실제 JWT·DB 업무·Edge 배포 인수가 아니다. native_acceptance=NOT_VERIFIED_BY_SOURCE_SUITE와 해당 시험의 production_ready=false·운영 쓰기0을 유지한다. 후속 화면팀 P2 회신의 이전 Root 시도·새 Worker 배포 보고·별도 가상1건 실패를 frontend_P2_reply와 current_P2_attempt로 분리한다. source SHA 미제공·미푸시 Worker를 remote59f에 결속하지 않고 실패 HTTP·DB쓰기를 추정하지 않는다. 후속 관리자 UI 진입은 JWT·aal2 추적 인수와 분리한다. 최신 설치는 current_deployment의 ed978 실제 영수증을 따르며 cb500 actual_editor_deployment는 당시 이력이다. current_P2_attempt는 새 실제 시도이고 회신 당시 두 실패는 P2_attempt_history에서 원래 배포·unknown 상태로 보존한다. 소스·준비상태 PASS, 제한된 로그 상관관계, 범위조회 snapshot, UI 업무 인수는 분리한다. 2026-10-21 재개는 owner_registration_20261021을 따른다. 기본 배포 대상은 기존 Supabase이며 P1 조정 메타데이터 DO만 한정 예외다. 최종 Secrets는 화면 담당 Owner가 등록한다. 정확 코드/정책/바인딩/객체 closure·기존 성적 보존 전환·006a 복귀 준비 후 같은 전환 구간에 적용하며, 실제 JWT/OTP/BFF·비용 검수 전 완료로 표시하지 않는다.

### 서버 런타임 조립과 입력 계약

현재 운영 설치는 effective_current_runtime_ref의 Owner v17·고정 combined20 번들 보고를 따른다. 기존 전국 P1 발행·준비·관리자 정문과 P2/P3/P4 읽기 화면 회귀를 접수했고 Root는 현재 head와 대상 P1 표를 다시 읽었다. 새 통계 seq2 발행·새 화면 운영 검수, 전체22 native와 보안 gate는 별도다. source032 등 이전 조립·관측 결과는 historical_status_text_before_owner_20261022와 동결 원장에 보존한다.

| 소스 진입점 | 경로 | SHA-256 |
| --- | --- | --- |
| native_entry | supabase/functions/jungsi-api/index.ts | ef68f227b04705681d2f269babad5688bd3558dab33e3a889574b1b09b6321b2 |
| composition | supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts | b757ad470d5a3d9cb44b8ad08203ca7d42359dd2657d9d91581674c639e6f557 |

| 서버 설정 이름 | 허용된 기존 이름 | 현재 상태 | 입력의 의미 |
| --- | --- | --- | --- |
| SUPABASE_URL | 없음 | 기존프로젝트결속·등록후readiness200확인; 실사용자Auth별도 | 동일 Supabase 프로젝트의 HTTPS 원점 |
| SUPABASE_PUBLISHABLE_KEY | JUNGSI_DISPLAY_PUBLISHABLE_KEY | health/거절경로프로젝트공개키사용확인; 실사용자AuthNOT_RUN | getUser와 동일 Bearer의 본인 profiles RLS 조회용 공개 키 |
| DATABASE_URL | JUNGSI_DISPLAY_DATABASE_URL | 기존앱역할/TLS/RLS·005검수재사용·등록후schema조회readiness200; 업무트랜잭션별도 | 동일 프로젝트 jungsi_backend_app 전용 DSN |
| JUNGSI_DATABASE_CA | JUNGSI_DISPLAY_DATABASE_CA | 기존정확CA/TLS검수재사용·같은설정readiness200; 설정변경시해당범위재검수 | PEM 본문. 로컬 파일 경로가 아니며 framing 검사는 인증서 유효성 검증을 대신하지 않는다. |
| JUNGSI_RELAY_TOKEN | 없음 | 현재함수기능수용200·불일치403; Worker등록/BFF실사용자연결대기 | BFF와 Edge 사이의 서버 전용 relay 헤더 값 |
| SUPABASE_SECRET_KEY | JUNGSI_DISPLAY_STORAGE_SECRET | 기존nativeStorage검수재사용·등록후선택그래프200; 실사용자업무별도 | private Storage 읽기 전용 서버 경계에서만 사용 |
| JUNGSI_SUPABASE_STORAGE_BUCKET | 없음 | Owner등록보고·승인파일digest5/5대조수용; 실제readiness200; Dashboard독립재조회NOT_RUN | 공개가 아닌 버킷. 현재 metadata의 private·native 정수 상한을 확인 |
| JUNGSI_SUPABASE_STORAGE_PREFIX | 없음 | Owner등록보고·승인파일digest5/5대조수용; 실제readiness200; Dashboard독립재조회NOT_RUN | 승인된 control·artifact 객체가 속하는 prefix |
| JUNGSI_API_BINDING_JSON | 없음 | Owner등록보고·승인파일digest5/5대조수용; 실제readiness200; Dashboard독립재조회NOT_RUN | jungsi.edge-api-binding/v1: 승인 목적·scope·현재 head와 registry/selection/usage_policy 참조·명시 한도 |
| JUNGSI_API_BINDING_SHA256 | 없음 | Owner등록보고·승인파일digest5/5대조수용; 실제readiness200; Dashboard독립재조회NOT_RUN | 위 JSON 원본 UTF-8 바이트의 SHA-256 |
| JUNGSI_API_BINDING_MAX_BYTES | 없음 | Owner등록보고·승인파일digest5/5대조수용; 실제readiness200; Dashboard독립재조회NOT_RUN | 위 JSON의 양의 정수 바이트 상한. 기본값 없음 |

정식 설정 이름이 존재하면 빈 값·잘못된 값도 우선하며 오류를 유지한다. 정식 이름이 아예 없을 때만 위 네 기존 DISPLAY 별칭을 허용한다. 기본 privileged SUPABASE_DB_URL·migration DSN·service-role/anon 예전 키·복수 key 배열로 fallback하지 않는다. bucket/prefix·binding/head·예산에는 별칭이나 기본값을 적용하지 않으며 기존 display descriptor를 engine 승인으로 사용하지 않는다. 같은 프로젝트·실제 jungsi_backend_app·TLS·UTC/RLS guard를 유지한다.

서버 승인 binding의 operation·artifact(kind/key) 집합을 실제 selection과 먼저 대조한다. private registry의 선택 항목은 approved·engine_approved=true·production_allowed=true·archive_only=false를 모두 확인한 뒤 artifact를 읽는다. control 객체를 engine 승인 자료로 가장하지 않는다. 선택한 그래프의 원문 버전·연결을 preflight하고 선택하지 않은 모형·대학별 누적·분석 자료는 기존 보류 상태를 유지한다. 공식 과목 전용 선택에서는 후보조회 미사용 eligible_offering_count의 누락과 null을 보존한다. candidates.build가 승인된 경우에는 native 정수와 실제 선택 catalog의 대상 수 일치를 계속 요구한다. 과목 성적표·국수탐2 합을 catalog·전체모형 없이 계산하고 미승인 전체 위치는 pending/null로 반환하는 합성 검사를 추가했다. 같은 소스·라우팅·선언/의존성 색인을 결속하며 실제 서비스 승인과 배포 인수는 별도다.

control·선택 artifact는 원본 바이트 해시를 검증하고 native JSON의 정수·소수·유리수·조건·필드 존재 여부를 보존한다. 기존 정밀 엔진과 텍스트 SQL JSON·마이크로초 UTC 시각을 연결한다. Number 변환이나 새 모형 생성으로 대체하지 않는다. 기존 Python–Edge 독립 oracle 검산과 실제 자료·DB·엔진 실행 검수는 별개다.

동일 22 API/회원·소유권/학교 범위를 유지한다. relay → 실제 getUser의 동일 Bearer → 같은 Bearer 본인 profiles(role,status) → 현재 pass → 회원·소유권·관리 조건 → 입력 검증 → 해당 13 operation의 공유 예산 예약 → 업무·공개 DTO·최종 만료 확인 순서를 따른다. session.read는 데이터 binding이나 요청 예산을 요구하지 않으며 기존 검증된 active/admin/aal2 예외와 실제 pass 만료 우선을 유지한다.

CA 또는 필수 서버 설정이 없으면 pool 생성이나 자료 조회 전에 503이다. 데이터 binding·원본 SHA·바이트 상한·명시 한도·현재 head가 없거나 목적/승인/scope/만료가 다르면 데이터 경로는 503으로 닫힌다. /health/live는 최소 생존 확인이고 relay 보호 /health/ready는 기존 005 schema·pass metadata·선택 그래프 검사를 요구한다. 새 grant·RLS 변경·003 재적용·005 실행을 자동 수행하지 않는다.

binding의 sources는 private Storage object_key·정확한 bytes·SHA를 갖는다. 현재 head는 jungsi.native-selection-head/v1의 approved/purpose/project/scope/registry/selection/usage_policy/approval/expiry를 매번 확인하며 요청별 읽기 횟수·실제 바이트 예산을 공유한다. head가 바뀌면 기존 binding과 warm 결과를 거절하고 새 승인 binding이 필요하다. jungsi.runtime-usage-policy/v1은 5개 차원·작업별 비용·허용 시험/pack·최종 결과 바이트 및 worker 수명보다 긴 lease를 명시한다. 운영 한도의 기본값·무제한·합성값 자동 승격은 없다. binding JSON의 정상 pretty 표기·끝 LF/CRLF를 포함한 원본 UTF-8 바이트를 trim 없이 그대로 크기·SHA·native 파서에 전달한다. 빈/공백뿐인 값과 원본 해시가 다른 바이트는 거절한다. 짧은 식별자·URL·토큰의 앞뒤 공백 거절은 유지한다.

기존 C140·공식 시험·2027 규칙 등의 정리·발행 근거를 먼저 재사용한다. Python용 로컬 registry/selection 경로를 Edge Storage 승인 포인터로 자동 해석하지 않는다. 새 업로드·재수집 없이 기존 목적·scope·현재 hash·승인·expiry가 이 runtime 계약에 맞는지 확인하고, 미보유 포인터와 재검수가 필요한 값만 보완한다. 실제 원자료·CA·비밀값·승인 한도·정본 등록부는 Git에 넣지 않는다.

기존 source suite에 새 설정/현재 head/공유 읽기/예산 planner/조립/선택 그래프 합성검사 48건을 추가한다. 실제 entry는 고정 postgres@3.4.5 lock으로 별도 타입 검사하며 serve를 시작하지 않는다. 동일 후보 전체 훅·CI·oracle 통과 후에도 실제 JWT/TOTP·네이티브 업무 트랜잭션·요금제 근거·Edge/BFF/브라우저 인수가 없으면 운영 PASS를 기록하지 않는다. 과목 전용 누락/null 보존·후보 활성 시 정수 필수·모형 없는 과목 계산/보류·범위 밖 후보 조기 차단의 합성 검사 5건을 추가한다. 저장소 요청 상한은 최신성 확인과 예산 예약/정산을 포함한 실제 경로 측정에 맞춰 비공개 승인 설정에서 결속하고, 부족한 상한을 자동 확대하거나 확인을 생략하지 않는다.

| 실제 연결에 필요한 항목 | 대기 조건 |
| --- | --- |
| 현재 CA·프로젝트·앱 역할 — 기술 검수 완료 | 공식CA 체인/호스트와 기존 앱DSN·현재 프로젝트 결속·UTC/RLS의 기존 정확 영수증을 재사용한다. 다른 설정/실제 Edge 값이 선택되면 그 범위만 다시 검수한다. |
| 네이티브 DB005 — 실제 적용 완료 | 정확Git005의3개 신규 예산 테이블·자료형/제약/인덱스·RLS·최소권한과 기존 객체 메타데이터 보존을 확인했다. 같은 API 드라이버 read-only 재조회도 통과했다. 기존003/005를 다시 적용하지 않고 실제 원자 예산·보고서·소유권·멱등·버전 충돌 검수는 별도로 수행한다. |
| 공식 과목 시험팩 — 목적 승인·비공개 발행 완료 | 현재 decoder와 독립 산술 근거를 재사용한다. 승인 범위는 과목 성적표와 네 과목 표준점수 합이며, 불변 Storage 발행·정확 재조회와 native 선택 그래프 검수를 통과했다. 전체/대학 누백·연도 보정·판단·발행 승인은 승계하지 않는다. |
| 현재 전국 P1 — Owner 전환 완료 회신 / 새 통계 자료판 준비 | 기존 approved head와 대상 화면을 실제 재조회했다. 다른 발표 기준과 가야대 두 관측은 별도 seq2 후보·독립 검수·불변 발행을 진행한다. 누백 모형의 승인/발행을 입결 표시 완료로 승계하지 않는다. |
| 기존 정책·자료 연결 — 정확 지문 재사용 | Owner의 현재 코드·설정 지문을 기존 비공개 준비판과 대조한다. 새 적용 직전 설치 버전/지문과 current source/P1 head를 다시 결속하고, 달라지면 중단한다. |
| 공유예산 — 기존격리SQL·실제만료검수재사용 / 실사용자업무별도 | 기존승인된과목전용정책·독립pool·동시성·재시작·멱등정산·상한거절과승인lease실시간만료의정확영수증을재사용한다. 검수행과이전실패본은보존한다. 등록후readiness는정책/현재head/만료검사통과이며실사용자의예약·정산·운영3gate인수는별도다. ceiling/GLOBAL을조직금액상한으로표시하지않고성공namespace를재실행하지않는다. |
| 기존 설정5개 — Owner 등록 보고 접수 | Owner가 기존 패킷의 다섯 지문 일치를 보고했다. 새 통계 판의 설정은 별도로 측정·검수해 같은 전환 구간에 적용한다. Root의 Secrets 관리 권한을 새로 부여하거나 값·키를 공개하지 않는다. |
| 현재 BFF — 기존 P1 운영 및 세 화면 읽기 회귀 접수 | Root가 대상 P1을 새로 읽었고 Owner가 P2/P3/P4 화면 열림을 보고했다. 실제 새 저장/소유권/CSRF/만료/전체 보안 인수는 해당 영수증 없이 완료로 표시하지 않는다. |

### 위치 그래프의 기준

| 표시 기준 | 산식 | 적용 범위 |
| --- | --- | --- |
| 전체 위치 — 탐구 2과목 합 | K + M + T1 + T2 | 현행 overall_analysis_contract 및 StandardScores.total 정의 |
| 국어+수학+탐구 — 2과목 평균 | K + M + (T1 + T2) / 2 | 화면 조합별 제안 필드; 전체 합과 다른 탐구 비중 |

같은 입력·산식·시험/자료 버전·비교 모집단·승인 모형·동점 기준의 위치는 같은 서버 계산 경로/결과를 사용한다. 합과 평균은 다른 정의이므로 수치 차이만으로 어느 쪽이 정확하다고 판정하지 않는다. 전체 합 정의를 조합 평균으로 임의 변경하지 않는다.

명시 합성 모드의 위치 그래프마다 화면 확인용 합성임을 표시한다. synthetic-report의 임의 곡선은 검증한 입시 예측/누백으로 표시하거나 실서비스 정확도 근거로 사용하지 않는다.

live는 승인/발행/선택된 서버 값만 표시한다. 조합별 서버 계약이 미채택이거나 승인 분포가 없으면 자료 대기다. 화면에서 임의 곡선을 만들거나 전체 누백으로 다른 조합을 대체하지 않는다.

화면 담당은 전체의 탐구 2과목 합과 조합의 2과목 평균을 각 그래프 안에서 명시하고 합성 모드 안내를 붙인다. 프레젠테이션 브랜치에서 최신 develop을 가져와 변경·검수하고 서버의 승인/보류 상태를 유지한다.

### API 연결 전 선행 준비

| 작업 | 담당 | 준비 상태 | 완료 조건 |
| --- | --- | --- | --- |
| PRE-01 현재 정본의 서비스 카탈로그 발행 준비 | 데이터팀 단일 writer / 개발팀 읽기 전용 연결 | IN_PROGRESS | 현재 모집행/입결 포인터와 해시·native 자료형·4개년 근거·PK·전형/군/학년도 범위를 고정하고, 별도 목적 승인을 받은 실행 catalog만 발행 후보로 구성한다. 이전 동결 C는 historical baseline으로 보존한다. |
| PRE-02 실제 대학별 환산 규칙 연결 준비 | 개발팀 / 데이터팀 근거 제공 | IN_PROGRESS | 기존 공식 규칙·변환표와 독립 검산 근거를 현재 decoder에 연결한다. 수집 요강 문구를 실행식으로 자동 승격하지 않으며 시험·적용 학년도·대학/캠퍼스·전형/군·offering/규칙 버전이 정확히 일치해야 한다. |
| PRE-03 전체·대학별 자체 추정 누백의 발행 준비 | 개발팀 / 데이터팀 독립 검수 | IN_PROGRESS | 기존 자체 추정 시범·공식 주변도수·holdout/민감도·가중치·직접 계산 근거를 재사용한다. 시험별 모형과 비교 모집단을 분리하고 source/local 승인·엔진 승인·운영 목적 승인을 구분한다. 한 학교 시범을 전국 발행 완료로 확대하지 않는다. Deno native v2는 점수의 정수 numerator/양수 denominator를 정확 유리수로 읽고 기존 v1과 가중치 의미를 유지한다. 공급자·공개 DTO 합성 검수와 저장 후보의 형식 읽기는 완료했으며 비교 모집단·현재 모집행·최종 후보·운영 승인은 별도다. |
| PRE-04 22 API 실연결 인수 입력·기대 결과 준비 | 기획팀 / 개발팀 / 외부 화면 담당 | PREPARED | 기존22 API의권한·소유권·DTO·입력·안전한재실행·기대결과를고정했다. 새5설정Owner등록보고와readiness200·relay403·무Bearer401통과. Workerrelay등록→preview제한live→계정주인정상로그인의동일Bearer→승인목적별1~4페이지순서로인수하며준비표를실제업무PASS로세지않는다. |

최신 검증 SHA와 비공개 현재 포인터/선택 자료의 해시·범위를 먼저 대조한다. 동일한 005·Storage·예산/실제 만료 검수를 반복하지 않는다. 변경되거나 빠진 연결·자료형·시험/모집단 경계만 추가 검수하고, 데이터팀의 진행 중인 단일 정본 쓰기를 읽기 전용 snapshot으로 고정한다.

session → 과목 전용 본인 profile/report → 별도 승인 catalog → 대학 환산/누백 → 후보·집계 → 권한 있는 관리 흐름 순서다. 해당 자료/기존 역할이 없으면 NOT_RUN 또는 계약상 pending/거절로 남긴다. 계정·JWT·OTP·실제 성적·원규칙·곡선·운영 한도는 Git/공개 인수표에 넣지 않는다. 실제 값을 취급하는 fixture·원문 영수증은 비공개 폴더에 보관한다. BFF 회신의 외부 소스/배포 보고는 bff_reply_intake를 따르며 실제 설정 등록·live 검수로 승격하지 않는다. 등록후현재상태와Workerrelay/제한live선행순서는post_registration_acceptance를따른다. 계정주인의동일BFF인증을위해토큰을별도수집하지않는다.

인수 영수증 필드: case_id, operation_id, candidate_commit, deployed_commit, BFF_commit, artifact_snapshot_sha256, policy_revision, request_class, expected, observed, result, receipt_sha256. 아래 표는 준비 조건이며 실제 native/deployment 증거가 아니다.

| operation / 계약 경로 | 실행 전 필요한 조건 | 인수 시 기대 결과 |
| --- | --- | --- |
| history.search / GET /api/v1/admission-history | 실 사용자·현재 정본의 범위 승인 catalog·명시 조회 예산 | 발행된 현재 입결·출처·학년도·전형/군 정의와 cursor 경계; 이번 판 미포함과 자료 없음 구분 |
| recruitment.read / GET /api/v1/offerings/{offering_id}/recruitment | 실 사용자·현재 정본의 범위 승인 catalog·명시 조회 예산 | 정확한 offering/학년도·전형/군 결속과 원문 미공개·조건부 이월 상태 보존 |
| score-profile.create / POST /api/v1/score-profiles | 실 사용자·같은 시험 승인 exam pack·과목 전용 예산·안전한 가상 입력 | 같은 시험의 유효 입력을 본인 확인 프로필로 저장; 재시도와 충돌·미응시 구분 |
| overall.analyze / POST /api/v1/overall-reports | 실 사용자·같은 시험 승인 exam pack·과목 전용 예산·안전한 가상 입력 | 승인 과목/총점 자료 범위에 따른 ready 또는 total_model_missing; 점수 저장과 판단 보류 독립 |
| report.read / GET /api/v1/reports/{report_id} | 실 사용자·본인 confirmed profile/report·revision·명시 예산 | 본인 report/revision의 허용 DTO만 재조회; 생성 당시 성공 점수와 pending 보존 |
| offerings.search / GET /api/v1/offerings/search | 실 사용자·현재 정본의 범위 승인 catalog·명시 조회 예산 | 정본 offering·필터·페이지 결속; 제한된 조회 범위와 잔여 cursor를 정직하게 표시 |
| offering.read / GET /api/v1/offerings/{offering_id} | 실 사용자·현재 정본의 범위 승인 catalog·명시 조회 예산 | 정확한 학년도·대학/캠퍼스·전형/군·PK의 공개 상세; 누락을 실제 0으로 치환하지 않음 |
| university.analyze / POST /api/v1/reports/{report_id}/university-results | paid 본인 report·같은 시험 실행 규칙/변환표·모집행·독립 누백 승인 | 승인된 실제 규칙의 정확 환산과 동점 포함/제외 누백; conversion·percentile·assessment의 독립 상태 |
| candidates.build / POST /api/v1/reports/{report_id}/candidates | paid 본인 report·전체 검색 catalog·승인 분석 자료·후보 수 예산 | 승인 전체 검색 catalog와 명시 예산·판단 자료 범위; 한 학교 시범을 전체 후보로 표시하지 않음 |
| shortlist.update / PUT /api/v1/reports/{report_id}/shortlist/{offering_id} | 실 사용자·본인 confirmed profile/report·revision·명시 예산 | 본인 report/revision·허용 offering을 대상으로 멱등 변경과 stale revision 충돌 구분 |
| report.export / GET /api/v1/reports/{report_id}/print | 실 사용자·본인 confirmed profile/report·revision·명시 예산 | 같은 본인 report/revision의 인쇄 DTO; 내부 규칙·전체 분포·비밀 미전달 |
| statistics.read / GET /api/v1/reports/{report_id}/offerings/{offering_id}/live-statistics | paid 본인 report·승인 집계와 최소집단 정책·명시 예산 | 정확한 report/offering·승인 집계 범위와 최소집단 조건; 개인·비공개 관측 비노출 |
| session.read / GET /api/v1/me | BFF 동일 사용자·실 getUser/본인 profiles·현재 pass | 동일 Bearer의 getUser·본인 profiles·현재 pass; active/admin/aal2 예외와 실제 만료 우선 |
| forecast.capabilities / GET /api/v1/forecast-capabilities | 실제 staff 역할·학교 scope·필요 aal2; 새 권한 발급 없음 | 실제 역할·aal2·학교 scope에 맞는 capability만 반환; staff와 paid를 구분 |
| forecast.list / GET /api/v1/forecast-drafts | 실제 staff 역할·학교 scope·필요 aal2; 새 권한 발급 없음 | 현재 actor의 허용 학교/상태 범위만 조회하며 타인·범위 밖 비노출 |
| forecast.create / POST /api/v1/offerings/{offering_id}/forecast-drafts | 기존 editor·학교 scope·고정 context·검수 전용 초안 namespace | 기존 editor/학교 scope의 새 초안과 안전한 멱등 재실행; 현재 발표 자료와 분리 |
| forecast.read / GET /api/v1/forecast-drafts/{draft_id} | 실제 staff 역할·학교 scope·필요 aal2; 새 권한 발급 없음 | 역할/학교 scope에 맞는 정확 draft/revision 조회; 허용 영수증 보존 |
| forecast.adjust / POST /api/v1/forecast-drafts/{draft_id}/adjustments | 기존 editor·학교 scope·고정 context·검수 전용 초안 namespace | editor·예상 revision·입력/정책/context 결속; 변경 이력 보존과 stale 충돌 |
| forecast.validate / POST /api/v1/forecast-drafts/{draft_id}/validations | 기존 editor·학교 scope·고정 context·검수 전용 초안 namespace | 같은 revision·입력/정책/context의 검증 영수증; 자료 부재/오류를 승인으로 처리하지 않음 |
| forecast.approve / POST /api/v1/forecast-drafts/{draft_id}/approvals | 기존 독립 approver·aal2·동일 revision/context·editor와 다른 actor | 독립 approver·aal2·학교 scope·검증 revision; 자기승인과 오래된 검증 거절 |
| forecast.publish / POST /api/v1/forecast-drafts/{draft_id}/publications | 기존 독립 approver·aal2·동일 revision/context·editor와 다른 actor | 같은 승인/revision·유효 context의 발행; 초안과 published_at/유효 발표본 구분 |
| forecast.published.read / GET /api/v1/offerings/{offering_id}/forecast | 실 사용자·정확한 모집행의 유효 승인 발행본·명시 조회 예산 | 승인된 해당 학년도/학교/모집행의 유효 발표본만 반환; 초안은 비노출 |

### 최초 화면 BFF 회신과 등록 이력

최초 synthetic 회신의 소스 검토와 등록 이력이다. 현재 실연결 상태는 아래 post_live_receipt의 2026-10-16 화면팀 보고를 기준으로 읽는다. 기존 증거와 NOT_RUN은 그 당시 범위로 보존한다.

| 소스/외부 보고 | 참조 |
| --- | --- |
| 화면 소스 | 72aa2de18944d0b044d31479d48a345f7b1e574e |
| 화면팀 보고 Worker / 배포 시각 | 6b532d27-b7c2-4e89-9243-91e6b5572978 / 2026-10-15T08:03:52Z |
| 실제 Worker 독립 관측 | NOT_RUN |
| 최초 회신 당시 모드 / 새 API 호출 | synthetic / 0 |
| Owner 설정 등록 | OWNER_REPORTED_REGISTERED |

| 연결 항목 | 소스에서 대조한 계약 |
| --- | --- |
| 정상 진입 / API base | /jeongsi / JUNGSI_API_URL 끝은 /functions/v1/jungsi-api |
| 경로 접미 / ingress 제거 | /api/v1 / /jungsi-api |
| 사용자 / 서버 헤더 | Authorization: Bearer / X-Jungsi-Relay-Token |
| 캐시 / 쓰기 멱등 | no-store / Idempotency-Key |

| 남은 인수 | 담당 | 상태 | 필요 증거 |
| --- | --- | --- | --- |
| OWNER_REGISTRATION | 기존 Supabase Owner/Administrator | OWNER_REPORTED_MATCHED | Owner의등록시각·대상·원파일bytes/SHA·5digest대조보고를수용했다. Dashboard독립재측정은NOT_RUN이며Worker설정은별도다. |
| EDGE_READY_AUTH | 서비스팀 / 계정 주인 | IN_PROGRESS | 실제readiness200·relay403·무Bearer401통과. 계정주인의정상로그인/OTP·같은Bearer getUser/본인profiles·active/aal2·현재pass·소유권반례는제한BFF live후검수한다. |
| API22_SCOPED | 서비스팀 / 승인 자료 담당 | NOT_RUN | 기존22 API 계획의 session→과목 전용 profile/report→별도 승인 catalog/규칙/곡선→관리 순서를 따른다. 미승인 자료는 pending/NOT_RUN이며 소스를 실연결 PASS로 바꾸지 않는다. |
| BFF_LIVE_BROWSER | 외부 화면팀 / 지정 소유자 | NOT_RUN | 실사용자검수 후 Worker설정이라는 순환대기를 해소한다. 기존Worker관리자가 검증relay를 등록하고 외부화면팀이 preview제한을 유지한live로 재배포한 뒤, 계정주인 정상로그인/OTP의 같은Bearer를 기존server-only BFF로 전달해 최초검수한다. JWT·OTP·쿠키를 별도전달받거나 새검사계정/권한으로 우회하지 않는다. |
| SECURITY_3_GATES | 서비스팀 / 외부 화면팀 / 기획팀 | NOT_RUN | security_response_artifacts·security_direct_authorization·security_harvest_controls를 같은 후보의 실제 증거로 인수한다. |

설정 본문과 다운로드 링크는 공개 요청서·채팅·Git에 넣지 않는다. 기존 Owner/Administrator를 수신자로 확정하고 지정 비공개 경로에서 별도로 전달한다.

실사용자검수 후 Worker설정이라는 순환대기를 해소한다. 기존Worker관리자가 검증relay를 등록하고 외부화면팀이 preview제한을 유지한live로 재배포한 뒤, 계정주인 정상로그인/OTP의 같은Bearer를 기존server-only BFF로 전달해 최초검수한다. JWT·OTP·쿠키를 별도전달받거나 새검사계정/권한으로 우회하지 않는다. 등록과health 준비통과를업무22/native/deployment/브라우저/운영gate완료로세지않는다.

005/003 재적용·승인 Storage 재업로드·성공한 예산 namespace 재실행·데이터 writer 재개 없이 기존 정확 근거를 재사용한다. 현재 단일 정본과 승인 목적을 유지하며 historical C140 및 연구곡선을 현재 운영 자료로 승격하지 않는다.

### 설정 등록 직후 준비 검수 이력

2026-10-15 설정 등록 직후의 제한 준비검수 이력이다. 당시 실사용자·Worker·BFF NOT_RUN은 보존하며, 이후 현재 상태는 2026-10-16 화면팀 실연결 회신으로 갱신한다. readiness와 업무 인수는 구분한다. 후속 새 함수 소스 배포는 actual_editor_deployment의 독립 영수증으로 구분한다.

| 확인 범위 | 현재 결과 | 증거 경계 |
| --- | --- | --- |
| 새5설정 | 5/5 digest 일치 / 2026-10-15T13:02:38Z | Owner 보고와 승인파일 대조; Dashboard 독립재측정 NOT_RUN |
| 같은 함수 readiness | 200 ready / 2026-10-15 22:52:45 KST | no-store; health 준비검수이며 업무 인수 아님 |
| 잘못된 relay | 403 relay_authentication_failed | 2026-10-15 22:54:57 KST / no-store |
| 실사용자 Bearer 누락 | 401 authentication_required | 실사용자 getUser/본인profiles/aal2 인수 아님 |
| 등록 직후 실사용자 / Worker등록 / BFF브라우저 | NOT_RUN / NOT_RUN / NOT_RUN | 정상로그인 같은BFF 통로로 다음 검수 |
| 업무native / 배포인수 | 0/22 / 0/22 | 지속성능·운영3gate·일반공개 미완료 |

이 준비검수 이후 Worker relay 등록·preview live 배포·정상로그인 Bearer 세션은 화면팀이 기능 통과로 보고했다. 다음 검수는 현재 실연결 회신의 P2 저장·분석·재조회 및 보안 반례 범위를 따른다.

현재선택된 과목전용5업무부터 성공점수와 total_model_missing 등 독립보류를 구분한다. 현재catalog·전체/대학누백·추천목적을 확대하거나 historical C140을 승격하지 않는다. 실제1~4페이지의pending/안전거절과 자료/계산성공을 구분하고 운영3gate를 별도로 인수한다.

### 최초 화면팀 실연결 회신 이력과 남은 검수

화면팀이 운영 정문의 Worker relay·live·실제 Bearer 세션 기능 통과를 보고했다. 서비스가 새 브라우저/토큰을 독립 관측한 것은 아니며, 업무22개·운영3gate·일반공개 완료로 승격하지 않는다. 최초 synthetic 회신과 등록 직후 NOT_RUN은 이력이다. 이 외부 회신 당시의 배포 전 관측은 보존하며 후속 실제 함수 소스 배포는 actual_editor_deployment의 독립 영수증을 따른다.

| 항목 | 화면팀 보고 / 검수 경계 |
| --- | --- |
| 회신 당시 화면 / Worker / 모드 | 59f01ad774917c57d0664b37698e9748104dc7c4 / 84c6703b-a095-43ac-a659-8456b421141b / live |
| Worker relay 등록 / 실제 Bearer 세션 | EXTERNAL_REPORTED_FUNCTIONAL_PASS / EXTERNAL_REPORTED_FUNCTIONAL_PASS |
| aal1 / aal2 세션 | aal1 일반 회원 / aal2 관리자 이용 paid+null; 정상 로그인·OTP 이후 탐색 중 세션 유지 보고. |
| P1 / P3 검색 | P1 양 세션 및 P3 aal2에서 503 security_policy_unavailable 보고. 현재 과목전용5작업 binding은 history.search·offerings.search를 제외한다. 고정 소스 합성 재현은 usage policy·업무·projection 전 차단이며 새 native 추적은 NOT_RUN. |
| P2 저장·분석·재조회 | NOT_RUN |
| P4 관측 | aal1 유료 gate / aal2 확인된 성적 없음 표시; 후보 생성 업무 성공 근거가 아니다. |
| 소유권 / CSRF / 만료갱신 | NOT_RUN / NOT_RUN / NOT_RUN |
| 업무 native / 배포 인수 | 0/22 / 0/22 |
| 서비스 오류 분류 | 배포한 소스는 유효한 승인 binding의 미선택 작업만 503 operation_scope_not_approved로 구분한다. 누락·손상·만료 binding 또는 사용정책·비용 누락은 503 security_policy_unavailable을 유지한다. 정확 번들 배포·editor 재조회까지 확인했으며 새 준비 health·거절 경계는 통과했고 후속 BFF 화면의 해당 코드 표시만 독립 관측했다. HTTP 상태 직접 캡처·관리 aal2·업무 인수는 미완료다. 성공 DTO·예산·데이터 승인은 바꾸지 않는다. |

후속 화면팀 P2 회신은 frontend_P2_reply, 현재 실패 시도는 current_P2_attempt, 이전 Root 실패는 P2_attempt_history를 따른다. 새 Worker 설정·getter 배포는 보고 범위이며 source SHA 미제공·미푸시다. 별도 가상1건 실패는 HTTP·단계·키·부분 생성·DB쓰기 미확정이므로 담당자의 안전한 서버 확인 전 재제출하지 않는다. 전체22업무·보안3gate·검색/자료/예산 승인을 확대하지 않는다.

### 이전 함수 소스 배포 이력과 당시 업무 인수

기존 jungsi-api 한 개에 정확 번들을 입력하고 copyback 전체 바이트/SHA, Deploy updates 완료와 reload 후 서버 editor 소스 전체 일치를 확인했다. 기존 verify_jwt=true와 설정·다른 함수를 유지했다. 배포 count3은 화면 관측값이며 고유 배포 버전·새 버전 health·실JWT 업무 인수의 대용이 아니다.

| 확인 범위 | 결과 |
| --- | --- |
| 소스 후보 / develop / tree | cb500f7ac10755de9f7b1977b60fa0eb77f2da3f / 1ba331c0577f709fb7a8f812f5e227cb9e355f19 / c7034d4a623f5b48d3687166caf66378421735ee |
| 고정 번들 | 1446299 bytes / SHA-256 d1b75c873a55417d59f0a462912d71ccb06c54ab7791b956f78fbc25235ba213 |
| 배포 관측 시각 | 2026-10-16T00:27:29.241Z |
| editor 입력·reload 재조회 | SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED |
| 기존 함수 / verify_jwt | 기존 함수 유지 / true 유지 |
| 배포 영수증 SHA-256 | 9049d9a0b41978c3ea804701de05b99ecfaa9e35b2c210ef64c5a007b0c8a3b0 |
| 새 버전 health / 같은 BFF 안전 오류 관측 | NATIVE_READINESS_AND_BOUNDARY_PASS / SAFE_ERROR_CODE_VISIBLE_PARTIAL |
| P2 / 소유권 / CSRF / 만료갱신 | NOT_RUN / NOT_RUN / NOT_RUN / NOT_RUN |
| 업무 native / 배포 인수 | 0/22 / 0/22 |

9e 설치·준비 health·최초 synthetic/BFF 회신은 당시 이력으로 보존한다. 기존 승인 과목5작업·binding·Storage·예산·모집행 단일 writer를 유지한다. 9e 대비 전체 소스 차이4개는 오류분류2TS·기존 대학분포v2 1TS·생성 catalog1JSON이며 자료·검색·모형 목적 승인을 추가하지 않는다. 이후 기획 문서 커밋을 이 고정 배포 소스 커밋으로 소급 치환하지 않는다. 전체 업무0/22·운영3gate·본인P2·소유권·CSRF·만료갱신 미완료를 유지하고 정상 기존 세션의 안전 오류 표시와 현재 P2 단일 실패를 별도 영수증으로 기록한다. HTTP/단계·부분 성공·실제 시험/pack·관리 aal2는 미확정이며 재시도하지 않는다.

새 배포에서 live200·정상 relay readiness200·relay 누락/불일치403·사용자 Bearer 누락401과 5건 no-store를 실제 확인했다. 사용자 JWT 접근 없이 수행한 준비·거절 경계이며 실제 사용자 업무·소유권·보안3gate 인수가 아니다. 영수증 SHA-256 4b5cc87abc718fc4ad581e5f4d1d849efd9e8e3277895fe4c4e2a1a343d45494.

기존 정상 로그인 브라우저의 같은 BFF 화면에서 operation_scope_not_approved 코드가 표시되는 것을 독립 관측했다. 실제 HTTP 상태는 직접 캡처하지 않았고 머리글은 일반 회원이었다. 관리자 aal2·유료 권한·업무 성공을 확인한 관측이 아니다. 영수증 SHA-256 bfa56eaf3c4c75fa31f06581abc3a2c5f5f4b57303dc80342b43606e5c9a5995.

### 이전 화면팀 P2 저장 검수 회신 이력

원문 회신을 해시 결속한 외부 보고로 수용한다. 이전 Root 실패의 설명, 새 Worker 배포 보고, 화면팀 별도 가상1건 실패를 분리한다. 새 Worker source SHA가 제공·push되지 않아 공개 remote59f 소스와 같은 런타임으로 결속하지 않는다. source 배포 보고와 오류 표시 수정 배포대기·실제 업무 성공을 구분한다. 외부 Worker 배포 보고 수신은 신규 호스팅·추가 클라우드 승인이 아니며 Root 작업 환경은 Google Drive·기존 Supabase만 유지한다. 새 설정·한도·권한·요금 변경을 승인하거나 실행하지 않는다.

| 확인 범위 | 보고와 남은 확인 |
| --- | --- |
| 회신 원문 | 5439 bytes / SHA-256 0c26db23ca927ee8fde77250f1bb9586d3a5b7ea08e7343d6c62758e97c5c016 |
| 이전 Root 시도 | 화면팀은 이전 Root 합성 사례가 공개 시험·pack 설정2개 미설정으로 최초 profile 단계에서 거절됐다고 회신했다. 실제 HTTP422나 DB쓰기0은 별도 요청 영수증으로 확인되지 않아 미확정이다. 기존 Root 실패·가림 placeholder 정정 영수증을 보존한다. |
| 외부 Worker 배포 보고 | 3f5256fd-becb-4f80-b854-b73318d6ab86 / 2026-10-16T01:30:31Z / 당시 source SHA 미제공·미푸시 |
| 공개 저장소 화면 소스 | 59f01ad774917c57d0664b37698e9748104dc7c4; 당시 새 Worker와 소스 결속 미확인 |
| 화면팀 별도 시도 | 화면팀은 2026-10-16T01:45:00Z에 이전 Root 사례와 조합이 다른 가상386 한 건을1회 제출했고 일반 연결 실패 안내를 보았다고 보고했다. 이 문구의503 또는 네트워크 분류는 실제 HTTP503 확정이 아니다. stage·status·code·request_id·멱등키를 수집하지 않았고 profile 부분 생성·DB쓰기는 미확정이다. 재제출0·새로고침0이며 overall/report 성공은 NOT_RUN이다. 상세 합성 점수와 요청 본문은 공개 명세에 복사하지 않는다. |
| 오류 표시·관측 수정 | PENDING_DEPLOYMENT_AND_SOURCE_SHA / 당시 source SHA 미제공; 당시 배포·재검수 미완료 |
| 서버 전용 안전 관측 | stage, path, status, code, request_id |
| 사용자 화면 | stage, safe_error_code |

score-profile.create도 DB COMMIT 이후의 세션·응답 projection·현재 제어·예산 정산·최종 검사에서 실패할 수 있으므로 최초 프로필 단계503을 실제 관측하더라도 쓰기0으로 확정하지 않는다. 이번 실패는 실제 HTTP·단계가 미수집이므로 분석 단계였다고 단정하지 않고 부분 프로필 가능성을 유지한다.

화면팀이 제시한 Storage GET200은 객체 접근 관측만 뜻한다. Worker POST 완료 보고01:45:07Z보다 GET01:45:09Z·01:45:10Z가 늦고 timestamp/request_id 상관관계는 확인되지 않았으며 readiness도 같은 객체를 읽는다. 이P2요청의 사용정책 조회·bytes/SHA 일치·native 정책 검증·예산·업무 성공 근거로 사용하지 않는다.

회신§4의 UI·logging 수정은 source SHA 미제공·배포 대기이며 구현 통합·배포·재검수 완료로 세지 않는다. 서버에서 단계·정적 경로 template·HTTP status·안전 code·request_id만 관측하고 경로의 식별자·query·body·토큰·쿠키·키·stack은 기록하지 않는다. 사용자 화면은 단계와 안전 코드만 표시한다. 이번 기획 반영은 해당 로깅 구현이나 실제 원인 코드 확인을 뜻하지 않는다. 원문의 소유자 배포 승인 후 진행은 외부 대기 상태이며 이 회신 자체를 사용자 배포 승인으로 취급하지 않는다.

후속 정상 BFF 화면의 관리자 이용 표시·관리자 진입을 관측했다. 실제 API JWT·aal2 추적 인수가 아니며 이전 일반 회원 머리글 관측과는 시점이 달라 모순으로 처리하지 않는다. 영수증 SHA-256 40846893a42f9c85e3d058dff3074e5647fa79cfc5899cc3cbd1fd0c4ab86297.

### 이전 ed978 설치 당시 요청별 안전 관측 계약

당시 기록 원문: 현재 관측 코드 소스는 ed978/동일 tree의 develop2cf이며 실제 배포·전체 editor reload 확인은 current_deployment 영수증에 결속한다. 기존 합성41개·신규16개·전체 소스 훅/CI는 소스 검수이며 실제 사용자 업무·소유권·CSRF·운영3gate를 대신하지 않는다. 서버 허용5필드·요청별 문맥 격리·본문과 키·계정·원자료 미수집·기존 오류 DTO·인증·예산 한도는 유지한다. 이전 cb500 설치와 합성 당시의 NOT_RUN은 보존한다. 후속 P2 실패·제한된 로그 상관관계·전후 범위 조회는 current_P2_attempt의 별도 관측을 따르며 업무 인수0/22와 production_ready=false를 유지한다.

| 항목 | 계획 계약과 인수 경계 |
| --- | --- |
| 담당 | feature/application-pre-data-platform |
| 서버 전용 허용 필드 | operation, stage, status, code, request_id |
| 구현 / 검증 / 배포 | SOURCE_IMPLEMENTED / SYNTHETIC_FOCUSED_PASS / SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED |
| 소스 결속 | 설치 당시 관측 계약·소스4개·테스트2개 고정; 새 수정 후보는 아래 현재 해시로 별도 검증 |

| 합성 후보 검증 | 범위와 결과 |
| --- | --- |
| 집중 검사 | 41 PASS / 0 FAIL; 신규 16개 |
| 전체 스냅샷 검사 | 584개는 설치 당시 소스 검수 이력; 새 후보의 전체 검사는 아래 별도 요구 |
| 집중 로그 SHA-256 | 39ed3638e3494f66c8ec916f5627352251feece05163b38bcd8c48da315d073d |
| 소스 배포 / 실제 업무·배포 인수 | SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED / 0/22 · 0/22; 합성 검수와 실제 인수 분리 |

| 설치 당시 파일 | 고정 SHA-256 |
| --- | --- |
| supabase/functions/_shared/jungsi/infrastructure/api_http.ts | 1a46ee4dbf2ca40c4544ec0d3792d52e7e489856639876316fad56e7e267ec7b |
| supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts | cac4771eb472199188d797a04e32eefc95ac3f42317c5860251e514e0e61ccca |
| supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts | b757ad470d5a3d9cb44b8ad08203ca7d42359dd2657d9d91581674c639e6f557 |
| supabase/functions/jungsi-api/index.ts | ef68f227b04705681d2f269babad5688bd3558dab33e3a889574b1b09b6321b2 |
| tests/edge/test_runtime_composition.ts | 40670cf3423dca5f0d4718dcfda79ff387d181fae5b3f1c13f14b8ac43dabed6 |
| tests/edge/test_runtime_budget.ts | d819a63a5a0ca79810733d035d1606e3b567edbced771ed31f98f56c565732a0 |

### 보존된 후속 설치원장

| 증거 ID | 설치 소스 / bundle SHA-256 | 당시 상태 / 준비 / visible event 수 | 배포 영수증 SHA-256 |
| --- | --- | --- | --- |
| OPS-SAFE-OBSERVER-DEPLOYED-20261016 | ed978c74d8c89bd6fec867b891342c1b6c6c15a3 / 80d2be1e6da55fd585c01050f5897a54fc835a0a7512554a5a342165971ed83f | SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED / NATIVE_READINESS_AND_BOUNDARY_PASS / 4 | cdfce56877c99ee1880ef5b9f2c82f9293429ea6841c22047a34559b23d5373f |

### 보존된 source032 회귀 기준 설치원장 — 현재 운영은 최신 Owner 영수증

기존 함수에 source032/spec1.9.70을 설치하고 전체 editor reload bundle 일치와 legacy JWT ON을 확인했다. 준비5경계와 한정 P2 UI/표시/재조회는 개별 영수증이며 22업무·보안3gate 인수와 분리한다.

| 확인 범위 | 현재 설치 영수증 |
| --- | --- |
| 소스 후보 / develop / tree | 032a5647bc0b56e091eda279506aa534d559ea2f / 0024d665c48d73d79a3e2b496d4fa1f75f2415e8 / 442923a60630cbb935a12b090ddc400c3e843b43 |
| 번들 / source manifest | 1454143 bytes / e69d1d7482c855587d1e7461ced32bb26dd46593e0ab08a78db6e7b0063d7528 / 64개 |
| 배포 영수증 SHA-256 | 4e043184c64c0ba26f7cab5929f3548c5405148a94e108587ce242267c5fd3e4 |
| 전체 reload / legacy JWT | 일치 / ON |
| 새 배포 준비상태 | NATIVE_READINESS_AND_BOUNDARY_PASS |
| 업무 native / 배포 인수 | 0/22 / 0/22 |

설치032 bundle에 결속한 alive/ready/잘못된relay/누락relay/누락Bearer의5경계만 검수했다. 실제 사용자 업무·소유권·CSRF 인수가 아니다. 영수증 SHA-256 ca99826cb10eba4cce366f1d2e443077ac529f954a39f6b7b04deb76c7d08fc6.

이미 보존된5event 객체를 오프라인 검사하여 정확5키와 요청ID32lowerHEX를 확인했다. 원ID는 공개하지 않는다. 별도원관측 영수증 SHA d2670374cd63f6a77cb7fc3b78a6578e6c0cb07f85656cb02f18c33e8c5ea38f. 전체 로그 비노출·특정 BFF actor/요청 귀속·업무 성공은 증명하지 않는다. 영수증 SHA-256 9479cb119b31047c5245c46c788c6a90082164fa3767d8ba28c96ae160c82a6d.

| 관측 범위 | 상태 |
| --- | --- |
| visible event 형식 | 5개 / 허용5필드·32HEX 형식 확인 |
| 전체 로그 비노출 / 특정 BFF actor / 업무 성공 | 미증명 / 미증명 / 미증명 |

### 현재 설치 소스의 검수와 공통기획의 후속 검사

최종source032/spec1.9.70 및0024 merge의 정상1065/590/993·불일치0와 두source CI/merge CI만을 기록한다. 새공통기획1.9.71은 이 변경에서 미커밋이며 정상 전체검사·커밋·푸시·정확SHA CI는 별도다. 준비문서에 남은 freshP2 대기는 당시 이력이며 현재P2는 새Root receipt를 따른다.

| source spec1.9.70 검수 | 범위 |
| --- | --- |
| source / merge | 032a5647bc0b56e091eda279506aa534d559ea2f / 0024d665c48d73d79a3e2b496d4fa1f75f2415e8 |
| 정상 소스 검사 | 1065 Python / 590 Deno / 993 oracle / 불일치 0 |
| 업무 native / 배포 인수 | 0/22 / 0/22 |

| 정확 source CI | 검증 commit | 결과 |
| --- | --- | --- |
| 38852634961 | 032a5647bc0b56e091eda279506aa534d559ea2f | success |
| 38852775063 | 032a5647bc0b56e091eda279506aa534d559ea2f | success |
| 38853300254 | 0024d665c48d73d79a3e2b496d4fa1f75f2415e8 | success |

### 관리자 세션의 예산 연결 수정 · 소스 설치와 업무 인수 분리

합성 준비 당시 계약: SharedRequestBudget가 세션과 사용자 둘 다 이미 동결된 경우에만 검증된 원본 snapshot 참조를 보존한다. 가변 입력은 기존 독립 동결 복제를 유지하며 body·query·params의 복제/보호도 유지한다. WeakSet 등록이나 직렬화 adminOrigin·역할 문자열만으로 신뢰를 새로 만들지 않는다. 정식 active/admin/aal2·만료값 null 세션의 전체 예산 흐름을 합성 검수했고 위조·복제 관리자, 만료·inactive·aal1·일반 역할의 특권 위조, planner 권한 변조와 사용자 격리 반례를 검사했다. 승인된 meter5종·정수·정책·예산·기존 operation 범위는 바꾸지 않는다. 기존 ed978 실배포/관측41·전체584 및 P2 실패 기록은 부모7112의 관측 계약 전체 SHA로 고정하고 현재 후보의 소스·테스트 해시와 합성108·전체590 요구는 별도로 검증한다. 실제 P2 요청의 완전한 actor/BFF 요청ID 귀속은 미확정이다. 새 후보는 미배포·실업무 미검수이고 정상 전체 스냅샷·훅·정확 SHA CI가 필수다. 준비 시 부모7112는 로컬 훅 통과·원격 확인 대기이며 승인된 원격 확인 통지 전 origin push하지 않는다. 후속 패키지에서 자신의 정확한 최종 HEAD와 원격 근거를 결속한다.

| 확인 범위 | 현재 후보 |
| --- | --- |
| 출발 커밋 / 준비 당시 검증 | 7112f2c633c658f00494b44d6b430dd7e4aba5c1 / LOCAL_VERIFIED_COMMIT_ORIGIN_CI_PENDING_AT_PREPARATION |
| 구현 / 합성 / 실제 배포 | SOURCE_IMPLEMENTED / SYNTHETIC_FOCUSED_PASS / SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED |
| 수정 전 / 후 집중 회귀 | 27 PASS / 4 FAIL → 108 PASS / 0 FAIL |
| 신규 / 전체 스냅샷 검사 | 6개 추가 / 590개 정상 훅·정확 SHA CI 필수 |
| 배포 관측 이력 고정 SHA-256 | dd2c9334439a9f5757fa9d1febf42d58050a4b3154ac8271711feac8eb83a551 |
| 합성 준비 당시 실제 요청·DB 조회 / 전체 업무 인수 | 0 / 0; 현재 실행은 아래 별도 관측 / 0/22 · 0/22 |

| 새 후보 파일 | 현재 소스 SHA-256 |
| --- | --- |
| supabase/functions/_shared/jungsi/application/usage_service.ts | 11c89eeb624783e231c65b4578db631eab4757be95cf4231f288490ea2518c2c |
| tests/edge/test_usage_service.ts | 1488f2be2b2197fb05fffa32d976e6b9ee972daacb08a13364baebbe7db0eb9b |
| tests/edge/test_runtime_budget.ts | be79bc0786bce16b28d76d46927d7bfc81e8acbb2f19524e3766ad332607d08e |

### 보존된 P2 시도 이력

| 증거 ID | 당시 상태 | 멱등키 문맥 | 영수증 SHA-256 |
| --- | --- | --- | --- |
| OPS-P2-ACTUAL-FAILURE-20261016 | ACTUAL_UI_SAVE_ATTEMPT_FAILED_UNDETAILED | BROWSER_VALUE_REDACTED_NOT_CAPTURED | c68d6fa3d8869e8e8af124e2d1eebf049dd5efeb2149aeab1862ccf13ae5236e |
| OPS-P2-FRONTEND-FAILURE-20261016 | ACTUAL_UI_SAVE_ATTEMPT_FAILED_UNDETAILED | NOT_COLLECTED_BY_FRONTEND | 0c26db23ca927ee8fde77250f1bb9586d3a5b7ea08e7343d6c62758e97c5c016 |
| OPS-P2-OBSERVER-ATTEMPT-20261016 | ACTUAL_STEPS_OBSERVED | NOT_COLLECTED | 947aa988b270b30c00834261797c87727f64436c5060a143cd4107072a2bfc89 |

### 현재 P2 실제 단일 제출과 제한된 후속 관측

새 설치 후 정상 UI 단일 제출에서 성적표 저장·과목별 결과 표시와 GET 새로고침 후 동일 보고서 표시를 관측했다. 전체 누백·조합분포는 미발행 pending이며 전체 위치 계산 완료가 아니다. 정확 HTTP·BFF요청/actor 귀속은 미포착이다. 해당 owner/case의 두 시점 집계는0→1 관측이며 모든 DB쓰기·브라우저subject 증명이 아니다. 기존 실패 폼은 보존했고 재제출은0이다.

| 확인 범위 | 현재 결과 |
| --- | --- |
| 실행 / 재시도 | 1회 / 0회 |
| 실제 상태 / 멱등키 문맥 | ACTUAL_STEPS_OBSERVED / PRIVATE_REFERENCE_ONLY |
| UI HTTP / code / 요청ID | 미확정 / 미확정 / 미노출 |
| 전체 DB쓰기 | 미확정; 아래 범위 snapshot과 구분 |
| 실제 시도 영수증 SHA-256 | 61e12484ef1059aec218e5603917d3238bf669f6c33f80da5b77c3411b3d58bd |

| 단계 | 정확 응답 관측/실행 상태 | 해당 단계 HTTP / code |
| --- | --- | --- |
| profile_create | UNCONFIRMED | None / None |
| overall_analyze | UNCONFIRMED | None / None |
| report_read | UNCONFIRMED | None / None |

| 한정 기능 관측 | UI 표시 상태 | 증거 ID |
| --- | --- | --- |
| save_analysis_ui | OBSERVED_SUCCESS | OPS-P2-ADMIN-SESSION-FIX-SAVE-UI-20261016 |
| report_reload_ui | OBSERVED_SUCCESS | OPS-P2-ADMIN-SESSION-FIX-RELOAD-UI-20261016 |

보고서 reload 1회; 폼 재제출과 별개다. UI 표시 성공·owner/case 집계·보고서 재조회는 정확 POST 응답/분석 완료·전체22업무/보안3gate 인수를 대신하지 않는다. HTTP201 또는 pending 리포트 생성만으로 계산 완료를 주장하지 않는다.

저장 프로필·과목별 결과의 한정 기능 관측이다. 전체 누백·조합분포는 미발행 pending이며 전체 위치 계산 완료는 미확정이다.

과목 표시 독립 검산 4개 일치; 실제 등급·상위% 숫자는 공개하지 않는다. 영수증 SHA-256 aaa0fddb1341bd0fc695797faf3731da5e0f4541ab6e597397cc5ddbc0f54f7b. 전체 누백·조합 계산/특정 BFF actor 결속을 증명하지 않는다.

| 시각 | operation / stage | 로그 HTTP / code | 귀속 범위 |
| --- | --- | --- | --- |
| 2026-10-16T05:01:26Z | score-profile.create / complete | 201 / 없음 | TIME_AND_OPERATION_ONLY; UI·actor·BFF 요청 결속 미증명 |
| 2026-10-16T05:01:30Z | overall.analyze / complete | 201 / 없음 | TIME_AND_OPERATION_ONLY; UI·actor·BFF 요청 결속 미증명 |

| 조회 시각 | profile / profile성공 / overall성공 / report | 증거 범위 | 영수증 SHA-256 |
| --- | --- | --- | --- |
| 2026-10-16T05:00:28.074847Z | 0 / 0 / 0 / 0 | OWNER_CASE_SNAPSHOT_ONLY; 전체 DB쓰기0·browser subject 결속 미증명 | 26c7178a76958a40d51fbd4d4bbada02389a4f351e13d97387ebfe3c9720dc22 |
| 2026-10-16T05:02:41.661832Z | 1 / 1 / 1 / 1 | OWNER_CASE_SNAPSHOT_ONLY; 전체 DB쓰기0·browser subject 결속 미증명 | 1931e93ed072fb05c9c78eaac88519ebca66af036a8d1b70a005c9be7abd9a36 |

cb500/ed978 설치 원장과 세 실패의 당시 unknown·영수증·정정은 보존한다. 실제 성적·계정·멱등키·요청ID·비공개URL을 공개하지 않는다. 한정 UI/표시·재조회 성공과 전체22업무·권한·CSRF·만료·보안3gate 인수를 구분한다.

### 현재 화면 BFF 배포 보고와 독립 소스 확인

소유자 회신의 Worker 배포 보고이다. Git 소스·CI는 독립 확인했으나 실제 Worker 바이트와 소스의 결속은 독립 검증하지 않았다. 설정값과 원문 본문은 비공개로 보존한다.

| 확인 범위 | 상태 |
| --- | --- |
| 화면 소스 / 부모 | 44bd51231f84b1fa76a77fcc9aba00182e4e6882 / 59f01ad774917c57d0664b37698e9748104dc7c4 |
| 소유자 보고 Worker / UTC | 49fcffd9-5aeb-4629-9bcc-d02148bf097b / 2026-10-16T07:09:11Z |
| 정확 소스 CI | 38866270866 / success; Worker 바이트 결속은 미확인 |
| 화면 소스의 기획 버전 | 1.9.62; 최신 develop 1.9.72 통합 대기 |
| 독립 Git 계보 | INDEPENDENTLY_GIT_VERIFIED; 양방향 ancestor 없음 |
| 소스 보완 | PREPARED_NOT_DEPLOYED / 검증 NOT_RUN_FINAL_INTEGRATED_SOURCE / 배포 NOT_RUN |
| 실제 API 소스 | 032a5647bc0b56e091eda279506aa534d559ea2f / spec1.9.70 유지 |
| 업무 native / 배포 인수 | 0/22 / 0/22; production_ready=false |

정확 44 소스와 push CI만 검증했다. 소스 기획은 1.9.62이며 현재 기획과 양방향 ancestor가 아니다. 최신 develop 1.9.72 통합, 기존 런타임 블롭·패치 확인과 정상 검사·빌드·배포가 필요하다. 소스 검토의 당시 대조 미확인은 후속 독립 대조 영수증으로 갱신했으며 업무 인수나 Worker 바이트 검증으로 승격하지 않는다.

### 검색 실패 응답 2건만의 정확 대조

화면팀이 보존한 실패 응답 2건의 요청 식별자와 기존 Edge 안전 로그를 정확 대조한 범위만 확인했다. 식별자 원문은 공개하지 않는다. JWT 주체·actor 권한·P2 정확 단계·22개 업무 인수의 증거가 아니다. 이전 P2 관측과 범위·자료·예산 승인은 그대로 유지한다. API 소스032 표기는 기존 설치 영수증에 근거하며 이번 로그 대조가 배포 바이트를 독립 검증했다는 뜻은 아니다.

| 화면 / operation | 단계 / HTTP / 안전코드 | UTC |
| --- | --- | --- |
| PAGE-01 / history.search | budget_initialize / 503 / operation_scope_not_approved | 2026-10-16T07:09:38Z |
| PAGE-03 / offerings.search | budget_initialize / 503 / operation_scope_not_approved | 2026-10-16T07:09:44Z |

Root는 P1/P3의 새 안내와 관리자 머리글 표시만 읽기 전용으로 확인했다. Root UI 요청 식별자를 수집하지 않아 앞의 화면팀 실패 응답 2건과 같은 요청이라는 결속은 미증명이다. 표시를 JWT·actor·관리자 AAL2·P2 성공으로 승격하지 않는다. GET 2 / POST 0 .

비공개 보완안만 준비되었으며 현재 배포의 수정 완료나 재검수로 기록하지 않는다. 로그의 HTTP·공개 코드의 길이 제한·문자 형식과 요청 식별자를 실행 중 검증하고 동적 경로와 genericError의 원문 경로·쿼리를 상수 경로 틀로 제한한다. 로그 오류는 업무 실행에 영향을 주지 않는다. 프로필 저장 후 전체분석 예외에도 저장 상태와 단계·안전코드를 보존하며 자동 재시도·새 키를 만들지 않는다. 실제 완료에는 후속 소스·정상 검사·배포 영수증이 필요하다. 별도 비공개 후보는 합성45건 통과 보고만 있으며 최종 develop 통합판 검증·Next 타입 검사·빌드·브라우저 재연결은 미실행이다. 후보는 원본에 미적용·미배포 상태다.

기존 cb500·ed978·032 설치 원장, 세 P2 실패와 현재 제한된 P2 기능 성공 근거는 그대로 보존한다. 이전 회신의 최종 SHA 미확보는 당시 이력이며 새 현재 상태는 이 객체를 따른다. 현재 API는 032/spec1.9.70이다. 새 화면 소스 검토는 조건부 수락이며 보완은 미배포·미검수다. 22개 native·배포 인수 0, 보안 3개 gate 미완료와 production_ready=false를 유지하며 범위·목적·예산·키·역할을 변경하지 않는다. 현재 공통기획1.9.72는 검증된 develop937/spec1.9.71에서 준비한 미커밋 변경이며 정상 훅·커밋·푸시·정확 SHA CI는 별도다.

## 공식 기술 근거

- [Supabase Edge Functions 실행 언어](https://supabase.com/docs/guides/functions)
- [Edge CPU·메모리·시간 제한](https://supabase.com/docs/guides/functions/limits)
- [Edge 포함 호출량·추가 과금](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)
- [Google Apps Script 웹앱 제공](https://developers.google.com/apps-script/guides/web)
- [Supabase 비용 제어와 Spend Cap 적용 범위](https://supabase.com/docs/guides/platform/cost-control)

[DEV-010 작업 항목](../work_items/DEV-010-supabase-platform-deployment.json) · [기존 실행 자료 계약](Supabase_실행자료_연결.md)

## 기존 입결 DB를 화면 API에 연결

[공식 입결 DB 표시 연결](DB_입결_화면연결.md)의 DEV-011을 따른다. 기존 DB를 별도 목적 범위로 명시 조회하며 기본 이용권·엔진/운영 원형 상태·22API/DTO·보안 gate를 유지한다. 코드 implemented_current_review_local_owner_intake_and_offline_four_page_diagnostics; C_plus_official_exam_local_native_HTTP_partial_success_and_exact_holds_verified; full_calculation_live_and_general_publication_pending; 실제 검수/운영 상태는 같은 문서의 항목별 증거로 확인한다.

## 1페이지 추정 2열과 초안 시사

[공식 자료·추정 표기·시사 계약](1페이지_공식자료_추정표기_시사.md)을 따른다. 추정 총 지원자·추정 탈락자 2열을 유지한다. 대학 발표 공식 지표와 분리된 화면 파생값이며 자체 누백/예상컷/개인 분석을 1페이지에 추가하지 않는다. 2026-10-19 사용자 채택: 1페이지의 자료 공급 범위는 현재 단일 정본의 서비스 대상 전국 전체다. 학교별 부분 발행 완료를 기다리는 조건을 이번 연결에 적용하지 않는다. 현재값을 읽는 공개 어댑터·명시 승인 binding과 페이지별 검수는 별도로 완료해야 하며, 자료가 부족한 셀은 보류/null로 보존한다. 동일 학년도/모집행/통계 분모와 결측·실제0·음수를 검사하고 실제 불합격자수와의 차이를 표시한다. API의 공식 history_metric과 회원 권한은 유지한다. 학교별 부분 발행은 단일 활성 catalog의 누적 불변 판으로 착수하며 source 승격·자동 병합을 하지 않는다. 실제 발행된 과거 입결의 목록/검수 계보·부분 조회를 화면에서 대조하고 승인·선택·수신·브라우저·운영 발행은 별도 인수다.

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



<!-- jungsi:generated spec_sha256=65f022536c3243345209ed3ac0b6e43249919e88e399470299dda8fa2a380f42 -->


## 기존 운영 조회의 후속 검수

SCOPED_SCORE_TRANSITION_RECOVERY_ACCEPTED_OWNER_FRONTEND_RECEIPT_BOUND. 2026-10-26 실제 append-only 전환·커밋 후 재조회와 본인 계정 P2 입력권/P3 명시 분석·재확인/P4 후보·재확인이 통과했다. 원점수·원래 리포트 이력·입력 사용량을 보존했다. 기존 승인된 모의평가 범위에 한한다. 전환 전 score_input_transition_pending은 이력이며, 새 성적 저장·정정권 소비·Owner 별도 계정의 담기/인쇄 검수·미발행 대학별 자료·전체 보안 인수는 별도다. 복구 상태는 SCOPED_ACTUAL_DB_AND_ROOT_BROWSER_PASS; supabase_deployment_contract.live_execution.latest_score_transition_acceptance_20261026로 구분한다.


## REQ-27 서비스 정책 후보

기존 소스 후보 검수 기록을 아래에 보존한다. 현재 승인된 모의평가 범위의 실제 전환·본인 입력권·명시 분석/후보 흐름은 2026-10-26 날짜별 supabase_deployment_contract.live_execution.latest_score_transition_acceptance_20261026를 따른다. 후보 기록의 NOT_RUN을 현재 전환 미완료로 다시 해석하거나 전체 API/보안 인수 완료로 확대하지 않는다. 서비스 API/DTO·애플리케이션·저장소·준비 SQL·검증. 화면 구현은 화면팀 담당이다.

기존22 API와 신규3 API를 각각 검증한 현재 계약은 총25개다. session/v1은 기존3개 공개 필드를 유지한다. 신규 경로: score-input.status.read, score-input.correction.grant, report.sample.read.

예산 예약은 먼저 독립 원자 커밋하여 실패 요청의 빈도 기록을 보존한다. 요청별 SQL fork의 동일 transaction frame에 프로필·입력권·예산 정산을 참여시켜 응답 투영·직렬화·마지막 인증/정책 검증 뒤 커밋한다. 실패 frame은 롤백 후 기존 lease를 정산하며 COMMIT 전송 확인 불명은 동일 key/status 복구로 구분한다. 성공한 프로필 POST 이후 분리된 overall 5xx는 기존 프로필/소비를 보존하고 profile_id로 재개한다.

개인 일일 distinct_scores/calculation_cost는 단계별 최초1회+관리자 정정1회로 대체하며 빈도·공유 동시성·요청당 물리 비용/시간·반환량·저장소 보호를 유지한다. 미설정·legacy 미전환·미승인 단계는 fail closed다.

첫 유료 결과는 해당 유료 작업의 공개 숫자 결과를 기준으로 생성 출처 이용권/현재 접근 이용권을 분리한다. 본인 read/export는 저장 원결과의 미전달 근거만 복구한다. 고정 가상 견본·단순 페이지 진입·통계·관리·전부 pending은 소비로 기록하지 않는다.

런타임별 상태: 서비스 구현 후보; 새 승인 usage-policy/v2·006·전환·범위/비용/배포 검수 전 개인 입력 503 hold; 별도 binding/v3 소비20과 usage-policy/v4는 기존 입력권+관리자 일일예외를 함께 검증하는 소스 후보이며 006/006a/기존profile 전환/실제 운영 활성화는 NOT_RUN. / REQ-27 입력권/정정/첫사용 미구현. 운영 경로는 개인 새 입력/분석 및 신규 API를 503 hold; legacy_synthetic 검증은 명시적 모드로 분리한다.. 006 상태: APPLIED_EMPTY_SCHEMA_NOT_ACTIVATED. 공개 RPC·기존 프로필 전환·신규 scope/비용·정책 활성화·배포/실계정 검수: NOT_RUN. 기존003 승인은 새006의 실행 승인이 아니다.


## 서비스 성능 후보와 P1 조회 계약

CR-SERVICE-PERFORMANCE-20261018-01 / SOURCE_CANDIDATE_NOT_DEPLOYED. SHA·길이·버전이 검증된 불변 본문만 worker 메모리에서 재사용한다. 최대16항목·원문4MiB·60초이며 파싱 트리의 추가 heap 비용이 있다. 현재 head·만료·registry/selection·버킷 비공개/상한·relay/JWT·현재 이용권/소유권·공유 원자 사용량은 매 요청 검사한다. 적중도 논리 요청/바이트를 차감하고 실제 GET/바이트를 별도 계수한다. 사용자 응답·권한·예산·진행 Promise는 저장하지 않는다. 동시 miss는 독립된 요청 한도/timeout으로 읽으며 공유 큐가 없다.

첫 캐시 후보의 검증은 기존624+신규20=644 합성 회귀와 기존 oracle993이다. 오프라인 fake-fetch 계수는 실 지연/전체HTTP 인수를 증명하지 않는다. 실제 Auth/DB/Storage 및 배포는 NOT_RUN.

CR-P1-BOUNDED-READ-20261018-01는 PROPOSED_NOT_IMPLEMENTED다. 기존 history.search의 academic_year 생략을 채택한다. 전체 조회에서 최대6페이지/100개/600지표 상한을 명시하며, 기존과 같은 총량이라고 주장하지 않는다. 반환된 원래 학년도·PK만 묶고 미해소 cursor와 마지막 미완전 모집행을 보류한다. 미래 학년도로 바꾸지 않는다. historical offering_id does not imply a target2027 offering. Use explicit verified school4year mapping and exact target ID; never prefix/name substitution. Existing public history DTO has no mapped target field. Skip target recruitment request unless independently verified target ID is available; missing link remains pending. 신규 합성/batch API는 여전히 미채택이다. 이번에는 기존 history.search 선택 필드를 사용한다. 새 operation을 추가하려면 별도 DTO·권한·예산·확장 검증이 필요하다. one bounded in-memory catalog pass or parameterized selected-ID ANY/unnest JOIN; at most one bounded recruitment query for unique verified target IDs; no N+1, bulk hidden loop, inferred merge or widened school scope

재시도: Do not retry generic429 after an unconditional3seconds. Parse safe Retry-After (seconds or HTTP date), keep finite retry count and UI deadline; unknown/long wait requires user action. Do not promise a lease expiry is the actual completion time. No automatic quota retry. Each retry repeats JWT/current entitlement/ownership/head/shared atomic admission; POST/PUT preserve identical body and Idempotency-Key. 서버 대기는 별도 설계이며 현재 추가하지 않는다.

배포 차이: NOT_ACCEPTED; usage/v1 data-only smoke does not accept rights-mode HTTP. New save/analysis needs approved operating policy and rollout; preserve503 hold. exact develop+REQ27 candidate requires complete transition before deployment; cache-only032 alternative requires planning-registered maintenance parent/target/source manifest and separate exact-source proof before any branch or bundle. Never mix unbound032/9c files or turn off policy guards. 006a·기존 프로필 전환·usage/v2·신규3 scope·실제 반례·배포/활성화는 NOT_RUN이다.


## 누백 릴리스 보관·정리 실행 경계

DB-CAP-01-RETENTION / BOUNDED_ROW_CLEANUP_PARTIAL_POSTCHECK_PASS_THEN_USER_SCOPE_CHANGED_TO_UNUSED_TABLE_DROP. 보관 원칙 승인과 정확 대상의 실제 실행 승인은 별개다.

| 항목 | 기준 |
| --- | --- |
| DB 유지 | 현재 정본 릴리스; 검증된 채택 계보의 직전 완료 릴리스 2개; 보존 리포트·검수/발행 기록·현재/후보 포인터·Storage descriptor/binding·Edge/view 등 실제 소비자가 참조하는 모든 릴리스; 보관 근거가 아직 연결되지 않은 정정 릴리스 1건; 모든 원본/로컬파일/과거 산출물 및 현재값·공유 방법 정의 |
| 직전 계보 | 정본 채택·완료·부모 영수증으로 직전2개를 고정한다. 릴리스ID 문자열이나 추정 시각 정렬로 대체하지 않는다. 계보 또는 참조가 미확인인 버전은 보존한다. |
| 참조 확인 | 보존 소비자 root와 의존관계를 제한 명부로 조사한다. 한 릴리스 내부 회원/OX 행은 함께 보관할 대상 단위이며 자기 release_id만으로 독립 소비자 참조라고 세지 않는다. 보존되는 외부 검수/리포트가 해당 릴리스를 실제 필요로 하면 유지한다. 미확인 참조는 삭제 후보에서 제외한다. |
| 보관·복구 | 기존 비공개 Storage/Drive만 사용한다. 후보별 native 스키마·자료형·NULL/Decimal·행키·값/방법/검수/회원 관계·행수·bytes·SHA256을 고정한다. 불변 보관본 재다운로드 대조와 격리 환경의 복구·전체필드/ID/해시 대조를 완료한다. 기존 원본 파일과 보관본은 삭제하지 않는다. |
| 실행 승인 | 정확 제거 계획을 관리자에게 제출하고 그 대상에 대한 별도 실행 승인 후만 진행한다. 이번 보관 원칙·계획 작성은 DELETE·파일삭제·운영전환·요금변경 승인이 아니다. |
| 실행·정비 | 승인 후 기존 단일 writer가 제약/RLS/매개변수와 정확 과거행 범위를 유지하며 배치별 커밋 영수증과 새 참조 경쟁을 확인한다. CASCADE·FK/trigger 해제·광범위 TRUNCATE·현재head 변경은 금지한다. 대상표 일반 VACUUM(ANALYZE)은 DELETE 커밋 뒤 별도 유지보수로 실행한다. 일반 VACUUM은 dead 공간을 재사용하게 하며 할당디스크/요금 축소를 보장하지 않는다. 잠금·I/O·장기 snapshot을 확인하고 승인된 대상표로 한정한다. VACUUM FULL·pg_repack·REINDEX·PK/UNIQUE/인덱스 제거·테이블 재작성은 제외한다. |
| 전후 증거 | DB와 대상별 heap/index/TOAST 크기, 유지/제거 행수, 보관SHA, 현재head/원형값/방법/연결 불변 및 할당디스크 사용을 기록한다. 추정 재사용량·실측 재사용·청구 관측을 구분한다. |
| 미래 writer | no-op은 숫자만 비교하지 않고 값/방법/검수 의미·native형·관측정의·출처 맥락을 비교한다. 같으면 기존릴리스/멱등 영수증을 재사용하고 전량 snapshot을 만들지 않는다. 변경분/공유정의 저장은 재구성·출처·예상이전해시·구소비자 호환을 검증한 별도 writer/schema 제안으로 준비하며 이번에 전환하지 않는다. |
| 용량·비용 | 다음 승인 대량배치 전 현재 디스크/I/O·보관공간·WAL/index/temp 증가·백업/snapshot·서비스부하를 제한 메타데이터/계획과 기존 재조회로 확인한다. 한도 위험 시 배치 전에 관리자에게 알리고 compute/disk/부가기능을 자동 변경하지 않는다. 현재 Spend Cap 켜짐을 유지한다. 일부 사용량만 제한하므로 compute·PITR 등 별도 부가항목까지 총추가요금0을 보장한다고 기록하지 않는다. 실제 설정·청구 적용범위를 별도로 확인한다. |

| 단계 | 산출물 | 상태 |
| --- | --- | --- |
| RET-00 | current lineage and consumer reference inventory | CURRENT_LINEAGE_BOUNDED_CONSUMERS_AND_HUMAN_SHARED_SCOPE_VERIFIED |
| RET-01 | native archive/readback/isolated restore proof | LOCAL_NATIVE_RESTORE_AND_LIVE_PROOF_REUSED_REMOTE_VERIFIED_SUBSET_USER_STOPPED |
| RET-02 | exact removal plan and administrator execution approval | DIRECT_HUMAN_EXACT_ROW_SCOPE_RECEIVED_SUPERSEDED_BY_NEW_TABLE_SCOPE |
| RET-03 | approved single-writer historical-row cleanup | BOUNDED_PARTIAL_COMMITTED_POSTCHECK_PASS_STOPPED_ON_USER_INSTRUCTION |
| RET-04 | affected-table ordinary VACUUM ANALYZE and before/after receipt | NOT_RUN |
| RET-05 | frontend scoped post-maintenance recheck | NOT_RUN_AUTHENTICATED_SERVICE_SCREEN |

공식 참고: https://www.postgresql.org/docs/current/sql-vacuum.html / https://supabase.com/docs/guides/platform/cost-control. 실제 ID·대상행·용량·계정·SQL·보관위치는 비공개 계획에 고정한다.


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


## 카탈로그 전용 본문 선택 로딩 후속 후보

CR-CATALOG-PAYLOAD-SCOPE-20261018-01 / SOURCE_CANDIDATE_NOT_DEPLOYED. 별도 보존한 첫 캐시 후보7d53dda는 정상 훅/source·PR CI Python1125·Edge644·oracle993 PASS다. 현재 후속은 기존644+신규12=656 합성 회귀로 따로 검수한다.

history.search, recruitment.read, offerings.search, offering.read만 catalog 본문을 읽는다. registry/selection의 전체선택 참조·승인·scope·형식·크기와 fresh 비공개 버킷의 전체선택 최대길이를 검사한다. policy exam의 선택참조 version/명시year도 일치시킨다. 실제 소비 catalog의 SHA·길이·버전·native decode는 그대로다. 사용하지 않은 exam/conversion 본문은 읽지도 검증했다고 기록하지도 않는다. 잘못된 참조 메타데이터는 이 분리로 통과시키지 않는다.

미로딩 scoring 자료를 요구하면 runtime_dependency_not_loaded503이며 미선택 null/pending과 구분한다. 카탈로그 preflight는 catalog_payload_and_all_selected_reference_metadata만 검증했다고 기록한다. 나머지21 operation은 자료가 필요한 기존 경로에서 전체 선택 그래프 검사를 유지하고 health.ready도 전체 검사를 유지한다. JWT/현재권한/소유권/head·만료·공유 원자 예산·기존 작업 비용·반환량·읽기/시간 상한은 바꾸지 않는다. 캐시 적중은 해당 소비 본문의 cold 논리읽기 차감을 유지한다.

Source 합성/오프라인 I/O 계수와 실제 응답시간 인수는 별도다. 새 API·운영 승인 확대·REQ27전환·032 drop-in·실제 DB/배포/활성화는 NOT_RUN이다.


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

인수 기준:

- Exact manifest/payload SHA and observed row/school/year counts; no duplicate academic_year:original_PK row
- Ten diverse named school/offering samples match current source and selection rules; independently review conflicting/multiple-basis/75cut/stage cases
- Zero null-to-zero, reserve-rank-to-headcount, source/type loss, unauthorized source/normalization status upgrades
- No full current-view COUNT/GROUP/FETCH or N+1 in request path; preserve existing dataset and RLS
- JWT/relay/ownership/current role, public-cache segregation, response allowlist/no-store, physical bounds and new operation negative cases
- Exact candidate source/normal hooks/CI; private final artifact proof; Owner upload/readback/settings; fresh deployed BFF/browser observations remain distinct

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

별도 조회 소스 등록: SOURCE_REGISTERED_NOT_ACTIVATED / history.snapshot.head, history.snapshot.read, report.list-own. 전체 논리 API28개, 기존22·입력권3·조회3의 소스/시험 증거를 분리한다. 다음 NOT_RUN은 등록 소스의 합성/별도 인수 기록이며 현재 combined 운영 보고는 아래 날짜별 Owner 영수증을 따른다. 별도 시험 256개이며 실제 인수 NOT_VERIFIED_BY_SOURCE_SUITE, 새 binding 활성화 NOT_RUN다.


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