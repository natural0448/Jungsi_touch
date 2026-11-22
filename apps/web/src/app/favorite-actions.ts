"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { FAVORITE_LIMIT, setFavorite } from "@/lib/favorites";
import { proToggleFavorite } from "@/app/pro/p4-actions";

export type FavoriteResult = { error: string | null };

/**
 * 즐겨찾기(별표) 넣기·빼기. 모집단위 이름·군은 화면이 보낸 값을 믿지 않고 서버 카탈로그에서 다시 읽어 저장한다.
 * 빼기는 번호만으로 한다(카탈로그에서 빠진 모집단위도 뺄 수 있어야 한다).
 */
export async function toggleFavorite(_prev: FavoriteResult, fd: FormData): Promise<FavoriteResult> {
  // 전문가용 학생 탭에서 누른 별표(2026-11-23): 그 학생의 즐겨찾기로
  if (fd.get("pro_org")) return proToggleFavorite(fd);
  const id = String(fd.get("offering_id") ?? "");
  const on = fd.get("on") === "1";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) return { error: "화면을 새로 열어 다시 눌러 주세요." };
  let res;
  if (!on) {
    res = await setFavorite({ offering_id: id, academic_year: 0, university_id: "", university_name: "", campus: null, department: "", track: null, group: "", region: null, wildcard_group: null }, false);
  } else {
    try {
      const detail = await source().readOffering(await getCaller(), id);
      if (!detail?.offering) return { error: "지금 목록에서 찾을 수 없는 모집단위입니다." };
      res = await setFavorite(detail.offering, true);
    } catch (e) {
      if (e instanceof AccessDenied) return { error: e.status === 401 ? "다시 로그인해 주세요." : "이용권 회원만 즐겨찾기할 수 있습니다." };
      if (e instanceof ConnectionError) return { error: "지금은 즐겨찾기에 넣지 못했습니다. 잠시 뒤 다시 눌러 주세요." };
      throw e;
    }
  }
  if (res === "limit") return { error: `즐겨찾기는 ${FAVORITE_LIMIT}개까지 넣을 수 있습니다. 하나를 빼고 다시 눌러 주세요.` };
  if (res === "signin") return { error: "다시 로그인해 주세요." };
  if (res === "failed") return { error: on ? "즐겨찾기에 넣지 못했습니다. 잠시 뒤 다시 눌러 주세요." : "즐겨찾기에서 빼지 못했습니다. 잠시 뒤 다시 눌러 주세요." };
  revalidatePath("/admissions", "layout");
  return { error: null };
}
