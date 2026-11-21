"use client";

import { useActionState, useRef, useState } from "react";
import { absoluteGrade, INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES, RAW_MAX, SECOND_LANGUAGE_SUBJECTS } from "@/lib/exam";
import { checkSecondLanguage, SL_NONE, slHint } from "@/lib/second-language";
import { submitProvisional, type ProvisionalFormState, type ProvisionalValues } from "./provisional-actions";

/*
  수능 가채점 입력(2026-11-12 최종관리자 결정). 성적표 대신 채점표로 맞혀 본 원점수를 받는다.
  - 표 틀은 성적표 입력과 같다(한국사·국어·수학·영어·탐구 1·2·제2외국어/한문).
  - 영어·한국사·제2외국어/한문은 절대평가라 원점수로 등급이 확정된다 — 넣는 즉시 보여 준다(평가원 고정 구간).
    저장되는 등급은 서버가 같은 구간으로 다시 정한다. 화면 값은 입력을 돕는 표시다.
  - 국어·수학·탐구의 표준점수·등급은 저장 뒤 서버가 가채점 변환표로 추정한 범위로 보여 준다(입력 칸에는 '예상치' 자리만).
  - 국어·수학 선택과목은 필수다(선택과목마다 변환표가 다르다, 서버 dep_r19c).
  - 제2외국어/한문도 필수다(2026-11-22 대표님 결정). 기본값은 '선택하세요'(빈 값)이고, 응시하지 않았으면 '미응시'를 직접 고른다.
    과목을 골랐으면 원점수가 있어야 저장된다. 검사는 lib/second-language.ts 를 화면·서버 액션이 같이 쓴다.
  - 저장은 가채점 단계의 입력 1회를 쓴다(2026-11-23 전환). 정정 승인 뒤에는 같은 리포트의 새 판으로 저장한다(update).
*/
const REQUIRED = ["korean_choice", "math_choice", "inq1", "inq2", "sl_subject", "korean", "math", "english", "history", "inq1_raw", "inq2_raw"] as const;

/**
 * 개인용 2페이지(기본: 본인 계정에 저장)와 전문가용 학생 화면이 같이 쓴다. 전문가용은 submit 에 학생 저장 동작을,
 * hidden 에 기관·학생·입력 판을, subject 에 학생 이름을 넘긴다(확인 창에 크게 보인다).
 * idem: 이 화면의 요청 키(두 번 눌러도 한 번만 저장)
 */
