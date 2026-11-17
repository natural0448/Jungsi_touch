"use server";

import { AccessDenied, ConnectionError, getCaller, sessionOrDown, source } from "@/lib/api";
import { currentSnapshot, loadAdigaFill, schoolUnitRows } from "@/lib/p1-snapshot";
import { applyAdigaFill } from "@/lib/p1-adiga-fill";
import type { Row } from "@/lib/p1-shape";
import { lockFor, page } from "@/lib/routes";

export type UnitRows = { ok: true; rows: Row[] } | { ok: false; code: string };
export type SchoolRows = { ok: true; units: Record<string, Row[]> } | { ok: false; code: string };

const KEY = /^(?:(?:pk|ob):[A-Za-z0-9._:-]{1,160}|r27:(?:0|[1-9][0-9]{0,9}))$/;
/** 한 화면 학교의 모집단위 수 상한(가장 큰 학교도 수백 개). 넘으면 요청 오류로 본다 */
const MAX_KEYS = 600;

/**
 * 한 학교에서 화면에 보이는 모집단위들의 학년도별 행을 한 번에 돌려준다(11-07 사용자 요청: 펼침이 늦다).
 * 줄마다 요청하면 펼칠 때마다 회원 확인 왕복(약 0.7초)이 들고, 일반 회원 동시 처리 한도 1 때문에 연달아 누르면 줄을 섰다.
 * 학교 단위로 한 번 받으면 같은 학교의 다른 줄은 요청 없이 바로 펼친다.
 * 화면 서버의 정리본 저장본에서만 읽고(서비스 API 의 입결 조회를 다시 부르지 않음), 회원 확인은 매번 한다.
 * 판이 바뀌었으면 옛 판 행을 돌려주지 않는다.
 */
export async function loadSchoolRows(pub: string, schoolId: string, keys: string[]): Promise<SchoolRows> {
  if (!/^[0-9a-f]{32}$/.test(pub) || !/^[A-Za-z0-9._:-]{1,64}$/.test(schoolId) || !Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS || !keys.every((k) => typeof k === "string" && KEY.test(k))) return { ok: false, code: "invalid_request" };
  const caller = await getCaller();
  const src = source();
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return { ok: false, code: down.code };
  if (lockFor(session, page("PAGE-01"))) return { ok: false, code: "authentication_required" };
  try {
    const snap = await currentSnapshot(src, caller);
    if (snap.state !== "ready" || snap.ready.pub !== pub) return { ok: false, code: "publication_changed" };
    const units = await schoolUnitRows(snap.ready, schoolId, keys);
    // YearTable displays historical results only. The 2027 anchor and its
    // server-only scope/relationship identifiers must remain on the server.
    // 빈 50%·70%컷은 화면팀이 대학어디가와 대조한 표로 채운다(2026-11-17 대표님 결정). 표가 없으면 그대로.
    const fill = await loadAdigaFill();
    for (const k of Object.keys(units)) units[k] = applyAdigaFill(units[k].filter((row) => row.y < 2027), fill);
    return { ok: true, units };
  } catch (e) {
    if (e instanceof ConnectionError || e instanceof AccessDenied) return { ok: false, code: e.code };
    throw e;
  }
}
