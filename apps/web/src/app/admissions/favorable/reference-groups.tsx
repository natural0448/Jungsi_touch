import { StarButton } from "@/components/star-button";
import { ADVANTAGE_WORD } from "@/components/offering-parts";
import type { ReferenceAdvantage } from "@/lib/reference-advantage";
import type { CutoffMargin, ReferenceUniversity } from "@/lib/reference-view";

/** 지난해 합격선과의 위치 한 줄: "2025 70%컷보다 7.2~10.7%p 위 참고" */
export function MarginText({ m }: { m: CutoffMargin | null }) {
  if (!m) return <span className="need">합격선 자료 없음</span>;
  const tone = m.side === "above" ? "up" : m.side === "near" ? "even" : "down";
  return (
    <span className={`v num ${tone}`}>
      {m.text} <small className="ref">참고</small>
    </span>
  );
}

/** 참고 유불리 보조 표시: "유리 +1.2%p" */
function AdvantageNote({ a }: { a: ReferenceAdvantage | null }) {
  if (!a) return null;
  return <small className="rf-adv">환산 {ADVANTAGE_WORD[a.tone]} {a.text}%p</small>;
}

/**
 * 참고 누백이 나온 학과 가운데 지난해 합격선에 내 위치가 닿는 곳을 대학 → 계열 → 학과로 보인다(대표님 결정 2026-11-19).
 * 계열을 누르면 학과와 합격선 대비 위치가 펼쳐지고, 학과마다 즐겨찾기만 할 수 있다. 판정·담기는 없다.
 */
export function ReferenceGroups({ universities, favs, below, noCutoff, ineligible = 0, p3Label }: { universities: ReferenceUniversity[]; favs: Set<string> | null; below: number; noCutoff: number; ineligible?: number; p3Label: string }) {
  if (universities.length === 0) return null;
  return (
    <section className="fv-ref" aria-labelledby="ref-t">
      <div className="fv-sec-hd">
        <h2 id="ref-t">
          내 성적 분포상 지원에 유리한 대학 <span className="num">{universities.length}</span>
        </h2>
        <span>지난해 합격선(70%컷)에 내 위치가 닿는 학과만, 여유가 큰 학교부터 보여 줍니다. 계열을 누르면 학과가 펼쳐집니다.</span>
      </div>
      <div className="fv-ref-list">
        {universities.map((u) => (
          <article key={u.university_id} className="rf" aria-labelledby={`rf-${u.university_id}`}>
            <header className="rf-hd">
              <h3 id={`rf-${u.university_id}`}>
                {u.university_name}
                {u.region && <small>{u.region}</small>}
              </h3>
              <MarginText m={u.best} />
            </header>
            {u.fields.map((f) => (
              <details key={f.label} className="sc-fg rf-fg">
                <summary>
                  <b>{f.label}</b>
                  <span className="num">{f.items.length}개 학과</span>
                  {f.provisional && <small>2025 분류 참고</small>}
                  <span className="rf-best"><MarginText m={f.best} /></span>
                </summary>
                <ul>
                  {f.items.map(({ offering: o, margin, advantage }) => (
                    <li key={o.offering_id}>
                      <span className="u">
                        <b>{o.department}</b>
                        <small>{[o.group ? `${o.group}군` : null, o.track].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="rf-m">
                        <MarginText m={margin} />
                        <AdvantageNote a={advantage} />
                      </span>
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
        지난해 대학이 발표한 합격선(최종등록자 70%컷, 없으면 50%컷)을 전체 응시자 기준 위치로 옮긴 값과, 이 대학 방식으로 계산한 내 위치(참고 누백)를 견준 것입니다.
        &lsquo;위&rsquo;일수록 지난해 기준으로 여유가 있다는 뜻이고, 내 위치가 범위면 불리한 끝으로 순서를 정했습니다. 합격 가능성 판정이 아니며 올해 모집인원·지원자에 따라 달라집니다.
        {(below > 0 || noCutoff > 0 || ineligible > 0) && <> 합격선보다 아래인 {below}곳과 합격선 자료가 없는 {noCutoff}곳{ineligible > 0 && <>, 지원 필수 과목 조건을 채우지 못한 {ineligible}곳</>}은 넣지 않았습니다. {p3Label}에서 하나씩 확인할 수 있습니다.</>}
      </p>
    </section>
  );
}
