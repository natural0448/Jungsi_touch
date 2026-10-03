"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, getCaller, source } from "@/lib/api";

/**
 * 핵심 지원 학교 담기·빼기(shortlist.update). 3·4페이지가 같은 목록을 쓴다.
 * 권한은 서버가 판단하고, 막히면 아무것도 바꾸지 않는다.
 */
export async function togglePick(fd: FormData) {
  const id = String(fd.get("offering_id") ?? "");
  const selected = fd.get("selected") === "1";
  if (!id) return;
  try {
    await source().setShortlist(await getCaller(), id, selected);
  } catch (e) {
    if (e instanceof AccessDenied) return;
    throw e;
  }
  revalidatePath("/", "layout");
}