export function ProvisionalForm({ examLabel, idem, defaults = {}, update, submit = submitProvisional, hidden, subject }: {
  examLabel: string;
  idem: string;
  defaults?: ProvisionalValues;
  update?: { reportId: string; version: number };
  submit?: (prev: ProvisionalFormState, fd: FormData) => Promise<ProvisionalFormState>;
  hidden?: Record<string, string>;
  subject?: string;
}) {
  const [state, action, pending] = useActionState<ProvisionalFormState, FormData>(submit, null);
  const d: ProvisionalValues = state?.values ?? defaults;
  const [raw, setRaw] = useState<Record<string, string>>(() => ({
    english: d.english?.toString() ?? "",
    history: d.history?.toString() ?? "",
    sl_raw: d.sl_raw?.toString() ?? "",
  }));
  const [sl, setSl] = useState(d.sl_subject ?? "");
  // 과목을 고른 경우만 원점수 칸이 열린다('미응시'·미선택은 닫힘)
  const taken = sl !== "" && sl !== SL_NONE;
  // 제2외국어/한문 칸 옆 짧은 안내. 서버 액션이 돌려준 칸 표시가 기본이고, 같은 시도 안에서는 확인 창 검사·다시 고르기가 덮어쓴다
  const attempt = state?.attempt ?? 0;
  const [slLocal, setSlLocal] = useState<{ at: number; field: string | null } | null>(null);
  const slField = slLocal && slLocal.at === attempt ? slLocal.field : (state?.field ?? null);
  const setSlField = (field: string | null) => setSlLocal({ at: attempt, field });
  const hint = slHint(slField, "raw");
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
  const rawCell = (name: string, max: number, ph: string, opts: { live?: boolean; disabled?: boolean; dv?: number; bad?: boolean; hint?: string | null } = {}) => (
    <td className={`in${opts.bad ? " bad" : ""}`}>
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        placeholder={ph}
        aria-label={`${name} 원점수`}
        aria-describedby={opts.hint ? `pf-${name}-hint` : undefined}
        disabled={opts.disabled}
        {...(opts.live
          ? {
              value: raw[name] ?? "",
              onChange: (e) => {
                const v = e.currentTarget.value;
                setRaw({ ...raw, [name]: v });
                if (opts.bad && v.trim() !== "") setSlField(null);
              },
            }
          : { defaultValue: opts.dv })}
      />
      <small className="sf-max">/ {max}</small>
      {opts.hint && <small id={`pf-${name}-hint`} className="sf-hint">{opts.hint}</small>}
    </td>
  );

  const openReview = () => {
    sentRef.current = false;
    const n = (k: string) => (val(k) === "" ? NaN : Number(val(k)));
    const ok = (k: string, max: number) => Number.isInteger(n(k)) && n(k) >= 0 && n(k) <= max;
    let problem: string | null = null;
    if (val("korean_choice") === "" || val("math_choice") === "") problem = "국어·수학 선택과목을 골라 주세요. 선택과목마다 예상 점수가 다릅니다.";
    else if (REQUIRED.some((k) => k !== "sl_subject" && val(k) === "")) problem = "국어·수학·영어·한국사·탐구 두 과목의 원점수와 탐구 과목을 모두 넣어 주세요.";
    else if (val("inq1") === val("inq2")) problem = "탐구 두 과목은 서로 달라야 합니다.";
    else if (!["korean", "math", "english"].every((k) => ok(k, 100))) problem = "국어·수학·영어 원점수는 0~100 사이 정수입니다.";
    else if (!["history", "inq1_raw", "inq2_raw"].every((k) => ok(k, 50))) problem = "한국사·탐구 원점수는 0~50 사이 정수입니다.";
    // 제2외국어/한문: 서버 액션과 같은 검사(미선택·과목만 고르고 원점수 없음). 칸 옆 안내도 같이 띄운다
    const slCheck = checkSecondLanguage(val("sl_subject"), n("sl_raw"), "raw");
    setSlField(slCheck.ok ? null : slCheck.field);
    if (!problem && !slCheck.ok) problem = slCheck.error;
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
        ["제2외국어/한문", taken ? `${sl} · ${val("sl_raw")}점 · ${g("second", "sl_raw")}` : sl === SL_NONE ? "미응시" : "선택 안 함"],
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
          <p>채점표로 맞혀 본 <b>원점수</b>를 과목마다 넣어 주세요. 저장하면 국어·수학·탐구의 표준점수·백분위·등급을 가채점 변환표로 추정한 <b>범위</b>로 보여 드립니다.</p>
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
              <th scope="row">선택과목<small>필수</small></th>
              <td className="na">{none}</td>
              <td className="in">
                <select name="korean_choice" aria-label="국어 선택과목" defaultValue={d.korean_choice ?? ""}>
                  <option value="" disabled>과목 고르기</option>
                  {KOREAN_CHOICES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </td>
              <td className="in">
                <select name="math_choice" aria-label="수학 선택과목" defaultValue={d.math_choice ?? ""}>
                  <option value="" disabled>과목 고르기</option>
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
              <td className={`in${slField === "sl_subject" ? " bad" : ""}`}>
                <select
                  name="sl_subject"
                  aria-label="제2외국어/한문 과목"
                  aria-describedby={slField === "sl_subject" ? "pf-sl-hint" : undefined}
                  required
                  defaultValue={d.sl_subject ?? ""}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setSl(v);
                    if (!v || v === SL_NONE) setRaw((r) => ({ ...r, sl_raw: "" }));
                    // 미응시를 골랐으면 안내를 거두고, 과목을 골랐으면 원점수 칸 안내로 넘긴다
                    if (slField) setSlField(v === SL_NONE ? null : v ? (raw.sl_raw === "" ? "sl_value" : null) : "sl_subject");
                  }}
                >
                  <option value="" disabled>선택하세요</option>
                  <option value={SL_NONE}>미응시</option>
                  {SECOND_LANGUAGE_SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                </select>
                {slField === "sl_subject" && hint && <small id="pf-sl-hint" className="sf-hint">{hint}</small>}
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
              {rawCell("sl_raw", RAW_MAX.second, taken ? "예: 40" : sl === SL_NONE ? "미응시" : "과목 먼저", { live: true, disabled: !taken, bad: slField === "sl_value", hint: slField === "sl_value" ? hint : null })}
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
              {taken ? fixed("second", "sl_raw") : <td className="na">{none}</td>}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="sf-legend">
        <li><i className="k in" />넣는 칸 · 과목별 원점수(맞힌 점수). 국어·수학·영어 100점, 한국사·탐구·제2외국어/한문 50점 만점. 제2외국어/한문은 응시하지 않았어도 &apos;미응시&apos;를 꼭 골라 주세요(일부 대학 판정이 달라집니다).</li>
        <li><i className="k calc" />국어·수학·탐구의 예상 표준점수·백분위·등급은 저장하면 정시터치 가채점 변환표로 추정한 범위로 보여 드립니다(성적표의 실제 값과 다를 수 있습니다).</li>
        <li><i className="k na" />영어·한국사·제2외국어/한문은 절대평가라 표준점수가 없고, 넣은 원점수로 등급이 바로 정해집니다(영어 90점·한국사 40점·제2외국어/한문 45점 이상이 1등급, 이후 영어 10점·나머지 5점마다 한 등급).</li>
      </ul>

      {state?.error && <p className="sf-error" role="alert">{state.error}</p>}

      <input ref={confirmRef} type="hidden" name="confirm" defaultValue="" />
      <input type="hidden" name="idem" value={idem} />
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {update && (
        <>
          <input type="hidden" name="report_id" value={update.reportId} />
          <input type="hidden" name="report_version" value={update.version} />
        </>
      )}
      <div className="sf-foot">
        <p className="sf-confirm-note">저장하기 전에 넣은 점수를 한 번 더 보여 드립니다.</p>
        <div className="sf-acts">
          <button className="btn p" type="button" disabled={pending} onClick={openReview}>
            {pending ? "저장하는 중" : subject ? `${subject} 학생 가채점 저장하고 예상 위치 보기` : "가채점 저장하고 예상 위치 보기"}
          </button>
        </div>
      </div>
      <p className="sf-note">
        가채점은 이 단계의 입력 1회를 사용합니다(9월 모의평가·실채점과 따로 셉니다). 잘못 넣었으면 성적표 배부 전날까지 정정을 1회 요청할 수 있습니다.
      </p>

      <dialog ref={dialogRef} className="sf-dialog" aria-labelledby="pf-dialog-h" onClose={() => setReview(null)}>
        {review && (
          <div className="sf-dialog-in">
            <h3 id="pf-dialog-h">{review.problem ? "입력을 확인해 주세요" : subject ? "이 학생의 원점수로 저장할까요?" : "이 원점수로 저장할까요?"}</h3>
            {review.problem ? (
              <p className="sf-dialog-problem">{review.problem}</p>
            ) : (
              <>
                {subject && <p className="sf-dialog-subject">{subject}</p>}
                <p><b>저장하면 {subject ? "이 학생의 " : ""}가채점 단계의 입력 1회를 사용합니다.</b> 채점표와 한 칸씩 대조해 주세요.</p>
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
