# Google Drive·Supabase 전용 배포와 화면 후속작업

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.52이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

Google Drive와 기존 Supabase만 사용하는 실제 인증·22 API 이식·운영 배포 진행. 기존 Python 참조와 Edge foundation 검산은 재사용하고 실제 운영 인수와 구분한다.

계약 2026.10.14.v2 · 코드 planned · 실제 운영 NOT_RUN · production_ready=false. 출발 develop 73f4a4866c3edfae3ed6b6c7e9f2a1055c643117.

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

서버 UTC · 원자료/화면 Asia/Seoul. 실제 요금제와 포함량은 비공개 운영 확인 대상이다. BFF/내부 호출·재시도도 사용량에 포함하므로 사전 집계·정확 버전의 결과 재사용·공유 예산을 사용한다. CPU/메모리/포함량 초과를 외부 유료 서버로 우회하지 않는다. 현재 플랫폼 상한은 메모리256MiB, 요청 active CPU2초, Free worker wall clock150초다. 플랫폼 상한은 내부 운영 한도를 뜻하지 않는다.

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

## 검증 상태

Edge 구현 NOT_RUN · 실제 Auth/DB/Storage/Edge/BFF/브라우저/배포 NOT_RUN · 실제 비용/요금제 NOT_RUN. 기존 Python 합성 인수는 Edge 포팅/실운영 인수를 대신하지 않는다.



## 실제 인증·22 API·배포 진행

사용자가 실제 인증 연결·JWT/OTP 검수·22개 API 이식·운영 배포를 요청했다. 기존 Google Drive와 Supabase만 사용하며 코드 통합·합성 검산·실 연결·배포·공개 인수를 각각 기록한다.

Python990·Deno116·독립 oracle993 및 세션/관리 권한 foundation. 실제 Auth·업무22 API·TOTP·공개 배포 인수를 대신하지 않는다.

| 검수 단계 | 상태 |
| --- | --- |
| 실제 Auth getUser·본인 profiles RLS 연결 | IN_PROGRESS |
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
| history.search | GET /api/v1/admission-history | NOT_PORTED | NOT_RUN | NOT_RUN |
| recruitment.read | GET /api/v1/offerings/{offering_id}/recruitment | NOT_PORTED | NOT_RUN | NOT_RUN |
| score-profile.create | POST /api/v1/score-profiles | NOT_PORTED | NOT_RUN | NOT_RUN |
| overall.analyze | POST /api/v1/overall-reports | NOT_PORTED | NOT_RUN | NOT_RUN |
| report.read | GET /api/v1/reports/{report_id} | NOT_PORTED | NOT_RUN | NOT_RUN |
| offerings.search | GET /api/v1/offerings/search | NOT_PORTED | NOT_RUN | NOT_RUN |
| offering.read | GET /api/v1/offerings/{offering_id} | NOT_PORTED | NOT_RUN | NOT_RUN |
| university.analyze | POST /api/v1/reports/{report_id}/university-results | NOT_PORTED | NOT_RUN | NOT_RUN |
| candidates.build | POST /api/v1/reports/{report_id}/candidates | NOT_PORTED | NOT_RUN | NOT_RUN |
| shortlist.update | PUT /api/v1/reports/{report_id}/shortlist/{offering_id} | NOT_PORTED | NOT_RUN | NOT_RUN |
| report.export | GET /api/v1/reports/{report_id}/print | NOT_PORTED | NOT_RUN | NOT_RUN |
| statistics.read | GET /api/v1/reports/{report_id}/offerings/{offering_id}/live-statistics | NOT_PORTED | NOT_RUN | NOT_RUN |
| session.read | GET /api/v1/me | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.capabilities | GET /api/v1/forecast-capabilities | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.list | GET /api/v1/forecast-drafts | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.create | POST /api/v1/offerings/{offering_id}/forecast-drafts | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.read | GET /api/v1/forecast-drafts/{draft_id} | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.adjust | POST /api/v1/forecast-drafts/{draft_id}/adjustments | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.validate | POST /api/v1/forecast-drafts/{draft_id}/validations | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.approve | POST /api/v1/forecast-drafts/{draft_id}/approvals | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.publish | POST /api/v1/forecast-drafts/{draft_id}/publications | FOUNDATION_ONLY | NOT_RUN | NOT_RUN |
| forecast.published.read | GET /api/v1/offerings/{offering_id}/forecast | NOT_PORTED | NOT_RUN | NOT_RUN |

