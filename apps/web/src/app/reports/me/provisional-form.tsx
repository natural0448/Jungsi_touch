"use client";

import { useActionState, useRef, useState } from "react";
import { absoluteGrade, INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES, RAW_MAX, SECOND_LANGUAGE_SUBJECTS } from "@/lib/exam";
import { submitProvisional, type ProvisionalFormState, type ProvisionalValues } from "./provisional-actions";

/*
  수능 가채점 입력(2026-11-12 최종관리자 결정). 성적표 대신 채점표로 맞혀 본 원점수를 받는다.
  - 표 틀은 성적표 입력과 같다(한국사·국어·수학·영어·탐구 1·2·제2외국어/한문).
  - 영어·한국사·제2외국어/한문은 절대평가라 원점수로 등급이 확정된다 — 넣는 즉시 보여 준다(평가원 고정 구간).
    저장되는 등급은 서버가 같은 구간으로 다시 정한다. 화면 값은 입력을 돕는 표시다.
  - 국어·수학·탐구의 표준점수·등급은 수능 뒤 예상 등급컷 자료로 서버가 계산한다(지금은 '예상치' 자리만).
*/
const REQUIRED = ["inq1", "inq2", "korean", "math", "english", "history", "inq1_raw", "inq2_raw"] as const;

