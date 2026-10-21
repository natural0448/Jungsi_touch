"use client";

import { useActionState } from "react";
import type { ProMemberPageDto } from "@/lib/pro-dto";
import { archiveStudentAction, assignStudentAction, type ProActionState } from "../actions";

const ROLE = { teacher: "교사", viewer: "열람 전용", org_admin: "기관 관리자" } as const;

/** 담당 변경: 이 기관의 교사·열람 전용 구성원을 체크해 저장(체크한 사람 전체가 새 담당) */
export function AssignForm({ orgId, studentId, version, assigned, members, idem }: { orgId: string; studentId: string; version: number; assigned: string[]; members: ProMemberPageDto["items"]; idem: string }) {
  const [state, action, pending] = useActionState<ProActionState, FormData>(assignStudentAction, null);
  const pickable = members.filter((m) => m.status === "active" && m.role !== "org_admin");
  return (
    <form action={action} className="pro-assign">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="idem" value={idem} />
      {pickable.map((m) => (
        <label key={m.subject_id}>
          <input type="checkbox" name="teacher" value={m.subject_id} defaultChecked={assigned.includes(m.subject_id)} />
          구성원 {m.member_id} · {ROLE[m.role]}
        </label>
      ))}
      <button className="btn" type="submit" disabled={pending}>{pending ? "저장 중…" : "담당 저장"}</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
    </form>
  );
}

/** 학생 보관: 확인란을 체크해야 보낸다 */
export function ArchiveForm({ orgId, studentId, version, idem }: { orgId: string; studentId: string; version: number; idem: string }) {
  const [state, action, pending] = useActionState<ProActionState, FormData>(archiveStudentAction, null);
  return (
    <form action={action} className="pro-assign">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="idem" value={idem} />
      <label><input type="checkbox" name="confirm" /> 보관 확인</label>
      <button className="btn" type="submit" disabled={pending}>{pending ? "보관 중…" : "보관"}</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
    </form>
  );
}
