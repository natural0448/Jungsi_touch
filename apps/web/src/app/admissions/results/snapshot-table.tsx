import { asOfDate } from "@/lib/format";
import { rankDisplayModel } from "@/lib/p1-field-qualification";
import { publishedStatisticLabel, unitKey, type Cell, type Row } from "@/lib/p1-shape";

/*
  정리본 한 모집단위: 학년도별 한 줄, 이전 고정 표 배치(연결계약 v3 §5).
  모집인원 · 경쟁률 · 추정 총 지원자 · 충원인원 · 추정 탈락자 · 최종 합격 예비번호 · 최종 50%컷 · 최종 70%컷
  (+ 다른 비율·평균·최저 등 수집된 발표는 '대학 발표 통계' 칸). 값은 원문 표기 그대로, null 은 0 이 아니다.
  값이 있는데 확인 중(pending_metadata)이면 값과 확인 사유를 함께 보인다. 예비번호는 '번', 충원은 '명'.
  추정 2열만 기존 승인 산식(모집인원×경쟁률 반올림, −모집−충원)으로 계산하고 발표 칸을 덮지 않는다.
  추정 총 지원자는 충원인원 없이도 계산하고, 추정 탈락자만 충원인원이 있어야 계산한다.
*/

export const PAST_YEARS = [2026, 2025, 2024] as const;

/** 확인 사유 코드 → 화면 문장. 모르는 코드는 코드 그대로 보인다(뜻을 지어내지 않는다) */
const REASON: Record<string, string> = {
  SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING: "발표 정의·단위·자격 확인 중",
  NO_QUALIFIED_CANDIDATE_IN_CURRENT_SOURCE_SCOPE: "현재 연결된 자료에서 이 표시 기준에 맞는 값을 확인하지 못했습니다.",
  NO_CUT_ALTERNATIVE_IN_SELECTED_SCOPE: "선택한 표시 범위에서 별도의 발표값을 확인하지 못했습니다.",
  OTHER_BASIS_OR_EXPLICIT75_RETAINED_NOT70_BACKFILL: "다른 기준·75%컷은 70%컷 대신 쓰지 않고 따로 보존",
  FINAL_WAITLIST_SOURCE_QUALIFICATION_UNCONFIRMED: "최종 예비번호 발표 자격 확인 중",
  MULTIPLE_SAME_PRIORITY_BASIS_DEFINITIONS_UNRESOLVED: "같은 우선순위의 기준이 여럿이라 확인 중",
  NO_FINAL_REGISTRANT_SAME_BASIS_CUT50: "선택한 점수 기준의 최종등록자 50%컷을 확인하지 못했습니다.",
  NO_FINAL_REGISTRANT_SAME_BASIS_CUT70: "선택한 점수 기준의 최종등록자 70%컷을 확인하지 못했습니다.",
  MULTIPLE_CURRENT_CANDIDATES_DEFINITION_EVENT_OR_VALUE_CONFLICT: "발표가 여러 건이고 정의·시점·값이 달라 확인 중",
  EXPLICIT75_ALTERNATE_NOT70_REPLACEMENT: "대학이 75%컷으로 발표(70%컷 대체 아님)",
  UNCLASSIFIED_BASIS_NEEDS_SOURCE_DEFINITION_NO_TOTAL_CUT_PROMOTION: "점수 기준 분류 전 — 원문 정의 확인 중",
  OFFERING_MAPPING_PENDING_ORIGINAL_OBSERVATION_PRESERVED: "모집행 연결 확인 중(원문 보존)",
  NONNUMERIC_LITERAL_REQUIRES_SOURCE_REVIEW: "숫자가 아닌 원문 값 — 확인 중",
};
export const reasonText = (code: string | null) => (code ? (REASON[code] ?? code) : null);

const COHORT: Record<string, string> = {
  final_registrants: "최종등록자", initial_admits: "최초합격자", final_admits: "최종합격자",
  final_enrolled_students: "최종입학생", registrants_finality_not_specified: "등록자(최종 여부 확인 중)",
};
const cohortText = (c: string | null | undefined) => (c ? (COHORT[c] ?? c) : null);
const STAGE: Record<string, string> = { initial: "최초", rollover: "이월", final: "최종", unspecified: "단계 미명시" };

/** 확인 중 표시(값 옆 작은 꼬리표). 사유는 title 과 화면 읽기 프로그램용 글자로 함께 */
function Hold({ code }: { code: string | null }) {
  const t = reasonText(code) ?? "확인 중";
  return (
    <span className="rs-hold" title={t}>
      확인 중<span className="sr">: {t}</span>
    </span>
  );
}

