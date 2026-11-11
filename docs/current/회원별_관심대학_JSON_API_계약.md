# 회원별 관심대학 JSON API 계약

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.166이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.



## 회원별 관심대학 JSON API

MEMBER-SHORTLIST-01 / SOURCE_REGISTERED_NOT_ACTIVATED. 회원·대상 학년도별 비공개 JSON 관심대학을 기존 리포트와 분리한다. 저장 판정 동봉 A안을 채택하고 기존 report-bound API와 전문가용은 유지한다.

| 항목 | 계약 |
| --- | --- |
| storage | 기존 Supabase 비공개 Storage 불변 JSON/리비전과 작은 기존 원자 메타데이터를 사용한다. 새 결과/관심대학 DB 테이블·신규 서비스·키·과금은 만들지 않는다. 기존 성적/리포트/입력권·원본은 보존한다. |
| access | 검증 JWT에서 본인 UUID를 결정한다. 두 신규 경로는 기존 paid 판정과 active·aal2 관리자 예외를 따르며, 클라이언트 UUID/파일 경로는 받지 않는다. 공개 DB/Storage 직접 접근·서명 URL 노출 없이 기존 relay·CSRF·RLS/소유권·현재 권한·공유 예산·no-store를 유지한다. |
| legacy | 기존 PUT /api/v1/reports/{report_id}/shortlist/{offering_id}와 shortlist.update의 의미·권한·DTO는 바꾸지 않는다. 신규 두 operation만 명시 등록한 뒤 28→30이며 계약 준비만으로 현재 binding/배포를 넓히지 않는다. /pro 학생별 고정 리포트는 이번 범위에서 제외한다. |
| assessment | A안: 선택 보고서/성적 버전의 저장된 허용 assessment만 목록에 함께 붙인다. 없으면 null+명시 상태/사유를 반환한다. report_id가 있으면 그 본인 보고서의 버전을 결속하며, 생략 시 선택한 본인 해당학년도 보고서 문맥을 응답에 명시한다. GET/리포트 열람·목록읽기에서 계산·분석 POST·입력권 차감·결과 쓰기를 하지 않는다. 필요한 표시/판정은 한 번의 제한된 배치/공유 저장본 읽기로 해결하며 학교별 N+1·회원 전체 JSON 순회는 금지한다. |
| concurrency | expected_revision과 이전 JSON SHA/유효한 fencing을 결속해 한 세대만 게시한다. 같은 상태 쓰기는 revision을 올리거나 결과 객체를 다시 쓰지 않는다. 같은 키/동일 본문·경로는 최초 고정 응답을 현재 권한으로 재검증하고 다른 본문은409다. 단순 Storage upsert를 CAS로 가정하지 않는다. 응답 중단·게시 전후 실패·두 기기 충돌을 복구하며 모든 이전 파일과 후보를 보존한다. 원 보고서 revision·응답 지문을 결속하며 카탈로그 변경 등으로 원 응답을 재현할 수 없으면 다른 내용으로 성공시키지 않고409로 닫는다. |
| retry | revision_conflict는 한 번 다시 GET한 뒤 새 expected_revision과 새 Idempotency-Key로 같은 selected 의도를 한 번만 재시도한다. 통신 결과가 불명확하면 원래 키와 동일 본문으로 먼저 복구한다. 이미 확정된 명령의 본문을 같은 키로 바꾸지 않는다. |
| error | 기존 {status:error,error:{code},request_id} 봉투를 유지한다. current_revision 오류 추가 필드는 필수가 아니며 재조회 응답으로 확인한다. 선언된 사용자표시 상한만 공개 가능하고 내부 요청/동시성/물리 한도는 반환하지 않는다. 개수/본문 초과는 shortlist_limit_exceeded로 원래 상태를 보존한다. 실제 수치 상한·허용 학년도·물리 비용은 기존 승인 정책을 재사용/결속하며 임의 값·null→무제한을 만들지 않는다. |
| migration | GET에는 쓰기를 넣지 않는다. 새 JSON이 없으면 가장 최근의 본인·해당학년도 보고서 shortlist를 origin=legacy_report, revision=0, legacy_source={report_id,report_version}로 읽기 전용 표시한다. 첫 실제 변경 PUT은 예상 legacy source와 현재 원본/본인 소유권을 확인하고 기존 목록을 보존한 JSON revision1에 그 변경만 적용한다. 동시 legacy 변경은409이며 예전 true만 합쳐 해제 학교를 되살리지 않는다. 이미 초기화한 회원 JSON을 legacy로 덮지 않는다. 동일 상태 no-op는 초기화 쓰기도 하지 않는다. |
| printing | 기존 무query report.export 권리는 유지한다. 새 명시 year/expected_report_version/shortlist_revision 요청은 본인 선택 성적 보고서와 정확 관심목록을 독립 결속한다. revision0에서만 optional 쌍 legacy_source_report_id/legacy_source_report_version으로 GET legacy_source의 정확 본인·동일연도 report revision 목록을 읽는다. GET 후 최신 legacy가 바뀌어도 그 목록을 보존하며 JSON 생성·입력권 차감·새 산출은 없다. 쌍을 생략하면 선택보고서가 최신 legacy 원본과 일치할 때만 성공하며 불일치는409다. 쌍 한쪽·잘못된 형식·rev>0의 쌍은422, 타인·다른연도·없는 exact 원본은404다. rev>0은 정확 불변 JSON revision을 사용하고 최신으로 치환하지 않는다. |
| frontend | 화면팀 shortlist.ts의 selectedIds/readPicks/setPick를 전환 지점으로 삼는다. 2·3·4페이지·와일드카드·트레이·인쇄가 같은 회원 목록을 쓰며, 판정 없음은 미산출 안내로 유지하고 GET 진입에 숨은 분석 요청을 붙이지 않는다. 새 operation·설정·정확 배포판의 Owner 영수증 전까지 기존 연결을 유지한다. |

