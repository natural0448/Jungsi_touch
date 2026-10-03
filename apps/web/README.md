# 정시터치 프레젠테이션 개발 기준

이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 1.2.3이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.

현재 경로와 회원별 화면 접근 범위는 route_catalog.json을 따른다. [현재 기획](../../docs/current/서비스_기획.md)과 [라우팅 명세](../../docs/current/라우팅_명세.md)를 함께 갱신한다. 기존 가상 화면은 기획 이력이며 이 폴더의 실행 앱이 아니다. 실제 화면 앱·인증·API 연결은 후속 작업이다.

화면은 서버가 허용한 결과만 표시하고 자체 대학 계산이나 DB 직접 조회를 구현하지 않는다. 브라우저의 회원등급 선택값을 운영 권한으로 사용하지 않는다.

프레젠테이션은 별도 작업자가 담당한다. 최신 origin/develop의 기획 기준을 확인하고 담당 feature/presentation-*를 재사용한다. 서버 개발팀의 feature/application-pre-data-platform와 브랜치를 공유하지 않는다. route_catalog.json과 생성 README/현재 문서는 직접 편집하지 않는다. 계약 변경은 service_spec.json과 생성 도구에서 수정하고 생성 결과를 같은 커밋에 포함한다. [프레젠테이션 작업 인계](../../docs/current/프레젠테이션_작업인계.md)를 읽고 출발 커밋과 API 계약을 맞춘다.

<!-- jungsi:generated spec_sha256=f6c6557b1843eeab5b2602b30a1c57f3c77cecf81e140e40b7c0815449e4ca60 -->
