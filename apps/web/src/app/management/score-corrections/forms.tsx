"use client";

import { useActionState } from "react";
import { grantPersonal, grantPro, type CorrectionState } from "./actions";

function Common({ examId }: { examId: string }) {
  return (
    <>
      <label><span>시험 ID</span><input name="exam_id" defaultValue={examId} required maxLength={128} /></label>
      <label><span>단계</span>
        <select name="stage" defaultValue="mock"><option value="mock">모의(mock)</option><option value="provisional">가채점(provisional)</option><option value="final">실채점(final)</option></select>
      </label>
      <label><span>고객센터 접수 번호</span><input name="ticket_ref" required maxLength={128} placeholder="예: 문의 번호" /></label>
      <label><span>기대 입력 판(현재 entry_version)</span><input name="expected_version" inputMode="numeric" required maxLength={9} /></label>
    </>
  );
}

function Result({ s }: { s: CorrectionState }) {
  if (!s) return null;
  return s.ok ? <p className="ok" role="status">{s.text}</p> : <p className="err" role="alert">{s.error}</p>;
}

export function PersonalForm({ examId, idem }: { examId: string; idem: string }) {
  const [s, action, pending] = useActionState<CorrectionState, FormData>(grantPersonal, null);
  return (
    <form action={action} className="pro-form">
      <input type="hidden" name="idem" value={idem} />
      <label className="w2"><span>회원 UUID(정정 대상 본인)</span><input name="subject_id" required maxLength={36} /></label>
      <Common examId={examId} />
      <div className="acts w4"><button className="btn p" type="submit" disabled={pending}>{pending ? "승인 중…" : "정정권 1회 승인"}</button><Result s={s} /></div>
    </form>
  );
}

export function ProForm({ examId, idem }: { examId: string; idem: string }) {
  const [s, action, pending] = useActionState<CorrectionState, FormData>(grantPro, null);
  return (
    <form action={action} className="pro-form">
      <input type="hidden" name="idem" value={idem} />
      <label><span>기관 ID</span><input name="org_id" required maxLength={64} /></label>
      <label><span>학생 ID</span><input name="student_id" required maxLength={128} /></label>
      <Common examId={examId} />
      <div className="acts w4"><button className="btn p" type="submit" disabled={pending}>{pending ? "승인 중…" : "학생 정정권 1회 승인"}</button><Result s={s} /></div>
    </form>
  );
}
