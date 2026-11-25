import { applyAdigaFill } from "@/lib/p1-adiga-fill";
import { publishedStats } from "@/lib/p1-published-stats";
import { quota27Count } from "@/lib/p1-shape";
import { displayReady, loadAdigaFill, pastRowsFor2027, row2027For, type Ready } from "@/lib/p1-snapshot";

/** 1페이지와 같은 학년도별 대학 발표 성적 ①② (3페이지 연도별 근거 칸) */
export type P1Year = { year: number; stats: { label: string; value: string; unit: string | null }[] };
/**
 * 1페이지 정리본에서 이 2027 모집행의 과거 행을 찾아 1페이지와 같은 규칙(①②)으로 고른 성적.
 * 정리본이 준비되지 않았거나 읽지 못하면 null — 연도별 근거 칸은 '자료 없음'으로 남는다.
 */
export async function p1Years(offeringId: string, university: string, readyOf: () => Promise<Ready | null> = displayReady): Promise<P1Year[] | null> {
  const m = /^2027:([0-9]{1,12})$/.exec(offeringId);
  if (!m || !university) return null;
  try {
    // 서비스 API를 부르지 않고 화면 서버의 저장된 준비본만 읽는다(유료 계정 동시성 2와 겹치지 않음)
    const [ready, fill] = await Promise.all([readyOf(), loadAdigaFill()]);
    if (!ready) return null;
    const rows = applyAdigaFill(await pastRowsFor2027(ready, university, m[1]), fill);
    return rows.map((r) => ({
      year: r.y,
      stats: publishedStats(r).flatMap((s) => (s && s.cell.v ? [{ label: s.label, value: s.cell.v, unit: s.cell.u }] : [])),
    }));
  } catch {
    return null;
  }
}

/** 1페이지와 같은 2027 모집인원(숫자). 스냅샷이 없거나 원문이 숫자가 아니면 null */
export async function p1Quota27(offeringId: string, university: string, readyOf: () => Promise<Ready | null> = displayReady): Promise<number | null> {
  const m = /^2027:([0-9]{1,12})$/.exec(offeringId);
  if (!m || !university) return null;
  try {
    const ready = await readyOf();
    if (!ready) return null;
    return quota27Count((await row2027For(ready, university, m[1]))?.q27);
  } catch {
    return null;
  }
}
