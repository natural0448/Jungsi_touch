import Link from "@/components/link";
import { pctText } from "@/lib/format";
import { overallWaitLabel } from "@/lib/analysis-labels";
import { examTypeLabel } from "@/lib/exam";
import { isProvisionalOverall, type OverallAnalysisDto } from "@/lib/dto";
import { provisionalTopText, tripleText } from "@/lib/provisional-report";
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
  // 수능 가채점 리포트(2026-11-23 전환): 예상 표준점수 합과 추정 상위누백을 범위로만 적는다
  if (isProvisionalOverall(overall)) {
    const total = tripleText(overall.total_standard_range ?? o.total_standard_score_range ?? null);
    const top = provisionalTopText(overall);
    return (
      <section className="basis" aria-label="내 성적 기준">
        <span className="lab">내 성적 기준</span>
        <span className="it">{overall.exam.academic_year}학년도 {examTypeLabel(overall.exam.exam_type)}</span>
        <span className="it">
          국·수·탐2 예상 표준점수 합 <b className="num">{total ?? "─"}</b>
        </span>
        <span className="it">
          상위누백 <b className="num">{top ? `${top}%` : "—"}</b>
        </span>
        <Link className="btn go" href={p2}>{page("PAGE-02").label}</Link>
      </section>
    );
  }
  return (
    <section className="basis" aria-label="내 성적 기준">
      <span className="lab">내 성적 기준</span>
      <span className="it">{overall.exam.academic_year}학년도 {examTypeLabel(overall.exam.exam_type)}</span>
      <span className="it">
        국·수·탐2 표준점수 합 <b className="num">{overall.total_standard_score}</b>
      </span>
      <span className="it">
        전체 상위 <b className="num">{o.status !== "pending" && o.inclusive_top_percent ? `${pctText(o.inclusive_top_percent)}%` : overallWaitLabel(o.reason_code)}</b>
        {o.status === "estimated" && <span className="est">추정</span>}
      </span>
      <Link className="btn go" href={p2}>성적 바꾸기</Link>
    </section>
  );
}
