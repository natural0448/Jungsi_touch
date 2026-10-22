"use client";

import { useActionState } from "react";
import { CATEGORY } from "@/components/offering-parts";
import { GRADE_RUMOR_NOTE, tipLine, tipsByOffering, tipTitle } from "@/lib/pro-tips";
import { OverallCard, PositionChart, SubjectsSheet } from "../../../../reports/me/report-view";
import { PrintButton } from "../../../../reports/me/print/print-button";
import { exportStudentReport, type PrintState } from "../../../actions";

/** 인쇄본 만들기 → 고정 판을 그대로 그린다. 워터마크(기관·교사 코드·인쇄 시각)는 화면 전체에 옅게, 인쇄·PDF 에도 찍힌다 */
export function PrintSheet({ fields }: { fields: Record<string, string> }) {
  const [state, action, pending] = useActionState<PrintState, FormData>(exportStudentReport, null);
  if (!state?.ok) {
    return (
      <form action={action} className="pr-tools">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button className="btn p" type="submit" disabled={pending}>{pending ? "만드는 중…" : "인쇄본 만들기"}</button>
        {state && !state.ok && <span className="err" role="alert">{state.error}</span>}
        <p className="pro-note">인쇄본을 만들면 학생 이름과 기관·교사 표시가 들어간 고정 판이 열립니다. 학생에게는 PDF나 종이로 전달해 주세요.</p>
      </form>
    );
  }
  const { snapshot, watermark: w } = state.data;
  const a = snapshot.report.overall;
  const text = `${w.organization_name} · ${w.teacher_code} · ${w.printed_at_seoul}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200'><text x='10' y='115' transform='rotate(-24 180 100)' font-family='sans-serif' font-size='13' fill='rgba(15,23,42,0.05)'>${text.replace(/[<>&'"]/g, "")}</text></svg>`;
  const shortlist = Object.entries(snapshot.report.shortlist ?? {}).filter(([, e]) => e.selected).map(([id]) => id);
  const cands = snapshot.report.candidates;
  const tips = tipsByOffering(state.data.counseling_reasons ?? []);
  const names = new Map([...(cands?.basic_university_groups.flatMap((g) => g.offerings) ?? []), ...(cands?.wildcards ?? [])].map((it) => [it.offering.offering_id, it.offering]));
  return (
    <>
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 2147483000, pointerEvents: "none", backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }} />
      <div className="pr-tools"><PrintButton /></div>
      <article className="pr-sheet">
        <header className="pr-hd">
          <div>
            <p className="pr-brand">에듀터치 정시터치 전문가용 · 상담 리포트</p>
            <h1>{w.student_name} 학생</h1>
          </div>
          <dl>
            <div><dt>리포트 판</dt><dd className="num">{snapshot.snapshot_version}</dd></div>
            <div><dt>인쇄</dt><dd className="num">{w.printed_at_seoul}</dd></div>
            <div><dt>기관</dt><dd>{w.organization_name}</dd></div>
          </dl>
        </header>
        <OverallCard a={a} />
        <h2>과목별 결과</h2>
        <SubjectsSheet a={a} />
        <PositionChart a={a} />
        <h2>담은 학교 <span className="num">{shortlist.length}</span></h2>
        {shortlist.length === 0 ? (
          <p className="rp-foot">담은 학교가 없습니다.</p>
        ) : (
          <table className="tb">
            <thead><tr><th scope="col">분류</th><th scope="col">대학·모집단위</th><th scope="col" className="r">환산점수</th><th scope="col" className="r">환산 유불리</th></tr></thead>
            <tbody>
              {shortlist.map((id) => {
                const o = names.get(id), x = snapshot.report.analyses?.[id];
                return (
                  <tr key={id}>
                    <td>{x ? CATEGORY[x.category].label : "판단 보류"}</td>
                    <th scope="row">{o ? `${o.university_name} ${o.department}` : id}</th>
                    <td className="r num">{x?.converted_score ?? "─"}</td>
                    <td className="r num">{x?.advantage ? `${x.advantage.delta_pp}%p` : "─"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {shortlist.some((id) => tips.has(id)) && (
          <>
            <h2>학교별 상담 메모</h2>
            {shortlist.map((id) => {
              const o = names.get(id), x = snapshot.report.analyses?.[id];
              const lines = (tips.get(id) ?? []).flatMap((r) => {
                const l = tipLine(r);
                return l && r.status === "ready" ? [l] : [];
              });
              if (!x || lines.length === 0) return null;
              return (
                <section key={id} className="pr-tip">
                  <h3>{o ? `${o.university_name} ${o.department}` : id} — {tipTitle(x.category)}</h3>
                  <ol>
                    {lines.map((l, i) => (
                      <li key={i}>
                        {l.text}
                        {l.caution && <b> {l.caution}</b>}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
            <p className="rp-foot">{GRADE_RUMOR_NOTE}</p>
          </>
        )}
        <footer className="pr-foot">
          지원가능성은 합격 확률이 아닙니다. 대학마다 만점과 반영 방식이 달라 다른 대학의 환산점수와 크기를 비교할 수 없습니다. 모의지원 서비스에서 모집군·지원 조건·모집인원 변경을 다시 확인하세요. 교사 코드 {w.teacher_code}
        </footer>
      </article>
    </>
  );
}
