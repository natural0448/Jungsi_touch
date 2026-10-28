# DEV006 서비스·DB 응답과 외부 프런트 인계

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.9.131이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

다음 기존 본문은 1.8.8까지의 준비/관측 이력과 계약 정의다. ②③ 응답 계약은 그대로 유지하고 현재 통합·자료메타 인수는 마지막1.8.9추가관측과current_followup을 따른다.

현재 추가관측은아래⑪에기록한다. 기존본문의SQL미적용/PR대기등은해당시점history이며②③정식응답정의는불변이다.

기획 반영일: 2026-10-06 UTC. 인계 revision **2026.10.06.v3**. 문서 출발 기준은 **2624f0eb1e8ffa52cd86b866e658e7b1ee45e33f**이다. SUP01 별도 정시 FastAPI와 SUP02 public.jeongsi_passes 원본 목표는 확정했다. 현재 entitlements 어댑터/session v1 실행은 아직 전환하지 않았으며 **운영 NOT_READY**다. 문서 prepared_at와 과거 HTTP checked_at는 별개다.

05:32Z 통합 현황과 08:38:58Z~08:40:54Z HTTP 접근 재점검은 기존 관측으로 보존한다. HTTP200/limit=0은 SQL/RLS·이용권·실회원·입시모형 인수가 아니다.

[Supabase 운영 인수인계](../../current/Supabase_운영_인수인계.md)의 SUP-01~11과 [화면팀 회신요청 최종](../../current/화면팀_회신요청_최종.md)의 RF-01~06/로컬 1~6을 따른다. API22/DTO/session v1·4페이지·일반/유료·본인소유권·UTC·학교scope·독립승인은 불변이다.

## ② 관리 초안과 공개 발표본의 응답

`forecast_draft`의 최상위 허용 필드는 다음과 같다.

```text
format, draft_id, offering_id, revision, status,
base_result_hash, policy_version, context,
result, base_result, created_at, updated_at,
adjustments, validation, approval, audit_events
```

- `result`: 현재 revision에서 채택하여 검증할 최종 객체.
- `base_result`: 조정 전 서버 산출 원본. 조정·검증·승인으로 수정하지 않는다.
- 두 객체의 필드: `forecast_70`, `acceptance_range`, `category_ranges`.
- 관리 상태: `draft → validated → approved → published`. 조정하면 새 revision이 되고 이전 검증·승인을 승계하지 않는다.
- `created_at`, `updated_at`, 감사 기록의 `at`은 UTC Z 문자열이다.
- 관리 draft의 최상위 `input_version`은 반환하지 않는다. 초안 생성 요청과 공개 발표본의 `input_version`을 관리 draft 응답과 구분한다.

관리 `context`의 허용 20필드는 다음과 같다. 학교·캠퍼스·전형·모집군을 확인하기 위한 객체이며 공개 발표본의 context와 다르다.

```text
offering_id, offering_lineage_id, academic_year, university_id,
campus, department, track, group, exam_id, source_pack_version,
catalog_version, analysis_version, rule_id, rule_version,
curve_version, population_id, score_scope, score_scale_id,
bonus_treatment, unit
```

중첩 객체는 다음 허용 필드만 소비한다. 필드의 부재·null·실제 0을 구분한다.

| 객체 | 허용 필드 |
|---|---|
| `result.forecast_70` / `base_result.forecast_70` | `status`, `reason_code`, `value`, `unit`, `definition`, `version` |
| `result.acceptance_range` / `base_result.acceptance_range` | `status`, `reason_code`, `lower`, `upper`, `unit`, `definition`, `policy_version` |
| `result.category_ranges[]` / `base_result.category_ranges[]` | `category`, `lower`, `upper` |
| `adjustments[]` | `target`, `replacement`, `reason`, `evidence_refs`, `actor`, `at`, `base_result_hash` |
| `validation` | `status`, `reason_code`, `checks`, `validated_revision`, `result_hash`, `receipt_hash`, `at` |
| `approval` | `approved_revision`, `result_hash`, `validation_hash`, `approval_hash`, `reason`, `at` |
| `audit_events[]` | `action`, `actor`, `at` |

`adjustments[].replacement`는 대상에 따라 형태가 다르다. `forecast_70`은 `value/unit`, `acceptance_range`는 `lower/upper/unit`, `category_ranges`는 `ranges` 배열을 가진 객체다. `ranges[]`에는 `category/lower/upper`만 들어간다.

