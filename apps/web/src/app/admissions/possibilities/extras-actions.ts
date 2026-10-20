"use server";

import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { logContentView } from "@/lib/content-view";
import type { ForecastPublicDto, RecruitmentDto } from "@/lib/dto";
import { page } from "@/lib/routes";

export type Extras = { ok: true; rec: RecruitmentDto | null; pub: ForecastPublicDto | null } | { ok: false; code: string };

/**
 * 펼친 모집단위 하나의 2027 모집 정보(recruitment.read)와 발행된 학과 기준(forecast.published.read).
 * 펼치기는 화면에서 바로 하고, 이 두 가지만 뒤이어 받는다(페이지 전체를 다시 그리지 않는다).
 * 권한은 서버가 판단한다. 펼친 모집단위를 본 기록은 전과 같이 'analysis' 조회로 남긴다(?open= 주소).
 */
export async function loadExtras(offeringId: string): Promise<Extras> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(offeringId)) return { ok: false, code: "invalid_request" };
  const caller = await getCaller();
  const src = source();
  try {
    // 유료 계정의 승인 동시성은 2 — 두 조회만 함께 보낸다
    const [rec, pub] = await Promise.all([src.readRecruitment(caller, offeringId), src.readPublishedForecast(caller, offeringId)]);
    await logContentView("analysis", `${page("PAGE-03").path}?open=${encodeURIComponent(offeringId)}`);
    return { ok: true, rec, pub };
  } catch (e) {
    if (e instanceof AccessDenied || e instanceof ConnectionError) return { ok: false, code: e.code };
    throw e;
  }
}
