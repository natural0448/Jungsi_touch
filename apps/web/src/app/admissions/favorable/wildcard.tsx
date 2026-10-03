import { ArrowRightIcon } from "@/components/icons";
import { PickButton, StatsLine } from "@/components/offering-parts";
import type { OfferingStatistics, WildcardCategory, WildcardPick } from "@/lib/contract";

/*
  와일드카드 — '비장의 한 수' (에듀터치 정시터치 시안에서 사용자가 승인한 모양).
  기본 목록의 흰 카드와 일부러 다른 결로 만든다: 짙은 남색 판 위의 상아색 카드 패.
  카드 모서리에 계열을 카드 숫자처럼 새기고, 한 수인 이유를 앞세운다.
  숫자·규칙은 기본 목록과 똑같이 검사한 것(자격·환산·과거 기준)이다. 모양만 특별하다.
*/

const SUIT: Record<WildcardCategory, string> = { 간호: "N", 보건: "H", 교육: "E" };
/** 크게 펼쳐 보이는 장 수. 받은 순서(유리한 순)의 앞에서부터 */
const FEATURED = 3;

export function WildcardDeck({ picks, picked, stats }: { picks: WildcardPick[]; picked: Set<string>; stats: Map<string, OfferingStatistics> }) {
  return (
    <section className="wd" id="wildcard" aria-labelledby="wd-t">
      <div className="wd-hd">
        <span className="wd-kicker">WILD CARD</span>
        <h2 id="wd-t">
          비장의 한 수 <span className="num">{picks.length}</span>
          <small>장</small>
        </h2>
        <p>간호·보건·교육 계열에서 내 과목 구성이 통하는 곳을 따로 찾았습니다.</p>
      </div>

      {picks.length === 0 ? (
        <p className="wd-empty">이번 성적으로 찾은 와일드카드가 없습니다. 내 기본 위치보다 나아지는 간호·보건·교육 계열이 없었습니다.</p>
      ) : (
        <>
          <ol className="wd-deck">
            {picks.slice(0, FEATURED).map((w, i) => (
              <li key={w.offering.offering_id} style={{ "--i": i } as React.CSSProperties}>
                <WildCard w={w} on={picked.has(w.offering.offering_id)} stat={stats.get(w.offering.offering_id)} />
              </li>
            ))}
          </ol>
          {picks.length > FEATURED && (
            <details className="wd-rest">
              <summary>
                나머지 <b className="num">{picks.length - FEATURED}장</b> 더 펼치기
              </summary>
              <ol className="wd-deck">
                {picks.slice(FEATURED).map((w, i) => (
                  <li key={w.offering.offering_id} style={{ "--i": i } as React.CSSProperties}>
                    <WildCard w={w} on={picked.has(w.offering.offering_id)} stat={stats.get(w.offering.offering_id)} />
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}

      <p className="wd-foot">
        내 기본 위치보다 환산 후 위치가 나아지는 곳만 골랐습니다. 기본 목록과 같은 산식·자격·과거 기준으로 검사했고, 지원 자격이 맞지 않는 곳은 넣지 않았습니다. 기본 목록에 있는 학과를 여기서 담아도 핵심 지원 학교에는 한 번만 담깁니다.
      </p>
    </section>
  );
}

function WildCard({ w, on, stat }: { w: WildcardPick; on: boolean; stat: OfferingStatistics | undefined }) {
  const o = w.offering;
  const a = w.analysis;
  const adv = a.advantage;
  const latest = a.support.history.find((h) => h.cut_top_percent !== null);
  const mine = a.converted.university_top_percent;

  return (
    <article className={`wc cat-${SUIT[w.category]}`} aria-label={`${w.category} 와일드카드: ${o.university.name} ${o.unit_name}`}>
      <span className="wc-corner tl" aria-hidden="true">
        <b>{w.category}</b>
        <i>{SUIT[w.category]}</i>
      </span>
      <span className="wc-corner br" aria-hidden="true">
        <b>{w.category}</b>
        <i>{SUIT[w.category]}</i>
      </span>

      <div className="wc-top">
        <span className="wc-grp">
          {o.group}군 · {w.note}
        </span>
      </div>

      <p className="wc-univ">{o.university.name}</p>
      <h3 className="wc-unit">{o.unit_name}</h3>

      <p className="wc-why">
        <span>한 수인 이유</span>
        {w.why}
      </p>

      <div className="wc-score">
        {a.converted.score ? (
          <>
            <b className="num">{a.converted.score}</b>
            <i className="num">/ {a.converted.max_score}</i>
          </>
        ) : (
          <b>계산 보류</b>
        )}
      </div>

      {adv.status === "computed" && adv.total_top_percent && adv.university_top_percent ? (
        <div className="wc-move">
          <span className="from num">
            <small>내 기본 위치</small>상위 {adv.total_top_percent}%
          </span>
          <span className="arrow"><ArrowRightIcon /></span>
          <span className="to num">
            <small>이 학과 기준</small>상위 {adv.university_top_percent}%
          </span>
          {adv.pp && Number(adv.pp) > 0 && <span className="gain num">{adv.pp}%p</span>}
        </div>
      ) : (
        <p className="wc-hold">위치 비교는 준비 중입니다. 환산점수만 먼저 보여 드립니다.</p>
      )}

      {latest && mine && (
        <div className="wc-bench">
          <span>
            <small>{latest.result_year} {latest.metric_label}</small>
            <b className={Number(mine) <= Number(latest.cut_top_percent) ? "above" : "below"}>
              {Number(mine) <= Number(latest.cut_top_percent) ? "기준 이상" : "기준 미만"}
            </b>
          </span>
          <span>
            <small>그해 기준 위치</small>
            <b className="num">상위 {latest.cut_top_percent}%</b>
          </span>
        </div>
      )}

      {w.note === "조건 확인" && <p className="wc-warn">면접 등 수능 외 전형요소나 지원 자격이 있습니다. 모집요강에서 함께 확인하세요.</p>}

      <div className="wc-stats">
        <StatsLine s={stat} />
      </div>

      <PickButton id={o.offering_id} on={on} variant="wild" />
    </article>
  );
}
