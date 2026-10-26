"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { MAYBE_SAVED, connectionText, OFFERING_NOT_LINKED_NOTICE, SCORE_INPUT_TRANSITION_NOTICE } from "@/lib/connection-text";
import { canonicalOfferingIds, ensureAnalyses, ensureCandidates, loadMine, refreshAnalyses, refreshCandidates, type RefreshIntent, type ReportState } from "@/lib/report-ops";

export type RunResult = { error: string | null };

/*
  모집단위 분석(university.analyze)·후보 만들기(candidates.build)는 회원이 버튼을 누를 때만 부른다.
  화면을 열거나 다시 접속했다고 자동으로 계산하지 않는다(담당자 회신 2026-10-25, MEMBER-SHORTLIST-01).
  이미 분석이 붙은 모집행은 다시 계산하지 않는다(ensureAnalyses 가 빠진 것만 보낸다).
*/

function explain(st: ReportState, failed: string): RunResult {
  // 모집단위가 분석 자료에 연결되지 않은 경우. 다시 눌러도 같으므로 '잠시 뒤 다시'라고 하지 않는다(담당자 회신 10-26 문구)
  if (st.kind === "failed" && st.code === "offering_not_found") return { error: `${failed}. ${OFFERING_NOT_LINKED_NOTICE} (사유 코드: offering_not_found)` };
  if (st.kind === "failed" && st.code === "score_input_transition_pending") return { error: `${failed}. ${SCORE_INPUT_TRANSITION_NOTICE} (사유 코드 score_input_transition_pending)` };
  if (st.kind === "failed") return { error: `${failed}. 잠시 뒤 다시 눌러 주세요. (사유 코드 ${st.code})` };
  if (st.kind === "score_required") return { error: `${failed}. 성적 확인이 끝난 뒤 분석할 수 있습니다.` };
  if (st.kind === "none") return { error: `${failed}. 내 성적 리포트를 먼저 열어 주세요.` };
  return { error: null };
}

async function run(failed: string, work: (src: ReturnType<typeof source>, caller: Awaited<ReturnType<typeof getCaller>>) => Promise<ReportState>): Promise<RunResult> {
  try {
    const caller = await getCaller();
    const src = source();
    const out = explain(await work(src, caller), failed);
    if (out.error) return out;
  } catch (e) {
    if (e instanceof AccessDenied) return { error: `${failed}. ${e.status === 401 ? "다시 로그인해 주세요." : "이용권 회원만 분석할 수 있습니다."}` };
    // 서버가 저장을 끝낸 뒤 응답 단계에서 503 을 낼 수 있다(10-26 운영: 가천대 분석·담기가 저장된 채 503).
    // 실패로만 두지 않고 화면을 다시 읽어 실제 저장 상태를 보이게 한다
    if (e instanceof ConnectionError) {
      // 전환 보류(score_input_transition_pending)는 쓰기 전에 막힌 것이라 다시 읽지 않는다
      const unsure = e.kind === "unavailable" && e.code !== "score_input_transition_pending";
      if (unsure) revalidatePath("/", "layout");
      return { error: `${failed}. ${connectionText(e)}${unsure ? ` ${MAYBE_SAVED}` : ""}` };
    }
    throw e;
  }
  revalidatePath("/", "layout");
  return { error: null };
}

/** 보이는(또는 담은) 모집행 중 분석이 없는 것만, 한 번에 100개까지 */
export async function analyzeNow(_prev: RunResult, fd: FormData): Promise<RunResult> {
  const ids = canonicalOfferingIds(String(fd.get("ids") ?? "").split(",")).slice(0, 100);
  if (ids.length === 0) return { error: null };
  return run("분석하지 못했습니다", async (src, caller) => {
    const mine = await loadMine(src, caller);
    return mine ? ensureAnalyses(src, caller, mine, ids) : { kind: "none" };
  });
}

/** 후보가 아직 없을 때만 만든다. 저장된 후보(보류 포함)가 있으면 다시 만들지 않는다 */
export async function buildNow(): Promise<RunResult> {
  return run("유리한 학교를 찾지 못했습니다", async (src, caller) => {
    const mine = await loadMine(src, caller);
    return mine ? ensureCandidates(src, caller, mine) : { kind: "none" };
  });
}

function refreshIntent(fd: FormData): RefreshIntent | null {
  const id = String(fd.get("refresh_intent") ?? "");
  const reportId = String(fd.get("report_id") ?? "");
  const profileId = String(fd.get("profile_id") ?? "");
  const version = String(fd.get("report_version") ?? "");
  const token = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
      !token.test(reportId) || !token.test(profileId) || !/^[1-9][0-9]*$/.test(version)) return null;
  const reportVersion = Number(version);
  return Number.isSafeInteger(reportVersion) ? { id, reportId, profileId, reportVersion } : null;
}

/** 별도 명시 재확인. 기본 missing-only 동작과 자동 GET은 그대로 유지한다. */
export async function refreshAnalysesNow(_prev: RunResult, fd: FormData): Promise<RunResult> {
  const intent = refreshIntent(fd);
  const ids = canonicalOfferingIds(String(fd.get("ids") ?? "").split(","));
  if (!intent || ids.length < 1 || ids.length > 100) return { error: "다시 확인할 리포트와 모집행 1~100개를 선택해 주세요." };
  return run("다시 분석하지 못했습니다", async (src, caller) => {
    const mine = await loadMine(src, caller);
    return mine ? refreshAnalyses(src, caller, mine, ids, intent) : { kind: "none" };
  });
}

/** 저장된 후보(보류 포함)를 버튼으로 재확인한다. 새 성적이나 입력권을 생성하지 않는다. */
export async function refreshCandidatesNow(_prev: RunResult, fd: FormData): Promise<RunResult> {
  const intent = refreshIntent(fd);
  if (!intent) return { error: "다시 확인할 리포트를 먼저 열어 주세요." };
  return run("후보를 다시 확인하지 못했습니다", async (src, caller) => {
    const mine = await loadMine(src, caller);
    return mine ? refreshCandidates(src, caller, mine, intent) : { kind: "none" };
  });
}
