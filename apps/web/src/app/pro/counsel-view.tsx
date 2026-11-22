import { Fragment } from "react";
import { BAND } from "@/components/offering-parts";
import type { ShortlistEntryDto } from "@/lib/dto";
import { ratioText } from "@/lib/format";
import { BAND_ORDER, choiceGuide, schoolCounsel, shortTag, type ChoiceGuide, type CounselSchool } from "@/lib/pro-counsel";
import type { CsatRow } from "@/lib/pro-counsel-view";
import { ActionButton } from "./action-button";
import { addStudentBookmark, removeStudentBookmark } from "./actions";

/*
  선생님용 상담(2026-11-22 대표님 결정, 설계 C:\j\w\pro_counsel\DESIGN.md): 학교별 상담 팁 네 칸·최종 3개 선택 가이드·
  가채점 대학 찾기 목록. 문장은 lib/pro-counsel.ts 의 고정 틀만 쓴다(숫자 없으면 그 문장 없음, 출처·확률 표현 없음).
*/

const SECTIONS = [
  ["why", "이 학교를 추천하는 이유"],
  ["chance", "합격 가능성 안내"],
  ["history", "지난 학년도 흐름"],
  ["watch", "원서접수 때 확인할 것"],
] as const;

/** 2단계(등록금·장학·학생 지원·전공 전망) 자리. 자료가 오면 채운다 */
export const PHASE2_NOTE = "등록금·장학·학생 지원·전공 전망 — 공시 자료를 연결하면 채웁니다.";

