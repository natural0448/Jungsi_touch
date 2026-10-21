"use client";

import { useActionState } from "react";
import Link from "@/components/link";
import type { ProStudentDto } from "@/lib/pro-dto";
import { createStudent, updateStudent, type StudentFormState } from "./actions";

/** 학생 추가·수정 양식. 이름(실명 허용)·반·번호·태그·메모만 받는다 — 연락처·주민등록번호 칸은 없다 */
export function StudentForm({ orgId, idem, contractVersion, student, onDone }: { orgId: string; idem: string; contractVersion?: number; student?: ProStudentDto; onDone?: string }) {
  const [state, action, pending] = useActionState<StudentFormState, FormData>(student ? updateStudent : createStudent, null);
  const v = (k: "display_name" | "class_label" | "class_number" | "tags" | "memo", d: string) => state?.values[k] ?? d;
  return (
    <form action={action} className="pro-form">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="idem" value={idem} />
      {student ? (
        <>
          <input type="hidden" name="student_id" value={student.student_id} />
          <input type="hidden" name="version" value={student.version} />
        </>
      ) : (
        <input type="hidden" name="contract_version" value={contractVersion} />
      )}
      <label className="w2">
        <span>학생 이름</span>
        <input name="display_name" required maxLength={40} defaultValue={v("display_name", student?.display_name ?? "")} placeholder="예: 김하늘" />
      </label>
      <label>
        <span>반</span>
        <input name="class_label" maxLength={20} defaultValue={v("class_label", student?.class_label ?? "")} placeholder="예: 3-2" />
      </label>
      <label>
        <span>번호</span>
        <input name="class_number" inputMode="numeric" maxLength={3} defaultValue={v("class_number", student?.class_number?.toString() ?? "")} placeholder="예: 15" />
      </label>
      <label className="w2">
        <span>태그(쉼표로 구분, 5개까지)</span>
        <input name="tags" maxLength={80} defaultValue={v("tags", student?.tags.join(", ") ?? "")} placeholder="예: 정시, 재수" />
      </label>
      <label className="w4">
        <span>메모(상담 참고, 300자)</span>
        <input name="memo" maxLength={300} defaultValue={v("memo", student?.memo ?? "")} />
      </label>
      <div className="acts w4">
        {state?.error && <p className="err" role="alert">{state.error}</p>}
        <button className="btn p" type="submit" disabled={pending}>{pending ? "저장하는 중…" : student ? "학생 정보 저장" : "학생 추가"}</button>
        {onDone && <Link className="btn" href={onDone}>취소</Link>}
      </div>
      {!student && <p className="note w4">학생을 추가하면 계약 학생 수 1명을 사용합니다. 보관하거나 담당을 바꿔도 다시 돌아오지 않습니다.</p>}
    </form>
  );
}
