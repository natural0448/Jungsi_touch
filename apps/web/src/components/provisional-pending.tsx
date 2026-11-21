import Link from "@/components/link";
import type { OverallAnalysisDto } from "@/lib/dto";
import { page } from "@/lib/routes";

/*
  수능 가채점 리포트일 때 3·4페이지(2026-11-23 전환). 학교별 가채점 판정 자료가 아직 없어 서버가 대학 환산·후보를
  계산하지 않는다(provisional_stage_unavailable). 고객에게는 '가채점 판정 준비 중' 한 가지로만 말한다.
  판정이 열리면 7단계는 안정 → 하향 → 적정 → 소신 → 상향 → 도전 → 불가 순서로 보인다.
*/
export const PROVISIONAL_PENDING_TITLE = "가채점 판정 준비 중";
export const PROVISIONAL_PENDING_TEXT =
  "가채점 성적은 표준점수가 확정되기 전이라 학교별 환산점수와 지원가능성 판정(안정·하향·적정·소신·상향·도전·불가)을 아직 하지 않습니다. 내 예상 위치는 내 성적 리포트에서 범위로 볼 수 있고, 대학·학과 검색과 모집 정보는 지금도 볼 수 있습니다.";

/** 4페이지(유리한 대학 찾기) 본문 자리 */
export function ProvisionalPendingGate({ catalogHref }: { overall?: OverallAnalysisDto | null; catalogHref: string }) {
  return (
    <section className="gate flat" aria-labelledby="prov-pend-h">
      <h2 id="prov-pend-h">{PROVISIONAL_PENDING_TITLE}</h2>
      <p>{PROVISIONAL_PENDING_TEXT}</p>
      <div className="acts">
        <Link className="btn p" href={page("PAGE-02").path}>내 성적 리포트</Link>
        <Link className="btn" href={catalogHref}>전국 대학·학과 보기</Link>
      </div>
    </section>
  );
}

/** 3페이지(가능성 보기) 목록 위 한 줄 */
export function ProvisionalPendingNote() {
  return (
    <p className="ps-prov" role="note">
      <b>{PROVISIONAL_PENDING_TITLE}</b> — {PROVISIONAL_PENDING_TEXT}
    </p>
  );
}