검증 요청은 현재 revision·기준 해시·정책 버전에 결속한다. 승인 요청에는 `validation.receipt_hash`, 게시 요청에는 `approval.approval_hash`를 전달한다. 영수증은 프런트에서 만들지 않는다. 모든 관리 POST에는 `Idempotency-Key`가 필요하다. 유료 회원 여부로 관리 권한을 부여하지 않으며 서버의 editor/approver 및 허용 학교 범위가 기준이다.

관리 `actor`와 영수증 해시는 관리 권한으로 보호된다. 학생 응답에는 직원 식별·내부 감사 기록·상위 `input_hash/policy_hash`·전체 저장 record·내부 정확값 저장 객체·원자료·계수·trace를 복사하지 않는다.

공개 `forecast_public`의 최상위 허용 필드는 다음과 같다.

```text
format, status, reason_code, offering_id, release_version,
context, policy_version, input_version,
forecast_70, expected_acceptance_range, category_ranges,
basis_summary, issue_summaries, recommendation_reasons,
adjustment_summary
```

공개 `status`는 **`published | pending`**이다. `pending`이면 `release_version/context/policy_version/input_version/forecast_70/expected_acceptance_range`는 null이며, 미발행 사유를 유지한다. 발표본이 `published`여도 예상 70%와 별도 합격권은 각각 `ready/pending`일 수 있다. 70%만 준비됐다는 이유로 최저 합격점·합격확률을 만들지 않는다.

HTTP 오류 응답과 공개 발표본의 `pending` 객체는 별개다. 현재 context 또는 고정 입력·정책 내용이 달라진 공개 조회는 `409` 오류가 될 수 있다. 이 응답을 기존 학생 분석의 발표본과 결합하지 않으며, 학생 분석 경로에서는 성공한 환산·누백을 유지한 채 지원 판단을 보류한다.

공개 중첩 형태는 다음과 같다.

- `forecast_70`: 관리 기준선과 동일한 `status/reason_code/value/unit/definition/version`.
- `expected_acceptance_range`: 관리 합격권과 동일한 `status/reason_code/lower/upper/unit/definition/policy_version`.
- `category_ranges[]`: `category/lower/upper`.
- `recommendation_reasons[]`: `code/text/evidence_refs`.
- `issue_summaries[]`: `issue_id/title/summary/numeric_effect_applied`.
- `adjustment_summary`: `applied/reason/version`.

학생 `assessment.conversion`에는 중복 `rule_explanations`를 추가하지 않는다. 실제 반영 방법 설명은 `assessment.recommendation_reasons`의 등록 코드로 전달한다.

## ③ 학생 분석과 발표본을 같은 근거로 결합하는 조건

학생 `assessment.decision_evidence`와 공개 발표본에 같은 `context`, `policy_version`, `input_version` projection을 전달한다. 공개 context의 허용 17필드는 다음과 같다.

```text
offering_id, academic_year, exam_id, source_pack_version,
catalog_version, rule_id, rule_version, curve_version,
analysis_version, score_scale_id, score_scope, bonus_treatment,
population_id, comparison_metric, unit, direction, tie_policy
```

다음 항목이 전부 일치할 때만 두 응답을 같은 근거로 결합한다.

1. 학생 `forecast_release_version`와 발표본 `release_version`.
2. 두 응답의 `policy_version`, `input_version`.
3. 공개 context 17필드의 값과 타입, 명시적 null.

외부 프런트 `e12dd849fb7f3d2e05fe4fc7655a37d613e349cb`의 읽기 검토는 완료했다. 공개 context 17필드의 순서·값·타입·명시적 null을 대조하고, `409`를 published 조회에서만 처리하여 다른 오류를 가리지 않는 범위는 확인됐다. 다만 버전 세 쌍의 `===`만 검사하면 양쪽 누락값/undefined, null 또는 빈 문자열이 같다는 이유로 결합될 수 있어 외부 담당의 보완이 필요하다.

버전 비교 전 학생/발표본의 release 버전, 양쪽 `policy_version`, 양쪽 `input_version`이 모두 유효한 비어 있지 않은 문자열인지 확인해야 한다. 이 조건을 충족할 때만 원래 값의 exact equality로 결합한다. 한쪽 또는 양쪽의 누락/undefined/null/빈 문자열/잘못된 타입은 `sameRelease=false`로 처리하고 재분석·지원 판단 보류를 표시한다. 미완성 응답을 지원하는 기존 DTO nullable 계약은 유지한다. 외부 담당은 정상 동일/불일치와 한쪽·양쪽 누락/null/빈 값/잘못된 타입 회귀를 추가해야 하며, 이 채팅의 실제 화면 변경·브라우저 인수는 **NOT_RUN**, 전체 프런트 상태는 **verification_pending**이다.

