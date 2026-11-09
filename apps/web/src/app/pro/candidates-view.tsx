import { Fragment } from "react";
import { CATEGORY } from "@/components/offering-parts";
import { wildcardReasonText } from "@/lib/wildcard-layout";
import { REFERENCE_GROUPS_TITLE, REFERENCE_PERCENTILE_NOTE, REFERENCE_PERCENTILE_TITLE, referenceGroups, referencePercentText } from "@/lib/reference-percentile";
import type { CandidateItemDto, CandidatesDto, ShortlistEntryDto } from "@/lib/dto";
import type { ProReason } from "@/lib/pro-dto";
import { tipsByOffering } from "@/lib/pro-tips";
import { TipBox } from "./tip-box";
import { addStudentBookmark } from "./actions";
import { ActionButton } from "./action-button";

/*
  전문가용 유리한 대학 찾기 결과(개인용 candidates 와 같은 모양). 대학별 묶음과 와일드카드를 나눠 보이고,
  모집단위마다 학생에게 담기 버튼을 둔다(줄마다 다른 요청 키). 분류·환산·유불리 숫자는 서버가 준 값 그대로다(화면이 계산하지 않는다).
  줄 아래에 '왜 이 분류인가' 상담 tip(서버 근거)을 접어 둔다.
*/

function Row({ it, picked, fields, tips }: { it: CandidateItemDto; picked: boolean; fields: Record<string, string> | null; tips: ProReason[] | undefined }) {
  const o = it.offering, a = it.assessment, c = CATEGORY[a.category];
  const box = <TipBox reasons={tips} category={a.category} />;
  return (
    <>
    <tr>
      <td><span className={`cat ${c.cls}`}>{c.label}</span></td>
      <th scope="row">
        {o.department}
        <small>{[o.group ? `${o.group}군` : null, o.track, o.campus].filter(Boolean).join(" · ")}</small>
      </th>
      <td className="r num">{a.converted_score ?? "─"}</td>
      <td className="r num">{a.advantage ? `${a.advantage.delta_pp}%p` : "─"}</td>
      <td className="r">
        {picked ? <span className="cur">담음</span> : fields ? <ActionButton act={addStudentBookmark} fields={{ ...fields, offering_id: o.offering_id, idem: crypto.randomUUID() }} label="담기" busy="담는 중…" /> : null}
      </td>
    </tr>
    {tips && tips.length > 0 && (
      <tr className="pro-tip-row">
        <td colSpan={5}>{box}</td>
      </tr>
    )}
    </>
  );
}

export function CandidatesView({ c, shortlist, fields, reasons }: { c: CandidatesDto; shortlist: Record<string, ShortlistEntryDto>; fields: Record<string, string> | null; reasons: ProReason[] }) {
  const tips = tipsByOffering(reasons);
  const picked = (id: string) => Boolean(shortlist[id]?.selected);
  const refs = <ReferenceTables c={c} />;
  if (c.status === "pending" && c.basic_university_groups.length === 0 && c.wildcards.length === 0)
    return (
      <>
        <p className="pro-note">대학 판단 자료가 아직 연결되지 않아 후보를 고르지 못했습니다(사유 코드 {c.reason_code ?? "pending"}). 숫자를 지어내지 않습니다.</p>
        {refs}
      </>
    );
  const head = (
    <thead>
      <tr>
        <th scope="col">분류</th>
        <th scope="col">모집단위</th>
        <th scope="col" className="r">환산점수</th>
        <th scope="col" className="r">환산 유불리</th>
        <th scope="col"><span className="sr">담기</span></th>
      </tr>
    </thead>
  );
  return (
    <div className="pro-cands">
      {c.basic_university_groups.map((g) => (
        <div key={g.university_id} className="tblwrap">
          <h3>{g.university_name}</h3>
          <table className="tb">
            {head}
            <tbody>{g.offerings.map((it) => <Row key={it.offering.offering_id} it={it} picked={picked(it.offering.offering_id)} fields={fields} tips={tips.get(it.offering.offering_id)} />)}</tbody>
          </table>
        </div>
      ))}
      {c.wildcards.length > 0 && (
        <div className="tblwrap">
          <h3>와일드카드 <small className="pro-note">{c.wildcard_selection ? "간호·보건·교육·계약학과·해양·철도 계열, 서버가 고른 최대 4곳(여유 → 핵심 → 도전 순)" : "간호·보건·교육 계열(해마다 지원 쏠림 변동이 큰 계열)"}{c.wildcard_selection && c.wildcard_selection.status !== "ready" ? ` · ${wildcardReasonText(c.wildcard_selection.reason_code)}` : ""}</small></h3>
          <table className="tb">
            {head}
            <tbody>{c.wildcards.map((it) => <Row key={it.offering.offering_id} it={it} picked={picked(it.offering.offering_id)} fields={fields} tips={tips.get(it.offering.offering_id)} />)}</tbody>
          </table>
        </div>
      )}
      {refs}
      {c.pending_offerings.length > 0 && <p className="pro-note">판단 보류 {c.pending_offerings.length}곳 — 자료가 갖춰지면 다시 찾을 때 보입니다.</p>}
      <p className="pro-note">환산점수는 대학마다 만점·반영 방식이 달라 대학끼리 크기를 비교하지 않습니다. 분류는 합격 확률이 아닙니다.</p>
    </div>
  );
}

