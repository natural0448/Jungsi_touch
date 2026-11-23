import { REPORT_TAB } from "@/lib/routes";
import Link from "@/components/link";
import type { PickedItem } from "@/lib/shortlist";
import { page } from "@/lib/routes";
import { groupCounts, PICK_GROUP_LIMIT, PICK_TOTAL_LIMIT } from "@/lib/picked-view";

/* 담기 한도(서버 판단): 같은 모집군 5개 · 전체 15개(대표님 요청 2026-11-21, 전에는 4·12) — lib/picked-view. 화면은 셈만 보이고 막는 것은 서버다 */

/**
 * 핵심 지원 학교 띠. 3·4페이지가 같은 report.shortlist 를 보여 주고 2페이지 리포트로 잇는다.
 * 군별 담은 수를 '가군 2/5 · 나군 1/5 · 다군 0/5 · 전체 3/15'로 함께 보인다(대표님 요청 2026-11-22, 한도 11-21).
 * 이름·모집군은 띠를 그리기 전에 모두 받아 한 번에 그린다(shortlist-tray-stream.tsx)
 */
/** links: 전문가용 학생 탭(2026-11-23)은 같은 띠를 그 학생의 ②·④ 탭 주소로 잇는다 */
export function ShortlistTray({ items, other, links }: { items: PickedItem[]; other: "PAGE-03" | "PAGE-04"; links?: { other: string; report: string; reportLabel?: string } }) {
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
          <Link className="btn" href={links?.other ?? to.path}>{to.label}에서도 같은 목록</Link>
          <Link className="btn p" href={links?.report ?? REPORT_TAB.path}>{links?.reportLabel ?? "리포트에서 정리"}</Link>
        </div>
      </div>
    </div>
  );
}
