import type { ReferenceUniversityGroupDto } from "@/lib/dto";
import { REFERENCE_GROUPS_TITLE, REFERENCE_PERCENTILE_NOTE, REFERENCE_PERCENTILE_TITLE, referencePercentText } from "@/lib/reference-percentile";

/**
 * candidates.reference_university_groups — 참고 누백(추정)이 나온 대학 묶음.
 * 순위·판정이 아니므로 기본 학교 목록(여유·핵심·도전)과 섞지 않고, 서버 순서 그대로 두며 색 신호를 붙이지 않는다.
 */
export function ReferenceGroups({ groups }: { groups: ReferenceUniversityGroupDto[] }) {
  if (groups.length === 0) return null;
  return (
    <section className="fv-ref" aria-labelledby="ref-t">
      <div className="fv-sec-hd">
        <h2 id="ref-t">{REFERENCE_GROUPS_TITLE}</h2>
      </div>
      <p className="fv-ref-note">{REFERENCE_PERCENTILE_NOTE}</p>
      <div className="fv-ref-list">
        {groups.map((g) => (
          <article key={g.university_id} className="rf" aria-labelledby={`rf-${g.university_id}`}>
            <h3 id={`rf-${g.university_id}`}>{g.university_name}</h3>
            <ul>
              {g.offerings.map(({ offering: o, reference_percentile: p }) => (
                <li key={o.offering_id}>
                  <span className="u">
                    <b>{o.department}</b>
                    <small>{[o.group ? `${o.group}군` : null, o.track].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className="v">
                    <small>{REFERENCE_PERCENTILE_TITLE}</small>
                    <b className="num">상위 {referencePercentText(p)}%</b>
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
