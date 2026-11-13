"use client";

import { useActionState, useState } from "react";
import { CATEGORY } from "@/components/offering-parts";
import { REFERENCE_PERCENTILE_NOTE, REFERENCE_PERCENTILE_TITLE, referencePercentText } from "@/lib/reference-percentile";
import { GRADE_RUMOR_NOTE, tipLine, tipsByOffering, tipTitle } from "@/lib/pro-tips";
import { OverallCard, PositionChart, SubjectsSheet } from "../../../../reports/me/report-view";
import { PrintButton } from "../../../../reports/me/print/print-button";
import { exportStudentReport, type PrintState } from "../../../actions";

/** 인쇄본 만들기 → 고정 판을 그대로 그린다. 워터마크(기관·교사 코드·인쇄 시각)는 화면 전체에 옅게, 인쇄·PDF 에도 찍힌다 */
export function PrintSheet({ fields }: { fields: Record<string, string> }) {
  const [state, action, pending] = useActionState<PrintState, FormData>(exportStudentReport, null);
  // 인쇄에서 뺄 학교(2026-11-13: 담은 학교를 서버에서 빼는 기능이 생기기 전까지, 잘못 담은 학교가 학생에게 가지 않게).
  // 화면에서만 고르고 서버 기록은 바꾸지 않는다
  const [skip, setSkip] = useState<Set<string>>(() => new Set());
  if (!state?.ok) {
    return (
      <form action={action} className="pr-tools">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button className="btn p" type="submit" disabled={pending}>{pending ? "만드는 중…" : "인쇄본 만들기"}</button>
        {state && !state.ok && <span className="err" role="alert">{state.error}</span>}
        <p className="pro-note">인쇄본을 만들면 학생 이름과 기관·교사 표시가 들어간, 이 시점 내용으로 고정된 인쇄본이 열립니다. 학생에게는 PDF나 종이로 전달해 주세요. 계약 기간이 끝나면 이 화면을 열 수 없으니, 충원 기간(2월 중순까지)에 다시 볼 리포트는 PDF로 저장해 두세요.</p>
      </form>
    );
  }
  const { snapshot, watermark: w } = state.data;
  const a = snapshot.report.overall;
  const text = `${w.organization_name} · ${w.teacher_code} · ${w.printed_at_seoul}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200'><text x='10' y='115' transform='rotate(-24 180 100)' font-family='sans-serif' font-size='13' fill='rgba(15,23,42,0.05)'>${text.replace(/[<>&'"]/g, "")}</text></svg>`;
  const picked = Object.entries(snapshot.report.shortlist ?? {}).filter(([, e]) => e.selected).map(([id]) => id);
  const shortlist = picked.filter((id) => !skip.has(id));
  const cands = snapshot.report.candidates;
  const tips = tipsByOffering(state.data.counseling_reasons ?? []);
  const names = new Map([...(cands?.basic_university_groups.flatMap((g) => g.offerings) ?? []), ...(cands?.wildcards ?? []), ...(cands?.reference_university_groups?.flatMap((g) => g.offerings) ?? [])].map((it) => [it.offering.offering_id, it.offering]));
  // 담은 학교 중 참고 누백(추정)이 하나라도 있을 때만 칸을 더한다(저장 뒤 승인이 바뀌면 서버가 칸을 뺀다)
  const refOf = (id: string) => referencePercentText(snapshot.report.analyses?.[id]?.reference_percentile);
  const showRef = shortlist.some((id) => refOf(id));
  return (
    <>
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 2147483000, pointerEvents: "none", backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }} />
      <div className="pr-tools">
        <PrintButton />
        {picked.length > 0 && (
          <fieldset className="pr-pick">
            <legend>인쇄에 넣을 학교 <small>체크를 풀면 이 인쇄본에서만 빠집니다(담은 기록은 그대로)</small></legend>
            {picked.map((id) => {
              const o = names.get(id);
              return (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={!skip.has(id)}
                    onChange={(e) => {
                      const next = new Set(skip);
                      if (e.currentTarget.checked) next.delete(id);
                      else next.add(id);
                      setSkip(next);
                    }}
                  />
                  {o ? `${o.university_name} ${o.department}` : id}
                </label>
              );
            })}
          </fieldset>
        )}
      </div>
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
        <OverallCard a={a} fold={false} />
        <h2>과목별 결과</h2>
        <SubjectsSheet a={a} second={false} />
        <PositionChart a={a} />
        <h2>담은 학교 <span className="num">{shortlist.length}</span></h2>
        {shortlist.length === 0 ? (
          <p className="rp-foot">담은 학교가 없습니다.</p>
        ) : (
          <table className="tb">
            <thead><tr><th scope="col">분류</th><th scope="col">대학·모집단위</th><th scope="col" className="r">환산점수</th><th scope="col" className="r">환산 유불리</th>{showRef && <th scope="col" className="r">{REFERENCE_PERCENTILE_TITLE}</th>}</tr></thead>
            <tbody>
              {shortlist.map((id) => {
                const o = names.get(id), x = snapshot.report.analyses?.[id];
                return (
                  <tr key={id}>
                    <td>{x ? CATEGORY[x.category].label : "판단 보류"}</td>
                    <th scope="row">{o ? `${o.university_name} ${o.department}` : id}</th>
                    <td className="r num">{x?.converted_score ?? "─"}</td>
                    <td className="r num">{x?.advantage ? `${x.advantage.delta_pp}%p` : "─"}</td>
                    {showRef && <td className="r num">{refOf(id) ? `상위 ${refOf(id)}%` : "─"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {showRef && <p className="rp-foot">{REFERENCE_PERCENTILE_TITLE}: {REFERENCE_PERCENTILE_NOTE}</p>}
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