function Value({ c, unitOverride }: { c: Cell; unitOverride?: string }) {
  if (c.v === null) {
    const t = reasonText(c.r);
    return c.s === "pending_metadata" ? <Hold code={c.r} /> : <span className="unpub" title={t ?? undefined}>─</span>;
  }
  const unit = unitOverride ?? c.u;
  return (
    <>
      <b className="num">{c.v}</b>
      {unit && <small> {unit}</small>}
      {c.s === "pending_value_type" ? <span className="rs-hold" title={reasonText(c.r) ?? undefined}>원문</span> : c.s.startsWith("pending") && <Hold code={c.r} />}
    </>
  );
}

function RankValue({ c }: { c: Cell }) {
  const view = rankDisplayModel(c);
  return <>
    <Value c={view.cell} />
    {view.qualified && <small className="rs-bs">이 필드의 서비스 자격 확인</small>}
    {view.qualified && view.rawPending && <small className="rs-bs" title={reasonText(c.r) ?? undefined}>원자료 메타 상태: 확인 중</small>}
  </>;
}

function Cut({ c }: { c: Cell }) {
  const basis = [c.b, cohortText(c.co ?? c.cc)].filter(Boolean).join(" · ");
  const asOf = asOfDate(c.at);
  return (
    <>
      <Value c={c} />
      {c.v !== null && basis && <small className="rs-bs">{basis}</small>}
      {c.v !== null && asOf && <small className="rs-bs">자료 기준 {asOf}</small>}
      {c.v !== null && c.url && <small className="rs-bs"><a href={c.url} target="_blank" rel="noopener noreferrer" aria-label={`${publishedStatisticLabel(c)} 원문`}>원문</a></small>}
    </>
  );
}

/* 추정 2열 재료: 십진 문법을 직접 검사한다(Number("") → 0 같은 변환을 쓰지 않는다) */
const personInt = (c: Cell): number | null => {
  if (c.v === null || c.u !== "명") return null;
  const s = c.v.trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
};
const ratioOf = (c: Cell): { n: number; s: number } | null => {
  if (c.v === null) return null;
  if (c.u !== null && !c.u.includes("대")) return null;
  const t = /^(\d+)(?:\.(\d+))?$/.exec(c.v.trim());
  if (!t) return null;
  const frac = t[2] ?? "";
  if ((t[1] + frac).length > 10) return null;
  return { n: Number(t[1] + frac), s: 10 ** frac.length };
};
/* 추정 총 지원자 = 모집인원×경쟁률(충원 불필요), 추정 탈락자 = 그 값 − 모집인원 − 충원인원(충원이 있을 때만). 2026-10-22 사용자 확인 */
function derived(r: Row): { applicants: number | null; dropped: number | null; heldA: boolean; heldD: boolean } {
  const cap = personInt(r.rc);
  const fill = personInt(r.ad);
  const ratio = ratioOf(r.cr);
  const isHeld = (c: Cell) => c.s !== "verified_official" && c.s.startsWith("pending");
  if (cap === null || ratio === null || cap >= 1e5) return { applicants: null, dropped: null, heldA: false, heldD: false };
  // half-up(Q×R)을 정수 분수로: floor((2QR + s) / 2s)
  const applicants = Math.floor((2 * cap * ratio.n + ratio.s) / (2 * ratio.s));
  const heldA = isHeld(r.rc) || isHeld(r.cr);
  if (fill === null) return { applicants, dropped: null, heldA, heldD: false };
  const d = applicants - cap - fill;
  return { applicants, dropped: d >= 0 ? d : null, heldA, heldD: heldA || isHeld(r.ad) };
}

export const latestOf = (rows: Row[]) => [...rows].sort((a, b) => b.y - a.y)[0];

