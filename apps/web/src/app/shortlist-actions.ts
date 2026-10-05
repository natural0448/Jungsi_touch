"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { loadMine, togglePickOn } from "@/lib/report-ops";

/**
 * 핵심 지원 학교 담기·빼기(shortlist.update). 3·4페이지가 같은 report.shortlist 를 쓴다.
 * 최신 리포트 revision 으로 보내며, 권한은 서버가 판단하고 막히면 아무것도 바꾸지 않는다.
 */
export async function togglePick(fd: FormData) {
  const id = String(fd.get("offering_id") ?? "");
  const selected = fd.get("selected") === "1";
  if (!id) return;
  const caller = await getCaller();
  const src = source();
  try {
    const report = await loadMine(src, caller);
    if (!report) return;
    await togglePickOn(src, caller, report, id, selected);
  } catch (e) {
    if (e instanceof AccessDenied || e instanceof ConnectionError) return;
    throw e;
  }
  revalidatePath("/", "layout");
}
