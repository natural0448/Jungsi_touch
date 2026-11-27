"use client";

import { useActionState } from "react";
import Link from "@/components/link";
import type { ProStudentDto } from "@/lib/pro-dto";
import { PROFILE_FIELDS, PROFILE_MAX_ITEMS, tagsToProfile } from "@/lib/pro-profile";
import { createStudent, updateStudent, type StudentFormState } from "./actions";

/** 학생 추가·수정 양식. 이름(실명 허용)·반·번호·상담 참고(희망 계열·전공·대학·지역·기타)만 받는다 — 연락처·주민등록번호 칸은 없다 */
export function StudentForm({ orgId, idem, contractVersion, student, onDone }: { orgId: string; idem: string; contractVersion?: number; student?: ProStudentDto; onDone?: string }) {
  const [state, action, pending] = useActionState<StudentFormState, FormData>(student ? updateStudent : createStudent, null);
  const v = (k: string, d: string) => state?.values[k] ?? d;
  const profile = tagsToProfile(student?.tags ?? []);
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
        <input name="class_number" inputMode="numeric" maxLength={3} defaultValue={v("class_number", student?.class_number ?? "")} placeholder="예: 15" />
      </label>
      <fieldset className="pro-profile w4">
        <legend>상담 참고 <small>항목마다 쉼표로 구분해 {PROFILE_MAX_ITEMS}개까지</small></legend>
        {PROFILE_FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input name={`p_${f.key}`} maxLength={100} defaultValue={v(`p_${f.key}`, profile[f.key].join(", "))} placeholder={f.ph} />
          </label>
        ))}
      </fieldset>
      <div className="acts w4">
        {state?.error && <p className="err" role="alert">{state.error}</p>}
        <button className="btn p" type="submit" disabled={pending}>{pending ? "저장하는 중…" : student ? "학생 정보 저장" : "학생 추가"}</button>
        {onDone && <Link className="btn" href={onDone}>취소</Link>}
      </div>
      {!student && <p className="note w4">학생을 추가하면 계약 학생 수 1명을 사용합니다. 보관하거나 담당을 바꿔도 다시 돌아오지 않습니다.</p>}
    </form>
  );
}
