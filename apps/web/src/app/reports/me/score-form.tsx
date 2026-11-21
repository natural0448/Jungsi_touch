"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES, SECOND_LANGUAGE_SUBJECTS } from "@/lib/exam";
import { checkSecondLanguage, SL_NONE, slHint } from "@/lib/second-language";
import { submitScores, type ScoreFormState } from "./actions";

export interface ScoreDefaults {
  korean_choice?: string;
  korean?: number;
  math_choice?: string;
  math?: number;
  inq1?: string;
  inq1_score?: number;
  inq2?: string;
  inq2_score?: number;
  english?: number;
  history?: number;
  /** 제2외국어/한문 과목. 빈 값은 미응시 */
  sl_subject?: string;
  sl_grade?: number;
}

const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// 저장에 꼭 필요한 칸: 탐구 두 과목과 국어·수학·탐구 표준점수. 진행 표시용이며 검사는 서버가 한다
const REQUIRED = ["inq1", "inq2", "korean", "math", "inq1_score", "inq2_score"] as const;
const filledOf = (get: (k: (typeof REQUIRED)[number]) => unknown) =>
  REQUIRED.filter((k) => {
    const v = get(k);
    return v !== undefined && v !== null && String(v).trim() !== "";
  }).length;

/**
 * 성적 입력 — 수능 성적표와 같은 가로 표(영역 순서: 한국사 · 국어 · 수학 · 영어 · 탐구).
 * 행은 성적표처럼 선택과목 · 표준점수 · 백분위 · 등급이다.
 * 넣는 칸은 국어·수학·탐구 표준점수와 영어·한국사 등급뿐이다. 국어·수학·탐구의 백분위·등급은
 * 서버 엔진이 시험 자료로 계산하므로 칸만 두고 비워 둔다(화면이 계산하지 않는다).
 * 새로 저장할 때마다 새 성적 프로필이 생기고, 이전 성적은 고치지 않는다.
 * 제2외국어/한문(2026-11-12 최종관리자 결정)은 성적표처럼 맨 끝 칸에 과목과 등급만 받는다. 2026-11-22 대표님 결정으로 필수 선택:
 * 기본값은 '선택하세요'이고 응시하지 않았으면 '미응시'를 직접 고른다. 과목을 골랐으면 등급이 있어야 저장된다.
 * 전문가용(submit 이 있을 때)은 서버 학생 성적 저장이 아직 이 칸을 받지 않아 보이지 않는다.
 */
