"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { requestCorrection, type CorrectionFormState } from "./correction-actions";

/** 휴대폰 사진은 크다 — 긴 변 2000px JPEG 로 줄여 보낸다(PDF·작은 파일은 그대로). 줄이지 못하면 원본 */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob ? new File([blob], "score.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/**
 * 성적 정정 요청 양식(2026-10-28 사용자 결정): 바르게 고칠 점수 + 성적표 사진(필수).
 * 관리자가 사진으로 확인한 뒤 승인하면 이 단계의 성적을 한 번 더 입력할 수 있다.
 */
export function CorrectionForm({ stageLabel, savedScores }: { stageLabel: string; savedScores: string }) {
  const [state, action, pending] = useActionState<CorrectionFormState, FormData>(requestCorrection, null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);

  if (state?.ok) {
    return (
      <p className="rp-note" role="status">
        정정 요청을 접수했습니다. 관리자가 성적표 사진을 확인한 뒤 승인하면 이 화면에서 성적을 다시 입력할 수 있습니다.
      </p>
    );
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return setPhoto(null);
    setPreparing(true);
    setPhoto(await shrink(f));
    setPreparing(false);
  }

  return (
    <form
      className="rp-correct"
      action={(fd) => {
        if (photo) fd.set("photo", photo);
        return action(fd);
      }}
    >
      <input type="hidden" name="saved_scores" value={savedScores} />
      <label>
        <b>바르게 고칠 점수</b>
        <span className="hint">예: 수학(미적분) 표준점수 128 → 131, 영어 등급 3 → 2</span>
        <textarea name="request_text" required maxLength={500} rows={3} />
      </label>
      <label>
        <b>{stageLabel} 성적표 사진</b>
        <span className="hint">이름·시험·과목별 점수가 보이게 찍어 주세요. JPG·PNG·PDF, 5MB 이하. 사진이 없거나 알아볼 수 없으면 반려되어 다시 요청해야 합니다.</span>
        {/* 이름을 두지 않는다 — 원본 대신 줄인 파일만 photo 로 보낸다 */}
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={pick} />
      </label>
      {state && !state.ok && <p className="rp-err" role="alert">{state.error}</p>}
      <p className="hint">정정은 이 시험 단계에서 한 번뿐입니다. 승인된 뒤 다시 입력한 성적은 더 고칠 수 없습니다.</p>
      <button type="submit" className="btn p" disabled={pending || preparing || !photo}>
        {pending ? "보내는 중…" : preparing ? "사진 준비 중…" : "정정 요청 보내기"}
      </button>
    </form>
  );
}
