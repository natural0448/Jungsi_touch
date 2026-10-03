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

/**
 * 성적 입력. 표준점수만 받는다(백분위·등급은 서버 엔진이 시험 자료로 계산한다).
 * 새로 저장할 때마다 새 성적 프로필이 생기고, 이전 성적은 고치지 않는다.
 */
export function ScoreForm({ examLabel, idem, defaults, update }: { examLabel: string; idem: string; defaults: ScoreDefaults; update?: { reportId: string; version: number } }) {
  const [state, action, pending] = useActionState<ScoreFormState, FormData>(submitScores, null);
  // 실패하면 넣었던 값으로 양식을 새로 그린다(React 는 서버 액션 뒤 양식을 비운다)
  const d = state?.values ?? defaults;
  return (
    <form key={state?.attempt ?? 0} action={action} className="sf" noValidate>
      <input type="hidden" name="idem" value={idem} />
      {update && (
        <>
          <input type="hidden" name="report_id" value={update.reportId} />
          <input type="hidden" name="report_version" value={update.version} />
        </>
      )}

      <div className="sf-exam">
        <span className="lab">시험</span>
        <b>{examLabel}</b>
        <small>성적표의 표준점수를 그대로 넣어 주세요. 백분위와 등급은 따로 넣지 않습니다.</small>
      </div>

      <fieldset className="sf-row">
        <legend>국어</legend>
        <label>
          <span>선택과목</span>
          <select name="korean_choice" defaultValue={d.korean_choice ?? ""}>
            <option value="">선택 안 함</option>
            {KOREAN_CHOICES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          <span>표준점수</span>
          <input name="korean" type="number" inputMode="numeric" min={40} max={160} required defaultValue={d.korean} placeholder="예: 131" />
        </label>
      </fieldset>

      <fieldset className="sf-row">
        <legend>수학</legend>
        <label>
          <span>선택과목</span>
          <select name="math_choice" defaultValue={d.math_choice ?? ""}>
            <option value="">선택 안 함</option>
            {MATH_CHOICES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          <span>표준점수</span>
          <input name="math" type="number" inputMode="numeric" min={40} max={160} required defaultValue={d.math} placeholder="예: 128" />
        </label>
      </fieldset>

      {(["inq1", "inq2"] as const).map((k, i) => (
        <fieldset key={k} className="sf-row">
          <legend>탐구 {i + 1}</legend>
          <label>
            <span>과목</span>
            <select name={k} required defaultValue={(i === 0 ? d.inq1 : d.inq2) ?? ""}>
              <option value="" disabled>과목을 고르세요</option>
              {INQUIRY_SUBJECTS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.subjects.map((s) => <option key={s}>{s}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>표준점수</span>
            <input name={`${k}_score`} type="number" inputMode="numeric" min={20} max={80} required defaultValue={i === 0 ? d.inq1_score : d.inq2_score} placeholder="예: 65" />
          </label>
        </fieldset>
      ))}

      <fieldset className="sf-row">
        <legend>
          절대평가 <small>총점에 넣지 않습니다</small>
        </legend>
        <label>
          <span>영어 등급</span>
          <select name="english" defaultValue={d.english ?? ""}>
            <option value="">입력 안 함</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => <option key={g} value={g}>{g}등급</option>)}
          </select>
        </label>
        <label>
          <span>한국사 등급</span>
          <select name="history" defaultValue={d.history ?? ""}>
            <option value="">입력 안 함</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => <option key={g} value={g}>{g}등급</option>)}
          </select>
        </label>
      </fieldset>

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
