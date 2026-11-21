"use server";

import { getCaller, source } from "@/lib/api";
import { loadPrintExtras } from "@/app/admissions/possibilities/print-extras";
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
  return loadPrintExtras(source(), await getCaller(), ok);
}
