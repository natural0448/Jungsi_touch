import { asOfDate, ratioText } from "@/lib/format";
import { derived } from "@/lib/p1-derived";
import { rankDisplayModel } from "@/lib/p1-field-qualification";
import { publishedStats, type PublishedStat } from "@/lib/p1-published-stats";
import { historicalConditionLabel, unitKey, type Cell, type Row } from "@/lib/p1-shape";
import { ScrollHint } from "./scroll-hint";

/*
  정리본 한 모집단위: 학년도별 한 줄, 이전 고정 표 배치(연결계약 v3 §5).
  모집인원 · 경쟁률 · 추정 총 지원자 · 최종 합격 예비번호 · 추정 탈락자 · 대학 발표 성적 ①·②.
  충원인원(실제 추가 합격자 수, 명)은 열로 보이지 않는다(2026-11-02 사용자 결정). 정리본 자료는 그대로 보존한다.
  값은 원문 표기 그대로, null 은 0 이 아니다. 모집인원 단계·대상 집단 꼬리표·출처 링크는 보이지 않는다(2026-10-24 사용자 결정).
  발표 성적 두 칸은 대학마다 다른 통계(50·70%컷, 평균·75%컷 등) 중 두 개를 골라 통계 이름과 함께 보인다(2026-10-28 사용자 결정,
  고르는 규칙은 lib/p1-published-stats.ts). ① 은 50%컷 자리, ② 는 70%컷 자리로 통계마다 칸이 고정된다(같은 날 정정). 별도 '대학 발표 추가 통계' 열은 만들지 않는다. 정리본 자료는 그대로 보존한다.
  '확인 중' 꼬리표·확인 사유는 보이지 않는다(2026-11-04 사용자 결정, 자료의 status·reason 은 보존). 예비번호는 '번'.
  추정 2열만 계산하고 발표 칸을 덮지 않는다: 추정 총 지원자 = 모집인원×경쟁률(반올림),
  추정 탈락자 = 추정 총 지원자 − (모집인원 + 최종 합격 예비번호)(2026-11-02 사용자 결정, 이전 산식의 충원인원 대신).
  추정 탈락자는 표에 보이는 예비번호(정수, '번')가 있을 때만 계산한다.
  휴대폰처럼 표가 넘치면 학년도 열을 왼쪽에 고정하고 옆으로 넘기라는 안내를 보인다(scroll-hint.tsx, 2026-11-02).
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
  OFFERING_MAPPING_PENDING_ORIGINAL_OBSERVATION_PRESERVED: "학과 연결 확인 중(원문 그대로)",
  NONNUMERIC_LITERAL_REQUIRES_SOURCE_REVIEW: "숫자가 아닌 원문 값 — 확인 중",
};
export const reasonText = (code: string | null) => (code ? (REASON[code] ?? code) : null);

/**
 * 값 칸. '확인 중' 꼬리표와 확인 사유는 보이지 않는다(2026-11-04 사용자 결정: 1페이지 '확인 중' 꼬리표 전부 제거).
 * 값은 발표 그대로, null 과 빈 문자열은 빈칸으로 표시한다. 실제 0과 자료의 status·reason 은 그대로 보존된다.
 * 숫자가 아닌 원문 값(pending_value_type)도 값만 보인다. '원문' 꼬리표는 붙이지 않는다(2026-11-08 사용자 결정: 꼬리표는 화면에 보이지 않음).
 */
function Value({ c, unitOverride }: { c: Cell; unitOverride?: string }) {
  if (c.v === null || c.v.trim() === "") return null;
  const unit = unitOverride ?? c.u;
  return (
    <>
      <b className="num">{c.v}</b>
      {unit && <small> {unit}</small>}
    </>
  );
}

/** 예비번호 한 칸: 서비스 자격이 확인된 값은 숫자('번')로만 보인다. 자격 확인 문구는 그리지 않는다(2026-11-05 사용자 결정) */
function RankValue({ c }: { c: Cell }) {
  return <Value c={rankDisplayModel(c).cell} />;
}

/** 발표 성적 한 칸: 통계 이름 + 값. 대상 집단은 쓰지 않고, 학생부 등급일 때만 기준을 붙인다(2026-10-28 사용자 결정) */
function Stat({ s }: { s: PublishedStat | undefined }) {
  // 값이 없으면 사유는 자료에 보존하고 화면 셀은 비운다.
  if (!s) return null;
  const asOf = asOfDate(s.cell.at);
  return (
    <>
      <small className="rs-stat">{s.label}</small> <Value c={s.cell} />
      {s.schoolRecord && <small className="rs-bs">학생부 등급</small>}
      {asOf && <small className="rs-bs">자료 기준 {asOf}</small>}
    </>
  );
}

export const latestOf = (rows: Row[]) => [...rows].sort((a, b) => b.y - a.y)[0];

