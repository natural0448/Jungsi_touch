import { csatC1Score, csatNoJudgmentView } from "@/lib/csat-conditions";
import { holdIneligibleBand, INELIGIBLE_CANDIDATE_NOTICE, isIneligibleAssessment } from "@/lib/candidate-eligibility";
import Link from "@/components/link";
import { CsatAdvantage, CsatBadge, CsatScore, csatGainView } from "@/components/csat-badge";
import { heldBand } from "@/lib/csat-held";
import { personalCsatPoint, personalCsatScore } from "@/lib/personal-csat-point";
import { csatExceptionView, exceptionCls } from "@/lib/csat-exceptions";
import { isCsatFinalOverall, isProvisionalOverall, type CsatMinimum, type OverallAnalysisDto, type ReferenceBandDto } from "@/lib/dto";
import type { PickedItem } from "@/lib/shortlist";
import { POSITION_NONE_DESC, POSITION_NONE_LABEL } from "@/lib/position-note";
import { page } from "@/lib/routes";
import type { ReactNode } from "react";
import { CsatDetail } from "@/app/admissions/possibilities/parts";

/*
  리포트 탭(2026-11-23 대표님 결정, 5번째 탭)·인쇄본의 '담은 학교' 표 — 수능 가채점 리포트.
  4페이지와 같은 값(서버 dep_r29~r34 판정 행: 7단계·내 환산점수·대학 안 내 위치·환산 유불리)을 군별로 모아 보인다.
  판정 보류 모집단위(csat-held)·예외 17곳(csat-exceptions)은 4페이지와 같은 이름으로. 서버 전용 모듈을 import 하지 않는다.
*/
const GROUPS = ["가", "나", "다"] as const;

function rankText(b?: ReferenceBandDto | null): string | null {
  const r = b && !b.held ? b.school_rank : null;
  if (!r) return null;
  const main = r.central ?? r.best ?? r.worst;
  if (!main) return null;
  const range = r.best && r.worst && r.best !== r.worst ? `${r.best}~${r.worst}` : null;
  return r.central && range ? `상위 ${main}% (${range})` : range ? `상위 ${range}%` : `상위 ${main}%`;
}

