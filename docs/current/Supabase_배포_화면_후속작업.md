# Google Drive·Supabase 전용 배포와 화면 후속작업

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.8이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

Google Drive와 기존 Supabase만 사용하는 운영 API 전환 준비 및 화면 담당 인계. 기존 Python 구현의 검산 근거와 미완료 운영 인수를 구분한다.

계약 2026.10.07.v1 · 코드 planned · 실제 운영 NOT_RUN · production_ready=false. 출발 develop dc59831a9b34e5dbf4bd15955a1f9489847403af.

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
| DEP-02 | 서비스 개발팀 | planned | Edge 명시 구성·relay/실사용자 권한·private Storage 명부·DB 포트·안전한 health 및 정밀 계산의 단계적 호환 구현 |
| DEP-03 | 데이터팀·서비스 개발팀·시스템기획팀 | in_progress | 기존 검수/변환 캐시를 재사용한 기능별 최소 native 후보·독립 검산·승인·불변 발행·명시 선택 |
| DEP-04 | 화면 담당 | planned | 허용된 화면 제공 방식·BFF relay/세션/CSRF·발행 감지와 기대값·실브라우저 검수 |
| DEP-05 | 서버 담당·시스템기획팀 | planned | 현재 Supabase 요금제/포함량/Spend Cap 확인, 실제 Auth/DB/Storage/공유 예산/Edge 후보 배포와 세 보안 gate 인수 |

## 화면 담당에게 전달할 작업

화면 제공 범위 scope_confirmation_pending · Drive Apps Script 후보 user_input_pending. 기존 외부 preview와 파일은 이력으로 보존한다. 새 플랫폼으로 채택하지 않는다.

- 최신 develop의 공통 명세를 자기 브랜치에 정상 merge하고 화면 변경을 보존해 생성 문서와 정확 HEAD CI를 갱신한다.
- relay는 예고가 아니라 X-Jungsi-Relay-Token 확정 계약이다. 서버 전용 비밀은 브라우저에 넣지 않고 사용자 Bearer·세션/CSRF·현재 권한을 함께 검수한다.
- 발행 감지의 과거 draft 개수 기준선을 최신 native 명부의 승인·발행 버전/해시와 기능별 기대값으로 교체한다.
- API 기본 주소·공개 Auth 설정·비공개 relay 전달·native 기대값은 같은 승인 후보에서 받는다. 주소를 임의로 만들거나 source-only 응답으로 live 전환하지 않는다.
- Google Drive Apps Script의 화면 제공 허용 여부를 확인한다. 현재 Next.js/기존 외부 워커 화면이 Supabase 안에서 그대로 호스팅된다고 가정하지 않는다.
- 실제 브라우저 HTML/JS/JSON/source map/저장소·401/403/503·성공 점수와 판단 pending·서울 시각 표시를 같은 후보로 검수한다.

## 검증 상태

Edge 구현 NOT_RUN · 실제 Auth/DB/Storage/Edge/BFF/브라우저/배포 NOT_RUN · 실제 비용/요금제 NOT_RUN. 기존 Python 합성 인수는 Edge 포팅/실운영 인수를 대신하지 않는다.

## 공식 기술 근거

- [Supabase Edge Functions 실행 언어](https://supabase.com/docs/guides/functions)
- [Edge CPU·메모리·시간 제한](https://supabase.com/docs/guides/functions/limits)
- [Edge 포함 호출량·추가 과금](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)
- [Google Apps Script 웹앱 제공](https://developers.google.com/apps-script/guides/web)

[DEV-010 작업 항목](../work_items/DEV-010-supabase-platform-deployment.json) · [기존 실행 자료 계약](Supabase_실행자료_연결.md)

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

<!-- jungsi:generated spec_sha256=2420617f5e02dc86ecab1e9925512eadb388df1fb76c113c2ae600f6c73a2ed1 -->
