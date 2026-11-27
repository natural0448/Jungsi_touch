import "server-only";
import type { ScoreInputStatusDto } from "@/lib/dto";
import { provisionalClosed, releaseFor, type CsatRelease } from "@/lib/csat-release";
import { supabaseServer } from "@/lib/supabase/server";

/*
  성적 정정 요청(에듀터치 public.jeongsi_correction_requests, 본체 마이그레이션 75, 2026-10-28 사용자 결정).
  회원은 시험 단계마다 기본 입력 1회 + 정정 1회. 2페이지에서 성적표 사진과 함께 요청하고, 에듀터치 관리자가
  확인해 반려(사진 없음·불분명 → 다시 요청)하거나 승인한다. 승인하면 정시터치 서버가 정정권 1회를 주고 회원이 다시 입력한다.
  표는 회원 본인 세션으로 읽고 쓴다(RLS: 본인 것만, 처리 칸은 관리자만). 정정권 횟수의 최종 판단은 서버 상태(score-input-status)다.
*/

export const CORRECTION_BUCKET = "jeongsi-correction-photos";

export type CorrectionRow = {
  id: number;
  exam_id: string;
  stage: string;
  status: "pending" | "returned" | "approved";
  request_text: string;
  admin_note: string | null;
  created_at: string;
  handled_at: string | null;
};

/** 이 시험 단계의 내 마지막 요청. 표를 읽지 못하면 null(요청 버튼을 열지 않는다) */
export async function myLatestCorrection(examId: string, stage: string): Promise<{ row: CorrectionRow | null } | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("jeongsi_correction_requests")
    .select("id, exam_id, stage, status, request_text, admin_note, created_at, handled_at")
    .eq("exam_id", examId)
    .eq("stage", stage)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return { row: ((data ?? [])[0] as CorrectionRow | undefined) ?? null };
}

/**
 * 수능 성적표 배부일(본체 마이그레이션 77). 학년도를 주면 그 학년도, 없으면 가장 최근 학년도.
 * 표를 읽지 못하거나 날짜가 없으면 null(이 규칙으로 막지 않는다 — 입력 기간은 서버가 막는다).
 */
export async function csatReleaseOn(year?: number): Promise<string | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase.from("jeongsi_csat_schedule").select("academic_year, score_release_on");
  return error ? null : releaseFor((data ?? []) as CsatRelease[], year);
}

/**
 * 정정 요청을 새로 낼 수 있는지. 서버 상태 기준:
 * 이용권 회원 · 열린 단계 · 기본 입력을 이미 썼고 · 정정 요청이 남았고 · 아직 쓰지 않은 승인 정정권이 없다.
 * 그리고 이 단계에 접수 중이거나 승인된 요청이 없다(반려된 요청은 다시 낼 수 있다). 가채점은 성적표 배부일 전까지만.
 */
export function canRequestCorrection(st: ScoreInputStatusDto | null, latest: CorrectionRow | null, releaseOn: string | null = null): boolean {
  if (!st || !st.paid_input_allowed || st.stage_state !== "open" || st.input_limit_mode !== "stage_rights") return false;
  // 가채점 정정은 수능 성적표 배부 전까지만(2026-10-28·29 사용자 결정)
  if (st.stage === "provisional" && provisionalClosed(releaseOn)) return false;
  if (st.initial_remaining > 0 || st.correction_request_remaining <= 0 || st.correction_granted > st.correction_used) return false;
  return !latest || latest.status === "returned";
}