/** 한 모집단위(같은 원래 PK 또는 미연결 관측 하나)의 학년도별 고정 표 */
export function YearTable({ rows: all, schoolName }: { rows: Row[]; schoolName: string }) {
  // 2027 모집행은 접힌 줄 요약에만 보이고, 이 표는 2024~2026 대학 발표 결과만 보인다(담당자 v9 §3)
  const rows = all.filter((r) => r.y < 2027);
  if (rows.length === 0)
    return <p className="rs-idnote">이 모집단위는 2027학년도 모집 정보만 있습니다. 2024~2026학년도 대학 발표 결과와 같은 모집단위인지 아직 확인되지 않아 함께 보이지 않습니다.</p>;
  const latest = latestOf(rows);
  const byYear = new Map<number, Row[]>();
  for (const r of rows) byYear.set(r.y, [...(byYear.get(r.y) ?? []), r]);
  const years = [...byYear.keys()].sort((a, b) => b - a);
  // 모집인원 단계·대상 집단 꼬리표는 보이지 않는다(2026-10-24 사용자 결정). 정리본 자료는 그대로 보존한다
  const pending = latest.pk === null;
  // 과거 입결 참고 관측: 서버가 이 모집단위에 실제로 붙인 행이 있을 때만 열을 보인다. 대학 발표값·합격 판정이 아니다
  const hasRef = rows.some((r) => (r.hr?.length ?? 0) > 0);
  // 표기 변형('같은 모집단위인지 확인 중') 안내는 보이지 않는다(2026-11-05 사용자 결정). 다른 이름의 행에는 발표명을 계속 적는다
  // 출처 링크는 보이지 않는다(2026-10-24 사용자 결정): 상당수가 어디가 내부 요청 주소라 직접 열면 오류 화면이 나온다
  return (
    <div className="rs-yt">
      {pending && <p className="rs-idnote">학과 연결을 확인하고 있는 발표입니다. 다른 학년도와 합치지 않고 원문 그대로 보입니다. 대학이 여러 학과를 묶어 한꺼번에 발표했을 수 있으니, 이 숫자를 이 학과만의 결과로 보지 마세요.</p>}
      <ScrollHint>
        <table className="tb rs-years">
          <thead>
            <tr>
              <th scope="col">학년도</th>
              <th scope="col" className="r">모집인원</th>
              <th scope="col" className="r">경쟁률</th>
              <th scope="col" className="r derived">추정 총 지원자</th>
              <th scope="col" className="r">최종 합격 예비번호</th>
              <th scope="col" className="r derived">추정 탈락자</th>
              <th scope="col" className="r">대학 발표 성적 ①</th>
              <th scope="col" className="r">대학 발표 성적 ②</th>
              {hasRef && <th scope="col" className="r derived">추정 상위 누백(참고)</th>}
            </tr>
          </thead>
          <tbody>
            {years.flatMap((y) =>
              byYear.get(y)!.map((r, i) => {
                const dv = derived(r);
                const ps = publishedStats(r);
                const renamedDept = r.d !== latest.d ? r.d : null;
                const otherName = r.n !== schoolName ? r.n : null;
                const historicalConditions = historicalConditionLabel(r, all);
                return (
                  <tr key={`${y}-${i}`}>
                    <th scope="row">
                      <span className="num">{y}</span>
                      {byYear.get(y)!.length > 1 && <small>같은 해 발표 {i + 1}</small>}
                      {otherName && <small>발표명 {otherName}</small>}
                      {renamedDept && <small>당시 {renamedDept}</small>}
                      {historicalConditions && <small>{historicalConditions}</small>}
                    </th>
                    <td className="r"><Value c={r.rc} /></td>
                    <td className="r"><Value c={r.cr.v === null || r.cr.v.trim() === "" ? r.cr : { ...r.cr, v: ratioText(r.cr.v) }} /></td>
                    <td className="r derived">
                      {dv.applicants === null ? null : <><b className="num">{dv.applicants}</b><small> 명</small></>}
                    </td>
                    <td className="r"><RankValue c={r.rk} /></td>
                    <td className="r derived">
                      {dv.dropped === null ? null : <><b className="num">{dv.dropped}</b><small> 명</small></>}
                    </td>
                    <td className="r"><Stat s={ps[0]} /></td>
                    <td className="r"><Stat s={ps[1]} /></td>
                    {hasRef && (
                      <td className="r derived">
                        {(r.hr ?? []).map((v, k) => (
                          <span key={k} className="rs-ref"><b className="num">{v}</b><small> %</small></span>
                        ))}
                      </td>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </ScrollHint>
      {hasRef && <p className="rs-idnote">추정 상위 누백(참고)은 그해 합격선을 전체 응시자 기준 상위 누적 백분위로 추정한 참고값입니다. 대학이 발표한 값이 아니고 운영 승인 전 자료이며, 합격 여부를 뜻하지 않습니다.</p>}
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
