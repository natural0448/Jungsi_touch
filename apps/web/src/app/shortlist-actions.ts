"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { MAYBE_SAVED, connectionText } from "@/lib/connection-text";
import { loadMine } from "@/lib/report-ops";
import { setPick } from "@/lib/shortlist";
import { PICK_GROUP_LIMIT } from "@/lib/picked-view";

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
    const st = await setPick(src, caller, report, id, selected);
    // 같은 모집군(가·나·다)에는 5개까지만 담는다(서버 판단, 2026-11-18 4개 → 2026-11-21 대표님 요청 5개). 다시 눌러도 같으므로 무엇을 하면 되는지 알린다
    if (st.kind === "failed" && (st.code === "shortlist_limit_exceeded" || st.code === "shortlist_group_limit_exceeded")) return { error: `같은 모집군에는 ${PICK_GROUP_LIMIT}개까지 담을 수 있습니다. 담은 곳 하나를 빼고 다시 담아 주세요.` };
    if (st.kind === "failed") return { error: `${failed}. 잠시 뒤 다시 눌러 주세요. (문의 번호 ${st.code})` };
    if (st.kind === "score_required") return { error: `${failed}. 성적 확인이 끝난 뒤 담을 수 있습니다.` };
    if (st.kind === "none") return { error: `${failed}. 리포트를 찾지 못했습니다.` };
  } catch (e) {
    if (e instanceof AccessDenied) return { error: `${failed}. ${e.status === 401 ? "다시 로그인해 주세요." : "이용권 회원만 담을 수 있습니다."}` };
    // 서버가 저장을 끝낸 뒤 응답 단계에서 503 을 낼 수 있다(10-26 운영: 가천대 분석·담기가 저장된 채 503).
    // 실패로만 두지 않고 화면을 다시 읽어 실제 저장 상태를 보이게 한다
    if (e instanceof ConnectionError) {
      // 전환 보류(score_input_transition_pending)는 쓰기 전에 막힌 것이라 다시 읽지 않는다
      const unsure = e.kind === "unavailable" && e.code !== "score_input_transition_pending";
      if (unsure) revalidatePath("/", "layout");
      // 저장됐을 수 있으므로 '못했습니다·다시 눌러 주세요'라고 하지 않는다(10-27 사용자 지적)
      if (unsure) return { error: `${MAYBE_SAVED} (문의 번호 ${e.code})` };
      // 요청 겹침은 '담지 못했습니다'로 말하지 않는다 — 약 2분 조용히 다시 보낸 뒤에도 안 풀릴 때만 차분한 한 줄(2026-11-21)
      if (e.kind === "rate_limited" && e.code !== "analysis_quota_exceeded") return { error: connectionText(e) };
      return { error: `${failed}. ${connectionText(e)}` };
    }
    throw e;
  }
  revalidatePath("/", "layout");
  return { error: null };
}
