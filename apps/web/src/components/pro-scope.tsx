"use client";

import { createContext, useContext, type ReactNode } from "react";

/*
  전문가용 학생 화면 안에서 개인용 3·4페이지와 같은 화면 코드를 쓸 때(2026-11-23 대표님 결정: 완벽하게 같게)
  별표·담기·펼친 상세가 '선생님 본인'이 아니라 '지금 보는 학생' 쪽으로 저장·조회되게 하는 표시.
  - 개인용 화면에는 이 표시가 없다(null) → 버튼은 지금처럼 회원 본인 것으로 동작한다.
  - 기관·학생·리포트 번호만 담는다. 권한은 서버 동작이 전문가용 서버로 다시 확인한다(화면 값만 믿지 않는다).
*/
export interface ProScope {
  org_id: string;
  student_id: string;
  report_id: string;
}

const Ctx = createContext<ProScope | null>(null);

export function ProScopeProvider({ scope, children }: { scope: ProScope | null; children: ReactNode }) {
  return <Ctx.Provider value={scope}>{children}</Ctx.Provider>;
}

export function useProScope(): ProScope | null {
  return useContext(Ctx);
}

/** 양식에 함께 보내는 숨은 칸(서버 동작이 pro_* 가 있으면 전문가용으로 처리한다) */
export function ProScopeFields() {
  const s = useContext(Ctx);
  if (!s) return null;
  return (
    <>
      <input type="hidden" name="pro_org" value={s.org_id} />
      <input type="hidden" name="pro_student" value={s.student_id} />
      <input type="hidden" name="pro_report" value={s.report_id} />
    </>
  );
}
