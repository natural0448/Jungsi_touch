import "server-only";
import { applyAdigaFill, noRecruit } from "@/lib/p1-adiga-fill";
import { fillCount } from "@/lib/p1-derived";
import { publishedStats } from "@/lib/p1-published-stats";
import { displayReady, loadAdigaFill, pastRowsFor2027, type Ready, type Row } from "@/lib/p1-snapshot";
import type { CounselYear } from "@/lib/pro-counsel";

/** 한 번에 읽는 학교 수 상한(전문가용 담기 한도 15의 두 배) */
const MAX = 30;
const ID = /^2027:([0-9]{1,12})$/;

/** 1페이지 행 하나 → 상담에 쓰는 값. 단위·문법이 맞지 않는 값은 null(문장을 만들지 않는다) */
export function counselYearOf(r: Row): CounselYear {
  const none = noRecruit(r);
  const q = r.rc.v !== null && r.rc.u === "명" && /^\d{1,9}$/.test(r.rc.v.trim()) ? Number(r.rc.v.trim()) : null;
  const ratio = r.cr.v !== null && (r.cr.u === null || r.cr.u.includes("대")) && /^\d+(\.\d+)?$/.test(r.cr.v.trim()) ? r.cr.v.trim() : null;
  const [first, second] = publishedStats(r);
  const stat = (s: typeof first) => (s && s.cell.v && !s.schoolRecord ? { label: s.label, value: s.cell.v, unit: s.cell.u } : null);
  return {
    year: r.y,
    quota: none ? null : q,
    ratio: none ? null : ratio,
    fill: none ? null : fillCount(r),
    first: stat(first),
    second: stat(second),
  };
}

/**
 * 담은 학교마다 1페이지 2024~2026 행(1페이지·3페이지 연도별 근거와 같은 정리본·어디가 보충표). 서비스 API 를 부르지 않는다.
 * 정리본이 없거나 읽지 못하면 그 학교는 null — 상담 팁의 지난 학년도 문장이 빠질 뿐 화면은 그려진다.
 */
export async function counselYears(
  items: readonly { offering_id: string; university_name: string }[],
  readyOf: () => Promise<Ready | null> = displayReady,
): Promise<Record<string, CounselYear[] | null>> {
  const ok = items.filter((i) => ID.test(i.offering_id) && typeof i.university_name === "string" && i.university_name.length > 0 && i.university_name.length <= 100).slice(0, MAX);
  if (ok.length === 0) return {};
  let ready: Ready | null = null;
  let fill: Awaited<ReturnType<typeof loadAdigaFill>> = null;
  try {
    [ready, fill] = await Promise.all([readyOf(), loadAdigaFill()]);
  } catch {
    ready = null;
  }
  const out: Record<string, CounselYear[] | null> = {};
  for (const i of ok) {
    if (!ready) {
      out[i.offering_id] = null;
      continue;
    }
    try {
      const rows = applyAdigaFill(await pastRowsFor2027(ready, i.university_name, ID.exec(i.offering_id)![1]), fill);
      out[i.offering_id] = rows.map(counselYearOf);
    } catch {
      out[i.offering_id] = null;
    }
  }
  return out;
}
