"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { canonicalOfferingIds, ensureAnalyses, ensureCandidates, loadMine, type ReportState } from "@/lib/report-ops";

export type RunResult = { error: string | null };

/*
  모집단위 분석(university.analyze)·후보 만들기(candidates.build)는 회원이 버튼을 누를 때만 부른다.
  화면을 열거나 다시 접속했다고 자동으로 계산하지 않는다(담당자 회신 2026-10-25, MEMBER-SHORTLIST-01).
  이미 분석이 붙은 모집행은 다시 계산하지 않는다(ensureAnalyses 가 빠진 것만 보낸다).
*/

function explain(st: ReportState, failed: string): RunResult {
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
    if (e instanceof ConnectionError)
      return { error: `${failed}. ${e.kind === "rate_limited" ? "요청이 겹쳤습니다. 몇 초 뒤 다시 눌러 주세요." : "정시터치 서버에 연결할 수 없습니다."}` };
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
