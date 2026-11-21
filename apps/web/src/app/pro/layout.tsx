import type { ReactNode } from "react";
import { ProRoleMark } from "@/components/pro-role";
import { proAccess } from "@/lib/pro-access";

/** 전문가용 화면 공통: 기관 관리자면 머리글 탭에 '기관 관리'를 보이게 표시만 남긴다(권한 확인은 각 화면·서버가 한다) */
export default async function ProLayout({ children }: { children: ReactNode }) {
  const orgs = await proAccess();
  return (
    <>
      <ProRoleMark isAdmin={!!orgs?.some((o) => o.role === "org_admin")} />
      {children}
    </>
  );
}
