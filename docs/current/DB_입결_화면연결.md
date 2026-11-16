# Supabase 입결 DB와 화면 API 연결

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.177이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

승인된 화면팀·관리자에게 현재 단일 정본 입결을 실제 서비스 API로 표시; 일반회원 운영 공개는 별도

계약 2026.10.11.v3 · 코드 implemented_current_review_local_owner_intake_and_offline_four_page_diagnostics; C_plus_official_exam_local_native_HTTP_partial_success_and_exact_holds_verified; full_calculation_live_and_general_publication_pending · production_ready=false. 담당 feature/application-pre-data-platform.

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
- 원 DB offering_pk와 GUIDE 화면용 offering_id는 두 namespace다. source_offering_pk와 full29 기대행·원형 PK·year:rawPK/승인 lineage를 각각 검증하며 raw 모집군/전형을 GUIDE 표기에 덮어쓰지 않는다.
- TS의 UTC 시각은 Z와 +00:00을 같은 BigInt microseconds로 해석하고 원 catalog 시각 literal은 변경하지 않는다. HTTP는 기존 Z 및 최대6자리 소수초로 정규화한다. UTC 이외 offset·잘못된 날짜·7자리 소수초를 거절하며 issued 포함·expires 제외·최대24h의 정확 경계를 유지한다. legacy 이용권 owner UUID WHERE·현재 활성기간·session v1 세 필드는 그대로다.
- 안전한 오류 enum만 명시 증분한다. Python 재귀 응답 필터는 유지하고 Edge의 오류 code/status도 허용목록 밖 값은 비밀 없는503으로 필터한다.
- 외부 base에는 /functions/v1/함수명 prefix가 있으나 함수 내부 Request path는 /함수명 prefix다. 화면 중계의 encoded 모집행 ID는 원 ID로 1회 복원하고 기존 API suffix·query·DTO를 유지한다.
- 실제 provider 검수에서 SQLSTATE57014를 관측하면 five-second 조회 제한과 원형 source/typed 값·범위·RLS를 유지하며 안전한503으로 닫는다. 파일 수준 keyset 후보 검수와 실제 payload 미실행을 구분하고 성공한 native/값 대조 없이 runtime 최적화로 채택하지 않는다.
- 이전 metadata EXPLAIN(ANALYZE FALSE)의5초57014·계획 미반환 관측과 원본은 보존한다. 최신 사용자 요청의 단일 fresh v5는 같은 SQL/typed 범위/RLS/5초 제한으로 공급자140지표·12모집행과 HTTP 두 페이지100/40을 확인했다. 실제DB+DI 검수와 실JWT·클라우드·브라우저를 구분하고 원인 미확정인 이전 실패를 새 성공으로 지우지 않는다.
- 승인된 OID 메타데이터 최적화는 같은 qualified 관계명 집합을 unnest→to_regclass→pg_class OID JOIN으로 조회한다. 원11컬럼·namespace/app/nonowner·RLS/read-only·권한 함수·view 정의/옵션·기저3표 forced RLS 검수와5초 제한을 유지한다. payload JOIN/선택 명부/숫자 투영/회원/default/flags는 불변이다. v4 metadata57014는 보존하고 fresh v5의 실제 공급자·입결HTTP100/40·각 dataJOIN1 성공과 실제JWT/Edge 운영 미검수를 별도로 기록한다.
- 이전 v4 동결7파일 검수는 role metadata 통과 후 관계 metadata57014·관측execute6968ms·JOIN0/HTTP0/재시도0/DB쓰기0으로 실패한 이력이다. 새 v5는 사용자 요청의1회 original oracle READONLY 검수로 같은5초 제한·SQL·RLS를 유지해140/12와HTTP 대조를 통과했으며 쓰기/재시도0이다. 데이터팀 후속 v35 DiskFull53100 파일 영수증은 별도 관측이고57014의 원인으로 단정하지 않는다. 제한 확대·대체 쿼리·권한 우회·전국/엔진/운영 승인 승격은 하지 않는다.
- 입결 현재 조회·변경은 DATA_ACTIVE_ADMISSION_CURRENT_v1.json의 단일 정본과 jungsi_data_ingest.admission_results_current를 사용한다. v21_1/C140는 당시 승인된 동결 역사 검수에만 쓰고 현재 정본으로 재승격·전량 재적재하지 않는다. 현재 공급자의 미구현을 역사 검수 성공으로 대신하지 않는다.
- 같은 발표 관측의 원본ID들을 하나의 현재 관측ID의 출처 회원으로 연결하고 과거 원본ID로도 출처/정정 이력을 조회할 수 있어야 한다. 동일 원본 재입력을 방지하고 기대 이전해시·현재지문·원문근거·명령ID에 결속한 멱등 정정 뒤 실제 필드·모집행 연결·중복방지/출처 이력을 검수해 포인터를 마지막에 갱신한다.
- 학년도·전형·군·코호트·통계기준·점수성분·만점·반영식연도/과목 정의가 다른 값을 합치지 않는다. 명칭·PK·라벨 정정만으로 현재 관측ID를 새로 만들지 않으며 충돌과 원본/이전버전/실패를 보존한다.
- DB 원문 아카이브는 비공개 목적지의 새 사본·bytes/SHA·출처와 기존 승인해시 결속을 확인하고 currentview와 동결C 참조 범위의 값·타입·bytes 변경0을 검수한다. 아직 허용하지 않은 DB 제거/포인터치환/DDL/VACUUM은 완료로 표시하지 않는다. 일반VACUUM의 내부 재사용과 물리 파일 용량 반환을 구분하며 FULL의 배타잠금·추가공간/서비스영향을 별도 판단한다.
- VACUUM의 내부 재사용 공간과 물리 파일 감소를 구분한다. 일반 VACUUM 완료만으로 전체 DB 공간 반환을 주장하지 않으며, VACUUM FULL의 배타 잠금·추가 사본 공간·정확한 실행 승인은 별도 검토한다.
- Edge 의존 드라이버가 필요한 Node 전역은 별도 bootstrap을 의존 import 앞에서 평가한다. 엔트리 본문의 단순 Buffer 대입이 static import보다 먼저 실행된다고 가정하지 않는다. 기존 전역은 덮어쓰지 않으며 배포용 동일 번들에서 전역이 없는 초기 상태의 실패 재현·수정본 handler 등록을 검수한다. 기동 회귀는 실JWT·hosted SQL·BFF·브라우저 인수를 대신하지 않는다.
- 사용자가 현재 정본 전수 연결의 첫 범위를 화면팀·관리자 검수로 확정했다. 모든 서비스 대학·학과를 검색할 수 있도록 준비하되 일반 회원 운영 공개를 동시에 채택하지 않는다. 기존 C 검수 승인 범위를 삭제·완화하지 않고 별도 current-purpose와 현재 상태·검수자 범위를 결속한다.
- 현재 정본 검수는 matching_observation_count와 matching_source_school_count를 동일 검색조건·SQL 스냅샷에서 정확히 집계한다. 학교 식별은 (school_id, university_code)이며 검증된 공개 대학 ID의 수와 다르다. SQL 집계는 허용하되 전체 payload 수신·메모리 정렬·N+1 조회는 금지한다. 기존 C 집계 필드는 유지한다.
- current cursor는 서버 전용 키로 암호화하고 검수자·operation·정규화 질의·현재 상태·공개 투영 revision·만료·마지막 고유 키에 결속한다. HMAC 서명만 된 읽을 수 있는 payload에 내부 관측 ID를 넣지 않는다. 정본이나 조건이 바뀐 cursor는 기존 409로 거절한다.
- 현재 source 관측 ID·canonical ID·원 학년도 모집행·공개 offering ID·복수 출처 회원을 구분한다. 모집단·통계 정의를 합치거나 1:N 출처 JOIN으로 지표를 복제하지 않는다. 공개 지표 정의·단위·척도·공식 URL·기준일·발표 상태가 미확보된 행은 임의 발표 DTO로 승격하지 않는다.
- actual current metadata에서 app SELECT·nonowner/nonbypass·읽기 전용·TLS와 실제 RLS/invoker를 확인했다. 이는 새 current-purpose·실제 페이지·공개 metadata·JWT·BFF·브라우저 인수를 대체하지 않는다. 현재 조회 권한이 확인됐으므로 추가 Owner 또는 쓰기 GRANT가 필요하다고 단정하지 않는다.
- registry는 canonical/source 관측 연결과 원형 근거를 보존하는 현재 정본의 직접 의존 표다. 용량 증가만으로 임시 파일·삭제 대상으로 분류하지 않는다. current와 역사 C는 overlays에 실제 의존하므로 단순 전량 정리하지 않는다.
- 파일류 Storage 이전은 기존 exact gzip bytes·SHA·원형 명부·private/익명 거절·remote readback·참조 결속을 먼저 인수한다. DB 원본 제거는 정확한 표·행·열·복구 검산과 별도 사용자 승인 뒤 진행한다. bytea NOT NULL·CHECK·ingest/recovery resolver와 C/현재 정본을 함께 보존한다.
- Storage 이전·overlays 정리·DB 제거·참조 전환·일반 VACUUM·VACUUM FULL의 실행 여부를 각각 기록한다. 현재는 모두 NOT_RUN이고 제거 승인 대상은 없다. 전후 DB/표 bytes·사본 SHA 명부·C140/current field 변경0·유지보수 종류를 한 영수증으로 인수하며 원문·이전 버전은 보존한다.
- 별도 GET /api/v1/review/current-admissions는 허용된 검수자에게만 닫힌 검수 응답을 제공한다. 지표 원문 literal과 원 JSON 타입을 보존한다. 미확인 공식 공개 정보는 null과 보류 사유로 표시하며 active current를 발표 입결로 간주하지 않는다. 기존 C·일반 회원 화면·기본22API·이용권 판정은 유지한다.
- all_current 검수 목적은 명시 허용된 subject와 승인 만료 안에서만 적용한다(최대24시간). 첫 페이지에서 동일 읽기 전용 SQL 스냅샷의 최근 적격 변경 명령 상태를 결속하고 이후 cursor의 상태가 달라지면409로 거절한다. 새 wire 상태 검증은 기존32필드 정본 codec을 대체하지 않는다. 출처 회원 검증과 모집단 연결의 원 멀티셋을 보존한다.
- 파일류와 overlays 정리는 원형 bytes·원격 SHA 재수신·참조 및 복구 reader 검산·C/current 변경0 영수증을 먼저 갖춘다. registry는 출처 연결과 원형 근거를 보존하는 영구 자료다. Storage 복사·resolver 전환·제거·일반 VACUUM·VACUUM FULL은 각각 NOT_RUN이며 제거 대상은 아직 승인되지 않았다.
- Owner 준수 절 / DEP-IO-01-WINDOW: 대량 작업 창은 매일 02:00~06:00 KST, 1회 최대 4시간이다. 시작 전 I/O 배너가 소진 임박·소진 상태면 그날은 건너뛴다. 한 창에 한 팀의 한 작업만 수행하고 새 전용 lease와 안전한 체크포인트를 확인한다. 종료 전에 일관된 체크포인트에서 멈추고, 기존의 더 짧은 배치·bytes·시간·5초 조회 한계를 완화하지 않는다. 이월은 자동 재시작 허가가 아니다.
- Owner 준수 절 / 소량 조회: 기존 승인된 유한 소량 검수 요청만 시간창 예외이며 RLS·역할·subject·자료판·범위·만료와 비용 gate를 유지한다. 요청 수나 limit만으로 저비용을 입증하지 못한다. 이전 57014 전수 조회를 소량으로 재분류하거나 자동 재시도하지 않는다. 이번 준비에서 DB·Storage·read model·VACUUM은 NOT_RUN이다.
- Owner 준수 절 / CAP-03: 정확한 표·행 PK·열·영향·복구 검산·비삭제 대안을 제시하고 별도 Owner 제거 승인을 받는다. 시간창이나 CAP 절차 동의는 제거 승인이 아니다. registry·overlays의 current/C 의존과 원문·이전 판·실패를 보존하며 Storage 이전·참조 전환·제거·VACUUM을 각각 기록한다. 컴퓨트 업그레이드는 Owner 보류이며 과금 변경은 실행하지 않는다.
- Owner 준수 절 / 관측과 승인: 경고 지속은 수신 회신이며 새 Dashboard 실측은 아니다. 원문의 저녁 표기와 오전 작성 시각 불일치로 정확 관측 시각은 UNCONFIRMED다. 실제 회복·원인은 미확정이고 I/O HOLD를 유지한다. 조건부 작업창은 자료판 만료·최대24h·PIN·RLS·subject·발행·live 전환·자동화의 승인을 연장하지 않는다.
- Owner 준수 절 / 후속 CR 상태: CR-HISTORY-METRIC-EXPANSION-01은 인원·비율·발표 단계·코호트·공식 지원자 우선·결측 보류의 데이터 계약 준비안이고, CR-CONVERSION-BONUS-SUMMARY-01은 공식 제도와 학생 실제 적용·성공0점·미확인 보존·유료6개 응답 호환성 준비안이다. 둘 다 미채택이며 공식 자료·public mapping·검수승인/발행·DTO·코드·엔진·실API·BFF/브라우저 인수는 NOT_RUN이다.
- 읽기 모델 후보 / 사용자 수정 지시: 현재 정본을 보존하고 새7파일 후보의 구현·네이티브 합성 검증·독립 검토·공통 기획 및 라우팅 동기화를 진행한다. 기존 current 쿼리의 실제5초57014·성공페이지0은 해결 증거가 나오기 전까지 실패로 남긴다. 후보 코드나 준비 DDL만으로 실제 성능·DB 적용·발행·화면 연결 완료를 선언하지 않는다.
- 읽기 모델 후보 / 경계: 현재 정본이 단일 출처 권위다. 최신 canonical 결정 뒤 정정된 검색 조건을 적용하며 관측 수·학교 복합키 수를 같은 snapshot에서 정확 집계하고100+1 키셋 페이지의 표시 및 검증 근거만 bulk JOIN한다. RAW35·MEMBER32·POP7의 원형 자격을 digest-only 자료로 만들어 내지 않는다. 기존 C·기본22API·이용권·점수 엔진·프런트는 이번 후보의 변경 대상이 아니다.
- 읽기 모델 후보 / 승인과 재개: 자료 완전성 독립 증거, source closure·command 외 변경 coverage·fence, 고정 head·서명 issuer/purpose/유효기간/회수, RLS·최소 역할·TLS·5초 제한을 각각 검증한다. producer bool 또는 자기 해시는 독립 승인 증거가 아니다. 실제 기준 receipt 미제공은 NOT_READY이며 준비 DDL·model build·PIN4·함수 배포·실JWT·BFF/브라우저 인수는 별도 단계다.
- I/O 현재 확인 / 새 관측: Supabase UI에서 프로젝트 Healthy와 용량 증가를 확인했지만 IOPS·처리량·연결 지표가 로드되지 않아 budget 회복은 UNCONFIRMED다. 기존 HOLD와 Owner의02:00~06:00 조건부 창을 유지한다. 시간 밖에 대량 모델 생성·전수 조회·DB 정리·VACUUM을 실행하지 않고 만료된 승인판을 연장하지 않는다.
- baseline과 delta의 학년도·학교 복합키·활성/범위·대표 원본·출처 및 모집단위 멀티셋·해시·영수증을 동일한 전체 대조로 검산한다. 유효한 서명과 맞는 학교 수만으로 서로 다른 의미의 정정을 채택하지 않는다.
- CR-CURRENT-LIVE-02: 사용자의 실제 연결 지시에 따라 현재 단일 정본의 승인된 화면팀·관리자 검수 노출용 live_bounded v2를 채택한다. 기존 frozen v1/C/기본22API와 학생 공개 권한은 유지한다. prepared004·Merkle·독립 전수 census는 현재 검수 표시의 실행 조건으로 두지 않는다.
- live_bounded v2는 전체 count를 수행하지 않고 matching_observation_count/matching_source_school_count=null 및 count_status=unknown을 반환한다. 최대100 표시행과 제한 scan cursor를 제공하며 items0+next_cursor는 검색 완료가 아니다.
- live v2는 같은 READONLY/RLS snapshot에서 최신 command를 첫 페이지에 결속하고 다음 페이지 변경을409로 거절한다. 승인된 정의를 그대로 둔 bounded 물리 복합PK JOIN을 사용하며 raw current 전체 조회·N+1·미검증 fallback은 하지 않는다.
- current review의 비공개 descriptor PIN과 cursor 고정키는 Git제외 서버 배포 artifact로 주입할 수 있다. 기존7개의 DB/Auth/Storage/relay 서버env를 재사용하고 브라우저·공개코드·로그에 설정을 전달하지 않는다.
- 현재 review API와 학생 1페이지 History DTO는 다른 계약이다. 화면팀은 검수 전용 서버 BFF에서 v2를 소비하고 review_only/not_published·결측/보류와 unknown count를 표시한다.
- 현재 검수 화면의 공통 서버 tokenFile 기능검수는 방문자 관리 권한 인수를 대신하지 않는다. 내부 경로는 소비자4페이지에 추가하지 않으며 네트워크 공개 전 방문자 세션·허용 명부 또는 사설 접근 통제와 기존 운영gate를 입증한다. cursor는 서버4096자 범위에서 불투명 원문 그대로 전달하고 절단하지 않는다.

