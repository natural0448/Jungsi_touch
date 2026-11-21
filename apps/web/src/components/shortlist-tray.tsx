import Link from "@/components/link";
import type { PickedItem } from "@/lib/shortlist";
import { page } from "@/lib/routes";

/** 담기 한도(서버 판단, 2026-11-18): 같은 모집군 4개 · 전체 12개. 화면은 셈만 보이고 막는 것은 서버다 */
export const PICK_GROUP_LIMIT = 4;
export const PICK_TOTAL_LIMIT = 12;
const GROUP_NAMES = ["가", "나", "다"] as const;

/** 담은 곳을 모집군별로 센다. 모집군을 모르는 곳(목록에서 빠진 모집단위)은 전체에만 센다 */
export function groupCounts(items: PickedItem[]): { group: string; n: number }[] {
  return GROUP_NAMES.map((g) => ({ group: g, n: items.filter((s) => (s.offering?.group ?? "").trim().startsWith(g)).length }));
}

/**
 * 핵심 지원 학교 띠. 3·4페이지가 같은 report.shortlist 를 보여 주고 2페이지 리포트로 잇는다.
 * 군별 담은 수를 '가군 2/4 · 나군 1/4 · 다군 0/4 · 전체 3/12'로 함께 보인다(대표님 요청 2026-11-22).
 * 이름·모집군은 띠를 그리기 전에 모두 받아 한 번에 그린다(shortlist-tray-stream.tsx)
 */
export function ShortlistTray({ items, other }: { items: PickedItem[]; other: "PAGE-03" | "PAGE-04" }) {
  const to = page(other);
  const counts = groupCounts(items);
  return (
    <div className="tray">
      <div className="wrap">
        <div className="in">
          <span className="t">
            핵심 지원 학교 <b className="num">{items.length}</b>
          </span>
          <span className="quota" aria-label="모집군별 담은 수">
            {counts.map((c) => (
              <span key={c.group} className={c.n >= PICK_GROUP_LIMIT ? "full" : undefined}>
                {c.group}군 <b className="num">{c.n}</b>/{PICK_GROUP_LIMIT}
              </span>
            ))}
            <span className={items.length >= PICK_TOTAL_LIMIT ? "full" : undefined}>
              전체 <b className="num">{items.length}</b>/{PICK_TOTAL_LIMIT}
            </span>
          </span>
          <span className="names">
            {items.length ? (
              items.map((s) => (
                <span key={s.offering_id} className={s.entry.assessment_status === "needs_revalidation" ? "stale" : undefined}>
                  {s.offering ? `${s.offering.university_name} ${s.offering.department}` : "지금 목록에서 찾을 수 없는 모집단위"}
                </span>
              ))
            ) : (
              <span className="none">담은 곳이 없습니다. 담기를 누르세요.</span>
            )}
          </span>
          <Link className="btn" href={to.path}>{to.label}에서도 같은 목록</Link>
          <Link className="btn p" href={page("PAGE-02").path}>리포트에서 정리</Link>
        </div>
      </div>
    </div>
  );
}
