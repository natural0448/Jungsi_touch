import Link from "@/components/link";
import type { ReactNode } from "react";
import type { PickedItem } from "@/lib/shortlist";
import { page } from "@/lib/routes";

/**
 * 핵심 지원 학교 띠. 3·4페이지가 같은 report.shortlist 를 보여 주고 2페이지 리포트로 잇는다.
 * more: 이름을 아직 받지 못한 담은 곳(지금 목록에 없는 곳). 개수는 바로 세고 이름은 뒤이어 채운다(2026-11-10)
 */
export function ShortlistTray({ items, other, more }: { items: PickedItem[]; other: "PAGE-03" | "PAGE-04"; more?: { count: number; names: ReactNode } }) {
  const to = page(other);
  return (
    <div className="tray">
      <div className="wrap">
        <div className="in">
          <span className="t">
            핵심 지원 학교 <b className="num">{items.length + (more?.count ?? 0)}</b>
          </span>
          <span className="names">
            {items.length || more?.count ? (
              <>
              {items.map((s) => (
                <span key={s.offering_id} className={s.entry.assessment_status === "needs_revalidation" ? "stale" : undefined}>
                  {s.offering ? `${s.offering.university_name} ${s.offering.department}` : "카탈로그에 없는 모집단위"}
                </span>
              ))}
              {more?.count ? more.names : null}
              </>
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