학생 분석은 계산할 때 채택한 발표본 버전을 유지한다. 새 발표본을 읽어 옛 학과 판정에 새 컷만 덧붙이지 않는다. 발표본·자료·규칙·곡선·카탈로그가 달라지면 재분석 대상으로 표시하고 새로운 학생 분석 revision에서 채택한다. 필요한 값이 없거나 결속이 틀리면 성공한 환산·누백과 과거 발표 자료는 유지하면서 지원 판단만 보류한다.

`comparison_metric`은 `converted_score | university_top_percent`다. 점수는 내부 정확 환산값, 단위 `점`, 방향 `higher_is_better`, 동점 정책의 해당 없음은 `tie_policy=null`이다. 대학 누백은 `percentile.top_percent`에 대응하는 정확 비율, 단위 `%`, 방향 `lower_is_better`, `tie_policy=include_equal`이다. 전체 국수탐2 `overall` 누백을 대학 누백 비교 값으로 대신 넣지 않는다.

`population_scope`와 `data_kind`는 `percentile` DTO에서 전체/반영 필수 비교집단 및 관측/추정 의미를 표시한다. 공개 발표본 context에 이 두 필드를 가공해 넣거나 관리 context로 대신 결합하지 않는다.

이유 코드는 반영 방법, 지원 판단, 환산 유불리의 세 종류로 구분한다. 우수 탐구 반영·영어 등급 차감 같은 규칙 설명만으로 학생에게 유리했다고 표현하지 않는다. 정확한 동일 모집단 위치 차이의 근거가 있을 때만 유불리 이유를 생성한다.

후보 응답의 `outside_offerings`, `ineligible_offerings`, `pending_offerings`는 각각 판단 완료 추천 범위 밖, 확인된 조건 미충족, 자료·자격·승인·버전 부족에 따른 보류다. 추천 대학이 0개여도 모든 판단이 outside/ineligible로 완료됐다면 정상 `ready` 빈 결과다. 실제로 모두 보류인 `pending`과 구분한다.

## 최소설정 조회와 실제운영

05:32Z 이전 통합 snapshot을 보존한다. 최신 재점검에서는 파일·키 없는 JWKS200, Auth settings401, user401을 확인했다. 기존 비공개 보관 키로 Auth settings200·JWT 없는 user401·공개키 REST metadata401·서버키 REST metadata200·비공개 schema REST406/PGRST106을 확인했다. 08:40:54Z public 테이블 limit=0 조회200/응답[]이며 실제 레코드 취득0건·DB쓰기0·새.env 생성0이다. 테이블 총건수·SQL/RLS·회원 이용권은 미검증이다. PGRST106은REST비노출이며SQL schema부재/권한실패가아니다. 개인식별값·projectURL/id·키·JWT·자료hash·비공개PC경로는공개하지않는다.

기존 비공개 파일에서 URL/publishable/secret/JWKS 참조를 확인했다. 이번 프로세스와 해당 PC User/Machine 환경에서는 이 4개 및 DATABASE_URL/검수JWT 6개 이름이 부재였다. DATABASE_URL/검수JWT는 확인한 파일·환경 범위에서 미확보이며 다른 PC·배포 서버의 부재를 단정하지 않는다. .env 파일 자체는 필수가 아니고 ServerSettings는os.environ만 읽는다. 기존 파일의 보관과process주입은별도다. secretkey는DB비밀번호·사용자JWT가아니며현재getUser뒤sub/exp검증을JWKS직접검증완료로기록하지않는다. Console 브라우저 상태조회는 시간초과로 권한 미검증이다. 과거siteadmin표식조회는현재실로그인/consoleadmin/paid권한이아니다.

## 이전코드 인수 이력

PR13 adc684/74fd/947의493건·b66의530건·PR14 구현429/병합91과 문서816의 정상561건/정확CI는 확인된 이전 코드 인수 이력이다. 이번 문서 후보의 미실행 검사·미래 commit/CI와 실제 운영 완료를 뜻하지 않는다.

## ⑥ 외부화면 당시 관측과 현재 기준

