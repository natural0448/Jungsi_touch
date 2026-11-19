import { StarButton } from "@/components/star-button";
import { FieldTag } from "@/components/field-tag";
import { CategoryBadge, enrichedReasonTexts, isReferenceScore, PickButton, scoreOf } from "@/components/offering-parts";
import { StatsSlot, type StatsPromise } from "@/components/stats-slot";
import { pctText } from "@/lib/format";
import { referencePercentText } from "@/lib/reference-percentile";
import { REFERENCE_WILDCARD_GROUPS, type ReferenceItem } from "@/lib/reference-view";
import type { CandidateItemDto, WildcardGroup, WildcardSelectionDto } from "@/lib/dto";
import { FEATURED, MAX_SELECTED, nonCsatConditionTexts, wildcardLayout, wildcardReasonText } from "@/lib/wildcard-layout";

/*
  와일드카드 — '비장의 한 수' (에듀터치 정시터치 시안에서 사용자가 승인한 모양).
  기본 목록의 흰 카드와 일부러 다른 결로 만든다: 짙은 남색 판 위의 상아색 카드 패.
  카드 모서리에 계열(offering.wildcard_group)을 카드 숫자처럼 새긴다.
  숫자·판단은 기본 목록과 같은 assessment 다. 모양만 특별하다.
  몇 장·어떤 순서로 보일지는 lib/wildcard-layout.ts(서버 선택이 있으면 서버 순서, 최대 4장).
*/

const SUIT: Record<WildcardGroup, { label: string; mark: string }> = {
  nursing: { label: "간호", mark: "N" },
  health: { label: "보건", mark: "H" },
  education: { label: "교육", mark: "E" },
  contract: { label: "계약", mark: "C" },
  maritime: { label: "해양", mark: "M" },
  railway: { label: "철도", mark: "R" },
};