export function ScoreForm({
  examLabel,
  idem,
  defaults,
  update,
  submit,
  hidden,
  subject,
  kicker = "성적 입력",
  banner,
}: {
  examLabel: string;
  /** 머리 작은 글씨(예: '성적 입력 · 수능 실채점') */
  kicker?: string;
  /** 표 위 안내 한 줄(수능 실채점 등) */
  banner?: string;
  idem: string;
  defaults: ScoreDefaults;
  update?: { reportId: string; version: number };
  /** 전문가용: 학생 성적 저장 서버 동작(없으면 개인용 submitScores) */
  submit?: (prev: ScoreFormState, fd: FormData) => Promise<ScoreFormState>;
  /** 전문가용: 기관·학생·입력 판 등 숨은 칸 */
  hidden?: Record<string, string>;
  /** 전문가용: 확인 창·버튼에 크게 보일 학생 이름(잘못 고른 학생에 저장하지 않게) */
  subject?: string;
}) {
  const [state, action, pending] = useActionState<ScoreFormState, FormData>(submit ?? submitScores, null);
  // 실패하면 넣었던 값으로 양식을 새로 그린다(React 는 서버 액션 뒤 양식을 비운다)
  const d = state?.values ?? defaults;
  const missing = Boolean(state?.error) && !state?.field;
  const need = (v: unknown) => (missing && (v === undefined || v === "") ? " bad" : "");
  const auto = <span className="sf-auto">저장 후 계산</span>;
  const none = <span className="sf-none" aria-label="해당 없음">─</span>;
  const [filled, setFilled] = useState(() => filledOf((k) => d[k]));
  const onInput = (e: FormEvent<HTMLFormElement>) => {
    const f = e.currentTarget.elements;
    setFilled(filledOf((k) => (f.namedItem(k) as HTMLInputElement | HTMLSelectElement | null)?.value));
  };
  const done = filled === REQUIRED.length;
  const second = !submit;
  const [slSubject, setSlSubject] = useState(d.sl_subject ?? "");
  // 제2외국어/한문 필수 선택(2026-11-22 대표님 결정): 빈 값은 '고르지 않음', 미응시는 직접 고른다. 과목을 골랐으면 등급 필수
  const slTaken = slSubject !== "" && slSubject !== SL_NONE;
  const attempt = state?.attempt ?? 0;
  const [slLocal, setSlLocal] = useState<{ at: number; field: string | null } | null>(null);
  const slField = slLocal && slLocal.at === attempt ? slLocal.field : (state?.field ?? null);
  const setSlField = (field: string | null) => setSlLocal({ at: attempt, field });
  const slMsg = slHint(slField, "grade");

  // 저장 전 확인 창. 저장한 성적은 고칠 수 없고 하루에 저장할 수 있는 성적 조합 수가 정해져 있어서,
  // 넣은 값을 한 번 더 보여 주고 '이대로 저장'을 눌러야 서버로 보낸다. 빈 칸·범위 밖 값은 서버에 보내기 전에 막는다
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [review, setReview] = useState<{ rows: [string, string][]; problem: string | null } | null>(null);
  const openReview = () => {
    const f = formRef.current;
    if (!f) return;
    sentRef.current = false;
    const v = (k: string) => String((f.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const n = (k: string) => (v(k) === "" ? NaN : Number(v(k)));
    let problem: string | null = null;
    if (REQUIRED.some((k) => v(k) === "")) problem = "국어·수학·탐구 두 과목의 표준점수와 탐구 과목을 모두 넣어 주세요.";
    else if (v("inq1") === v("inq2")) problem = "탐구 두 과목은 서로 달라야 합니다.";
    else if (![n("korean"), n("math")].every((x) => Number.isInteger(x) && x >= 40 && x <= 160)) problem = "국어·수학 표준점수는 40~160 사이 정수입니다.";
    else if (![n("inq1_score"), n("inq2_score")].every((x) => Number.isInteger(x) && x >= 20 && x <= 80)) problem = "탐구 표준점수는 20~80 사이 정수입니다.";
    if (second) {
      // 서버 액션(submitScores)과 같은 검사. 칸 옆 안내도 같이 띄운다
      const slCheck = checkSecondLanguage(v("sl_subject"), n("sl_grade"), "grade");
      setSlField(slCheck.ok ? null : slCheck.field);
      if (!problem && !slCheck.ok) problem = slCheck.error;
    }
    const choice = (k: string) => (v(k) ? ` (${v(k)})` : "");
    setReview({
      problem,
      rows: [
        [`국어${choice("korean_choice")}`, v("korean")],
        [`수학${choice("math_choice")}`, v("math")],
        [`탐구 1 · ${v("inq1") || "미선택"}`, v("inq1_score")],
        [`탐구 2 · ${v("inq2") || "미선택"}`, v("inq2_score")],
        ["영어 등급", v("english") || "입력 안 함"],
        ["한국사 등급", v("history") || "입력 안 함"],
        ...(second ? [["제2외국어/한문", v("sl_subject") === SL_NONE ? "미응시" : v("sl_subject") ? `${v("sl_subject")} · ${v("sl_grade")}등급` : "선택 안 함"] as [string, string]] : []),
      ],
    });
    dialogRef.current?.showModal();
  };
  // '이대로 저장'을 눌렀을 때만 확인 표지를 채워 보낸다. 연달아 눌러도 한 번만 제출한다
  const confirmRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef(false);
  const confirmSave = () => {
    if (sentRef.current || pending) return;
    sentRef.current = true;
    if (confirmRef.current) confirmRef.current.value = "on";
    dialogRef.current?.close();
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} key={state?.attempt ?? 0} action={action} className="sf" noValidate onInput={onInput} onChange={onInput}>
      <input type="hidden" name="idem" value={idem} />
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {update && (
        <>
          <input type="hidden" name="report_id" value={update.reportId} />
          <input type="hidden" name="report_version" value={update.version} />
        </>
      )}

      <header className="sf-hd">
        <div>
          <p className="sf-kicker">{kicker}</p>
          <h2>{examLabel} 성적표</h2>
          <p>성적표에 적힌 값을 같은 칸에 그대로 옮겨 주세요. 테두리가 있는 칸만 넣으면 됩니다.</p>
        </div>
        <p className={`sf-prog${done ? " done" : ""}`} aria-live="polite">
          <span className="bar" aria-hidden="true"><i style={{ width: `${(filled / REQUIRED.length) * 100}%` }} /></span>
          {done ? "필수 칸을 모두 넣었습니다" : <>필수 {REQUIRED.length}칸 중 <b>{filled}</b>칸 입력</>}
        </p>
      </header>

      {banner && <p className="sf-banner">{banner}</p>}
      <p className="sf-swipe">표를 옆으로 밀면 수학 · 영어 · 탐구 칸이 이어집니다.</p>
      <div className="sf-sheet" role="group" aria-label={`${examLabel} 성적표 입력`}>
        <table>
          <colgroup>
            <col className="c-head" />
            <col className="c-main" />
            <col className="c-main" />
            <col className="c-main" />
            <col className="c-main" />
            <col className="c-main" />
            <col className="c-main" />
            {second && <col className="c-main" />}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="corner">구분</th>
              <th scope="col" rowSpan={2}>한국사<br />영역</th>
              <th scope="col" rowSpan={2}>국어<br />영역</th>
              <th scope="col" rowSpan={2}>수학<br />영역</th>
              <th scope="col" rowSpan={2}>영어<br />영역</th>
              <th scope="colgroup" colSpan={2}>탐구 영역</th>
              {second && <th scope="col" rowSpan={2}>제2외국어<br />/한문 영역</th>}
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
              {(["inq1", "inq2"] as const).map((k, i) => {
                const v = i === 0 ? d.inq1 : d.inq2;
                return (
                  <td key={k} className={`in${need(v)}`}>
                    <select name={k} aria-label={`탐구 과목 ${i + 1}`} required defaultValue={v ?? ""}>
                      <option value="" disabled>과목 고르기</option>
                      {INQUIRY_SUBJECTS.map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.subjects.map((s) => <option key={s}>{s}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                );
              })}
              {second && (
                <td className={`in${slField === "sl_subject" ? " bad" : ""}`}>
                  <select
                    name="sl_subject"
                    aria-label="제2외국어/한문 과목"
                    aria-describedby={slField === "sl_subject" ? "sf-sl-hint" : undefined}
                    required
                    defaultValue={d.sl_subject ?? ""}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setSlSubject(val);
                      if (slField) setSlField(val === SL_NONE ? null : val ? "sl_value" : "sl_subject");
                    }}
                  >
                    <option value="" disabled>선택하세요</option>
                    <option value={SL_NONE}>미응시</option>
                    {SECOND_LANGUAGE_SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  {slField === "sl_subject" && slMsg && <small id="sf-sl-hint" className="sf-hint">{slMsg}</small>}
                </td>
              )}
            </tr>
            <tr className="key">
              <th scope="row">
                표준점수
                <small>필수</small>
              </th>
              <td className="na">{none}</td>
              <td className={`in${need(d.korean)}`}>
                <input name="korean" type="number" inputMode="numeric" min={40} max={160} required aria-label="국어 표준점수" defaultValue={d.korean} placeholder="예: 131" />
              </td>
              <td className={`in${need(d.math)}`}>
                <input name="math" type="number" inputMode="numeric" min={40} max={160} required aria-label="수학 표준점수" defaultValue={d.math} placeholder="예: 128" />
              </td>
              <td className="na">{none}</td>
              <td className={`in${need(d.inq1_score)}`}>
                <input name="inq1_score" type="number" inputMode="numeric" min={20} max={80} required aria-label="탐구 과목 1 표준점수" defaultValue={d.inq1_score} placeholder="예: 65" />
              </td>
              <td className={`in${need(d.inq2_score)}`}>
                <input name="inq2_score" type="number" inputMode="numeric" min={20} max={80} required aria-label="탐구 과목 2 표준점수" defaultValue={d.inq2_score} placeholder="예: 63" />
              </td>
              {second && <td className="na">{none}</td>}
            </tr>
            <tr>
              <th scope="row">백분위</th>
              <td className="na">{none}</td>
              <td className="calc">{auto}</td>
              <td className="calc">{auto}</td>
              <td className="na">{none}</td>
              <td className="calc">{auto}</td>
              <td className="calc">{auto}</td>
              {second && <td className="na">{none}</td>}
            </tr>
            <tr>
              <th scope="row">등급</th>
              <td className="in">
                <select name="history" aria-label="한국사 등급" defaultValue={d.history ?? ""}>
                  <option value="">입력 안 함</option>
                  {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </td>
              <td className="calc">{auto}</td>
              <td className="calc">{auto}</td>
              <td className="in">
                <select name="english" aria-label="영어 등급" defaultValue={d.english ?? ""}>
                  <option value="">입력 안 함</option>
                  {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </td>
              <td className="calc">{auto}</td>
              <td className="calc">{auto}</td>
              {second && (
                <td className={slTaken ? `in${slField === "sl_value" ? " bad" : ""}` : "na"}>
                  {slTaken ? (
                    <>
                      <select
                        name="sl_grade"
                        aria-label="제2외국어/한문 등급"
                        aria-describedby={slField === "sl_value" ? "sf-slg-hint" : undefined}
                        required
                        defaultValue={d.sl_grade ?? ""}
                        onChange={() => slField === "sl_value" && setSlField(null)}
                      >
                        <option value="" disabled>등급 고르기</option>
                        {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                      {slField === "sl_value" && slMsg && <small id="sf-slg-hint" className="sf-hint">{slMsg}</small>}
                    </>
                  ) : (
                    none
                  )}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="sf-legend">
        <li><i className="k in" />넣는 칸 · 국어·수학·탐구 표준점수(필수), 영어·한국사 등급(선택){second && ", 제2외국어/한문 과목·등급(필수, 응시하지 않았으면 '미응시'를 골라 주세요)"}</li>
        <li><i className="k calc" />국어·수학·탐구의 백분위와 등급은 저장하면 시험 자료로 계산해 리포트에 보여 드립니다.</li>
        <li><i className="k na" />영어·한국사{second && "·제2외국어/한문"}은 절대평가라 등급만 넣고, 전체 위치를 내는 총점(국·수·탐2 표준점수 합)에는 넣지 않습니다.</li>
      </ul>

      {state?.error && (
        <p className="sf-error" role="alert">
          {state.error}
        </p>
      )}

      {/* 확인 창에서 '이대로 저장'을 눌러 제출된 것만 서버가 받는다(actions.ts 의 confirm 검사) */}
      <input ref={confirmRef} type="hidden" name="confirm" defaultValue="" />
      <div className="sf-foot">
        <p className="sf-confirm-note">저장하기 전에 넣은 점수를 한 번 더 보여 드립니다.</p>
        <div className="sf-acts">
          <button className="btn p" type="button" disabled={pending} onClick={openReview}>
            {pending ? "저장하는 중" : subject ? `${subject} 학생 성적 저장하고 전체 위치 보기` : update ? "새 성적으로 리포트 갱신" : "성적 저장하고 전체 위치 보기"}
          </button>
        </div>
      </div>
      <p className="sf-note">저장하기 전에 성적표와 한 칸씩 대조해 주세요. 저장하면 이 시험 단계의 성적 입력 1회를 사용하고, 저장한 성적은 직접 고칠 수 없습니다. 성적표에 없는 점수로 저장하면 계산되지 않고 입력 1회가 사용되니 주의해 주세요. 잘못 넣었으면 고객센터에 정정을 1회 요청할 수 있습니다.</p>

      <dialog ref={dialogRef} className="sf-dialog" aria-labelledby="sf-dialog-h" onClose={() => setReview(null)}>
        {review && (
          <div className="sf-dialog-in">
            <h3 id="sf-dialog-h">{review.problem ? "입력을 확인해 주세요" : subject ? "이 학생의 성적으로 저장할까요?" : "이 점수로 저장할까요?"}</h3>
            {subject && !review.problem && <p className="sf-dialog-subject">{subject}</p>}
            {review.problem ? (
              <p className="sf-dialog-problem">{review.problem}</p>
            ) : (
              <>
                <p><b>저장하면 이 단계의 입력 1회를 사용합니다.</b> 저장한 성적은 직접 고칠 수 없으니 성적표와 한 칸씩 대조해 주세요.</p>
                <dl className="sf-dialog-rows">
                  {review.rows.map(([k, val]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{val}</dd>
                    </div>
                  ))}
                </dl>
                <p className="sf-dialog-note">성적표에 없는 점수는 계산되지 않고 입력 1회가 사용됩니다. 정정은 고객센터에 요청해 주세요(1회).</p>
              </>
            )}
            <div className="sf-dialog-acts">
              <button type="button" className="btn t" onClick={() => dialogRef.current?.close()} autoFocus>
                {review.problem ? "돌아가서 고치기" : "다시 확인하기"}
              </button>
              {!review.problem && (
                <button type="button" className="btn p" onClick={confirmSave}>
                  이대로 저장
                </button>
              )}
            </div>
          </div>
        )}
      </dialog>
    </form>
  );
}
