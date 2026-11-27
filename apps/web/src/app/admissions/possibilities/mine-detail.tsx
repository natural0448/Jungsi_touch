import { csatC1Score, csatNoJudgmentView } from "@/lib/csat-conditions";
import { holdIneligibleBand, INELIGIBLE_CANDIDATE_NOTICE, isConfirmedIneligible } from "@/lib/candidate-eligibility";
import { heldBand } from "@/lib/csat-held";
import { personalCsatPoint, personalCsatScore } from "@/lib/personal-csat-point";
import type { Cell } from "@/components/offering-parts";
import type { OfferingDto, ReportDto } from "@/lib/dto";
import { csatFinalOnly, csatJudged, pickedIds } from "@/lib/report-pure";
import { ConditionsBlock, CsatDetail, Detail } from "./parts";
import { csatExceptionView } from "@/lib/csat-exceptions";

/*
  4페이지·2페이지 펼친 상세에서 '내 리포트'로 그리는 카드. 서버 화면과 브라우저 화면(전문가용 인쇄 print-sheet → report-view)이
  함께 쓴다. 그래서 여기와 여기서 import 하는 모듈에는 서버 전용 모듈(report-ops·@/lib/api·shortlist-tray-stream 등)을 두지 않는다.
  2026-11-22 ship54: report-view 가 mine-parts(→ report-ops → @/lib/api → next/headers)를 import 해 운영 빌드가 실패했다.
  tests/client-boundary.test.mjs 가 지킨다.
*/

/** 이 모집단위의 칸 값. 리포트가 없으면(성적 전) 'need', 분석이 없으면 null */
export function cellOf(report: ReportDto | null, id: string): Cell {
  return report ? report.analyses?.[id] ?? null : "need";
}

/** 펼친 카드의 환산·누백·판단 카드 */
/** acts=false: 2페이지 핵심 지원 학교 표에서 펼칠 때(담기·'내 성적 리포트에서 보기' 줄 없음) */
export function MineDetail({ report, o, acts = true, single = false }: { report: ReportDto | null; o: OfferingDto; acts?: boolean; single?: boolean }) {
  if (report && csatJudged(report)) {
    // 2026-11-23 대표님 요청: 9월 모의평가 때와 같은 상세 카드(가채점 값으로)
    const ineligible = isConfirmedIneligible(report, o.offering_id);
    const raw = holdIneligibleBand(heldBand(o.offering_id, report.provisional_bands?.[o.offering_id]), ineligible);
    const c1 = csatC1Score(o.offering_id, report.overall);
    return <CsatDetail o={o} band={(single ? personalCsatPoint(raw) : raw) ?? null} exception={ineligible ? null : csatExceptionView(o.offering_id, report.overall)} noJudgment={ineligible ? INELIGIBLE_CANDIDATE_NOTICE : csatNoJudgmentView(o.offering_id, report.overall, report.provisional_min?.[o.offering_id])} c1={single ? personalCsatScore(c1) : c1} extras={null} picked={pickedIds(report).has(o.offering_id)} acts={acts} final={csatFinalOnly(report)} />;
  }
  return <Detail o={o} a={cellOf(report, o.offering_id)} extras={null} picked={pickedIds(report).has(o.offering_id)} subjects={report?.overall?.subjects} overall={report?.overall?.overall} examType={report?.overall?.exam?.exam_type ?? null} acts={acts} />;
}

/** 펼친 상세 맨 위 줄 안의 지원 조건 묶음(2026-11-22) */
export function MineConds({ report, o }: { report: ReportDto | null; o: OfferingDto }) {
  return <ConditionsBlock a={cellOf(report, o.offering_id)} subjects={report?.overall?.subjects} />;
}
