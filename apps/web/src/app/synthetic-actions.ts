"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { source } from "@/lib/api";
import { SYN_COOKIE, SYN_STAGES, SYN_STATES } from "@/lib/api/synthetic";

/** 합성 응답 띠의 회원 상태 바꾸기. live 모드에서는 아무것도 하지 않는다 */
export async function setSyntheticState(fd: FormData) {
  if (source().kind !== "synthetic") return;
  const v = String(fd.get("state") ?? "");
  if (!SYN_STATES.some((s) => s.v === v)) return;
  (await cookies()).set(SYN_COOKIE.state, v, { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}

/** 합성 응답 띠의 성적 입력 단계 바꾸기(수능 가채점·실채점 화면 미리보기). live 모드에서는 아무것도 하지 않는다 */
export async function setSyntheticStage(fd: FormData) {
  if (source().kind !== "synthetic") return;
  const v = String(fd.get("stage") ?? "");
  if (!SYN_STAGES.some((s) => s.v === v)) return;
  (await cookies()).set(SYN_COOKIE.stage, v, { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
