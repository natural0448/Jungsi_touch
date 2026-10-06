"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { source } from "@/lib/api";
import { SYN_COOKIE, SYN_STATES } from "@/lib/api/synthetic";

/** 합성 응답 띠의 회원 상태 바꾸기. live 모드에서는 아무것도 하지 않는다 */
export async function setSyntheticState(fd: FormData) {
  if (source().kind !== "synthetic") return;
  const v = String(fd.get("state") ?? "");
  if (!SYN_STATES.some((s) => s.v === v)) return;
  (await cookies()).set(SYN_COOKIE.state, v, { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
  revalidatePath("/", "layout");
}
