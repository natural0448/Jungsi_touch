import "server-only";
import type { Caller, JungsiSource } from "@/lib/api";
import type { OfferingDto, ReportDto } from "@/lib/dto";
import { pickedItems, togglePickOn, type PickedItem, type ReportState } from "@/lib/report-ops";

/*
  핵심 지원 학교(담은 학교) 읽기·쓰기의 한 곳. 2·3·4페이지·인쇄·담기 버튼은 모두 여기만 부른다.
  지금은 리포트 안의 report.shortlist(shortlist.update)에 저장한다.
  2026-10-25 사용자 결정으로 담은 학교는 회원·학년도별 별도 저장(회원 JSON)으로 옮겨 간다. 서버 계약이 생기면
  이 파일의 세 함수만 새 API 로 바꾸고 화면은 그대로 둔다(화면팀 제안: 정시터치-화면팀요청-관심대학_API제안-20261025.md).
*/
export type { PickedItem };

/** 담은 모집행 번호(선택된 것만) */
export function selectedIds(report: ReportDto): string[] {
  return Object.entries(report.shortlist ?? {}).filter(([, e]) => e.selected).map(([id]) => id);
}

/** 담은 학교 목록(이름·분석 결과 포함). known 에 있는 모집행은 이름을 다시 묻지 않는다 */
export function readPicks(src: JungsiSource, caller: Caller, report: ReportDto, known: OfferingDto[] = []): Promise<PickedItem[]> {
  return pickedItems(src, caller, report, known);
}

/** 담기·빼기. 서버가 거절하면 ReportState.failed(사유 코드) */
export function setPick(src: JungsiSource, caller: Caller, report: ReportDto, offeringId: string, selected: boolean): Promise<ReportState> {
  return togglePickOn(src, caller, report, offeringId, selected);
}
