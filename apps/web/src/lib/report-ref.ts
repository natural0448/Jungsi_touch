import "server-only";
import type { Caller, JungsiSource } from "@/lib/api";
import { EXAM } from "@/lib/exam";

/*
  어느 리포트를 열지는 계정 기준으로 정한다(2026-11-04 사용자 결정). 브라우저·기기에 리포트 번호를 기억하지 않는다.
  - 현재 리포트: 서버 입력 상태(score-input.status.read)의 current_report_id. 다른 기기에서 저장해도 같다.
  - 예전 리포트를 골라 여는 길은 두지 않는다(2026-11-04 사용자 결정). 정정 뒤에는 정정한 리포트가 현재 리포트다.
  소유권은 서버가 report.read 로 다시 확인한다(라우팅 명세 '권한과 응답 경계').
*/

/** 계정의 현재 리포트 번호. 아직 성적을 넣지 않았으면 null */
export async function currentReportId(src: JungsiSource, caller: Caller): Promise<string | null> {
  return (await src.readScoreInputStatus(caller, EXAM.exam_id)).current_report_id ?? null;
}
