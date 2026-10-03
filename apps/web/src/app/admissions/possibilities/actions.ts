"use server";

import { togglePick as toggleShared } from "@/app/shortlist-actions";

/*
  3·4페이지가 같은 담기 동작을 쓰도록 본체를 app/shortlist-actions.ts 로 옮겼다.
  이 파일은 저장소 규칙(사용자 허락 전 파일 삭제 금지)에 따라 남겨 두고 같은 동작으로 잇는다.
*/
export async function togglePick(fd: FormData) {
  await toggleShared(fd);
}