| operation | method | path |
| --- | --- | --- |
| member-shortlist.read | GET | /api/v1/me/shortlist |
| member-shortlist.update | PUT | /api/v1/me/shortlist/{offering_id} |

검수 기준:

- 본인/타인 UUID·만료/일반·paid·active aal2와 relay/CSRF·RLS 검수
- GET/로그인/동일상태 no-op의 계산0·객체 PUT0·큰 DB본문 쓰기0·입력권 차감0
- 표시/assessment 배치조회 횟수가 관심대학 수에 비례해 증가하지 않음
- 빈 목록·실제0·null·pending·참고 환산을 구분하고 native 값을 보존
- legacy 최초복사·동시변경·무목록·원본보존·새JSON우선 검수
- 두기기 한세대 게시·멱등타임아웃·stale fence·키/본문충돌 검수
- 인쇄 후 관심대학/성적변경에도 요청 당시 두 revision·정확목록 보존
- 새2 API·실저장 어댑터·실제 런타임·허용 DTO·현재성 검사 종단 검수
- 기존28 API/기존656와 전용추가시험·정확SHA 정상CI 유지
- Owner 실제 객체/권한/소스/설정/정문 검수 전 운영완료 표시 금지

## Supabase 운영 인수 상태

보관된 이전 운영 검수 이력: 현재 develop57f74b1daabd2d6a8e94de216f182e8bfe6557b7에 서비스phase2와 승인된 병합 하네스 수정이 통합됐다. 정상precommit/prepush/정확HEAD pushCI/PR병합시험CI/최종developCI각678PASS·실패/오류/skip0이며 main은 보존했다. 최소source-only draft18의신규2 ownerINSERT COMMIT/freshapp18과선별Storage18(fullGET/SHA·비인증72건본문미반환)을확인했다. 최종appTLS READONLY exact18/old16불변/new2exact 독립영수증도PASS이며003/13RLS24policy·공개/Storagebaseline보존을확인했다. 원수능AST source는 보존하고 모평적용child3의 source/applicationContext를 분리 확인했다. engine/production/runtimefalse·publishednull과 기본회원경로유지/명시DI만준비선택은 확정 유지다. 공식입결v2/v3의미실패는보존하고 최소선별v4의일부학교/학교년도local·remote native범위PASS를 수령했다. 신규2개DB메타등록을수령하고최소공식source2의독립native58/frozenRAM39를기록했으며전체draft18/발행0·전국완료false를유지한다. 최종freshapp18독립검수도완료했다. StorageRLS메타는현재보호bucket에클라이언트SELECT허용조건없음을확인했으나실제JWT HTTP/운영SECgate는NOT_RUN이다. v2설계승인·최신v1.1/14경로PLAN_ONLY구현계획은 준비됐으나 코드0·품질/newscopeFE공통계약/모형호환·계산채택은 미완료다. 실제JWT/APIorigin·22API/4페이지/보안운영·live배포는 미인수다. 과거제안/실패/fixture·관측은 보존한다.