05:32Z 당시 PR6 head ff2a8e412c7adc16eb61af34a6219a2c5c2d072b/base816/open-unmerged를 읽기 관측했다. 후속 root API 관측에서 PR6는 closed/merged, head6b2 exactCI2 success·develop2624를 확인했다. 과거05:32Z 관측은 보존하며 새 로컬 보고는 document_reported 범위를 독립 문서 검토했지만 직접 브라우저/운영 인수는 NOT_RUN이다. 347 빈학교 표시 fix는 이 develop에 포함되지 않는다. d7/e164·4cc source/CI는역사로보존하며최신실Caller/운영API/4페이지·브라우저는NOT_RUN이다. nonempty 3버전/context17·409부분보류/성공점수보존을외부인수조건으로유지한다.

## 권한·자료·실행 승인

목표 단일 authority는 public.jeongsi_passes로 확정했다. 현재 기본 jungsi_backend.entitlements/session v1은 그대로이며 목표 어댑터·DDL/사용자키·권한 SQL·취소/회수는 별도 계약/구현/검수다. 관리자 열람 예외의 서버 조회·별도 capability·operation·화면/session CR과 활성 MAX(ends_at)은 미채택 제안/회신 대상이다. paid profile/admin자동승격금지와staff학교scope·editor/approver독립을유지한다. 승인 자료 0, 로컬 후보 1건의 관측 engine_approved=false는 HOLD다. 미승인 자료/합성 모형의 production_allowed=false를 true로 승격하지 않는 정책을 유지하며, 후보에서 그 필드를 관측했다는 주장이 아니다. Drive자동OAuthrefresh는미구현이며marginal수치QA로jointcurve완성을판정하지않는다.

PR5closed/보존ref와정확4파일f46/선행등록/기본deny/단회origin삭제검사는그대로다. d7외부제거관측은역사이며새삭제허용/이번팀실삭제아니다. 001실적용UNCONFIRMED/002NOT_APPLIED·mainnot_ready를유지한다. 이번문서는DB쓰기/migration/모형승인/main병합/배포실행승인이아니다. 원본/이전문서/backup/cache/검수결과는모두보존한다.

## ⑧ 확정 결정과 후속 회신 요청

SUP01/02 의사결정 대기는 해소했지만 배포 제공자·Connect·public master 어댑터·관리자 예외 CR은 NOT_RUN/회신 대기다. RF-01 BFF/CSRF/사용자·서버 신원, RF-02 관리자 표현, RF-03 DDL/사용자키/권한 SQL, RF-04 모드/실연결, RF-05 PR/SHA/증거, RF-06 명부/계정/기대값을 직접 회신받는다. HMAC/session v2는 미채택 제안이고 이번 문서가 실제 코드/운영 설정을 바꾸지는 않는다.

기존 로컬 요청 1~6에는 별도 local factory·네 opaque subject·loopback·수신 PC DPAPI·신뢰 명부 version/SHA·미등록/등록미채택 시험팩의 두503을 나누고 승인·유효 exam 계산 성공에서만 총점/subjects·curve 없음 pending을 보존·데이터팀 공급·출발/후속 검수 SHA 구분으로 답한다. 메모리 성적/리포트/관심학교/관리초안·발표는 재시작 시 소실한다. DPAPI 자료 캐시와 운영 DB 영속성은 다르다.

화면 반출 방지는 SEC-02 전달물/SEC-03 BFF·실세션·CSRF·서버신원/SEC-07 429·안전한503/no-store/SEC-08 세 gate의 같은 snapshot 실제 검수를 선행한다. 서비스팀의 재귀 DTO·공유 원자적 예산과 외부 화면팀의 Caller/브라우저/preview 담당을 분리한다. 무료 전체 누백·유료 전체 대학/학과 검색 및 기존 성공점수/부분 HOLD를 유지한다. 공개 회신에는 실제 설정/개인정보/성적/자료 hash/운영 한도를 넣지 않는다.

