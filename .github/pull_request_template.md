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
