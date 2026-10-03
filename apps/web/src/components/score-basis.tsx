import Link from "next/link";
import type { ScoreBasis as Basis } from "@/lib/contract";
import { page } from "@/lib/routes";

/** 내 성적 기준 줄. 성적이 없으면 입력 안내 */
export function ScoreBasis({ basis, emptyText }: { basis: Basis | null; emptyText: string }) {
  const p2 = page("PAGE-02").path;
  if (!basis) {
    return (
      <section className="basis none" aria-label="내 성적 기준">
        <p>
          <b>아직 확인된 성적이 없습니다.</b> {emptyText}
        </p>
        <Link className="btn p go" href={p2}>성적 입력하기</Link>
      </section>
    );
  }
  return (
    <section className="basis" aria-label="내 성적 기준">
      <span className="lab">내 성적 기준</span>
      <span className="it">{basis.exam_label}</span>
      <span className="it">
        국·수·탐2 표준점수 합 <b className="num">{basis.total_standard_score}</b>
      </span>
      <span className="it">
        전체 상위 <b className="num">{basis.overall_top_percent ? `${basis.overall_top_percent}%` : "산출 대기"}</b>
        {basis.estimated && <span className="est">추정</span>}
      </span>
      <Link className="btn go" href={p2}>성적 바꾸기</Link>
    </section>
  );
}
