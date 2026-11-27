import "server-only";
import type { Caller, JungsiSource } from "@/lib/api";
import type { ReportDto } from "@/lib/dto";
import { EXAM } from "@/lib/exam";
import { isInaccurate, reportUnattainable } from "@/lib/score-validity";

/*
  어느 리포트를 열지는 계정 기준으로 정한다(2026-11-04 사용자 결정). 브라우저·기기에 리포트 번호를 기억하지 않는다.
  - 현재 리포트: 서버 입력 상태(score-input.status.read)의 current_report_id. 다른 기기에서 저장해도 같다.
  - 예전 리포트를 골라 여는 길은 두지 않는다(2026-11-04 사용자 결정). 정정 뒤에는 정정한 리포트가 현재 리포트다.
  - 부정확 입력(2026-11-22 대표님 결정): 이 단계의 마지막 저장이 받을 수 없는 점수로 정상 거절됐으면(서버 상태) 현재 리포트를
    열지 않는다(null). 3·4페이지와 분석 버튼은 리포트가 없으니 분석을 부르지 않고, 화면은 inaccurateSeen 으로 안내를 고른다.
  소유권은 서버가 report.read 로 다시 확인한다(라우팅 명세 '권한과 응답 경계').
*/

const seen = new WeakMap<Caller, boolean>();

/** 이 요청(호출자)에서 읽은 입력 상태·리포트가 부정확 입력이었는가. 아직 읽지 않았으면 false */
export const inaccurateSeen = (caller: Caller): boolean => seen.get(caller) === true;

/** 받은 리포트가 받을 수 없는 원점수를 담고 있으면(서버 변경 전 저장분) 부정확 입력으로 적고 null */
export function screenReport(caller: Caller, report: ReportDto | null): ReportDto | null {
  if (report && reportUnattainable(report).length > 0) {
    seen.set(caller, true);
    return null;
  }
  return report;
}

/** 계정의 현재 리포트 번호. 아직 성적을 넣지 않았거나 부정확 입력 상태이면 null */
export async function currentReportId(src: JungsiSource, caller: Caller): Promise<string | null> {
  const st = await src.readScoreInputStatus(caller, EXAM.exam_id);
  const bad = isInaccurate(st);
  seen.set(caller, bad);
  return bad ? null : (st.current_report_id ?? null);
}