## 기존 API와 구현 경로

| 항목 | 값 |
| --- | --- |
| python_reference | src/jungsi_touch/infrastructure/official_history_display.py |
| edge_entry | supabase/functions/official-history-display/index.ts |
| edge_application | supabase/functions/_shared/official_history_display.ts |
| edge_infrastructure | supabase/functions/_shared/official_history_postgres.ts |
| default_factories_changed | True |
| entitlement_authority | public.jeongsi_passes |
| existing_API_count | 22 |
| new_logical_API_or_DTO | False |
| browser_DB_credentials | False |
| relay_header | X-Jungsi-Relay-Token |
| python_factory | create_official_history_display_app |
| edge_factory | createOfficialHistoryDisplayHandler |
| edge_provider | createOfficialHistoryInfrastructure |
| logical_operation_count | 5 |
| edge_node_compatibility_bootstrap | supabase/functions/_shared/node_compat_bootstrap.ts |
| opening_change_ref | opening_security_operations_contract |

논리 작업: history.search, offerings.search, offering.read, recruitment.read, session.read. 기존22 API 중 명시한 조회 부분만 연결하며 전체 엔진 포팅 완료를 뜻하지 않는다.

## 담당 작업

| 작업 | 담당 | 범위 |
| --- | --- | --- |
| DBD-01 | 데이터팀 | exact 원행/curated 기준의 원형·타입·PK·학년도 대조와 필요 최소 app SELECT 권한/성능 검수 |
| DBD-02 | 서비스 개발팀 | 명시 표시 공급자와 Python reference·Edge ports/adapter·인증/오류/DTO 호환 구현 |
| DBD-03 | 시스템기획팀·서비스 개발팀 | 목적별 제한 검수 승인·불변 private descriptor·설정·동일 후보 API 수치 대조 |
| DBD-04 | 외부 화면팀 | API transport prefix와 서버 relay 연결·실제 로그인·1페이지 원지표/보류/오류 브라우저 검수 |
| DBD-05 | 외부 화면 개발팀의 Supabase 관리자 | 사용자가 위임한 비공개 Edge 설정 등록을 담당한다. 비공개 전달/정확 후보 확인 후 등록 증거를 제출한다. 제한 함수의 실제 배포는 별도 승인·검수와 구분하며 계정·DB 권한 변경이나 전체 운영 승인으로 확대하지 않음 |
| DBD-06 | 데이터팀·서비스 개발팀 | 별도 reviewer source6·native check6/합성41·source-only 번들 기동 PASS인 개발 후보다. 현재 단일 SQL의 실제 filtered/count/page 및 payload는 기존5초에서57014로 실패했다. 현재 수정값·RLS·정확 count를 보존하는 경량 조회/projection·색인 공급자 변경 CR과 실제 성능 PASS가 선행돼야 한다. 새 승인/PIN4·배포/JWT/BFF/보안 인수는 미실행이고 기존 C/22API·기본이용권은 유지한다. |
| DBD-07 | 데이터팀; 시스템기획팀·화면팀 독립 검수 | 최신 실제 크기와 current/C root별 의존을 검수; registry 정본 직접 의존 보존 판정. Storage 원형 이전·overlays 정리·참조 resolver·정확 제거 승인·전후 변경0·일반/FULL VACUUM은 NOT_RUN |
| DBD-08 | 서비스 개발팀; 시스템기획팀·데이터팀·외부 화면팀 독립 인수 | 배열 I/O 수정·정상853+853·native44·실제 readonly provider·통합/재배포 완료; 외부 화면팀 최종 fresh JWT C140/12·cursor·paid403·auth/relay/no-store PASS 영수증 수신. current 전체·BFF/브라우저·운영 보안3gate는 별도 미완료 |

## 화면팀 연결

- 브라우저·화면 코드·일반 프런트 환경은 기존 API의 공개 응답만 읽는다. app DATABASE_URL/DB CA/Storage secret/descriptor/원자료/전체 DB를 수령하지 않는다. 지정된 Supabase 관리자가 비공개 app-only 기본7 설정을 등록하는 역할은 별도 인계 범위다. migration-owner 접속값·키는 외부 화면 환경에 전달하지 않는다.
- 제한 검수 API가 실제 배포·응답 검수된 후 관측한 base URL과 transport prefix·공개 Auth 설정을 받는다. 예측한 주소로 live 전환하지 않는다.
- relay는 비공개 서버 설정으로 전달하며 사용자 JWT는 BFF에서 재검증해 보낸다. 실제 학생 성적·토큰은 채팅/공유 문서/Git에 넣지 않는다.
- 다른 PC는 같은 candidate에서 실제 원지표·타입·출처·검색 조건·401/403/503·no-store와 전달물 비노출을 검수한다.
- DB 행 수가 늘어도 행별 조회를 추가하지 않는다. 같은 요청의 data JOIN 1회 증거와 실제 RLS 영수증을 별도 확인한다.
- 현재 계정의 Edge Secret 관리권한은 없으며 지정된 화면팀 Supabase Owner/Administrator가 비공개 설정을 등록한다. 함수 generic 코드 배포 권한은 별도로 관측하여 실제 배포와 URL 확인을 완료했다. Secret 권한·DB SELECT·사이트 관리자·함수 배포를 서로 대체하지 않으며 권한 우회는 하지 않는다.
- 이 제한 검수 함수의 base는 5개 GET operation 전용이다. 기존 22API의 전역 base를 일괄 live 전환하지 않는다. 1페이지의 history.search/recruitment.read/session.read와 유료 offerings.search/offering.read에만 명시 operation routing으로 연결한다.
- 미포팅 17API와 2~4페이지의 성적·환산·지원판정 엔진은 이 함수로 준비 완료되지 않았으며 pending/503을 유지한다. 관리자·개발자 계정의 관리 권한을 유료 이용권으로 자동 승격하지 않는다.
- 화면 팀은 기존 페이지 및 operation별 routing과 transport prefix를 대조하여 연결한다. CSS·화면 구현·BFF 및 브라우저 실수신 검수는 외부 화면 팀 담당이며 서비스 소스·합성 검산으로 대신 완료 처리하지 않는다.
- 화면팀의 2026-10-09T14:28:39Z 최종 freshJWT 영수증을 수신했다. 기존 C140 값·타입·출처·모집행 메타와 cursor100+40·recruitment12 pending/null·paid403·auth/relay/no-store 검수가 보고상 PASS다. Root 재실행·current 전수·BFF/브라우저·운영 보안3gate 완료로 확대하지 않는다.
- 등록된 PIN3와 실제 관측 URL로 동결 C140 역사 검수 GET5개만 명시 연결한다. 기존22API 전역 live 전환·기본 회원/이용권 변경·2~4페이지 엔진 승격은 하지 않는다. 실제 로그인·두 cursor 페이지·지표 값/타입/근거·no-store/중계/브라우저 비노출을 별도 검수한다.
- C 수신 기계 검수 원영수증 원형과 선택명부·manifest·승인4tuple·경로2필드의 typed/bytes 일치를 독립 검토하고 Root가 정확한 선택명부 SHA의 동결 local_verification 경로 변경을 수용했다. 화면팀은 기존README3~5단계를 실행·회신한다. 수용 기록은 CLI/캐시/세션/API/브라우저의 실제 실행 완료나 새 엔진/운영 권한을 뜻하지 않는다.
- 배포된 함수의 JWTlegacy ON은 그대로 둔다. 실제 ES256 사용자 JWT를 BFF에서 보내 플랫폼/함수 상태를 구분하고, 401을 API 키의 사용자 Bearer 대체나 인증 설정 자동 해제로 해결하지 않는다. 24h 목적 승인 만료 후에는 새 승인판을 요구하며 임의 연장하지 않는다.
- 현재 입결 조회는 비공개 DATA_ACTIVE_ADMISSION_CURRENT_v1.json과 고정 jungsi_data_ingest.admission_results_current를 따른다. 현재 배포 source의 v21_1/C140 공급자는 동결 역사 검수용이며 현재 정본 조회로 안내하지 않는다. 현재 정본 공급자는 canonical/source 관측ID·현재 지문·출처 회원·metadata·목적승인·실제 app SELECT/RLS를 결속하는 별도 구현이 필요하다.
- DB 용량 정리는 데이터팀 소유 schema의 별도 작업이다. csv/support gzip 원형·overlays 검수 근거를 비공개 Storage/Drive 보존하고 사본 bytes/SHA/원래 해시 참조를 대조한 뒤 정확히 허용된 DB 제거만 별도 판단한다. NOT NULL/길이CHECK와 current/C 역사 의존을 먼저 확인하며 포인터만 치환하거나 전량 재적재하지 않는다.
- DB 용량 메타데이터만 실제 앱1연결 READONLY/TLS로 확인했다. 대상3표의 RLS/FORCE·SELECT전용과 gzip NOT NULL·현재/역사 overlay 의존을 확인했지만 사본 원격 bytes/SHA·삭제·VACUUM을 실행한 것은 아니다. 주석 분리 preflight 실패는 접속0으로 보존하고 정정본1회 성공과 구분한다. 최신 실측 bytes와 후보 명부·실행 단계는 별도 비공개 인계 영수증에 보관한다.
- 1차 WORKER_ERROR/Buffer·2차 subject 제한·3차 history/recruitment503과 정상 보안 응답은 이력으로 보존한다. 배열6개 입력·reloptions 타입 보완과 native39+원형wire5·actual provider140/12/JOIN1, 정상 source/docs 통합·같은 committed 번들 기존 함수 재배포는 완료다. 외부 화면팀은 같은 URL/relay/PIN3/공개Auth에서 fresh JWT140지표100+40·유료403·recruitment pending/null·no-store·BFF 토큰 비노출을 원승인 만료 전에 재검수한다. 만료 후에는 새 승인판이 필요하며 권한·기간을 임의 확대하지 않는다.
- 전수 current 연결은 화면팀·관리자 검수 환경에서 별도 승인된 purpose/상태/subject와 operation routing으로 제공한다. 기존 C 함수·PIN3를 범위 없는 조회로 바꾸거나 학생 운영 화면에 전체 DB dump를 배포하지 않는다. 승인 후 공급할 base URL과 서버 설정을 정확한 배포 영수증으로 전달한다.
- [이력: live_bounded v2 배포 이전] 현재는 current 공개 projection·공개 offering ID 대응·정본 상태 결속·서버 cursor 키·새 승인판이 준비 단계다. 앱 읽기 권한 메타 확인은 완료했고 현재 실제 페이지·함수 배포·화면 수신은 미실행이다. DB 접속·원자료·Storage 경로·새 cursor 키는 브라우저에 전달하지 않는다.
- DB 정리 회신에는 registry 직접 의존·보존 판정과 원형 Storage 복사·overlays 정리·참조 전환·제거·일반/FULL VACUUM을 각각 RUN/NOT_RUN으로 적는다. 역사 C/v21_1과 단일 최신 current 정본을 서로 대체하지 않고 둘의 변경0 근거를 보존한다.
- [이력: live_bounded v2 배포 이전] 별도 current-admission-review 함수의 GET /api/v1/review/current-admissions는 허용 명부에 있는 검수자만 사용한다. 1페이지의 공개 History DTO와 다르며 literal·원 타입·보류 사유와 암호화 cursor를 제공한다. 원 canonical/source ID와 비공개 경로는 응답에서 제외한다. 구체적인 자료판 검수 후 Supabase 관리자가 신규 이름의 PIN3·cursor 키를 등록하며 기존 C 설정은 유지한다.
- registry 용량 요청은 실제 읽기 전용 크기·의존 검수와 함께 회신한다. registry는 현재 정본의 직접 의존 표이며 overlays는 현재 정본과 역사 C 모두가 사용한다. 파일류가 SQL 뷰 의존 목록에 없다는 사실만으로 아카이브·재생 안전을 확인한 것은 아니다. 정확한 복사·복구·제거 범위·유지보수 조건을 인수하기 전까지 두 정리 작업과 VACUUM은 미실행이다.
- [이력: live_bounded v2 배포 이전] 이번 수정은 explicit 읽기 모델 provider/handler 후보와 native 합성 HTTP 경로를 준비하는 서비스·데이터 계층 작업이다. 실제 DB 스키마·독립 baseline/seal·I/O 비용·5초 페이지·새 검수 승인판·배포가 완료되기 전에는 기존 화면을 live로 전환하거나 전수 검수 완료로 기록하지 않는다. 화면팀은 최종 회신의 코드/문서/검증 경계와 NOT_RUN을 구분해 인수한다.
- live_bounded v2는 전체 count를 수행하지 않고 matching_observation_count/matching_source_school_count=null 및 count_status=unknown을 반환한다. 최대100 표시행과 제한 scan cursor를 제공하며 items0+next_cursor는 검색 완료가 아니다.
- live v2는 같은 READONLY/RLS snapshot에서 최신 command를 첫 페이지에 결속하고 다음 페이지 변경을409로 거절한다. 승인된 정의를 그대로 둔 bounded 물리 복합PK JOIN을 사용하며 raw current 전체 조회·N+1·미검증 fallback은 하지 않는다.
- current review의 비공개 descriptor PIN과 cursor 고정키는 Git제외 서버 배포 artifact로 주입할 수 있다. 기존7개의 DB/Auth/Storage/relay 서버env를 재사용하고 브라우저·공개코드·로그에 설정을 전달하지 않는다.
- 현재 review API와 학생 1페이지 History DTO는 다른 계약이다. 화면팀은 검수 전용 서버 BFF에서 v2를 소비하고 review_only/not_published·결측/보류와 unknown count를 표시한다.
- current-admission-review v2를 실제 Supabase에 배포했고 무인증/relay/JWT 거절5건을 검수했다. 기존 승인 두 계정·서버 BFF·relay를 재사용하여 현재 정본 검수 화면만 즉시 연결한다. 새 PIN4 등록/read model/census 준비를 화면 연결 선행 조건으로 요구하지 않는다. actual factory Storage+DB 두 페이지200100은 통제 세션DI이며 fresh user JWT·BFF·브라우저 성공은 화면팀 영수증으로 별도 확정한다. 응답v2 unknown count null/empty items+cursor/409새조회 계약을 사용하며 기본22API·기존C는 보존한다.
- [이력: v9 local Owner 회신 수용 이전] 2026-10-10 화면팀 freshJWT API 및 /management/current-review 검수 목적 BFF/브라우저 기능 영수증을 수신했다.100+100·unknowncount·empty+cursor·보류/원형·비노출을 보고상 확인하고 16dea213의 cursor256절단 수정 후 재시도PASS를 기록한다. 방문자 gate 또는 사설 접근 통제는 미입증이며 외부 노출 전 필요하다. 외부 PR18 미병합·409 실관측·전체 운영3gate·일반 발행·W1/W2/CAP는 별도 미완료다.
- v9/bf6435d local 127.0.0.1:3003 실JWT200100+수동200100 및 HTML4비밀값 미출현 보고를 수용한다. local 조회를 막는 발견사항0이며 BFF no-cache와 Edge no-store 기존근거는 구분한다. live 방문자·409·운영3gate·일반공개·전체4페이지 계산 완료로 확대하지 않는다.
- Owner 확인 범위는1~4페이지 전체다. current-review18필드와 C5GET만 연결한 것으로 완료 처리하지 않는다. owner_status_view의 페이지별 최소자료·기존22API·독립 성공/pending 보존 규칙을 따른다.
- 고정hold3개와 null공식메타6개는 현재 공급자의 일반 공개 자격 제한이다. source_review_status는 DTO에 없고 모든 원문/매핑이 미검수라는 뜻이 아니다. aggregate배지는 inference=false에도 붙으므로 link_kind/참조연도를 함께 본다.
- C140은 제한된 역사 검수 승인이다. 일반 회원 발행과 구분하며 C recruitment pending/null은 공급자 구현 상태로 표시한다. 자료 등록만으로 자동ready가 된다고 안내하지 않는다. 최종 합격 예비번호와 추가 합격 인원은 별도다.

