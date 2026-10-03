# 화면 개발 협업 자료 v0.3

이 폴더는 공동 제작자가 화면 개발을 준비하는 데 쓸 수 있는 계약과 합성 예시다. 모든 공동 제작자의 전체 코드·데이터 접근 방침을 유지한다.

## 포함 자료

- [presentation-contract.json](presentation-contract.json): API 경로·허용 필드·응답 상태·보안 경계의 기계 판독용 초안. OpenAPI 표준 스키마나 실행 서버는 아니다.
- [admissions.mock.json](admissions.mock.json): 성적 없이 보는 대학 자료 목록.
- [comparison.request.mock.json](comparison.request.mock.json): 가상 성적 한 사례와 선택 후보 요청.
- [comparison.response.mock.json](comparison.response.mock.json): 계산 결과와 누적 미검증 상태를 함께 보여 주는 응답.
- [rate-limit.error.mock.json](rate-limit.error.mock.json): 과도한 요청을 제한했을 때의 표시 예시.
- [.env.frontend.example](.env.frontend.example): 공개 화면 설정만 포함.
- [.env.api.example](.env.api.example): 서버 설정 이름과 빈 비밀값 자리만 포함.
- [.gitignore.example](.gitignore.example): 향후 검토할 환경변수 제외 패턴. 현재 프로젝트에 적용하지 않은 예시.

## 사용 원칙

모든 대학명·학부명·과목 코드·점수·누적비율은 합성 예시다. 2026이라는 값은 출시 학년도 결정이 아니다. 입력 성적의 표준점수·백분위·등급 간 실제 대응 관계를 검증한 값도 아니다. 요청의 demo-* 코드는 화면 어댑터에서만 쓰며 운영 API에는 실제 학년도별 검증된 코드만 허용한다.

응답 점수는 화면 상태를 보여 주기 위한 고정값이며 입력 예시를 실제 대학 공식으로 계산한 결과가 아니다. 누적 0.024~0.026은 화면에서 2.4~2.6%로 표시하고, unavailable은 0%로 바꾸지 않는다.

에러의 60초는 재시도 UI 예시이며 운영 제한 정책이 아니다. 서버는 실제 정책에 맞는 Retry-After와 응답을 일치시켜야 한다.

성적·비밀값을 URL, 분석 이벤트 또는 오류 메시지에 넣지 않는다. mock/API 선택은 연결 대상을 바꾸는 화면 설정이며 서버의 권한 검사나 배포 검증을 끄는 옵션이 아니다.

기술 스택과 실행 앱이 아직 없으므로 이 파일들을 내려받는 것만으로 화면이나 API가 실행되지는 않는다. 프레젠테이션 어댑터를 구현한 뒤 연결한다. 실제 .env 값은 안전한 팀 공유 경로에서 별도로 공급한다.

[상위 기획](../00_3티어_보안_설계.md) · [프레젠테이션 계약](../01_프레젠테이션_API_계약.md) · [환경변수 운영](../02_환경변수_공동제작_운영.md)
