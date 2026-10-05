# DEV006 서비스·DB 응답과 외부 프런트 인계

기준일: 2026-10-05. 상태: **서비스·DB 확정 코드 인수 완료 / 공통 계약 동일성 확인 / develop 통합 대기**. 문서 인계 revision: **4**.

이 문서는 외부 프런트 전담 개발자가 소비할 공개 구조와 관리 응답의 허용 필드를 설명한다. 실제 성적·입결·키·계수·곡선·운영 연결 값은 포함하지 않는다. 시스템 기획팀은 공통 계약과 인수 기준을, 서비스·DB 개발팀은 백엔드 구현을 담당한다. 프런트 코드와 브라우저 검증은 다른 PC의 전담 개발자가 담당한다.

## ① 구현 기준과 확정 SHA

서비스·DB 수정의 확정 구현 SHA는 **`adc684be2e9d22f8edad766d044b81894676036d`**이며, 부모는 `262e6ba283d37c9e2e446619e6bf1235f4881170`이다. 이 커밋에 원래 검토 지적 7개와 DB002 준비 검사 보완, v1.7.1 공통 계약 및 생성 문서가 함께 포함돼 있다. 해당 코드·계약의 인수 검증을 완료했다.

[PR #13](https://github.com/natural0448/Jungsi_touch/pull/13)을 통해 원격에 공유했다. 이 인계 시점의 PR은 **open / draft**이며 develop 통합은 예정 상태다. 확정 커밋의 GitHub `project-consistency` 검사 두 건은 모두 success로 확인됐다. 서비스·DB 코드 인수 완료를 develop 통합 또는 운영 배포 완료로 확대하지 않는다.

공통 계약은 [service_spec.json](../../current/service_spec.json), 설명은 [분석화면_연결.md](../../current/분석화면_연결.md)와 [예상기준_산출과_관리.md](../../current/예상기준_산출과_관리.md)를 함께 사용한다. 기획·라우팅·DTO는 같은 공통 명세에서 생성된다. 외부 프런트 연동 시 확정 구현 커밋의 코드와 공통 문서를 함께 사용한다.

확정 구현 adc684의 인수 대상 공통 명세 원본 파일 SHA256은 `37a155ede2d9048b2eb071ba7446ce32e19106aa734be8943a3c738e986472b7`, 그 커밋에 저장된 같은 파일 내용 SHA256은 `8bd3b6cbb9d87875b00533219b56448cbfc26858eac052232465468845d99d42`이다. 이 차이는 Git의 LF 정규화이며 의미 변경이 없음을 독립 대조했다.

현재 공통 명세는 같은 v1.7.1 기능 계약을 유지하면서 서비스·DB 상태를 `implemented_synthetic_HTTP_contract_verified_live_readiness_pending` / `code_verified_live_NOT_RUN`으로 정정했다. 검토 출발점 `9bf81e8d6a04e99086208422021fdb903aff204c`와 인수 구현 adc684를 구분하고, 외부 화면 계약의 `approved_for_implementation` / `verification_pending`은 유지한다. 이 인수 상태 정정·생성 문서·전달 문서의 후속 변경은 개발팀이 adc684 위에 적용하고 같은 Git 스냅샷을 전체 검사해 새 커밋으로 공유한다. 이 문서에 기록한 493건은 adc684의 검사 증거다.

프런트 기준은 외부 화면 담당자의 [PR #6](https://github.com/natural0448/Jungsi_touch/pull/6) 및 제공한 `6c22…` HEAD다. 전체 SHA와 최신 상태는 외부 담당자의 인계에서 확인한다. 이 채팅에서 만든 임시 프런트 후보는 외부 담당자가 채택한 구현 기준으로 취급하지 않는다.

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

학생 분석은 계산할 때 채택한 발표본 버전을 유지한다. 새 발표본을 읽어 옛 학과 판정에 새 컷만 덧붙이지 않는다. 발표본·자료·규칙·곡선·카탈로그가 달라지면 재분석 대상으로 표시하고 새로운 학생 분석 revision에서 채택한다. 필요한 값이 없거나 결속이 틀리면 성공한 환산·누백과 과거 발표 자료는 유지하면서 지원 판단만 보류한다.

`comparison_metric`은 `converted_score | university_top_percent`다. 점수는 내부 정확 환산값, 단위 `점`, 방향 `higher_is_better`, 동점 정책의 해당 없음은 `tie_policy=null`이다. 대학 누백은 `percentile.top_percent`에 대응하는 정확 비율, 단위 `%`, 방향 `lower_is_better`, `tie_policy=include_equal`이다. 전체 국수탐2 `overall` 누백을 대학 누백 비교 값으로 대신 넣지 않는다.

`population_scope`와 `data_kind`는 `percentile` DTO에서 전체/반영 필수 비교집단 및 관측/추정 의미를 표시한다. 공개 발표본 context에 이 두 필드를 가공해 넣거나 관리 context로 대신 결합하지 않는다.

이유 코드는 반영 방법, 지원 판단, 환산 유불리의 세 종류로 구분한다. 우수 탐구 반영·영어 등급 차감 같은 규칙 설명만으로 학생에게 유리했다고 표현하지 않는다. 정확한 동일 모집단 위치 차이의 근거가 있을 때만 유불리 이유를 생성한다.

후보 응답의 `outside_offerings`, `ineligible_offerings`, `pending_offerings`는 각각 판단 완료 추천 범위 밖, 확인된 조건 미충족, 자료·자격·승인·버전 부족에 따른 보류다. 추천 대학이 0개여도 모든 판단이 outside/ineligible로 완료됐다면 정상 `ready` 빈 결과다. 실제로 모두 보류인 `pending`과 구분한다.

## ④ 실제 연결 설정과 검증 계정

API 구현과 응답 계약은 ①의 확정 커밋으로 제공됐다. 실서비스 API 주소, Supabase 프로젝트/공개 설정, 실제 계정·이용권·관리 capability는 **아직 미제공**이다. 키·비밀번호를 채팅이나 이 문서에 넣지 않는다. 운영 설정·실계정 로그인·실제 Supabase/DB/Drive 연동 검증은 **NOT_RUN**이다.

DB 마이그레이션 `002_forecast_policy.sql`의 실제 운영 DB 적용은 **NOT_APPLIED**, 운영 readiness 검증은 **NOT_RUN**이다. 5개 테이블·002 버전·필수 열 타입/NOT NULL·PK/FK/CHECK·RLS·클라이언트 권한을 확인하는 읽기 전용 준비 검사와 추가형 SQL 검사는 구현·합성 검증했다. 실제 서버 권한·직접 접근 차단·불변 revision·동시 수정·멱등 재시도·원자적 게시와 UTC 저장의 운영 증거는 아직 없다. 운영 마이그레이션을 자동 적용하지 않으며 합성 HTTP·메모리 저장소·DB 모의 검증을 실제 운영 DB 증거로 표시하지 않는다.

## ⑤ 검사 보완과 계층별 완료 상태

공통 명세·생성 문서·라우팅 및 36개 계약 드리프트 검사는 통과했다. 정확 경계·비교 지표·전체 버전 결속·과거 공식 입결 보존·DTO 허용 필드·이유 코드·후보 분리의 서비스 수정과 DB 준비 검사 보완은 ①의 확정 커밋에서 코드 인수를 완료했다.

정상 커밋·push 훅의 확정 Git 스냅샷 전체 검사는 **493건 통과, 실패 0·오류 0·건너뜀 0**이다. 사전 승인한 서비스·테스트 16개 파일과 공통 계약·생성물·검사 도구 25개 파일이 확정 커밋과 동일하거나 LF 정규화만 다름을 독립 확인했다. 합성 서비스 응답의 DTO 허용 필드 40건 대조도 통과했다. 이 40건은 응답 필드 집합 검사이며 운영 연결·예측 정확도 전체를 검증한 수치가 아니다.

인수 증거는 프로젝트 루트의 `outputs/service_review/20261005T104545255261Z/planning-acceptance.json`과 같은 폴더의 `service-fix-byte-verification.json`에 보존돼 있다. 이번 갱신에서는 그 증거를 읽어 인수 상태를 반영했으며 493건 전체 회귀를 재실행하지 않았다. 공통 인수 상태 정정의 문서/라우팅 일치와 36개 계약 검사는 별도 영수증으로 확인한다. 프런트 소스 변경 0, 파일 삭제 0, 보호 대상 경로 추적 0도 adc684 인수 증거에서 확인했다.

서비스·DB 코드를 인수한 뒤에도 운영 DB002 `NOT_RUN`과 `production_ready=false` 제약이 유지되도록 공통 검사 한 조건을 강화했다. 후보 여부만으로 운영 제약 검사를 해제하지 않는다. 기존 운영 DB 완료 위조 거부 테스트를 유지하며, 코드 인수 사실과 실제 운영 인수를 혼동하지 않게 하는 상태 정합성 보완이다.

병합 검사는 승인된 develop 인입 또는 등록 직계 부모를 Git 재구성 결과에 결속하고 기획 경로의 충돌 해결과 별도 수정 범위를 구분하도록 보완했다. 기존 삭제 차단·main 승격·팀 권한·등록 부모·fast-forward 검사와 과거 이력을 유지한다.

검증 범위의 한계: staged 검사는 확인한 `refs/remotes/origin/develop` tip을 기준으로 승인 인입을 검사한다. 고정 SHA만 fetch한 CI에서는 과거 second-parent가 실제 원격 develop 계보에 속했는지까지 인증하지 못한다. 이 경우 부모별 자동 병합 결과와 직접 수정·삭제·충돌 허용 범위를 검사한 증거이며, 완전한 원격 부모 인증으로 표시하지 않는다. CI에서 필요한 원격 ref 증거 확보는 후속 조건이다.

상태는 기획 계약 검증, 서비스·DB 코드 인수, 외부 프런트 수정/브라우저 인수, 실제 운영 연결을 각각 기록한다. 외부 프런트가 미완료여도 확인된 서비스·DB 검증 결과는 별도로 보고한다. 코드·계약 검사 통과를 전체 서비스나 예측 정확도 완료로 확대하지 않는다.

| 범위 | 이 인계 시점의 상태 |
|---|---|
| v1.7.1 공통 계약·서비스·DB 코드 | 확정 커밋 코드 인수 완료 |
| 확정 Git 스냅샷 검사 / 정확한 HEAD의 원격 검사 | 493건 PASS / project-consistency 두 건 success |
| develop 통합 | PR #13 open / draft, 통합 예정 |
| 외부 전담 프런트 구현·브라우저 인수 | 이 서비스·DB 작업 범위에서 NOT_RUN |
| 실제 API·Supabase·DB·Drive 연결과 운영 readiness | NOT_RUN |
| 운영 DB002 적용 | NOT_APPLIED |
| 실제 입결·학생 사례에 대한 예측 정확도 검증 | NOT_RUN |

## ⑥ session.read 제안 PR #5

[PR #5](https://github.com/natural0448/Jungsi_touch/pull/5)의 session.read 제안은 확정 구현의 새 공통 계약에 채택됐다. 이 인계 시점의 상태는 open이며 이 문서 작성 과정에서는 종료하지 않았다. ①의 확정 백엔드 계약과 SHA를 공유한 이후 중복 제안 PR의 종료를 검토한다.

## ⑦ 초안·기존 프런트 후보 보존

초안 또는 이전 후보를 삭제해도 된다는 직접 사용자 허용 증거를 확인하지 않았다. 프런트 파일의 처리는 외부 전담자의 담당 범위이며 현재 서비스·DB 작업에서 수정·삭제하지 않는다. 원본·이전 후보·생성 캐시·검토 산출물을 보존한다. 이 문서는 원격 PR 종료나 로컬 파일 삭제를 실행한 증거가 아니다.