/** 한 모집단위(같은 원래 PK 또는 미연결 관측 하나)의 학년도별 고정 표 */
export function YearTable({ rows, schoolName }: { rows: Row[]; schoolName: string }) {
  const latest = latestOf(rows);
  const byYear = new Map<number, Row[]>();
  for (const r of rows) byYear.set(r.y, [...(byYear.get(r.y) ?? []), r]);
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const hasAlt = rows.some((r) => r.alt.e.length > 0 || r.alt.om > 0);
  const pending = latest.pk === null;
  const variants = Math.max(...rows.map((r) => r.idv));
  const urls = [...new Set(rows.flatMap((r) => [r.rc, r.cr, r.ad, r.rk, r.c50, r.c70, ...r.alt.e].map((c) => c.url).filter((u): u is string => !!u)))].slice(0, 3);
  return (
    <div className="rs-yt">
      {pending && <p className="rs-idnote">모집행 연결 확인 중인 발표입니다. 다른 학년도와 합치지 않고 원문 그대로 보입니다.</p>}
      {variants > 1 && <p className="rs-idnote">대학명·전형 표기가 발표마다 달라({variants}가지) 같은 모집단위인지 확인 중입니다. 숫자는 발표 그대로입니다.</p>}
      <div className="tblwrap">
        <table className="tb rs-years">
          <thead>
            <tr>
              <th scope="col">학년도</th>
              <th scope="col" className="r">모집인원</th>
              <th scope="col" className="r">경쟁률</th>
              <th scope="col" className="r derived">추정 총 지원자</th>
              <th scope="col" className="r">충원인원</th>
              <th scope="col" className="r derived">추정 탈락자</th>
              <th scope="col" className="r">최종 합격 예비번호</th>
              <th scope="col" className="r">최종 50%컷</th>
              <th scope="col" className="r">최종 70%컷</th>
              {hasAlt && <th scope="col" className="r">대학 발표 통계</th>}
            </tr>
          </thead>
          <tbody>
            {years.flatMap((y) =>
              byYear.get(y)!.map((r, i) => {
                const dv = derived(r);
                const renamedDept = r.d !== latest.d ? r.d : null;
                const otherName = r.n !== schoolName ? r.n : null;
                return (
                  <tr key={`${y}-${i}`}>
                    <th scope="row">
                      <span className="num">{y}</span>
                      {byYear.get(y)!.length > 1 && <small>같은 해 발표 {i + 1}</small>}
                      {otherName && <small>발표명 {otherName}</small>}
                      {renamedDept && <small>당시 {renamedDept}</small>}
                    </th>
                    <td className="r">
                      <Value c={r.rc} />
                      {r.rc.v !== null && r.rc.st && <small className="rs-bs">{STAGE[r.rc.st] ?? r.rc.st}</small>}
                    </td>
                    <td className="r"><Value c={r.cr} /></td>
                    <td className="r derived">
                      {dv.applicants === null ? <span className="unpub">─</span> : <><b className="num">{dv.applicants}</b><small> 명</small>{dv.heldA && <Hold code="SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING" />}</>}
                    </td>
                    <td className="r"><Value c={r.ad} /></td>
                    <td className="r derived">
                      {dv.dropped === null ? <span className="unpub">─</span> : <><b className="num">{dv.dropped}</b><small> 명</small>{dv.heldD &&<Hold code="SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING" />}</>}
                    </td>
                    <td className="r"><RankValue c={r.rk} /></td>
                    <td className="r"><Cut c={r.c50} /></td>
                    <td className="r"><Cut c={r.c70} /></td>
                    {hasAlt && (
                      <td className="r">
                        {r.alt.e.length === 0 ? (
                          <span className="unpub" title={reasonText(r.alt.r) ?? undefined}>─</span>
                        ) : (
                          r.alt.e.map((e, k) => (
                            <div key={k}>
                              <small style={{ whiteSpace: "pre-line" }}>{publishedStatisticLabel(e)} </small>
                              <Cut c={e} />
                            </div>
                          ))
                        )}
                        {r.alt.om > 0 && <small className="rs-bs">이 판에 표시하지 않은 다른 기준 {r.alt.om}건</small>}
                      </td>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {urls.length > 0 && (
        <p className="rs-src">
          출처{" "}
          {urls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer">
              {i + 1}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

/** 학교 묶음의 행을 모집단위(같은 원래 PK / 미연결 관측 하나)로 나눈다. 연결된 단위를 먼저, 미연결 관측을 뒤에 */
export function groupUnits(rows: Row[]): Row[][] {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(unitKey(r), [...(by.get(unitKey(r)) ?? []), r]);
  const all = [...by.values()];
  const label = (rs: Row[]) => [...rs].sort((a, b) => b.y - a.y)[0];
  const mapped = all.filter((rs) => rs[0].pk !== null).sort((a, b) => (label(a).g ?? "").localeCompare(label(b).g ?? "") || label(a).d.localeCompare(label(b).d, "ko"));
  const pending = all.filter((rs) => rs[0].pk === null);
  return [...mapped, ...pending];
}
