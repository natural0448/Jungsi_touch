import { AdvantageCell, reasonText, ScoreCell, StatusCell } from "@/components/offering-parts";
import type { OverallAnalysisDto } from "@/lib/dto";
import { DATA_KIND } from "@/lib/analysis-labels";
import { AREA_LABEL } from "@/lib/exam";
import type { PickedItem } from "@/lib/report-ops";

/* 2페이지 리포트의 전체 성적 부분 — 일반·유료 모두 보는 범위(REQ-02). 인쇄 화면도 같은 부품을 쓴다 */

const PENDING: Record<string, string> = {
  total_model_missing: "이 시험의 전체 누적 곡선이 아직 발행되지 않았습니다.",
  total_model_not_approved: "전체 누적 곡선을 검수하고 있습니다.",
  score_outside_domain: "입력한 총점이 곡선의 검증 범위 밖이라 위치를 계산하지 않았습니다.",
};

/** 전체 위치: 국·수·탐2 표준점수 합과 같은 비교집단에서 위에서 몇 % */
export function OverallCard({ a }: { a: OverallAnalysisDto }) {
  const o = a.overall;
  const interval = o.tie_interval_percent && typeof o.tie_interval_percent === "object" ? o.tie_interval_percent : null;
  const kind = o.data_kind ? DATA_KIND[o.data_kind] : null;
  return (
    <section className="rp-overall" aria-label="전체 성적 위치">
      <div className="n">
        <small>{a.score_basis}</small>
        <b className="num big">{a.total_standard_score}</b>
        <span className="unit">점</span>
      </div>
      <div className="n">
        <small>전체 응시자 기준 상위</small>
        {o.status !== "pending" && o.inclusive_top_percent ? (
          <>
            <b className="num big">{o.inclusive_top_percent}%</b>
            {o.status === "estimated" && <span className="est">{kind?.label ?? "추정"}</span>}
            {interval && (
              <p className="tie">
                동점 구간 상위 <b className="num">{interval.lower}%</b>~<b className="num">{interval.upper}%</b>. 나와 같은 총점까지 포함하면 {interval.upper}%, 빼면 {interval.lower}%입니다. 동점 구간은 합격 확률이나 오차 범위가 아닙니다.
              </p>
            )}
            {kind && <p className="tie">{kind.note}</p>}
          </>
        ) : (
          <>
            <b className="wait">계산 대기</b>
            <p className="tie">{(o.reason_code && PENDING[o.reason_code]) ?? "전체 위치를 계산할 자료가 아직 준비되지 않았습니다."} 총점과 과목 결과는 그대로 보입니다.</p>
          </>
        )}
      </div>
    </section>
  );
}

export function SubjectsTable({ a }: { a: OverallAnalysisDto }) {
  return (
    <div className="tblwrap">
      <table className="tb rp-subjects">
        <thead>
          <tr>
            <th scope="col">영역</th>
            <th scope="col">과목</th>
            <th scope="col" className="r">표준점수</th>
            <th scope="col" className="r">등급</th>
            <th scope="col" className="r">상위(동점 포함)</th>
            <th scope="col" className="r">상위(동점 제외)</th>
          </tr>
        </thead>
        <tbody>
          {a.subjects.map((s) => (
            <tr key={s.area}>
              <th scope="row">{AREA_LABEL[s.area] ?? s.area}</th>
              <td>
                {s.subject}
                {s.choice && <small> · {s.choice}</small>}
              </td>
              <td className="r num"><b>{s.standard_score}</b></td>
              <td className="r num">{s.grade ?? "─"}</td>
              <td className="r num">{s.top_percent_inclusive ? `${s.top_percent_inclusive}%` : "─"}</td>
              <td className="r num">{s.top_percent_exclusive ? `${s.top_percent_exclusive}%` : "─"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AbsoluteGrades({ a }: { a: OverallAnalysisDto }) {
  const g = a.absolute_grades;
  return (
    <p className="rp-abs">
      <span>영어 <b className="num">{g.영어 ? `${g.영어}등급` : "입력 안 함"}</b></span>
      <span>한국사 <b className="num">{g.한국사 ? `${g.한국사}등급` : "입력 안 함"}</b></span>
      <small>절대평가 과목은 총점과 전체 위치에 넣지 않습니다.</small>
    </p>
  );
}

/** 핵심 지원 학교 표(report.shortlist + report.analyses). 성적을 바꾼 뒤 아직 다시 확인하지 않은 항목은 표시한다 */
export function PickedTable({ items, print = false }: { items: PickedItem[]; print?: boolean }) {
  return (
    <div className="tblwrap">
      <table className="tb rp-short">
        <thead>
          <tr>
            <th scope="col">대학 · 모집단위</th>
            <th scope="col" className="r">내 환산점수</th>
            <th scope="col">지원가능성</th>
            <th scope="col" className="r">환산 유불리</th>
            {print && <th scope="col">판단 근거</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const a = s.assessment;
            const range = a?.decision_evidence?.expected_acceptance_range;
            return (
              <tr key={s.offering_id}>
                <th scope="row">
                  {s.offering ? s.offering.university_name : "카탈로그에 없는 모집단위"}
                  {s.offering && <small> {s.offering.department} · {s.offering.group}군</small>}
                  {s.entry.assessment_status === "needs_revalidation" && <span className="stale-tag">다시 확인 필요</span>}
                </th>
                <td className="r"><ScoreCell a={a} /></td>
                <td><StatusCell a={a} /></td>
                <td className="r"><AdvantageCell a={a} /></td>
                {print && (
                  <td className="why">
                    {!a ? "─" : a.status !== "ready" ? reasonText(a.reason_code) : range ? `판단 구간 ${range.lower}~${range.upper}${range.unit}` : "─"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
