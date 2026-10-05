# DEV006 서비스·DB 응답과 외부 프런트 인계

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.7.1이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

기준일: 2026-10-05. 상태: **서비스·DB baseline 인수 완료 / 공통 도구 b66 baseline 인수 완료 / 실제 사용자·DB·외부 프런트 검증 대기**. 문서 인계 revision: **7**. 공통 검사·기획 정합성의 확인된 이전 기준은 `b66c2274f0b0a27dc174555adde181cd16c68188`이며 정상 commit/push 훅 530건과 해당 HEAD CI success를 확인했다. revision6 도입부의 새 커밋·CI 대기 문구는 작성 당시 이력이다. 이 문서 이후 커밋의 미래 SHA나 미실행 CI 성공을 뜻하지 않는다.

이 문서는 외부 프런트 전담 개발자가 소비할 공개 구조와 관리 응답의 허용 필드를 설명한다. 실제 성적·입결·키·계수·곡선·운영 연결 값은 포함하지 않는다. 시스템 기획팀은 공통 계약과 인수 기준을, 서비스·DB 개발팀은 백엔드 구현을 담당한다. 프런트 코드와 브라우저 검증은 다른 PC의 전담 개발자가 담당한다.

## ① 구현 기준과 확정 SHA

서비스·DB 수정의 확정 구현 SHA는 **`adc684be2e9d22f8edad766d044b81894676036d`**이며, 부모는 `262e6ba283d37c9e2e446619e6bf1235f4881170`이다. 이 커밋에 원래 검토 지적 7개와 DB002 준비 검사 보완, v1.7.1 공통 계약 및 생성 문서가 함께 포함돼 있다. 해당 코드·계약의 인수 검증을 완료했다.