계정 주인이 /admin에서 휴대폰 인증 앱으로 등록·입력한다. 검수 계정 식별자·비밀번호·JWT·QR·OTP 비밀키는 공개 명세에 저장하지 않는다. 2026-10-14 계정 주인의 Codex 브라우저 직접 로그인·MFA 완료 회신과 관리자 화면 진입을 수령했다. 입력 대기는 해소됐으며 서버의 실제 getUser·aal2·본인 상태·학교 권한 검수는 계속 진행한다. 이 회신이나 화면 진입만으로 실제 JWT/TOTP 검수 PASS를 기록하지 않는다.

승인된 비공개 운영 한도와 기존 요금제 근거가 필요하다. null·미확정 값을 무제한 또는 실제 0으로 치환하지 않는다. 애플리케이션 내부 quota만으로 플랫폼 추가 과금을 방지했다고 판정하지 않는다. 기존 조직의 요금제·모든 프로젝트 사용량·포함량과 해당되는 Spend Cap 범위를 확인한다. Free는 추가 과금하지 않으며 Spend Cap은 Pro에서 적용 가능한 일부 사용량만 대상으로 한다. 실패한 Edge 호출도 invocation 사용량에 포함되므로 신규 요금제·유료 항목·초과 과금 허용을 자동 선택하지 않는다.

동일 operation의 구현은 등록된 Edge 파일·SHA에 연결한다. 실제 검수·배포 PASS는 해당 후보 커밋과 비공개 영수증 SHA 및 검사 범위에 결속한다. 검증한 공통 명세에서 기획·라우팅·3티어·배포 문서를 함께 생성한다. 다음 에이전트는 최신 근거 이후의 Git 차이부터 확인한다. 현재 정상 /jeongsi 진입 화면은 합성 응답을 명시하고 있다. 합성 회원 유형과 화면 성공은 실제 이용권·JWT·업무22 API 인수 근거가 아니다. 실제 서버 후보와 정상 BFF의 live 연결을 같은 후보 근거로 검수한 후 운영 상태를 갱신한다. 정상 Edge 소스 시험은 선택된 Git 스냅샷에서 operation의 등록 소스·해시 범위를 따로 기록한다. CODE_REGISTERED/PARTIAL_CODE_REGISTERED는 실제 JWT·DB 업무·Edge 배포 인수가 아니다. native_acceptance=NOT_VERIFIED_BY_SOURCE_SUITE와 해당 시험의 production_ready=false·운영 쓰기0을 유지한다.

### 위치 그래프의 기준

| 표시 기준 | 산식 | 적용 범위 |
| --- | --- | --- |
| 전체 위치 — 탐구 2과목 합 | K + M + T1 + T2 | 현행 overall_analysis_contract 및 StandardScores.total 정의 |
| 국어+수학+탐구 — 2과목 평균 | K + M + (T1 + T2) / 2 | 화면 조합별 제안 필드; 전체 합과 다른 탐구 비중 |

같은 입력·산식·시험/자료 버전·비교 모집단·승인 모형·동점 기준의 위치는 같은 서버 계산 경로/결과를 사용한다. 합과 평균은 다른 정의이므로 수치 차이만으로 어느 쪽이 정확하다고 판정하지 않는다. 전체 합 정의를 조합 평균으로 임의 변경하지 않는다.

명시 합성 모드의 위치 그래프마다 화면 확인용 합성임을 표시한다. synthetic-report의 임의 곡선은 검증한 입시 예측/누백으로 표시하거나 실서비스 정확도 근거로 사용하지 않는다.

live는 승인/발행/선택된 서버 값만 표시한다. 조합별 서버 계약이 미채택이거나 승인 분포가 없으면 자료 대기다. 화면에서 임의 곡선을 만들거나 전체 누백으로 다른 조합을 대체하지 않는다.

화면 담당은 전체의 탐구 2과목 합과 조합의 2과목 평균을 각 그래프 안에서 명시하고 합성 모드 안내를 붙인다. 프레젠테이션 브랜치에서 최신 develop을 가져와 변경·검수하고 서버의 승인/보류 상태를 유지한다.

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

유료 기준은 public.jeongsi_passes이며 관리자 무료 이용 예외는 미확정이다. 관리 8경로의 검증 aal2·본인 active 상태·기존 학교 권한을 결합한다. 이 문서에 남은 과거 어댑터/명시 연결 전용 결정은 당시 이력이다. 현재 변경 범위와 검수 상태는 [오픈 전 보안운영 변경](오픈전_보안운영_변경.md)와 opening_security_operations_contract를 우선한다. API22/session3·자료 승인/보존 경계는 유지한다.



<!-- jungsi:generated spec_sha256=251e99723bfc829128fd115e9c33f15d5cd780de495297312a4a904384f75dd9 -->