export function WildcardDeck({ picks, selection, picked, favs, stats, statsKey, canPick, analysisPending }: { picks: CandidateItemDto[]; selection?: WildcardSelectionDto | null; picked: Set<string>; favs: Set<string> | null; stats: StatsPromise; statsKey: string; canPick: boolean; analysisPending?: boolean }) {
  const lay = wildcardLayout(picks, selection);
  const shown = lay.featured.length + lay.rest.length;
  const groups = lay.groupLabels.join("·");
  const card = (w: CandidateItemDto, i: number) => (
    <li key={w.offering.offering_id} style={{ "--i": i } as React.CSSProperties}>
      <WildCard w={w} on={picked.has(w.offering.offering_id)} fav={favs ? favs.has(w.offering.offering_id) : null} stats={stats} statsKey={statsKey} canPick={canPick} orderPending={lay.pendingIds.has(w.offering.offering_id)} />
    </li>
  );
  const empty = lay.status === "pending"
    ? `${wildcardReasonText(lay.reasonCode)} 후보가 없다는 뜻이 아닙니다.`
    : analysisPending
      ? "대학별 분석 자료를 준비하고 있어 와일드카드를 아직 보여 드리지 못합니다. 후보가 없다는 뜻은 아닙니다."
      : `이번 성적으로 찾은 ${groups} 계열 후보가 없습니다.`;
  return (
    <section className="wd" id="wildcard" aria-labelledby="wd-t">
      <div className="wd-hd">
        <span className="wd-kicker">WILD CARD</span>
        <h2 id="wd-t">
          비장의 한 수 <span className="num">{shown}</span>
          <small>장</small>
        </h2>
        <p>
          {lay.mode === "selected"
            ? `${groups} 계열 중 내 성적으로 지원 검토 범위에 드는 곳을 최대 ${MAX_SELECTED}장 골랐습니다. 여유 → 핵심 → 도전 순서이고, 앞 3장은 되도록 서로 다른 계열입니다.`
            : `${groups} 계열 중 내 성적으로 지원 검토 범위에 드는 곳을 따로 모았습니다.`}
        </p>
        {lay.status === "partial" && <p className="wd-note">{wildcardReasonText(lay.reasonCode)} &lsquo;순서 확인 중&rsquo; 표시가 있는 카드는 순서가 바뀔 수 있습니다.</p>}
      </div>

      {shown === 0 ? (
        <p className="wd-empty">{empty}</p>
      ) : (
        <>
          <ol className="wd-deck">{lay.featured.map(card)}</ol>
          {lay.rest.length > 0 && (
            <details className="wd-rest">
              <summary>
                {lay.mode === "selected" ? "한 장 더 보기" : <>나머지 <b className="num">{lay.rest.length}장</b> 더 펼치기</>}
              </summary>
              <ol className="wd-deck">{lay.rest.map((w, i) => card(w, i + FEATURED))}</ol>
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

function WildCard({ w, on, fav, stats, statsKey, canPick, orderPending }: { w: CandidateItemDto; on: boolean; fav: boolean | null; stats: StatsPromise; statsKey: string; canPick: boolean; orderPending?: boolean }) {
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
        {orderPending && <span className="wc-order">순서 확인 중</span>}
      </div>

      <p className="wc-univ">{o.university_name}</p>
      <h3 className="wc-unit">{o.department}</h3>
      <p className="wc-field">
        <FieldTag id={o.offering_id} />
        {fav !== null && <StarButton id={o.offering_id} on={fav} name={`${o.university_name} ${o.department}`} />}
      </p>

      <p className="wc-why">
        <span>한 수인 이유</span>
        {a.recommendation_reasons?.length
          ? enrichedReasonTexts(a, 1)[0]
          : n !== null && n > 0
            ? `이 학과 환산에서 총점보다 위치가 ${a.advantage!.delta_pp}%p 올라갑니다.`
            : "내 성적으로 지원 검토 범위에 드는 계열 후보입니다."}
      </p>

      <div className="wc-score">
        {scoreOf(a) ? <b className="num">{scoreOf(a)}{isReferenceScore(a) && <small> 참고</small>}</b> : <b>계산 보류</b>}
        {a.converted_percentile && <i className="num">이 대학 환산 상위 {pctText(a.converted_percentile)}%</i>}
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
      {nonCsatConditionTexts(o.non_csat_conditions).map((t) => (
        <p key={t} className="wc-warn">{t}. 모집요강에서 함께 확인하세요.</p>
      ))}

      <div className="wc-stats">
        <StatsSlot p={stats} id={o.offering_id} k={statsKey} />
      </div>

      {canPick && <PickButton id={o.offering_id} on={on} variant="wild" />}
    </article>
  );
}

/**
 * 서버 판정이 없는 동안의 와일드카드(대표님 결정 2026-11-19): 참고 누백이 나온 간호·보건·교육 계열 학과를
 * 참고 유불리 큰 순서로, 기존 카드 모양 그대로 보인다. 즐겨찾기만 할 수 있고 담기·판정은 없다.
 */
export function ReferenceWildcardDeck({ featured, rest, favs }: { featured: ReferenceItem[]; rest: ReferenceItem[]; favs: Set<string> | null }) {
  const shown = featured.length + rest.length;
  const groups = REFERENCE_WILDCARD_GROUPS.map((g) => SUIT[g].label).join("·");
  const card = (w: ReferenceItem, i: number) => (
    <li key={w.offering.offering_id} style={{ "--i": i } as React.CSSProperties}>
      <ReferenceWildCard w={w} fav={favs ? favs.has(w.offering.offering_id) : null} />
    </li>
  );
  return (
    <section className="wd" id="wildcard" aria-labelledby="wd-t">
      <div className="wd-hd">
        <span className="wd-kicker">WILD CARD</span>
        <h2 id="wd-t">
          비장의 한 수 <span className="num">{shown}</span>
          <small>장</small>
        </h2>
        <p>{groups} 계열 중 이 대학 계산 방식이 내 성적에 유리한 곳을 참고 유불리 큰 순서로 모았습니다.</p>
      </div>
      {shown === 0 ? (
        <p className="wd-empty">참고 누백이 나온 {groups} 계열 학과가 아직 없습니다. 후보가 없다는 뜻이 아닙니다.</p>
      ) : (
        <>
          <ol className="wd-deck">{featured.map(card)}</ol>
          {rest.length > 0 && (
            <details className="wd-rest">
              <summary>나머지 <b className="num">{rest.length}장</b> 더 펼치기</summary>
              <ol className="wd-deck">{rest.map((w, i) => card(w, i + featured.length))}</ol>
            </details>
          )}
        </>
      )}
      <p className="wd-foot">참고 누백 기준으로 고른 곳이며 합격 가능성 판정이 아닙니다. 별표를 누르면 즐겨찾기에 들어가 전체 대학·학과 가능성 보기에서도 보입니다.</p>
    </section>
  );
}

function ReferenceWildCard({ w, fav }: { w: ReferenceItem; fav: boolean | null }) {
  const o = w.offering;
  const a = w.advantage;
  const suit = SUIT[o.wildcard_group ?? "health"];
  const pct = referencePercentText(w.reference_percentile);
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
      <p className="wc-field">
        <FieldTag id={o.offering_id} />
        {fav !== null && <StarButton id={o.offering_id} on={fav} name={`${o.university_name} ${o.department}`} />}
      </p>
      <p className="wc-why">
        <span>한 수인 이유</span>
        {a && a.tone === "up"
          ? `이 학과 계산 방식에서 전체 성적 기준보다 내 위치가 ${a.text}%p 올라갑니다(참고).`
          : "참고 누백이 나온 계열 후보입니다."}
      </p>
      <div className="wc-score">
        {pct ? <b className="num">상위 {pct}%<small> 참고</small></b> : <b>계산 보류</b>}
        <i>이 대학 방식 누적 백분위(추정)</i>
      </div>
      <div className="wc-bench">
        <span>
          <small>지원가능성</small>
          <b>판정 준비 중</b>
        </span>
        <span>
          <small>환산 유불리</small>
          <b className="num">{a ? `${a.text}%p` : "확인 중"}</b>
        </span>
      </div>
      {nonCsatConditionTexts(o.non_csat_conditions).map((t) => (
        <p key={t} className="wc-warn">{t}. 모집요강에서 함께 확인하세요.</p>
      ))}
    </article>
  );
}