## 로컬 Owner·화면팀의 1~4페이지 확인

Supabase Owner·화면개발자가 local에서1~4페이지의 실제 연결·자료·독립 성공/보류를 모두 확인. DB/source 등록과 승인 native runtime 선택은 별개다. 검수 화면 하나의 수신을 전체 네 페이지 계산 완료로 표시하지 않는다.

| 페이지 | 로컬 화면 경로 | 기존 작업 | 최소 실제 자료 | 현재 증거와 보류 |
| --- | --- | --- | --- | --- |
| 1 | /jeongsi/admissions/results | session.read, history.search, recruitment.read | approved_catalog_binding, qualified_official_metric_definition_unit_scale_source_year, approved_recruitment_object | 최신 v3 화면팀 영수증v2 수용: 선정 공식 통계3종과 기존C카드 표시 PASS. 최종 합격 예비번호는 번 단위 독립 열이며 충원인원/추정 재료로 사용하지 않는다. browser 전지표/cursor 전수 재검수와 일반 전국 발행은 별도다. · 발표 지표와 화면 추정열을 분리한다. 실제0·미공개·미확인·해당없음 구분. 모집 pending은 실제0가 아니다. |
| 2 | /jeongsi/reports/me | session.read, score-profile.create, overall.analyze, report.read, university.analyze, report.export | exam_pack, total_model, owned_score_profile_and_report | 최신 v3 화면팀 영수증v2 수용: 가상1건 일반/유료 및 두번째 가상성적 유료 수정·저장·총점 보존 PASS. 전체누백은 total_model_missing 보류다. 두번째 일반 역할 browser는 이번 영수증에 없으며 전체모형은 미채택이다. · 시험팩 검증 성공 과목·등급·총점을 표시한다. 총점모델 부족이면 누백만pending/null이며 과목 주변분포로 국수탐 공동분포를 대신하지 않는다. |
| 3 | /jeongsi/admissions/possibilities | session.read, offerings.search, offering.read, university.analyze, shortlist.update | approved_target_exam_year_catalog_offering, exam_pack, UniversityConversionRelease_PK_binding, approved_September_mock_compatibility, approved_university_percentile_curve, approved_offering_analysis_or_published_forecast, approved_year_bridge_for_past_year_comparison | v3 숫자/역할/연도 보류 증거를 재사용한다. FE-V3-REASON-01 영수증의 f139bfb 유료 P3에서 성공 환산·대학누백 분포 미발행·지원판단 기준 미결속을 독립 표시한 browser PASS를 수용했다. 문구3코드 소스 일치·PR30 develop 통합 완료. 나머지2코드의 browser와 Root 재실행·운영 인수는 NOT_RUN이다. · conversion·percentile·assessment를 분리한다. 판단pending에도 성공 환산·누백·현재연도 점수를 보존하며 학과별 범위·지원자격을 표시한다. |
| 4 | /jeongsi/admissions/favorable | session.read, candidates.build, shortlist.update, statistics.read | page3_native_dependencies, compatible_standalone_total_or_approved_embedded_target_total_baseline, approved_university_curve, owned_candidate_and_shortlist_snapshot | 최신 v3 화면팀 영수증v2 수용: 판단보류1모집행·상위pending·와일드카드보류 및 금지문구0 PASS. 추천/유불리 수치는 미산출이며 성공 환산점수는 저장 분석에 유지한다. · 기본학교·학과별범위·와일드카드·판단보류·추천밖·조건미충족을 구분한다. 빈추천과 자료보류는 다르며 동일시험/모집단/동점 기준 확인 전 유불리 폭을 보류한다. candidates.payload의ready·빈목록보다 상위analysis_status와reason을 함께 보며 pending을 추천완료로 표시하지 않는다. |

전체서비스 명시 factory: jungsi_touch.infrastructure.supabase_runtime:configured_supabase_app. localhost bind는127.0.0.1이다. 기존 local_verification의 승인 목적 cache+명시DI+메모리 report로1~4페이지 시사가 가능하다. 운영 factory의 production_allowed gate를 local시사 필수로 확대하지 않는다. local 승인 native가 먼저 필요하며 재시작 유실 경고·역할·loopback을 유지한다. Supabase Owner 권한은 유료 이용권·본인 소유권·승인 subject를 자동 우회하는 조건이 아니다.

### 자료 자체와 현재 공급자의 제한

| 배지/상태 | 해석 |
| --- | --- |
| review_only | 검수 전용 응답. 원문 검수 완료 여부는 별도다. |
| present | 원문 scalar의 타입 보존. 실제0를 보존하며 공란/대시 문자열이 공식 유효점수라는 뜻은 아니다. |
| actual_null | 원문의 명시null. missing·실제0와 구분한다. |
| missing | 이 응답에서 사용할 원문 값 없음. 실제0로 채우지 않는다. |
| held | 정합성 등 사유로 응답 literal/numeric을 보류. 원DB 삭제가 아니다. |
| review_only_not_published | 모든행 고정: 이 공급자가 일반 공개 자격을 제공하지 않음. 행별 실제 발행 검수 상태 단정 금지. |
| public_offering_mapping_not_qualified | 모든행 고정: 이 공급자가 소비자 모집단위 연결 자격을 제공하지 않음. 실제 원문 매핑 실패 증거가 아님. |
| official_metadata_not_qualified | 모든행 고정·공식메타6개null: 이 공급자의 미제공 공개 메타. DB원문 결측 증거가 아님. |
| aggregate_or_forward_reference | 개별 모집행 추론허용false에도 붙음. link_kind와 참조연도로 실제 집계/전방참조를 구분. |

count_status=unknown·matching count2개null. 페이지 행수는 전국 총건수가 아니다. 빈items+next_cursor면 수동 다음범위가 남는다. source_review_status는 현재18필드 DTO에 없다. 공식 메타6개null은 공급자의 미제공 투영이며 DB원문 결측을 뜻하지 않는다. C140은 제한된 역사 검수 승인이다. C recruitment는 현재 pending/null로 고정되며 자료 등록만으로 자동ready가 되지 않는다. 최종 합격 예비번호는 추가 합격 인원과 다르다.

### 로컬 상태 점검 명령

프로젝트 src를 PYTHONPATH에 둔 비공개 서버 환경에서 실행한다.

```powershell
python -B -m jungsi_touch.infrastructure.supabase_runtime --page-readiness
python -B -m jungsi_touch.infrastructure.supabase_runtime --review-status-file <outputs 내 단일 v2 JSON 절대경로>
```

네 페이지 명령은 설정 존재성과 비공개 registry/selection metadata만, 단일응답 명령은 제외폴더의 최대1MiB·100행 캡처만 읽는다. DB/Auth/Storage/네트워크·엔진·환경파일 변경은 없고 실값·학교명·토큰·cursor·경로를 출력하지 않는다. metadata 적격은 실제 decoder·버전 결속·화면 연결 완료가 아니다. 부족한 자료는 capability별로 보류하며 다른 페이지 성공을 지우지 않는다. Root의 기존 local native/API 실측 범위: 새 목적별 승인 catalog+exam 명부를 실제 local cache/4역할 세션/loopback8001 전체22route 구성에서 검수했다(51HTTP요청·362 assertion PASS). C140·모집행12와 과목성적/총점을 확인하고 누백/대학판단은 정확보류했다. 22operation전수검수·실Auth·DB·Storage·브라우저는NOT_RUN이다. 이후 별도 화면팀 브라우저 영수증3964B/SHA d92146de758cc5cbb41e629ec7ede697619a2b7ea52c3ad1513307f2b03007ff를 수용했다. P1선정4카드·P2virtual386 과목/총점·P4상위/와일드카드pending 표시 PASS, P3일반유료게이트/2027빈범위 UI 부분PASS다. Root 새브라우저실행0·browser140/cursor/모집행전수·virtual313·P3역사3코드·실Auth/DB/Storage·live409·이번no-store헤더·운영3gate·일반공개는NOT_RUN이다. 영수증의bf6435d+미지정후속수정과별도 source385a506/880CI 성공은동일런타임 SHA증명으로합치지않는다.

화면팀 구현 기준:

- local Owner 모드에서 네 소비자 화면 경로를 모두 열고 실제 응답·미연결·자료보류를 각각 표시한다. 일부예시를 실제자료로 대체하지 않는다.
- current-review는 원문 관측 검수 화면으로 유지하고 고정배지 뜻을 정정한다. 기존18필드·query/cursor 원문·수동진행을 유지한다.
- 1페이지 History DTO와 current-review DTO는 별도다. 공개 모집행·지표정의·단위·출처·승인 binding을 공급자에서 결속한 뒤 발표 결과로 표시한다.
- 2~4페이지는 기존 전체22route의 최소 native 공급자와 명시 연결한다. C5GET 주소를 전역base로 적용하거나 합성 응답을 실DB계산 성공으로 표시하지 않는다.
- 독립 환산/누백 성공은 즉시 표시하고 부족한 후속판단만pending. local시사와 실Auth·실이용권·영속DB·일반공개 인수는 구분한다.
- 새 local4페이지 기능수신은 frontend_browser_acceptance에 별도로 기록했다. 기존 Root native브라우저NOT_RUN 역사필드는보존하며 C140전수API와선정입결카드browser를구분한다. P3현재2027 ready/items=[]의자료안내는UI분기이고서버DTO/발행상태변경이아니다.
- 다음 실제계산 검수는 동일2027모집행1개부터 승인catalog/환산rulePK/9월호환을결속한다. 대학곡선·analysis는기능별로추가하고 역사3보류코드/virtual313·실Auth/DB/Storage·live409·이번private,no-store브라우저헤더·운영3gate는각별도증거로인수한다. PR18open·main유지를기능수신완료와분리한다.
- v3 숫자/보류흐름은 frontend_v3_browser_acceptance, 지원판단 문구3종과 최신 유료 P3 후속 수신은 frontend_reason01_acceptance를 참조한다. FE-V3-REASON-01의 추가 ACK 대기는 종료한다. 기존 API/역할/브라우저 증거를 재사용하며 운영3gate와 미관측2코드 browser는 별도로 유지한다.

