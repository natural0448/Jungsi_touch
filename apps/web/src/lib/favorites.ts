import "server-only";
import { cache } from "react";
import { apiMode } from "@/lib/api";
import type { OfferingDto } from "@/lib/dto";
import { supabaseServer } from "@/lib/supabase/server";

/*
  즐겨찾기(별표) — 에듀터치 본체 public.jeongsi_favorites(2026-11-18 대표님 결정, 회원당 최대 50개).
  담기(핵심 지원 학교, 군별 4개)에 앞서 비교해 볼 모집단위를 모아 두는 용도다. 유리한 대학 찾기에서 별표하면
  전체 대학·학과 가능성 보기에도 그대로 보인다(같은 표를 읽는다).
  - 회원 본인 세션으로 읽고 쓴다(RLS: 본인 것만). 정시터치 서비스 API·리포트와 별개라 리포트를 다시 만들어도 남는다.
  - 표에는 모집단위 번호와 공개 카탈로그 값의 사본(이름·군 등)만 둔다. 성적·판단 결과는 넣지 않는다.
  - 읽지 못하면 null — 별표를 숨기고 화면은 그대로 그린다.
*/
export const FAVORITE_LIMIT = 50;

/** 표에 두는 모집단위 사본(공개 카탈로그 필드만) */
export function favoriteSnapshot(o: OfferingDto): OfferingDto {
  return {
    offering_id: o.offering_id,
    academic_year: o.academic_year,
    university_id: o.university_id,
    university_name: o.university_name,
    campus: o.campus ?? null,
    department: o.department,
    track: o.track ?? null,
    group: o.group,
    region: o.region ?? null,
    wildcard_group: o.wildcard_group ?? null,
  };
}

function validSnapshot(v: unknown, id: string): v is OfferingDto {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.offering_id === id && typeof o.university_name === "string" && typeof o.department === "string" && typeof o.group === "string" && typeof o.university_id === "string" && typeof o.academic_year === "number";
}

export interface Favorites {
  ids: Set<string>;
  /** 별표한 순서(최근 것이 앞) */
  items: OfferingDto[];
}

/** 내 즐겨찾기. 한 요청 안에서는 한 번만 읽는다. 로그인 전·표 없음·읽기 실패는 null */
export const myFavorites = cache(async (): Promise<Favorites | null> => {
  if (apiMode() !== "live") return null;
  try {
    const supabase = await supabaseServer();
    if (!supabase) return null;
    const { data, error } = await supabase.from("jeongsi_favorites").select("offering_id, offering, created_at").order("created_at", { ascending: false }).limit(FAVORITE_LIMIT);
    if (error || !Array.isArray(data)) return null;
    const items: OfferingDto[] = [];
    const ids = new Set<string>();
    for (const r of data) {
      if (typeof r.offering_id !== "string") continue;
      ids.add(r.offering_id);
      if (validSnapshot(r.offering, r.offering_id)) items.push(favoriteSnapshot(r.offering));
    }
    return { ids, items };
  } catch {
    return null;
  }
});

export type FavoriteWrite = "ok" | "limit" | "signin" | "failed";

/** 별표 넣기·빼기. 한도(50개)는 DB 가 막는다 */
export async function setFavorite(o: OfferingDto, on: boolean): Promise<FavoriteWrite> {
  if (apiMode() !== "live") return "failed";
  try {
    const supabase = await supabaseServer();
    if (!supabase) return "failed";
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return "signin";
    if (!on) {
      const { error } = await supabase.from("jeongsi_favorites").delete().eq("user_id", u.user.id).eq("offering_id", o.offering_id);
      return error ? "failed" : "ok";
    }
    const { error } = await supabase.from("jeongsi_favorites").upsert({ user_id: u.user.id, offering_id: o.offering_id, offering: favoriteSnapshot(o) }, { onConflict: "user_id,offering_id", ignoreDuplicates: true });
    if (!error) return "ok";
    return /jeongsi_favorites_limit/.test(error.message ?? "") ? "limit" : "failed";
  } catch {
    return "failed";
  }
}
