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
        <Link className="btn p" href={page("PAGE-02").path}>{page("PAGE-02").label}</Link>
        <Link className="btn" href={catalogHref}>전국 대학·학과 보기</Link>
      </div>
    </section>
  );
}

/** 4페이지에 학교별 가채점 판정이 붙었을 때(서버 dep_r29, 2026-11-23) 목록 위 한 줄 */
export const PROVISIONAL_JUDGED_TEXT =
  "가채점 원점수로 추정한 표준점수·백분위를 학교마다 그 대학 방식으로 계산해 예상 합격권과 견준 판정입니다. 추정이 한 값으로 모이지 않으면 범위(예: 적정~소신)로 보입니다. 내 환산점수는 그 대학 방식으로 계산한 추정값(가운데 값과 범위)이고, 환산 유불리는 이 대학 계산 방식이 내게 득인지 손해인지입니다. 판정하지 않은 학과는 그 사유(지원 조건 미충족·비교 자료 없음 등)가 보입니다.";

/** 4페이지(가능성 보기) 목록 위 한 줄. judged: 이 화면에 학교별 가채점 판정이 하나라도 붙었는지 */
export function ProvisionalPendingNote({ judged = false, scoped = false }: { judged?: boolean; scoped?: boolean }) {
  // 2026-11-25 담당자 R23 후속: 보이는 모집단위가 모두 판정 사유(지원 조건·비교 자료·환산 범위 등)일 때
  // '판정 준비 중'은 전국 판정이 멈춘 것처럼 읽힌다 → 현재 검색 범위만 말한다
  if (!judged && scoped) {
    return (
      <p className="ps-prov" role="note">
        <b>현재 검색 범위에서 판정 가능한 모집단위가 없습니다</b> — 이 범위의 모집단위는 학과마다 보이는 사유(지원 조건 미충족·비교 자료 없음·환산 범위 등)로 지원가능성을 판정하지 않았습니다. 다른 대학·학과는 판정이 나옵니다.
      </p>
    );
  }
  if (judged) {
    return (
      <p className="ps-prov" role="note">
        <b>수능 가채점 판정</b> — {PROVISIONAL_JUDGED_TEXT}
      </p>
    );
  }
  return (
    <p className="ps-prov" role="note">
      <b>{PROVISIONAL_PENDING_TITLE}</b> — {PROVISIONAL_PENDING_TEXT}
    </p>
  );
}
