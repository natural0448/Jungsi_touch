# Google Drive·Supabase 전용 배포와 화면 후속작업

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.72이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

Google Drive와 기존 Supabase만 사용하는 실제 인증·22 API 이식·운영 배포 진행. 기존 Python 참조와 Edge foundation 검산은 재사용하고 실제 운영 인수와 구분한다.

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

사용자 최신 지시가 별도 FastAPI 유료 호스팅 제안보다 우선한다. 기존 요금제·포함 사용량·Spend Cap을 확인하며 추가 서버·DB·Redis·유료 도메인·요금제 업그레이드를 도입하지 않는다. 포함량 초과를 추가 과금으로 자동 전환하거나 무제한 기본값으로 해석하지 않는다.

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

동일 operation의 구현은 등록된 Edge 파일·SHA에 연결한다. 실제 검수·배포 PASS는 해당 후보 커밋과 비공개 영수증 SHA 및 검사 범위에 결속한다. 검증한 공통 명세에서 기획·라우팅·3티어·배포 문서를 함께 생성한다. 다음 에이전트는 최신 근거 이후의 Git 차이부터 확인한다. 최초 synthetic 화면 검수는 과거 이력이다. 현재 정상 /jeongsi의 Worker relay·live·실제 Bearer 세션 기능 통과는 2026-10-16 화면팀 보고로 수용한다. 보고된 부분 관측과 업무22 API·소유권/CSRF·배포 인수는 구분한다. 새 오류 분류를 포함한 고정 cb500f7/동일 tree develop1ba331c 번들을 기존 함수에 실제 배포하고 editor 전체 재조회를 확인했다. 새 코드 준비 health·거절 경계는 별도 실제 영수증으로 확인했다. 같은 BFF의 안전 오류 코드 표시만 부분 관측했으며 실제 HTTP·관리 aal2·업무 인수는 미완료다. P2 단일 제출 실패는 current_P2_attempt로 구분하고 성공으로 세지 않는다. 배포 영수증의 소스·tree·번들 해시를 결속하며 소스 배포를 검색 활성화나 operation별 배포 인수로 승격하지 않는다. 정상 Edge 소스 시험은 선택된 Git 스냅샷에서 operation의 등록 소스·해시 범위를 따로 기록한다. CODE_REGISTERED/PARTIAL_CODE_REGISTERED는 실제 JWT·DB 업무·Edge 배포 인수가 아니다. native_acceptance=NOT_VERIFIED_BY_SOURCE_SUITE와 해당 시험의 production_ready=false·운영 쓰기0을 유지한다. 후속 화면팀 P2 회신의 이전 Root 시도·새 Worker 배포 보고·별도 가상1건 실패를 frontend_P2_reply와 current_P2_attempt로 분리한다. source SHA 미제공·미푸시 Worker를 remote59f에 결속하지 않고 실패 HTTP·DB쓰기를 추정하지 않는다. 후속 관리자 UI 진입은 JWT·aal2 추적 인수와 분리한다. 최신 설치는 current_deployment의 ed978 실제 영수증을 따르며 cb500 actual_editor_deployment는 당시 이력이다. current_P2_attempt는 새 실제 시도이고 회신 당시 두 실패는 P2_attempt_history에서 원래 배포·unknown 상태로 보존한다. 소스·준비상태 PASS, 제한된 로그 상관관계, 범위조회 snapshot, UI 업무 인수는 분리한다.

### 서버 런타임 조립과 입력 계약

실제 API source032/spec1.9.70을 기존 함수에 설치·reload 결속했고 준비5경계를 검수했다. 새 정상 UI1회 저장·과목표시·GETreload와4point 표시검산은 한정 기능 관측이다. 전체누백·조합분포는 미발행pending, 정확HTTP/BFFactor 귀속은 미확정이며 전22native/배포인수0·보안3gate 미완료·production_ready=false다. cb500/ed978와 세실패·41/584 합성 이력은 보존한다.

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
| 현재 catalog·모형 — 최소 후보 대기 | 최신 단일정본의 native 후보·검수·출처/타입/연도/모집행 맥락을 고정한다. C140/v21_1은 역사 검수로 보존하며 현재 catalog로 재승격하지 않는다. 미검증 추정모형은 미선택·pending을 유지한다. |
| 승인head·선택자료 — 기존발행재사용 / 등록후readiness통과 | 불변Storage·원문bytes/SHA와현재head선택그래프의기존근거를재사용했다. 등록후health200의구현경로에서binding/head/registry/selection/시험팩/사용정책·만료를검수했다. 실제사용자와업무인수는별도다. |
| 공유예산 — 기존격리SQL·실제만료검수재사용 / 실사용자업무별도 | 기존승인된과목전용정책·독립pool·동시성·재시작·멱등정산·상한거절과승인lease실시간만료의정확영수증을재사용한다. 검수행과이전실패본은보존한다. 등록후readiness는정책/현재head/만료검사통과이며실사용자의예약·정산·운영3gate인수는별도다. ceiling/GLOBAL을조직금액상한으로표시하지않고성공namespace를재실행하지않는다. |
| 새 설정5개 — Owner등록보고수용·readiness통과 | 기존Owner가새5개등록과원파일/digest5/5일치를보고했다. 서비스팀은실제readiness200·relay403·무Bearer401을확인했다. 기존DISPLAY/relay/Auth/RLS/JWT게이트는보존하고Worker서버relay·preview제한live·실사용자검수는다음단계다. |
| 현재 실연결 — 화면팀 기능 통과 보고 | Worker relay 등록·preview live·정상 Bearer aal1/aal2 세션 확인 보고를 수용했다. P2 본인 저장·분석·재조회와 소유권·CSRF·만료갱신은 NOT_RUN이며 검색은 미승인 작업 범위와 current catalog 준비를 분리한다. |

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

### 현재 실제 설치와 후속 준비상태

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

[공식 자료·추정 표기·시사 계약](1페이지_공식자료_추정표기_시사.md)을 따른다. 추정 총 지원자·추정 탈락자 2열을 유지한다. 대학 발표 공식 지표와 분리된 화면 파생값이며 자체 누백/예상컷/개인 분석을 1페이지에 추가하지 않는다. 동일 학년도/모집행/통계 분모와 결측·실제0·음수를 검사하고 실제 불합격자수와의 차이를 표시한다. API의 공식 history_metric과 회원 권한은 유지한다. 학교별 부분 발행은 단일 활성 catalog의 누적 불변 판으로 착수하며 source 승격·자동 병합을 하지 않는다. 실제 발행된 과거 입결의 목록/검수 계보·부분 조회를 화면에서 대조하고 승인·선택·수신·브라우저·운영 발행은 별도 인수다.

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



<!-- jungsi:generated spec_sha256=202587fd02c6a4b149c8d8e69cef2dfed9fab893d3b767feadb3ae11c94749d8 -->