개발팀 보완 조건: 요청 시험팩 엔트리가 없거나 MissingDataProvider가 None을 반환하면 overall.analyze는 exam_not_available/HTTP503이다. 엔트리가 등록됐지만 미채택이면 provider의 artifact_not_approved/503을 overall이 exam_data_unavailable/HTTP503으로 변환한다. 승인·유효 시험팩 계산 성공 후 모형 없음/미승인에서만 total_standard_score/subjects를 보존하고 total_model_missing/total_model_not_approved pending/null을 구분한다. approved_count=0만으로 두503 중 하나를 결정하지 않는다. 요청 localhost3003은 local serve의 정확 Origin으로만 명시하며 운영 configured_app을 선택하지 않는다. 네 subject/수신 PC DPAPI·SSR 실제 로그인은 독립이다. public master 전이는 reader/factory/probe/checker1284/정본 session 규칙을 같은 구현 PR에 묶고 이번 old pin은 유지한다. admin SSR gate/internal admin_read/opt-in v2는 대안·미채택이며 shortlist 예외도 별도 CR이고 owner·editor/approver scope/독립승인을 유지한다.

현재 기준 보완: PR6 merged/head6b2 CI2는 source 관측이며 새 로컬 보고의 브라우저/비노출/오류응답 독립 인수는 대기다. source e764의 시험팩 code 구분은 정적 판독이며 기존 catalog/권한/host native 증거로 overall 두503을 관측했다고 주장하지 않는다. 소유자 user_id uuid/MAX 동의 보고도 실제DDL·권한SQL 인수가 아니다. FE-01~05 후속 지시의 입력/증거 충족 전 NOT_RUN을 유지한다.

마지막 범위 정리: PR6의 head6b2 CI2는 같은 head이고 347은 develop2624의 ancestor가 아니며 빈학교표시fix도없다. FE-05 후속PR통합을요청한다. 로컬 네역할/HOLD·503/HTML검색0·경고는 document_reported pass, 직접root브라우저·전체JS/RSC/JSON/maps/storage/download·실429/공유예산/서버신원/preview·권한양성/자기승인·숫자/실DBAuth/운영은NOT_RUN/PENDING이다. FE-01 live.ts55 위험은P2 정적추론/실행미재현이며 외부화면팀이수정한다.


## ⑨ 실제 Supabase staging 및 source DDL 수령 — 후속 snapshot

현재 문서 출발 기준은 4366d67732556b69a17ebad03dbb5fc8bf1d6671이며 앞의 v3/2624 관측은 당시 기록으로 보존한다. 신규 private Storage 생성·49객체 해시 재수신·원본 보존/public 경로98거절과 source9파일/30SQL 검토·OpenAPI9컬럼 metadata를 수령했다. 실제 raw Storage 인증사용자/RLS·signedURL·SQL DB/권한·migration·자료/모형 채택·운영은 별도 미검수다. CR-SERVICE-SUP03 서비스 구현 준비가 채택됐으나 default 운영 factory/old entitlement/session v1 세필드/Drive·22API·4페이지·보안은 전환하지 않았다. 구체 현재 상태는 [Supabase 운영 인계](../../current/Supabase_운영_인수인계.md)의 실제 업데이트/source 입력 절을 따른다. 실제 자료경로/SHA/키는 private 영수증에만 두며 화면/코드로 복사하지 않는다.


### ⑩ 실제 DB 사전 검수와001·002 적용의 단계 구분

양계정 실제 TLS/role/master 최소SELECT와 기존 두 SELECT policy를 사전 catalog에서 확인했다. 이후 owner 단일transaction의 신규 private schema/13RLS tables·001002 적용 개발 영수증을 수령했으나 독립 원장 검수 pending·private app 정책0/runtime003·실 사용자권한/기본factory·운영은 미인수다. 이전 Storage/HTTP의 SQL NOT_RUN은 당시 관측으로 보존한다. CR-SERVICE-SUP04의 app-only/current_user·migration owner runtime거절을 채택하고 master9컬럼SELECT의 임의 REVOKE는 금지한다. PR15 정적 빈학교/숫자범위fix와 CI2 관측은 수용하고 FE-01R HTTP-date 문법 잔여·실브라우저/429·통합 인수는 후속이다.


### ⑪ 003·최소자료·PR15통합의현재단계

