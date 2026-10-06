# 정시터치 프레젠테이션 개발 기준

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.8.1이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

현재 경로와 회원별 화면 접근 범위는 route_catalog.json을 따른다. [현재 기획](../../docs/current/서비스_기획.md)과 [라우팅 명세](../../docs/current/라우팅_명세.md)를 함께 갱신한다. 기존 가상 화면은 기획 이력이며 이 폴더의 실행 앱이 아니다. 실제 화면 앱·인증·API 연결은 후속 작업이다.

화면은 서버가 허용한 결과만 표시하고 자체 대학 계산이나 DB 직접 조회를 구현하지 않는다. 브라우저의 회원등급 선택값을 운영 권한으로 사용하지 않는다.

프레젠테이션은 별도 작업자가 담당한다. 최신 origin/develop의 기획 기준을 확인하고 담당 상시 브랜치 feature/presentation-foundation를 재사용한다. 서버 개발팀의 feature/application-pre-data-platform와 브랜치를 공유하지 않는다. route_catalog.json과 생성 README/현재 문서는 직접 편집하지 않는다. 계약 변경은 service_spec.json과 생성 도구에서 수정하고 생성 결과를 같은 커밋에 포함한다. [프레젠테이션 작업 인계](../../docs/current/프레젠테이션_작업인계.md)를 읽고 출발 커밋과 API 계약을 맞춘다.

## Supabase 운영 인수 상태

기존 비공개 보관 키로 Supabase Auth 설정·서버 REST 메타데이터·public 테이블 limit=0 조회가 HTTP 200으로 성공했다. .env 파일 자체는 필수가 아니며, 이번 keyed 조회에는 기존 비공개 설정 파일을 사용했다. 현재 PostgreSQL 어댑터의 DATABASE_URL과 실제 사용자 JWT는 확인한 설정 범위에서 미확보다. 관리 콘솔 권한은 브라우저 조회 시간 초과로 미검증이다. API 접근 확인과 전체 운영 인수를 구분하며 production_ready=false / NOT_READY를 유지한다. Python API 배포 연결 방식과 이용권의 단일 기준은 미선택이고, 실제 DB·로그인·이용권·승인 자료·운영 API·외부 4페이지 인수는 NOT_RUN/HOLD다. 승인 자료 0건은 05:32Z 이전 관측이며 이번 HTTP 재점검에서 재조사하지 않았다.

[Supabase 운영 인수인계](../../docs/current/Supabase_운영_인수인계.md)를 따른다. revision 2026.10.06.v2; 2026-10-06T08:40:54.349322Z 읽기 snapshot.

PR13 adc684/74fd/947의493건·b66의530건·PR14 구현429/병합91과 문서816의 정상561건/정확CI는 확인된 이전 코드 인수 이력이다. 이번 문서 후보의 미실행 검사·미래 commit/CI와 실제 운영 완료를 뜻하지 않는다.

## 공통 도구의 확인된 이전 인수 기준

| 범위 | 확인한 증거 |
| --- | --- |
| 공통 Git/CI 검사·명세·생성 문서 | b66c2274f0b0a27dc174555adde181cd16c68188; tree bd23bf5bd1ec0a05fed7c7f8db7db39621bf2748 |
| 정상 commit/push 훅 | 530건 PASS; 실패 0·오류 0·건너뜀 0 |
| 정확한 HEAD GitHub CI | [project-consistency](https://github.com/natural0448/Jungsi_touch/actions/runs/37324278331/job/111810898785): success |
| 서비스·DB 역사 기준 | adc684/74fd 구현과 develop947 통합의 493 PASS는 별도의 역사 인수 증거로 유지한다. |
| 당시 외부 프런트 관측 | d7b0279b2725a81ecd734cdec957c485ae5d6172; 4cc에서 필수3버전의 비어 있지 않은 문자열·정확동일성 보완과context17비교유지를관측했다. 실제Caller/브라우저/운영로그인인수는NOT_RUN이다. |
| 외부 삭제 관측 | observed_completed_external_not_integrated; develop 통합과 실제 브라우저 인수는 구분한다. |
| 운영/외부 인수 | verification_pending; DB .env 추후; main not_ready |

확인된 이전 baseline b66까지만 증거로 명시한다. 후속 문서 커밋 자신의 미래 SHA나 미실행 CI 성공을 기록하지 않는다. 공통 Git/CI 검사·명세·생성 문서 인수 및 전체 합성 회귀. 운영 DB·외부 프런트·실제 데이터·모형 운영 승인을 뜻하지 않는다. 이전 e12/676 버전값 보완 pending은 역사이며 최신 소스 관측과 실제 프런트 인수 대기를 구분한다. 최소 profile 조건 읽기와 실제 로그인 JWT NOT_RUN, 실제 자료·모형 운영 미승인 상태를 유지한다.

## 외부 접근 데이터 보호: 개발 시작 전 필수

[외부접근 데이터보호 개발기준](../../docs/current/외부접근_데이터보호_개발기준.md)을 작업 전에 반드시 읽는다. 정본은 service_spec.json의 security_contract와 workflow.development_harness이며 보안 revision은 2026.10.06.v1이다. REQ-24~26 / SEC-01~08은 화면·API·DB 개발의 공통 기준이다. 공개 응답의 재귀 허용목록, 서버 중계와 사용자 권한, 공유 누적 사용량 통제를 함께 구현한다. 기획·라우팅·route_catalog와 AGENTS 필수 참조는 동일 Git 스냅샷에서 하네스가 검사한다. 현재 운영 인수는 production_ready=false이고 3개 보안 release gate는 pending이다. 문서/계약 검사 통과는 런타임 차단 구현·브라우저·운영 DB 검수 완료와 구분한다.

<!-- jungsi:generated spec_sha256=e60ee221a1a947ee40e8ac19b31f22a3a8bf910a793e00710ab631f0b661e02f -->
