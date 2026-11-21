import type { OwnReportListDto } from "./dto";

/*
  지난 기록 · 9월 모의평가 표시(2026-11-22 대표님 요청): 9월 리포트를 저장한 적이 있는 회원·학생에게만 보인다.
  판단은 내 리포트 목록(report.list-own, exam_id=9월)이 1개 이상인지다. 목록을 읽지 못하면 숨긴다(오류 화면 없음).
*/

/** 목록에 9월 모의평가 리포트가 하나라도 있는가 */
export function hasMockReports(list: Pick<OwnReportListDto, "items"> | null | undefined, mockExamId: string): boolean {
  return !!list && Array.isArray(list.items) && list.items.some((i) => !i.exam_id || i.exam_id === mockExamId);
}

/** 전문가용 학생 리포트 목록에서 9월 모의평가 리포트가 있는가(시험 ID 또는 단계로 본다) */
export function studentHasMockReports(rows: readonly { exam_id?: string | null; stage?: string | null }[] | null | undefined, mockExamId: string): boolean {
  return !!rows && rows.some((r) => r.exam_id === mockExamId || r.stage === "mock");
}