003은정확인간승인후적용하고fresh24policy/SELECT13·INSERT9·columnUPDATE6의최소권한metadata를확인했다. 실제10합성행은새process/TLS연결로영속성·CAS/멱등/소유권거절을검수했으나실학생/Auth/유료rows·운영전체인수는아니다. 명시port actualDB/master metadata는PASS이고health503는구성/자료/실세션준비보류다. 최소시험팩1건/328915B는statusstaged·승인0/unbound/engineprodfalse·provider미승인거절/network0이다. 수학한구간/9경계부분QA는wholeexam/CDF/공식정수백분위·실화면mode승인이아니다. PR15 ef7b7c08 exactCI2와develop3d90정상merge/삭제0·branch보존은확인됐고FE-01R·FE-ORIGIN·FE-SOURCE-01·browser/429·securitygate는pending이다. 직접인간은기본경로유지·명시연결만준비를선택하여CR06source변경0/defaultlegacy를유지한다. 서비스7준비파일/33focusedPASS와641이전9ERROR/별도fixture10PASS를같은Git전체검수와분리한다. 실제승인자료활성화·JWT·livehost·기본factory·운영은미완료이며minimalallowlist/49archive보존·API22/session3/page4·productionfalse/NOT_READY를유지한다.

기본factory전환안CR06은직접인간이허용하지않았고명시연결준비만진행한다. owner는이관전용·운영서버app DATABASE_URL만·외부화면공개설정/APIorigin만전달한다. 실제secret/DBURL/자료hash·경로/공식점수/학생값은공유문서에복사하지않는다. FE-SOURCE-01 외부담당회신요청: https://github.com/natural0448/Jungsi_touch/pull/15#issuecomment-6018143154 .


1.8.9 최신 통합·자료 경계: 현재 develop57f74b1daabd2d6a8e94de216f182e8bfe6557b7에 서비스phase2와 승인된 병합 하네스 수정이 통합됐다. 정상precommit/prepush/정확HEAD pushCI/PR병합시험CI/최종developCI각678PASS·실패/오류/skip0이며 main은 보존했다. source메타draft16과 선별Storage16(fullSHA독립/noJWT64)을 확인했다. 원수능AST source는 보존하고 모평적용child3의 source/applicationContext를 분리 확인했다. engine/production/runtimefalse·publishednull과 기본회원경로유지/명시DI만준비선택은 확정 유지다. 공식입결2객체는 전달검수PASS이나 의미충돌·중복·실기/전형PK혼입으로 DB등록0/채택보류이고 catalog최종영수증을 기다린다. v2설계승인·14경로구현계획은 준비됐으나 코드0·품질/newscopeFE공통계약/모형호환·계산채택은 미완료다. 실제JWT/APIorigin·22API/4페이지/보안운영·live배포는 미인수다. 과거제안/실패/fixture·관측은 보존한다.

관리owner의 source메타 등록은 일회성 이관 작업이며 상시 API/상시권한을 만들지 않는다. source 원본manifest버전과 승인runtime발행버전을 구분한다. 사용자는 기본회원경로유지·명시연결준비를 선택했으며 기본전환승인 대기는 아니다.

최소공식source v4 후속: v2/v3 의미실패와 원본은 보존한다. 일부대학/학교년도 최소선별본의 local/remote native대조PASS는 수령했으며 신규2개DB메타등록/전체18독립검수는최종영수증대기다. 현재등록확정16·engine/production/runtimefalse·publishednull을유지한다. StorageRLS metadata상현재보호bucket클라이언트SELECT허용조건은없지만실제JWT/authenticated HTTP/SEC운영gate는NOT_RUN이다. 최신구현계획v1.1도14경로PLAN_ONLY/code0이며 JSONL구문검사와의미전수QA는구분한다.

최소공식source최종등록관측: 신규2source메타INSERT COMMIT/fresh app exact18과독립Storage/native58·frozenRAM39를수령했다. 현재선별Storage18/fullGETSHA/비인증72본문미반환이며전체bucket파일수가18인것은아니다. source-only draft18·발행0/engine/production/runtimefalse/publishednull·실회원JWT/운영주소/22API4페이지/배포NOT_RUN을유지한다. 일부3교9학교년도451지표249모집행선별범위는전국완료가아니다. 최종app18독립영수증은대기다. 원문census검수당시불변snapshot과이후append를구분하며원본손상/유실을주장하지않는다. 이번1.8.9후보의새훅/CI는아직미실행이다.

1.8.9최종FROZEN관측: appTLS READONLY exact18/old16불변/new2exact/missing0/non-target0의독립PASS를수령했다. 기존003권한/13RLS24policy/publicpasses·profiles/Storagebaseline보존과독립검수DB쓰기/owner/CloudGET/Auth0을구분한다. source-onlydraft18·발행0/engineproductionruntimefalse/publishednull·전국QAfalse·실JWT/22API4페이지/운영주소/배포·보안운영회원검수NOT_RUN은그대로다. 이번FROZEN은검토문서27개만동결한것이며이문서의정본반영/정상commitpush훅/정확HEADCI는미실행이다. 현재기준은이미확인된57이고미래자기커밋SHA를쓰지않는다.

