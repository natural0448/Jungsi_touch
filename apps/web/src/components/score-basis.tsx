import Link from "next/link";
import { pctText } from "@/lib/format";
import { examTypeLabel } from "@/lib/exam";
import type { OverallAnalysisDto } from "@/lib/dto";
import { page } from "@/lib/routes";

/** 내 성적 기준 줄(report.overall). 리포트가 없으면 성적 입력 안내 */
export function ScoreBasis({ overall, emptyText }: { overall: OverallAnalysisDto | null; emptyText: string }) {
  const p2 = page("PAGE-02").path;
  if (!overall) {
    return (
      <section className="basis none" aria-label="내 성적 기준">
        <p>
          <b>아직 확인된 성적이 없습니다.</b> {emptyText}
        </p>
        <Link className="btn p go" href={p2}>성적 입력하기</Link>
      </section>
    );
  }
  const o = overall.overall;
  return (
    <section className="basis" aria-label="내 성적 기준">
      <span className="lab">내 성적 기준</span>
      <span className="it">{overall.exam.academic_year}학년도 {examTypeLabel(overall.exam.exam_type)}</span>
      <span className="it">
        국·수·탐2 표준점수 합 <b className="num">{overall.total_standard_score}</b>
      </span>
      <span className="it">
        전체 상위 <b className="num">{o.status !== "pending" && o.inclusive_top_percent ? `${pctText(o.inclusive_top_percent)}%` : "계산 대기"}</b>
        {o.status === "estimated" && <span className="est">추정</span>}
      </span>
      <Link className="btn go" href={p2}>성적 바꾸기</Link>
    </section>
  );
}