/** subject: 전문가용 — 확인 창·버튼에 크게 보일 학생 이름(잘못 고른 학생에 저장하지 않게, 성적표 양식과 같음) */
export function ProvisionalForm({ examLabel, subject }: { examLabel: string; subject?: string }) {
  const [state, action, pending] = useActionState<ProvisionalFormState, FormData>(submitProvisional, null);
  const d: ProvisionalValues = state?.values ?? {};
  const [raw, setRaw] = useState<Record<string, string>>(() => ({
    english: d.english?.toString() ?? "",
    history: d.history?.toString() ?? "",
    sl_raw: d.sl_raw?.toString() ?? "",
  }));
  const [sl, setSl] = useState(d.sl_subject ?? "");
  const [filled, setFilled] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef(false);
  const [review, setReview] = useState<{ rows: [string, string][]; problem: string | null } | null>(null);

  const val = (k: string) => String((formRef.current?.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
  const onInput = () => setFilled(REQUIRED.filter((k) => val(k) !== "").length);
  const none = <span className="sf-none" aria-label="해당 없음">─</span>;
  const est = <span className="sf-auto">예상치</span>;
  const fixed = (area: "english" | "history" | "second", k: string) => {
    const g = absoluteGrade(area, raw[k]);
    return <td className="calc">{g === null ? <span className="sf-auto">원점수 넣으면 표시</span> : <b className="sf-grade">{g}<small>등급</small></b>}</td>;
  };
  const rawCell = (name: string, max: number, ph: string, opts: { live?: boolean; disabled?: boolean; dv?: number } = {}) => (
    <td className="in">
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        placeholder={ph}
        aria-label={`${name} 원점수`}
        disabled={opts.disabled}
        {...(opts.live ? { value: raw[name] ?? "", onChange: (e) => setRaw({ ...raw, [name]: e.currentTarget.value }) } : { defaultValue: opts.dv })}
      />
      <small className="sf-max">/ {max}</small>
    </td>
  );

  const openReview = () => {
    sentRef.current = false;
    const n = (k: string) => (val(k) === "" ? NaN : Number(val(k)));
    const ok = (k: string, max: number) => Number.isInteger(n(k)) && n(k) >= 0 && n(k) <= max;
    let problem: string | null = null;
    if (REQUIRED.some((k) => val(k) === "")) problem = "국어·수학·영어·한국사·탐구 두 과목의 원점수와 탐구 과목을 모두 넣어 주세요.";
    else if (val("inq1") === val("inq2")) problem = "탐구 두 과목은 서로 달라야 합니다.";
    else if (!["korean", "math", "english"].every((k) => ok(k, 100))) problem = "국어·수학·영어 원점수는 0~100 사이 정수입니다.";
    else if (!["history", "inq1_raw", "inq2_raw"].every((k) => ok(k, 50))) problem = "한국사·탐구 원점수는 0~50 사이 정수입니다.";
    else if (sl && !ok("sl_raw", 50)) problem = "제2외국어/한문 원점수를 0~50 사이로 넣어 주세요. 보지 않았으면 과목을 '미응시'로 두세요.";
    const g = (area: "english" | "history" | "second", k: string) => (absoluteGrade(area, val(k)) ?? "─") + "등급";
    const choice = (k: string) => (val(k) ? ` (${val(k)})` : "");
    setReview({
      problem,
      rows: [
        [`국어${choice("korean_choice")}`, `${val("korean")}점`],
        [`수학${choice("math_choice")}`, `${val("math")}점`],
        ["영어", `${val("english")}점 · ${g("english", "english")}`],
        ["한국사", `${val("history")}점 · ${g("history", "history")}`],
        [`탐구 1 · ${val("inq1") || "미선택"}`, `${val("inq1_raw")}점`],
        [`탐구 2 · ${val("inq2") || "미선택"}`, `${val("inq2_raw")}점`],
        ["제2외국어/한문", sl ? `${sl} · ${val("sl_raw")}점 · ${g("second", "sl_raw")}` : "미응시"],
      ],
    });
    dialogRef.current?.showModal();
  };
  const confirmSave = () => {
    if (sentRef.current || pending) return;
    sentRef.current = true;
    if (confirmRef.current) confirmRef.current.value = "on";
    dialogRef.current?.close();
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} key={state?.attempt ?? 0} action={action} className="sf" noValidate onInput={onInput} onChange={onInput}>
      <header className="sf-hd">
        <div>
          <p className="sf-kicker">성적 입력 · 수능 가채점</p>
          <h2>{examLabel}</h2>
          <p>채점표로 맞혀 본 <b>원점수</b>를 과목마다 넣어 주세요. 국어·수학·탐구의 표준점수와 등급은 예상 등급컷으로 계산한 <b>예상치</b>로 보여 드립니다.</p>
        </div>
        <p className={`sf-prog${filled === REQUIRED.length ? " done" : ""}`} aria-live="polite">
          <span className="bar" aria-hidden="true"><i style={{ width: `${(filled / REQUIRED.length) * 100}%` }} /></span>
          {filled === REQUIRED.length ? "필수 칸을 모두 넣었습니다" : <>필수 {REQUIRED.length}칸 중 <b>{filled}</b>칸 입력</>}
        </p>
      </header>
      <p className="sf-banner">가채점 결과는 <b>추정</b>입니다. 성적표가 배부되면 실채점 성적을 다시 넣어야 정확한 분석이 됩니다. 가채점과 실채점은 입력 횟수를 따로 셉니다.</p>

      <p className="sf-swipe">표를 옆으로 밀면 수학 · 영어 · 탐구 칸이 이어집니다.</p>
      <div className="sf-sheet" role="group" aria-label={`${examLabel} 원점수 입력`}>
        <table>
          <colgroup>
            <col className="c-head" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <col key={i} className="c-main" />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="corner">구분</th>
              <th scope="col" rowSpan={2}>한국사<br />영역</th>
              <th scope="col" rowSpan={2}>국어<br />영역</th>
              <th scope="col" rowSpan={2}>수학<br />영역</th>
              <th scope="col" rowSpan={2}>영어<br />영역</th>
              <th scope="colgroup" colSpan={2}>탐구 영역</th>
              <th scope="col" rowSpan={2}>제2외국어<br />/한문 영역</th>
            </tr>
            <tr>
              <th scope="col" className="sub">과목 1</th>
              <th scope="col" className="sub">과목 2</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">선택과목</th>
              <td className="na">{none}</td>
              <td className="in">
                <select name="korean_choice" aria-label="국어 선택과목" defaultValue={d.korean_choice ?? ""}>
                  <option value="">선택 안 함</option>
                  {KOREAN_CHOICES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </td>
              <td className="in">
                <select name="math_choice" aria-label="수학 선택과목" defaultValue={d.math_choice ?? ""}>
                  <option value="">선택 안 함</option>
                  {MATH_CHOICES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </td>
              <td className="na">{none}</td>
              {(["inq1", "inq2"] as const).map((k, i) => (
                <td key={k} className="in">
                  <select name={k} aria-label={`탐구 과목 ${i + 1}`} defaultValue={d[k] ?? ""}>
                    <option value="" disabled>과목 고르기</option>
                    {INQUIRY_SUBJECTS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.subjects.map((s) => <option key={s}>{s}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </td>
              ))}
              <td className="in">
                <select
                  name="sl_subject"
                  aria-label="제2외국어/한문 과목"
                  defaultValue={d.sl_subject ?? ""}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setSl(v);
                    if (!v) setRaw((r) => ({ ...r, sl_raw: "" }));
                  }}
                >
                  <option value="">미응시</option>
                  {SECOND_LANGUAGE_SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </td>
            </tr>
            <tr className="key">
              <th scope="row">원점수<small>필수</small></th>
              {rawCell("history", RAW_MAX.history, "예: 45", { live: true })}
              {rawCell("korean", RAW_MAX.korean, "예: 88", { dv: d.korean })}
              {rawCell("math", RAW_MAX.math, "예: 84", { dv: d.math })}
              {rawCell("english", RAW_MAX.english, "예: 90", { live: true })}
              {rawCell("inq1_raw", RAW_MAX.inquiry, "예: 44", { dv: d.inq1_raw })}
              {rawCell("inq2_raw", RAW_MAX.inquiry, "예: 42", { dv: d.inq2_raw })}
              {rawCell("sl_raw", RAW_MAX.second, sl ? "예: 40" : "과목 먼저", { live: true, disabled: !sl })}
            </tr>
            <tr>
              <th scope="row">예상 표준점수</th>
              <td className="na">{none}</td>
              <td className="calc">{est}</td>
              <td className="calc">{est}</td>
              <td className="na">{none}</td>
              <td className="calc">{est}</td>
              <td className="calc">{est}</td>
              <td className="na">{none}</td>
            </tr>
            <tr>
              <th scope="row">등급<small className="sf-rowsub">절대평가는 확정 · 그 밖은 예상</small></th>
              {fixed("history", "history")}
              <td className="calc">{est}</td>
              <td className="calc">{est}</td>
              {fixed("english", "english")}
              <td className="calc">{est}</td>
              <td className="calc">{est}</td>
              {sl ? fixed("second", "sl_raw") : <td className="na">{none}</td>}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="sf-legend">
        <li><i className="k in" />넣는 칸 · 과목별 원점수(맞힌 점수). 국어·수학·영어 100점, 한국사·탐구·제2외국어/한문 50점 만점</li>
        <li><i className="k calc" />국어·수학·탐구의 예상 표준점수·등급은 수능 뒤 공개되는 예상 등급컷 자료로 계산합니다(성적표의 실제 값과 다를 수 있습니다).</li>
        <li><i className="k na" />영어·한국사·제2외국어/한문은 절대평가라 표준점수가 없고, 넣은 원점수로 등급이 바로 정해집니다(영어 90점·한국사 40점·제2외국어/한문 45점 이상이 1등급, 이후 영어 10점·나머지 5점마다 한 등급).</li>
      </ul>

      {state?.error && <p className="sf-error" role="alert">{state.error}</p>}

      <input ref={confirmRef} type="hidden" name="confirm" defaultValue="" />
      <div className="sf-foot">
        <p className="sf-confirm-note">저장하기 전에 넣은 점수를 한 번 더 보여 드립니다.</p>
        <div className="sf-acts">
          <button className="btn p" type="button" disabled={pending} onClick={openReview}>
            {pending ? "저장하는 중" : subject ? `${subject} 학생 가채점 저장하고 예상 위치 보기` : "가채점 저장하고 예상 위치 보기"}
          </button>
        </div>
      </div>
      <p className="sf-note">
        {subject
          ? "가채점은 이 학생의 가채점 단계 입력 1회를 사용합니다. 잘못 넣었으면 고객센터에 정정을 요청해 주세요(1회, 성적표 배부 전날까지)."
          : "가채점은 이 단계의 입력 1회를 사용합니다. 잘못 넣었으면 성적표 배부 전날까지 정정을 1회 요청할 수 있습니다."}
      </p>

      <dialog ref={dialogRef} className="sf-dialog" aria-labelledby="pf-dialog-h" onClose={() => setReview(null)}>
        {review && (
          <div className="sf-dialog-in">
            <h3 id="pf-dialog-h">{review.problem ? "입력을 확인해 주세요" : subject ? "이 학생의 원점수로 저장할까요?" : "이 원점수로 저장할까요?"}</h3>
            {subject && !review.problem && <p className="sf-dialog-subject">{subject}</p>}
            {review.problem ? (
              <p className="sf-dialog-problem">{review.problem}</p>
            ) : (
              <>
                <p><b>저장하면 가채점 단계의 입력 1회를 사용합니다.</b> 채점표와 한 칸씩 대조해 주세요.</p>
                <dl className="sf-dialog-rows">
                  {review.rows.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <div className="sf-dialog-acts">
              <button type="button" className="btn t" onClick={() => dialogRef.current?.close()} autoFocus>
                {review.problem ? "돌아가서 고치기" : "다시 확인하기"}
              </button>
              {!review.problem && <button type="button" className="btn p" onClick={confirmSave}>이대로 저장</button>}
            </div>
          </div>
        )}
      </dialog>
    </form>
  );
}
