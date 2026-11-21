import "server-only";
import { cache } from "react";
import { apiMode } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * 로그인한 회원의 이름(본체 profiles.name). 분석 대기 화면의 안내 문구에만 쓴다(2026-11-18 대표님 요청).
 * 읽지 못하면 "회원" — 화면을 막지 않는다. 한 요청 안에서는 한 번만 읽는다. 서비스 API(계정당 동시 2건)와 별개 조회다.
 */
export const memberName = cache(async (): Promise<string> => {
  if (apiMode() !== "live") return "회원";
  try {
    const supabase = await supabaseServer();
    if (!supabase) return "회원";
    const { data } = await supabase.auth.getUser();
    if (!data.user) return "회원";
    const { data: p } = await supabase.from("profiles").select("name").eq("id", data.user.id).maybeSingle();
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    return name && name.length <= 40 ? name : "회원";
  } catch {
    return "회원";
  }
});
