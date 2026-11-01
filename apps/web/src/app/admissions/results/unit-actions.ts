"use server";

import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import { currentSnapshot, unitRows } from "@/lib/p1-snapshot";
import type { Row } from "@/lib/p1-shape";
import { lockFor, page } from "@/lib/routes";

export type UnitRows = { ok: true; rows: Row[] } | { ok: false; code: string };

/**
 * 펼친 모집단위 하나의 학년도별 행. 화면 서버의 정리본 저장본에서만 읽는다(서비스 API 의 입결 조회를 다시 부르지 않음).
 * 회원 확인은 매번 한다. 판이 바뀌었으면 옛 판 행을 돌려주지 않는다
 */
export async function loadUnitRows(pub: string, schoolId: string, key: string): Promise<UnitRows> {
  if (!/^[0-9a-f]{32}$/.test(pub) || !/^[A-Za-z0-9._:-]{1,64}$/.test(schoolId) || !/^(?:(?:pk|ob):[A-Za-z0-9._:-]{1,160}|r27:(?:0|[1-9][0-9]{0,9}))$/.test(key)) return { ok: false, code: "invalid_request" };
  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return { ok: false, code: down.code };
  if (lockFor(session, page("PAGE-01"))) return { ok: false, code: "authentication_required" };
  try {
    const snap = await currentSnapshot(src, caller);
    if (snap.state !== "ready" || snap.ready.pub !== pub) return { ok: false, code: "publication_changed" };
    return { ok: true, rows: await unitRows(snap.ready, schoolId, key) };
  } catch (e) {
    if (e instanceof ConnectionError || e instanceof AccessDenied) return { ok: false, code: e.code };
    throw e;
  }
}
