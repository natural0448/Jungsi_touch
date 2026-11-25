"use server";

import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { logContentView } from "@/lib/content-view";
import type { ForecastPublicDto, RecruitmentDto } from "@/lib/dto";
import { currentSnapshot } from "@/lib/p1-snapshot";
import { p1Quota27, p1Years, type P1Year } from "@/lib/p1-years";
import { page } from "@/lib/routes";

export type { P1Year };
export type Extras =
  | { ok: true; rec: RecruitmentDto | null; pub: ForecastPublicDto | null; p1: P1Year[] | null; q27?: number | null }
  | { ok: false; code: string };


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
    // 유료 계정의 승인 동시성은 2 — 서비스 조회는 두 개만 함께 보낸다. 1페이지 성적은 화면 서버 저장본이라 같이 읽는다
    const [rec, pub, fast] = await Promise.all([src.readRecruitment(caller, offeringId), src.readPublishedForecast(caller, offeringId), p1Years(offeringId, university)]);
    // 저장된 준비본이 없을 때만 예전처럼 1페이지와 같은 확인을 거쳐 읽는다(서비스 조회 두 개가 끝난 뒤 — 동시성 2 유지)
    const p1 = fast ?? await p1Years(offeringId, university, async () => {
      const snap = await currentSnapshot(src, caller);
      return snap.state === "ready" ? snap.ready : null;
    });
    // 2026-11-25: 서버가 단계 없는 모집요강 인원을 '미공개'로 주는 행은 1페이지와 같은 2027 인원을 쓴다(저장본만 읽음)
    const q27 = rec?.status === "ready" ? null : await p1Quota27(offeringId, university);
    await logContentView("analysis", `${page("PAGE-03").path}?open=${encodeURIComponent(offeringId)}`);
    return { ok: true, rec, pub, p1, q27 };
  } catch (e) {
    if (e instanceof AccessDenied || e instanceof ConnectionError) return { ok: false, code: e.code };
    throw e;
  }
}
