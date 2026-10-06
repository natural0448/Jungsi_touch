구체적인 문제와 변경 후 동작을 적습니다.

- 작업 브랜치 / 등록 부모 / PR base (하위 → 상시 → develop → main):
- 담당자와 출발 develop/부모 SHA, 관련 상시 또는 임시 작업:
- 적용 요구사항과 변경한 화면/API 경로:
- 공통 명세와 함께 변경한 기획·라우팅 문서:
- 변경한 3티어 계층과 검증 결과:
- 아직 연결하지 않은 데이터·운영 기능:

main 반영은 현재 코드와 문서의 일치 검사 및 해당 커밋 검산 결과를 확인한 뒤 진행합니다. 과거 기획이나 합성 예시를 운영 완료 근거로 사용하지 않습니다.

브랜치 정본은 develop의 docs/current/개발_브랜치_운영.md와 service_spec.json.workflow.branch_governance입니다. 시스템·콘텐츠는 feature/application-pre-data-platform, 화면은 feature/presentation-foundation을 재사용합니다. 임시 개발 작업은 등록된 직계 부모로, 상시 작업은 develop으로 PR합니다. merge commit으로 통합하고 종료 브랜치 ref와 모든 로컬 파일은 자동 삭제하지 않습니다.

main PR은 develop에서만 열고 전체 완료·실제 연결/자료 인수·최종 SHA 검사 및 운영/복구 인계 증거와 release_gate=ready를 확인합니다. main 병합은 라이브 배포 승인이 아닙니다.


외부접근 보안 필수 확인: [개발기준](https://github.com/natural0448/Jungsi_touch/blob/develop/docs/current/외부접근_데이터보호_개발기준.md) / `security_contract` / REQ-24~26.

- 반드시 읽은 보안 기준 revision 및 출발 develop SHA:
- 영향 API/화면·SEC ID(영향 없음도 근거):
- 재귀 응답/브라우저 전달물 노출 검증:
- 중계·사용자 권한/소유권·관리 범위 검증:
- 무료 누백/유료 환산·후보 예산·동시성·재시작 검증:
- 같은 구현 commit의 합성 HTTP / 외부 화면 / 운영 증거와 각각의 NOT_RUN:

계약/하네스 PASS와 실제 보안 운영 인수를 구분한다. 필수 gate를 제거하거나 증거 없이 passed/ready로 바꾸지 않는다.
