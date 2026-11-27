import type { Caller, JungsiSource } from "@/lib/api";
import type { OfferingDto } from "@/lib/dto";
import { currentSnapshot, type Ready } from "@/lib/p1-snapshot";
import { p1Years } from "@/lib/p1-years";
import { mapPool } from "@/lib/print-pool";
import type { Extras } from "./extras-actions";

/** 정시터치 서버 동시 요청 한도(유료 계정 2). 학교마다 모집 정보 → 발행 기준을 차례로 받으므로 함께 나가는 요청은 이 수를 넘지 않는다 */
export const PRINT_EXTRAS_CONCURRENCY = 2;

/**
 * 인쇄 화면(상담 리포트·지난 기록·전문가용 학생)이 담은 학교마다 펼친 상세를 그리려고 미리 받는 자료(2026-11-22 대표님 결정).
 * 4·2페이지 펼침(extras-actions loadExtras)과 같은 세 가지 — 2027 모집 정보·발행된 학과 기준·1페이지와 같은 학년도별 대학 발표 성적.
 * 다른 점: 펼친 기록(content view)은 남기지 않고, 학교 하나가 실패해도 그 학교만 '미공개'로 그린다(인쇄 전체를 막지 않는다).
 * 1페이지 저장본이 없을 때의 확인(currentSnapshot)은 한 번만 해서 모든 학교가 나눠 쓴다.
 */
export async function loadPrintExtras(src: JungsiSource, caller: Caller, offerings: readonly Pick<OfferingDto, "offering_id" | "university_name">[]): Promise<Record<string, Extras>> {
  let snap: Promise<Ready | null> | null = null;
  const ready = () =>
    (snap ??= currentSnapshot(src, caller)
      .then((s) => (s.state === "ready" ? s.ready : null))
      .catch(() => null));
  const list = await mapPool(
    offerings,
    PRINT_EXTRAS_CONCURRENCY,
    async (o): Promise<[string, Extras]> => {
      const fastP = p1Years(o.offering_id, o.university_name);
      const rec = await src.readRecruitment(caller, o.offering_id).catch(() => null);
      const pub = await src.readPublishedForecast(caller, o.offering_id).catch(() => null);
      const p1 = (await fastP) ?? (await p1Years(o.offering_id, o.university_name, ready));
      return [o.offering_id, { ok: true, rec, pub, p1 }];
    },
    (_e, o): [string, Extras] => [o.offering_id, { ok: false, code: "request_failed" }],
  );
  return Object.fromEntries(list);
}
