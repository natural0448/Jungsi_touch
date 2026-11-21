import { StarButton } from "@/components/star-button";
import { BAND } from "@/components/offering-parts";
import type { ReferenceBandDto } from "@/lib/dto";
import { csatBandText, csatUpper } from "@/lib/provisional-view";
import type { ReferenceUniversity } from "@/lib/reference-view";
import { ReferenceFieldDetails } from "./reference-field";

/** 가채점 7단계 배지. 한 단계면 '적정', 중앙 없이 범위면 '적정~소신'(색은 좋은 끝 단계) */
function CsatBadge({ band }: { band?: ReferenceBandDto | null }) {
  if (!band || !BAND[band.code]) return null;
  const tone = BAND[band.code];
  const upper = csatUpper(band);
  const title = upper
    ? `가채점 점수 범위에 따라 ${BAND[band.code].label}부터 ${BAND[upper].label}까지 나옵니다. 지원 자격은 모집요강에서 확인하세요`
    : `${tone.desc} 지원 자격은 모집요강에서 확인하세요`;
  return <span className={`st ${tone.cls}`} title={title}>{csatBandText(band)}</span>;
}

/**
 * 수능 가채점 리포트의 3번째 화면 목록(dep_r22). 9모 참고 목록과 같은 대학 → 계열 → 학과 묶음·배지·즐겨찾기로 그리되,
 * 가채점에는 누백·지난해 합격선 위치·환산 유불리가 없어 그 줄은 두지 않는다. 계열을 펼칠 때 계산(university.analyze)도 하지 않는다
 * (가채점 4페이지 상세는 아직 보류).
 */
export function CsatGroups({ universities, favs, outsideBand, p3Label }: { universities: ReferenceUniversity[]; favs: Set<string> | null; outsideBand: number; p3Label: string }) {
  if (universities.length === 0) return null;
  return (
    <section className="fv-ref" aria-labelledby="csat-t">
      <div className="fv-sec-hd">
        <h2 id="csat-t">
          가채점으로 본 지원에 유리한 대학 <span className="num">{universities.length}</span>
        </h2>
        <span>가채점 성적을 학교마다 그 대학 방식으로 계산해 안정~상향에 드는 학과를 보여 줍니다. 적정·소신에 드는 학교부터, 계열을 누르면 학과가 펼쳐집니다.</span>
      </div>
      <div className="fv-ref-list">
        {universities.map((u) => (
          <article key={u.university_id} className="rf" aria-labelledby={`rf-${u.university_id}`}>
            <header className="rf-hd">
              <h3 id={`rf-${u.university_id}`}>
                {u.university_name}
                {u.region && <small>{u.region}</small>}
              </h3>
              <CsatBadge band={u.bestBand} />
            </header>
            {u.fields.map((f) => (
              <ReferenceFieldDetails
                key={f.label}
                label={f.label}
                pendingIds={[]}
                summary={
                  <>
                    <b>{f.label}</b>
                    <span className="num">{f.items.length}개 학과</span>
                    {f.provisional && <small>2025 분류 참고</small>}
                    <span className="rf-best"><CsatBadge band={f.bestBand} /></span>
                  </>
                }
              >
                <ul>
                  {f.items.map(({ offering: o, band }) => {
                    const upper = band ? csatUpper(band) : null;
                    return (
                      // 범위 판정이면 학과 줄에 범위임을 한 번 더 적는다(배지는 '적정~소신')
                      <li key={o.offering_id}>
                        <span className="u">
                          <b>{o.department}</b>
                          <small>{[o.group ? `${o.group}군` : null, o.track].filter(Boolean).join(" · ")}</small>
                        </span>
                        <span className="rf-m">
                          <CsatBadge band={band} />
                          {band && upper && <small className="rf-adv">가채점 점수 범위에 따른 판정</small>}
                        </span>
                        {favs && <StarButton id={o.offering_id} on={favs.has(o.offering_id)} name={`${o.university_name} ${o.department}`} />}
                      </li>
                    );
                  })}
                </ul>
              </ReferenceFieldDetails>
            ))}
          </article>
        ))}
      </div>
      <p className="fv-ref-note">
        가채점 원점수로 추정한 표준점수·백분위를 학교마다 그 대학 방식으로 계산해 예상 합격권과 견준 판정입니다. 추정이 한 값으로 모이지 않으면 범위(예: 적정~소신)로 보입니다.
        실채점 성적이 나오면 달라질 수 있고, 합격 가능성 판정이 아니며 올해 모집인원·지원자에 따라 달라집니다.
        {outsideBand > 0 && <> 판정이 도전·불가인 {outsideBand}곳은 넣지 않았습니다.</>} 목록에 없는 학과는 {p3Label}에서 검색할 수 있습니다.
      </p>
    </section>
  );
}