최종메타집계보강: 실제등록·정책34조건PASS/실패0, 기존GET18의bytes/SHA·DB18결속32조건PASS/실패0·새GET0을추가영수증으로확인했다. 누적선별source18/비인증72본문미반환의집계이며실JWT·학생계산·운영엔진/보안gate인수가아니다. 이번문서정본반영/새훅/CI는여전히NOT_RUN이다.

1.9.19 DEV-011 후속 관측: 기본7 Edge 설정은 지정 관리자의 등록 영수증v2와 Dashboard의7이름/등록시각/digest 목록으로 확인했다. Secret 관리권한·기본회원·원 engine/productionfalse는 유지한다. fresh v5 실제 app READONLY/TLS 공급자140공식지표/12모집행·DI HTTP100/40 각 dataJOIN1·RLS19view/3표 검수는 PASS이고 실제JWT/클라우드SQL/BFF/브라우저/보안gate와 구분한다. 원catalog의+00:00 시각을 변경하지 않고 TS에서 Z와동등 microseconds로읽어 Deno33 및 승인descriptor 파일 양성/만료/회수/목적/TTL 음성검수PASS를 확인했다. 승인판·불변PIN3은 비공개 준비 상태이고 실등록·함수배포/관측URL은NOT_RUN이다. 기존v4 57014·번들 도구OSerror2 실패와 데이터팀 후속v35 DiskFull53100 파일관측은 각각보존·원인미확정이다. C 수신은 재구성924B 내용/보고SHA 일치만 확인했고 수신실제 기계검수 원영수증 bytes 미확보로 CLI재개 NOT_ACCEPTED다. 새code/docs 후보의정상 훅/CI는 별도 영수증으로 판정하며 미실행 성공이나 미래자기SHA를 기록하지 않는다.


[로컬 검증 계약과 실행 후보](../../current/로컬_검증_연결.md)를 함께 읽는다.

## Supabase 운영 인수 상태

보관된 이전 운영 검수 이력: 현재 develop57f74b1daabd2d6a8e94de216f182e8bfe6557b7에 서비스phase2와 승인된 병합 하네스 수정이 통합됐다. 정상precommit/prepush/정확HEAD pushCI/PR병합시험CI/최종developCI각678PASS·실패/오류/skip0이며 main은 보존했다. 최소source-only draft18의신규2 ownerINSERT COMMIT/freshapp18과선별Storage18(fullGET/SHA·비인증72건본문미반환)을확인했다. 최종appTLS READONLY exact18/old16불변/new2exact 독립영수증도PASS이며003/13RLS24policy·공개/Storagebaseline보존을확인했다. 원수능AST source는 보존하고 모평적용child3의 source/applicationContext를 분리 확인했다. engine/production/runtimefalse·publishednull과 기본회원경로유지/명시DI만준비선택은 확정 유지다. 공식입결v2/v3의미실패는보존하고 최소선별v4의일부학교/학교년도local·remote native범위PASS를 수령했다. 신규2개DB메타등록을수령하고최소공식source2의독립native58/frozenRAM39를기록했으며전체draft18/발행0·전국완료false를유지한다. 최종freshapp18독립검수도완료했다. StorageRLS메타는현재보호bucket에클라이언트SELECT허용조건없음을확인했으나실제JWT HTTP/운영SECgate는NOT_RUN이다. v2설계승인·최신v1.1/14경로PLAN_ONLY구현계획은 준비됐으나 코드0·품질/newscopeFE공통계약/모형호환·계산채택은 미완료다. 실제JWT/APIorigin·22API/4페이지/보안운영·live배포는 미인수다. 과거제안/실패/fixture·관측은 보존한다.

2026-10-10 Owner 작업 준수(DEP-IO-01-WINDOW): 대량 작업은 매일 02:00~06:00 KST, 최대 4시간의 조건부 창에서 한 팀의 한 작업만 수행한다. 시작 전 경고가 있으면 그날 SKIP하고 일관된 체크포인트에서 중단하며 기존의 더 짧은 배치·bytes·5초·RLS·subject·승인/만료 한계를 유지한다. 소량 조회 예외는 과거57014 전수 쿼리나 요청 수·limit만으로 적용하지 않는다. CAP-03은 정확한 표·PK·열·영향·비삭제 대안의 별도 제거 승인 전 단계이며 registry/overlays를 보존한다. 정확 관측 시각 UNCONFIRMED·원인/예산 회복 미확정·I/O HOLD·컴퓨트 변경 보류다. Storage·정리·VACUUM·read model·배포·PIN/만료 연장·자동 실행은 이번에 수행하지 않았다. 공식 입결 DB 표시 연결 문서의 같은 ID 준수 절을 함께 따른다. 지표 확장/가산점 요약은 데이터팀·서비스팀의 미채택 CR 준비안 검토까지 완료했고 자료 발행·DTO/엔진/화면·실API/BFF 인수는 NOT_RUN이다.

