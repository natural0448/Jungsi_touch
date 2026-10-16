import "server-only";
import { headers } from "next/headers";
import { apiMode } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";

/*
  유료 화면의 회원 식별 표시와 조회 기록(2026-10-16 최종 관리자 결정, 에듀터치 요청
  "정시터치-요청-회원식별표시_조회기록-20261016.md"). 자료 유출·무단 도용이 생겼을 때 어느 계정에서
  나왔는지 확인하려는 것이다.
  - 회원 id 는 에듀터치 로그인 쿠키에서 읽기만 한다(갱신·쓰기 없음, lib/supabase/read-only.ts).
  - 기록은 회원 본인 세션으로 에듀터치 DB 함수 log_content_view 를 부른다. 실패해도 화면은 그대로 보인다.
  - live 모드에서만 동작한다(합성·로컬 시험 모드에는 에듀터치 회원이 없다).
*/

export type ContentKind = "analysis" | "possibility" | "recommend" | "report";

/** 지금 요청의 에듀터치 회원 id. 없거나 live 가 아니면 null */
export async function viewerId(): Promise<string | null> {
  if (apiMode() !== "live") return null;
  try {
    const supabase = await supabaseServer();
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 유료 데이터를 응답한 화면 하나에 한 번 남긴다. 링크 미리 불러오기(prefetch)는 사람이 연 화면이 아니므로 남기지 않는다.
 * 경로는 300자로 자른다. 오류는 무시한다.
 */
export async function logContentView(kind: ContentKind, path: string): Promise<void> {
  if (apiMode() !== "live") return;
  try {
    const h = await headers();
    if (h.get("next-router-prefetch") || h.get("purpose") === "prefetch") return;
    const supabase = await supabaseServer();
    if (!supabase) return;
    await supabase.rpc("log_content_view", {
      p_app: "jeongsi",
      p_path: path.slice(0, 300),
      p_kind: kind,
      p_ip: h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      p_user_agent: h.get("user-agent"),
    });
  } catch {
    // 기록 실패로 유료 화면을 막지 않는다
  }
}

/** 페이지 쿼리 → 기록용 경로 문자열 */
export function viewPath(route: string, sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
  }
  const s = q.toString();
  return `/jeongsi${route === "/" ? "" : route}${s ? `?${s}` : ""}`;
}
