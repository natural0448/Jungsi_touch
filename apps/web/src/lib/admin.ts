import "server-only";
import { apiMode } from "@/lib/api";
import { readSyntheticState } from "@/lib/api/synthetic";
import { supabaseServer } from "@/lib/supabase/server";

/*
  에듀터치 관리자(profiles.role=admin · status=active)인지. 관리 화면의 버튼·서버 동작을 여는 데만 쓴다.
  서비스 권한(회원 등급·관리자 일일 예외·aal2)은 우리 서비스 API 가 따로 판단한다 — 이 확인이 그것을 대신하지 않는다.
  합성 모드에서는 '운영자' 보기일 때만 연다.
*/
export async function isEdutouchAdmin(): Promise<boolean> {
  const mode = apiMode();
  if (mode === "synthetic") return (await readSyntheticState()) === "operator";
  if (mode !== "live") return false;
  const supabase = await supabaseServer();
  if (!supabase) return false;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return false;
  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", data.user.id).maybeSingle();
  return profile?.role === "admin" && profile?.status === "active";
}