2026-10-10 Owner 작업 준수(DEP-IO-01-WINDOW): 대량 작업은 매일 02:00~06:00 KST, 최대 4시간의 조건부 창에서 한 팀의 한 작업만 수행한다. 시작 전 경고가 있으면 그날 SKIP하고 일관된 체크포인트에서 중단하며 기존의 더 짧은 배치·bytes·5초·RLS·subject·승인/만료 한계를 유지한다. 소량 조회 예외는 과거57014 전수 쿼리나 요청 수·limit만으로 적용하지 않는다. CAP-03은 정확한 표·PK·열·영향·비삭제 대안의 별도 제거 승인 전 단계이며 registry/overlays를 보존한다. 정확 관측 시각 UNCONFIRMED·원인/예산 회복 미확정·I/O HOLD·컴퓨트 변경 보류다. Storage·정리·VACUUM·read model·배포·PIN/만료 연장·자동 실행은 이번에 수행하지 않았다. 공식 입결 DB 표시 연결 문서의 같은 ID 준수 절을 함께 따른다. 지표 확장/가산점 요약은 데이터팀·서비스팀의 미채택 CR 준비안 검토까지 완료했고 자료 발행·DTO/엔진/화면·실API/BFF 인수는 NOT_RUN이다.

2026-10-10 읽기 모델 수정 후보(spec1.9.33): 사용자 지시에 따라 개발팀은 현재 정본의 검색용 narrow model과 명시 provider/handler·typed 검증·prepared DDL7파일 후보를 구현하고 데이터팀·독립 검토·native 합성 HTTP를 준비한다. 서명 유효성과 전체 원형 census·source coverage/fence 완전성은 별도 판정이며 실제 trusted baseline receipt 부재는 NOT_READY다. 기존 전수5초57014 실패는 보존하고 실제 DDL/GRANT/RLS·model build·성능·새 승인 PIN4·배포·JWT/BFF/브라우저는 NOT_RUN이다. DB 정리·VACUUM·과금 변경은 수행하지 않는다. fresh UI에서는Healthy와 용량 증가만 확인했으며 IOPS/처리량/연결 그래프는 불러오지 못해 I/O 회복 미확정/HOLD를 유지한다.

[Supabase 운영 인수인계](Supabase_운영_인수인계.md)를 따른다. revision 2026.10.07.v9; HTTP 관측 시각 2026-10-06T08:40:54.349322Z.

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

### 별도 정확 승인 FE-P1-RAW-METRICS-20261020

| 정확한 경로 | mode | 고정 Git blob | 원본 바이트 SHA256 |
| --- | --- | --- | --- |
| apps/web/src/app/admissions/results/raw-metrics.tsx | 100644 | 68ffdd44d08cbcc2e6019166b3cfd2b0541b1eb7 | 1a00f2971e85408ea7ddc6327889594c80822abf65f3f57ffde183475719f121 |

사용자 답: 이 파일 1개 삭제 승인; 근거 질문: call_e73eb92e24064873800e5fd807712c6f; 출발 커밋: f4d0bfc4f8453fc4aaa9d20464556ba845df29a8. 사용자가 정확 1개 삭제를 승인했고 이후 이번 네 동시성 수정과 함께 정상 삭제·검수까지 명시했다. 새 snapshot-table로 대체되어 참조 없는 raw-metrics만 제거한다. 이전 4개 승인 기록은 보존한다. 이 별도 1개에도 선행 develop 등록·정확 원문 지문·최초 삭제 1회·정상 부모 승계 검사를 동일하게 적용한다. 실제 실행 결과는 별도 정확 커밋으로 기록한다.

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



<!-- jungsi:generated spec_sha256=4cfa25071bee0ce4595753d8366031c543fd825f79378ec16fd986d17f49e2fc -->
