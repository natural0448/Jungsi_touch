"use client";

import { useActionState } from "react";
import { INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES } from "@/lib/exam";
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
}

const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * 성적 입력 — 수능 성적표와 같은 가로 표(영역 순서: 한국사 · 국어 · 수학 · 영어 · 탐구).
 * 행은 성적표처럼 선택과목 · 표준점수 · 백분위 · 등급이다.
 * 넣는 칸은 국어·수학·탐구 표준점수와 영어·한국사 등급뿐이다. 국어·수학·탐구의 백분위·등급은
 * 서버 엔진이 시험 자료로 계산하므로 칸만 두고 비워 둔다(화면이 계산하지 않는다).
 * 새로 저장할 때마다 새 성적 프로필이 생기고, 이전 성적은 고치지 않는다.
 */
export function ScoreForm({ examLabel, idem, defaults, update }: { examLabel: string; idem: string; defaults: ScoreDefaults; update?: { reportId: string; version: number } }) {
  const [state, action, pending] = useActionState<ScoreFormState, FormData>(submitScores, null);
  // 실패하면 넣었던 값으로 양식을 새로 그린다(React 는 서버 액션 뒤 양식을 비운다)
  const d = state?.values ?? defaults;
  const missing = Boolean(state?.error) && !state?.field;
  const need = (v: unknown) => (missing && (v === undefined || v === "") ? " bad" : "");
  const auto = <span className="sf-auto">저장 후 계산</span>;
  const none = <span className="sf-none" aria-label="해당 없음">─</span>;

  return (
    <form key={state?.attempt ?? 0} action={action} className="sf" noValidate>
      <input type="hidden" name="idem" value={idem} />
      {update && (
        <>
          <input type="hidden" name="report_id" value={update.reportId} />
          <input type="hidden" name="report_version" value={update.version} />
        </>
      )}

      <header className="sf-hd">
        <div>
          <p className="sf-kicker">성적 입력</p>
          <h2>{examLabel} 성적표</h2>
        </div>
        <p>성적표에 적힌 값을 같은 칸에 그대로 옮겨 주세요. 진하게 표시된 칸만 넣으면 됩니다.</p>
      </header>

      <p className="sf-swipe">표를 옆으로 밀면 수학 · 영어 · 탐구 칸이 이어집니다.</p>
      <div className="sf-sheet" role="group" aria-label={`${examLabel} 성적표 입력`}>
        <table>
          <colgroup>
            <col className="c-head" />
            <col />
            <col className="c-main" />
            <col className="c-main" />
            <col />
            <col className="c-main" />
            <col className="c-main" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="corner">구분</th>
              <th scope="col" rowSpan={2}>한국사<br />영역</th>
              <th scope="col" rowSpan={2}>국어<br />영역</th>
              <th scope="col" rowSpan={2}>수학<br />영역</th>
              <th scope="col" rowSpan={2}>영어<br />영역</th>
              <th scope="colgroup" colSpan={2}>탐구 영역</th>
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
            </tr>
            <tr className="key">
              <th scope="row">
                표준점수
                <small>꼭 넣기</small>
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
            </tr>
            <tr>
              <th scope="row">백분위</th>
              <td className="na">{none}</td>
              <td className="calc">{auto}</td>
              <td className="calc">{auto}</td>
              <td className="na">{none}</td>
              <td className="calc">{auto}</td>
              <td className="calc">{auto}</td>
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
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="sf-legend">
        <li><i className="k in" />넣는 칸 · 국어·수학·탐구 표준점수(필수), 영어·한국사 등급(선택)</li>
        <li><i className="k calc" />국어·수학·탐구의 백분위와 등급은 저장하면 시험 자료로 계산해 리포트에 보여 드립니다.</li>
        <li><i className="k na" />영어·한국사는 절대평가라 등급만 넣고, 전체 위치를 내는 총점(국·수·탐2 표준점수 합)에는 넣지 않습니다.</li>
      </ul>

      <label className={`sf-confirm${state?.field === "confirm" ? " bad" : ""}`}>
        <input type="checkbox" name="confirm" />
        <span>입력한 점수가 성적표와 같은지 확인했습니다.</span>
      </label>

      {state?.error && (
        <p className="sf-error" role="alert">
          {state.error}
        </p>
      )}

      <div className="sf-acts">
        <button className="btn p" type="submit" disabled={pending}>
          {pending ? "저장하는 중" : update ? "새 성적으로 리포트 갱신" : "성적 저장하고 전체 위치 보기"}
        </button>
        <small>저장할 때마다 새 성적 기록이 생기고, 이전 성적은 고치지 않습니다.</small>
      </div>
    </form>
  );
}