2026-10-10 읽기 모델 수정 후보(spec1.9.33): 사용자 지시에 따라 개발팀은 현재 정본의 검색용 narrow model과 명시 provider/handler·typed 검증·prepared DDL7파일 후보를 구현하고 데이터팀·독립 검토·native 합성 HTTP를 준비한다. 서명 유효성과 전체 원형 census·source coverage/fence 완전성은 별도 판정이며 실제 trusted baseline receipt 부재는 NOT_READY다. 기존 전수5초57014 실패는 보존하고 실제 DDL/GRANT/RLS·model build·성능·새 승인 PIN4·배포·JWT/BFF/브라우저는 NOT_RUN이다. DB 정리·VACUUM·과금 변경은 수행하지 않는다. fresh UI에서는Healthy와 용량 증가만 확인했으며 IOPS/처리량/연결 그래프는 불러오지 못해 I/O 회복 미확정/HOLD를 유지한다.

[Supabase 운영 인수인계](../../current/Supabase_운영_인수인계.md)를 따른다. revision 2026.10.07.v9; HTTP 관측 시각 2026-10-06T08:40:54.349322Z.

[화면팀 최종 회신 요청](../../current/화면팀_회신요청_최종.md)의 RF-01~06과 로컬 요청 ①~⑥를 함께 인수한다. 문서 전달 준비 완료는 담당자 회신·실제 연결·운영 검수 완료를 뜻하지 않는다.

[화면팀 후속 작업 지시](../../current/화면팀_후속작업_지시.md)의 FE-01~05는 로컬 검수 보고 이후 발견한 결함·증거 보완·승인 자료 대조·후속 PR 통합을 담당한다.

PR13 adc684/74fd/947의493건·b66의530건·PR14 구현429/병합91과 문서816의 정상561건/정확CI는 확인된 이전 코드 인수 이력이다. 이번 문서 후보의 미실행 검사·미래 commit/CI와 실제 운영 완료를 뜻하지 않는다.

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

[외부접근 데이터보호 개발기준](../../current/외부접근_데이터보호_개발기준.md)을 작업 전에 반드시 읽는다. 정본은 service_spec.json의 security_contract와 workflow.development_harness이며 보안 revision은 2026.10.06.v1이다. REQ-24~26 / SEC-01~08은 화면·API·DB 개발의 공통 기준이다. 공개 응답의 재귀 허용목록, 서버 중계와 사용자 권한, 공유 누적 사용량 통제를 함께 구현한다. 기획·라우팅·route_catalog와 AGENTS 필수 참조는 동일 Git 스냅샷에서 하네스가 검사한다. 현재 운영 인수는 production_ready=false이고 3개 보안 release gate는 pending이다. 문서/계약 검사 통과는 런타임 차단 구현·브라우저·운영 DB 검수 완료와 구분한다.

## 2026-10-14 오픈 전 최신 확정

유료 이용권 원본은 public.jeongsi_passes이며 관리자 접근 예외는 동일 검증 Bearer·본인 role=admin/status=active·aal2·요청 내부 origin이 모두 필요하다. 실제 만료 우선, 예외만 paid+null, 일반 paid 만료 누락503과 FE-ADMIN-ACCESS-01을 따른다. 관리 8경로의 검증 aal2·본인 active 상태·기존 학교 권한을 결합한다. 이 문서에 남은 과거 어댑터/명시 연결 전용 결정은 당시 이력이다. 현재 변경 범위와 검수 상태는 [오픈 전 보안운영 변경](../../current/오픈전_보안운영_변경.md)와 opening_security_operations_contract를 우선한다. API22/session3·자료 승인/보존 경계는 유지한다.



<!-- jungsi:generated spec_sha256=5f66e0111535f81cf917e58e2de65665851137b3648820809a691b42b1eeb4dc -->
