import type { Caller } from "@/lib/api/source";
import type { RecruitmentDto } from "@/lib/dto";

/**
 * 1페이지 정리본(11-08 판)은 2027 모집 단계(최초·최종)를 싣지 않는다. 화면팀이 Guide 에 단계와 출처를 등록한
 * 모집행만 여기 적고, 표시할 때는 반드시 모집 읽기(recruitment.read)로 다시 확인한다.
 * 목록은 읽기 요청을 몇 건으로 줄이는 용도일 뿐, 단계 표시의 근거는 서버 응답이다.
 * 2026-11-25 F1-b 화성의과학대 간호(최초 10명).
 */
export const STAGE_REGISTERED: ReadonlySet<string> = new Set(["2027:1000005794"]);

type Reader = { readRecruitment(caller: Caller, offeringId: string): Promise<RecruitmentDto | null> };

/** 정리본 모집 숫자와 서버의 최초 인원이 같은 모집행만 돌려준다. 읽기 실패·불일치는 그대로 '모집'으로 둔다. */
export async function verifiedInitial(src: Reader, caller: Caller, rows: ReadonlyArray<{ y: number; pk: string | null; q27?: { v: string | null } }>): Promise<Set<string>> {
  const want = rows.filter((r) => r.y === 2027 && r.pk !== null && STAGE_REGISTERED.has(r.pk) && r.q27?.v);
  const out = new Set<string>();
  await Promise.all(want.slice(0, 8).map(async (r) => {
    const rec = await src.readRecruitment(caller, r.pk!).catch(() => null);
    const n = rec?.status === "ready" ? rec.recruitment?.initial_count ?? null : null;
    if (n !== null && String(n) === r.q27!.v!.trim()) out.add(r.pk!);
  }));
  return out;
}