export function CsatPickedTable({ items, bands, a, print = false, min = {}, single = false }: { items: PickedItem[]; bands: Record<string, ReferenceBandDto>; a: OverallAnalysisDto; print?: boolean; min?: Record<string, CsatMinimum>; single?: boolean }) {
  const p4 = page("PAGE-03").path;
  return (
    <div className="rp-cp">
      {GROUPS.map((g) => {
        const rows = items.filter((it) => (it.offering?.group ?? "") === g);
        if (!rows.length) return null;
        return (
          <section key={g} className="rp-cp-g" aria-label={`${g}군 담은 학교`}>
            <h3>{g}군 <span className="num">{rows.length}</span></h3>
            <div className="rp-cp-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">대학 · 학과</th>
                    <th scope="col">지원가능성</th>
                    <th scope="col">내 환산점수</th>
                    <th scope="col">대학 안 내 위치</th>
                    <th scope="col">환산 유불리</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => {
                    const o = it.offering!;
                    const ineligible = isIneligibleAssessment(it.assessment);
                    const raw = holdIneligibleBand(heldBand(it.offering_id, bands[it.offering_id]), ineligible);
                    const point = single && isProvisionalOverall(a);
                    const band = point ? personalCsatPoint(raw) : raw;
                    const ex = band || ineligible ? null : csatExceptionView(it.offering_id, a);
                    const rank = rankText(band);
                    const c1Base = band ? null : csatC1Score(it.offering_id, a);
                    const c1 = point ? personalCsatScore(c1Base) : c1Base;
                    const nj = ineligible ? INELIGIBLE_CANDIDATE_NOTICE : band || ex ? null : csatNoJudgmentView(it.offering_id, a, min[it.offering_id]);
                    return (
                      <tr key={it.offering_id}>
                        <th scope="row">
                          <b>{o.university_name}</b> {o.department}
                          {o.track && <small> · {o.track}</small>}
                        </th>
                        <td>
                          {band && !ineligible ? <CsatBadge band={band} id={it.offering_id} /> : ex ? <span className={`st ${exceptionCls(ex)}`} title={ex.desc}>{ex.label}</span> : <span className={`st ${nj?.cls ?? "check"}`} title={nj?.desc ?? POSITION_NONE_DESC}>{nj?.label ?? POSITION_NONE_LABEL}</span>}
                        </td>
                        <td className="r">{band?.school_score ? <CsatScore band={band} /> : c1 ? <span className="score" title={c1.label}><b className="num">{c1.central ?? `${c1.low}~${c1.high}`}</b></span> : "—"}</td>
                        <td className="r num">{rank ?? "—"}</td>
                        <td className="r">{csatGainView(band) ? <CsatAdvantage band={band} /> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {items.some((it) => !it.offering) && <p className="rp-foot">담은 학교 가운데 지금 목록에서 찾을 수 없는 곳이 있습니다. 모집단위가 바뀌었을 수 있으니 4페이지에서 다시 확인해 주세요.</p>}
      {!print && (
        <div className="acts">
          <Link className="btn" href={p4}>{page("PAGE-03").label}에서 고치기</Link>
        </div>
      )}
      <p className="rp-foot">
        {isCsatFinalOverall(a) ? "모두 성적표(실채점) 성적으로 계산한 값입니다. " : "모두 가채점 원점수로 추정한 값입니다. "}내 환산점수는 이 대학 방식 점수(대학마다 만점·반영 방식이 달라 학교끼리 크기를 비교하지 않습니다),
        대학 안 내 위치는 그 점수로 본 전체 응시자 중 위치(같은 점수 포함), 환산 유불리는 국·수·탐2 합으로 본 전체 위치에서 대학 안 위치를 뺀 값(+면 유리)입니다.
        지원가능성은 합격 확률이 아닙니다.
      </p>
    </div>
  );
}

/** 담은 학교 하나의 가채점 상세 카드(4페이지 펼친 상세와 같음, 담기 단추 없음) */
export function csatDetailOf(it: PickedItem, bands: Record<string, ReferenceBandDto>, a: OverallAnalysisDto, min: Record<string, CsatMinimum> = {}, single = false): ReactNode {
  if (!it.offering) return null;
  const ineligible = isIneligibleAssessment(it.assessment);
  const raw = holdIneligibleBand(heldBand(it.offering_id, bands[it.offering_id]), ineligible);
  const point = single && isProvisionalOverall(a);
  const band = (point ? personalCsatPoint(raw) : raw) ?? null;
  const c1 = csatC1Score(it.offering_id, a);
  return <CsatDetail o={it.offering} band={band} exception={ineligible ? null : csatExceptionView(it.offering_id, a)} noJudgment={ineligible ? INELIGIBLE_CANDIDATE_NOTICE : csatNoJudgmentView(it.offering_id, a, min[it.offering_id])} c1={point ? personalCsatScore(c1) : c1} extras={null} picked acts={false} final={isCsatFinalOverall(a)} />;
}

/**
 * 담은 학교별 상세(2026-11-24 대표님 지적: 리포트·인쇄본에 학과 상세가 없었다). 표 아래에 학교마다 4페이지와 같은 상세 카드를 붙인다.
 * 인쇄본(print)은 접지 않고 모두 펼치고, 리포트 탭은 학교마다 접어 둔다. wrap 이 있으면 카드를 감싼다(인쇄본: 모집 정보·연도별 입결)
 */
export function CsatPickedDetails({ items, bands, a, print = false, wrap, min = {}, single = false }: { items: PickedItem[]; bands: Record<string, ReferenceBandDto>; a: OverallAnalysisDto; print?: boolean; wrap?: (it: PickedItem, detail: ReactNode) => ReactNode; min?: Record<string, CsatMinimum>; single?: boolean }) {
  const rows = items.filter((it) => it.offering);
  if (!rows.length) return null;
  return (
    <div className="rp-cpd">
      <h3>학교별 상세</h3>
      {rows.map((it) => {
        const o = it.offering!;
        const title = <><b>{o.university_name}</b> {o.department}{o.track && <small> · {o.track}</small>}{o.group && <small> · {o.group}군</small>}</>;
        const body = wrap ? wrap(it, csatDetailOf(it, bands, a, min, single)) : <div className="ps rp-ps"><div className="detail">{csatDetailOf(it, bands, a, min, single)}</div></div>;
        return print ? (
          <section key={it.offering_id} className="rp-cpd-i" aria-label={`${o.university_name} ${o.department} 상세`}>
            <h4>{title}</h4>
            {body}
          </section>
        ) : (
          <details key={it.offering_id} className="rp-cpd-i">
            <summary>{title}</summary>
            {body}
          </details>
        );
      })}
    </div>
  );
}
