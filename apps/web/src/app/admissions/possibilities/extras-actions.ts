"use server";

import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { logContentView } from "@/lib/content-view";
import type { ForecastPublicDto, RecruitmentDto } from "@/lib/dto";
import { applyAdigaFill } from "@/lib/p1-adiga-fill";
import { publishedStats } from "@/lib/p1-published-stats";
import { currentSnapshot, loadAdigaFill, pastRowsFor2027 } from "@/lib/p1-snapshot";
import { page } from "@/lib/routes";

/** 1페이지와 같은 학년도별 대학 발표 성적 ①② (3페이지 연도별 근거 칸) */
export type P1Year = { year: number; stats: { label: string; value: string; unit: string | null }[] };
export type Extras =
  | { ok: true; rec: RecruitmentDto | null; pub: ForecastPublicDto | null; p1: P1Year[] | null }
  | { ok: false; code: string };

/**
 * 1페이지 정리본에서 이 2027 모집행의 과거 행을 찾아 1페이지와 같은 규칙(①②)으로 고른 성적.
 * 정리본이 준비되지 않았거나 읽지 못하면 null — 연도별 근거 칸은 '자료 없음'으로 남는다.
 */
async function p1Years(caller: Awaited<ReturnType<typeof getCaller>>, src: ReturnType<typeof source>, offeringId: string, university: string): Promise<P1Year[] | null> {
  const m = /^2027:([0-9]{1,12})$/.exec(offeringId);
  if (!m || !university) return null;
  try {
    const snap = await currentSnapshot(src, caller);
    if (snap.state !== "ready") return null;
    const rows = applyAdigaFill(await pastRowsFor2027(snap.ready, university, m[1]), await loadAdigaFill());
    return rows.map((r) => ({
      year: r.y,
      stats: publishedStats(r).flatMap((s) => (s && s.cell.v ? [{ label: s.label, value: s.cell.v, unit: s.cell.u }] : [])),
    }));
  } catch {
    return null;
  }
}

/**
 * 펼친 모집단위 하나의 2027 모집 정보(recruitment.read)와 발행된 학과 기준(forecast.published.read),
 * 그리고 1페이지와 같은 학년도별 대학 발표 성적(화면 서버 정리본, 2026-11-17 대표님 결정).
 * 펼치기는 화면에서 바로 하고, 이것들만 뒤이어 받는다(페이지 전체를 다시 그리지 않는다).
 * 권한은 서버가 판단한다. 펼친 모집단위를 본 기록은 전과 같이 'analysis' 조회로 남긴다(?open= 주소).
 */
export async function loadExtras(offeringId: string, university = ""): Promise<Extras> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(offeringId) || typeof university !== "string" || university.length > 100) return { ok: false, code: "invalid_request" };
  const caller = await getCaller();
  const src = source();
  try {
    // 유료 계정의 승인 동시성은 2 — 두 조회만 함께 보낸다. 정리본 확인은 그 뒤에 한다
    const [rec, pub] = await Promise.all([src.readRecruitment(caller, offeringId), src.readPublishedForecast(caller, offeringId)]);
    const p1 = await p1Years(caller, src, offeringId, university);
    await logContentView("analysis", `${page("PAGE-03").path}?open=${encodeURIComponent(offeringId)}`);
    return { ok: true, rec, pub, p1 };
  } catch (e) {
    if (e instanceof AccessDenied || e instanceof ConnectionError) return { ok: false, code: e.code };
    throw e;
  }
}