### W6 첫 발행과 사람 판정 UI 회신

첫 일반 공개 발행일은 현재 미정이다. local 검수 수신 완료와 별개이며 고정배지3개로 실제 검수 진행률을 산출하지 않는다. 첫 부분 배치 단위: 학교·캠퍼스·학년도·모집단위·전형·군·공식지표별 부분발행. 학교4개년 요강 연결 근거를 재사용하며 실제 발표 입결 연도만 제공하고 미발표연도는null.

자동 검사 대상: key_year_track_group_binding, scalar_type_unit_scale_definition, source_state_hash_binding, same_observation_deduplication, approved_lineage_reference_scope. 사람 판정 대상: conflicting_official_source, split_merge_reorganization_aggregate_definition, ambiguous_cohort_statistic_unit_phase. 자동/수작업 비율은 새 분모를 재측정하지 않아 미확인이다.

검수 UI 계약은 CR_REVIEW_DECISION_UI_01_candidate_not_current_mutation_API 상태이며 현재22API에 새 쓰기 경로가 등록된 것이 아니다. 후보 입력: opaque_review_item_id, expected_revision_and_fingerprint, decision_dimension, decision, reason_code, evidence_reference, idempotency_key; 판정 approve, hold, reject. 서버는 권한·revision409·불변 감사·idempotency를 유지하며 검수 판정만으로 일반 발행이나 엔진 승인을 자동 수행하지 않는다.

W1 합류: 기존 history DTO의 공식 통계 표시 의미를 최소 목적에 채택한다. 모집단계·정의·단위·출처·명시 모집행이 확인된 항목만 부분판에 포함한다. 단계 미확인 항목은 후속판으로 보존하며 C 덮어쓰기·전량 재인입은 하지 않는다. W3의 bounded 연결과 W4의 제한 기능 수신은 완료 이력을 보존한다. W1~W6 모두가 같은 차단 상태는 아니다.

## 증거와 미실행 범위

