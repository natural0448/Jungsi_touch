import { StarButton } from "@/components/star-button";
import { ADVANTAGE_WORD } from "@/components/offering-parts";
import type { ReferenceAdvantage } from "@/lib/reference-advantage";
import type { ReferenceUniversity } from "@/lib/reference-view";

/** 참고 유불리 한 줄: "유리 +1.2%p 참고". 계산하지 못하면 '확인 중' */
export function ReferenceAdvantageText({ a }: { a: ReferenceAdvantage | null }) {
  if (!a) return <span className="need">유불리 확인 중</span>;
  return (
    <span className={`v num ${a.tone}`}>
      <b className="advw">{ADVANTAGE_WORD[a.tone]}</b> {a.text}%p <small className="ref">참고</small>
    </span>
  );
}

/**
 * 참고 누백(추정)이 나온 대학을 대학 → 계열 → 학과로 묶어 보인다(대표님 결정 2026-11-19).
 * 계열 줄을 누르면 그 계열 학과와 참고 유불리 요약이 펼쳐지고, 학과마다 즐겨찾기만 할 수 있다. 판정·담기는 없다.
 */
export function ReferenceGroups({ universities, favs }: { universities: ReferenceUniversity[]; favs: Set<string> | null }) {
  if (universities.length === 0) return null;
  return (
    <section className="fv-ref" aria-labelledby="ref-t">
      <div className="fv-sec-hd">
        <h2 id="ref-t">
          내 성적에 유리한 대학 <span className="num">{universities.length}</span>
        </h2>
        <span>이 대학의 점수 계산 방식이 내 과목 구성에 유리한 학교부터 보여 줍니다(참고 유불리 큰 순). 계열을 누르면 학과가 펼쳐집니다.</span>
      </div>
      <div className="fv-ref-list">
        {universities.map((u) => (
          <article key={u.university_id} className="rf" aria-labelledby={`rf-${u.university_id}`}>
            <header className="rf-hd">
              <h3 id={`rf-${u.university_id}`}>
                {u.university_name}
                {u.region && <small>{u.region}</small>}
              </h3>
              <ReferenceAdvantageText a={u.best} />
            </header>
            {u.fields.map((f) => (
              <details key={f.label} className="sc-fg rf-fg">
                <summary>
                  <b>{f.label}</b>
                  <span className="num">{f.items.length}개 학과</span>
                  {f.provisional && <small>2025 분류 참고</small>}
                  <span className="rf-best"><ReferenceAdvantageText a={f.best} /></span>
                </summary>
                <ul>
                  {f.items.map(({ offering: o, advantage }) => (
                    <li key={o.offering_id}>
                      <span className="u">
                        <b>{o.department}</b>
                        <small>{[o.group ? `${o.group}군` : null, o.track].filter(Boolean).join(" · ")}</small>
                      </span>
                      <ReferenceAdvantageText a={advantage} />
                      {favs && <StarButton id={o.offering_id} on={favs.has(o.offering_id)} name={`${o.university_name} ${o.department}`} />}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </article>
        ))}
      </div>
      <p className="fv-ref-note">
        참고 유불리는 전체 성적 기준 위치와 이 대학 방식으로 계산한 위치의 차이(%p)입니다. 양수면 이 대학 방식에서 내 위치가 더 위입니다.
        합격 가능성 판정이 아니며, 판정은 준비되는 대학부터 차례로 켜집니다.
      </p>
    </section>
  );
}
