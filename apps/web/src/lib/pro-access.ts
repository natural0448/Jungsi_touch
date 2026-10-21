import "server-only";
import { apiMode } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";

/*
  정시터치 전문가용(학교·학원 단체 이용) 소속 확인. 에듀터치 본체 함수 jeongsi_pro_access() 를 로그인한 본인 토큰으로
  부른다(서버 비밀 키 없음, 2026-10-21 에듀터치 재회신의 확정 형식). DB 가 활성으로 판정한 기관만 한 줄씩 온다 —
  줄이 있으면 활성, 없으면 권한 없음. 학생 기록 권한은 정시터치 서비스(jungsi-api)가 요청마다 따로 확인한다.
*/

export type ProOrg = {
  org_id: number;
  org_name: string;
  org_kind: "school" | "academy" | "group";
  member_id: number;
  role: "org_admin" | "teacher" | "viewer";
  contract_id: number;
  academic_year: number;
  starts_on: string;
  ends_on: string;
  purge_on: string;
  seats: number;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function valid(r: unknown): r is ProOrg {
  const o = r as Record<string, unknown>;
  return (
    !!o && Number.isSafeInteger(o.org_id) && typeof o.org_name === "string" && ["school", "academy", "group"].includes(o.org_kind as string) &&
    Number.isSafeInteger(o.member_id) && ["org_admin", "teacher", "viewer"].includes(o.role as string) && Number.isSafeInteger(o.contract_id) &&
    Number.isSafeInteger(o.academic_year) && [o.starts_on, o.ends_on, o.purge_on].every((d) => typeof d === "string" && YMD.test(d)) && Number.isSafeInteger(o.seats)
  );
}

/** 내 활성 기관 목록. null = 확인 실패(권한 없음과 구분해 '확인할 수 없음'으로 안내) */
export async function proAccess(): Promise<ProOrg[] | null> {
  const mode = apiMode();
  if (mode === "synthetic") {
    // 합성 모드: 화면 제작용 가상 기관 하나(실제 기관·계약이 아니다)
    return [{ org_id: 1, org_name: "합성 시범고등학교", org_kind: "school", member_id: 1, role: "teacher", contract_id: 1, academic_year: 2027, starts_on: "2026-11-20", ends_on: "2027-01-10", purge_on: "2027-01-11", seats: 30 }];
  }
  if (mode !== "live") return null;
  try {
    const supabase = await supabaseServer();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("jeongsi_pro_access");
    if (error || !Array.isArray(data)) return null;
    return data.filter(valid);
  } catch {
    return null;
  }
}

export const ROLE_LABEL: Record<ProOrg["role"], string> = { org_admin: "기관 관리자", teacher: "교사", viewer: "열람 전용" };
export const KIND_LABEL: Record<ProOrg["org_kind"], string> = { school: "학교", academy: "학원", group: "단체" };

/** 한국 날짜 기준 파기일까지 남은 날(오늘이 파기일 전날이면 1) */
export function daysUntil(ymd: string, now = new Date()): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
