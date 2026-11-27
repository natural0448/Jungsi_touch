import "server-only";
import { apiMode } from "@/lib/api";
import type { OfferingDto } from "@/lib/dto";
import { FAVORITE_LIMIT, favoriteSnapshot, type Favorites, type FavoriteWrite } from "@/lib/favorites";
import { supabaseServer } from "@/lib/supabase/server";

/*
  전문가용 학생별 즐겨찾기(별표, 2026-11-23 대표님 결정) — public.jeongsi_pro_student_favorites.
  개인용 jeongsi_favorites 와 같은 방식: 선생님 본인 세션으로 본인 행만 읽고 쓴다(RLS). 학생 한 명당 50개(DB 가 막는다).
  선생님이 그 학생을 볼 수 있는지는 부르는 쪽이 전문가용 서버(pro.student.read)로 먼저 확인한다.
  읽지 못하면 null — 별표를 숨기고 화면은 그대로 그린다.
*/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function validSnapshot(v: unknown, id: string): v is OfferingDto {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.offering_id === id && typeof o.university_name === "string" && typeof o.department === "string" && typeof o.group === "string" && typeof o.university_id === "string" && typeof o.academic_year === "number";
}

export async function proFavorites(orgId: string, studentId: string): Promise<Favorites | null> {
  if (apiMode() !== "live" || !ID.test(orgId) || !ID.test(studentId)) return null;
  try {
    const supabase = await supabaseServer();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("jeongsi_pro_student_favorites")
      .select("offering_id, offering, created_at")
      .eq("org_id", orgId)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(FAVORITE_LIMIT);
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
}

/** 학생 별표 넣기·빼기. 넣을 때 모집단위 사본은 부르는 쪽이 전문가용 서버 카탈로그에서 다시 읽은 값이다 */
export async function setProFavorite(orgId: string, studentId: string, o: OfferingDto, on: boolean): Promise<FavoriteWrite> {
  if (apiMode() !== "live" || !ID.test(orgId) || !ID.test(studentId) || !ID.test(o.offering_id)) return "failed";
  try {
    const supabase = await supabaseServer();
    if (!supabase) return "failed";
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return "signin";
    if (!on) {
      const { error } = await supabase.from("jeongsi_pro_student_favorites").delete()
        .eq("user_id", u.user.id).eq("org_id", orgId).eq("student_id", studentId).eq("offering_id", o.offering_id);
      return error ? "failed" : "ok";
    }
    const { error } = await supabase.from("jeongsi_pro_student_favorites").upsert(
      { user_id: u.user.id, org_id: orgId, student_id: studentId, offering_id: o.offering_id, offering: favoriteSnapshot(o) },
      { onConflict: "user_id,org_id,student_id,offering_id", ignoreDuplicates: true },
    );
    if (!error) return "ok";
    return /jeongsi_pro_student_favorites_limit/.test(error.message ?? "") ? "limit" : "failed";
  } catch {
    return "failed";
  }
}