/** 학교 하나의 상담 팁. open=true 면 접지 않고 펼친다(인쇄) */
export function CounselTips({ s, open = false, phase2 = false }: { s: CounselSchool; open?: boolean; phase2?: boolean }) {
  const c = schoolCounsel(s);
  const body = (
    <>
      {SECTIONS.map(([k, title]) =>
        c[k].length > 0 ? (
          <div key={k} className="pc-part">
            <h4>{title}</h4>
            <ul>{c[k].map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        ) : null,
      )}
      {c.cautions.length > 0 && (
        <ul className="pc-caution">{c.cautions.map((t, i) => <li key={i}>{t}</li>)}</ul>
      )}
      {phase2 && <p className="pc-phase2">{PHASE2_NOTE}</p>}
    </>
  );
  if (open) return <div className="pc-tips">{body}</div>;
  return (
    <details className="pro-tip pc-tips">
      <summary>상담 팁 <small>{shortTag(s)}</small></summary>
      {body}
    </details>
  );
}

/** 최종 3개 선택 가이드(가·나·다 하나씩 고르기) */
export function ChoiceGuideView({ g }: { g: ChoiceGuide }) {
  return (
    <div className="pc-guide">
      {g.groups.map((x) => (
        <div key={x.group} className="pc-guide-g">
          <h4>{x.group}군</h4>
          <ul>{x.lines.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      ))}
      {g.combos.length > 0 && (
        <div className="pc-guide-g">
          <h4>조합 예시</h4>
          <ul>
            {g.combos.map((c) => (
              <li key={c.name}><b>{c.name}</b> {c.line}</li>
            ))}
          </ul>
        </div>
      )}
      {g.notes.map((t, i) => <p key={i} className="pro-note">{t}</p>)}
    </div>
  );
}

export function guideOf(schools: CounselSchool[]): ChoiceGuide | null {
  return schools.length > 0 ? choiceGuide(schools) : null;
}

/** 가채점 판정 배지(한 단계 또는 '적정~소신') */
export function CsatBadge({ code, upper }: { code: string; upper?: string | null }) {
  const b = BAND[code as keyof typeof BAND];
  if (!b) return <span className="cat">판정 없음</span>;
  const u = upper && BAND[upper as keyof typeof BAND] && BAND_ORDER.indexOf(upper as never) > BAND_ORDER.indexOf(code as never) ? BAND[upper as keyof typeof BAND] : null;
  return <span className={`cat ${b.cls}`} title={b.desc}>{u ? `${b.label}~${u.label}` : b.label}</span>;
}

/** 단계 안 위치 짧은 말(목록 칸) */
function positionShort(r: CsatRow): string {
  const p = r.band.position;
  if (!p || typeof p.share_pct !== "number") return "─";
  return p.share_pct >= 67 ? "위쪽(안전한 쪽)" : p.share_pct <= 33 ? "아래쪽(아슬아슬한 쪽)" : "가운데";
}

/**
 * 가채점 대학 찾기 결과(전문가용). 군마다 판정 순서로, 안정~상향은 펼치고 도전은 접어 둔다(담을 수 있게).
 * 판정·위치는 서버 값 그대로다.
 */
export function CsatCandidates({ rows, shortlist, fields }: { rows: CsatRow[]; shortlist: Record<string, ShortlistEntryDto>; fields: Record<string, string> | null }) {
  const picked = (id: string) => Boolean(shortlist[id]?.selected);
  const order = (a: CsatRow, b: CsatRow) =>
    BAND_ORDER.indexOf(a.band.code) - BAND_ORDER.indexOf(b.band.code) || (b.band.position?.share_pct ?? -1) - (a.band.position?.share_pct ?? -1) || (a.offering.university_name < b.offering.university_name ? -1 : 1);
  const table = (list: CsatRow[]) => (
    <table className="tb">
      <thead>
        <tr>
          <th scope="col">판정</th>
          <th scope="col">대학·모집단위</th>
          <th scope="col">단계 안 위치</th>
          <th scope="col"><span className="sr">담기</span></th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => {
          const o = r.offering;
          return (
            <tr key={o.offering_id}>
              <td><CsatBadge code={r.band.code} upper={r.band.upper_code} /></td>
              <th scope="row">
                {o.university_name} {o.department}
                <small>{[o.track, o.campus, o.region].filter(Boolean).join(" · ")}</small>
              </th>
              <td>{positionShort(r)}</td>
              <td className="r">
                {picked(o.offering_id) ? (
                  <span className="pro-picked">
                    <span className="cur">담음</span>
                    {fields && <ActionButton act={removeStudentBookmark} fields={{ ...fields, offering_id: o.offering_id, idem: crypto.randomUUID() }} label="빼기" busy="빼는 중…" />}
                  </span>
                ) : fields ? <ActionButton act={addStudentBookmark} fields={{ ...fields, offering_id: o.offering_id, idem: crypto.randomUUID() }} label="담기" busy="담는 중…" /> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  return (
    <div className="pro-cands">
      {["가", "나", "다"].map((g) => {
        const all = rows.filter((r) => r.offering.group === g).sort(order);
        const main = all.filter((r) => r.band.code !== "challenge" && r.band.code !== "outside");
        const reach = all.filter((r) => r.band.code === "challenge");
        if (all.length === 0) return <p key={g} className="pro-note">{g}군: 판정이 나온 학교가 이 목록에 없습니다.</p>;
        return (
          <Fragment key={g}>
            <div className="tblwrap">
              <h3>{g}군 <small className="pro-note">{main.length}곳</small></h3>
              {main.length > 0 ? table(main) : <p className="pro-note">안정~상향에 드는 학교가 이 목록에 없습니다.</p>}
            </div>
            {reach.length > 0 && (
              <details className="pc-reach">
                <summary>{g}군 도전 {reach.length}곳 보기</summary>
                <div className="tblwrap">{table(reach)}</div>
              </details>
            )}
          </Fragment>
        );
      })}
      <p className="pro-note">가채점 원점수로 추정한 표준점수·백분위를 학교마다 그 대학 방식으로 계산해 예상 합격권과 견준 판정입니다. 판정은 합격 확률이 아니며 실채점 성적이 나오면 달라질 수 있습니다. 목록은 군·단계마다 고르게 일부를 싣습니다.</p>
    </div>
  );
}

/** 학교 하나의 학년도별 표(가채점 인쇄의 펼친 상세). 값이 없는 칸은 '─' */
export function CounselYearsTable({ s }: { s: CounselSchool }) {
  const ys = [...(s.years ?? [])].sort((a, b) => a.year - b.year);
  if (ys.length === 0) return <p className="pro-note">1페이지 학년도별 자료가 없습니다.</p>;
  return (
    <table className="tb pc-years">
      <thead>
        <tr>
          <th scope="col">학년도</th>
          <th scope="col" className="r">모집인원</th>
          <th scope="col" className="r">경쟁률</th>
          <th scope="col" className="r">충원인원</th>
          <th scope="col" className="r">대학 발표 성적 ①</th>
          <th scope="col" className="r">대학 발표 성적 ②</th>
        </tr>
      </thead>
      <tbody>
        {ys.map((y, i) => (
          <tr key={`${y.year}-${i}`}>
            <th scope="row" className="num">{y.year}</th>
            <td className="r num">{y.quota ?? "─"}</td>
            <td className="r num">{y.ratio ? `${ratioText(y.ratio)}:1` : "─"}</td>
            <td className="r num">{y.fill ?? "─"}</td>
            <td className="r num">{y.first ? `${y.first.label} ${y.first.value}${y.first.unit ?? ""}` : "─"}</td>
            <td className="r num">{y.second ? `${y.second.label} ${y.second.value}${y.second.unit ?? ""}` : "─"}</td>
          </tr>
        ))}
        {typeof s.quota2027 === "number" && (
          <tr>
            <th scope="row" className="num">2027</th>
            <td className="r num">{s.quota2027}</td>
            <td className="r" colSpan={4}><small className="pro-note">올해 모집(최종 모집인원)</small></td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** 담은 학교(상담 팁 포함). 가채점·9월 모두 상담 입력(CounselSchool)으로 그린다. 이름을 못 찾은 학교는 번호만 */
export function CounselPicked({ schools, missing, fields }: { schools: CounselSchool[]; missing: string[]; fields: Record<string, string> | null }) {
  if (schools.length === 0 && missing.length === 0) return <p className="pro-note">아직 담은 학교가 없습니다. 위 목록에서 &lsquo;담기&rsquo;를 눌러 주세요.</p>;
  const cols = fields ? 4 : 3;
  return (
    <div className="tblwrap">
      <table className="tb">
        <thead>
          <tr>
            <th scope="col">판정</th>
            <th scope="col">대학·모집단위</th>
            <th scope="col">위치</th>
            {fields && <th scope="col"><span className="sr">빼기</span></th>}
          </tr>
        </thead>
        <tbody>
          {schools.map((s) => (
            <Fragment key={s.offering_id}>
              <tr>
                <td>{s.band ? <CsatBadge code={s.band.code} upper={s.band.upper} /> : <span className="cat">판정 없음</span>}</td>
                <th scope="row">{s.university_name} {s.department}<small>{[`${s.group}군`, s.track].filter(Boolean).join(" · ")}</small></th>
                <td>{shortTag(s)}</td>
                {fields && <td className="r"><ActionButton act={removeStudentBookmark} fields={{ ...fields, offering_id: s.offering_id, idem: crypto.randomUUID() }} label="빼기" busy="빼는 중…" /></td>}
              </tr>
              <tr className="pro-tip-row">
                <td colSpan={cols}><CounselTips s={s} /></td>
              </tr>
            </Fragment>
          ))}
          {missing.map((id) => (
            <tr key={id}>
              <td><span className="cat">판정 없음</span></td>
              <th scope="row">{id}<small>이 판의 목록에 없는 학교입니다</small></th>
              <td>─</td>
              {fields && <td className="r"><ActionButton act={removeStudentBookmark} fields={{ ...fields, offering_id: id, idem: crypto.randomUUID() }} label="빼기" busy="빼는 중…" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
