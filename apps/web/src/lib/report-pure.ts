import type { ReportDto } from "./dto";

/*
  리포트를 읽기만 하는 작은 판단들. 서버 전용 report-ops 와 브라우저 화면(전문가용 인쇄 print-sheet 등)이 함께 쓴다.
  여기에는 서버 전용 모듈(@/lib/api·server-only·next/headers)을 import 하지 않는다 — 브라우저 묶음에 끌려 들어가면
  운영 빌드(next build)가 실패한다(2026-11-22 ship54). tests/client-boundary.test.mjs 가 지킨다.
*/

/** 담은 모집단위 번호(report.shortlist 의 selected). 이름(offering.read)이 없어도 담기 표시는 이것으로 그린다 */
export function pickedIds(report: ReportDto | null): Set<string> {
  return new Set(Object.entries(report?.shortlist ?? {}).filter(([, e]) => e.selected).map(([id]) => id));
}

/**
 * 수능 가채점 원점수 리포트(2026-11-23 전환, 서버 provisional_estimate)인가. 가채점은 university.analyze(4페이지 상세)를
 * 아직 계산하지 않는다(provisional_stage_unavailable) — 화면은 이 요청을 보내지 않는다.
 * candidates.build 는 보낸다(dep_r22): 판정 Secret 이 있으면 응답에만 학교별 가채점 7단계(source g 참고 묶음)가 실린다.
 * (lib/provisional-report 의 isProvisionalReport 와 같은 판단)
 */
export function provisionalOnly(r: ReportDto | null | undefined): boolean {
  return !!r?.overall && (r.overall.score_basis === "provisional_estimate" || r.overall.input_kind === "provisional_raw");
}
