# 정시터치 프레젠테이션 개발 기준

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.7.1이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

현재 경로와 회원별 화면 접근 범위는 route_catalog.json을 따른다. [현재 기획](../../docs/current/서비스_기획.md)과 [라우팅 명세](../../docs/current/라우팅_명세.md)를 함께 갱신한다. 기존 가상 화면은 기획 이력이며 이 폴더의 실행 앱이 아니다. 실제 화면 앱·인증·API 연결은 후속 작업이다.

화면은 서버가 허용한 결과만 표시하고 자체 대학 계산이나 DB 직접 조회를 구현하지 않는다. 브라우저의 회원등급 선택값을 운영 권한으로 사용하지 않는다.

프레젠테이션은 별도 작업자가 담당한다. 최신 origin/develop의 기획 기준을 확인하고 담당 상시 브랜치 feature/presentation-foundation를 재사용한다. 서버 개발팀의 feature/application-pre-data-platform와 브랜치를 공유하지 않는다. route_catalog.json과 생성 README/현재 문서는 직접 편집하지 않는다. 계약 변경은 service_spec.json과 생성 도구에서 수정하고 생성 결과를 같은 커밋에 포함한다. [프레젠테이션 작업 인계](../../docs/current/프레젠테이션_작업인계.md)를 읽고 출발 커밋과 API 계약을 맞춘다.

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

<!-- jungsi:generated spec_sha256=a5c7912519aff970f85141133e2afd69e96a162a9c603aa1304a8c05afc2cadb -->