/** 참고 누백(추정) 묶음 — 순위·판정 아님. 분류·담기 없이 서버 순서 그대로 따로 보인다 */
function ReferenceTables({ c }: { c: CandidatesDto }) {
  const groups = referenceGroups(c);
  if (groups.length === 0) return null;
  return (
    <div className="pro-cands">
      <h3>{REFERENCE_GROUPS_TITLE}</h3>
      <p className="pro-note">{REFERENCE_PERCENTILE_NOTE}</p>
      {groups.map((g) => (
        <div key={g.university_id} className="tblwrap">
          <h3>{g.university_name}</h3>
          <table className="tb">
            <thead>
              <tr>
                <th scope="col">모집단위</th>
                <th scope="col" className="r">{REFERENCE_PERCENTILE_TITLE}</th>
              </tr>
            </thead>
            <tbody>
              {g.offerings.map(({ offering: o, reference_percentile: p }) => (
                <tr key={o.offering_id}>
                  <th scope="row">
                    {o.department}
                    <small>{[o.group ? `${o.group}군` : null, o.track, o.campus].filter(Boolean).join(" · ")}</small>
                  </th>
                  <td className="r num">상위 {referencePercentText(p)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** 담은 학교 목록(고정 리포트 판의 shortlist + 판단 결과) */
export function PickedList({ shortlist, analyses, names, reasons }: { shortlist: Record<string, ShortlistEntryDto>; analyses: Record<string, CandidateItemDto["assessment"]>; names: Map<string, CandidateItemDto["offering"]>; reasons: ProReason[] }) {
  const tips = tipsByOffering(reasons);
  const ids = Object.entries(shortlist).filter(([, e]) => e.selected).map(([id]) => id);
  if (ids.length === 0) return <p className="pro-note">아직 담은 학교가 없습니다. 위 후보에서 &lsquo;담기&rsquo;를 눌러 주세요.</p>;
  return (
    <div className="tblwrap">
      <table className="tb">
        <thead>
          <tr>
            <th scope="col">분류</th>
            <th scope="col">대학·모집단위</th>
            <th scope="col" className="r">환산점수</th>
            <th scope="col" className="r">환산 유불리</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const o = names.get(id), a = analyses[id];
            const c = a ? CATEGORY[a.category] : CATEGORY.pending;
            const t = tips.get(id);
            return (
              <Fragment key={id}>
                <tr>
                  <td><span className={`cat ${c.cls}`}>{c.label}</span></td>
                  <th scope="row">{o ? `${o.university_name} ${o.department}` : id}<small>{o ? [o.group ? `${o.group}군` : null, o.track].filter(Boolean).join(" · ") : ""}</small></th>
                  <td className="r num">{a?.converted_score ?? "─"}</td>
                  <td className="r num">{a?.advantage ? `${a.advantage.delta_pp}%p` : "─"}</td>
                </tr>
                {a && t && t.length > 0 && (
                  <tr className="pro-tip-row">
                    <td colSpan={4}><TipBox reasons={t} category={a.category} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
