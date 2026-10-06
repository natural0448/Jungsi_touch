import { CategoryBadge, PickButton, StatsLine } from "@/components/offering-parts";
import type { CandidateItemDto, OfferingDto, StatisticsDto } from "@/lib/dto";

/*
  와일드카드 — '비장의 한 수' (에듀터치 정시터치 시안에서 사용자가 승인한 모양).
  기본 목록의 흰 카드와 일부러 다른 결로 만든다: 짙은 남색 판 위의 상아색 카드 패.
  카드 모서리에 계열(offering.wildcard_group)을 카드 숫자처럼 새긴다.
  숫자·판단은 기본 목록과 같은 assessment 다. 모양만 특별하다.
*/

const SUIT: Record<NonNullable<OfferingDto["wildcard_group"]>, { label: string; mark: string }> = {
  nursing: { label: "간호", mark: "N" },
  health: { label: "보건", mark: "H" },
  education: { label: "교육", mark: "E" },
};
/** 크게 펼쳐 보이는 장 수. 환산 유불리가 큰 순서의 앞에서부터 */
const FEATURED = 3;

const delta = (w: CandidateItemDto) => (w.assessment.advantage ? Number(w.assessment.advantage.delta_pp) : -Infinity);

export function WildcardDeck({ picks, picked, stats, canPick }: { picks: CandidateItemDto[]; picked: Set<string>; stats: Map<string, StatisticsDto | null>; canPick: boolean }) {
  const sorted = [...picks].sort((a, b) => delta(b) - delta(a));
  const card = (w: CandidateItemDto, i: number) => (
    <li key={w.offering.offering_id} style={{ "--i": i } as React.CSSProperties}>
      <WildCard w={w} on={picked.has(w.offering.offering_id)} stat={stats.get(w.offering.offering_id)} canPick={canPick} />
    </li>
  );
  return (
    <section className="wd" id="wildcard" aria-labelledby="wd-t">
      <div className="wd-hd">
        <span className="wd-kicker">WILD CARD</span>
        <h2 id="wd-t">
          비장의 한 수 <span className="num">{picks.length}</span>
          <small>장</small>
        </h2>
        <p>간호·보건·교육 계열 중 내 성적으로 지원 검토 범위에 드는 곳을 따로 모았습니다.</p>
      </div>

      {picks.length === 0 ? (
        <p className="wd-empty">이번 성적으로 찾은 간호·보건·교육 계열 후보가 없습니다.</p>
      ) : (
        <>
          <ol className="wd-deck">{sorted.slice(0, FEATURED).map(card)}</ol>
          {sorted.length > FEATURED && (
            <details className="wd-rest">
              <summary>
                나머지 <b className="num">{sorted.length - FEATURED}장</b> 더 펼치기
              </summary>
              <ol className="wd-deck">{sorted.slice(FEATURED).map(card)}</ol>
            </details>
          )}
        </>
      )}

      <p className="wd-foot">
        기본 목록과 같은 환산·자격·판단 기준으로 고른 곳입니다. 기본 목록에 있는 학과를 여기서 담아도 핵심 지원 학교에는 한 번만 담깁니다.
      </p>
    </section>
  );
}

function WildCard({ w, on, stat, canPick }: { w: CandidateItemDto; on: boolean; stat: StatisticsDto | null | undefined; canPick: boolean }) {
  const o = w.offering;
  const a = w.assessment;
  const suit = SUIT[o.wildcard_group ?? "health"];
  const n = a.advantage ? Number(a.advantage.delta_pp) : null;

  return (
    <article className={`wc cat-${suit.mark}`} aria-label={`${suit.label} 와일드카드: ${o.university_name} ${o.department}`}>
      <span className="wc-corner tl" aria-hidden="true">
        <b>{suit.label}</b>
        <i>{suit.mark}</i>
      </span>
      <span className="wc-corner br" aria-hidden="true">
        <b>{suit.label}</b>
        <i>{suit.mark}</i>
      </span>

      <div className="wc-top">
        <span className="wc-grp">{o.group}군 · {o.track ?? "일반전형"}</span>
      </div>

      <p className="wc-univ">{o.university_name}</p>
      <h3 className="wc-unit">{o.department}</h3>

      <p className="wc-why">
        <span>한 수인 이유</span>
        {a.recommendation_reasons?.[0]?.text ??
          (n !== null && n > 0 ? `이 학과 환산에서 총점보다 위치가 ${a.advantage!.delta_pp}%p 올라갑니다.` : "내 성적으로 지원 검토 범위에 드는 계열 후보입니다.")}
      </p>

      <div className="wc-score">
        {a.converted_score ? <b className="num">{a.converted_score}</b> : <b>계산 보류</b>}
        {a.converted_percentile && <i className="num">이 대학 환산 상위 {a.converted_percentile}%</i>}
      </div>

      <div className="wc-bench">
        <span>
          <small>지원가능성</small>
          <CategoryBadge a={a} />
        </span>
        <span>
          <small>환산 유불리</small>
          <b className="num">{n === null ? "판단 보류" : `${n > 0 ? "+" : ""}${a.advantage!.delta_pp}%p`}</b>
        </span>
      </div>

      {a.eligibility_status === "needs_confirmation" && <p className="wc-warn">지원 자격을 확인해야 합니다. 모집요강에서 함께 확인하세요.</p>}

      <div className="wc-stats">
        <StatsLine s={stat} />
      </div>

      {canPick && <PickButton id={o.offering_id} on={on} variant="wild" />}
    </article>
  );
}
