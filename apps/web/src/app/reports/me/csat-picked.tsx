import Link from "@/components/link";
import { CsatAdvantage, CsatBadge, CsatScore, csatGainView } from "@/components/csat-badge";
import { heldBand } from "@/lib/csat-held";
import { csatExceptionView, exceptionCls } from "@/lib/csat-exceptions";
import type { OverallAnalysisDto, ReferenceBandDto } from "@/lib/dto";
import type { PickedItem } from "@/lib/shortlist";
import { POSITION_NONE_DESC, POSITION_NONE_LABEL } from "@/lib/position-note";
import { page } from "@/lib/routes";

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

export function CsatPickedTable({ items, bands, a, print = false }: { items: PickedItem[]; bands: Record<string, ReferenceBandDto>; a: OverallAnalysisDto; print?: boolean }) {
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
                    const band = heldBand(it.offering_id, bands[it.offering_id]);
                    const ex = band ? null : csatExceptionView(it.offering_id, a);
                    const rank = rankText(band);
                    return (
                      <tr key={it.offering_id}>
                        <th scope="row">
                          <b>{o.university_name}</b> {o.department}
                          {o.track && <small> · {o.track}</small>}
                        </th>
                        <td>
                          {band ? <CsatBadge band={band} /> : ex ? <span className={`st ${exceptionCls(ex)}`} title={ex.desc}>{ex.label}</span> : <span className="st check" title={POSITION_NONE_DESC}>{POSITION_NONE_LABEL}</span>}
                        </td>
                        <td className="r">{band?.school_score ? <CsatScore band={band} /> : "─"}</td>
                        <td className="r num">{rank ?? "─"}</td>
                        <td className="r">{csatGainView(band) ? <CsatAdvantage band={band} /> : "─"}</td>
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
        모두 가채점 원점수로 추정한 값입니다. 내 환산점수는 이 대학 방식 점수(대학마다 만점·반영 방식이 달라 학교끼리 크기를 비교하지 않습니다),
        대학 안 내 위치는 그 점수로 본 전체 응시자 중 위치(같은 점수 포함), 환산 유불리는 국·수·탐2 합으로 본 전체 위치에서 대학 안 위치를 뺀 값(+면 유리)입니다.
        지원가능성은 합격 확률이 아닙니다.
      </p>
    </div>
  );
}
