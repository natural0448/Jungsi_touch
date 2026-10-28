"use server";

import { revalidatePath } from "next/cache";
import { getCaller, source } from "@/lib/api";
import { CORRECTION_BUCKET, canRequestCorrection, csatReleaseOn, myLatestCorrection } from "@/lib/correction";
import { EXAM } from "@/lib/exam";
import { supabaseServer } from "@/lib/supabase/server";

export type CorrectionFormState = { ok: true } | { ok: false; error: string } | null;

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 성적 정정 요청 보내기. 서버 상태로 요청할 수 있는지 다시 확인하고, 성적표 사진(필수)을 비공개 저장소의
 * 본인 폴더에 올린 뒤 요청 줄을 넣는다. 같은 단계의 접수·승인 요청이 이미 있으면 DB 유일 조건이 막는다.
 * 줄을 넣지 못하면 올린 사진이 요청 없이 남는다(회원은 지울 권한이 없다). 드문 경우라 저장소에서 관리자가 정리한다.
 */
export async function requestCorrection(_prev: CorrectionFormState, fd: FormData): Promise<CorrectionFormState> {
  const text = String(fd.get("request_text") ?? "").trim();
  const savedRaw = String(fd.get("saved_scores") ?? "");
  const photo = fd.get("photo");
  if (!text || text.length > 500) return { ok: false, error: "바르게 고칠 점수를 500자 안에서 적어 주세요." };
  if (!(photo instanceof File) || photo.size === 0) return { ok: false, error: "성적표 사진을 올려 주세요. 사진이 없으면 요청이 반려됩니다." };
  const ext = TYPES[photo.type];
  if (!ext) return { ok: false, error: "사진은 JPG·PNG·WEBP 또는 PDF 파일로 올려 주세요." };
  if (photo.size > MAX_BYTES) return { ok: false, error: "파일이 5MB보다 큽니다. 성적표 부분만 찍어 다시 올려 주세요." };

  const supabase = await supabaseServer();
  if (!supabase) return { ok: false, error: "지금은 요청을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요." };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "로그인이 풀렸습니다. 다시 로그인한 뒤 요청해 주세요." };

  const st = await source().readScoreInputStatus(await getCaller(), EXAM.exam_id).catch(() => null);
  const latest = st ? await myLatestCorrection(EXAM.exam_id, st.stage) : null;
  if (!st || !latest) return { ok: false, error: "입력 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  const releaseOn = st.stage === "provisional" ? await csatReleaseOn(st.academic_year) : null;
  if (!canRequestCorrection(st, latest.row, releaseOn)) return { ok: false, error: "이 시험 단계에서는 지금 정정을 요청할 수 없습니다. 화면을 새로 고쳐 상태를 확인해 주세요." };

  let saved: unknown = null;
  try {
    saved = savedRaw ? JSON.parse(savedRaw) : null;
  } catch {
    saved = null;
  }

  const path = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(CORRECTION_BUCKET).upload(path, photo, { contentType: photo.type, upsert: false });
  if (up.error) return { ok: false, error: "사진을 올리지 못했습니다. 잠시 뒤 다시 시도해 주세요." };

  const { error } = await supabase.from("jeongsi_correction_requests").insert({
    user_id: auth.user.id,
    exam_id: st.exam_id,
    stage: st.stage,
    entry_version: st.entry_version,
    saved_scores: saved,
    request_text: text,
    photo_path: path,
  });
  if (error) {
    return { ok: false, error: error.code === "23505" ? "이 시험 단계에는 이미 접수된 정정 요청이 있습니다." : "요청을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  revalidatePath("/reports/me");
  return { ok: true };
}