[PR #13](https://github.com/natural0448/Jungsi_touch/pull/13)을 통해 원격에 공유했다. adc684 인수 시점의 PR은 open/draft였고 그 기록은 역사다. 현재 PR13은 merged이며 develop947cee82f0a91b0ed337753d6e0ae9619e49a78b로 통합됐다. 확정 커밋의 GitHub `project-consistency` 검사 두 건은 모두 success로 확인됐다. 서비스·DB 인수와 develop 통합 완료를 운영 배포·실사용자 검증 완료로 확대하지 않는다.

공통 계약은 [service_spec.json](../../current/service_spec.json), 설명은 [분석화면_연결.md](../../current/분석화면_연결.md)와 [예상기준_산출과_관리.md](../../current/예상기준_산출과_관리.md)를 함께 사용한다. 기획·라우팅·DTO는 같은 공통 명세에서 생성된다. 외부 프런트 연동 시 확정 구현 커밋의 코드와 공통 문서를 함께 사용한다.

확정 구현 adc684의 인수 대상 공통 명세 원본 파일 SHA256은 `37a155ede2d9048b2eb071ba7446ce32e19106aa734be8943a3c738e986472b7`, 그 커밋에 저장된 같은 파일 내용 SHA256은 `8bd3b6cbb9d87875b00533219b56448cbfc26858eac052232465468845d99d42`이다. 이 차이는 Git의 LF 정규화이며 의미 변경이 없음을 독립 대조했다.

현재 공통 명세는 같은 v1.7.1 기능 계약을 유지하면서 서비스·DB 상태를 `implemented_synthetic_HTTP_contract_verified_live_readiness_pending` / `code_verified_live_NOT_RUN`으로 정정했다. 검토 출발점 `9bf81e8d6a04e99086208422021fdb903aff204c`와 인수 구현 adc684를 구분하고, 외부 화면 계약의 `approved_for_implementation` / `verification_pending`은 유지한다. 역사적으로 서비스·DB 개발팀은 adc684 구현과 74fd 인수 상태 정정을 제공했고 PR13의 develop947 통합을 완료했다. 이후 공통 검사·기획 문서 정리는 시스템기획팀이 develop947을 출발점으로 단독 작성한다. 서비스 개발팀은 서비스 계층을, 외부 화면 개발팀은 프런트를 담당한다. 이 문서에 기록한 493건은 adc684의 검사 증거이며 후속 후보의 재검사 결과가 아니다.

프런트의 최신 관측 기준은 외부 화면 담당자의 [PR #6](https://github.com/natural0448/Jungsi_touch/pull/6) 및 `67644ef980e5d0e41afbe6dcc6d419a060979cf8` HEAD다. e12 대비 sameRelease 파일 blob `efb40ce76682dbcea74c6c3716c090303d1c108d`는 변경되지 않았고, score-form/css 변경 관측만으로 버전 값 검증 후속을 완료 처리하지 않는다. 기획팀은 고정 승인 소스 `f46c6635664a6c2315e6c71c4f700aa3e331c60c`의 조상 관계와 정확한 4개 blob/mode의 동일성을 읽기 대조했다. 이 최신 관측은 삭제 승인의 고정 source를 바꾸거나 화면 구현을 통합·인수한 기록이 아니다. 이 채팅에서 만든 임시 프런트 후보는 외부 담당자가 채택한 구현 기준으로 취급하지 않는다.

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

## ④ 실제 연결 설정과 검증 계정

API 구현과 응답 계약은 ①의 확정 구현과 develop947 통합으로 제공됐다. Supabase의 비공개 설정4필드를 받아 settings/JWKS/REST metadata 최소GET를 확인했다. 기존외부API는우리22 API/이용권 계약과달라주소를자동채택하지않는다. DATABASE_URL은추후.env로제공예정이며검수사용자token·이용권·관리 capability·Drive설정도대기다. 실제회원로그인과운영DB/Drive/우리API연동은NOT_RUN, 운영001/002적용은이작업에서수행하지않았다. 키·비밀번호·실제접속값은이문서와Git에넣지않는다.

DB 마이그레이션 `002_forecast_policy.sql`의 실제 운영 DB 적용은 **NOT_APPLIED**, 운영 readiness 검증은 **NOT_RUN**이다. 5개 테이블·002 버전·필수 열 타입/NOT NULL·PK/FK/CHECK·RLS·클라이언트 권한을 확인하는 읽기 전용 준비 검사와 추가형 SQL 검사는 구현·합성 검증했다. 실제 서버 권한·직접 접근 차단·불변 revision·동시 수정·멱등 재시도·원자적 게시와 UTC 저장의 운영 증거는 아직 없다. 운영 마이그레이션을 자동 적용하지 않으며 합성 HTTP·메모리 저장소·DB 모의 검증을 실제 운영 DB 증거로 표시하지 않는다.

## ⑤ 검사 보완과 계층별 완료 상태

공통 명세·생성 문서·라우팅 및 36개 계약 드리프트 검사는 통과했다. 정확 경계·비교 지표·전체 버전 결속·과거 공식 입결 보존·DTO 허용 필드·이유 코드·후보 분리의 서비스 수정과 DB 준비 검사 보완은 ①의 확정 커밋에서 코드 인수를 완료했다.

adc684 서비스·DB baseline의 정상 커밋·push 훅 Git 스냅샷 검사는 역사적으로 **493건 통과, 실패 0·오류 0·건너뜀 0**였다. 별도 공통 도구 baseline b66은 정상 훅 530건 PASS와 정확한 HEAD CI success를 확인했다. 사전 승인한 서비스·테스트 16개 파일과 공통 계약·생성물·검사 도구 25개 파일이 확정 커밋과 동일하거나 LF 정규화만 다름을 독립 확인했다. 합성 서비스 응답의 DTO 허용 필드 40건 대조도 통과했다. 이 40건은 응답 필드 집합 검사이며 운영 연결·예측 정확도 전체를 검증한 수치가 아니다.

인수 증거는 프로젝트 루트의 `outputs/service_review/20261005T104545255261Z/planning-acceptance.json`과 같은 폴더의 `service-fix-byte-verification.json`에 보존돼 있다. 이번 갱신에서는 그 증거를 읽어 인수 상태를 반영했으며 493건 전체 회귀를 재실행하지 않았다. 공통 인수 상태 정정의 문서/라우팅 일치와 36개 계약 검사는 별도 영수증으로 확인한다. 프런트 소스 변경 0, 파일 삭제 0, 보호 대상 경로 추적 0도 adc684 인수 증거에서 확인했다.

서비스·DB 코드를 인수한 뒤에도 운영 DB002 `NOT_RUN`과 `production_ready=false` 제약이 유지되도록 공통 검사 한 조건을 강화했다. 후보 여부만으로 운영 제약 검사를 해제하지 않는다. 기존 운영 DB 완료 위조 거부 테스트를 유지하며, 코드 인수 사실과 실제 운영 인수를 혼동하지 않게 하는 상태 정합성 보완이다.

병합 검사는 승인된 develop 인입 또는 등록 직계 부모를 Git 재구성 결과에 결속하고 기획 경로의 충돌 해결과 별도 수정 범위를 구분하도록 보완했다. 기존 삭제 차단·main 승격·팀 권한·등록 부모·fast-forward 검사와 과거 이력을 유지한다.

과거 검증 범위의 한계: 고정 SHA만 fetch하던 CI에서는 과거 second-parent가 실제 원격 develop 계보에 속했는지까지 인증하지 못했다. 당시 부모별 자동 병합 결과와 직접 수정·삭제·충돌 허용 범위의 검사 증거를 보존한다. 현재 staged 검사는 확인한 `refs/remotes/origin/develop` tip에 결속하며, 확인된 이전 baseline b66의 workflow는 fixed github.sha와 전체 부모 이력 및 develop/프런트 tracking refs를 함께 확보·고정 SHA 확인한 뒤 trusted policy를 검사하며, 해당 HEAD의 project-consistency CI success를 확인했다. 이 증거를 이후 문서 커밋의 미래 CI 성공, 운영 인수나 서버의 강제 보호 완료로 확대하지 않는다.

상태는 기획 계약 검증, 서비스·DB 코드 인수, 외부 프런트 수정/브라우저 인수, 실제 운영 연결을 각각 기록한다. 외부 프런트가 미완료여도 확인된 서비스·DB 검증 결과는 별도로 보고한다. 코드·계약 검사 통과를 전체 서비스나 예측 정확도 완료로 확대하지 않는다.

| 범위 | 이 인계 시점의 상태 |
|---|---|
| v1.7.1 공통 계약·서비스·DB 코드 | 확정 커밋 코드 인수 완료 |
| 서비스·DB 역사 baseline adc684/74fd/947 | 493건 PASS / 해당 구현 CI success |
| 공통 도구의 확인된 이전 baseline b66 | 530건 PASS / 정확 HEAD project-consistency CI success |
| develop 통합 | PR #13 merged, 947cee82f0a91b0ed337753d6e0ae9619e49a78b |
| 외부 전담 프런트 구현·브라우저 인수 | 이 서비스·DB 작업 범위에서 NOT_RUN |
| Supabase Auth settings/JWKS/REST metadata 최소 GET | 읽기 준비 검수 PASS; 실제 로그인·DB 인수와 구분 |
| 실제 회원/이용권·우리 22 API·운영 DB·Drive 연결과 readiness | NOT_RUN; DATABASE_URL .env 추후 제공, 실제 DB 검증 유보 |
| 운영 DB002 적용 | NOT_APPLIED |
| 실제 입결·학생 사례에 대한 예측 정확도 검증 | NOT_RUN |

## ⑥ session.read 제안 PR #5

[PR #5](https://github.com/natural0448/Jungsi_touch/pull/5)의 session.read는정식공통계약에채택됐으며기획팀이2026-10-05T12:42:14Z에중복제안으로closed 처리했다. bb98a825e6cd86a20359557deec114b2980e78cb head와원격branch·원본은보존했다. 과거adc684인수시점의open 상태는이전문서/인수영수증에보존한다. 유용한동적len(operations) 제목과정식session권한/DTO 검사는현재공통도구로계승했다. 종료영수증은비공개outputs/integration_review_20261005T213058546/pr5-closure-result.json, SHA256 e6c15901d815707582b39e24b79f3d8d44d2efe60c8649efb64aad40d70cdb2e에있다.

## ⑦ 초안·기존 프런트 후보 보존

직접 사용자 메시지의 승인 증거를 정확한 4개 프런트 초안 경로에 한정해 확인하고 공통 삭제 등록부에 결속했고 b66을 통해 별도 선행 develop 등록을 확인했다. 증거 thread는 `01a0ccde-6f3d-7772-acd3-3eaca9a67b65`, turn은 `01a10bf5-8841-74a3-93e2-f2e2de8ac674`, message는 `01a10bf5-898b-7180-8442-3bfd4d1c2914`다. 다른 채팅의 승인 주장만으로 판단하지 않는다. 별도 선행 develop 등록과 고정 source/blob/mode/바이트 SHA 및 최초 삭제 사건 검사를 통과해야 하며 같은 커밋의 자기 승인·과거 소급·수정/복원 후 재사용·병렬 재소비를 허용하지 않는다.

승인 경로는 `apps/web/src/lib/contract.ts`, `apps/web/src/lib/api/synthetic-fixtures.ts`, `apps/web/src/app/admissions/possibilities/actions.ts`, `apps/web/src/components/pending-page.tsx` 네 개뿐이다. 실제 삭제 executor는 외부 화면 개발팀이며 실행은 **NOT_RUN**이다. 시스템기획팀은 등록·검사·합성 회귀만 담당한다. 그 밖의 초안·원본·이전 후보·캐시·검토 결과는 보존한다. 이 문서는 실제 삭제 실행 증거가 아니다.


## PR13 서비스 통합과 b66 공통 도구 인수 기준

서비스·DB 구현 adc684와 인수 상태 정정74fd는 PR13 merge commit947cee82f0a91b0ed337753d6e0ae9619e49a78b로develop에통합됐다. 병합트리는493검사HEAD와같으며정확병합SHA CI도성공했다. 앞선493기록은역사증거로보존한다. 공통 도구는 확인된 이전 baseline b66의 정상 훅 530건 PASS와 정확 HEAD CI success로 별도 인수했다. 이후 문서 커밋의 미래 자기 SHA/미실행 CI는 기록하지 않는다.

DEV006⑦의승인등록은공통spec.workflow.branch_governance.file_deletion_policy를따른다. 별도develop선행등록을읽으며정확4경로·origin branch·고정source/blob/mode/바이트SHA·직접사용자증거·원본보존·최초삭제사건을검사한다. 실제삭제의executor는외부화면개발팀이다. 시스템기획팀은 develop947 이후 등록·공통검사·합성검증만 담당하고 실제 파일을 삭제하지 않는다. 서비스 개발팀은 사용자 지시에 따라 서비스 계층에 한정하고 프런트는 외부 전담자 소관이다.

Supabase 최소 GET 준비 검수는 아래 읽기 증거로 확인했다. 실제 회원·이용권·운영 DB/Drive/우리 22 API·검수계정/쿠키도메인·운영DB002·외부브라우저·예측정확도는 새 증거 전 NOT_RUN/NOT_APPLIED를 유지한다. DATABASE_URL은 사용자에게 비공개 .env로 추후 전달받기 전까지 실제 DB 검증을 유보한다. GitHub연동설정은기획팀이조사중이며로컬설정검색결과를외부프로젝트부재로확대하지않는다.


Supabase 최소 GET 준비 검수: Auth settings/JWKS 200, 사용자토큰없는getUser401, server secret의RESTmetadata200, jungsi_backend schema요청401/406으로직접노출거부. 실제관리자계정·회원로그인·이용권·DB/Drive는미검증이며DB접속설정은추후제공예정이다. 기존외부API의me DTO와jeongsi namespace뼈대는우리22 API계약과다르므로주소를자동채택하지않는다. PR5는2026-10-05 중복제안closed이며head/ref와원본은보존했고동적22경로제목·정식session검사를계승했다.

최소 profile 읽기 검수에서 관리자/활성 조건의 메타데이터 표식은 확인했다. 실제 사용자 로그인 JWT 검증·관리 권한 연동·DB/Drive/우리 22 API 검수는 NOT_RUN이다. 공개 문서에는 실제 profile 값·이메일·UUID·키·접속값을 기록하지 않는다. 실제 데이터/모형 운영 채택·등록 승인도 기존 미완료 상태를 유지한다.

## 공통 도구의 확인된 이전 인수 기준

| 범위 | 확인한 증거 |
| --- | --- |
| 공통 Git/CI 검사·명세·생성 문서 | b66c2274f0b0a27dc174555adde181cd16c68188; tree bd23bf5bd1ec0a05fed7c7f8db7db39621bf2748 |
| 정상 commit/push 훅 | 530건 PASS; 실패 0·오류 0·건너뜀 0 |
| 정확한 HEAD GitHub CI | [project-consistency](https://github.com/natural0448/Jungsi_touch/actions/runs/37324278331/job/111810898785): success |
| 서비스·DB 역사 기준 | adc684/74fd 구현과 develop947 통합의 493 PASS는 별도의 역사 인수 증거로 유지한다. |
| 최신 외부 프런트 관측 | 67644ef980e5d0e41afbe6dcc6d419a060979cf8; sameRelease blob efb40ce76682dbcea74c6c3716c090303d1c108d는 e12 대비 동일 |
| 운영/외부 인수 | verification_pending; DB .env 추후; 실제 삭제 NOT_RUN; main not_ready |

확인된 이전 baseline b66까지만 증거로 명시한다. 후속 문서 커밋 자신의 미래 SHA나 미실행 CI 성공을 기록하지 않는다. 공통 Git/CI 검사·명세·생성 문서 인수 및 전체 합성 회귀. 운영 DB·외부 프런트·실제 데이터·모형 운영 승인을 뜻하지 않는다. 외부 버전 release/policy/input 양쪽 값의 유효한 비어 있지 않은 문자열 검증은 후속이며 실제 프런트 인수는 pending이다. 최소 profile 조건 읽기와 실제 로그인 JWT 검증 NOT_RUN을 구분한다. 실제 자료·모형 운영 채택/등록 승인도 유지 상태이며 완료로 표시하지 않는다.

<!-- jungsi:generated spec_sha256=415fd1680673eccffa32b5241c4c97124d9a0579daad936efc6d2680ee2d9a05 -->
