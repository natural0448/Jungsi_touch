"use server";

import { getCaller, source } from "@/lib/api";
import { loadPrintExtras, PRINT_EXTRAS_CONCURRENCY } from "@/app/admissions/possibilities/print-extras";
import { mapPool } from "@/lib/print-pool";
import { counselYears } from "@/lib/pro-counsel-data";
import type { CounselYear } from "@/lib/pro-counsel";
import type { Extras } from "@/app/admissions/possibilities/extras-actions";

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** 한 인쇄본에 넣는 학교 수 상한(개인용 담기 한도 15의 두 배 — 전문가용 담기 한도가 달라도 넉넉하게) */
const PRINT_MAX = 30;

/**
 * 전문가용 학생 인쇄본의 담은 학교마다 펼친 상세를 그릴 자료(2027 모집 정보·발행 기준·1페이지 학년도별 성적, 2026-11-22 대표님 결정).
 * 학생 성적·리포트는 받지도 보내지도 않는다 — 모집단위 번호와 대학 이름만 받아 상담 리포트 인쇄와 같은 방법(print-extras.ts)으로 읽는다.
 * 모집 정보를 읽을 권한이 없는 계정이면 그 칸은 '미공개'로 그려진다(인쇄는 막지 않는다).
 */
export async function loadProPrintExtras(items: { offering_id: string; university_name: string }[]): Promise<Record<string, Extras>> {
  if (!Array.isArray(items)) return {};
  const ok = items
    .filter((i) => i && typeof i.offering_id === "string" && ID.test(i.offering_id) && typeof i.university_name === "string" && i.university_name.length <= 100)
    .slice(0, PRINT_MAX)
    .map((i) => ({ offering_id: i.offering_id, university_name: i.university_name }));
  if (ok.length === 0) return {};
  // 2026-11-24: 선생님 계정 조회가 요청 한도 재시도에 묶이면 인쇄가 끝없이 기다렸다 — 20초 안에 못 받으면 모두 '미공개'로 그린다
  const timeout = new Promise<Record<string, Extras>>((r) => setTimeout(() => r({}), 20000));
  return Promise.race([loadPrintExtras(source(), await getCaller(), ok), timeout]);
}

/**
 * 선생님용 인쇄의 상담 팁 자료(2026-11-22): 1페이지 학년도 값(화면 서버 정리본)과 2027 최종 모집인원(모집 정보).
 * 학생 성적·리포트는 받지도 보내지도 않는다. 받지 못한 학교는 그 문장만 빠진다.
 */
export async function loadProCounselData(
  items: { offering_id: string; university_name: string }[],
  withRecruitment: boolean,
): Promise<{ years: Record<string, CounselYear[] | null>; quotas: Record<string, number | null> }> {
  if (!Array.isArray(items)) return { years: {}, quotas: {} };
  const ok = items
    .filter((i) => i && typeof i.offering_id === "string" && ID.test(i.offering_id) && typeof i.university_name === "string" && i.university_name.length <= 100)
    .slice(0, PRINT_MAX)
    .map((i) => ({ offering_id: i.offering_id, university_name: i.university_name }));
  if (ok.length === 0) return { years: {}, quotas: {} };
  const years = await counselYears(ok).catch(() => ({}));
  const quotas: Record<string, number | null> = {};
  if (withRecruitment) {
    const caller = await getCaller(), src = source();
    const list = await mapPool(ok, PRINT_EXTRAS_CONCURRENCY, async (o): Promise<[string, number | null]> => {
      const rec = await src.readRecruitment(caller, o.offering_id).catch(() => null);
      const n = rec?.recruitment?.final_count;
      return [o.offering_id, typeof n === "number" && Number.isSafeInteger(n) ? n : null];
    }, (_e, o): [string, number | null] => [o.offering_id, null]);
    Object.assign(quotas, Object.fromEntries(list));
  }
  return { years, quotas };
}