| 항목 | 상태 |
| --- | --- |
| source_db_read_only | PASS_FRESH_V5_SCOPED_APP_ROLE_TLS_READONLY_PROVIDER_140_METRICS_12_ANNUAL_OFFERINGS; ORIGINAL_V4_57014_PRESERVED; NOT_FULL_SERVICE_ACCEPTANCE |
| python_reference_HTTP | PASS_17_NATIVE_SCOPED_SYNTHETIC_AND_FRESH_V5_ACTUAL_DB_HTTP_WITH_SYNTHETIC_DI_AUTH_HISTORY_100_40_ME_3_FIELDS_NEGATIVE_PAYLOAD_ZERO; REAL_JWT_CLOUD_BFF_BROWSER_NOT_RUN |
| Deno_check_test | PASS_NATIVE_DENO2_9_7_CACHED_ONLY_CHECK_POSTGRES_PUBLIC_TEST_BOOTSTRAP_TEST_PRIVATE_PRIMARY_WIRE_ROOTS; PUBLIC_SERVICE36_PLUS_BOOTSTRAP3_EQUAL39_AND_PRIVATE_REAL_BIND_WIRE5_EQUAL44_TOTAL; EMPTY_SYNTHETIC_PROCESS_ENV_ONLY_NO_SECRET_VALUES_DB_OR_NETWORK; DEPLOYMENT_AND_FRESH_JWT_INTAKE_SEPARATE |
| restricted_cloud_API | RECEIVED_FRONTEND_FINAL_REPORT_2026_10_09T14_28_39Z_FRESH_JWT_HISTORY140_EXACT_TYPED_FIELDS_CURSOR100_PLUS40_NO_DUPLICATES_OR_MISSING_RECRUITMENT12_PENDING_NULL_ME200_STANDARD_PAID2_GET403_AUTH_RELAY_NO_STORE_PASS; ONLY_HISTORICAL_C_FIVE_GET_SCOPE; ROOT_NOT_A_NEW_JWT_RERUN |
| actual_user_JWT | C140_HISTORICAL_REPORT_PRESERVED; CURRENT_REVIEW_API_FRESH_JWT18_REPORTED_PASS_RECEIPT_READ_AND_CAPTURE_SHA_VERIFIED; not_independent_rerun_not_all_API_operation |
| frontend_BFF_browser | ORIGINAL_16dea213_REPORT_PRESERVED_NEW_bf6435d_LOCAL_OWNER_FE_REPORTED200100_PLUS100_AND_HTML4_SECRET_ABSENT_RECEIPTS_MATCH_ROOT_RERUN0_BFF_NO_CACHE_NOT_NO_STORE_LIVE_409_OPERATING3GATE_ALL4_NATIVE_RUNTIME_NOT_RUN |
| operational_security_three_gates | NOT_RUN |
| effective_RLS | EXISTING_APPROVED_C_SOURCE_APP_ROLE_GUARDS_PRESERVED; NEW_CURRENT_METADATA13_RELATIONS_PHYSICAL8_RLS_FORCE_VIEW5_INVOKER_BARRIER_APP_SELECT_ONLY_ANON_AUTH_DENIED_PASS; CURRENT_TYPED_PAGE_AND_HOSTED_CURRENT_SERVICE_ACCEPTANCE_NOT_RUN |
| bulk_JOIN_query_count | PASS_FRESH_V5_ACTUAL_PROVIDER_DATA_JOIN_1_HISTORY_HTTP_PAGE_100_JOIN_1_PAGE_40_JOIN_1; TOTAL_DATA_JOINS_3; AUTH_ROLE_ENTITLEMENT_METADATA_COUNTED_SEPARATELY_NO_N_PLUS_1 |
| cloud_deployment | PASS_EXISTING_FUNCTION_ARRAY_IO_REDEPLOYMENT_VISIBLE_UI_EDITOR_READBACK_LF_BYTES_SHA_EXACT_COMMITTED_BUNDLE_JWT_GATE_ON_UNCHANGED; ONLY_SOURCE_DEPLOYMENT_NOT_FRESH_USER_JWT_BFF_BROWSER_OR_WHOLE_SERVICE_ACCEPTANCE |
| keyset_optimization | PRIVATE_PROPOSAL_SCOPE_EQUIVALENCE_ONLY; REAL_METADATA_TIMEOUT_BEFORE_NEW_PAYLOAD; NOT_ADOPTED_IN_RUNTIME |
| cloud_configuration_registration | PASS_BASE7_AND_PIN3_DESIGNATED_OWNER_REGISTRATION_ROOT_EXPECTED_RECEIPT_DASHBOARD_DIGEST_MATCH; NO_SECRET_VALUES_OR_ROLE_RLS_CHANGES; NOT_RUNTIME_ACCEPTANCE |
| base_configuration_registration | PASS_OWNER_RECEIPT_V2_AND_ROOT_DASHBOARD_7_NAMES_TIMESTAMPS_WITH_PRIVATE_EXPECTED_VALUE_DIGESTS_ALL_7_EXACT_MATCH; NO_SECRET_VALUE_EXPOSURE; NOT_RUNTIME_ACCEPTANCE |
| final_descriptor_configuration | APPROVED_PRIVATE_STORAGE_FILE_READBACK_AND_PIN3_REGISTRATION_DIGEST_MATCH; ISOLATED_FROZEN_HISTORY_REVIEW_ONLY; NOT_CURRENT_CANONICAL_OR_PRODUCTION |
| metadata_plan_diagnostic | FAILED_SQLSTATE_57014_FIVE_SECOND_BOUND; EXPLAIN_ANALYZE_FALSE_RETURNED_NO_PLAN; METADATA_SELECT_AND_PAYLOAD_NOT_RUN_IN_THIS_DIAGNOSTIC; CAUSE_UNCONFIRMED_NO_RETRY |
| further_real_database_execution | FRESH_USER_REQUEST_AUTHORIZED_SINGLE_V5_ORIGINAL_ORACLE_PROBE_PASS; ATTEMPTS_1_RETRIES_0_WRITES_0; NO_UNBOUNDED_RETRY_TIMEOUT_EXTENSION_FALLBACK_KEYSET_OR_AUTHORITY_CHANGE |
| before_metadata_optimization_actual_provider | FAILED_SCOPED_ORIGINAL_PROVIDER_OR_METADATA_DIAGNOSTIC_SQLSTATE_57014_WITH_FIVE_SECOND_BOUND; ORIGINAL_FAILURES_PRESERVED |
| metadata_lookup_optimization | QUALIFIED_NAMES_UNNEST_TO_REGCLASS_PG_CLASS_OID_JOIN_SAME_PREDICATE; FRESH_V5_ACTUAL_PROVIDER_GUARDS_AND_PAYLOAD_HTTP_PASS_WITH_5_SECOND_BOUND; PRIOR_V4_TIMEOUT_PRESERVED_CAUSE_UNCONFIRMED |
| current_actual_provider_v4 | HISTORICAL_FAIL_AT_OID_RELATION_METADATA_QUERYCANCELED_SQLSTATE_57014_UNDER_CONFIGURED_5_SECOND_BOUND; OBSERVED_EXECUTE_6968MS_ROLE_METADATA_PASS_2172MS_PAYLOAD_JOIN_0_HTTP_0_ATTEMPTS_1_RETRIES_0_WRITES_0_PRESERVED |
| current_actual_provider_v4_receipt_sha256 | d20051ca7c47ff679702cfa0d86c1ee8697b130972c4fd17aa1813f96771ec9d |
| current_actual_provider_v4_source_binding | HISTORICAL_SEVEN_FROZEN_RUNTIME_SCHEMA_TEST_SHA256_EXACT_MATCH_SYNTHETIC_DI_AUTH_ONLY; ORIGINAL_FAILURE_PRESERVED_NOT_REPLACED_BY_NEW_SUCCESS |
| base_configuration_receipt_sha256 | 0c3e2b0f3de09dd2566da17a9619e1d6c0476110cdd0d2bc4de33f5eae01f657 |
| current_actual_provider_v5 | PASS_SINGLE_FRESH_ORIGINAL_ORACLE_READONLY_140_METRICS_12_ANNUAL_OFFERINGS_PROVIDER_2532MS; HISTORY_HTTP_100_40_TYPED_CLOSED_DTO_NO_STORE_ME_3_FIELDS_STANDARD; RELAY_MISSING_403_BEARER_MISSING_401_OTHER_SUBJECT_403_DATA_ZERO; RETRIES_0_WRITES_0 |
| current_actual_provider_v5_receipt_sha256 | c69d5311bbb4752c5aea9f3629bdc85eedc09151ffc6588477bbc2c20163b028 |
| current_actual_provider_v5_source_binding | BASELINE_3C47B07_SEVEN_ORIGINAL_SOURCE_HASHES_FROZEN_BEFORE_UTC_TS_DELTA; UNCHANGED_PYTHON_PROVIDER_SQL_RLS_AND_HTTP_WITH_SYNTHETIC_DI_AUTH_PASS; NEW_TS_FILE_VALIDATION_AND_SYNTHETIC_TESTS_ARE_SEPARATE_NO_REAL_JWT_CLOUD_SQL_BROWSER |
| UTC_timestamp_compatibility | Z_AND_POSITIVE_ZERO_OFFSET_PLUS_00_00_EQUAL_BIGINT_MICROSECONDS; ORIGINAL_CATALOG_AS_OF_LITERAL_UNCHANGED; HTTP_NORMALIZED_Z_WITH_UP_TO_6_FRACTION_DIGITS; NONZERO_OR_NEGATIVE_ZERO_OFFSET_INVALID_DATE_7_DIGIT_FRACTION_AND_EXCESS_TTL_REJECT; EXACT_ISSUE_EXPIRY_BOUNDARIES_PRESERVED |
| UTC_TS_file_validation_receipt_sha256 | f7e561ead524fd55b855122f0a06c6959f221921c04043d9b8021473ed86e0e1 |
| UTC_TS_approved_descriptor_validation | PASS_FILE_ONLY_APPROVED_DESCRIPTOR_AND_EXPIRED_REVOKED_WRONG_ENV_PROPOSED_TTL_ABOVE_24H_NEGATIVE_CASES; COMPONENT_BYTES_UNCHANGED_DB_0_NETWORK_0; ACTUAL_CLOUD_SQL_AND_JWT_NOT_RUN |
| data_team_intake_observation | PRIOR_DISKFULL_FAILURES_AND_SCREEN_915MB_REPORT_PRESERVED_AS_HISTORICAL; NEW_DASHBOARD_ORGANIZATION_PRO_BADGE_OBSERVED_NOT_CURRENT_CAPACITY_QUOTA_PROOF |
| generic_bundle | PASS_COMMITTED_SIX_SOURCE_GIT_BLOB_BOUND_FIXED_POSTGRES3_4_5_SOURCE_ONLY_ESM_NATIVE39_AND_PRIVATE_PRIMARY_WIRE5_REUSED_EXACT_PINS_NEW_FULL_BUNDLE_BOOT_NO_NETWORK_DB_SECRET_OR_DATA_INPUTS; NEW_HOSTED_JWT_BFF_BROWSER_ACCEPTANCE_NOT_RUN |
| generic_bundle_sha256 | ff33c7a843d593e5d682cffea3bdc1690d7571f71d877fe2db8260f388c50b78 |
| generic_bundle_bytes | 112260 |
| local_C_receiver_acceptance | PASS_ROOT_ACK_EXACT_PATH_ONLY_RECEIVER_SELECTION_ORIGINAL_MECHANICAL_RECEIPT_AND_APPROVAL4TUPLE_TYPED_BYTES; FRONTEND_LOCAL_README3_TO5_21_OF21_140_TYPED_RENDER_PASS_REPORT_RECEIVED; ROOT_RERUN_0_CLOUD_BROWSER_ACCEPTANCE_SEPARATE |
| observed_function_url | https://ksrpnhvyfdwysrexdhrd.supabase.co/functions/v1/official-history-display |
| private_descriptor_storage | PASS_PRIVATE_STORAGE_ONLY_SINGLE_ATTEMPT_RETRIES_0_EXISTING_OVERWRITES_0_PRIVATE_BUCKET_FALSE_AUTHENTICATED_READBACK_EXACT_ANONYMOUS_DENIED; NO_DB_RLS_OR_SOURCE_FLAG_CHANGES |
| cloud_anonymous_endpoint | PASS_SINGLE_NATIVE_HTTPS_GET_ME_401_AND_DATA_ZERO_PLATFORM_GATE_ONLY; HANDLER_NO_STORE_REAL_JWT_SQL_NOT_PROVEN |
| cloud_JWT_gateway | DASHBOARD_VERIFY_JWT_WITH_LEGACY_SECRET_ON_UNCHANGED_PUBLIC_JWKS_ES256_1_KEY_OBSERVED; DOCUMENTATION_AND_DASHBOARD_WORDING_DIFFER_SO_REAL_JWT_INTAKE_REQUIRED_BEFORE_COMPATIBILITY_CLAIM; NO_AUTO_DISABLE_OR_API_KEY_BEARER_SUBSTITUTION |
| integration_commit | 9e03bd6483cffc420aa02ed01a09e93e3c5356c6 |
| service_source_commit | 065cef786159ac29f3b093616c52ac83ff8dec99 |
| integration_CI | PASS_EXACT_SOURCE_065cef786159ac29f3b093616c52ac83ff8dec99_RUN_37936519388_AND_EXACT_DEVELOP_MERGE_9e03bd6483cffc420aa02ed01a09e93e3c5356c6_RUN_37937144615; NORMAL_PRECOMMIT853_PREPUSH853; FINAL_STATUS_DOCUMENT_COMMIT_CHECKS_SEPARATE |
| source_integration | PR22_MERGE_COMMIT_DEVELOP_ONLY_SOURCE_065cef786159ac29f3b093616c52ac83ff8dec99_INTEGRATION_9e03bd6483cffc420aa02ed01a09e93e3c5356c6; BRANCHES_AND_FILES_PRESERVED_MAIN_UNCHANGED; SOURCE_ACCEPTANCE_NOT_WHOLE_OPERATIONAL_ACCEPTANCE |
| current_canonical_provider | USER_AUTHORIZED_ALL_CURRENT_FRONTEND_ADMIN_REVIEW_PREPARATION_IN_PROGRESS; GENERIC_APPLICATION_PORT_CURSOR_CANDIDATE_SEPARATE_FROM_ACTUAL_SQL_PUBLIC_MAPPING_FACTORY_AND_DEPLOYMENT; CURRENT_ACTIVATION_NOT_RUN |
| DB_capacity_preservation | REGISTRY_IS_PERSISTENT_CURRENT_CANONICAL_SOURCE_MEMBERSHIP_STATE_NOT_TEMPORARY_PROVIDER_OUTPUT; CURRENT_AND_HISTORICAL_C_OVERLAY_DEPENDENCIES_CONFIRMED; ARCHIVE_POINTER_RESOLVER_EXACT_REMOVAL_APPROVAL_AND_CURRENT_C_FIELD_REPLAY_ACCEPTANCE_REQUIRED_BEFORE_CLEANUP |
| previous_planning_status_CI | PASS_EXACT_DEVELOP_ac2731628d82c785345cbd000fdaae03eb2b1024_PROJECT_CONSISTENCY255_NORMAL_PRECOMMIT853_PREPUSH853; CURRENT_NEW_STATUS_COMMIT_CHECKS_SEPARATE |
| DB_capacity_metadata_probe | PASS_NEW_BOUNDED_APP_READONLY_METADATA_AND_ROOT_SPECIFIC_DEPENDENCY_FOLLOWUP; REGISTRY_AND_TARGET_TABLE_SIZES_RECORDED_ONLY_IN_PRIVATE_RECEIPT; NO_PAYLOAD_READ_DB_STORAGE_WRITE_DDL_DML_VACUUM_OR_PRIVILEGE_CHANGE |
| historical_cloud_runtime_before_bootstrap | {'restricted_cloud_API': 'GENERIC_FUNCTION_DEPLOYED_PRIVATE_DESCRIPTOR_READBACK_AND_BASE7_PLUS_PIN3_INDEPENDENT_DIGEST_MATCH; REAL_JWT_HOSTED_DB_BFF_BROWSER_SECURITY_PENDING', 'actual_user_JWT': 'NOT_RUN', 'cloud_deployment': 'PASS_DASHBOARD_GENERIC_FUNCTION_DEPLOYMENT_AND_OBSERVED_URL_ONLY; EDITOR_CRLF_113451_BYTES_NORMALIZED_TO_COMMITTED_LF_110796_BYTES_EXACT; NOT_HOSTED_DB_OR_REAL_JWT_ACCEPTANCE', 'generic_bundle': 'PASS_CACHED_OFFICIAL_ESBUILD_0_25_5_SOURCE_ONLY_ESM_THREE_SERVICE_SOURCES_FIXED_POSTGRES_3_4_5_IMPORT_EXPORT_AND_NODE_BUILTIN_ALIAS; PRIOR_DENO_BUNDLE_OS_ERROR_2_FAILURES_PRESERVED_NO_CONFIRMED_CAUSE; HOSTED_RUNTIME_NOT_RUN', 'generic_bundle_sha256': 'b3068379af4a4625113e99be4f5ef10a76f1852a8ffe7e9e68011e66c4728c74', 'generic_bundle_bytes': 110796} |
| worker_runtime_failure | ROOT_DASHBOARD_EVENT_LOOP_REFERENCE_ERROR_BUFFER_NOT_DEFINED_AFTER_BOOT_20_TO_26MS; FRONTEND_5_GET_ALL_500_REPORT; IMPORT_EVALUATION_BEFORE_HANDLER_REGISTRATION; EXACT_SOURCE_MAP_EQUIVALENCE_NOT_CLAIMED |
| worker_runtime_bootstrap | PASS_NATIVE_DENO2_9_7_CHECK_AND_36_TESTS_33_EXISTING_PLUS3; UNDEFINED_ONLY_NO_EXISTING_GLOBAL_OVERWRITE; FLAT_BUNDLE_BOOTSTRAP_PRECEDES_FIRST_POSTGRES_BUFFER_INITIALIZATION |
| worker_fixed_bundle | PASS_OFFLINE_ACTUAL_ORIGINAL_DEPLOYED_BUNDLE_BUFFER_REFERENCE_ERROR_HANDLER0_AND_NEW_FULL_BUNDLE_ALL4_GLOBALS_MISSING_HANDLER1_BUFFER_PROCESS_ENV_TIMER_SCHEDULE_CANCEL; EMPTY_SYNTHETIC_SETTINGS503_SECURITY_POLICY_UNAVAILABLE_NO_STORE_FETCH0_DB0; NOT_HOSTED_AUTH_DB_ACCEPTANCE |
| worker_fix_source_integration | PASS_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_NORMAL_PRECOMMIT_AND_PREPUSH_853_EACH_EXACT_SOURCE_CI; PR21_MERGE_COMMIT_e086a6b571caa8ac758b7280c6d3538fb682c47a_EXACT_MERGE_CI_SUCCESS; BRANCHES_PRESERVED_MAIN_UNCHANGED |
| worker_fix_cloud_deployment | PASS_EXISTING_FUNCTION_REDEPLOYMENT_VISIBLE_UPDATED_EDITOR_READBACK_LF_BYTES_SHA_EXACT_COMMITTED_SOURCE_BUNDLE_JWT_ON_UNCHANGED; SOURCE_DEPLOYMENT_ONLY_NOT_REAL_USER_HOSTED_SQL_OR_BROWSER_ACCEPTANCE |
| worker_fixed_real_JWT_retest | HISTORICAL_FRONTEND_WORKER_AND_SUBJECT_GATES_PASS_REPORT_PRESERVED; ARRAY_IO_FIXED_SOURCE_REDEPLOYED_NEW_FRESH_JWT140_CURSOR100_40_RECRUITMENT_PENDING_BFF_BROWSER_STILL_NOT_RUN |
| frontend_local_C_report | RECEIVED_AND_READ_FRONTEND_RECEIVER_LOCAL_README_STEPS_3_TO_5_21_OF_21_API_CASES_AND_140_TYPED_FIELDS_RENDER_REPORTED_PASS; ROOT_RECEIPT_REVIEW_NOT_ROOT_RERUN_OR_CLOUD_ACCEPTANCE |
| frontend_local_C_report_sha256 | 2cc4da7e063fad95dbf5fe9a8af486d4ed7c0cf3ce6a3ee841c6d5afd02b9372 |
| historical_local_C_receiver_acceptance_before_frontend_report | PASS_ROOT_ACK_EXACT_PATH_ONLY_RECEIVER_SELECTION_AND_ORIGINAL_MECHANICAL_RECEIPT_MANIFEST_APPROVAL4TUPLE_TYPED_BYTES_BINDING; FROZEN_LOCAL_VERIFICATION_ONLY; RECEIVER_CLI_CACHE_SESSION_API_BROWSER_NOT_RUN |
| worker_bootstrap_verification_receipt_sha256 | 6f598ab7cfad3f5758a9f546dbffd590124fc280c4dd129df26c4fe357ca5085 |
| generic_bundle_role | COMMITTED_SOURCE_065cef786159ac29f3b093616c52ac83ff8dec99_SIX_FILE_EXACT_BINDING_CLEAN_BUILD_AND_DEVELOP_MERGE_9e03bd6483cffc420aa02ed01a09e93e3c5356c6; EXISTING_FUNCTION_REDEPLOYED_UI_EDITOR_READBACK_EXACT; FRESH_USER_JWT_BFF_BROWSER_ACCEPTANCE_NOT_RUN |
| generic_bundle_parent_commit | e8c6847cdff98ce3f4fd428251daf877f86a2b0d |
| generic_bundle_source_pins | [{'path': 'supabase/functions/official-history-display/index.ts', 'bytes': 1383, 'sha256': '94843a1e45d903cd8d5086e2e2e6745c6870b3c34eea19de01a42365ac652da2'}, {'path': 'supabase/functions/_shared/official_history_display.ts', 'bytes': 25760, 'sha256': '91def2f8a5755f9ea53e1164b689a27f769957a8d6c1fa110611d6c1addb413f'}, {'path': 'supabase/functions/_shared/official_history_postgres.ts', 'bytes': 13791, 'sha256': '60a8ad0f855168614e16da04ee8f962c84bd623de9cb9336140a5dd95d66c4f4'}, {'path': 'supabase/functions/_shared/node_compat_bootstrap.ts', 'bytes': 985, 'sha256': '18736bcf332f8cc4a9b708e05383326a5f3992c9a260c8bcb6b7fab9a861a13f'}] |
| worker_boot_probe_permissions | NO_ENV_NET_RUN_WRITE_GRANTED; DYNAMIC_FILE_IMPORT_READ_GRANTED_ONLY_TO_EACH_EXACT_GENERIC_JS; DENO_ENV_GET_STUB_RETURNS_EMPTY; FETCH_STUB_AND_ENV_SETTINGS_DO_NOT_CALL_REAL_SERVICES |
| worker_bootstrap_preparation_failures_preserved | PRIVATE_OUTPUT_V1_LF_PREPARATION_ASSERT_AND_V2_DYNAMIC_IMPORT_READ_PERMISSION_DENIAL_PRESERVED; V3_WITH_EXACT_FILE_READ_PASS; NO_SERVICE_SOURCE_CHANGE_REQUIRED_FOR_PROBE_FAILURES |
| historical_Deno_check_test_before_bootstrap | PASS_NATIVE_Deno_2.9.7_SHARED_APPLICATION_AND_TEST_CHECK_33_SCOPED_SYNTHETIC_TESTS_EXISTING_28_PLUS_5_UTC_COMPATIBILITY; NO_DB_AUTH_ENV_NETWORK |
| historical_worker_fix_pending_before_redeploy | {'generic_bundle': 'PASS_UNCOMMITTED_BOOTSTRAP_REVIEW_CANDIDATE_SOURCE_FROZEN_NATIVE36_AND_OFFLINE_FULL_BUNDLE_BOOT; OLD_HOSTED_REVISION_FAILED_BUFFER; FIXED_REAL_JWT_HOSTED_RETEST_NOT_RUN', 'generic_bundle_role': 'UNCOMMITTED_REVIEW_CANDIDATE_NOT_DEPLOYED; FINAL_COMMITTED_BUILD_READBACK_BINDING_REQUIRED', 'service_source_commit': '472052546dc8672167c7576bde7f758c6964e186', 'integration_commit': '9ed5102a656859ca0ef5136cb3c4bd8009d0cb8f', 'integration_CI': 'PASS_EXACT_DEVELOP_MERGE_COMMIT_PROJECT_CONSISTENCY_238; SOURCE_HEAD_4720525_PRECOMMIT_853_PREPUSH_853_DENO_33_AND_CI_237_SUCCESS; CURRENT_PLANNING_STATUS_COMMIT_CHECKS_SEPARATE', 'source_integration': 'PR20_MERGE_COMMIT_DEVELOP_ONLY_BRANCHES_PRESERVED_MAIN_UNCHANGED; CODE_ACCEPTANCE_NOT_OPERATIONAL_ACCEPTANCE', 'worker_fix_source_integration': 'PENDING_NORMAL_COMMIT_PUSH_HOOKS_EXACT_SHA_CI_AND_DEVELOP_PR; NO_MAIN_MERGE_OR_OPERATIONAL_ACCEPTANCE', 'worker_fix_cloud_deployment': 'NOT_RUN_PENDING_COMMITTED_SOURCE_BUILD_READBACK_SHA_AND_EXISTING_FUNCTION_REDEPLOYMENT; OLD_GENERIC_DEPLOYMENT_ONLY_EVIDENCE_PRESERVED'} |
| worker_committed_bundle_verification_receipt_sha256 | 63d319c6c692f6ce4568e4dbc4c58bf63787f84dccc42a39e92a9d13b7994e01 |
| historical_before_second_JWT_report_and_subject_appendix | {'restricted_cloud_API': 'FIXED_COMMITTED_BUNDLE_REDEPLOYED_AFTER_NATIVE_AND_OFFLINE_BOOT_REGRESSION; OLD_FRONTEND_REAL_JWT_5_GET_500_WORKER_ERROR_PRESERVED; FIXED_REAL_JWT_HOSTED_DB_BFF_BROWSER_SECURITY_RETEST_PENDING', 'actual_user_JWT': 'FRONTEND_REAL_STANDARD_USER_JWT_5_GET_ATTEMPTED_500_WORKER_ERROR; ROOT_DASHBOARD_BUFFER_REFERENCE_ERROR_LOG_MATCH; FIXED_REVISION_RETEST_NOT_RUN', 'worker_fixed_real_JWT_retest': 'NOT_RUN_FRONTEND_OWNER_RETRY_WITH_FRESH_USER_JWT_EXISTING_RELAY_5_GET_140_TYPED_METRICS_NO_STORE_STANDARD_PAID_GET_403_RECRUITMENT_PENDING_BEFORE_VALID_APPROVAL_EXPIRY', 'previous_planning_status_CI': 'PASS_EXACT_DEVELOP_A59F370_PROJECT_CONSISTENCY_241_NORMAL_PRECOMMIT_853_PREPUSH_853; CURRENT_NEW_STATUS_COMMIT_CHECKS_SEPARATE'} |
| subject_appendix_preparation | PASS_PRIVATE_NEW_ONE_EXISTING_AUTHENTICATED_SUBJECT_APPENDIX_FILE_AND_NATIVE_SYNTHETIC_PORTS_REVIEW; ORIGINAL_SUBJECTS_AND_140_TYPED_CATALOG_BINDINGS_FLAGS_ISSUE_EXPIRY_OPERATIONS_UNCHANGED; NEW_APPROVAL_ID_AND_ONE_SUBJECT_ONLY; NO_PAID_GRANT |
| subject_appendix_storage_registration | PASS_NEW_PRIVATE_OBJECT_RAW_READBACK_EXACT_ANONYMOUS_DENIED; EXISTING_SOURCE_PRESERVED_NEW_IMMUTABLE_OBJECT_ONLY_NO_DB_RLS_SECRET_OR_PIN3_CHANGE |
| subject_appendix_PIN3_activation | PASS_FRONTEND_DESIGNATED_OWNER_REPORT_APPLIED_TRIPLET_AND_ROOT_INDEPENDENT_302_BYTE_METADATA_AND_THREE_VALUE_DIGEST_MATCH; ROOT_DASHBOARD_RERUN_NOT_RUN; BASE7_SUBJECT_SCOPE_TTL_RELAY_JWT_ROLE_DEFAULT_ENTITLEMENT_UNCHANGED |
| paid_route_cloud_acceptance | PASS_FRONTEND_THIRD_FRESH_JWT_REPORT_AFTER_SUBJECT_PASS_STANDARD_SEARCH_AND_READ403_PAID_REQUIRED_AND_PAYLOAD_ZERO; ROOT_REAL_JWT_RERUN_NOT_RUN; NO_PAID_GRANT_OR_DEFAULT_ENTITLEMENT_CHANGE |
| subject_appendix_upload_approval_history | INITIAL_EXACT_UPLOAD_AUTO_REVIEW_REJECTED_BEFORE_EXECUTION; CURRENT_USER_EXPLICIT_FILE_BUCKET_PATH_APPROVAL_RECEIVED; IMMUTABLE_OBJECT_REGISTERED; POST_REGISTRATION_ERROR_SHAPE_VALIDATOR_FAILURE_PRESERVED_AND_GET_ONLY_FINAL_CHECK_PASS; NO_SECOND_POST_OR_GATE_BYPASS |
| historical_before_third_JWT_report_and_array_reproduction | {'restricted_cloud_API': 'FRONTEND_SECOND_REAL_JWT_REPORT_NO_WORKER_ERROR_AUTH_RELAY_NEGATIVES_AND_ERROR_NO_STORE; REVIEW_SUBJECT_NOT_ALLOWED403_BEFORE_ENTITLEMENT_AND_PAYLOAD; ONE_SUBJECT_APPENDIX_PREPARED_RUNTIME_PIN3_OWNER_ACTIVATION_PENDING', 'actual_user_JWT': 'FRONTEND_SECOND_REAL_USER_JWT_REACHED_APPLICATION_SUBJECT_CHECK403_REVIEW_SUBJECT_NOT_ALLOWED; ROOT_READ_REPORT_AND_EXACT_AUTH_SUBJECT_ADMIN_GET200; ROOT_REAL_USER_JWT_RERUN_NOT_RUN', 'worker_fixed_real_JWT_retest': 'FRONTEND_SECOND_REPORT_RUNTIME_CRASH_NOT_REPRODUCED_AND_NEGATIVE_GATES_REPORTED; HISTORY140_CURSOR100_40_AND_RECRUITMENT_PENDING_BLOCKED_BEFORE_PAYLOAD; FULL_HOSTED_DB_BFF_BROWSER_ACCEPTANCE_NOT_RUN', 'subject_appendix_PIN3_activation': 'NOT_RUN_DESIGNATED_FRONTEND_SUPABASE_OWNER_ADMIN_MUST_REPLACE_ONLY_DESCRIPTOR_PATH_SHA256_BYTES_MATCHED_TRIPLET; DO_NOT_CHANGE_BASE7_JWT_RELAY_ROLE_PAID_OR_APPROVAL_TTL; ORIGINAL_SCOPE_PERIOD_ANCHORED_NOT_A_NEW_BACKDATED_GRANT', 'paid_route_cloud_acceptance': 'NOT_PROVEN_BY_SECOND_REPORT_403_STATUS_ONLY_SUBJECT_CHECK_PRECEDES_PAID_CHECK; AFTER_SUBJECT_ACTIVATION_STANDARD_SEARCH_AND_READ_MUST_RETURN403_PAID_REQUIRED_WITH_PAYLOAD_ZERO', 'previous_planning_status_CI': 'PASS_EXACT_DEVELOP_4dd89882557c4445ad6e6522c1c0c57f1b0f3159_PROJECT_CONSISTENCY250_NORMAL_PRECOMMIT853_PREPUSH853; CURRENT_NEW_STATUS_COMMIT_CHECKS_SEPARATE'} |
| third_frontend_report_source_sha256 | c905cd48eb8e1a02c5481e49f7a33bc31c08279caa57e94eb4559550c8578855 |
| database_array_failure_diagnosis | PASS_ROOT_ACTUAL_PINNED_POSTGRES3_4_5_APP_ROLE_TLS_CA_READONLY_REPRODUCTION_RAW_JS_ARRAY_AND_ARRAY_HELPER25_BOTH22P02_MALFORMED_ARRAY_LITERAL; OUR_UNSAFE_PARAMETER_USAGE_WITH_FETCH_TYPES_FALSE; NO_DB_WIDE_OUTAGE_OR_UNRELATED_VIEW_DDL_CAUSATION_CLAIM |
| database_array_scalar_candidate | PASS_ROOT_ACTUAL_SAME_DRIVER_READONLY_SYNTHETIC_VALUES_JSON_TEXT_SCALAR_CAST_TEXT_THEN_JSONB_SINGLE_ARRAY_SPECIAL_CHARACTERS_PAIRED_UNNEST_ANY_AND_EMPTY_ARRAY_VALUES_MATCH; ARRAY_HELPER25_AND_JSONB_DIRECT_DOUBLE_ENCODING_FAILED_PRESERVED; NOT_FULL_SOURCE_PROVIDER_OR_HOSTED_ACCEPTANCE |
| database_array_readonly_receipt_sha256 | f2207556cf263507c698ba872e5b26f8cd227ff1722f9e1db8e9187d039364b6 |
| database_array_source_fix | PASS_SOURCE_TWO_PUBLIC_FILES_AND_MATCHING_PLANNING_ROUTING_NORMAL_PRECOMMIT853_PREPUSH853_EXACT_SOURCE_CI_AND_MERGE_COMMIT_DEVELOP; NO_MAIN_MERGE_OR_PRIVACY_AUTH_POLICY_CHANGE |
| database_array_redeployment | PASS_EXISTING_FUNCTION_ARRAY_IO_REDEPLOYMENT_VISIBLE_UI_EDITOR_READBACK_LF_BYTES_SHA_EXACT_COMMITTED_BUNDLE_JWT_GATE_ON_UNCHANGED; ONLY_SOURCE_DEPLOYMENT_NOT_FRESH_USER_JWT_BFF_BROWSER_OR_WHOLE_SERVICE_ACCEPTANCE |
| database_array_actual_provider | PASS_ROOT_ACTUAL_CORRECTED_TS_PROVIDER_SOURCE_A85E7C_APP_ONLY_TLS_CA_REJECT_UNAUTHORIZED_REPEATABLE_READ_READ_ONLY_ROW_SECURITY_NONOWNER_NONSUPER_NONBYPASS; PINNED_METADATA22_DEFINITIONS19_EXACT_AND_FORCE_RLS3; ACTUAL_SELECTED140_TYPED_HISTORY140_ANNUAL_OFFERINGS12_BULK_DATA_JOIN1_RAW_JS_ARRAY_PARAMETERS0; AUTH_JWT_BFF_BROWSER_AND_REDEPLOYMENT_NOT_RUN |
| database_array_frontend_retest | PASS_REPORTED_EXISTING_C140_12_REDEPLOYED_ARRAY_FIX_503_NOT_REPRODUCED; RECEIPT_BOUND_TO_EXISTING_ENDPOINT_APPROVED_DESCRIPTOR_AND_COMMITTED_BUNDLE; EXTERNAL_FRONTEND_EXECUTION_NOT_ROOT_RERUN |
| historical_before_array_io_fix | {'Deno_check_test': 'PASS_NATIVE_DENO2_9_7_CACHED_ONLY_CHECK6_SOURCE_AND_TEST_FILES_AND_TEST36_33_EXISTING_PLUS3_BOOTSTRAP; NO_ACTUAL_AUTH_PRIVATE_SETTINGS_DB_OR_NETWORK; OFFLINE_FULL_BUNDLE_BOOT_RECEIPT_SEPARATE; FIXED_HOSTED_RETEST_NOT_RUN', 'restricted_cloud_API': 'FRONTEND_THIRD_REPORT_RUNTIME_AND_SUBJECT_GATES_PASSED_ENTITLEMENT_ME_AND_PAID_DENIAL_OBSERVED; HISTORY_RECRUITMENT_DB_PARAMETER_FAILURE_REMAINS; NO_140_TYPED_CURSOR_PENDING_OR_BFF_BROWSER_ACCEPTANCE', 'actual_user_JWT': 'FRONTEND_THIRD_FRESH_JWT_REPORT_SUBJECT_PASSED_ME200_STANDARD_PAID2_GET403_PAID_REQUIRED_AUTH_RELAY_NEGATIVES_AND_PRIVATE_NO_STORE; HISTORY_RECRUITMENT503_OFFICIAL_HISTORY_DB_UNAVAILABLE; ROOT_REAL_JWT_RERUN_NOT_RUN', 'source_db_read_only': 'PASS_FRESH_V5_SCOPED_APP_ROLE_TLS_READONLY_PROVIDER_140_METRICS_12_ANNUAL_OFFERINGS; ORIGINAL_V4_57014_PRESERVED; NOT_FULL_SERVICE_ACCEPTANCE', 'effective_RLS': 'PASS_FRESH_V5_ACTUAL_PROVIDER_NONOWNER_NONSUPER_NONBYPASS_APP_ROLE_READONLY_ROW_SECURITY_ON_19_PINNED_INVOKER_VIEWS_3_ENABLE_AND_FORCE_RLS_TABLES; HOSTED_EDGE_RLS_NOT_RUN', 'bulk_JOIN_query_count': 'PASS_FRESH_V5_ACTUAL_PROVIDER_DATA_JOIN_1_HISTORY_HTTP_PAGE_100_JOIN_1_PAGE_40_JOIN_1; TOTAL_DATA_JOINS_3; AUTH_ROLE_ENTITLEMENT_METADATA_COUNTED_SEPARATELY_NO_N_PLUS_1', 'generic_bundle': 'PASS_COMMITTED_SOURCE_ONLY_FIXED_POSTGRES_DEPENDENCY_WITH_NODE_BOOTSTRAP_111398_BYTES_NATIVE36_AND_OFFLINE_FULL_BUNDLE_REGRESSION; OLD_HOSTED_REVISION_BUFFER_FAILURE_PRESERVED; FIXED_REAL_JWT_HOSTED_RETEST_NOT_RUN', 'generic_bundle_role': 'COMMITTED_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_SIX_FILE_GIT_BLOB_BINDING_NATIVE36_AND_OFFLINE_FULL_BUNDLE_REGRESSION; EXISTING_FUNCTION_REDEPLOYED_EDITOR_READBACK_EXACT; REAL_JWT_HOSTED_DB_BFF_BROWSER_RETEST_NOT_RUN', 'cloud_deployment': 'PASS_EXISTING_FUNCTION_REDEPLOYMENT_VISIBLE_UPDATED_EDITOR_READBACK_LF_BYTES_SHA_EXACT_COMMITTED_SOURCE_BUNDLE_JWT_ON_UNCHANGED; SOURCE_DEPLOYMENT_ONLY_NOT_REAL_USER_HOSTED_SQL_OR_BROWSER_ACCEPTANCE', 'worker_fixed_real_JWT_retest': 'FRONTEND_THIRD_REPORT_NO_WORKER_ERROR_NO_SUBJECT_DENIAL; HISTORY140_CURSOR100_40_RECRUITMENT_PENDING_BLOCKED_BY_DB_PARAMETER_FAILURE; FULL_HOSTED_DB_BFF_BROWSER_ACCEPTANCE_NOT_RUN', 'database_array_source_fix': 'IN_PROGRESS_EXISTING_SERVICE_FEATURE_BRANCH_MINIMAL_THREE_QUERIES_SIX_ARRAY_BINDINGS_AND_REAL_DRIVER_REGRESSION; NORMAL_COMMIT_HOOKS_CI_AND_REVIEWED_DEVELOP_INTEGRATION_REQUIRED', 'database_array_actual_provider': 'NOT_RUN_PENDING_FIXED_PROVIDER_COMPLETE_140_TYPED_BINDING_JOIN_AND_METADATA_GUARD_READONLY_VERIFICATION; NO_INVENTED_DATA_OR_SCOPE_RELAXATION', 'database_array_redeployment': 'NOT_RUN_PENDING_FIXED_COMMITTED_SOURCE_BUNDLE_EXACT_BINDING_AND_EXISTING_FUNCTION_REDEPLOYMENT; PIN3_BASE7_APPROVAL_SCOPE_AND_JWT_GATE_UNCHANGED', 'database_array_frontend_retest': 'NOT_RUN_FRESH_USER_JWT_HISTORY140_CURSOR100_40_RECRUITMENT_PENDING_PAID403_NO_STORE_AND_BFF_BROWSER_REQUIRED_BEFORE_UNCHANGED_APPROVAL_EXPIRY'} |
| database_array_native_receipt_sha256 | 335b4cea52e02c521a19d055eb1aad68a6dbf49a148e69d1ac8477fbf753d6b6 |
| database_array_primary_driver_wire | PASS_ACTUAL_POSTGRES3_4_5_UNSAFE_PARAMETER_OPTIONS_AND_UNMODIFIED_PRIMARY_BIND_WITH_PRIMARY_BYTE_BUILDER_5_TESTS_18_WIRE_MESSAGES; EMPTY_COMMA_QUOTE_BACKSLASH_UNICODE_NEWLINE_NULL_LIKE_STRINGS_AND_PAIRED_IDS; RAW_JS_AND_ARRAY25_MALFORMED_WIRE_DIRECT_JSONB_DOUBLE_ENCODING_PRESERVED; SERVER_OID25_1009_3802_SUPPLIED_TO_OFFLINE_BIND_FROM_SEPARATE_ACTUAL_DB_OBSERVATIONS; NOT_A_HOSTED_QUERY_OR_JWT_TEST |
| database_array_actual_provider_receipt_sha256 | 6649fcf04a81f3aec99f30fbfbcb1272421f18e75ede912be6ac443d93f11d06 |
| database_array_source_sha256 | a85e7c502837403736577eadf84dc6c93d5f452e59e87b574ebd09ad1d7cd560 |
| database_array_public_test_sha256 | 4c9bb1af51a66c608bbaa5569ac4db9e53e42087173b625dbf41588fdae0ac97 |
| database_array_IO_preservation | FETCH_TYPES_FALSE_PREPARE_FALSE_DRIVER_VERSION_TLS_APP_ROLE_RLS_REPEATABLE_READ_READONLY_LIMIT_PAIR_ORDER_DATA_JOIN1_FINGERPRINT_SUBJECT_RELAY_TTL_DEFAULT_LEGACY_ENTITLEMENT_PIN3_AND_HISTORY_CURRENT_SEPARATION_UNCHANGED |
| database_array_reloptions_diagnosis | PASS_ROOT_ACTUAL_METADATA_ALL19_VIEW_DEFINITION_SHA256_EXACT; DRIVER_TEXT_ARRAY_RAW_STRING_VERSUS_APPROVED_ARRAY_TYPE_MISMATCH_ONLY; TO_JSONB_METADATA_PROJECTION_RETURNS_BUILTIN_JSONB_PARSED_ARRAY_WITH_SAME_VALUES_NULL_RETAINED; NO_DESCRIPTOR_OR_VIEW_DDL_CHANGE_NO_SCOPE_GUARD_RELAXATION |
| database_array_preparation_failures_preserved | NATIVE_V1_ADDED_TEST_PRIVATE_DRIVER_INTROSPECTION_TYPE_ERRORS8_PRESERVED; NATIVE_V2_PRIMARY_WIRE5_PASS_PUBLIC_ESCAPED_FIXTURE_FAILED_SINGLE_RELEASE_NONEMPTY_OVERLAY_APPROVAL_RULE_PRESERVED; V3_FIXTURE_CORRECTED_VALIDATOR_UNCHANGED_NATIVE44_PASS; ROOT_CA_PREPARATION_DIRECT_JSONB22023_AND_METADATA_DIAGNOSTIC_WRONG_KEY_HISTORY_PRESERVED |
| historical_before_array_redeployment | {'generic_bundle': 'PASS_COMMITTED_SOURCE_ONLY_FIXED_POSTGRES_DEPENDENCY_WITH_NODE_BOOTSTRAP_111398_BYTES_NATIVE36_AND_OFFLINE_FULL_BUNDLE_REGRESSION; OLD_HOSTED_REVISION_BUFFER_FAILURE_PRESERVED; FIXED_REAL_JWT_HOSTED_RETEST_NOT_RUN', 'generic_bundle_sha256': 'b7edc2961bed3fcc333b09d174efeb45fdf794fa470b294178fe51373f1c0f92', 'generic_bundle_bytes': 111398, 'generic_bundle_role': 'COMMITTED_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_SIX_FILE_GIT_BLOB_BINDING_NATIVE36_AND_OFFLINE_FULL_BUNDLE_REGRESSION; EXISTING_FUNCTION_REDEPLOYED_EDITOR_READBACK_EXACT; REAL_JWT_HOSTED_DB_BFF_BROWSER_RETEST_NOT_RUN', 'cloud_deployment': 'PASS_EXISTING_FUNCTION_REDEPLOYMENT_VISIBLE_UPDATED_EDITOR_READBACK_LF_BYTES_SHA_EXACT_COMMITTED_SOURCE_BUNDLE_JWT_ON_UNCHANGED; SOURCE_DEPLOYMENT_ONLY_NOT_REAL_USER_HOSTED_SQL_OR_BROWSER_ACCEPTANCE', 'source_integration': 'PR21_MERGE_COMMIT_DEVELOP_ONLY_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_INTEGRATION_e086a6b571caa8ac758b7280c6d3538fb682c47a; BRANCHES_PRESERVED_MAIN_UNCHANGED; SOURCE_INTEGRATION_NOT_OPERATIONAL_ACCEPTANCE', 'integration_CI': 'PASS_EXACT_SOURCE_30cf5686330cdacc3d60d7a98f512ed107288c1f_PROJECT_CONSISTENCY_247; NORMAL_PRECOMMIT_853_PREPUSH_853_SNAPSHOT_GIT_BLOB_BINDING; EXACT_DEVELOP_MERGE_e086a6b571caa8ac758b7280c6d3538fb682c47a_PROJECT_CONSISTENCY_249; CURRENT_PLANNING_STATUS_COMMIT_CHECKS_SEPARATE', 'integration_commit': 'e086a6b571caa8ac758b7280c6d3538fb682c47a', 'service_source_commit': '30cf5686330cdacc3d60d7a98f512ed107288c1f', 'restricted_cloud_API': 'FRONTEND_THIRD_REPORT_RUNTIME_AND_SUBJECT_GATES_PASSED_ENTITLEMENT_ME_AND_PAID_DENIAL_OBSERVED; HISTORY_RECRUITMENT_DB_PARAMETER_FAILURE_REMAINS; NO_140_TYPED_CURSOR_PENDING_OR_BFF_BROWSER_ACCEPTANCE', 'actual_user_JWT': 'FRONTEND_THIRD_FRESH_JWT_REPORT_SUBJECT_PASSED_ME200_STANDARD_PAID2_GET403_PAID_REQUIRED_AUTH_RELAY_NEGATIVES_AND_PRIVATE_NO_STORE; HISTORY_RECRUITMENT503_OFFICIAL_HISTORY_DB_UNAVAILABLE; ROOT_REAL_JWT_RERUN_NOT_RUN', 'database_array_source_fix': 'PASS_MINIMAL_THREE_QUERIES_SIX_JSON_TEXT_SCALAR_BINDINGS_TEXT_THEN_JSONB_ORDERED_ARRAY_RESTORE_AND_JSONB_RELOPTIONS_PROJECTION; SOURCE_AND_PAIRED_DOCS_REVIEW_PREPARED_NORMAL_COMMIT_PUSH_EXACT_SHA_CI_AND_DEVELOP_INTEGRATION_PENDING', 'database_array_redeployment': 'NOT_RUN_PENDING_COMMITTED_SOURCE_EXACT_GENERIC_BUNDLE_AND_EXISTING_FUNCTION_REDEPLOYMENT; CANDIDATE_SOURCE_DB_PASS_IS_NOT_HOSTED_RELEASE; PIN3_BASE7_APPROVAL_SCOPE_TTL_AND_JWT_GATE_UNCHANGED', 'worker_fixed_real_JWT_retest': 'FRONTEND_THIRD_REPORT_NO_WORKER_ERROR_NO_SUBJECT_DENIAL; HISTORY140_CURSOR100_40_RECRUITMENT_PENDING_BLOCKED_BY_DB_PARAMETER_FAILURE; FULL_HOSTED_DB_BFF_BROWSER_ACCEPTANCE_NOT_RUN'} |
| database_array_deployment_receipt_sha256 | fb0d2ea15bf82ed3fffab79c2583428c02b5601329df9d1724817c26c147041a |
| database_array_deployment_verified_utc | 2026-10-09 13:36:17 UTC |
| database_array_anonymous_endpoint | PASS_SINGLE_POSTDEPLOYMENT_ANONYMOUS_GET_ME401_UNAUTHORIZED_NO_AUTH_HEADER_AND_DATA_ZERO_PLATFORM_GATE_ONLY_NO_HANDLER_NO_STORE_OR_SQL_CLAIM |
| current_all_review_scope | USER_CONFIRMED_FRONTEND_TEAM_AND_ADMINISTRATORS_REVIEW_FIRST; ALL_CURRENT_ACTIVE_SERVICE_RECORDS_IN_2024_TO2027_SUBJECT_TO_NEW_EXPLICIT_PURPOSE_SCOPE_AND_VALIDATED_PUBLIC_PROJECTION; GENERAL_MEMBER_OPERATIONAL_DISCLOSURE_EXCLUDED |
| current_app_readonly_metadata | PASS_ACTUAL_TLS_CA_NONOWNER_NONSUPER_NONBYPASS_APP_ROLE_ROW_SECURITY_ON_READONLY; RECURSIVE_CURRENT_REVIEW_METADATA13; PHYSICAL8_ENABLE_FORCE_RLS_VIEW5_SECURITY_INVOKER_BARRIER; ALL_APP_SELECT_TRUE_WRITABLE_ANON_AUTH_FALSE; ADMISSION_ROW_READS0_DB_WRITES0; NOT_CURRENT_PAGE_ACCEPTANCE |
| current_root_dependency_edges | PASS_ACTUAL_ROOT_SPECIFIC_PG_DEPEND_METADATA_CURRENT_DIRECT_REGISTRY_AND_CURRENT_HISTORICAL_C_OVERLAY_REACHABILITY; FILE_PAYLOAD_RELATIONS_NOT_IN_THOSE_VIEW_CLOSURES_DOES_NOT_PROVE_NO_INGEST_REPLAY_RESOLVER_DEPENDENCY |
| DB_capacity_execution | STORAGE_ORIGINAL_BYTES_MIGRATION_NOT_RUN; OVERLAY_CLEANUP_NOT_RUN; ARCHIVE_RESOLVER_NOT_RUN; EXACT_DB_REMOVAL_TARGETS_UNAPPROVED_AND_EMPTY; ORDINARY_VACUUM_NOT_RUN; VACUUM_FULL_NOT_RUN; FRONTEND_CONDITIONAL_AGREEMENT_AND_EXTERNAL_REQUEST_ARE_NOT_EXACT_DELETION_APPROVAL |
| registry_capacity_adjudication | RETAIN_REQUIRED_DIRECT_CURRENT_VIEW_DEPENDENCY_WITH_CANONICAL_AND_SOURCE_IDS_SOURCE_INITIAL_FIELDS_EVIDENCE_AND_HASH_HISTORY; SIZE_MATCHES_NEW_PRIVATE_MEASUREMENT; GROWTH_CAUSE_AND_FUTURE_EXACT_BYTES_NOT_INFERRED_FROM_TIMING_OR_SIZE_ALONE |
| admission_metric_expansion | FILE_ONLY_DATA_CONTRACT_REVIEW_PREPARED_COUNTS_VS_RATIO_PHASE_COHORT_OFFICIAL_A_PRIORITY_AND_DASH_ON_MISSING; PROPOSAL_UNADOPTED_OFFICIAL_SOURCE_MAPPING_CATALOG_APPROVAL_PUBLICATION_NOT_RUN |
| bonus_summary_CR | FILE_ONLY_SERVICE_AND_DATA_CONTRACT_REVIEW_PREPARED_RULE_EXISTENCE_VS_ACTUAL_APPLICATION_SUCCESSFUL_ZERO_UNKNOWN_AND_PARTIAL_HOLD; CR_CONVERSION_BONUS_SUMMARY_01_UNADOPTED_DTO_CODE_ENGINE_RUNTIME_NOT_RUN |
| current_review_candidate_native | PASS_DENO_CHECK6_AND_SYNTHETIC41; NEW_SOURCE6_DEVELOPMENT_CANDIDATE; NOT_ACTUAL_PERFORMANCE_OR_HOSTED_ACCEPTANCE |
| current_review_native_receipt_sha256 | a9e6a8b29c916c11458e7b1bcf602f406bfefc871bfde01e2fc931ec5fcba169 |
| current_review_actual_app_bounded_page | FAIL_ACTUAL_STATEMENT_TIMEOUT57014_QUALIFIED_PAYLOAD_AND_FILTERED_COUNTS_PAGE_KEYS; METADATA12_ROLE_RLS_13SCALAR_PASS_ROWS0; PRIOR_STATE503_PRESERVED; CONCRETE_LIGHT_PROVIDER_CR_REQUIRED_NO_TIMEOUT_OR_SCOPE_RELAXATION |
| current_review_new_function_runtime | NOT_RUN_NEW_CURRENT_APPROVAL_PIN4_DEPLOYMENT_JWT_BFF_BROWSER_AND_SECURITY_GATES; SOURCE_ACCEPTED_DEVELOP_BUT_ACTUAL_PERFORMANCE_FAILED_IO_HOLD; EXISTING_C_ENDPOINT_PIN3_DEFAULT_ENTITLEMENTS_UNCHANGED |
| current_review_independent_source | PASS_EXACT_SOURCE6_NATIVE41_EVIDENCE_AND_STAGE42_IO_DELTA14_STATIC_REVIEW; PERFORMANCE_FAILED_AND_DB_IO_HOLD_RETAINED |
| current_review_source_only_candidate_bundle | PASS_EXACT_COMMITTED_f566c7e_SOURCE9_BLOB_BOUND_BUNDLE17INPUTS_MAP0_NEEDLE0_OFFLINE_BOOT_EMPTYCONFIG503_PRIVATE_NO_STORE_NET_DB0; NOT_DEPLOYED_NOT_ACTUAL_PERFORMANCE_ACCEPTED |
| current_review_candidate_bundle_receipt_sha256 | 9d5fa736ea6dd93ec1d1b5db4d0920853f3670fe5227f622242debb2aeebc48a |
| current_review_actual_timeout_receipt_sha256 | b3b5f662f0907c9f353f0f79df69938bf0310bfd06ea419548325280db1c75da |
| historical_current_review_before_page_semifilter_native41 | {'current_review_candidate_native': 'PASS_DENO_CHECK6_AND_SYNTHETIC40; SOURCE6_NEW_UNTRACKED_AT_VERIFICATION; NOT_NEW_ACTUAL_DRIVER_DB_BUNDLE_JWT_OR_DEPLOYMENT', 'current_review_native_receipt_sha256': '5fba508a4bf27e9a606d064d88133911097a24bf90858d96f8a482cf5b1cbaed', 'current_review_actual_app_bounded_page': 'FAIL_ACTUAL_QUALIFIED_STATE_PAYLOAD_STATEMENT_TIMEOUT57014_METADATA12_ROLE_RLS_AND_13SCALAR_PASS_RETURNED_ROWS0; PRIOR_UNKNOWN_STATE503_PRESERVED; SOURCE_SQL_PLAN_REVIEW_PENDING; NO_TIMEOUT_RLS_QUERY_COUNT_OR_DATA_SCOPE_RELAXATION', 'current_review_new_function_runtime': 'NOT_RUN_NEW_APPROVAL_SETTINGS_SOURCE_BUNDLE_GIT_AND_DEPLOYMENT_REQUIRED; EXISTING_C_FUNCTION_AND_PIN3_UNCHANGED', 'current_review_independent_source': 'PASS_STATIC_SOURCE6_FROZEN_AND_NATIVE40_EVIDENCE_REUSED; ACTUAL_DB_BUNDLE_HOSTED_ACCEPTANCE_SEPARATE', 'current_review_source_only_candidate_bundle': 'PASS_CACHED_ESBUILD_AND_POSTGRES3_4_5_SOURCE17INPUTS_NO_MAP_OR_PRIVATE_NEEDLES; MISSING_GLOBALS4_BOOTSTRAP_HANDLER1_EMPTY_CONFIG503_NO_STORE_NET_DB0; NOT_COMMITTED_OR_HOSTED_RELEASE', 'current_review_candidate_bundle_receipt_sha256': '15e86ba15b8e415652a7ecd06f8b632073e02f0fdd73334c313e41d8b3711def', 'current_review_actual_timeout_receipt_sha256': '80792d5f2dace48d7c9978adbf5a967b438e13d2e65c350189e16e620685ed3a'} |
| current_review_performance_diagnostic_receipts | {'page_semifilter_candidate': 'b3b5f662f0907c9f353f0f79df69938bf0310bfd06ea419548325280db1c75da', 'transaction_local_jit_off': '33b41b205af099c6c0b3bffb080705daf2ae2126200feea136ed7edb6effd82b', 'filtered_counts_page_keys_and_payload_components': 'd37aef3aa8ee2aeaccedd9ce5167fd9807d59d5cb67e46fb8ede74fd3ba5424f', 'fixed_four_year_IN_plus_exact_JSON_guard': '68ddbddfd513ec805b69e22fb7df97446a7a2405f05e9b27b2d497adf4093afc'} |
| current_review_IO_budget_warning | USER_REPORTED_DASHBOARD_WARNING_IO_BUDGET_NEAR_DEPLETION_BASE5MB_PER_SECOND_AFTER_EXHAUSTION; ADDITIONAL_IO_INTENSIVE_REAL_DB_EXECUTION_HOLD; ROOT_FRESH_METRICS_AND_CAUSAL_LINK_NOT_RUN; LOCAL_FILE_SOURCE_COMMON_GIT_PREPARATION_CONTINUES |
| current_review_independent_final_stage_receipt_sha256 | b63a58d1c00d963ddace40a93205cd9a43c6d18698248fa9f674f3670c156ade |
| current_review_develop_integration | PASS_NORMAL_PR23_DEVELOP_ONLY_EXACT_f566c7e_TREE_EQUAL_e59a13_SOURCE_CI273_PR_CI274_MERGE_CI275; MAIN_UNCHANGED; NOT_CURRENT_RUNTIME_ACCEPTANCE |
| read_model_candidate_source | PASS_EXACT_NEW7_PINS_NO_EXISTING_DEFAULT_C_ENTITLEMENT_22API_CHANGE; original actual5s57014 failure preserved |
| read_model_candidate_native_and_HTTP | PASS_DENO2_9_7_CACHED6FILECHECK_AND40_DISTINCT82REGISTERED_SYNTHETIC_TESTS; independently_signed_baseline_delta_18OBS_mutations_HTTP100_40_public18_query9_UTC_grantTTL_RLS_SQLmock; actualDB_network0 |
| read_model_candidate_data_and_independent_review | PASS_LOCAL_FILE_CONTRACT_PREPARATION_AND_FROZEN7_STATIC_READ_NATIVE_RECEIPT_HASH_REUSE; actual baseline_source_fence_publisher_job_seal_lineage_grant remains NOT_READY |
| read_model_actual_DDL_GRANT_RLS_build_query | NOT_RUN_IO_HOLD_AND_PREPARED_ONLY; no space_WAL_cost proof, no full reingestion |
| fresh_UI_project_and_IO | READONLY_DASHBOARD_HEALTHY_CAPACITY_INCREASE_OBSERVED; IOPS_throughput_connection_graphs_unavailable; actual_budget_recovery_UNCONFIRMED |
| new_current_approval_and_runtime_activation | NOT_RUN; prior C expiry not extended; no new descriptor_PIN4_deploy_realJWT_BFF_browser_acceptance |
| live_bounded_actual_first_rows | PASS_APP_NONOWNER_NO_BYPASS_TLS_RLS_READONLY: complete current/member/population101rows bulk payload2877ms; typed public18 closed100items unknowncounts nextcursorPASS. Bounded base101rows987ms. DB writes0. |
| live_bounded_native | PASS_NATIVE_177_REGISTERED_TESTS_AND_CHECK5_NO_DB_NET; INDEPENDENT37_NEW_CURRENT_TESTS_PASS |
| live_bounded_remote_approval | PASS_NEW_PRIVATE_IMMUTABLE_DESCRIPTOR_POST200_AND_RAW_GET200_BYTES_SHA_EQUAL; existing_subjects_preserved; NOT_HTTP_USER_ACCEPTANCE |
| live_bounded_deployment | APPLIED_CURRENT_ADMISSION_REVIEW_SUPABASE_20261010T1023Z; sourcefa6f412 private_release139047_SHA67a96b; legacyJWT_gatewayON; no_C_or_default22_change |
| live_bounded_actual_factory_HTTP | PASS_STORAGE_DB_FULL_FACTORY_HTTP_2PAGES_200100_EACH_1901ms_1931ms; controlled_session_DI_NOT_actualJWT |
| live_bounded_hosted_negative | PASS5_NO_CREDENTIAL401_RELAY_MISSING403_RELAY_WRONG403_NO_USER_JWT401_FAKE_JWT401; no_items_or_secret_values; handler_private_no_store; platform401_header_distinct |
| live_bounded_frontend_delivery | PASS_EXISTING_HANDOFF_NEW_FILE7818B_REMOTE_FETCH_CONTENT_SHA_EXACT_OWNER1_WRITER1; actual_BFF_browser_NOT_RUN |
| current_frontend_receipt_intake | PR18_MERGED_DEVELOP_39061bef_CI880_PASS; prior scoped browser receipts preserved; merge is source integration not new browser runtime or general publication |
| local_owner_status_tools | PASS_FOCUSED71_EXISTING44_PLUS_NEW27_AND_THREE_NATIVE_CLI_PROCESS_SCOPED_SYNTHETIC_FILE_METADATA; OFFLINE_DIAGNOSTICS_DB_NETWORK_ENGINE_BROWSER0; INDEPENDENT_SOURCE_SCOPE_PASS_FINAL_FREEZE_AND_NORMAL_HOOK_PENDING |
| local_C_and_exam_full22_runtime | PASS_TWO_NATIVE_LOCAL_COMPOSITIONS_EXAM38HTTP277ASSERT_AND_C_PLUS_EXAM51HTTP362ASSERT; REAL_OFFICIAL_PACK_AND_FROZEN_C_BYTES; TWO_VIRTUAL_INPUTS_FOUR_ROLES; DB_AUTH_STORAGE_BROWSER_NOT_RUN; FULL22_REGISTERED_NOT_EXHAUSTIVE |
| local_C_and_exam_receipt_sha256 | 2d3adfe1b3f282a1d33e72531a2fddce1bde5168fe1129bf8510d36d0a82c2db |
| historical_before_PR18_merge_current_frontend_receipt_intake | frontend_receipt_intake contains capture SHA/bytes/method and scoped observations; PR18_open is not develop frontend integration |
| frontend_source_develop_integration | {'PR': 18, 'status': 'MERGED_DEVELOP_SOURCE_INTEGRATION_VERIFIED', 'merge_commit': '39061bef39a89b0012053b7687b4906d81fe073b', 'frontend_head': '8d28ce25d578547df242978075e63b59f5c8096f', 'merged_at': '2026-10-11T06:19:45Z', 'CI_run': 38117701300, 'CI_conclusion': 'success', 'CI_tests': 880, 'CI_URL': 'https://github.com/natural0448/Jungsi_touch/actions/runs/38117701300', 'new_browser_runtime_or_operational_acceptance': False, 'main_changed': False} |
| first_local_native_university_conversion | {'private_receipt': 'ACTUAL_NATIVE_HTTP_RECEIPT.v1.json', 'bytes': 298198, 'sha256': 'a822813bbfc6c8d62180f3bc9f75ce38beb42242bfd9a00ca0075525bf28e06c', 'status': 'PASS_SCOPED_ONE_2027_OFFERING_REAL_OFFICIAL_RULE_WITH_OFFICIAL_SEPTEMBER_PACK_VIRTUAL_INPUTS', 'source_HEAD': '39061bef39a89b0012053b7687b4906d81fe073b', 'HTTP_requests': 42, 'checks_PASS': 417, 'registered_operations': 22, 'all22_operation_coverage': False, 'actual_numeric_values_copied_to_Git': False, 'raw_rule_or_source_identity_copied_to_Git': False, 'score_basis': 'mock_exam', 'score_scope': 'csat_component', 'conversion_success_survives_missing_percentile_and_assessment': True, 'overall_distribution': 'pending/total_model_missing', 'university_percentile': 'pending/percentile_release_missing', 'support_decision': 'pending/analysis_release_missing', 'past_year_scores': 'pending/year_bridge_required', 'favorable_candidates': 'pending/approved_candidates_missing_one_offering', 'DB_Storage_live_Auth_browser': 'NOT_RUN', 'production_allowed': False} |
| W1_exact_minimum_local_native | {'status': 'PASS_SCOPED_LOCAL_TCP_WORKTREE_NULLABLE_DELTA_SOURCE_HASH_BOUND_FINAL_GIT_SEAL_SEPARATE', 'private_receipt': 'ACTUAL_W1_MINIMUM_NATIVE_HTTP_RECEIPT.v3.json', 'bytes': 202938, 'sha256': '265654cb74ece1fe29e8eb274dc6c3a2a4f9d7e45ef68b22b0cefed2472317dd', 'source_parent_HEAD': '39061bef39a89b0012053b7687b4906d81fe073b', 'source_mode': 'worktree_nullable_search_delta_bound_by_SHA_not_final_commit_runtime', 'source_hashes': {'src/jungsi_touch/application/platform.py': '05f6924789b868df64fb1689cacdddf7811fd784a7f7224a4389d5ad4ca2d5f4', 'src/jungsi_touch/application/university_scoring.py': '9a62c6e08700180b67bdae3adc77e8b1f65b97fd9266b8eeb154d76f1d7749ef', 'src/jungsi_touch/infrastructure/drive_provider.py': '3b07f85661a10fa69e75d2c1171b91fb73386fe375f85734223379cc62336b16', 'src/jungsi_touch/infrastructure/local_drive.py': 'e2144c5241184b48b408cd4e0de6c212de0dd842a5aee159faf3666b6c518deb', 'src/jungsi_touch/infrastructure/local_verification.py': 'fdb0256b30c83569f8bf7bccaccabfb330c6a471cbe956c6867dce5aa1a913da', 'src/jungsi_touch/infrastructure/http_api.py': '8542be563020783489f473a0b2efdf1f767c8635debc8fd0cc6b46a4d23ca8ca', 'tests/test_backend_workflows.py': '61257531651e1e70060dd58efd214879b5d5332bd52c12eb5c11fa3fb5d3c5c8'}, 'HTTP_requests': 14, 'checks_PASS': 90, 'history_metrics': 143, 'catalog_offerings': 14, 'new_official_metric_count': 3, 'values_copied_to_Git': False, 'closed_projection_internal_fields_absent': True, 'unknown_fields_preserved_null': True, 'estimated_applicants_rejections_approved': False, 'DB_Storage_live_Auth_browser': 'NOT_RUN', 'general_publication': 'NOT_RUN', 'final_Git_blob_binding': 'normal commit exact source seal required; no final commit runtime SHA implied'} |

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



<!-- jungsi:generated spec_sha256=6f267475da0eca992cc0ec1c9fbad8158765c545e3d37c79abfc97d76041fd46 -->
