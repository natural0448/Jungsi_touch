"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { loadMine, togglePickOn } from "@/lib/report-ops";

export type PickResult = { error: string | null };

/**
 * 핵심 지원 학교 담기·빼기(shortlist.update). 3·4페이지가 같은 report.shortlist 를 쓴다.
 * 최신 리포트 revision 으로 보내며, 권한은 서버가 판단하고 막히면 아무것도 바꾸지 않는다.
 * 바뀌지 않았으면 그 이유를 돌려줘 버튼 옆에 보인다(예전에는 조용히 무시해 담긴 줄 알 수 있었다).
 */
export async function togglePick(_prev: PickResult, fd: FormData): Promise<PickResult> {
  const id = String(fd.get("offering_id") ?? "");
  const selected = fd.get("selected") === "1";
  const failed = selected ? "담지 못했습니다" : "빼지 못했습니다";
  if (!id) return { error: `${failed}. 화면을 새로 열어 다시 눌러 주세요.` };
  const caller = await getCaller();
  const src = source();
  try {
    const report = await loadMine(src, caller);
    if (!report) return { error: `${failed}. 내 성적 리포트를 먼저 열어 주세요.` };
    const st = await togglePickOn(src, caller, report, id, selected);
    if (st.kind === "failed") return { error: `${failed}. 잠시 뒤 다시 눌러 주세요. (사유 코드 ${st.code})` };
    if (st.kind === "score_required") return { error: `${failed}. 성적 확인이 끝난 뒤 담을 수 있습니다.` };
    if (st.kind === "none") return { error: `${failed}. 리포트를 찾지 못했습니다.` };
  } catch (e) {
    if (e instanceof AccessDenied) return { error: `${failed}. ${e.status === 401 ? "다시 로그인해 주세요." : "이용권 회원만 담을 수 있습니다."}` };
    if (e instanceof ConnectionError)
      return { error: `${failed}. ${e.kind === "rate_limited" ? "요청이 겹쳤습니다. 몇 초 뒤 다시 눌러 주세요." : "정시터치 서버에 연결할 수 없습니다."}` };
    throw e;
  }
  revalidatePath("/", "layout");
  return { error: null };
}
