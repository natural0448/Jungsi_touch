"use client";

import { useActionState } from "react";
import { INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES, SECOND_LANGUAGE_SUBJECTS } from "@/lib/exam";
import type { Range, StandardRange } from "@/lib/provisional-preview";
import { previewProvisional, type PreviewState } from "./provisional-preview-actions";

/*
  수능 가채점 예상 성적 미리보기(대표님 결정 2026-11-20). 저장하지 않는 조회다.
  - 국어·수학·탐구: 선택과목과 원점수로 예상 표준점수·백분위·등급 '범위'(입시기관 공개 예상표 기반, 기관마다 달라 범위로 보임)
  - 영어·한국사·제2외국어/한문: 원점수로 확정되는 절대평가 등급
  - 원점수가 낮아 근거가 부족한 점수는 등급만 보인다
  - 9월 모의평가 리포트·분석과 섞지 않는다(화면에 '수능 가채점 예상'으로 표시)
*/
const span = (r: Range | null, unit = "") => (r === null ? null : r.low === r.high ? `${r.low}${unit}` : `${r.low}~${r.high}${unit}`);
const std = (r: StandardRange | null) => (r === null ? null : r.low === r.high ? `${r.central}` : `${r.low}~${r.high} (가운데 ${r.central})`);

export function ProvisionalPreview() {
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewProvisional, null);
  const v = (state && !state.ok ? state.values : undefined) ?? {};
  const num = (name: string, max: number, ph: string) => (
    <label className="pv-in">
      <span>원점수</span>
      <input name={name} type="number" inputMode="numeric" min={0} max={max} placeholder={ph} defaultValue={v[name] ?? ""} required />
      <small>/ {max}</small>
    </label>
  );
  return (
    <section className="pv" aria-labelledby="pv-h">
      <header className="pv-hd">
        <p className="sf-kicker">수능 가채점 예상 · 저장하지 않는 조회</p>
        <h2 id="pv-h">원점수로 과목별 예상 성적 보기</h2>
        <p>
          채점표로 맞혀 본 <b>원점수</b>를 넣으면 과목별 <b>예상 표준점수·백분위·등급</b>을 범위로 보여 드립니다. 여러 입시기관이 공개한 예상 등급컷을 모아 만든
          추정이라 기관마다 차이가 나는 만큼 범위로 보입니다. 성적은 저장되지 않고 입력 횟수도 줄지 않습니다.
        </p>
      </header>
      <form action={action} className="pv-form">
        <fieldset>
          <legend>국어</legend>
          <select name="korean_choice" defaultValue={v.korean_choice ?? ""} required aria-label="국어 선택과목">
            <option value="" disabled>선택과목</option>
            {KOREAN_CHOICES.map((c) => <option key={c}>{c}</option>)}
          </select>
          {num("korean", 100, "예: 88")}
        </fieldset>
        <fieldset>
          <legend>수학</legend>
          <select name="math_choice" defaultValue={v.math_choice ?? ""} required aria-label="수학 선택과목">
            <option value="" disabled>선택과목</option>
            {MATH_CHOICES.map((c) => <option key={c}>{c}</option>)}
          </select>
          {num("math", 100, "예: 84")}
        </fieldset>
        <fieldset>
          <legend>영어</legend>
          {num("english", 100, "예: 90")}
        </fieldset>
        <fieldset>
          <legend>한국사</legend>
          {num("history", 50, "예: 45")}
        </fieldset>
        {(["inq1", "inq2"] as const).map((k, i) => (
          <fieldset key={k}>
            <legend>탐구 {i + 1}</legend>
            <select name={k} defaultValue={v[k] ?? ""} required aria-label={`탐구 과목 ${i + 1}`}>
              <option value="" disabled>과목 고르기</option>
              {INQUIRY_SUBJECTS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.subjects.map((s) => <option key={s}>{s}</option>)}
                </optgroup>
              ))}
            </select>
            {num(`${k}_raw`, 50, i === 0 ? "예: 44" : "예: 42")}
          </fieldset>
        ))}
        <fieldset>
          <legend>제2외국어/한문</legend>
          <select name="sl_subject" defaultValue={v.sl_subject ?? ""} aria-label="제2외국어/한문 과목">
            <option value="">미응시</option>
            {SECOND_LANGUAGE_SUBJECTS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="pv-in">
            <span>원점수</span>
            <input name="sl_raw" type="number" inputMode="numeric" min={0} max={50} placeholder="응시했을 때만" defaultValue={v.sl_raw ?? ""} />
            <small>/ 50</small>
          </label>
        </fieldset>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "계산하는 중…" : "예상 성적 보기"}</button>
      </form>

      {state && !state.ok && <p className="pv-err" role="alert">{state.message}</p>}
      {state?.ok && (
        <div className="pv-out" aria-live="polite">
          <table className="tb">
            <caption>수능 가채점 예상</caption>
            <thead>
              <tr><th scope="col">과목</th><th scope="col" className="r">원점수</th><th scope="col" className="r">예상 표준점수</th><th scope="col" className="r">예상 백분위</th><th scope="col" className="r">예상 등급</th></tr>
            </thead>
            <tbody>
              {state.lines.map((l) => {
                const absolute = l.result.standard === null && l.result.percentile === null && /^(영어|한국사|제2외국어)/.test(l.label);
                return (
                  <tr key={l.label}>
                    <th scope="row">{l.label}</th>
                    <td className="r">{l.raw}<small> / {l.max}</small></td>
                    <td className="r">{absolute ? <small className="rs-bs">절대평가</small> : std(l.result.standard) ?? <small className="rs-bs">자료 부족</small>}</td>
                    <td className="r">{absolute ? <small className="rs-bs">─</small> : span(l.result.percentile) ?? <small className="rs-bs">자료 부족</small>}</td>
                    <td className="r"><b>{span(l.result.grade, "등급")}</b>{absolute && <small> 확정</small>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="rp-note">
            국어·수학·탐구 값은 입시기관이 공개한 예상치를 모은 <b>추정 범위</b>이며, 실제 성적은 12월 성적표 배부 때 확정됩니다. 원점수가 낮아 예상 근거가 부족한
            점수는 등급만 보여 드립니다. 이 결과는 9월 모의평가 리포트와 분석에 반영되지 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}
